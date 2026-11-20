import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { initialState, STORAGE_KEY, BACKUP_KEY, PLANNER_WRITE_LOCK } from '../src/planner/backup/storage.ts';
import { createPlannerBackup } from '../src/planner/backup/plannerBackup.ts';

const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE);
const dist = resolve(process.env.PLANNER_DIST);
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const file = extname(path) ? resolve(dist, '.' + path) : resolve(dist, 'index.html');
  try {
    assert.ok(file.startsWith(dist + '/'));
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLANNER_BROWSER_EXECUTABLE });
const viewport = Number(process.env.STAGE22_VIEWPORT_WIDTH || 1280);
const original = JSON.stringify(initialState(), null, 2) + '\r\n';
const target = JSON.stringify({ ...initialState(), todos: [{ id: '00000000-0000-4000-8000-000000000121', offeringId: null, text: '合成復元', done: false }] });
const input = Buffer.from(JSON.stringify(await createPlannerBackup(target, catalog)));
const recovery = '旧退避の合成原文\r\n🌱';
const primaryPath = '復元するJSONファイル';
const proofPath = '保存した保護ファイルを再選択';
const successText = '全データを置き換えて保存しました。再読み込み後も保持されます。';

async function run(name, exercise, { p = original, r = recovery } = {}) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: viewport, height: 900 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  try {
    await context.addInitScript(({ keyP, keyR, p, r }) => {
      if (!location.pathname.startsWith('/planner')) return;
      const write = Storage.prototype.setItem;
      if (localStorage.getItem('stage22-seeded') !== '1') {
        if (p !== null) write.call(localStorage, keyP, p);
        if (r !== null) write.call(localStorage, keyR, r);
        write.call(localStorage, 'stage22-seeded', '1');
      }
      window.stage22Writes = [];
      window.stage22DbMutations = [];
      for (const method of ['open', 'deleteDatabase']) {
        const original = IDBFactory.prototype[method];
        IDBFactory.prototype[method] = function (...args) {
          window.stage22DbMutations.push(method);
          return original.apply(this, args);
        };
      }
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && (key === keyP || key === keyR)) {
          window.stage22Writes.push([key, value, !window.stage22Quota]);
          if (window.stage22Quota) throw new DOMException('synthetic quota', 'QuotaExceededError');
        }
        return write.call(this, key, value);
      };
      for (const method of ['clear', 'removeItem']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (...args) {
          if (this === localStorage && (method === 'clear' || [keyP, keyR].includes(args[0]))) {
            window.stage22Writes.push([method, ...args]);
          }
          return original.apply(this, args);
        };
      }
    }, { keyP: STORAGE_KEY, keyR: BACKUP_KEY, p, r });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(origin + '/planner');
    const panel = page.getByRole('region', { name: 'プランナー全データのバックアップ・復元' });
    const checkbox = panel.getByRole('checkbox', { name: /他のタブ・画面を閉じ/ });
    const confirm = panel.getByRole('button', { name: '確認したバックアップで全件置換する' });
    const choose = (label, buffer) => panel.getByLabel(label).setInputFiles({ name: 'same-name.json', mimeType: 'application/json', buffer });
    const preview = async () => {
      await choose(primaryPath, input);
      await panel.getByRole('heading', { name: '復元対象の概要' }).waitFor();
    };
    const prepare = async () => {
      await panel.getByRole('button', { name: '復元前の保護ファイルを準備する' }).click();
      const link = panel.getByRole('link', { name: '復元前の保護ファイルをダウンロード' });
      const download = page.waitForEvent('download');
      await link.click();
      const bytes = await readFile(await (await download).path());
      const envelope = JSON.parse(bytes);
      assert.equal(envelope.primaryRaw, p);
      assert.equal(envelope.recoveryRaw, r);
      return bytes;
    };
    const verify = async () => {
      const bytes = await prepare();
      await choose(proofPath, bytes);
      await panel.getByText('再選択した保護ファイルの内容が一致しました。').waitFor();
      await checkbox.check();
      return bytes;
    };
    const snapshot = async () => page.evaluate(([P, R]) => ({
      p: localStorage.getItem(P), r: localStorage.getItem(R),
      writes: window.stage22Writes, dbMutations: window.stage22DbMutations,
    }), [STORAGE_KEY, BACKUP_KEY]);
    const expectStorage = async (wantedP, wantedR, writes = []) => {
      assert.deepEqual(await snapshot(), { p: wantedP, r: wantedR, writes, dbMutations: [] });
    };
    const holdLock = async () => {
      const holder = await context.newPage();
      await holder.goto(origin + '/');
      await holder.evaluate(lock => {
        void navigator.locks.request(lock, { mode: 'exclusive' }, () => new Promise(resolve => { window.release = resolve; }));
      }, PLANNER_WRITE_LOCK);
      await holder.waitForFunction(() => !!window.release);
      return holder;
    };
    const waitQueued = holder => holder.waitForFunction(async lock =>
      (await navigator.locks.query()).pending.some(request => request.name === lock), PLANNER_WRITE_LOCK);
    const release = holder => holder.evaluate(async lock => {
      window.release();
      await navigator.locks.request(lock, { mode: 'exclusive' }, () => {});
    }, PLANNER_WRITE_LOCK);
    await exercise({ page, panel, checkbox, confirm, choose, preview, prepare, verify, expectStorage, holdLock, waitQueued, release });
    console.log(JSON.stringify({ name, viewport, status: 'PASS' }));
  } finally {
    await context.close();
  }
}

