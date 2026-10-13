// Real browser regression tests. Requires a separately provisioned Playwright
// installation and Chromium; see docs/planner-save-ui-verification.md.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { initialState, STORAGE_KEY, BACKUP_KEY } from '../src/planner/backup/storage.ts';
import { stateForScopeChange } from '../src/planner/graduation/thesisSelection.ts';
import { inspectPlannerBackupProtection } from '../src/planner/backup/plannerBackupProtection.ts';
import { createPlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { isMediaSchooling } from '../src/planner/progress/mediaSchooling.ts';
import { createPublicCourse } from '../src/planner/planning/publicCourses.ts';
import { applyImport, importPreview } from '../src/planner/gradeImport/gradeImportApply.ts';

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
  await guidance.locator('input[type=date]').first().press('Enter');
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

function textFixture() {
  const state = stateForScopeChange(initialState(), catalog, catalog.programs.find(row => row.department === '日本文学科').scopeId);
  state.graduationProfile.admissionType = 'other_transfer';
  const media = catalog.offerings.find(isMediaSchooling);
  state.items = [{ offeringId: media.id, status: 'in_progress', plannedYear: 2026, plannedTerm: null, studyYear: 2, earnedOrder: null }];
  state.mediaSchoolingProgress[media.id] = { offeringId: media.id, totalLessons: 14, lessons: [], assessments: [{ id: 'draft-assessment', type: 'other', label: '初期名', scheduledDate: null, completed: false }] };
  state.publicCourses = [createPublicCourse('00000000-0000-4000-8000-000000000001')];
  return { state, media };
}
async function mediaEditor(t) {
  const fixture = textFixture();
  const opened = await open(t, '日本文学科', JSON.stringify(fixture.state));
  await opened.page.getByRole('tab', { name: 'メディア', exact: true }).click();
  const name = opened.page.getByLabel('試験・評価予定の名称', { exact: true });
  const total = opened.page.getByLabel(`${fixture.media.name}の全回数`, { exact: true });
  return { ...opened, ...fixture, name, total };
}
async function recordWrites(page) {
  await page.evaluate(key => {
    window.realDraftSetItem = Storage.prototype.setItem; window.draftWrites = []; window.draftFail = false;
    Storage.prototype.setItem = function (k, value) {
      if (k === key) { window.draftWrites.push(value); if (window.draftFail) throw new DOMException('test quota', 'QuotaExceededError'); }
      return window.realDraftSetItem.call(this, k, value);
    };
  }, STORAGE_KEY);
}
async function mediaName(page, id, expected) {
  await page.waitForFunction(({ key, id, expected }) => JSON.parse(localStorage.getItem(key)).mediaSchoolingProgress[id].assessments[0].label === expected, { key: STORAGE_KEY, id, expected });
}

test('media name supports continuous typing without writes or focus loss; blur and Enter commit once', async t => {
  const { page, name, media, raw } = await mediaEditor(t); await recordWrites(page);
  await name.fill(''); await name.pressSequentially('連続入力を最後まで', { delay: 35 });
  assert.equal(await name.inputValue(), '連続入力を最後まで');
  assert.equal(await name.isDisabled(), false); assert.equal(await name.evaluate(el => el === document.activeElement), true);
  assert.equal(await persisted(page), raw); assert.equal(await page.evaluate(() => window.draftWrites.length), 0);
  await name.press('Tab'); await mediaName(page, media.id, '連続入力を最後まで');
  assert.equal(await page.evaluate(() => window.draftWrites.length), 1);
  await name.fill('次の名称'); await name.press('Enter'); await mediaName(page, media.id, '次の名称');
  await name.press('Tab'); assert.equal(await page.evaluate(() => window.draftWrites.length), 2);
  await page.reload(); await page.getByRole('tab', { name: 'メディア', exact: true }).click();
  assert.equal(await page.getByLabel('試験・評価予定の名称', { exact: true }).inputValue(), '次の名称');
});

test('media name failed save keeps the full draft and retry saves the same text', async t => {
  const { page, name, media, raw } = await mediaEditor(t); await recordWrites(page);
  await page.evaluate(() => { window.draftFail = true; });
  await name.fill('失敗しても全文を保持'); await name.press('Enter');
  await page.getByRole('alert').filter({ hasText: '変更は反映していません' }).waitFor();
  assert.equal(await name.inputValue(), '失敗しても全文を保持'); assert.equal(await persisted(page), raw);
  await page.evaluate(() => { window.draftFail = false; });
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await mediaName(page, media.id, '失敗しても全文を保持');
  assert.equal(await page.getByRole('button', { name: '再試行', exact: true }).count(), 0);
});

test('media name remains editable before confirmation during a held lock, preserves full draft while queued and resumes', async t => {
  const { page, context, name, media, raw } = await mediaEditor(t); const release = await hold(context);
  await name.fill(''); await name.pressSequentially('ロック待ちの全文');
  assert.equal(await name.isDisabled(), false); assert.equal(await persisted(page), raw);
  await name.press('Enter'); await page.getByText('保存処理を待っています。完了後に編集できます。', { exact: true }).waitFor();
  assert.equal(await name.isDisabled(), true); assert.equal(await name.inputValue(), 'ロック待ちの全文');
  await assert.rejects(name.fill('拒否される追加', { timeout: 300 }), /Timeout/);
  assert.equal(await name.inputValue(), 'ロック待ちの全文'); await release();
  await mediaName(page, media.id, 'ロック待ちの全文');
  await name.fill('解除後に再編集'); await name.press('Enter'); await mediaName(page, media.id, '解除後に再編集');
});

test('media total supports multi-digit drafts, retains failures and retries the numeric value', async t => {
  const { page, total, media, raw } = await mediaEditor(t); await recordWrites(page);
  await total.fill(''); await total.pressSequentially('125', { delay: 35 });
  assert.equal(await total.inputValue(), '125'); assert.equal(await persisted(page), raw);
  assert.equal(await page.evaluate(() => window.draftWrites.length), 0);
  await page.evaluate(() => { window.draftFail = true; });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '変更は反映していません' }).waitFor();
  assert.equal(await total.inputValue(), '125'); assert.equal(await persisted(page), raw);
  await page.evaluate(() => { window.draftFail = false; });
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key)).mediaSchoolingProgress[id].totalLessons === 125, { key: STORAGE_KEY, id: media.id });
});

