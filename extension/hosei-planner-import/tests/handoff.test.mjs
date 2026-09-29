import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

await import('../planner-target.js');
await import('../handoff-store.js');
const handoff = globalThis.HoseiPlannerHandoffStore;
const targets = globalThis.HoseiPlannerTarget;
const token = '11111111-1111-4111-8111-111111111111';
const prodOrigin = 'https://hosei-tsukyo-media.com';
const devOrigin = 'https://housei-media-egvrrjm8y-htms-projects-5d66bc0c.vercel.app';
const storage = () => {
  const values = new Map();
  return { values, async set(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); }, async get(key) { return { [key]: values.get(key) }; }, async remove(key) { values.delete(key); } };
};

test('stores a one-time transfer and creates a production URL containing only its token', async () => {
  targets.configure(['prod']);
  const session = storage(); const payload = { courses: [{ rawName: '成績JSONはURLに含めない' }] };
  const stored = await handoff.store(session, { token, importData: payload, now: 1000 });
  assert.equal(stored.ok, true); assert.equal(stored.entry.expiresAt, 1000 + handoff.TTL_MS);
  const url = handoff.plannerUrl(token);
  assert.equal(url, `${prodOrigin}/planner#hosei-import=11111111-1111-4111-8111-111111111111`);
  assert.equal(url.includes(JSON.stringify(payload)), false);
});

test('creates a dev target URL only in the dev configuration', () => {
  targets.configure(['prod', 'dev']);
  assert.equal(handoff.plannerUrl(token, 'dev'), `${devOrigin}/planner#hosei-import=11111111-1111-4111-8111-111111111111`);
  targets.configure(['prod']);
  assert.throws(() => handoff.plannerUrl(token, 'dev'), /Unauthorized Planner target/);
});

test('returns a live payload only to the exact planner route and deletes it before a second read', async () => {
  targets.configure(['prod']);
  const session = storage(); await handoff.store(session, { token, importData: { schemaVersion: 1 }, now: 1000 });
  const first = await handoff.read(session, { token, senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1001 });
  assert.deepEqual(first, { ok: true, importData: { schemaVersion: 1 } }); assert.equal(session.values.has(handoff.keyFor(token)), false);
  assert.deepEqual(await handoff.read(session, { token, senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1002 }), { ok: false, reason: 'not_found' });
});

test('authorizes the exact planner pathname, including fragments, but rejects other routes and origins', async () => {
  targets.configure(['prod']);
  const cases = [
    [`${prodOrigin}/planner`, true],
    [`${prodOrigin}/other`, false],
    [`${prodOrigin}/planner/test`, false],
    [`${prodOrigin}/planner#hosei-import=example`, true],
    ['https://evil.example/planner', false],
  ];
  for (const [senderUrl, allowed] of cases) {
    const session = storage(); await handoff.store(session, { token, importData: { schemaVersion: 1 }, now: 1000 });
    const result = await handoff.read(session, { token, senderUrl, now: 1001 });
    if (allowed) assert.deepEqual(result, { ok: true, importData: { schemaVersion: 1 } });
    else assert.deepEqual(result, { ok: false, reason: 'unauthorized_origin' });
  }
});

test('dev configuration authorizes both exact Planner routes but rejects other paths and origins', async () => {
  targets.configure(['prod', 'dev']);
  for (const [senderUrl, allowed] of [
    [`${prodOrigin}/planner`, true], [`${devOrigin}/planner`, true],
    [`${devOrigin}/other`, false], [`${devOrigin}/planner/test`, false], ['https://evil.example/planner', false],
  ]) {
    const session = storage(); await handoff.store(session, { token, importData: { schemaVersion: 1 }, now: 1000 });
    const result = await handoff.read(session, { token, senderUrl, now: 1001 });
    assert.equal(result.ok, allowed, senderUrl);
    if (!allowed) assert.equal(result.reason, 'unauthorized_origin');
  }
  targets.configure(['prod']);
});

test('rejects expired, mismatched, and unauthorized handoff reads without leaking data', async () => {
  targets.configure(['prod']);
  const session = storage(); await handoff.store(session, { token, importData: { secret: 'grade' }, now: 1000 });
  assert.deepEqual(await handoff.read(session, { token, senderUrl: 'https://evil.example/planner', now: 1001 }), { ok: false, reason: 'unauthorized_origin' });
  assert.equal(session.values.has(handoff.keyFor(token)), true);
  assert.deepEqual(await handoff.read(session, { token: '22222222-2222-4222-8222-222222222222', senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1001 }), { ok: false, reason: 'not_found' });
  assert.deepEqual(await handoff.read(session, { token, senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1000 + handoff.TTL_MS }), { ok: false, reason: 'expired' });
  assert.equal(session.values.has(handoff.keyFor(token)), false);
});

test('production manifest keeps only the audited production origin and never requests broad or credential permissions', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, [`${prodOrigin}/*`]);
  assert.equal(JSON.stringify(manifest).includes(devOrigin), false);
  assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false);
  for (const permission of ['cookies', 'history', 'webRequest', 'tabs']) assert.equal(manifest.permissions.includes(permission), false);
});

test('development manifest permits exactly the production and development origins with the same narrow permissions', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.dev.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, [`${prodOrigin}/*`, `${devOrigin}/*`]);
  assert.deepEqual(manifest.content_scripts[0].matches, [`${prodOrigin}/*`, `${devOrigin}/*`]);
  assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false);
  for (const permission of ['cookies', 'history', 'webRequest', 'tabs']) assert.equal(manifest.permissions.includes(permission), false);
});

test('popup retains copy and download fallbacks beside the direct handoff action', () => {
  const popup = readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
  const target = readFileSync(new URL('../planner-target.js', import.meta.url), 'utf8');
  assert.match(popup, /id="planner-actions"/); assert.match(popup, /id="copy"/); assert.match(popup, /id="download"/);
  assert.match(target, /Planner\(dev\)で確認/); assert.match(script, /planner-\$\{key\}/);
  assert.match(script, /navigator\.clipboard\.writeText/); assert.match(script, /hosei-grade-import-v1\.json/);
});
