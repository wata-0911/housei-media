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
import { isMediaSchooling } from '../src/planner/mediaSchooling.ts';
import { createPublicCourse } from '../src/planner/publicCourses.ts';
import { applyImport, importPreview } from '../src/planner/gradeImportApply.ts';

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