test('IME composition Enter does not persist an unfinished media draft', async t => {
  const { page, name, media, raw } = await mediaEditor(t); await recordWrites(page);
  await name.fill('編集中'); await name.dispatchEvent('compositionstart'); await name.press('Enter');
  assert.equal(await persisted(page), raw); assert.equal(await page.evaluate(() => window.draftWrites.length), 0);
  await name.dispatchEvent('compositionend'); await name.press('Enter'); await mediaName(page, media.id, '編集中');
  assert.equal(await page.evaluate(() => window.draftWrites.length), 1);
});

test('admission year and recognized credits keep unsaved numeric drafts after failure and allow Enter retry', async t => {
  const { page, raw } = await mediaEditor(t); await recordWrites(page);
  await page.getByRole('tab', { name: 'プロフィール', exact: true }).click();
  const year = page.getByLabel('入学年度', { exact: true });
  await year.fill(''); await year.pressSequentially('2028', { delay: 35 });
  assert.equal(await persisted(page), raw); assert.equal(await page.evaluate(() => window.draftWrites.length), 0);
  await page.evaluate(() => { window.draftFail = true; }); await year.press('Enter');
  await page.getByRole('alert').filter({ hasText: '変更は反映していません' }).waitFor();
  assert.equal(await year.inputValue(), '2028'); assert.equal(await persisted(page), raw);
  await page.evaluate(() => { window.draftFail = false; }); await year.press('Enter');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).graduationProfile.admissionYear === 2028, STORAGE_KEY);
  const credits = page.getByLabel('認定単位', { exact: true }); const before = await persisted(page);
  await credits.fill('12.5'); assert.equal(await persisted(page), before);
  await page.evaluate(() => { window.draftFail = true; }); await credits.press('Enter');
  await page.getByRole('alert').filter({ hasText: '変更は反映していません' }).waitFor();
  assert.equal(await credits.inputValue(), '12.5'); assert.equal(await persisted(page), before);
  await page.evaluate(() => { window.draftFail = false; }); await credits.press('Enter');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).graduationProfile.recognizedCredits.totalCredits === 12.5, STORAGE_KEY);
});

test('imported component year and term are drafts, preserve failed text and keep official credits unchanged', async t => {
  const { state } = textFixture();
  const emptySchool = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null };
  const source = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-11T00:00:00.000Z', courses: [{ rawName: '未照合の入力確認科目', categoryRaw: '専門', compositionCredits: { raw: '4', value: 4 }, additionalEnrollment: { raw: '0', value: 0 }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '4', value: 4 }, schoolingCredits: { raw: '0', value: 0 }, reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })), creditExam: { rawDate: '2026/10/01', rawCredits: '4', rawGrade: 'A', date: '2026-10-01', credits: 4, grade: 'A', pendingMarker: false }, schoolings: [emptySchool, emptySchool] }] };
  const imported = applyImport(state, importPreview(source, catalog.offerings, []), catalog.offerings);
  const { page, raw } = await open(t, '日本文学科', JSON.stringify(imported)); await recordWrites(page);
  await page.locator('details').evaluateAll(rows => { for (const row of rows) row.open = true; });
  const editor = page.locator('article[data-import-study-id]').first();
  const year = editor.getByRole('spinbutton'); const term = editor.getByRole('textbox');
  await year.fill(''); await year.pressSequentially('2027'); assert.equal(await persisted(page), raw);
  await year.press('Enter'); await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).importedStudyRecords[0].academicYear === 2027, STORAGE_KEY);
  const before = await persisted(page); await page.evaluate(() => { window.draftFail = true; });
  await term.fill(''); await term.pressSequentially('前期の長い入力'); assert.equal(await persisted(page), before);
  await term.press('Enter'); await page.getByRole('alert').filter({ hasText: '変更は反映していません' }).waitFor();
  assert.equal(await term.inputValue(), '前期の長い入力'); assert.equal(await persisted(page), before);
  await page.evaluate(() => { window.draftFail = false; }); await term.press('Enter');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).importedStudyRecords[0].term === '前期の長い入力', STORAGE_KEY);
  const restored = JSON.parse(await persisted(page));
  assert.deepEqual(restored.importedCourseAchievements, imported.importedCourseAchievements);
});

