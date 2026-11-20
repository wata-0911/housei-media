import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { initialState, STORAGE_KEY, BACKUP_KEY, PLANNER_WRITE_LOCK } from '../src/planner/backup/storage.ts';
import { createPlannerBackup } from '../src/planner/backup/plannerBackup.ts';

const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE);
const root = resolve(process.env.PLANNER_DIST);
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  let file = resolve(root, '.' + path);
  if (!file.startsWith(root + '/') || !extname(path)) file = resolve(root, 'index.html');
  try { res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLANNER_BROWSER_EXECUTABLE });
const digest = text => createHash('sha256').update(text).digest('hex');
const original = initialState();
const target = { ...initialState(), todos: [{ id: '00000000-0000-4000-8000-000000000101', offeringId: null, text: '合成TODO', done: false }] };
const originalRaw = JSON.stringify(original), targetRaw = JSON.stringify(target);
const backupText = JSON.stringify(await createPlannerBackup(targetRaw, catalog));
const recoveryRaw = 'synthetic previous recovery bytes';

async function scenario(navigateAway, remount = false) {
  const context = await browser.newContext({ acceptDownloads: true,
    viewport: { width: Number(process.env.STAGE19_VIEWPORT_WIDTH || 1280), height: 900 } });
  try {
    await context.addInitScript(({ p, r, raw, recovery }) => {
      if (localStorage.getItem('stage18-seeded') !== '1') {
        localStorage.setItem(p, raw); localStorage.setItem(r, recovery); localStorage.setItem('stage18-seeded', '1');
      }
    }, { p: STORAGE_KEY, r: BACKUP_KEY, raw: originalRaw, recovery: recoveryRaw });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.goto(origin + '/planner');
    const panel = page.getByRole('region', { name: 'プランナー全データのバックアップ・復元' });
    await panel.getByLabel('復元するJSONファイル').setInputFiles({
      name: 'stage18-synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText),
    });
    await panel.getByRole('heading', { name: '復元対象の概要' }).waitFor();
    await panel.getByRole('checkbox', { name: /他のタブ・画面を閉じ/ }).check();
    const holder = await context.newPage(); await holder.goto(origin + '/');
    if (navigateAway) {
      await holder.evaluate(lock => {
        void navigator.locks.request(lock, { mode: 'exclusive' }, async () => {
          window.__stage18Held = true;
          await new Promise(done => { window.__stage18Release = done; });
        });
      }, PLANNER_WRITE_LOCK);
      await holder.waitForFunction(() => window.__stage18Held === true);
    }
    await panel.getByRole('button', { name: '確認したバックアップで全件置換する' }).click();
    if (navigateAway) {
      assert.equal(await page.evaluate(k => localStorage.getItem(k), STORAGE_KEY), originalRaw);
      await page.locator('a[href="/"]').first().click();
      await page.waitForURL(origin + '/');
      await panel.waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('region', { name: 'プランナー全データのバックアップ・復元' }).count(), 0);
      if (remount) {
        await page.goto(origin + '/planner');
        await page.getByRole('region', { name: 'プランナー全データのバックアップ・復元' }).waitFor();
        assert.equal(await page.getByRole('heading', { name: '復元対象の概要' }).count(), 0);
      }
      await holder.evaluate(() => window.__stage18Release());
    }
    if (navigateAway) await holder.evaluate(lock => navigator.locks.request(lock, { mode: 'exclusive' }, () => undefined), PLANNER_WRITE_LOCK);
    else await holder.waitForFunction(([k, raw]) => localStorage.getItem(k) === raw, [STORAGE_KEY, targetRaw], { timeout: 7000 });
    const afterP = await holder.evaluate(k => localStorage.getItem(k), STORAGE_KEY);
    const afterR = await holder.evaluate(k => localStorage.getItem(k), BACKUP_KEY);
    console.log(JSON.stringify({ navigateAway, remount, viewport: Number(process.env.STAGE19_VIEWPORT_WIDTH || 1280), origin: 'localhost', webLock: PLANNER_WRITE_LOCK,
      pBeforeSha256: digest(originalRaw), pAfterSha256: digest(afterP), rBeforeSha256: digest(recoveryRaw),
      rAfterSha256: digest(afterR), primaryChanged: afterP !== originalRaw, recoveryUnchanged: afterR === recoveryRaw,
      routeAtWrite: new URL(page.url()).pathname }));
    assert.equal(afterR, recoveryRaw);
    if (navigateAway) assert.equal(afterP, originalRaw, 'stale unmounted restore must not overwrite primary');
    else assert.equal(afterP, targetRaw, 'normal consented restore remains legal');
  } finally { await context.close(); }
}

try { await scenario(false); await scenario(true); await scenario(true, true); }
finally { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
