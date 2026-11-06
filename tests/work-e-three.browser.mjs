import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { loadState, STORAGE_KEY, PLANNER_WRITE_LOCK } from '../src/planner/backup/storage.ts';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { applyImport, importPreview } from '../src/planner/gradeImport/gradeImportApply.ts';
import { mediaCells, mediaInput } from './fixtures/work-e-media.mjs';
const fixture = n => readFileSync(new URL('./fixtures/work-e-three/' + n + '.json', import.meta.url), 'utf8');
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
async function open(t, raw, width = 390) {
  assert.equal(loadState({ getItem: () => raw }, catalog).error, null);
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  t.after(() => context.close());
  await context.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  await context.addInitScript(([key, lock, initial]) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, initial);
    window.counts = { locks: 0, writes: 0 };
    const set = Storage.prototype.setItem, request = navigator.locks.request.bind(navigator.locks);
    Storage.prototype.setItem = function(k, v) {
      if (k === key) {
        window.counts.writes++;
        if (window.quota) throw new DOMException('full', 'QuotaExceededError');
      }
      return set.call(this, k, v);
    };
    navigator.locks.request = (name, ...args) => {
      if (name === lock) window.counts.locks++;
      return request(name, ...args);
    };
    window.flush = () => request(lock, () => {});
  }, [STORAGE_KEY, PLANNER_WRITE_LOCK, raw]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(origin + '/planner#media');
  await page.locator('#media-panel').waitFor();
  return { page, context, saved: () => page.evaluate(k => localStorage.getItem(k), STORAGE_KEY) };
}
async function generic(page, id, patch) {
  if (await page.locator('#imported-achievements').count() === 0) await page.getByRole('tab').first().click();
  await page.locator('#imported-achievements').evaluate((element, [id, patch]) => {
    let fiber = element[Object.keys(element).find(k => k.startsWith('__reactFiber$'))];
    while (fiber && !fiber.memoizedProps?.onChangeCourse) fiber = fiber.return;
    if (!fiber) throw Error('mounted callback missing');
    fiber.memoizedProps.onChangeCourse(id, patch);
  }, [id, patch]);
}
async function quiet(page, raw, saved) {
  await page.evaluate(() => window.flush());
  assert.equal(await saved(), raw);
  assert.deepEqual(await page.evaluate(() => window.counts), { locks: 0, writes: 0 });
  assert.equal(await page.getByText(notice, { exact: true }).count(), 0);
}

test('generic entry refuses reversed duplicate IDs and leaves both full rows readable', async t => {
  const state = JSON.parse(fixture('duplicate-owner'));
  state.importedCourseAchievements.reverse();
  const raw = JSON.stringify(state, null, 2), { page, saved } = await open(t, raw);
  await generic(page, state.importedCourseAchievements[0].id, { selectionSource: 'manual' });
  await quiet(page, raw, saved);
  assert.equal(JSON.parse(await saved()).importedCourseAchievements.length, 2);
});

test('unique original accepts a normal maintenance selection and reloads it', async t => {
  const raw = fixture('history-mixed'), state = JSON.parse(raw);
  const { page, saved } = await open(t, raw, 1280);
  await page.getByRole('tab').first().click();
  const panel = page.locator('#imported-achievements');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: '保存済み全件のメンテナンスを表示' }).click();
  const [row] = state.importedCourseAchievements;
  await panel.getByRole('combobox', { name: row.rawName + 'の照合先', exact: true }).selectOption(row.candidateOfferingIds[0]);
  await page.getByText(notice, { exact: true }).waitFor();
  const savedState = JSON.parse(await saved());
  assert.equal(savedState.importedCourseAchievements[0].selectedOfferingId, row.candidateOfferingIds[0]);
  assert.deepEqual(savedState.importedStudyRecords, state.importedStudyRecords);
  for (const field of ['id', 'fingerprint', 'rawName', 'earnedCreditsTotal', 'schoolingCreditsTotal']) {
    assert.equal(savedState.importedCourseAchievements[0][field], row[field]);
  }
  const bytes = await saved();
  await page.reload();
  assert.equal(await saved(), bytes);
});

