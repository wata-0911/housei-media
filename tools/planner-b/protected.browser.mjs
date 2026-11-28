import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { startLocalGate } from './local-gate.mjs';
import { pins, sha256 } from './materialize.mjs';

const { B72_DIST, B72_ROOT, B72_EVIDENCE, B72_OLD_COLD_DIST, PLANNER_PLAYWRIGHT_MODULE, PLANNER_BROWSER_EXECUTABLE } = process.env;
assert(B72_DIST && B72_ROOT && B72_EVIDENCE && B72_OLD_COLD_DIST && PLANNER_PLAYWRIGHT_MODULE);
const { chromium } = await import(PLANNER_PLAYWRIGHT_MODULE);
const { oldT4, scope } = await import(pathToFileURL(join(B72_ROOT, 'tests/fixtures/b-int55-recorded.mjs')));
const { dated, gradeFile } = await import(pathToFileURL(join(B72_ROOT, 'tests/fixtures/b-int44-grade.mjs')));
const former = 'http://127.0.0.1:4177', oldCold = 'http://127.0.0.1:4180';
const saved = page => page.getByTestId('saved-display-state').filter({ hasText: '読取時点の検証済み' });
const notice = page => page.getByTestId('save-status');
const confirmGroup = page => page.getByRole('group', { name: '保存確認', exact: true });
const upload = bytes => ({ name: 'synthetic-b72.json', mimeType: 'application/json', buffer: Buffer.from(bytes) });
const count = page => page.evaluate(() => window.b72.puts);

async function testFixtureServer(port, dist) {
  const server = createServer(async (req, res) => {
    if (req.headers.host !== '127.0.0.1:' + port || req.method !== 'GET') return res.writeHead(404).end();
    if (!dist && req.url === '/fixture') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>A synthetic storage origin</title>');
    const file = req.url === '/planner' ? 'index.html' : req.url.slice(1);
    if (!dist || !/^(index\.html|assets\/[\w.-]+)$/.test(file)) return res.writeHead(404).end();
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)];
    try {
      if (!type) return res.writeHead(404).end();
      const data = await readFile(join(dist, file));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return () => new Promise(resolve => server.close(resolve));
}

function authority(page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(db => db.name === 'hosei-yi06-isolated-v1')) return null;
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('hosei-yi06-isolated-v1', 1);
      open.onupgradeneeded = () => open.transaction.abort();
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('authority'), read = tx.objectStore('authority').get('current');
        tx.oncomplete = () => { db.close(); resolve(read.result ?? null); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  });
}

async function download(page, button) {
  const pending = page.waitForEvent('download');
  await button.click();
  return readFile(await (await pending).path());
}
const backup = page => download(page, page.getByRole('button', { name: '可搬バックアップをダウンロード' }));

async function commit(page, prepare) {
  const previous = await authority(page), previousPuts = await count(page);
  await prepare();
  const group = confirmGroup(page);
  await group.waitFor();
  assert.deepEqual(await authority(page), previous);
  const protect = group.getByRole('button', { name: '変更前の原文を保護', exact: true });
  if (await protect.count()) await download(page, protect);
  await group.getByLabel('保護ファイルと保存内容を確認しました').check();
  const adoption = group.getByLabel(/このバックアップを復元元として採用|この保護用 v4 を確認し/);
  if (await adoption.count()) await adoption.check();
  await group.getByRole('button', { name: '確認して保存', exact: true }).click();
  await notice(page).filter({ hasText: '保存済み（正式保存が完了しました）' }).waitFor();
  await saved(page).waitFor();
  const next = await authority(page);
  assert.equal(next.revision, (previous?.revision ?? 0) + 1);
  assert.equal(await count(page), previousPuts + 1);
  if (previous) {
    assert.deepEqual(next.committed.slice(0, previous.committed.length), previous.committed);
    assert.deepEqual(next.issuedIds.slice(0, previous.issuedIds.length), previous.issuedIds);
  }
  return next;
}

