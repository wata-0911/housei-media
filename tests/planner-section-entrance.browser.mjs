// Focused entrance/lifecycle regression checks; external Playwright, no new dependencies.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { initialState, STORAGE_KEY } from '../src/planner/backup/storage.ts';
import { stateForScopeChange } from '../src/planner/graduation/thesisSelection.ts';
import { createPlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { isMediaSchooling } from '../src/planner/progress/mediaSchooling.ts';

const port = Number(process.env.PLANNER_BROWSER_PORT || 4186);
const origin = `http://127.0.0.1:${port}`;
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

async function screenshot(page, name) {
  if (!process.env.PLANNER_SCREENSHOT_DIR) return;
  await mkdir(process.env.PLANNER_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PLANNER_SCREENSHOT_DIR, name + '.png') });
}
const numeric = value => ({ raw: String(value), value });
const grade = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-24T00:00:00.000Z', courses: [{
  rawName: '登場演出検証用の未照合科目', categoryRaw: '専門', compositionCredits: numeric(4), additionalEnrollment: numeric(0),
  recognizedExemption: { raw: '', value: null }, earnedCredits: numeric(4), schoolingCredits: numeric(0),
  reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
  creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false },
  schoolings: Array.from({ length: 2 }, () => ({ rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null })),
}] };

for (const width of [1440, 390]) for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`${width}px / ${reducedMotion}: entrance once, tab remounts and saves stay visible`, async t => {
    const state = stateForScopeChange(initialState(), catalog, catalog.programs.find(row => row.department === '日本文学科').scopeId);
    const media = catalog.offerings.find(isMediaSchooling);
    state.items.push({ offeringId: media.id, status: 'planned', plannedYear: 2026, plannedTerm: null, studyYear: 1, earnedOrder: null });
    state.mediaSchoolingProgress[media.id] = { offeringId: media.id, totalLessons: 14, lessons: [], assessments: [{ id: 'entrance-assessment', type: 'other', label: '初期名', scheduledDate: null, completed: false }] };
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) });
    t.after(() => context.close());
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(({ key, raw }) => {
      localStorage.setItem(key, raw);
      window.entranceFrames = [];
      const sample = () => {
        const shell = document.querySelector('[role=tablist]')?.parentElement;
        if (shell) {
          const s = getComputedStyle(shell);
          window.entranceFrames.push({ opacity: Number(s.opacity), transform: s.transform });
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, { key: STORAGE_KEY, raw: JSON.stringify(state) });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/planner');
    const tabs = page.getByRole('tablist');
    const shell = tabs.locator('..');
    const guide = page.getByText('一部要件のみ自動判定しています。卒業可否を保証しません。', { exact: true }).first().locator('..');
    if (reducedMotion === 'reduce') {
      assert.equal(await shell.evaluate(el => getComputedStyle(el).opacity), '1', 'offscreen content is immediately readable in reduce');
      assert.equal(await guide.evaluate(el => getComputedStyle(el).opacity), '1');
    }
    await tabs.scrollIntoViewIfNeeded();
    await page.waitForFunction(el => getComputedStyle(el).opacity === '1' && getComputedStyle(el).transform === 'none', await shell.elementHandle());
    const frames = await page.evaluate(() => window.entranceFrames);
    assert.ok(frames.length > 0);
    if (reducedMotion === 'reduce') assert.ok(frames.every(f => f.opacity === 1 && f.transform === 'none'));
    else assert.ok(frames.some(f => f.opacity < 1 && f.transform !== 'none'), 'normal entrance actually fades and slides');
    await shell.evaluate(el => { window.entranceShell = el; window.entranceFrames = []; });
    const visible = async () => {
      assert.ok(await shell.evaluate(el => el === window.entranceShell && getComputedStyle(el).opacity === '1' && getComputedStyle(el).transform === 'none'), 'same stable shell stays visible');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
      assert.deepEqual(await page.locator('[role=tabpanel] [style]').evaluateAll(els => els.filter(el => el.style.opacity === '0').map(el => el.outerHTML)), [], 'no hidden child after operations');
    };
    const tab = async name => { await page.getByRole('tab', { name, exact: true }).click(); await visible(); };
    const prefix = `${width}-${reducedMotion}`;
    await screenshot(page, `${prefix}-annual`);
    const query = page.locator('#course-query');
    await query.fill('政治');
    assert.ok(await query.evaluate(el => el === document.activeElement));
    await query.fill('');
    const add = page.getByRole('button', { name: /（.*）を履修計画に追加/ }).first();
    await add.click();
    await page.waitForFunction(el => el.disabled, await add.elementHandle());
    await visible();
    await page.getByRole('button', { name: '履修状況を削除', exact: true }).first().click();
    await page.getByRole('button', { name: '元に戻す', exact: true }).waitFor();
    await visible();
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await tab('メディア');
    const name = page.getByLabel('試験・評価予定の名称', { exact: true });
    await name.fill('保存後も表示');
    assert.ok(await name.evaluate(el => el === document.activeElement));
    await name.press('Enter');
    await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key)).mediaSchoolingProgress[id].assessments[0].label === '保存後も表示', { key: STORAGE_KEY, id: media.id });
    await visible();
    await page.getByRole('button', { name: '全科目を共有', exact: true }).click();
    await page.getByRole('button', { name: '共有モーダルを閉じる', exact: true }).click();
    await screenshot(page, `${prefix}-media`);
    await tab('プロフィール');
    const year = page.getByLabel('入学年度', { exact: true });
    await year.fill('2026');
    assert.ok(await year.evaluate(el => el === document.activeElement));
    await year.press('Enter');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).graduationProfile.admissionYear === 2026, STORAGE_KEY);
    await visible();
    await screenshot(page, `${prefix}-profile`);
    await tab('年間履修計画');
    await page.locator('summary').filter({ hasText: '成績データを取り込む' }).click();
    const panel = page.locator('#grade-import-panel');
    await panel.getByRole('textbox', { name: 'またはJSONを貼り付け', exact: true }).fill(JSON.stringify(grade));
    await panel.getByRole('button', { name: '読み込み・検証', exact: true }).click();
    await panel.locator('fieldset').waitFor();
    await visible();
    await panel.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録', exact: true }).click();
    await page.getByRole('button', { name: '取り込みを元に戻す', exact: true }).waitFor();
    await visible();
    await page.getByRole('button', { name: '現在の全データをJSONで準備（事前バックアップ）', exact: true }).click();
    await visible();
    const raw = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
    const backup = await createPlannerBackup(raw, catalog);
    await page.getByLabel('復元するJSONファイル').setInputFiles({ name: 'entrance-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByLabel('他のタブ・画面を閉じ、現在の全データが置き換わることを確認しました').check();
    await page.getByRole('button', { name: '確認したバックアップで全件置換する', exact: true }).click();
    await page.getByText('全データを置き換えて保存しました。再読み込み後も保持されます。', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY), backup.state, 'restored state preserved');
    await visible();
    await tab('メディア'); await tab('プロフィール'); await tab('年間履修計画');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));
    await tabs.scrollIntoViewIfNeeded();
    await page.waitForTimeout(450);
    await visible();
    assert.ok(await page.evaluate(() => window.entranceFrames.every(f => f.opacity === 1 && f.transform === 'none')), 'no replay, including intermediate frames during interactions');
    assert.deepEqual(errors, []);
  });
}
