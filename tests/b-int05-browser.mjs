import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';
import { serveAc } from './ac-static-server.mjs';

const { chromium } = process.env.PLANNER_PLAYWRIGHT_MODULE
  ? await import(process.env.PLANNER_PLAYWRIGHT_MODULE) : createRequire(import.meta.url)('playwright');
const base = process.env.B_INT05_DIST;
assert.ok(base, 'B_INT05_DIST must point to the isolated AC build');
const mediaTitle = 'ビジネス英語A';
const reportTitle = '世界地誌（1）（アジア）';
const planned = page => page.locator('[data-attempt-id]');
const status = page => page.getByTestId('save-status');
const pinned = page => page.getByTestId('saved-display-state').filter({ hasText: '読取時点の検証済み' }).waitFor();
const legacyKeys = page => page.evaluate(() => [localStorage.getItem('hosei-planner:v1'), localStorage.getItem('hosei-planner:v1:recovery')]);

function fixtureGradeFile() {
  const empty = { raw: '', value: null }, schooling = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '',
    year: null, term: null, date: null, credits: null, grade: null };
  return Buffer.from(' \n' + JSON.stringify({ schemaVersion: 1, source: 'hosei_web_learning_grade_table',
    capturedAt: '2026-11-01T00:00:00.000Z', courses: [{ rawName: mediaTitle, categoryRaw: null,
      compositionCredits: { raw: '4', value: 4 }, earnedCredits: { raw: '1', value: 1 },
      additionalEnrollment: empty, recognizedExemption: empty, schoolingCredits: empty,
      reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
      creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false },
      schoolings: [schooling, schooling] }] }, null, 2) + '\r\n');
}

