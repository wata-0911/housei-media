// Real browser regression tests. Requires a separately provisioned Playwright
// installation and Chromium; see docs/planner-save-ui-verification.md.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { catalog } from '../src/planner/catalog.ts';
import { initialState, STORAGE_KEY, BACKUP_KEY } from '../src/planner/storage.ts';
import { stateForScopeChange } from '../src/planner/thesisSelection.ts';
import { inspectPlannerBackupProtection } from '../src/planner/plannerBackupProtection.ts';
import { createPlannerBackup } from '../src/planner/plannerBackup.ts';

const root = new URL('../', import.meta.url).pathname;
const port = Number(process.env.PLANNER_BROWSER_PORT || 4180);
const origin = `http://127.0.0.1:${port}`;
let browser, server;
before(async () => {
  const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe' });
  let output = ''; server.stdout.on('data', chunk => { output += chunk; }); server.stderr.on('data', chunk => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Local Vite failed: ${output}`);
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* Wait for local server. */ }
    await delay(200);
  }
  assert.ok(ready, `Local Vite did not start: ${output}`);
  browser = await chromium.launch({ headless: true, ...(process.env.PLANNER_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANNER_BROWSER_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

async function open(t, department = '日本文学科', rawOverride = undefined, recovery = 'previous recovery bytes') {
  const state = stateForScopeChange(initialState(), catalog, catalog.programs.find(row => row.department === department).scopeId);
  const raw = rawOverride === undefined ? JSON.stringify(state) : rawOverride;
  const context = await browser.newContext({ acceptDownloads: true });
  t.after(() => context.close());
  await context.addInitScript(({ raw, recovery, key, backupKey }) => {
    if (!localStorage.getItem('fixture-loaded')) {
      if (raw !== null) localStorage.setItem(key, raw);
      localStorage.setItem(backupKey, recovery); localStorage.setItem('fixture-loaded', '1');
    }
  }, { raw, recovery, key: STORAGE_KEY, backupKey: BACKUP_KEY });
  const page = await context.newPage(); await page.goto(`${origin}/planner`);
  await page.getByRole('heading', { name: '全データのJSONバックアップ・復元', exact: true }).waitFor();
  const guidance = page.locator('section').filter({ has: page.getByRole('heading', { name: '卒論手続・事前指導（参考）', exact: true }) });
  return { page, context, guidance, state, raw };
}
async function persisted(page) { return page.evaluate(key => localStorage.getItem(key), STORAGE_KEY); }
async function hold(context) {
  const holder = await context.newPage(); await holder.goto(origin);
  await holder.evaluate(key => {
    window.testLock = navigator.locks.request(`${key}:write`, () => new Promise(resolve => { window.releaseTestLock = resolve; window.testLockHeld = true; }));
  }, STORAGE_KEY);
  await holder.waitForFunction(() => window.testLockHeld);
  return () => holder.evaluate(() => window.releaseTestLock());
}
async function allDisabled(guidance, expected) {
  const controls = guidance.locator('select,input'); assert.ok(await controls.count() >= 2);
  for (const control of await controls.all()) assert.equal(await control.isDisabled(), expected);
}

test('Web Lock wait disables thesis editors, preserves pending state, and permits editing after release', async t => {
  const { page, context, guidance, raw } = await open(t);
  const release = await hold(context);
  await guidance.locator('select').first().selectOption('planned');
  await page.getByText('保存処理を待っています。完了後に編集できます。', { exact: true }).waitFor();
  await allDisabled(guidance, true);
  await assert.rejects(guidance.locator('input[type=date]').first().fill('2026-10-11', { timeout: 300 }), /Timeout/);
  assert.equal(await persisted(page), raw);
  await release();
  await page.getByText('卒論手続の記録を保存しました。', { exact: true }).waitFor();
  await allDisabled(guidance, false);
  await guidance.locator('input[type=date]').first().fill('2026-10-11');
  await page.waitForFunction(key => Object.values(JSON.parse(localStorage.getItem(key)).thesisGuidanceByScope).some(g => Object.values(g.steps).some(s => s.status === 'planned' && s.passedOn === '2026-10-11')), STORAGE_KEY);
  await page.reload(); await guidance.waitFor();
  assert.equal(await guidance.locator('input[type=date]').first().inputValue(), '2026-10-11');
});

test('geography report submission joins the same disabled controls and can be edited again', async t => {
  const { page, context, guidance } = await open(t, '地理学科');
  const release = await hold(context);
  await guidance.getByLabel('地理調査法リポート提出').selectOption('submitted');
  await page.getByText('保存処理を待っています。完了後に編集できます。', { exact: true }).waitFor();
  await allDisabled(guidance, true); await release();
  await page.getByText('卒論手続の記録を保存しました。', { exact: true }).waitFor();
  await allDisabled(guidance, false);
  await guidance.getByLabel('地理調査法リポート提出').selectOption('not_submitted');
  await page.waitForFunction(key => Object.values(JSON.parse(localStorage.getItem(key)).thesisGuidanceByScope).some(g => g.geographyReportSubmitted === false), STORAGE_KEY);
});

test('storage failure leaves original bytes, reports failure and allows a successful retry', async t => {
  const { page, guidance, raw } = await open(t);
  await page.evaluate(key => {
    window.originalTestSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) { if (k === key) throw new DOMException('test quota', 'QuotaExceededError'); return window.originalTestSetItem.call(this, k, value); };
  }, STORAGE_KEY);
  await guidance.locator('select').first().selectOption('planned');
  await page.getByRole('alert').filter({ hasText: '変更は反映していません' }).waitFor();
  assert.equal(await persisted(page), raw); await allDisabled(guidance, false);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalTestSetItem; });
  await guidance.locator('select').first().selectOption('planned');
  await page.getByText('卒論手続の記録を保存しました。', { exact: true }).waitFor();
  assert.notEqual(await persisted(page), raw);
  assert.equal(await page.getByRole('alert').filter({ hasText: '変更は反映していません' }).count(), 0);
});

test('external storage error disables every thesis editor', async t => {
  const { page, context, guidance } = await open(t);
  const other = await context.newPage(); await other.goto(origin);
  await other.evaluate(key => localStorage.setItem(key, 'external changed raw'), STORAGE_KEY);
  await page.getByRole('alert').filter({ hasText: '別の画面で保存データが変更' }).waitFor();
  await allDisabled(guidance, true); assert.equal(await persisted(page), 'external changed raw');
});

test('recovery-only raw protection downloads null primary and exact recovery without normal restore', async t => {
  const recovery = ' \n {"old":"raw recovery","zero":0,"unknown":null}\n ';
  const { page } = await open(t, '日本文学科', null, recovery);
  const panel = page.getByRole('region', { name: 'プランナー全データのバックアップ・復元' });
  await panel.getByRole('button', { name: '原文と旧退避を保護用ファイルに保存', exact: true }).click();
  const downloading = page.waitForEvent('download'); await panel.getByRole('link', { name: 'ファイルをダウンロード', exact: true }).click();
  const text = await readFile(await (await downloading).path(), 'utf8');
  const protection = await inspectPlannerBackupProtection(text);
  assert.equal(protection.primaryRaw, null); assert.equal(protection.recoveryRaw, recovery);
  assert.equal(await persisted(page), null);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY), recovery);
  await panel.locator('input[type=file]').setInputFiles({ name: 'protection.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await panel.getByRole('alert').filter({ hasText: '保護ファイル' }).waitFor();
  assert.equal(await persisted(page), null);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY), recovery);
});

test('grade import preview and undo stop accepting changes while the shared save is pending', async t => {
  const { page, context, guidance } = await open(t);
  await page.locator('#grade-import-panel').locator('xpath=..').evaluate(details => { details.open = true; });
  const grade = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-11T00:00:00.000Z', courses: [{ rawName: '未照合の監査科目', categoryRaw: '専門', compositionCredits: { raw: '4', value: 4 }, additionalEnrollment: { raw: '0', value: 0 }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '4', value: 4 }, schoolingCredits: { raw: '0', value: 0 }, reports: [], creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false }, schoolings: [] }] };
  grade.courses[0].reports = Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null }));
  grade.courses[0].schoolings = Array.from({ length: 2 }, () => ({ rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null }));
  const importPanel = page.locator('#grade-import-panel');
  await importPanel.getByRole('textbox', { name: 'またはJSONを貼り付け', exact: true }).fill(JSON.stringify(grade));
  await importPanel.getByRole('button', { name: '読み込み・検証', exact: true }).click();
  await importPanel.locator('fieldset').waitFor();
  await importPanel.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録', exact: true }).click();
  const undo = page.getByRole('button', { name: '取り込みを元に戻す', exact: true });
  await undo.waitFor();
  grade.courses[0].rawName = '別の未照合の監査科目';
  await importPanel.getByRole('textbox', { name: 'またはJSONを貼り付け', exact: true }).fill(JSON.stringify(grade));
  await importPanel.getByRole('button', { name: '読み込み・検証', exact: true }).click();
  await importPanel.locator('fieldset').waitFor();
  const release = await hold(context);
  await guidance.locator('select').first().selectOption('planned');
  await page.getByText('保存処理を待っています。完了後に編集できます。', { exact: true }).waitFor();
  for (const control of await importPanel.locator('fieldset input,fieldset select,fieldset button').all()) assert.equal(await control.isDisabled(), true);
  assert.equal(await undo.isDisabled(), true);
  await release(); await page.getByText('卒論手続の記録を保存しました。', { exact: true }).waitFor();
  assert.equal(await importPanel.locator('fieldset input[type=checkbox]').first().isDisabled(), false);
  assert.equal(await undo.isDisabled(), false);
});

test('backup restore waits with thesis controls disabled and enables the restored state', async t => {
  const { page, context, guidance, state, raw } = await open(t);
  const panel = page.getByRole('region', { name: 'プランナー全データのバックアップ・復元' });
  const backup = await createPlannerBackup(JSON.stringify(state), catalog);
  await panel.locator('input[type=file]').setInputFiles({ name: 'normal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await panel.getByRole('checkbox').check(); const release = await hold(context);
  await panel.getByRole('button', { name: '確認したバックアップで全件置換する', exact: true }).click();
  await page.getByText('保存処理を待っています。完了後に編集できます。', { exact: true }).waitFor();
  await allDisabled(guidance, true); assert.equal(await persisted(page), raw);
  await release(); await panel.getByText('全データを置き換えて保存しました。再読み込み後も保持されます。', { exact: true }).waitFor();
  await allDisabled(guidance, false); assert.equal(await persisted(page), raw);
});
