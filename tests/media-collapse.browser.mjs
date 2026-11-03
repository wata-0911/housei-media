// External Playwright/Chromium, as in planner-save-lock.browser.mjs.
// PLANNER_SCREENSHOT_DIR optionally saves desktop/mobile evidence outside the repo.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { initialState, STORAGE_KEY, BACKUP_KEY } from '../src/planner/backup/storage.ts';
import { stateForScopeChange } from '../src/planner/graduation/thesisSelection.ts';
import { summarizeCredits } from '../src/planner/calculations.ts';
import { isMediaSchooling, mediaProgressSummary, mediaShareViewModel } from '../src/planner/progress/mediaSchooling.ts';

const port = Number(process.env.PLANNER_BROWSER_PORT || 4197);
const origin = `http://127.0.0.1:${port}`;
const offerings = new Map(catalog.offerings.map(row => [row.id, row]));
const courses = catalog.offerings.filter(row => isMediaSchooling(row) && row.courseId && row.resolutionStatus === 'matched').slice(0, 4);
let browser, server;
before(async () => {
  const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: new URL('../', import.meta.url).pathname, stdio: 'pipe' });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(server.exitCode, null, output);
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* Wait for Vite. */ }
    await delay(200);
  }
  assert.ok(ready, output);
  browser = await chromium.launch({ headless: true, ...(process.env.PLANNER_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANNER_BROWSER_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

function fixture() {
  const state = stateForScopeChange(initialState(), catalog, catalog.programs.find(row => row.department === '日本文学科').scopeId);
  state.graduationProfile.admissionType = 'other_transfer';
  state.items = courses.slice(0, 3).map(row => ({ offeringId: row.id, status: 'in_progress', plannedYear: 2026, plannedTerm: null, studyYear: 2, earnedOrder: null }));
  const progress = (index, totalLessons, lessons = []) => ({ offeringId: courses[index].id, totalLessons, lessons, assessments: [{ id: `assessment-${index}`, type: 'other', label: '確認用試験', scheduledDate: null, completed: false }] });
  state.mediaSchoolingProgress = {
    [courses[0].id]: progress(0, 14, [{ lesson: 1, videoCompleted: true, testCompleted: true }, { lesson: 5, videoCompleted: true, testCompleted: false }]),
    [courses[1].id]: progress(1, null),
    [courses[2].id]: progress(2, 2, [1, 2].map(lesson => ({ lesson, videoCompleted: true, testCompleted: true }))),
    [courses[3].id]: progress(3, 3),
  };
  state.importedCourseAchievements = [{ id: 'collapse-imported-media', fingerprint: 'collapse-imported-media', source: 'hosei_import', rawName: courses[3].name, categoryRaw: null, capturedAt: '', earnedCreditsTotal: 0, schoolingCreditsTotal: 0, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source', courseId: courses[3].courseId, selectedOfferingId: courses[3].id, selectionSource: 'manual', match: 'exact_unique', candidateOfferingIds: [courses[3].id] }];
  state.importedCourseUserMeta = { 'collapse-imported-media': { lifecycleStatus: 'in_progress', plannedYear: 2026, plannedTerm: '前期', studyYear: 2 } };
  return state;
}
const card = (page, index) => page.locator('#media-panel article').filter({ has: page.getByRole('heading', { name: courses[index].name, exact: true }) });
const toggle = (page, index) => card(page, index).getByRole('button', { name: /の各回一覧を/ });
async function open(t, mobile = false) {
  const state = fixture();
  const raw = JSON.stringify(state);
  const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(({ raw, key, backupKey }) => {
    if (!localStorage.getItem('collapse-fixture')) {
      localStorage.setItem(key, raw); localStorage.setItem(backupKey, 'prior recovery bytes'); localStorage.setItem('collapse-fixture', '1');
    }
    window.collapseWrites = [];
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) {
      if (k === key || k === backupKey) window.collapseWrites.push({ key: k, value });
      return setItem.call(this, k, value);
    };
  }, { raw, key: STORAGE_KEY, backupKey: BACKUP_KEY });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no browser errors'));
  await page.goto(origin + '/planner#media');
  await card(page, 3).getByRole('heading', { name: courses[3].name, exact: true }).waitFor();
  return { page, context, state, raw };
}
const persisted = page => page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
async function unchanged(page, raw) {
  assert.equal(await persisted(page), raw, 'exact primary JSON bytes retained');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY), 'prior recovery bytes');
  assert.deepEqual(await page.evaluate(() => window.collapseWrites), [], 'no storage writes during disclosure');
}
async function screenshot(page, name) {
  if (!process.env.PLANNER_SCREENSHOT_DIR) return;
  await mkdir(process.env.PLANNER_SCREENSHOT_DIR, { recursive: true });
  await page.locator('#media-panel').screenshot({ path: join(process.env.PLANNER_SCREENSHOT_DIR, `${name}.png`) });
  if (name.startsWith('desktop-')) await card(page, 0).screenshot({ path: join(process.env.PLANNER_SCREENSHOT_DIR, `${name}-card.png`) });
}
async function waitProgress(page, index, matches) {
  await page.waitForFunction(({ key, id, expected }) => {
    const row = JSON.parse(localStorage.getItem(key)).mediaSchoolingProgress[id];
    return Object.entries(expected).every(([field, value]) => JSON.stringify(row[field]) === JSON.stringify(value));
  }, { key: STORAGE_KEY, id: courses[index].id, expected: matches });
}
function aggregates(state) {
  return {
    credits: summarizeCredits(state.items, offerings),
    summaries: Object.values(state.mediaSchoolingProgress).map(mediaProgressSummary),
    share: mediaShareViewModel(state.items, offerings, state.mediaSchoolingProgress, [{ offering: courses[3], name: courses[3].name }]),
  };
}

test('desktop hover: disclosure uses shared white/navy and navy/orange colors in both states', async t => {
  const { page, raw } = await open(t);
  const white = 'rgb(255, 255, 255)', navy = 'rgb(0, 34, 85)', orange = 'rgb(240, 106, 20)';
  const colors = locator => locator.evaluate(async el => {
    await Promise.all(el.getAnimations().map(animation => animation.finished));
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.equal(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), true);
  const reference = page.getByRole('button', { name: '科目検索へ戻る', exact: true });
  await reference.hover();
  t.diagnostic(JSON.stringify({ referenceHover: await colors(reference) }));
  const control = toggle(page, 0);
  await page.mouse.move(0, 0);
  await control.scrollIntoViewIfNeeded();
  const normal = await colors(control);
  t.diagnostic(JSON.stringify({ disclosureNormal: normal }));
  assert.deepEqual(normal, { background: white, color: navy });
  await control.hover();
  const hovered = await colors(control);
  t.diagnostic(JSON.stringify({ disclosureHover: hovered }));
  assert.deepEqual(hovered, { background: navy, color: orange });
  await control.click();
  assert.equal(await control.getAttribute('aria-expanded'), 'true');
  await control.hover();
  assert.deepEqual(await colors(control), { background: navy, color: orange });
  await page.mouse.move(0, 0);
  assert.deepEqual(await colors(control), { background: white, color: navy });
  await control.focus(); await control.press('Space');
  assert.equal(await control.getAttribute('aria-expanded'), 'false');
  const focus = await control.evaluate(el => ({ visible: el.matches(':focus-visible'), style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth, color: getComputedStyle(el).outlineColor }));
  t.diagnostic(JSON.stringify({ disclosureFocus: focus }));
  assert.deepEqual(focus, { visible: true, style: 'solid', width: '2px', color: navy });
  await unchanged(page, raw);
});

test('desktop: independent disclosure, always-visible summaries, keyboard/focus, exact JSON and aggregates', async t => {
  const { page, state, raw } = await open(t);
  assert.match(await card(page, 0).innerText(), /動画 2\/14.*テスト 1\/14/s);
  assert.match(await card(page, 0).innerText(), /各回の動画・テスト：未完了あり/);
  assert.match(await card(page, 1).innerText(), /全回数未設定（完了判定なし）/);
  assert.doesNotMatch(await card(page, 1).innerText(), /すべて完了/);
  assert.match(await card(page, 2).innerText(), /各回の動画・テスト：すべて完了/);
  assert.match(await card(page, 3).innerText(), /未完了あり/);
  const controls = [0, 2, 3].map(index => toggle(page, index));
  const ids = [];
  for (const control of controls) {
    assert.equal(await control.getAttribute('aria-expanded'), 'false');
    const id = await control.getAttribute('aria-controls'); ids.push(id);
    assert.equal(await page.locator(`[id="${id}"]`).isVisible(), false);
  }
  assert.equal(new Set(ids).size, 3);
  assert.equal(await card(page, 0).getByLabel(`${courses[0].name}の全回数`, { exact: true }).isVisible(), true);
  assert.equal(await card(page, 0).getByRole('heading', { name: '試験・評価予定' }).isVisible(), true);
  await screenshot(page, 'desktop-collapsed');
  await controls[0].focus(); await controls[0].press('Enter');
  assert.equal(await controls[0].getAttribute('aria-expanded'), 'true');
  assert.equal(await controls[0].evaluate(el => el === document.activeElement), true);
  const focus = await controls[0].evaluate(el => ({ visible: el.matches(':focus-visible'), style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth }));
  assert.equal(focus.visible, true); assert.equal(focus.style, 'solid'); assert.equal(focus.width, '2px');
  assert.equal(await controls[1].getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('Tab');
  assert.equal(await card(page, 0).getByRole('checkbox').first().evaluate(el => el === document.activeElement), true);
  await screenshot(page, 'desktop-expanded');
  await controls[0].focus(); await controls[0].press('Space');
  assert.equal(await controls[0].getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('Tab');
  assert.equal(await card(page, 0).getByRole('button', { name: '試験を追加', exact: true }).evaluate(el => el === document.activeElement), true, 'hidden lesson checkboxes are skipped');
  await controls[2].click();
  assert.equal(await controls[2].getAttribute('aria-expanded'), 'true');
  assert.equal(await controls[0].getAttribute('aria-expanded'), 'false');
  await unchanged(page, raw);
  assert.deepEqual(aggregates(JSON.parse(await persisted(page))), aggregates(state));
});

test('bulk video ON, individual OFF and independent test changes retain all other state and survive collapse/reload', async t => {
  const { page, state } = await open(t);
  await toggle(page, 0).click();
  const checks = card(page, 0).getByRole('checkbox');
  const lessons = [1, 2, 3, 4, 5].map(lesson => ({ lesson, videoCompleted: true, testCompleted: lesson === 1 }));
  assert.equal(await checks.nth(6).isChecked(), false);
  await checks.nth(6).click(); // Video 4 bulk-completes 1..4, preserving video 5.
  await waitProgress(page, 0, { lessons });
  assert.equal(await checks.nth(6).isChecked(), true);
  await checks.nth(2).click(); lessons.splice(1, 1); // Both false: existing storage omits the empty lesson.
  await waitProgress(page, 0, { lessons });
  assert.equal(await checks.nth(2).isChecked(), false);
  await checks.nth(7).click(); lessons.find(row => row.lesson === 4).testCompleted = true;
  await waitProgress(page, 0, { lessons });
  assert.equal(await checks.nth(7).isChecked(), true);
  await checks.nth(1).click(); lessons[0].testCompleted = false;
  await waitProgress(page, 0, { lessons });
  assert.equal(await checks.nth(1).isChecked(), false);
  const expected = structuredClone(state); expected.mediaSchoolingProgress[courses[0].id].lessons = lessons;
  assert.deepEqual(JSON.parse(await persisted(page)), expected);
  await toggle(page, 0).click();
  assert.match(await card(page, 0).innerText(), /動画 4\/14.*テスト 1\/14/s);
  const raw = await persisted(page);
  await page.evaluate(() => { window.collapseWrites = []; });
  await toggle(page, 0).click(); await toggle(page, 0).click();
  assert.equal(await persisted(page), raw);
  assert.deepEqual(await page.evaluate(() => window.collapseWrites), []);
  await page.reload(); await toggle(page, 0).waitFor();
  assert.equal(await toggle(page, 0).getAttribute('aria-expanded'), 'false');
  await toggle(page, 0).click();
  assert.equal(await checks.nth(2).isChecked(), false);
  assert.equal(await checks.nth(7).isChecked(), true);
  assert.deepEqual(JSON.parse(await persisted(page)), expected);
});

test('imported in-progress media uses the same independent disclosure and offering-keyed save', async t => {
  const { page, state } = await open(t);
  await toggle(page, 3).click();
  const checks = card(page, 3).getByRole('checkbox');
  assert.equal(await checks.nth(4).isChecked(), false);
  await checks.nth(4).click();
  const lessons = [1, 2, 3].map(lesson => ({ lesson, videoCompleted: true, testCompleted: false }));
  await waitProgress(page, 3, { lessons });
  assert.equal(await checks.nth(4).isChecked(), true);
  await checks.nth(3).click(); lessons[1].testCompleted = true;
  await waitProgress(page, 3, { lessons });
  assert.equal(await checks.nth(3).isChecked(), true);
  const expected = structuredClone(state); expected.mediaSchoolingProgress[courses[3].id].lessons = lessons;
  assert.deepEqual(JSON.parse(await persisted(page)), expected, 'official source rows and all other progress retained');
  assert.equal(await toggle(page, 0).getAttribute('aria-expanded'), 'false');
  await toggle(page, 3).click();
  assert.match(await card(page, 3).innerText(), /動画 3\/3.*テスト 1\/3.*未完了あり/s);
});

test('total settings and assessment editing stay visible with lesson lists collapsed', async t => {
  const { page } = await open(t);
  const current = card(page, 1);
  assert.equal(await current.getByRole('button', { name: /の各回一覧を/ }).count(), 0);
  await current.getByRole('button', { name: '14回', exact: true }).click();
  await waitProgress(page, 1, { totalLessons: 14 });
  assert.equal(await toggle(page, 1).getAttribute('aria-expanded'), 'false');
  assert.match(await current.innerText(), /未完了あり/);
  const total = current.getByLabel(`${courses[1].name}の全回数`, { exact: true });
  await total.fill('15'); await total.press('Enter'); await waitProgress(page, 1, { totalLessons: 15 });
  const label = current.getByLabel('試験・評価予定の名称', { exact: true });
  await label.fill('折りたたみ中の試験'); await label.press('Enter');
  const date = current.getByLabel('予定日', { exact: true });
  await date.fill('2026-11-20'); await date.press('Enter');
  await current.getByRole('checkbox', { name: '実施済み', exact: true }).click();
  await waitProgress(page, 1, { assessments: [{ id: 'assessment-1', type: 'other', label: '折りたたみ中の試験', scheduledDate: '2026-11-20', completed: true }] });
  assert.equal(await current.getByRole('checkbox', { name: '実施済み', exact: true }).isChecked(), true);
  assert.equal(await toggle(page, 1).getAttribute('aria-expanded'), 'false');
  assert.match(await current.innerText(), /未完了あり/, 'assessment completion is distinct from lesson completion');
  await total.fill(''); await total.press('Enter'); await waitProgress(page, 1, { totalLessons: null });
  assert.match(await current.innerText(), /全回数未設定（完了判定なし）/);
});

test('delete/Undo preserves lesson data and recreates a collapsed card', async t => {
  const { page, state } = await open(t);
  await toggle(page, 0).click();
  await page.getByRole('tab', { name: '年間履修計画', exact: true }).click();
  await page.locator(`[data-attempt-id="${courses[0].id}"]`).getByRole('button', { name: '履修状況を削除', exact: true }).click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).waitFor();
  const removed = JSON.parse(await persisted(page));
  assert.equal(removed.items.some(row => row.offeringId === courses[0].id), false);
  assert.deepEqual(removed.mediaSchoolingProgress, state.mediaSchoolingProgress);
  await page.getByRole('tab', { name: 'メディア', exact: true }).click();
  assert.equal(await card(page, 0).count(), 0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await toggle(page, 0).waitFor();
  assert.equal(await toggle(page, 0).getAttribute('aria-expanded'), 'false');
  assert.deepEqual(JSON.parse(await persisted(page)), state);
  await toggle(page, 0).click();
  assert.equal(await card(page, 0).getByRole('checkbox').first().isChecked(), true);
});

test('display-only disclosure remains usable when external-storage protection disables editing', async t => {
  const { page, context, raw } = await open(t);
  const other = await context.newPage(); await other.goto(origin);
  await other.evaluate(key => localStorage.setItem(key, 'external changed raw'), STORAGE_KEY);
  await page.bringToFront();
  await page.getByRole('alert').filter({ hasText: '別の画面で保存データが変更' }).waitFor();
  await toggle(page, 0).click();
  assert.equal(await toggle(page, 0).getAttribute('aria-expanded'), 'true');
  const checks = card(page, 0).getByRole('checkbox');
  for (const check of await checks.all()) assert.equal(await check.isDisabled(), true);
  await toggle(page, 0).click();
  assert.equal(await persisted(page), 'external changed raw');
  assert.deepEqual(await page.evaluate(() => window.collapseWrites), [], 'display does not try to overwrite external state');
  assert.notEqual(await persisted(page), raw);
});

test('390px touch viewport: collapsed overview and expanded controls fit without changing stored JSON', async t => {
  const { page, raw } = await open(t, true);
  await screenshot(page, 'mobile-collapsed');
  await toggle(page, 0).tap();
  assert.equal(await toggle(page, 0).getAttribute('aria-expanded'), 'true');
  assert.equal(await toggle(page, 2).getAttribute('aria-expanded'), 'false');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  await screenshot(page, 'mobile-expanded');
  await toggle(page, 0).tap();
  await unchanged(page, raw);
});