test('restore invalidates an unsaved media draft even when the stored value is identical', async t => {
  const { page, total, state } = await mediaEditor(t);
  await total.fill('201'); await total.press('Enter');
  await page.getByRole('alert').filter({ hasText: '全回数は1〜200' }).waitFor();
  assert.equal(await total.inputValue(), '201');
  const panel = page.getByRole('region', { name: 'プランナー全データのバックアップ・復元' });
  const backup = await createPlannerBackup(JSON.stringify(state), catalog);
  await panel.locator('input[type=file]').setInputFiles({ name: 'same-state.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await panel.getByRole('checkbox').check(); await panel.getByRole('button', { name: '確認したバックアップで全件置換する', exact: true }).click();
  await panel.getByText('全データを置き換えて保存しました。再読み込み後も保持されます。', { exact: true }).waitFor();
  assert.equal(await total.inputValue(), '14');
  assert.equal(await page.getByRole('alert').filter({ hasText: '全回数は1〜200' }).count(), 0);
});

test('public course title and planned year retain failed drafts and confirm whole values after a held lock', async t => {
  const fixture = textFixture();
  const { page, context, raw } = await open(t, '日本文学科', JSON.stringify(fixture.state)); await recordWrites(page);
  const group = page.getByRole('region', { name: '公開科目', exact: true });
  await group.getByRole('button', { name: '開く', exact: true }).click();
  const title = group.locator('input:not([aria-label]):visible');
  await title.fill(''); await title.pressSequentially('連続入力できる公開科目名', { delay: 35 });
  assert.equal(await persisted(page), raw); assert.equal(await title.evaluate(el => el === document.activeElement), true);
  await page.evaluate(() => { window.draftFail = true; }); await title.press('Enter');
  await page.getByRole('alert').filter({ hasText: '変更は反映していません' }).waitFor();
  assert.equal(await title.inputValue(), '連続入力できる公開科目名'); assert.equal(await persisted(page), raw);
  await page.evaluate(() => { window.draftFail = false; }); await title.press('Enter');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).publicCourses[0].title === '連続入力できる公開科目名', STORAGE_KEY);
  const year = group.locator('input[aria-label="計画年度"]:visible'); const before = await persisted(page);
  const release = await hold(context); await year.fill(''); await year.pressSequentially('2027');
  assert.equal(await persisted(page), before); assert.equal(await year.isDisabled(), false);
  await year.press('Enter'); await page.getByText('保存処理を待っています。完了後に編集できます。', { exact: true }).waitFor();
  assert.equal(await year.inputValue(), '2027'); assert.equal(await year.isDisabled(), true);
  await release(); await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).publicCourses[0].plannedYear === 2027, STORAGE_KEY);
});

test('media total presets replace the draft without a preceding blur save, including the same stored preset', async t => {
  const { page, total, media } = await mediaEditor(t); await recordWrites(page);
  await total.fill('125'); await page.getByRole('button', { name: '14回', exact: true }).click();
  await page.waitForFunction(() => window.draftWrites.length === 1);
  await page.getByText('メディアスクーリングの進捗を保存しました。', { exact: true }).waitFor();
  assert.equal(await total.inputValue(), '14');
  assert.equal(JSON.parse(await persisted(page)).mediaSchoolingProgress[media.id].totalLessons, 14);
  await total.fill('125'); await page.getByRole('button', { name: '15回', exact: true }).click();
  await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key)).mediaSchoolingProgress[id].totalLessons === 15, { key: STORAGE_KEY, id: media.id });
  assert.equal(await total.inputValue(), '15'); assert.equal(await page.evaluate(() => window.draftWrites.length), 2);
});

