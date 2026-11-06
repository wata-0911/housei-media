import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { STORAGE_KEY, PLANNER_WRITE_LOCK, initialState, loadState } from '../src/planner/backup/storage.ts';
import { applyImport, importPreview } from '../src/planner/gradeImport/gradeImportApply.ts';
import { mediaCells, mediaInput } from './fixtures/work-e-media.mjs';

const fixture = name => readFileSync(new URL('./fixtures/work-e-save/synthetic-' + name + '.json', import.meta.url), 'utf8');
const notice = '成績表の科目行の照合先を保存しました。';
let server, browser, origin;
before(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await server?.close(); });

async function open(t, raw, width) {
  assert.equal(loadState({ getItem: () => raw }, catalog).error, null);
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(([key, lock, initial]) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, initial);
    window.saves = { writes: 0, locks: 0 };
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, value) {
      if (k === key) {
        window.saves.writes++;
        if (window.quotaFailure) throw new DOMException('full', 'QuotaExceededError');
      }
      return original.call(this, k, value);
    };
    const request = navigator.locks.request.bind(navigator.locks);
    navigator.locks.request = (name, ...args) => {
      if (name === lock) window.saves.locks++;
      return request(name, ...args);
    };
  }, [STORAGE_KEY, PLANNER_WRITE_LOCK, raw]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(origin + '/planner#media');
  await page.locator('#media-panel').waitFor();
  return { page, context, saved: () => page.evaluate(key => localStorage.getItem(key), STORAGE_KEY),
    counts: () => page.evaluate(() => window.saves) };
}

for (const width of [1280, 390]) test('review, discard, explicitly confirm once and reload at ' + width, async t => {
  const raw = fixture('pending'), original = JSON.parse(raw);
  const { page, saved, counts } = await open(t, raw, width);
  const select = page.locator('#media-panel select');
  const confirm = page.getByRole('button', { name: 'この照合先で確定', exact: true });
  const cancel = page.getByRole('button', { name: 'キャンセル', exact: true });
  const [empty, first, second] = await select.locator('option').evaluateAll(options => options.map(o => o.value));
  assert.equal(empty, '');
  assert.ok(first && second && first !== second);
  await select.selectOption(first);
  await select.press('Escape');
  assert.equal(await select.inputValue(), '');
  await select.selectOption(second);
  await cancel.press('Enter');
  assert.equal(await select.inputValue(), '');
  await select.selectOption(first);
  await page.getByRole('tab').first().click();
  await page.getByRole('tab', { name: 'メディア', exact: true }).click();
  assert.equal(await select.inputValue(), '');
  await select.selectOption(second);
  assert.equal(await saved(), raw);
  assert.deepEqual(await counts(), { writes: 0, locks: 0 });
  assert.equal(await page.getByText(notice, { exact: true }).count(), 0);
  await page.reload();
  await select.waitFor();
  assert.equal(await select.inputValue(), '');
  assert.equal(await saved(), raw);
  await select.selectOption(second);
  await select.focus();
  await page.keyboard.press('Tab');
  assert.ok(await confirm.evaluate(el => el === document.activeElement));
  // A second synchronous submit models a queued repeat before React disables the form.
  await confirm.evaluate(button => button.addEventListener('click', () => button.form.requestSubmit(), { once: true }));
  await page.keyboard.press('Enter');
  await page.getByText(notice, { exact: true }).waitFor();
  const expected = structuredClone(original);
  Object.assign(expected.importedCourseAchievements[0], { selectedOfferingId: second, selectionSource: 'manual' });
  assert.deepEqual(JSON.parse(await saved()), expected);
  assert.deepEqual(await counts(), { writes: 1, locks: 1 });
  await page.reload();
  await page.locator('#media-panel').waitFor();
  assert.deepEqual(JSON.parse(await saved()), expected);
  assert.equal(await confirm.count(), 0);
});

test('exact orphan bytes survive read-only display and reload', async t => {
  const raw = fixture('orphan');
  const { page, counts, saved } = await open(t, raw, 390);
  for (let pass = 0; pass < 2; pass++) {
    const panel = page.locator('#media-panel');
    await panel.getByText(JSON.parse(raw).importedStudyRecords[0].rawName, { exact: true }).waitFor();
    assert.match(await panel.innerText(), /参照のみ/);
    assert.equal(await panel.locator('select, form, button').count(), 0);
    assert.equal(await page.getByText(notice, { exact: true }).count(), 0);
    assert.deepEqual(await counts(), { writes: 0, locks: 0 });
    assert.equal(await saved(), raw);
    if (!pass) await page.reload();
  }
});

