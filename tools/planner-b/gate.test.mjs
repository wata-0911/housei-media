import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pins } from './materialize.mjs';
import { startLocalGate } from './local-gate.mjs';

const password = randomBytes(32).toString('hex');
const auth = 'Basic ' + Buffer.from('b72:' + password).toString('base64');
const dist = process.env.B72_DIST;
assert(dist, 'B72_DIST required');

function get(origin, path, method, headers = {}) {
  return new Promise((resolve, reject) => {
    request(origin + path, { method, headers }, response => {
      const chunks = [];
      response.on('data', bytes => chunks.push(bytes));
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: response.statusCode, bytes: body.length, body, headers: response.headers });
      });
    }).on('error', reject).end();
  });
}

test('the default profile never serves the protected route', async t => {
  const off = await startLocalGate({ port: 0 });
  t.after(off.close);
  for (const method of ['GET', 'HEAD']) {
    for (const path of ['/', '/planner', '/assets/ordinary.js']) {
      const denied = await get(off.origin, path, method, { Authorization: auth });
      assert.equal(denied.status, 403);
      assert.equal(denied.bytes, 0);
    }
  }
});

test('request authorization covers navigation, deep routes, and the exact asset allowlist', async t => {
  const gate = await startLocalGate({ dist, port: 0, enabled: true, password });
  t.after(gate.close);
  const paths = ['/', '/planner', '/planner/evidence', ...Object.keys(pins.assets).map(name => '/' + name)];
  let deniedCount = 0;
  for (const method of ['GET', 'HEAD']) {
    for (const path of paths) {
      for (const headers of [{}, { Authorization: 'Basic ' + Buffer.from('b72:incorrect').toString('base64') }]) {
        const result = await get(gate.origin, path, method, headers);
        assert.equal(result.status, 401);
        assert.equal(result.bytes, 0);
        assert.match(result.headers['cache-control'], /no-store/);
        deniedCount++;
      }
      const otherHost = await get(gate.origin, path, method, { Host: 'localhost:' + new URL(gate.origin).port, Authorization: auth });
      assert.equal(otherHost.status, 421);
      assert.equal(otherHost.bytes, 0);
      deniedCount++;
    }
    for (const path of ['/', '/planner', ...Object.keys(pins.assets).map(name => '/' + name)]) {
      const result = await get(gate.origin, path, method, { Authorization: auth });
      assert.equal(result.status, 200);
      assert.equal(result.bytes, method === 'HEAD' ? 0 : Number(result.headers['content-length']));
      assert.match(result.headers['cache-control'], /no-store/);
      assert.equal(result.headers['access-control-allow-origin'], undefined);
    }
  }
  for (const path of ['/planner/evidence', '/planner.html', '/ads.txt', '/CalendarApprove', '/public/qa.png', '/dev/ac/']) {
    assert.equal((await get(gate.origin, path, 'GET', { Authorization: auth })).status, 404);
  }
  assert.equal((await get(gate.origin, '/planner', 'POST', { Authorization: auth })).status, 405);
  console.log({ unauthorizedHostOrCredentials: deniedCount, assets: Object.keys(pins.assets).length });
});

const latest = process.env.B78_DIST;
if (latest) {
  const cold = process.env.B78_COLD_DIST;
  assert(cold, 'B78_COLD_DIST required');
  const expected = pins.b78Builds;
  const navigation = ['/', '/planner', '/planner/', '/planner/evidence'];

  test('B78 protects the exact primary and cold assets and denies all 42 default-off requests', async t => {
    const off = await startLocalGate({ port: 0, variant: 'b78-split' });
    t.after(off.close);
    let rejected = 0;
    for (const method of ['GET', 'HEAD']) {
      for (const path of [...navigation, ...Object.keys(expected.split).map(file => '/' + file)]) {
        const reply = await get(off.origin, path, method, { Authorization: auth });
        assert.equal(reply.status, 403);
        assert.equal(reply.bytes, 0);
        assert.match(reply.headers['cache-control'], /no-store/);
        rejected++;
      }
    }
    assert.equal(rejected, 42);
    for (const [variant, directory, manifest] of [
      ['b78-split', latest, expected.split], ['b78-cold', cold, expected.cold],
    ]) {
      const gate = await startLocalGate({ dist: directory, port: 0, enabled: true, password, variant });
      t.after(gate.close);
      for (const [name, entry] of Object.entries(manifest)) {
        const bytes = await readFile(join(directory, name));
        for (const method of ['GET', 'HEAD']) {
          const reply = await get(gate.origin, '/' + name, method, { Authorization: auth });
          assert.equal(reply.status, 200);
          assert.deepEqual(reply.body, method === 'GET' ? bytes : Buffer.alloc(0));
          assert.equal(Number(reply.headers['content-length']), entry.bytes);
          assert.match(reply.headers['cache-control'], /no-store/);
          assert.match(reply.headers['content-security-policy'], /frame-ancestors 'none'/);
          assert.equal(reply.headers['access-control-allow-origin'], undefined);
        }
      }
      for (const method of ['GET', 'HEAD']) {
        for (const path of [...navigation, ...Object.keys(manifest).map(file => '/' + file)]) {
          for (const [headers, status] of [
            [{}, 401], [{ Authorization: auth, Host: 'localhost:' + new URL(gate.origin).port }, 421],
          ]) {
            const denied = await get(gate.origin, path, method, headers);
            assert.equal(denied.status, status);
            assert.equal(denied.bytes, 0);
          }
        }
      }
      assert.equal((await get(gate.origin, '/planner/evidence', 'GET', { Authorization: auth })).status, 404);
      assert.equal((await get(gate.origin, '/planner', 'POST', { Authorization: auth })).status, 405);
      assert.deepEqual((await get(gate.origin, '/planner', 'GET', { Authorization: auth })).body,
        await readFile(join(directory, 'index.html')));
    }
    console.log({ offZeroByte: rejected, checkedPrimary: Object.keys(expected.split).length,
      checkedCold: Object.keys(expected.cold).length });
  });

  test('B78 rejects unknown variant, version or distribution mismatch before listening', async t => {
    const tmp = await mkdtemp(join(tmpdir(), 'b78-gate-negative-'));
    t.after(() => rm(tmp, { recursive: true, force: true }));
    const opts = { port: 0, enabled: true, password, variant: 'b78-split' };
    await assert.rejects(startLocalGate({ ...opts, dist: latest, variant: 'unknown' }), /unknown protected/);
    await assert.rejects(startLocalGate({ ...opts, dist }), /build asset/);
    await assert.rejects(startLocalGate({ ...opts, dist: cold }), /build asset/);
    await assert.rejects(startLocalGate({ ...opts, dist: latest, variant: 'b70-split' }), /build asset/);

    const asset = 'index.html';
    const copy = join(tmp, 'split');
    await cp(latest, copy, { recursive: true });
    await rm(join(copy, asset));
    await assert.rejects(startLocalGate({ ...opts, dist: copy }), /build asset path mismatch/);
    await writeFile(join(copy, asset), await readFile(join(latest, asset)));
    await writeFile(join(copy, 'extra.txt'), 'unlisted test file');
    await assert.rejects(startLocalGate({ ...opts, dist: copy }), /build asset path mismatch/);
    await rm(join(copy, 'extra.txt'));
    await appendFile(join(copy, asset), 'synthetic integrity control');
    await assert.rejects(startLocalGate({ ...opts, dist: copy }), /build asset mismatch/);
  });
}