test('grade identity P1: preview holds a different exam year and preserves stored original bytes', async t => {
  const numeric = value => ({ raw: value === null ? '' : String(value), value });
  const empty = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null };
  const data = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-12T00:00:00.000Z', courses: [{
    rawName: '論理学', categoryRaw: '人文', compositionCredits: numeric(4), earnedCredits: numeric(4),
    schoolingCredits: numeric(null), additionalEnrollment: numeric(null), recognizedExemption: numeric(null),
    reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
    creditExam: { rawDate: '2020/07/01', date: '2020-07-01', rawCredits: '4', credits: 4, rawGrade: 'A', grade: 'A', pendingMarker: false }, schoolings: [empty, empty],
  }] };
  const state = applyImport(initialState(), importPreview(data, catalog.offerings), catalog.offerings);
  const { page, raw } = await open(t, '日本文学科', JSON.stringify(state)); await recordWrites(page);
  await page.locator('details').evaluateAll(rows => { for (const row of rows) row.open = true; });
  const panel = page.locator('#grade-import-panel');
  const incoming = structuredClone(data);
  incoming.courses[0].creditExam.rawDate = '2021/07/01'; incoming.courses[0].creditExam.date = '2021-07-01';
  incoming.courses[0].earnedCredits = numeric(2);
  await panel.getByRole('textbox', { name: 'またはJSONを貼り付け', exact: true }).fill(JSON.stringify(incoming));
  await panel.getByRole('button', { name: '読み込み・検証', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: '取り込みを保留' }).waitFor();
  assert.equal(await panel.getByRole('checkbox', { name: '論理学を取り込む', exact: true }).isDisabled(), true);
  assert.equal(await panel.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録', exact: true }).isDisabled(), true);
  assert.equal(await persisted(page), raw);
  assert.equal(await page.evaluate(() => window.draftWrites.length), 0);
  // A new unrelated row can be applied in the same preview; the held row stays intact.
  incoming.courses.push({ ...structuredClone(data.courses[0]), rawName: '合成の別科目' });
  await panel.getByRole('textbox', { name: 'またはJSONを貼り付け', exact: true }).fill(JSON.stringify(incoming));
  await panel.getByRole('button', { name: '読み込み・検証', exact: true }).click();
  await panel.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録', exact: true }).click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).importedCourseAchievements.length === 2, STORAGE_KEY);
  const saved = JSON.parse(await persisted(page));
  assert.deepEqual(saved.importedCourseAchievements[0], state.importedCourseAchievements[0]);
  assert.deepEqual(saved.importedStudyRecords[0], state.importedStudyRecords[0]);
  await page.reload();
  assert.deepEqual(JSON.parse(await persisted(page)).importedCourseAchievements[0], state.importedCourseAchievements[0]);
});

test('grade components P2: manual year survives grade refresh without duplicates and aggregate history is labelled', async t => {
  const numeric = value => ({ raw: value === null ? '' : String(value), value });
  const empty = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null };
  const data = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-12T00:00:00.000Z', courses: [{
    rawName: '論理学', categoryRaw: '人文', compositionCredits: numeric(4), earnedCredits: numeric(4),
    schoolingCredits: numeric(null), additionalEnrollment: numeric(null), recognizedExemption: numeric(null),
    reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
    creditExam: { rawDate: '2020/07/01', date: '2020-07-01', rawCredits: '4', credits: 4, rawGrade: 'A', grade: 'A', pendingMarker: false }, schoolings: [empty, empty],
  }] };
  const imported = applyImport(initialState(), importPreview(data, catalog.offerings), catalog.offerings);
  const id = imported.importedStudyRecords[0].id;
  const { page } = await open(t, '日本文学科', JSON.stringify(imported));
  await page.locator('details').evaluateAll(rows => { for (const row of rows) row.open = true; });
  await page.getByRole('button', { name: '保存済み全件のメンテナンスを表示', exact: true }).click();
  const editor = page.locator(`article[data-import-study-id="${id}"]`);
  await editor.getByRole('spinbutton').fill('2019'); await editor.getByRole('spinbutton').press('Enter');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).importedStudyRecords[0].academicYear === 2019, STORAGE_KEY);
  const panel = page.locator('#grade-import-panel');
  const refresh = async () => {
    await panel.getByRole('textbox', { name: 'またはJSONを貼り付け', exact: true }).fill(JSON.stringify(data));
    await panel.getByRole('button', { name: '読み込み・検証', exact: true }).click();
    await panel.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録', exact: true }).click();
  };
  data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S';
  await refresh();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).importedStudyRecords[0].grade === 'S', STORAGE_KEY);
  let saved = JSON.parse(await persisted(page));
  assert.equal(saved.importedStudyRecords.length, 1); assert.equal(saved.importedStudyRecords[0].id, id);
  assert.equal(saved.importedStudyRecords[0].academicYear, 2019); assert.equal(saved.importedStudyRecords[0].yearSource, 'manual');
  data.courses[0].earnedCredits = numeric(2);
  await refresh();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).importedCourseAchievements[0].earnedCreditsTotal === 2, STORAGE_KEY);
  saved = JSON.parse(await persisted(page));
  assert.equal(saved.importedStudyRecords.length, 1); assert.equal(saved.importedStudyRecords[0].earnedCreditsTotal, 4);
  assert.equal(saved.importedStudyRecords[0].credits, 4); assert.equal(saved.importedStudyRecords[0].academicYear, 2019);
  await editor.getByText(/現在の公式集計.*修得単位 2/).waitFor();
  await editor.getByText(/取込時の集計（履歴）.*修得単位 4/).waitFor();
  await page.reload();
  assert.deepEqual(JSON.parse(await persisted(page)), saved);
  await page.getByRole('heading', { name: '全データのJSONバックアップ・復元', exact: true }).waitFor();
  await page.locator('details').evaluateAll(rows => { for (const row of rows) row.open = true; });
  await page.getByRole('button', { name: '保存済み全件のメンテナンスを表示', exact: true }).click();
  await editor.getByText(/現在の公式集計.*修得単位 2/).waitFor();
});