for (const width of [390, 1280]) test('B-INT05 Chromium ' + width + 'px native save, admission, restore', { timeout: 220000 }, async () => {
  const server = await serveAc(base);
  const browser = await chromium.launch({ executablePath: process.env.PLANNER_BROWSER_EXECUTABLE || '/usr/bin/chromium',
    headless: true, args: ['--disable-background-networking', '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1'] });
  const denied = [], errors = [], writes = [];
  const beginning = Date.now();
  const phases = [];
  const phase = name => { phases.push({ name, elapsedMs: Date.now() - beginning }); };
  async function context() {
    const result = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true,
      serviceWorkers: 'block', reducedMotion: 'reduce' });
    await result.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === server.origin) return route.continue();
      denied.push(url.origin);
      return route.abort('blockedbyclient');
    });
    await result.exposeBinding('__bInt05Write', (_, entry) => writes.push(entry));
    await result.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        void window.__bInt05Write({ store: this.name, database: this.transaction.db.name });
        return put.apply(this, args);
      };
    });
    result.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    return result;
  }
  const first = await context();
  let restored;
  async function open(target) {
    const page = await target.newPage();
    page.setDefaultTimeout(25000);
    await page.goto(server.origin + '/__dev/ac');
    await status(page).filter({ hasText: /新規計画を開始できます|再読込・照合/ }).waitFor();
    return page;
  }
  async function confirm(page, restore = false) {
    const confirmation = page.getByRole('group', { name: '保存確認', exact: true });
    const protectedFile = page.waitForEvent('download');
    await confirmation.getByRole('button', { name: '変更前の原文を保護' }).click();
    await protectedFile;
    await confirmation.getByLabel('保護ファイルと保存内容を確認しました').check();
    const submit = confirmation.getByRole('button', { name: '確認して保存' });
    if (restore) {
      assert.equal(await submit.isDisabled(), true);
      await confirmation.getByLabel('このバックアップを復元元として採用します').check();
    }
    await submit.click();
    await status(page).filter({ hasText: '保存済み' }).waitFor();
    await pinned(page);
  }
  async function save(page) {
    await page.getByRole('button', { name: /^(新規計画の保存を準備|保存内容を準備)$/ }).click();
    await confirm(page);
  }
  async function add(page, title, year, method) {
    await page.locator('#course-query').fill(title);
    const row = page.getByRole('list', { name: '制度科目の検索結果' }).getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first();
    await row.getByRole('button', { name: 'この配置を選ぶ' }).click();
    const form = page.getByRole('form', { name: '履修記録の入力' });
    await form.getByLabel('予定年度（空欄は未設定）').fill(year);
    await form.getByLabel('履修方法', { exact: true }).selectOption(method);
    await form.getByRole('button', { name: '下書きへ追加' }).click();
    await form.waitFor({ state: 'detached' });
  }
  async function dismissDialog(page, action) {
    const pending = page.waitForEvent('dialog');
    const clicked = action();
    await (await pending).dismiss();
    await clicked;
  }
  const learner = card => card.getByRole('form', { name: /の本人評価$/ });

  try {
    const page = await open(first);
    await save(page);
    assert.equal(writes.length, 1);
    await add(page, mediaTitle, '2027', 'media');
    await add(page, mediaTitle, '2028', 'media');
    await add(page, reportTitle, '', 'correspondence');
    await add(page, reportTitle, '2028', 'schooling');
    assert.equal(writes.length, 1);
    assert.equal(await planned(page).count(), 4);
    phase('search-to-four-separate-attempts');

    const cards = planned(page), media = cards.nth(0), separate = cards.nth(1), correspondence = cards.nth(2), schooling = cards.nth(3);
    const mediaForm = media.getByRole('form', { name: /メディア進捗$/ });
    await mediaForm.getByLabel('全回数（空欄は未確認）').fill('2');
    await mediaForm.getByLabel('追加する回', { exact: true }).fill('1');
    await mediaForm.getByLabel('追加回の動画完了').check();
    assert.equal(await page.getByRole('button', { name: '保存内容を準備' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), false);
    await dismissDialog(page, () => page.getByRole('link', { name: /旧schema22 Planner/ }).click());
    assert.match(page.url(), /\/__dev\/ac$/);
    assert.equal(await mediaForm.getByLabel('全回数（空欄は未確認）').inputValue(), '2');
    await dismissDialog(page, () => page.getByRole('button', { name: '保存内容を再読込' }).click());
    assert.equal(await mediaForm.getByLabel('追加する回', { exact: true }).inputValue(), '1');
    await mediaForm.getByRole('button', { name: '進捗を下書きに反映' }).click();

    const correspondenceForm = correspondence.getByRole('form', { name: /通信進捗$/ });
    await correspondenceForm.getByLabel('必要リポート数').fill('0');
    await correspondenceForm.getByLabel('追加する提出回').fill('1');
    await correspondenceForm.getByLabel('提出状況').selectOption('passed');
    await correspondenceForm.locator('select[name="new-grade"]').selectOption('A');
    await correspondenceForm.getByLabel('単位修得試験（本人記録）').selectOption('D');
    await correspondenceForm.getByRole('button', { name: '進捗を下書きに反映' }).click();
    await learner(separate).getByLabel('最終評価（本人記録）').selectOption('S');
    await learner(schooling).getByLabel('スクーリング評価（本人記録）').selectOption('A');
    await learner(schooling).getByRole('button', { name: '進捗を下書きに反映' }).click();
    await learner(separate).getByRole('button', { name: '進捗を下書きに反映' }).click();
    assert.equal(writes.length, 1);
    await save(page);
    assert.equal(writes.length, 2);
    phase('unsent-protected-and-explicit-write');
    await page.reload();
    await pinned(page);
    assert.equal(await mediaForm.getByLabel('全回数（空欄は未確認）').inputValue(), '2');
    assert.equal(await mediaForm.getByRole('group', { name: '第1回' }).getByLabel('動画完了', { exact: true }).isChecked(), true);
    assert.equal(await learner(media).getByLabel('最終評価（本人記録）').inputValue(), '');
    assert.equal(await learner(separate).getByLabel('最終評価（本人記録）').inputValue(), 'S');
    assert.equal(await correspondenceForm.getByLabel('単位修得試験（本人記録）').inputValue(), 'D');
    assert.equal(await learner(schooling).getByLabel('スクーリング評価（本人記録）').inputValue(), 'A');

    const grade = page.getByRole('region', { name: '成績ファイルから対象を確認' });
    await grade.getByLabel('成績 JSON（原行参照）').setInputFiles({ name: 'synthetic-grade.json',
      mimeType: 'application/json', buffer: fixtureGradeFile() });
    await grade.getByLabel('成績原行').selectOption('0');
    assert.match(await grade.textContent(), /修得 1・構成 4単位.*対応未照合/);
    const choices = grade.getByRole('button', { name: /本人入力を開く/ });
    assert.equal(await choices.count(), 2);
    await choices.filter({ hasText: ' / 2028 / ' }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-attempt-id')),
      await separate.getAttribute('data-attempt-id'));
    assert.equal(writes.length, 2);
    phase('raw-grade-reference-no-association-or-write');

    const stableIds = await cards.evaluateAll(rows => rows.map(row => row.dataset.attemptId));
    await separate.getByRole('button', { name: '計画から削除' }).click();
    await save(page);
    await page.reload();
    await pinned(page);
    await separate.getByRole('button', { name: 'この履修回をUndo' }).click();
    await save(page);
    assert.equal(await learner(separate).getByLabel('最終評価（本人記録）').inputValue(), 'S');
    const backup = page.waitForEvent('download');
    await page.getByRole('button', { name: '可搬バックアップをダウンロード' }).click();
    const backupFile = await readFile(await (await backup).path());
    assert.equal(JSON.parse(backupFile).backupVersion, 3);
    assert.equal(writes.length, 4);
    restored = await context();
    const newPage = await open(restored);
    await newPage.getByLabel('可搬バックアップから復元').setInputFiles({ name: 'synthetic-restore.json',
      mimeType: 'application/json', buffer: backupFile });
    await confirm(newPage, true);
    assert.deepEqual(await planned(newPage).evaluateAll(rows => rows.map(row => row.dataset.attemptId)), stableIds);
    assert.equal(await learner(planned(newPage).nth(1)).getByLabel('最終評価（本人記録）').inputValue(), 'S');
    assert.equal(writes.length, 5);
    assert.deepEqual(await legacyKeys(page), [null, null]);
    assert.deepEqual(await legacyKeys(newPage), [null, null]);
    phase('delete-undo-portable-restore');

    const otherTab = await open(first);
    await pinned(otherTab);
    await mediaForm.getByLabel('全回数（空欄は未確認）').fill('3');
    const otherEvaluation = learner(planned(otherTab).nth(1));
    await otherEvaluation.getByLabel('最終評価（本人記録）').selectOption('A');
    await otherEvaluation.getByRole('button', { name: '進捗を下書きに反映' }).click();
    await save(otherTab);
    await page.getByTestId('saved-display-state').filter({ hasText: '別画面' }).waitFor();
    assert.equal(await mediaForm.getByLabel('全回数（空欄は未確認）').inputValue(), '3');
    assert.equal(await mediaForm.getByRole('button', { name: '進捗を下書きに反映' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(denied, []);
    assert.equal(writes.length, 6);
    assert.ok(writes.every(row => row.store === 'authority' && row.database === 'hosei-yi06-isolated-v1'));
    phase('cross-tab-hold-retains-unsubmitted-input');
    console.log(JSON.stringify({ width, phases, officialAssociation: 'unverified', writes, externalRequests: denied, errors }));
  } finally {
    await restored?.close();
    await first.close();
    await browser.close();
    await server.close();
  }
});
