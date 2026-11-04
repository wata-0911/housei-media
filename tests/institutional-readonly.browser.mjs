import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { loadCurrentCurriculumSearchAdapter } from '../src/planner/institutional/currentSearch.ts';
import { filterPlacementNames } from '../dev/institutional/searchView.ts';
const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
const all = loadCurrentCurriculumSearchAdapter().search({ scope: { kind: 'all' } }).rows;
const port = Number(process.env.YI_READONLY_PORT || 4198);
const base = `http://127.0.0.1:${port}`;
const screenshotDir = process.env.YI_READONLY_SCREENSHOTS || '/private/tmp/issue188-screenshots';
await mkdir(screenshotDir, { recursive: true });
async function server(flag, mode = 'development') {
  let output = '';
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--mode', mode], { env: { ...process.env, NODE_ENV: mode, YI_INSTITUTIONAL_READONLY: flag } });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const deadline = Date.now() + 30000;
  while (!output.includes('Local:')) {
    if (child.exitCode !== null || Date.now() > deadline) { child.kill(); throw new Error(output || 'server startup timeout'); }
    await new Promise(r => setTimeout(r, 100));
  }
  return async () => { child.kill(); await new Promise(r => child.once('exit', r)); };
}
let stop = await server('1');
const browser = await chromium.launch({ headless: true, ...(process.env.PLANNER_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANNER_BROWSER_EXECUTABLE } : {}) }).catch(async error => { await stop(); throw error; });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.readonlyWrites = [];
      for (const method of ['setItem', 'removeItem', 'clear']) Storage.prototype[method] = () => { window.readonlyWrites.push(method); throw new Error('storage write'); };
      indexedDB.open = () => { window.readonlyWrites.push('indexedDB'); throw new Error('database access'); };
    });
    await page.goto(`${base}/__dev/institutional`);
    const status = page.getByRole('status');
    await status.waitFor();
    const query = page.getByRole('textbox', { name: '正式科目名', exact: true });
    const partial = page.getByRole('radio', { name: '部分一致', exact: true });
    const exact = page.getByRole('radio', { name: '完全一致', exact: true });
    const items = page.getByRole('list', { name: '制度科目の検索結果' }).locator(':scope > li');
    assert.equal(await partial.isChecked(), true);
    assert.equal(await items.count(), 30);
    await page.getByRole('button', { name: /さらに30件表示/ }).click();
    assert.equal(await items.count(), 60);
    await partial.focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await exact.isChecked(), true);
    assert.equal(await items.count(), 30);
    await query.fill('簿記');
    assert.equal(await items.count(), filterPlacementNames(all, '簿記', 'exact').length);
    await partial.check();
    assert.equal(await query.inputValue(), '簿記');
    assert.equal(await items.count(), filterPlacementNames(all, '簿記', 'partial').length);
    await query.fill('簿記Ⅰ'); await exact.check();
    assert.equal(await items.count(), filterPlacementNames(all, '簿記Ⅰ', 'exact').length);
    const scopeId = all.find(r => r.scope.officialScopeLabel === '商業').scope.id;
    await page.getByRole('combobox').selectOption(scopeId);
    await page.getByRole('checkbox').uncheck();
    await partial.check();
    assert.equal(await query.inputValue(), '簿記Ⅰ');
    assert.equal(await page.getByRole('combobox').inputValue(), scopeId);
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    await query.fill('簿記 Ⅰ');
    assert.ok(await items.count() > 0);
    const first = items.first();
    const summary = first.locator('summary').first();
    await summary.focus(); await page.keyboard.press('Enter');
    assert.equal(await first.locator('details').first().getAttribute('open'), '');
    assert.ok((await first.textContent()).includes('SHA-256:'));
    await page.screenshot({ path: `${screenshotDir}/search-${width}.png`, fullPage: true });
    await query.fill('存在しない科目');
    assert.equal(await items.count(), 0);
    await page.getByText('該当する配置はありません。', { exact: false }).waitFor();
    await page.getByRole('combobox').selectOption('');
    await query.fill('　 '); await exact.check();
    assert.equal(await items.count(), 30);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(await page.evaluate(() => window.readonlyWrites), []);
    assert.deepEqual(errors, []);
    assert.equal(await page.getByRole('button', { name: /追加|保存/ }).count(), 0);
    console.log(`PASS ${width}px: search modes, AND, placements, filters, keyboard, evidence, blanks, zero results, pagination, storage, overflow`);
    await page.close();
  }
} finally { await browser.close(); await stop(); }
for (const [flag, mode] of [['0', 'development'], ['1', 'production']]) {
  stop = await server(flag, mode);
  try {
    for (const path of ['/__dev/institutional', '/__dev/institutional/', '/dev/institutional/main.tsx', '/dev/institutional/InstitutionalSearch.tsx', '/dev/institutional/searchView.ts', '/dev/institutional/style.css', '/dev%2finstitutional/main.tsx']) {
      assert.equal((await fetch(base + path)).status, 404, `${mode} ${path}`);
    }
    console.log(`PASS ${mode}, flag=${flag}: entry and direct modules 404`);
  } finally { await stop(); }
}