test('grade partial P2: unchecked changed detail holds storage; full refresh then aggregate correction remains possible', async t => {
  const numeric = value => ({ raw: value === null ? '' : String(value), value });
  const empty = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null };
  const data = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-12T00:00:00.000Z', courses: [{
    rawName: '論理学', categoryRaw: '人文', compositionCredits: numeric(4), earnedCredits: numeric(4),
    schoolingCredits: numeric(2), additionalEnrollment: numeric(null), recognizedExemption: numeric(null),
    reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
    creditExam: { rawDate: '2020/07/01', date: '2020-07-01', rawCredits: '2', credits: 2, rawGrade: 'A', grade: 'A', pendingMarker: false },
    schoolings: [{ ...empty, rawYear: '20', year: '20', rawTerm: '夏', term: '夏', rawDate: '2020/08/01', date: '2020-08-01', rawCredits: '2', credits: 2, rawGrade: 'A', grade: 'A' }, empty],
  }] };
  const state = applyImport(initialState(), importPreview(data, catalog.offerings), catalog.offerings);
  Object.assign(state.importedStudyRecords[0], { academicYear: 2019, yearSource: 'manual', term: '手動期' });
  const { page, raw } = await open(t, '日本文学科', JSON.stringify(state)); await recordWrites(page);
  await page.locator('details').evaluateAll(rows => { for (const row of rows) row.open = true; });
  const panel = page.locator('#grade-import-panel');
  const read = async () => {
    await panel.getByRole('textbox', { name: 'またはJSONを貼り付け', exact: true }).fill(JSON.stringify(data));
    await panel.getByRole('button', { name: '読み込み・検証', exact: true }).click();
  };
  const apply = panel.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録', exact: true });
  data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S'; await read();
  const selections = panel.getByRole('checkbox', { name: '論理学を取り込む', exact: true });
  await selections.nth(0).uncheck();
  await panel.getByRole('alert').filter({ hasText: '更新が必要な保存済み内訳が選択されていない' }).waitFor();
  assert.equal(await apply.isDisabled(), true); assert.equal(await selections.nth(0).isDisabled(), false);
  assert.equal(await persisted(page), raw); assert.equal(await page.evaluate(() => window.draftWrites.length), 0);
  // Reading the full same JSON starts again with both details selected.
  await read(); await apply.click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).importedStudyRecords[0].grade === 'S', STORAGE_KEY);
  data.courses[0].earnedCredits = numeric(2); await read(); await selections.nth(0).uncheck(); await apply.click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).importedCourseAchievements[0].earnedCreditsTotal === 2, STORAGE_KEY);
  const saved = JSON.parse(await persisted(page));
  assert.equal(saved.importedStudyRecords.length, 2); assert.equal(saved.importedStudyRecords[0].id, state.importedStudyRecords[0].id);
  assert.equal(saved.importedStudyRecords[0].academicYear, 2019); assert.equal(saved.importedStudyRecords[0].yearSource, 'manual');
  assert.equal(saved.importedStudyRecords[0].term, '手動期');
  assert.deepEqual(saved.importedStudyRecords.map(record => [record.method, record.grade, record.credits]), [['correspondence', 'S', 2], ['schooling', 'A', 2]]);
  await read(); assert.equal(await apply.isDisabled(), true); assert.deepEqual(JSON.parse(await persisted(page)), saved);
  await page.reload();
  await page.getByRole('heading', { name: '全データのJSONバックアップ・復元', exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await persisted(page)), saved);
  await page.locator('details').evaluateAll(rows => { for (const row of rows) row.open = true; });
  await page.getByRole('button', { name: '保存済み全件のメンテナンスを表示', exact: true }).click();
  const editor = page.locator(`article[data-import-study-id="${state.importedStudyRecords[0].id}"]`);
  await editor.getByText(/現在の公式集計.*修得単位 2/).waitFor();
  await editor.getByText(/取込時の集計（履歴）.*修得単位 4/).waitFor();
});