test('two writable source rows and one orphan keep distinct drafts and owners', async t => {
  const mixed = JSON.parse(fixture('pending'));
  const cells = mediaCells(mixed.importedCourseAchievements[0].rawName, '夏', '2025');
  cells[2] = '4';
  // Construct the second original separately: reimporting the same subject into
  // the first state intentionally updates its source instead of appending a row.
  const second = applyImport(initialState(), importPreview(mediaInput([cells]), catalog.offerings), catalog.offerings);
  mixed.importedCourseAchievements.push(...second.importedCourseAchievements);
  mixed.importedStudyRecords.push(...second.importedStudyRecords);
  const [orphan] = JSON.parse(fixture('orphan')).importedStudyRecords;
  mixed.importedStudyRecords.push(orphan);
  assert.equal(mixed.importedCourseAchievements.length, 2);
  const raw = JSON.stringify(mixed, null, 2);
  const { page, counts, saved } = await open(t, raw, 390);
  const panel = page.locator('#media-panel'), selects = panel.getByRole('combobox');
  assert.equal(await selects.count(), 2);
  await panel.getByText(orphan.rawName, { exact: true }).waitFor();
  await selects.nth(0).selectOption({ index: 1 });
  const id = await selects.nth(0).inputValue();
  assert.equal(await selects.nth(1).inputValue(), '');
  await selects.nth(1).selectOption({ index: 2 });
  assert.equal(await selects.nth(0).inputValue(), id);
  assert.equal(await saved(), raw);
  await panel.getByRole('button', { name: 'この照合先で確定' }).first().click();
  await page.getByText(notice, { exact: true }).waitFor();
  const expected = structuredClone(mixed);
  Object.assign(expected.importedCourseAchievements[0], { selectedOfferingId: id, selectionSource: 'manual' });
  assert.deepEqual(JSON.parse(await saved()), expected);
  assert.deepEqual(await counts(), { writes: 1, locks: 1 });
  assert.equal(await selects.count(), 1);
  assert.equal(await selects.inputValue(), ''); // New persisted revision invalidates the other draft.
  await panel.getByText(orphan.rawName, { exact: true }).waitFor();
});

test('pending save quota failure preserves original bytes, then explicit retry succeeds', async t => {
  const raw = fixture('pending');
  const { page, counts, saved } = await open(t, raw, 390);
  const select = page.locator('#media-panel select'), confirm = page.getByRole('button', { name: 'この照合先で確定' });
  await select.selectOption({ index: 1 });
  const id = await select.inputValue();
  await page.evaluate(() => { window.quotaFailure = true; });
  await confirm.press('Enter');
  await page.getByText(/変更は反映していません/).waitFor();
  assert.equal(await saved(), raw);
  assert.equal(await page.getByText(notice, { exact: true }).count(), 0);
  assert.deepEqual(await counts(), { writes: 1, locks: 1 }); // One failed attempt.
  await page.evaluate(() => { window.quotaFailure = false; });
  await confirm.press('Enter');
  await page.getByText(notice, { exact: true }).waitFor();
  assert.equal(JSON.parse(await saved()).importedCourseAchievements[0].selectedOfferingId, id);
});

test('competing tab removes the source while pending confirmation waits for the lock', async t => {
  const raw = fixture('pending'), winner = fixture('orphan');
  const { page, context, saved, counts } = await open(t, raw, 1280);
  const other = await context.newPage();
  await other.goto(origin + '/planner');
  await other.evaluate(lock => new Promise(held => {
    navigator.locks.request(lock, () => new Promise(release => { window.release = release; held(); }));
  }), PLANNER_WRITE_LOCK);
  await page.locator('#media-panel select').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'この照合先で確定' }).press('Enter');
  await page.waitForFunction(() => window.saves.locks === 1);
  await other.evaluate(([key, bytes]) => { localStorage.setItem(key, bytes); window.release(); }, [STORAGE_KEY, winner]);
  await page.getByText(/変更は反映していません/).waitFor();
  assert.equal(await saved(), winner);
  assert.equal(await page.getByText(notice, { exact: true }).count(), 0);
  assert.deepEqual(await counts(), { writes: 0, locks: 1 });
  await page.reload();
  await page.locator('#media-panel').getByText(/参照のみ/).waitFor();
  assert.equal(await page.locator('#media-panel select').count(), 0);
  assert.equal(await saved(), winner);
});

test('changed raw before submission is refused before requesting a lock', async t => {
  const raw = fixture('pending'), winner = fixture('orphan');
  const { page, saved, counts } = await open(t, raw, 390);
  await page.locator('#media-panel select').selectOption({ index: 1 });
  // A same-document writer does not deliver a storage event to its own window.
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, winner]);
  const before = await counts();
  await page.getByRole('button', { name: 'この照合先で確定' }).press('Enter');
  await page.getByText(/再読み込みして照合先を確認してください/).waitFor();
  assert.equal(await saved(), winner);
  assert.deepEqual(await counts(), before);
  assert.equal(await page.getByText(notice, { exact: true }).count(), 0);
});