let failures = 0;
async function check(name, fn, storage) {
  try { await run(name, fn, storage); }
  catch (error) {
    failures += 1;
    console.error(JSON.stringify({ name, viewport, status: 'FAIL', message: error.message }));
  }
}

try {
  await check('consent-only-never-writes', async ({ page, preview, checkbox, confirm, expectStorage }) => {
    await preview();
    if (await checkbox.isEnabled()) {
      await checkbox.check();
      await confirm.click();
      await page.waitForFunction(([key, raw]) => localStorage.getItem(key) === raw, [STORAGE_KEY, target]);
    }
    await expectStorage(original, recovery);
  });
  if (!process.env.STAGE22_RED_ONLY) {
    for (const r of [null, recovery]) await check(r === null ? 'restore-null-R' : 'restore-exact-R', async ({ panel, preview, verify, confirm, expectStorage }) => {
      await preview();
      await verify();
      await confirm.click();
      await panel.getByText(successText).waitFor();
      await expectStorage(target, r, [[STORAGE_KEY, target, true]]);
    }, { r });

    await check('absent-P-keeps-R-and-restores-with-consent', async ({ panel, preview, checkbox, confirm, expectStorage }) => {
      await preview();
      assert.equal(await panel.getByLabel(proofPath).count(), 0);
      await checkbox.check();
      await confirm.click();
      await panel.getByText(successText).waitFor();
      await expectStorage(target, recovery, [[STORAGE_KEY, target, true]]);
    }, { p: null });

    await check('download-alone-and-same-name-tamper-stop', async ({ panel, preview, prepare, choose, confirm, expectStorage }) => {
      await preview();
      const bytes = await prepare();
      assert.ok(await confirm.isDisabled());
      await expectStorage(original, recovery);
      const modified = Buffer.from(bytes);
      modified[modified.length - 1] ^= 1;
      await choose(proofPath, modified);
      await panel.getByText('再選択したファイルが保護ファイルと一致しません。').waitFor();
      assert.ok(await confirm.isDisabled());
      await expectStorage(original, recovery);
    });

    await check('cancel-proof-or-change-backup-invalidates-consent', async ({ panel, preview, verify, confirm, expectStorage }) => {
      await preview();
      await verify();
      await panel.getByLabel(proofPath).dispatchEvent('cancel', { bubbles: true });
      assert.ok(await confirm.isDisabled());
      await verify();
      await preview();
      assert.ok(await confirm.isDisabled());
      await expectStorage(original, recovery);
    });

    await check('duplicate-activation-does-one-write', async ({ panel, preview, verify, confirm, holdLock, waitQueued, release, expectStorage }) => {
      await preview();
      await verify();
      const holder = await holdLock();
      await confirm.evaluate(button => { button.click(); button.click(); });
      await waitQueued(holder);
      await release(holder);
      await panel.getByText(successText).waitFor();
      await expectStorage(target, recovery, [[STORAGE_KEY, target, true]]);
    });

    for (const key of [STORAGE_KEY, BACKUP_KEY]) await check(`while-lock-pending-change-${key === STORAGE_KEY ? 'P' : 'R'}`, async ({ panel, preview, verify, confirm, holdLock, waitQueued, release, expectStorage }) => {
      await preview();
      await verify();
      const holder = await holdLock();
      await confirm.click();
      await waitQueued(holder);
      const change = key === STORAGE_KEY ? target : '他画面からの退避更新';
      await holder.evaluate(([k, v]) => localStorage.setItem(k, v), [key, change]);
      await release(holder);
      await panel.getByText(/復元は反映していません/).waitFor();
      await expectStorage(key === STORAGE_KEY ? change : original, key === BACKUP_KEY ? change : recovery);
    });

    await check('unmount-while-lock-pending', async ({ page, panel, preview, verify, confirm, holdLock, waitQueued, release, expectStorage }) => {
      await preview();
      await verify();
      const holder = await holdLock();
      await confirm.click();
      await waitQueued(holder);
      await page.locator('a[href="/"]').first().click();
      await panel.waitFor({ state: 'detached' });
      await release(holder);
      await expectStorage(original, recovery);
      await page.goBack();
      await panel.waitFor();
      assert.equal(await panel.getByRole('heading', { name: '復元対象の概要' }).count(), 0);
    });

    await check('quota-failure-keeps-both-originals', async ({ page, panel, preview, verify, confirm, expectStorage }) => {
      await preview();
      await verify();
      await page.evaluate(() => { window.stage22Quota = true; });
      await confirm.click();
      await panel.getByText(/synthetic quota.*復元は反映していません/).waitFor();
      await expectStorage(original, recovery, [[STORAGE_KEY, target, false]]);
    });

    await check('unreadable-primary-stops-before-preview', async ({ panel, choose, expectStorage }) => {
      await choose(primaryPath, input);
      await panel.getByText('現在の保存データを確認できないため、全件復元できません。').waitFor();
      await expectStorage('broken-primary', recovery);
    }, { p: 'broken-primary' });
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
process.exitCode = failures ? 1 : 0;