// Issue #152: actual Course cards, original v22 bytes, and 390px rendering.
import { course as calligraphyCourse, corr as calligraphyCorr, schools as calligraphySchools, programs as calligraphyPrograms, item as calligraphyItem, profile as calligraphyProfile, batch as calligraphyBatch, official as calligraphyOfficial } from './fixtures/calligraphy-progress.mjs';
function calligraphyState(items, saved = {}, rows = []) {
  return { ...stateForScopeChange(initialState(), catalog, calligraphyPrograms[0].scopeId), graduationProfile: calligraphyProfile,
    items, correspondenceProgress: saved, importedCourseAchievements: rows };
}
async function calligraphyCard(page) {
  const card = page.locator(`[data-curriculum-course-id="${calligraphyCourse.id}"]`);
  await card.waitFor(); return card;
}
for (const [label, items, saved, rows, expected] of [
  ['S1', [calligraphyItem(calligraphySchools[0])], {}, [], '修得: 1 / 2単位 · 未完成'],
  ['S1+S1', calligraphySchools.slice(0, 2).map(o => calligraphyItem(o)), {}, [], '本人記録による完成条件: 2 / 2単位 · 完成'],
  ['batch-only', [calligraphyItem(calligraphyCorr)], calligraphyBatch('passed'), [], '修得: 0 / 2単位 · 未完成'],
  ['batch+S1', [calligraphyItem(calligraphyCorr), calligraphyItem(calligraphySchools[0])], calligraphyBatch('passed'), [], '本人記録による完成条件: 2 / 2単位 · 完成'],
  ['legacy-T2+S1', [calligraphyItem(calligraphyCorr), calligraphyItem(calligraphySchools[0])], {}, [], '修得: 1 / 2単位 · 未完成'],
  ['official2/S1', [calligraphyItem(calligraphyCorr), calligraphyItem(calligraphySchools[0])], calligraphyBatch('passed'), [calligraphyOfficial()], '修得: 2 / 2単位 · 完成'],
]) test(`calligraphy 390px real UI ${label}`, async t => {
  const state = calligraphyState(items, saved, rows); const { page } = await open(t, '日本文学科', JSON.stringify(state));
  await page.setViewportSize({ width: 390, height: 844 });
  const card = await calligraphyCard(page); await card.getByText(expected, { exact: true }).waitFor();
  assert.match(await card.innerText(), /超過候補: 修得 0単位 \/ 予定込み 0単位/);
  if (items.some(i => i.offeringId === calligraphyCorr.id)) {
    const attempt = card.locator(`[data-attempt-id="${calligraphyCorr.id}"]`);
    await attempt.getByText('履修状況の詳細・編集', { exact: true }).click();
    await attempt.getByLabel('書道実技の添削10課題一括の状態').waitFor();
    assert.match(await attempt.innerText(), /正式な1単位/);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  const dir = process.env.CALLIGRAPHY_SCREENSHOT_DIR;
  if (dir) await card.screenshot({ path: `${dir}/${label.replaceAll('/', '-')}-390.png`, style: 'header { visibility: hidden !important; transition: none !important; }' });
});
test('calligraphy UI status, S1 revocation, reload, and JSON restoration preserve v22', async t => {
  const initial = calligraphyState([calligraphyItem(calligraphyCorr), calligraphyItem(calligraphySchools[0])]);
  const { page } = await open(t, '日本文学科', JSON.stringify(initial));
  await page.setViewportSize({ width: 390, height: 844 });
  let card = await calligraphyCard(page);
  let attempt = card.locator(`[data-attempt-id="${calligraphyCorr.id}"]`);
  await attempt.getByText('履修状況の詳細・編集', { exact: true }).click();
  const select = attempt.getByLabel('書道実技の添削10課題一括の状態');
  await select.selectOption('grading'); await card.getByText('修得: 1 / 2単位 · 未完成', { exact: true }).waitFor();
  await select.selectOption('passed'); await card.getByText('本人記録による完成条件: 2 / 2単位 · 完成', { exact: true }).waitFor();
  await page.waitForFunction(key => Object.values(JSON.parse(localStorage.getItem(key)).correspondenceProgress).some(p => p.calligraphyBatchStatus === 'passed'), STORAGE_KEY);
  const completedRaw = await persisted(page); const backup = await createPlannerBackup(completedRaw, catalog);
  assert.deepEqual(JSON.parse(completedRaw).items, initial.items);
  await page.reload(); card = await calligraphyCard(page);
  await card.getByText('本人記録による完成条件: 2 / 2単位 · 完成', { exact: true }).waitFor();
  const school = card.locator(`[data-attempt-id="${calligraphySchools[0].id}"]`);
  await school.getByText('履修状況の詳細・編集', { exact: true }).click();
  await school.locator('label').filter({ hasText: /^状態/ }).locator('select').selectOption('planned');
  await card.getByText('修得: 0 / 2単位 · 未完成', { exact: true }).waitFor();
  await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key)).items.find(i => i.offeringId === id).status === 'planned', { key: STORAGE_KEY, id: calligraphySchools[0].id });
  const panel = page.getByRole('region', { name: 'プランナー全データのバックアップ・復元' });
  await panel.locator('input[type=file]').setInputFiles({ name: 'calligraphy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: '確認したバックアップで全件置換する', exact: true }).click();
  await panel.getByText('全データを置き換えて保存しました。再読み込み後も保持されます。', { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await persisted(page)), JSON.parse(completedRaw));
  await page.reload(); card = await calligraphyCard(page);
  await card.getByText('本人記録による完成条件: 2 / 2単位 · 完成', { exact: true }).waitFor();
});

