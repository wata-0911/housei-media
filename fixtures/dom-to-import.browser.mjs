import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { correspondence, item, state } from '../tests/fixtures/curriculum-course-ui.mjs';

const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE);
const root = resolve(process.env.PLANNER_DIST);
const extractor = await readFile(resolve('shared/grade-import/extractor.js'), 'utf8');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  let file = resolve(root, '.' + pathname);
  if (!file.startsWith(root + '/') || !extname(pathname)) file = resolve(root, 'index.html');
  try { res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLANNER_BROWSER_EXECUTABLE });
const key = 'hosei-planner:v1';
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    try {
      const initial = state({ items: [item(correspondence)] });
      await context.addInitScript(({ key, raw }) => {
        if (!localStorage.getItem('fixture-loaded')) {
          localStorage.setItem(key, raw);
          localStorage.setItem('fixture-loaded', '1');
        }
      }, { key, raw: JSON.stringify(initial) });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      await page.route('**/__synthetic_extractor.mjs', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: extractor }));
      await page.goto(origin + '/planner');
      const before = await page.evaluate(key => localStorage.getItem(key), key);
      const result = await page.evaluate(async () => {
        const table = document.createElement('table');
        table.id = 'seisekiTabele110';
        const row = document.createElement('tr');
        row.className = 'column_even';
        const cells = Array(24).fill('');
        Object.assign(cells, { 1: '合成DOM未照合科目ABC', 2: '4', 3: '0', 4: '0', 5: '4', 6: '0' });
        for (const raw of cells) { const td = document.createElement('td'); td.textContent = raw; row.append(td); }
        table.append(row);
        document.body.append(table);
        try { return (await import('/__synthetic_extractor.mjs')).extractCurrentDocument(); }
        finally { table.remove(); }
      });
      assert.equal(result.ok, true);
      assert.equal(result.value.courses.length, 1);
      assert.equal(result.value.courses[0].rawName, '合成DOM未照合科目ABC');
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), before);
      const panel = page.locator('#grade-import-panel');
      await panel.locator('xpath=..').evaluate(el => { el.open = true; });
      await panel.getByRole('textbox', { name: 'またはJSONを貼り付け', exact: true }).fill(JSON.stringify(result.value));
      await panel.getByRole('button', { name: '読み込み・検証', exact: true }).click();
      await panel.locator('fieldset').waitFor();
      assert.equal(await panel.getByRole('checkbox', { name: '合成DOM未照合科目ABCを取り込む' }).count(), 1);
      await panel.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録', exact: true }).click();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).importedCourseAchievements?.some(x => x.rawName === '合成DOM未照合科目ABC'), key);
      const saved = JSON.parse(await page.evaluate(key => localStorage.getItem(key), key));
      assert.deepEqual(saved.items, initial.items);
      assert.equal(saved.importedCourseAchievements.length, 1);
      await page.reload();
      assert.equal(JSON.parse(await page.evaluate(key => localStorage.getItem(key), key)).importedCourseAchievements.length, 1);
      console.log(JSON.stringify({ width, extractedRows: result.value.courses.length, importedRows: saved.importedCourseAchievements.length, priorItemsPreserved: true, reloadPreserved: true }));
    } finally { await context.close(); }
  }
  console.log('PASS synthetic DOM extractor to JSON preview/confirm/import/reload');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