test('real array reorder, element and length changes save once each, preserving unrelated state', async t => {
  const original = JSON.parse(fixture('history-mixed')), [row] = original.importedCourseAchievements;
  const ids = catalog.offerings.filter(o => o.courseId === row.courseId).map(o => o.id).slice(0, 3);
  assert.equal(ids.length, 3);
  row.candidateOfferingIds = ids.slice(0, 2);
  for (const replacement of [[ids[1], ids[0]], [ids[0], ids[2]], [ids[0]]]) {
    const raw = JSON.stringify(original, null, 2), { page, saved } = await open(t, raw);
    await generic(page, row.id, { candidateOfferingIds: [...row.candidateOfferingIds], match: row.match });
    await quiet(page, raw, saved);
    await generic(page, row.id, { candidateOfferingIds: replacement });
    await page.getByText(notice, { exact: true }).waitFor();
    const expected = structuredClone(original);
    expected.importedCourseAchievements[0].candidateOfferingIds = replacement;
    assert.deepEqual(JSON.parse(await saved()), expected);
    assert.deepEqual(await page.evaluate(() => window.counts), { locks: 1, writes: 1 });
  }
});

for (const width of [1280, 390]) test('orphan history and multiple real originals stay separate at ' + width, async t => {
  const state = JSON.parse(fixture('history-mixed'));
  const next = applyImport(state, importPreview(mediaInput([mediaCells('健康・スポーツ科学概論')]), catalog.offerings), catalog.offerings);
  next.items = [];
  assert.equal(next.importedCourseAchievements.length, 2);
  const raw = ' \n' + JSON.stringify(next, null, 2), { page, saved } = await open(t, raw, width);
  const history = page.getByRole('region', { name: '照合先に基づくメディア履歴' });
  const name = JSON.parse(fixture('history-alone')).importedStudyRecords[0].rawName;
  assert.equal(await history.getByText(name, { exact: true }).count(), 1);
  assert.equal(await history.locator('select,button').count(), 0);
  assert.equal(await page.locator('[data-official-media-id]').count(), 1);
  assert.equal(await page.locator('[data-official-media-id]').getByText(name, { exact: true }).count(), 0);
  await quiet(page, raw, saved);
  await page.reload();
  await history.waitFor();
  assert.equal(await history.getByText(name, { exact: true }).count(), 1);
  assert.equal(await saved(), raw);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

test('generic update preserves raw on quota failure and on a competing writer', async t => {
  const raw = fixture('history-mixed'), [row] = JSON.parse(raw).importedCourseAchievements;
  const { page, saved, context } = await open(t, raw);
  await page.evaluate(() => { window.quota = true; });
  await generic(page, row.id, { selectionSource: 'manual' });
  await page.getByText(/変更は反映していません/).waitFor();
  assert.equal(await saved(), raw);
  assert.equal(await page.getByText(notice, { exact: true }).count(), 0);
  await page.reload();
  await page.locator('#media-panel').waitFor();
  const other = await context.newPage();
  await other.goto(origin + '/planner');
  await other.evaluate(lock => new Promise(acquired => {
    navigator.locks.request(lock, () => new Promise(release => { window.release = release; acquired(); }));
  }), PLANNER_WRITE_LOCK);
  await generic(page, row.id, { selectionSource: 'manual' });
  await page.waitForFunction(() => window.counts.locks === 1);
  const winner = raw + '\n';
  await other.evaluate(([k,v]) => { localStorage.setItem(k,v); window.release(); }, [STORAGE_KEY, winner]);
  await page.getByText(/変更は反映していません/).waitFor();
  assert.equal(await saved(), winner);
  assert.deepEqual(await page.evaluate(() => window.counts), { locks: 1, writes: 0 });
  assert.equal(await page.getByText(notice, { exact: true }).count(), 0);
});
