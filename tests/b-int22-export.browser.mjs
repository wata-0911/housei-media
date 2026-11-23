import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { serveAc } from './ac-static-server.mjs';
import { mixed } from './fixtures/migration-fixture.mjs';

const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE);
const dist = process.env.B_INT22_DIST;
const evidence = process.env.B_INT22_EVIDENCE;
const oldP = ' \n' + JSON.stringify(mixed(), null, 2) + '\r\n';
const oldR = '保護用の合成 recovery\t';
const title = 'ビジネス英語A';
const held = (page, value) => page.getByTestId('saved-display-state').filter({ hasText: value }).waitFor();
const ready = page => held(page, '読取時点の検証済み');
const panel = page => page.getByRole('region', { name: '保存済み履修計画の出力' });
const csvButton = page => panel(page).getByRole('button', { name: '保存済み履修計画をCSV出力' });
const pngButton = page => panel(page).getByRole('button', { name: '同じ履修計画をPNGで確認' });
const preview = page => panel(page).getByRole('img', { name: '照合した保存済み履修計画のプレビュー' });
const notice = (page, value) => page.getByTestId('attempt-export-message').filter({ hasText: value }).waitFor();

async function preserved(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('hosei-yi06-isolated-v1', 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const authority = await new Promise((resolve, reject) => {
      const tx = db.transaction('authority','readonly');
      const get = tx.objectStore('authority').get('current');
      tx.oncomplete = () => { db.close(); resolve(get.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
    return { authority, legacy: [localStorage.getItem('hosei-planner:v1'), localStorage.getItem('hosei-planner:v1:recovery')] };
  });
}

function parseCsv(text) {
  assert.ok(text.startsWith('\uFEFF'));
  const cell = /"((?:[^"]|"")*)"([,]|\r\n)/gy;
  cell.lastIndex = 1;
  const rows = [];
  let row = [];
  while (cell.lastIndex < text.length) {
    const match = cell.exec(text);
    assert.ok(match);
    row.push(match[1].replaceAll('""', '"'));
    if (match[2] === '\r\n') { rows.push(row); row = []; }
  }
  assert.deepEqual(row, []);
  assert.ok(rows.every(items => items.length === 11));
  return rows;
}

async function confirm(page) {
  const form = page.getByRole('group', { name: '保存確認', exact: true });
  const protectedFile = page.waitForEvent('download');
  await form.getByRole('button', { name: '変更前の原文を保護', exact: true }).click();
  await protectedFile;
  await form.getByLabel('保護ファイルと保存内容を確認しました').check();
  await form.getByRole('button', { name: '確認して保存', exact: true }).click();
  await ready(page);
}

async function save(page) {
  await page.getByRole('button', { name: /^(新規計画の保存を準備|保存内容を準備)$/ }).click();
  await confirm(page);
}

async function add(page, year, beforeSubmit) {
  await page.locator('#course-query').fill(title);
  await page.getByRole('list', { name: '制度科目の検索結果' })
    .getByRole('button', { name: 'この配置を選ぶ' }).first().click();
  const form = page.getByRole('form', { name: '履修記録の入力', exact: true });
  await form.getByLabel('予定年度（空欄は未設定）').fill(year);
  await form.getByLabel('履修方法', { exact: true }).selectOption('media');
  if (beforeSubmit) await beforeSubmit();
  await form.getByRole('button', { name: '下書きへ追加', exact: true }).click();
  await form.waitFor({ state: 'detached' });
}

async function download(page, button) {
  const waiting = page.waitForEvent('download');
  await button.click();
  const file = await waiting;
  return readFile(await file.path());
}

async function measured(page, action, locks = 1) {
  const before = await preserved(page);
  await page.evaluate(() => { window.b22.length = 0; });
  await action();
  assert.deepEqual(await preserved(page), before);
  const result = await page.evaluate(() => window.b22);
  assert.deepEqual(result, Array.from({ length: locks }, () => 'lock:exclusive:hosei-planner:v1:write'));
}

async function metrics(page, bytes) {
  return page.evaluate(async base64 => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 150 && data[i+1] < 150 && data[i+2] < 150 && data[i+3] > 200) ink++;
    return { width: image.width, height: image.height, ink };
  }, bytes.toString('base64'));
}