import { referenceCases as calligraphyReferenceCases } from './fixtures/calligraphy-state-references.mjs';
async function assertCalligraphyReferences(page, expected, label) {
  const section = page.locator('section[aria-labelledby="graduation-progress-heading"]');
  await section.waitFor();
  for (const name of ['専門教育：選択', '専門教育：合計']) {
    const card = section.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    const text = `参考：履修中 ${expected.inProgress}単位 / 計画中 ${expected.planned}単位`;
    await card.getByText(text, { exact: true }).waitFor();
    assert.equal(await card.locator('p.text-lg .font-semibold').innerText(), String(expected.graduation), `${label}/${name}/earned`);
  }
}
for (const program of calligraphyPrograms) test(`calligraphy P2 Chromium card state matrix ${program.course}`, async t => {
  const makeState = scenario => ({ ...stateForScopeChange(initialState(), catalog, program.scopeId), graduationProfile: calligraphyProfile,
    items: scenario.items, correspondenceProgress: scenario.saved, importedCourseAchievements: scenario.rows });
  const { page } = await open(t, '日本文学科', JSON.stringify(makeState(calligraphyReferenceCases[0])));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scenario of calligraphyReferenceCases) {
    const raw = JSON.stringify(makeState(scenario));
    await page.evaluate(({ raw, key }) => localStorage.setItem(key, raw), { raw, key: STORAGE_KEY });
    await page.reload();
    await assertCalligraphyReferences(page, scenario.expected, scenario.label);
    await assertCalligraphyPartialBody(page, scenario.rows.length === 0 && scenario.expected.earned === 1);
    const courseCard = await calligraphyCard(page);
    const projectedCompletion = scenario.rows.length ? scenario.completion : scenario.expected.projected === 2 ? 'complete' : 'incomplete';
    const expectedCompletion = projectedCompletion === 'complete' ? '完成' : projectedCompletion === 'unknown' ? '判定保留' : '未完成';
    await courseCard.getByText(`予定込み: ${scenario.expected.projected} / 2単位 · ${expectedCompletion}`, { exact: true }).waitFor();
    assert.equal(await persisted(page), raw, `reading ${scenario.label} must not rewrite saved state`);
    if (process.env.CALLIGRAPHY_P2_SCREENSHOT_DIR && scenario.label === 'S1 in_progress') {
      const elective = page.locator('section[aria-labelledby="graduation-progress-heading"] article').filter({ has: page.getByRole('heading', { name: '専門教育：選択', exact: true }) });
      await elective.screenshot({ path: `${process.env.CALLIGRAPHY_P2_SCREENSHOT_DIR}/s1-in-progress-${program.scopeId}.png`, style: 'header { visibility: hidden !important; transition: none !important; }' });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, scenario.label);
  }
});
for (const program of calligraphyPrograms) test(`calligraphy P2 Chromium lifecycle and backup references ${program.course}`, async t => {
  const initial = { ...stateForScopeChange(initialState(), catalog, program.scopeId), graduationProfile: calligraphyProfile,
    items: [calligraphyItem(calligraphyCorr, 'in_progress'), calligraphyItem(calligraphySchools[0])], correspondenceProgress: calligraphyBatch('passed') };
  const { page } = await open(t, '日本文学科', JSON.stringify(initial));
  await page.setViewportSize({ width: 390, height: 844 });
  const backup = await createPlannerBackup(JSON.stringify(initial), catalog);
  let card = await calligraphyCard(page);
  const school = card.locator(`[data-attempt-id="${calligraphySchools[0].id}"]`);
  await school.getByText('履修状況の詳細・編集', { exact: true }).click();
  for (const [status, inProgress, planned, earned] of [['in_progress', 1, 0, 0], ['waiting', 0, 0, 0], ['planned', 0, 1, 0], ['earned', 0, 0, 2], ['in_progress', 1, 0, 0]]) {
    await school.locator('label').filter({ hasText: /^状態/ }).locator('select').selectOption(status);
    await page.waitForFunction(({ key, id, status }) => JSON.parse(localStorage.getItem(key)).items.find(i => i.offeringId === id).status === status, { key: STORAGE_KEY, id: calligraphySchools[0].id, status });
    await assertCalligraphyReferences(page, { inProgress, planned, graduation: earned }, status);
    await page.reload(); card = await calligraphyCard(page);
    await assertCalligraphyReferences(page, { inProgress, planned, graduation: earned }, `${status}/reload`);
    await card.locator(`[data-attempt-id="${calligraphySchools[0].id}"]`).getByText('履修状況の詳細・編集', { exact: true }).click();
  }
  const panel = page.getByRole('region', { name: 'プランナー全データのバックアップ・復元' });
  await panel.locator('input[type=file]').setInputFiles({ name: 'calligraphy-p2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: '確認したバックアップで全件置換する', exact: true }).click();
  await panel.getByText('全データを置き換えて保存しました。再読み込み後も保持されます。', { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await persisted(page)), initial);
  await page.reload(); await assertCalligraphyReferences(page, { inProgress: 0, planned: 0, graduation: 2 }, 'restored earned');
});


import { minimalCases as calligraphyPartialMinimumCases } from './fixtures/calligraphy-partial-details.mjs';
async function assertCalligraphyPartialBody(page, expected) {
  const elective = page.locator('section[aria-labelledby="graduation-progress-heading"] article').filter({ has: page.getByRole('heading', { name: '専門教育：選択', exact: true }) });
  const title = elective.getByText('未完成のカリキュラム科目（卒業算入前）', { exact: true });
  if (expected) {
    await title.waitFor();
    const details = title.locator('..').locator('li');
    assert.equal(await details.count(), 1);
    assert.equal(await details.innerText(), '書道実技 本人記録の構成進捗 1 / 2単位（未完成・卒業算入0）');
  } else assert.equal(await title.count(), 0, 'official priority / zero / completed structure must not create a learner partial detail');
}
for (const program of calligraphyPrograms) test(`calligraphy partial Chromium summer/GW exact body ${program.course}`, async t => {
  const { page } = await open(t, '日本文学科', JSON.stringify({ ...stateForScopeChange(initialState(), catalog, program.scopeId), graduationProfile: calligraphyProfile, items: calligraphyPartialMinimumCases[0][1] }));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [index, [label, items]] of calligraphyPartialMinimumCases.entries()) {
    const state = { ...stateForScopeChange(initialState(), catalog, program.scopeId), graduationProfile: calligraphyProfile, items };
    const raw = JSON.stringify(state);
    await page.evaluate(({ raw, key }) => localStorage.setItem(key, raw), { raw, key: STORAGE_KEY });
    await page.reload();
    await assertCalligraphyPartialBody(page, true);
    await assertCalligraphyReferences(page, { inProgress: 0, planned: items.length === 2 ? 1 : 0, graduation: 0 }, label);
    const courseCard = await calligraphyCard(page);
    await courseCard.getByText('修得: 1 / 2単位 · 未完成', { exact: true }).waitFor();
    assert.equal(await persisted(page), raw);
    const dir = process.env.CALLIGRAPHY_PARTIAL_SCREENSHOT_DIR;
    if (dir) {
      const elective = page.locator('section[aria-labelledby="graduation-progress-heading"] article').filter({ has: page.getByRole('heading', { name: '専門教育：選択', exact: true }) });
      await elective.screenshot({ path: `${dir}/${program.scopeId}-${index}.png`, style: 'header { visibility: hidden !important; transition: none !important; }' });
    }
  }
});

import { repeatProfile, repeatedPayload, importRepeated, payload as repeatPayload, nativeRow as repeatNativeRow, numeric as repeatNumeric } from './fixtures/official-repeatable.mjs';
test('official repeatable Chromium: cap and source total remain separate after reload', async t => {
  const imported = importRepeated(repeatedPayload('政治学', 3));
  const scope = catalog.programs.find(p => p.department === '法律学科').scopeId;
  const state = { ...stateForScopeChange(initialState(), catalog, scope), ...imported, selectedScopeId: scope, graduationProfile: repeatProfile,
    thesisSelection: 'not_selected', thesisProgressByScope: { [scope]: { selection: 'not_selected', status: 'not_started' } } };
  const { page } = await open(t, '法律学科', JSON.stringify(state));
  const section = page.locator('section[aria-labelledby="graduation-progress-heading"]');
  for (let pass = 0; pass < 2; pass++) {
    const notice = section.locator('[data-import-notice-kind="repeatable_limit"]');
    await notice.locator('summary').click();
    await notice.getByText('政治学：公式修得6単位・独立した修得3回のうち、卒業算入4単位。上限2回4単位を超える2単位は他区分へ算入しません。', { exact: true }).waitFor();
    await section.getByText('政治学 4 / 4単位（2 / 2回）。超過2単位は卒業算入外', { exact: true }).waitFor();
    const stored = JSON.parse(await persisted(page));
    assert.equal(stored.schemaVersion, 22);
    assert.deepEqual(stored.importedCourseAchievements, state.importedCourseAchievements);
    assert.deepEqual(stored.importedStudyRecords, state.importedStudyRecords);
    if (!pass) await page.reload();
  }
});

test('official repeatable Chromium: explicit zero conflicting with passed detail is visibly held', async t => {
  const data = repeatPayload([repeatNativeRow('政治学', [2025])]); data.courses[0].earnedCredits = repeatNumeric(0);
  const imported = importRepeated(data), scope = catalog.programs.find(p => p.department === '法律学科').scopeId;
  const state = { ...stateForScopeChange(initialState(), catalog, scope), ...imported, selectedScopeId: scope, graduationProfile: repeatProfile,
    thesisSelection: 'not_selected', thesisProgressByScope: { [scope]: { selection: 'not_selected', status: 'not_started' } } };
  const { page } = await open(t, '法律学科', JSON.stringify(state));
  const notice = page.locator('[data-import-notice-kind="allocation_held"]');
  await notice.locator('summary').click();
  await notice.getByText('政治学：公式の修得合計・S単位と確認できる修得内訳が一致しません。公式合計を補正せず算入を保留しています。', { exact: true }).waitFor();
  const stored = JSON.parse(await persisted(page));
  assert.equal(stored.importedCourseAchievements[0].earnedCreditsTotal, 0);
  assert.equal(stored.importedStudyRecords[0].credits, 2);
});
