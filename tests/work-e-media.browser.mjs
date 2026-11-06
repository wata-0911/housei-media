import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import auditHistory from './fixtures/work-e-audit-01.json' with { type: 'json' };
import { mediaInput } from './fixtures/work-e-media.mjs';
import { importPreview, applyImport } from '../src/planner/gradeImport/gradeImportApply.ts';
import { initialState, STORAGE_KEY } from '../src/planner/backup/storage.ts';
import { catalog } from '../src/planner/catalog/catalog.ts';
const origin = 'http://127.0.0.1:44831';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '44831', '--strictPort'], { stdio: 'pipe' });
  let output = ''; server.stdout.on('data', c => { output += c; }); server.stderr.on('data', c => { output += c; });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error(output);
    try { if ((await fetch(origin)).ok) break; } catch { /* Local server startup. */ }
    await delay(100);
  }
  const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true, ...(process.env.PLANNER_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANNER_BROWSER_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); server?.kill(); });
for (const width of [1280, 390]) test(`Work E: two unmatched historical Media rows, save/reload ${width}px`, async t => {
  const context = await browser.newContext({ viewport: { width, height: 900 } }); t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const data = mediaInput();
  const state = applyImport(initialState(), importPreview(data, catalog.offerings), catalog.offerings);
  assert.equal(state.importedCourseAchievements.length, 2);
  assert.ok(state.importedStudyRecords.every(r => r.offeringId === null && r.rawTerm === 'メ'));
  await page.goto(origin + '/planner');
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: STORAGE_KEY, state });
  await page.goto(origin + '/planner#media'); await page.reload();
  const panel = page.locator('#media-panel');
  await panel.waitFor();
  const counts = {};
  for (const name of ['健康・スポーツ科学概論', '経営学特講']) counts[name] = await panel.getByText(name, { exact: true }).count();
  assert.deepEqual(counts, { '健康・スポーツ科学概論': 1, '経営学特講': 1 }, 'both source rows must be displayed once');
  assert.match(await panel.innerText(), /成績表由来/);
  assert.match(await panel.innerText(), /未照合|要確認/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY), state);
  if (process.env.WORK_E_EVIDENCE) {
    await mkdir(process.env.WORK_E_EVIDENCE, { recursive: true });
    await panel.screenshot({ path: `${process.env.WORK_E_EVIDENCE}/media-${width}.png` });
  }
});
test('Work E: real JSON import UI saves under existing Web Lock, reloads, and repeat import is a no-op', async t => {
  const context = await browser.newContext(); t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/planner#grade-import');
  const enter = async () => {
    await page.getByLabel('またはJSONを貼り付け').fill(JSON.stringify(mediaInput()));
    await page.getByRole('button', { name: '読み込み・検証', exact: true }).click();
  };
  await enter();
  await page.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録', exact: true }).click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').importedCourseAchievements?.length === 2, STORAGE_KEY);
  const saved = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  await page.getByRole('tab', { name: 'メディア', exact: true }).click();
  assert.equal(await page.locator('[data-official-media-id]').count(), 2);
  await page.goto(origin + '/planner#media'); await page.reload();
  await page.locator('#media-panel').waitFor();
  assert.equal(await page.locator('[data-official-media-id]').count(), 2);
  await page.goto(origin + '/planner#grade-import'); await enter();
  assert.equal(await page.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), saved);
  assert.deepEqual(errors, []);
});

// E-AUDIT-01: this anonymous schema22 state is byte-for-byte the independent audit fixture.
async function openHistory(t, state, width) {
  const raw = JSON.stringify(state);
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(({ key, raw }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
  }, { key: STORAGE_KEY, raw });
  const page = await context.newPage();
  await page.goto(origin + '/planner#media');
  await page.locator('#media-panel').waitFor();
  return page;
}

for (const width of [1280, 390]) test(`E-AUDIT-01: automatic history and keyboard confirmation ${width}px`, async t => {
  const state = structuredClone(auditHistory);
  const [row] = state.importedCourseAchievements;
  const page = await openHistory(t, state, width);
  const panel = page.locator('#media-panel');
  const history = panel.getByRole('region', { name: '照合先に基づくメディア履歴' });
  const select = history.getByRole('combobox', { name: row.rawName + 'の照合先を確認' });
  const saved = () => page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  assert.equal(await history.getByText(row.rawName, { exact: true }).count(), 1);
  assert.match(await history.innerText(), /方式未確認/);
  assert.match(await history.innerText(), /科目行の修得 2単位/);
  assert.equal(await panel.locator('[data-official-media-id]').count(), 0);
  assert.equal(await panel.getByRole('combobox').count(), 1);
  await select.focus();
  await select.press('Escape');
  assert.equal(await saved(), JSON.stringify(state));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.WORK_E_EVIDENCE) await history.screenshot({ path: `${process.env.WORK_E_EVIDENCE}/auto-history-${width}.png` });
  // Reviewing a candidate is read-only until the learner submits the form.
  await select.selectOption('');
  await select.selectOption(row.selectedOfferingId);
  assert.equal(await saved(), JSON.stringify(state));
  await select.focus();
  await page.keyboard.press('Tab');
  const confirm = history.getByRole('button', { name: 'この照合先で手動照合' });
  assert.equal(await confirm.evaluate(button => document.activeElement === button), true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).importedCourseAchievements[0].selectionSource === 'manual', STORAGE_KEY);
  const expected = structuredClone(state);
  expected.importedCourseAchievements[0].selectionSource = 'manual';
  assert.deepEqual(JSON.parse(await saved()), expected);
  await page.reload();
  await history.waitFor();
  assert.equal(await history.getByText(row.rawName, { exact: true }).count(), 1);
  assert.equal(await panel.getByRole('combobox').count(), 0);
  assert.equal(await panel.locator('[data-official-media-id]').count(), 0);
  assert.deepEqual(JSON.parse(await saved()), expected);
});

test('E-AUDIT-01: source-less legacy detail remains visible without a writable owner', async t => {
  const state = structuredClone(auditHistory);
  state.importedCourseAchievements = [];
  const page = await openHistory(t, state, 390);
  const panel = page.locator('#media-panel');
  assert.equal(await panel.getByText(state.importedStudyRecords[0].rawName, { exact: true }).count(), 1);
  assert.match(await panel.innerText(), /方式未確認/);
  assert.equal(await panel.getByRole('combobox').count(), 0);
  assert.equal(await panel.locator('[data-official-media-id]').count(), 0);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), JSON.stringify(state));
});