test('B19 loopback profile with the fixed split build', { timeout: 680000 }, async suite => {
  await mkdir(B72_EVIDENCE, { recursive: true });
  const password = randomBytes(32).toString('hex');
  const gate = await startLocalGate({ dist: B72_DIST, enabled: true, password });
  const stops = [gate.close];
  let browser;
  try {
    stops.push(await testFixtureServer(4177), await testFixtureServer(4180, B72_OLD_COLD_DIST));
    browser = await chromium.launch({ executablePath: PLANNER_BROWSER_EXECUTABLE, headless: true,
      args: ['--disable-background-networking', '--disable-quic', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1'] });
    for (const width of [390, 1280]) await suite.test(String(width), async () => {
      const viewport = { width, height: 950 };
      const unauthenticated = await browser.newContext({ viewport, serviceWorkers: 'block' });
      try {
        const page = await unauthenticated.newPage();
        const requests = [];
        page.on('request', request => requests.push(new URL(request.url()).pathname));
        let response;
        try {
          response = await page.goto(gate.origin + '/planner', { timeout: 15000 });
        } catch (error) {
          assert.match(error.message, /ERR_INVALID_AUTH_CREDENTIALS|ERR_ABORTED/);
        }
        if (response) assert.equal(response.status(), 401);
        assert.equal(await page.getByRole('heading', { name: '年度非依存の履修計画' }).count(), 0);
        assert.deepEqual(requests, ['/planner']);
        for (const path of ['/planner', '/planner/deep', ...Object.keys(pins.assets).filter(name => name !== 'index.html').map(name => '/' + name)]) {
          const denied = await unauthenticated.request.get(gate.origin + path);
          assert.equal(denied.status(), 401);
          assert.equal((await denied.body()).length, 0);
        }
      } finally { await unauthenticated.close(); }

      const context = await browser.newContext({ viewport, acceptDownloads: true, serviceWorkers: 'block',
        httpCredentials: { username: 'b72', password, origin: gate.origin } });
      let legacyRequests = 0;
      const external = [], pageErrors = [];
      try {
        context.setDefaultTimeout(55000);
        await context.route('**/*', route => {
          const origin = new URL(route.request().url()).origin;
          if (origin === former) legacyRequests++;
          if ([former, oldCold, gate.origin].includes(origin)) return route.continue();
          external.push(origin);
          return route.abort();
        });
        context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
        await context.addInitScript(() => {
          window.b72 = { puts: 0, keysRead: [], keysWritten: [], opened: [] };
          const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
          Storage.prototype.getItem = function(key) { window.b72.keysRead.push(key); return get.call(this, key); };
          Storage.prototype.setItem = function(key, value) { window.b72.keysWritten.push(key); return set.call(this, key, value); };
          const open = IDBFactory.prototype.open;
          IDBFactory.prototype.open = function(name, ...args) {
            window.b72.opened.push(name);
            return open.call(this, name, ...args);
          };
          const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (...args) {
            if (this.name === 'authority') window.b72.puts++;
            return put.apply(this, args);
          };
        });
        const synthetic = '\n' + JSON.stringify(oldT4()) + '\r\n';
        const originalA = {
          'hosei-planner:v1': synthetic,
          'hosei-planner:v1:recovery': 'B72 合成の退避原文\r\n',
          'hosei-planner:2026:authority:v2': 'B72 合成のA正本',
        };
        const parent = await context.newPage();
        await parent.goto(former + '/fixture');
        await parent.evaluate(keys => {
          for (const [key, value] of Object.entries(keys)) localStorage.setItem(key, value);
          window.b72.keysWritten.length = 0;
        }, originalA);
        const aRequestCount = legacyRequests;

        const page = await context.newPage();
        const home = await page.goto(gate.origin + '/planner');
        assert.equal(home.status(), 200);
        assert.match(home.headers()['cache-control'], /no-store/);
        await notice(page).filter({ hasText: '新規計画を開始できます' }).waitFor();
        assert.equal(await authority(page), null);
        assert.equal(await count(page), 0);
        await commit(page, () => page.getByLabel('旧schema22原文から明示移行').setInputFiles(upload(synthetic)));
        const version25 = await commit(page, () => page.getByRole('button', { name: '保存正本を schema25 へ昇格' }).click());
        const v4 = await backup(page);
        assert.equal(JSON.parse(v4).raw, version25.raw);
        assert.equal(JSON.parse(JSON.parse(version25.raw).anchor.raw).source.raw, synthetic);

        const old = await context.newPage();
        await old.goto(oldCold + '/planner');
        assert.equal(await authority(old), null);
        const v4Restored = await commit(old, () => old.getByLabel('可搬バックアップから復元').setInputFiles(upload(v4)));
        assert.equal(v4Restored.raw, version25.raw);
        assert.deepEqual(v4Restored.issuedIds, version25.issuedIds);
        console.log(width, 'separate old writer v4 restoration verified');
        await old.close();

        const publicPlan = page.getByRole('region', { name: '公開科目の本人記録' });
        const version26 = await commit(page, () => publicPlan.getByLabel('昇格のため保護用 v4 を選択').setInputFiles(upload(v4)));
        assert.deepEqual(JSON.parse(version26.raw).anchor, version25);
        await page.getByLabel('計算に仮定する教育課程').selectOption(scope);
        await page.getByRole('button', { name: '保存済み記録で条件付き計算' }).click();
        const calculation = page.getByTestId('recorded-calculation');
        await calculation.waitFor();
        assert.match(await calculation.locator('[data-recorded-course-id]').innerText(), /算入 4 \/ 完成構成単位 4 \/ スクーリング 0/);

        const title = '民法総則';
        const beforeIds = await page.locator('[data-attempt-id]').evaluateAll(rows => rows.map(row => row.dataset.attemptId));
        await page.locator('#course-query').fill(title);
        const plan = page.getByRole('form', { name: '履修記録の入力', exact: true });
        await page.getByRole('list', { name: '制度科目の検索結果' }).getByRole('listitem')
          .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
          .getByRole('button', { name: 'この配置を選ぶ', exact: true }).click();
        await plan.getByLabel('予定年度（空欄は未設定）').fill('2027');
        await plan.getByLabel('履修方法', { exact: true }).selectOption('correspondence');
        await plan.getByLabel('進捗', { exact: true }).selectOption('in_progress');
        await plan.getByRole('button', { name: '下書きへ追加', exact: true }).click();
        await plan.waitFor({ state: 'hidden' });
        const afterIds = await page.locator('[data-attempt-id]').evaluateAll(rows => rows.map(row => row.dataset.attemptId));
        const minted = afterIds.filter(id => !beforeIds.includes(id));
        assert.equal(minted.length, 1);
        const [id] = minted;
        const attempt = page.locator('[data-attempt-id="' + id + '"]');
        const progress = attempt.getByRole('form', { name: /の通信進捗$/ });
        await progress.getByLabel('追加する提出回').fill('1');
        await progress.getByRole('group', { name: '提出回を追加' }).getByLabel('提出状況').selectOption('submitted');
        await progress.getByRole('button', { name: '進捗を下書きに反映', exact: true }).click();
        await commit(page, () => page.getByRole('button', { name: '保存内容を準備', exact: true }).click());
        console.log(width, 'authorized calculation, search and learner commit verified');

        await publicPlan.getByText('公開科目を追加', { exact: true }).click();
        const form = publicPlan.getByRole('form', { name: '公開科目を新規登録' });
        await form.getByLabel('科目名').fill('B72 合成公開科目');
        await form.getByLabel('予定年度').fill('2028');
        const submit = () => form.getByRole('button', { name: '新規公開科目を確認' }).click();
        const unmodified = await authority(page), cancelBefore = await count(page);
        await submit();
        await confirmGroup(page).getByRole('button', { name: '保存確認を取り消す' }).click();
        assert.deepEqual(await authority(page), unmodified);
        assert.equal(await count(page), cancelBefore);
        const current = await commit(page, submit);
        console.log(width, 'public course cancel and commit verified');

        const held = dated('B72 合成保留', 2028, 2);
        held.earnedCredits.value = 4;
        const beforeReads = await count(page);
        await page.getByLabel('成績訂正・差分確認', { exact: true }).setInputFiles(upload(gradeFile(held)));
        await page.getByRole('status').filter({ hasText: 'このファイル全体を反映できません' }).waitFor();
        assert.equal(await confirmGroup(page).getByRole('button', { name: '確認して保存' }).count(), 0);
        await confirmGroup(page).getByRole('button', { name: '差分確認を閉じる', exact: true }).click();
        const csv = await download(page, page.getByRole('button', { name: '保存済み履修計画をCSV出力' }));
        assert.match(csv.toString('utf8'), /B72 合成公開科目/);
        await page.getByRole('button', { name: '同じ履修計画をPNGで確認' }).click();
        await page.getByAltText('照合した保存済み履修計画のプレビュー').waitFor();
        const png = await download(page, page.getByRole('button', { name: '確認したPNGを保存' }));
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        const readsAndExportsPuts = (await count(page)) - beforeReads;
        assert.equal(readsAndExportsPuts, 0);
        assert.deepEqual(await authority(page), current);
        await page.reload();
        await saved(page).waitFor();
        assert.equal(await count(page), 0);
        assert.deepEqual(await authority(page), current);
        assert.equal(await progress.getByRole('group', { name: 'リポート 1' }).getByLabel('提出状況').inputValue(), 'submitted');

        const bBoundary = await page.evaluate(() => window.b72);
        assert.ok(!bBoundary.keysRead.includes('hosei-planner:2026:authority:v2'));
        assert.ok(!bBoundary.keysWritten.some(key => key.startsWith('hosei-planner:')));
        assert.ok(bBoundary.opened.every(name => name === 'hosei-yi06-isolated-v1'));
        const aBoundary = await parent.evaluate(keys => {
          const counts = { ...window.b72, keysRead: [...window.b72.keysRead], keysWritten: [...window.b72.keysWritten] };
          const storage = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
          return { counts, storage };
        }, Object.keys(originalA));
        assert.deepEqual(aBoundary.storage, originalA);
        assert.deepEqual(aBoundary.counts.keysRead, []);
        assert.deepEqual(aBoundary.counts.keysWritten, []);
        assert.deepEqual(aBoundary.counts.opened, []);
        assert.equal(legacyRequests, aRequestCount);
        assert.deepEqual(external, []);
        assert.deepEqual(pageErrors, []);
        await page.screenshot({ path: join(B72_EVIDENCE, width + '.png') });
        await writeFile(join(B72_EVIDENCE, width + '.json'), JSON.stringify({
          width, browser: browser.version(), allowedStatus: home.status(), deniedNavigation: true,
          revisions: [version25.revision, version26.revision, current.revision], oldColdOrigin: oldCold,
          v4ColdRestoredRawAndReservations: true, v4ColdPuts: 1,
          finalRawSha256: sha256(current.raw), v4Sha256: sha256(v4), csvSha256: sha256(csv), pngSha256: sha256(png),
          readsAndExportsPuts, cancelPuts: 0, reloadPuts: 0, formerOriginReadsAndWrites: 0,
          formerNetworkRequestsAfterSetup: legacyRequests - aRequestCount, bBoundary, external, pageErrors,
        }, null, 2) + '\n');
      } finally { await context.close(); }
    });
  } finally {
    await browser?.close();
    for (const stop of stops.reverse()) await stop();
  }
});
