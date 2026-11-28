import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startLocalGate } from './local-gate.mjs';
import { pins, sha256 } from './materialize.mjs';

const { NATIVE_DIST, NATIVE_COLD_DIST, NATIVE_B78_DIST, NATIVE_PROTECTED_EVIDENCE,
  PLANNER_PLAYWRIGHT_MODULE, PLANNER_BROWSER_EXECUTABLE } = process.env;
assert(NATIVE_DIST && NATIVE_COLD_DIST && NATIVE_B78_DIST && NATIVE_PROTECTED_EVIDENCE && PLANNER_PLAYWRIGHT_MODULE);
const { chromium } = await import(PLANNER_PLAYWRIGHT_MODULE);
const password = randomBytes(32).toString('hex');
const authorization = 'Basic ' + Buffer.from('b72:' + password).toString('base64');
const proxyOrigin = 'http://127.0.0.1:4177';
const button = (host, name) => host.getByRole('button', { name, exact: true });
const confirmation = page => page.getByRole('group', { name: '保存確認', exact: true });

function readHttp(gate, path, method, credentials, host) {
  const url = new URL(path, gate.origin);
  const headers = { ...(credentials ? { authorization } : {}), ...(host ? { host } : {}) };
  return new Promise((resolve, reject) => {
    const call = request(url, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    call.on('error', reject).end();
  });
}

test('B83 gate denies access by default and only serves the exact native split and cold assets', async () => {
  const out = [];
  await mkdir(NATIVE_PROTECTED_EVIDENCE, { recursive: true });
  for (const [variant, dist, assets] of [
    ['b-native-split', NATIVE_DIST, pins.bNativeBuilds.split], ['b-native-cold', NATIVE_COLD_DIST, pins.bNativeBuilds.cold],
  ]) {
    const gate = await startLocalGate({ variant, dist, enabled: true, port: 0, password });
    const off = await startLocalGate({ variant, port: 0 });
    const paths = ['/', '/planner', '/planner/', '/planner/other', ...Object.keys(assets).map(path => '/' + path)];
    try {
      let denied = 0;
      for (const path of paths) for (const method of ['GET', 'HEAD']) {
        for (const [endpoint, expected] of [[off, 403], [gate, 401]]) {
          const response = await readHttp(endpoint, path, method, endpoint === off);
          assert.equal(response.status, expected);
          assert.equal(response.data.length, 0);
          assert.match(response.headers['cache-control'], /no-store/);
          denied++;
        }
      }
      assert.equal((await readHttp(gate, '/planner', 'GET', true, 'localhost')).status, 421);
      assert.equal((await readHttp(gate, '/planner', 'POST', true)).status, 405);
      assert.equal((await readHttp(gate, '/planner/other', 'GET', true)).status, 404);
      for (const [path, pin] of Object.entries(assets)) {
        const get = await readHttp(gate, '/' + path, 'GET', true);
        const head = await readHttp(gate, '/' + path, 'HEAD', true);
        assert.equal(get.status, 200);
        assert.equal(get.data.length, pin.bytes);
        assert.equal(sha256(get.data), pin.sha256);
        assert.equal(head.status, 200);
        assert.equal(head.data.length, 0);
        assert.equal(Number(head.headers['content-length']), pin.bytes);
        assert.equal(get.headers['content-security-policy'], "frame-ancestors 'none'; base-uri 'none'");
      }
      out.push({ variant, verifiedAssets: Object.keys(assets).length, denied });
    } finally { await gate.close(); await off.close(); }
  }
  await assert.rejects(startLocalGate({ variant: 'unknown', port: 0 }), /unknown protected distribution variant/);
  await assert.rejects(startLocalGate({ variant: 'b-native-split', dist: NATIVE_B78_DIST, port: 0, enabled: true, password }), /build asset/);
  const fixture = await mkdtemp(join(tmpdir(), 'gate-native-'));
  try {
    const dist = join(fixture, 'dist');
    await cp(NATIVE_DIST, dist, {recursive:true});
    const file = join(dist, 'index.html');
    const body = await readFile(file);
    await rm(file);
    const options = { variant: 'b-native-split', dist, port: 0, enabled: true, password };
    await assert.rejects(startLocalGate(options), /build asset path mismatch/);
    await writeFile(file, 'synthetic diagnostic');
    await assert.rejects(startLocalGate(options), /build asset mismatch/);
    await writeFile(file, body);
    await writeFile(join(dist, 'extra.txt'), 'synthetic diagnostic');
    await assert.rejects(startLocalGate(options), /build asset path mismatch/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
  await writeFile(join(NATIVE_PROTECTED_EVIDENCE, 'asset-verification.json'), JSON.stringify(out, null, 2) + '\n');
});

async function download(page, trigger) {
  const pending = page.waitForEvent('download');
  await trigger.click();
  return readFile(await (await pending).path());
}
function authority(page) {
  return page.evaluate(async () => {
    const name = 'hosei-yi06-isolated-v1';
    if (!(await indexedDB.databases()).some(database => database.name === name)) return null;
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => open.transaction.abort();
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('authority');
        const result = tx.objectStore('authority').get('current');
        tx.oncomplete = () => { db.close(); resolve(result.result); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  });
}
const puts = page => page.evaluate(() => window.nativeGateObservation.puts);
async function save(page, action, restoring = false) {
  const before = await authority(page), beforePuts = await puts(page);
  await action();
  const group = confirmation(page);
  await group.waitFor();
  await group.getByLabel('保護ファイルと保存内容を確認しました').waitFor();
  assert.deepEqual(await authority(page), before);
  assert.equal(await puts(page), beforePuts);
  const protect = button(group, '変更前の原文を保護');
  if (await protect.count()) await download(page, protect);
  await group.getByLabel('保護ファイルと保存内容を確認しました').check();
  if (restoring) await group.getByLabel('このバックアップを復元元として採用します').check();
  await button(group, '確認して保存').click();
  await page.getByTestId('save-status').filter({hasText:'保存済み（正式保存が完了しました）'}).waitFor();
  const after = await authority(page);
  assert.equal(after.revision, (before?.revision ?? 0) + 1);
  assert.deepEqual(after.issuedIds.slice(0, before?.issuedIds.length ?? 0), before?.issuedIds ?? []);
  assert.equal(await puts(page), beforePuts + 1);
  return after;
}
test('B83 protected native start, independent media, TODO and cold v7 restore', { timeout: 180000 }, async t => {
  await mkdir(NATIVE_PROTECTED_EVIDENCE, { recursive: true });
  const primary = await startLocalGate({ port:4178, variant:'b-native-split', dist:NATIVE_DIST, enabled:true, password });
  t.after(primary.close);
  const cold = await startLocalGate({ port:4179, variant:'b-native-cold', dist:NATIVE_COLD_DIST, enabled:true, password });
  t.after(cold.close);
  const proxy = createServer((_req, response) => {
    response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    response.end('<title>合成 A origin</title>');
  });
  await new Promise((resolve,reject) => proxy.once('error',reject).listen(4177,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const browser = await chromium.launch({ executablePath:PLANNER_BROWSER_EXECUTABLE, headless:true,
    args:['--disable-background-networking','--disable-quic'] });
  t.after(() => browser.close());
  for (const width of [390,1280]) await t.test(String(width), async () => {
    const external = [], errors = [];
    const context = await browser.newContext({ viewport:{ width, height:920 }, acceptDownloads:true, serviceWorkers:'block',
      httpCredentials:{username:'b72',password} });
    try {
      await context.addInitScript(() => {
        window.nativeGateObservation = { opens:0, puts:0, storage:0 };
        for (const [object, method, key] of [
          [IDBFactory.prototype,'open','opens'], [IDBObjectStore.prototype,'put','puts'],
          [Storage.prototype,'setItem','storage'], [Storage.prototype,'removeItem','storage'], [Storage.prototype,'clear','storage'],
        ]) {
          const original = object[method];
          object[method] = function (...args) { window.nativeGateObservation[key]++; return original.apply(this,args); };
        }
      });
      const a = await context.newPage();
      await a.goto(proxyOrigin + '/fixture');
      const aState = () => a.evaluate(async () => ({ ...window.nativeGateObservation, keys:Object.keys(localStorage), dbs:await indexedDB.databases() }));
      const beforeA = await aState();
      assert.deepEqual(beforeA, { opens:0, puts:0, storage:0, keys:[], dbs:[] });
      await context.route('**/*', route => {
        const origin = new URL(route.request().url()).origin;
        if ([primary.origin,cold.origin].includes(origin)) return route.continue();
        external.push(origin);
        return route.abort();
      });
      async function pageAt(gate) {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(gate.origin + '/planner');
        await button(page,'A バックアップなしで B を開始').waitFor();
        return page;
      }
      const page = await pageAt(primary);
      assert.equal(await authority(page),null);
      await save(page, () => button(page,'A バックアップなしで B を開始').click());
      const media = page.getByRole('form',{name:'独立メディアを登録',exact:true});
      const search = media.getByLabel('制度資料の科目を検索');
      const course = media.getByLabel('参照する科目');
      const csvButton = button(page,'保存済み履修計画をCSV出力');
      const backup = button(page,'可搬バックアップをダウンロード');
      const unsent = page.getByText('送信していない入力があります。',{exact:false});
      const beforeSelection = await authority(page);
      await search.fill('民法');
      await course.selectOption({label:'民法総則'});
      await unsent.waitFor();
      assert.equal(await csvButton.isDisabled(),true);
      assert.equal(await backup.isDisabled(),true);
      await search.fill('');
      await unsent.waitFor({state:'hidden'});
      assert.equal(await course.inputValue(),'');
      assert.equal(await csvButton.isEnabled(),true);
      assert.equal(await backup.isEnabled(),true);
      const todoForm = page.getByRole('form',{name:'TODOを追加',exact:true});
      await todoForm.getByLabel('新しいTODO',{exact:true}).fill('検索選択の解除後に確認できる');
      await button(todoForm,'TODO の追加を確認').click();
      await confirmation(page).waitFor();
      await button(confirmation(page),'保存確認を取り消す').click();
      await confirmation(page).waitFor({state:'hidden'});
      await button(todoForm,'入力を戻す').click();
      assert.deepEqual(await authority(page),beforeSelection);
      assert.equal(await puts(page),1);
      await media.getByLabel('本人入力名').fill('合成の独立メディア');
      await save(page, () => button(media,'独立メディアの登録を確認').click());
      const todo = page.getByLabel('新しいTODO',{exact:true});
      await todo.fill('合成の確認\n二行');
      const state = await save(page, () => button(page,'TODO の追加を確認').click());
      assert.equal(await puts(page),3);
      assert.equal(JSON.parse(state.raw).schemaVersion,28);
      assert.equal(await button(page,'A の移行元ファイルをダウンロード').count(),0);
      const portable = await download(page,button(page,'可搬バックアップをダウンロード'));
      assert.equal(JSON.parse(portable).backupVersion,7);
      const csv = await download(page,button(page,'保存済み履修計画をCSV出力'));
      assert.equal(await puts(page),3);
      const other = await pageAt(cold);
      const restored = await save(other, () => other.getByLabel('可搬バックアップから復元').setInputFiles({
        name:'synthetic-native-v7.json',mimeType:'application/json',buffer:portable,
      }),true);
      assert.equal(restored.raw,state.raw);
      assert.deepEqual(restored.issuedIds,state.issuedIds);
      assert.deepEqual(await download(other,button(other,'保存済み履修計画をCSV出力')),csv);
      assert.equal(await puts(other),1);
      assert.deepEqual(await aState(),beforeA);
      assert.deepEqual(external,[]);
      assert.deepEqual(errors,[]);
      await writeFile(join(NATIVE_PROTECTED_EVIDENCE,width+'-protected.csv'),csv);
      await writeFile(join(NATIVE_PROTECTED_EVIDENCE,width+'-protected.json'),JSON.stringify({
        width, primary:state, cold:restored, primaryPuts:3, coldPuts:1, a:beforeA, external, errors,
        portable:{bytes:portable.length,sha256:sha256(portable)},
      },null,2)+'\n');
    } finally { await context.close(); }
  });
});
