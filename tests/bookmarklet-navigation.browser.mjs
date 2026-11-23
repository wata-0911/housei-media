// Synthetic browser checks; no live university account or grade data.
// PLANNER_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node --test tests/bookmarklet-navigation.browser.mjs
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cells } from '../bookmarklet/tests/fixtures/extraction-dom.mjs';
const artifact = JSON.parse(readFileSync(new URL('../src/generated/gradeImportBookmarklet.json', import.meta.url)));
const code = decodeURIComponent(artifact.bookmarklet.slice('javascript:'.length));
const source = 'https://www.tsukyo.hosei.ac.jp/issue107-synthetic';
const target = 'https://hosei-tsukyo-media.com/planner#grade-import';
let browser;
before(async () => {
  const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });
for (const mode of ['primary', 'fallback', 'blocked', 'throw', 'copy-failed']) {
  test(`bookmarklet ${mode}: source retained, isolated fixed tab or manual guidance`, { timeout: 30000 }, async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const requests = [];
    await context.route('**/*', async route => {
      requests.push({ url: route.request().url(), headers: route.request().headers() });
      await route.fulfill({ contentType: 'text/html', body: route.request().url() === source
        ? `<button id="run">Run synthetic bookmarklet</button><table id="seisekiTabele110"><tr class="column_even">${cells('SYNTHETIC_PRIVATE_COURSE', { 2: '4', 5: '4' }).map(value => `<td>${value}</td>`).join('')}</tr></table>`
        : '<h1>Synthetic Planner destination</h1>' });
    });
    const page = await context.newPage();
    await page.goto(source);
    await page.evaluate(({ code, mode }) => {
      window.notices = []; window.copied = [];
      window.alert = value => window.notices.push(value);
      Object.defineProperty(navigator, 'clipboard', { value: { async writeText(text) {
        if (mode === 'fallback' || mode === 'copy-failed') throw new Error('synthetic denial');
        window.copied.push(text);
      } } });
      document.execCommand = () => {
        if (mode === 'copy-failed') return false;
        window.copied.push(document.activeElement.value); return true;
      };
      if (mode === 'blocked') window.open = () => null;
      if (mode === 'throw') window.open = () => { throw new Error('SYNTHETIC_PRIVATE_ERROR'); };
      document.getElementById('run').addEventListener('click', () => { (0, eval)(code); });
    }, { code, mode });
    const popupReady = mode === 'primary' || mode === 'fallback' ? context.waitForEvent('page', { timeout: 15000 }) : null;
    await page.locator('#run').click();
    await page.waitForFunction(() => window.notices.length === 1);
    assert.equal(page.url(), source);
    const notice = await page.evaluate(() => window.notices[0]);
    if (mode === 'copy-failed') {
      assert.match(notice, /コピーに失敗/);
      assert.equal(context.pages().length, 1);
      assert.doesNotMatch(notice, /コピーしました|https:\/\//);
    } else {
      assert.match(notice, /コピーしました/);
      assert.ok(notice.includes(target));
      assert.match(notice, /新しいタブのアドレス欄/);
      assert.doesNotMatch(notice, /開きました|SYNTHETIC_PRIVATE/);
      if (mode === 'primary' || mode === 'fallback') {
        await page.waitForFunction(() => window.copied.length === 1);
        const popup = await popupReady;
        assert.ok(popup);
        await popup.waitForURL(target);
        await popup.waitForLoadState();
        assert.equal(await popup.evaluate(() => window.opener), null);
        assert.equal(await popup.evaluate(() => document.referrer), '');
        const request = requests.find(row => row.url.startsWith('https://hosei-tsukyo-media.com/'));
        assert.equal(request.url, target.split('#')[0]);
        assert.equal(request.headers.referer, undefined);
      } else assert.equal(context.pages().length, 1);
    }
    assert.ok(requests.every(row => row.url === source || row.url === target.split('#')[0]));
  });
}

test('Planner direct entry requires paste, Preview and explicit apply before storage changes', { timeout: 90000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { setTimeout: delay } = await import('node:timers/promises');
  const origin = 'http://127.0.0.1:4189';
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4189', '--strictPort'], { cwd: new URL('../', import.meta.url), stdio: 'ignore' });
  t.after(() => server.kill());
  let ready = false;
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null);
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* starting */ }
    await delay(200);
  }
  assert.ok(ready);
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const payload = JSON.parse(readFileSync(new URL('../bookmarklet/tests/fixtures/extraction-741e780.json', import.meta.url))).outcomes.normal32.value;
  payload.courses = payload.courses.slice(0, 1);
  await page.goto(origin + '/planner#grade-import');
  const text = page.getByRole('textbox', { name: '成績JSONをここに貼り付け' });
  await text.waitFor();
  assert.equal(await page.locator('#grade-import').getAttribute('open'), '');
  assert.equal(await text.inputValue(), '');
  const saved = () => page.evaluate(() => localStorage.getItem('hosei-planner:v1'));
  assert.equal(await saved(), null);
  const apply = page.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録' });
  assert.equal(await apply.count(), 0);
  await text.fill(JSON.stringify(payload));
  assert.equal(await saved(), null);
  assert.equal(await apply.count(), 0);
  await page.getByRole('button', { name: '読み込み・検証', exact: true }).click();
  await apply.waitFor();
  assert.equal(await saved(), null);
  await apply.click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('hosei-planner:v1'))?.importedCourseAchievements?.length > 0);
  assert.ok(await saved());
  assert.equal(new URL(page.url()).search, '');
  assert.equal(new URL(page.url()).hash, '#grade-import');
});