for (const width of [390, 1280]) for (const schema of [24, 23]) {
  test(`B22 schema${schema} Chromium ${width}px`, { timeout: 260000 }, async () => {
    const server = await serveAc(dist);
    let browser;
    try {
      browser = await chromium.launch({ executablePath: process.env.PLANNER_BROWSER_EXECUTABLE, headless: true,
        args: ['--disable-background-networking','--disable-quic','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
          '--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1'] });
      const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
      const external = [], errors = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === server.origin) return route.continue();
        external.push(url.origin); return route.abort();
      });
      await context.addInitScript(() => {
        window.b22 = []; window.b22Rows = [];
        for (const [prototype, methods] of [
          [Storage.prototype, ['setItem','removeItem','clear']],
          [IDBObjectStore.prototype, ['put','add','delete','clear']],
        ]) for (const method of methods) {
          const original = prototype[method];
          prototype[method] = function (...args) { window.b22.push('write:' + method); return original.apply(this, args); };
        }
        const tx = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (...args) {
          if (args[1] === 'readwrite') window.b22.push('write:transaction');
          return tx.apply(this, args);
        };
        const request = LockManager.prototype.request;
        LockManager.prototype.request = function (name, options, fn) {
          window.b22.push('lock:' + options.mode + ':' + name);
          if (window.b22DenyLock) return Promise.reject(new DOMException('synthetic lock denied','NotAllowedError'));
          return request.call(this, name, options, fn);
        };
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = async function () {
          await decode.call(this);
          if (window.b22HoldSvg && this.src.startsWith('data:image/svg+xml')) {
            await new Promise(resolve => { window.b22ReleaseSvg = resolve; });
          }
        };
        const toData = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (...args) {
          if (window.b22InvalidPng) return 'data:,';
          return toData.apply(this, args);
        };
        const readFile = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = async function () {
          if (this.name === 'same-backup.json') {
            await new Promise(resolve => { window.b22ReleaseRestore = resolve; });
          }
          return readFile.call(this);
        };
        new MutationObserver(() => {
          const rows = document.querySelectorAll('[data-export-row]');
          if (rows.length) {
            window.b22Columns = [...rows[0].querySelectorAll('dt')].map(cell => cell.textContent.trim());
            window.b22Rows = [...rows].map(row => [...row.querySelectorAll('[data-export-value]')].map(cell => cell.textContent));
          }
        }).observe(document, { childList: true, subtree: true });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(server.origin + '/__dev/ac');
      await page.getByTestId('save-status').filter({ hasText:'新規計画を開始できます' }).waitFor();
      assert.equal(await csvButton(page).isDisabled(), true);
      if (schema === 23) {
        await page.evaluate(([p,r]) => { localStorage.setItem('hosei-planner:v1', p); localStorage.setItem('hosei-planner:v1:recovery', r); }, [oldP,oldR]);
        await page.getByRole('button', { name: '保存内容を再読込', exact: true }).click();
        await page.getByTestId('save-status').filter({ hasText:'旧schema22があります' }).waitFor();
        await page.getByLabel('旧schema22原文から明示移行').setInputFiles({ name:'legacy.json', mimeType:'application/json', buffer:Buffer.from(oldP) });
        await confirm(page);
      } else {
        await save(page);
        if (width === 390) {
          let empty;
          await measured(page, async () => {
            empty = parseCsv((await download(page, csvButton(page))).toString('utf8')).slice(1);
            assert.equal(empty.length, 1);
            assert.equal(JSON.parse(empty[0][10]).totalRows, 0);
          });
          await measured(page, async () => {
            await pngButton(page).click();
            await preview(page).waitFor();
            assert.deepEqual(await page.evaluate(() => window.b22Rows), empty);
          });
        }
        await add(page, '2027', async () => assert.equal(await csvButton(page).isDisabled(), true));
        assert.equal(await csvButton(page).isDisabled(), true);
        await add(page, '');
        const first = page.locator('[data-attempt-id]').first();
        const media = first.getByRole('form', { name: /メディア進捗$/ });
        await media.getByLabel('全回数（空欄は未確認）').fill('0');
        await media.getByRole('button', { name: '進捗を下書きに反映' }).click();
        await first.getByRole('button', { name: '計画から削除', exact: true }).click();
        assert.equal(await csvButton(page).isDisabled(), true);
        await save(page);
      }
      const baseline = await preserved(page);
      const workbook = JSON.parse(baseline.authority.raw);
      assert.equal(workbook.schemaVersion, schema);
      assert.deepEqual(baseline.legacy, schema===23 ? [oldP,oldR] : [null,null]);
      let csvBytes, columns, rows, pngBytes, previewBytes;
      await measured(page, async () => {
        csvBytes = await download(page, csvButton(page));
        [columns, ...rows] = parseCsv(csvBytes.toString('utf8'));
        assert.equal(columns[5], '計画状態／本人記録の種類');
      });
      const only = category => rows.filter(row => row[0] === category);
      const metadata = JSON.parse(rows[0][10]);
      assert.equal(metadata.graphSha256, workbook.verification.graphSha256);
      assert.equal(metadata.totalRows, rows.length - 1);
      assert.equal(only('履修回').length, workbook.graph.attempts.length);
      assert.deepEqual(only('履修回').map(row => row[2]), workbook.graph.attempts.map(row => row.id));
      assert.deepEqual(only('履修回').map(row => JSON.parse(row[10])), workbook.graph.attempts);
      const owned = rows.filter(row => row[0].startsWith('本人記録')).map(row => {
        const { payload, owner } = JSON.parse(row[10]);
        return { id: row[1], kind: row[5], payload, owner };
      });
      assert.deepEqual(owned, workbook.graph.ownedRecords);
      assert.equal(only('旧公式原行・対応未照合').length, workbook.retained.importedCourseAchievements.length);
      assert.ok(only('旧公式原行・対応未照合').every(row => row[2] === ''));
      if (schema===24) {
        assert.deepEqual(only('履修回').map(row => row[3]), [title,title]);
        assert.deepEqual(only('履修回').map(row => row[4]), ['2027','未設定']);
        assert.match(only('履修回')[0][6], /削除/);
        assert.ok(rows.some(row => row[0]==='本人記録' && JSON.parse(row[10]).payload.totalLessons===0));
      } else {
        assert.ok(rows.some(row => row[0] === '本人記録・所有者なし'));
        assert.ok(only('履修回').some(row => row[8]!=='confirmed'));
      }
      await measured(page, async () => {
        await pngButton(page).click();
        await preview(page).waitFor();
        assert.deepEqual(await page.evaluate(() => window.b22Columns), columns);
        assert.deepEqual(await page.evaluate(() => window.b22Rows), rows);
        const url = await preview(page).getAttribute('src');
        assert.ok(url.startsWith('data:image/png;base64,'));
        previewBytes = Buffer.from(url.split(',')[1], 'base64');
      });
      await measured(page, async () => {
        pngBytes = await download(page, panel(page).getByRole('button', { name: '確認したPNGを保存' }));
        await notice(page,'PNG をダウンロード');
      });
      assert.deepEqual(pngBytes, previewBytes);
      const pixels = await metrics(page, pngBytes);
      assert.ok(pixels.width > 900 && pixels.height > 100 && pixels.ink > 100);
      if (evidence) {
        await mkdir(evidence, { recursive:true });
        await writeFile(join(evidence, `schema${schema}-${width}.csv`), csvBytes);
        await writeFile(join(evidence, `schema${schema}-${width}.png`), pngBytes);
      }
      assert.deepEqual(await preserved(page), baseline);
      if (width===390 && schema===24) {
        const backup = await download(page, page.getByRole('button', { name:'可搬バックアップをダウンロード' }));
        await page.getByLabel('可搬バックアップから復元').setInputFiles({ name:'same-backup.json', mimeType:'application/json', buffer:backup });
        const proposal = page.getByRole('group', { name:'保存確認', exact:true });
        await page.waitForFunction(() => typeof window.b22ReleaseRestore === 'function');
        assert.equal(await csvButton(page).isDisabled(), true);
        assert.equal(await proposal.count(), 0);
        await page.evaluate(() => window.b22ReleaseRestore());
        await proposal.waitFor();
        assert.equal(await csvButton(page).isDisabled(), true);
        await proposal.getByRole('button', {name:'保存確認を取り消す'}).click();
        await measured(page, async () => {
          await page.evaluate(() => { window.b22InvalidPng=true; });
          await pngButton(page).click();
          await notice(page,'画像が大きい場合');
          assert.equal(await preview(page).count(),0);
          await page.evaluate(() => { window.b22InvalidPng=false; });
        });
        const other = await context.newPage();
        await other.goto(server.origin + '/__dev/ac');
        await ready(other);
        await add(other, '2029');
        await page.evaluate(() => { window.b22HoldSvg=true; window.b22.length=0; });
        await pngButton(page).click();
        await page.waitForFunction(() => typeof window.b22ReleaseSvg==='function');
        await save(other);
        await held(page, '保留');
        const winner = await preserved(page);
        await page.evaluate(() => { window.b22HoldSvg=false; window.b22ReleaseSvg(); });
        await notice(page,'出力を保留');
        assert.equal(await preview(page).count(),0);
        assert.equal(await csvButton(page).isDisabled(),true);
        assert.deepEqual(await preserved(page),winner);
        assert.deepEqual(await page.evaluate(() => window.b22),['lock:exclusive:hosei-planner:v1:write']);
        await other.close();
        await page.getByRole('button', { name:'保存内容を再読込', exact:true }).click();
        await ready(page);
        await measured(page, async () => {
          await page.evaluate(() => { window.b22DenyLock=true; });
          await csvButton(page).click();
          await notice(page, '出力を保留');
          assert.equal(await csvButton(page).isDisabled(),true);
        });
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      console.log(JSON.stringify({ width,schema,rows:rows.length-1,pixels,csvSha256:createHash('sha256').update(csvBytes).digest('hex'),
        pngSha256:createHash('sha256').update(pngBytes).digest('hex'),external,oneExclusiveLockPerOutput:true,
        unchangedAuthorityAndLegacyDuringOutput:true }));
      await context.close();
    } finally {
      await browser?.close();
      await server.close();
    }
  });
}
