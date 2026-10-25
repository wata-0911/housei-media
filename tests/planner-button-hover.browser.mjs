// Focused UI checks; use the same external Playwright setup as planner-save-lock.browser.mjs.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { initialState, STORAGE_KEY } from '../src/planner/backup/storage.ts';
import { stateForScopeChange } from '../src/planner/graduation/thesisSelection.ts';
import { isMediaSchooling } from '../src/planner/progress/mediaSchooling.ts';

const port = Number(process.env.PLANNER_BROWSER_PORT || 4183);
const origin = `http://127.0.0.1:${port}`;
const navy = 'rgb(0, 34, 85)', orange = 'rgb(240, 106, 20)', white = 'rgb(255, 255, 255)';
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

async function open(t, options = {}) {
  const state = stateForScopeChange(initialState(), catalog, catalog.programs.find(row => row.department === '日本文学科').scopeId);
  const offering = catalog.offerings.find(isMediaSchooling);
  state.items.push({ offeringId: offering.id, status: 'planned', plannedYear: 2026, plannedTerm: null, studyYear: 1, earnedOrder: null });
  const context = await browser.newContext(options);
  t.after(() => context.close());
  await context.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw: JSON.stringify(state) });
  const page = await context.newPage();
  await page.goto(`${origin}/planner`);
  await page.getByRole('button', { name: '画像を生成', exact: true }).waitFor();
  return page;
}
const style = locator => locator.evaluate(el => {
  const s = getComputedStyle(el);
  return { background: s.backgroundColor, color: s.color, transition: s.transitionDuration };
});
async function colors(locator, background, color) {
  await locator.page().waitForFunction(({ el, background, color }) => {
    const s = getComputedStyle(el);
    return s.backgroundColor === background && s.color === color;
  }, { el: await locator.elementHandle(), background, color });
}
async function hover(locator) {
  await locator.hover();
  await colors(locator, navy, orange);
}
async function screenshot(page, name) {
  if (!process.env.PLANNER_SCREENSHOT_DIR) return;
  await mkdir(process.env.PLANNER_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PLANNER_SCREENSHOT_DIR, name + '.png') });
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
}

test('desktop: primary/white actions, focus, disabled, exceptions and all planner tabs', async t => {
  const page = await open(t, { viewport: { width: 1440, height: 1000 } });
  const generate = page.getByRole('button', { name: '画像を生成', exact: true });
  await colors(generate, navy, white);
  assert.notEqual((await style(generate)).transition, '0s');
  await hover(generate);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal((await style(generate)).transition, '0s');
  await hover(generate);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const csv = page.getByRole('button', { name: 'CSVで保存', exact: true });
  await colors(csv, white, navy);
  await hover(csv);
  await screenshot(page, 'desktop-export');
  const add = page.getByRole('button', { name: /（.*）を履修計画に追加/ }).first();
  await hover(add);
  await add.click();
  await page.waitForFunction(el => el.disabled, await add.elementHandle());
  await colors(add, 'rgb(229, 231, 235)', 'rgb(75, 85, 99)');
  const disabledColors = await style(add);
  await page.mouse.move(0, 0);
  assert.deepEqual(await style(add), disabledColors, 'disabled add keeps its colors on hover');
  await page.getByRole('button', { name: '現在の全データをJSONで準備（事前バックアップ）', exact: true }).hover();
  await colors(page.getByRole('button', { name: '現在の全データをJSONで準備（事前バックアップ）', exact: true }), navy, orange);
  await hover(page.getByRole('button', { name: 'プロフィールを開く', exact: true }));
  const remove = page.getByRole('button', { name: '履修状況を削除', exact: true }).first();
  const dangerColors = await style(remove);
  await remove.hover();
  assert.deepEqual(await style(remove), dangerColors, 'deletion retains its semantic color');
  await page.locator('summary').filter({ hasText: '成績データを取り込む' }).click();
  const read = page.getByRole('button', { name: '読み込み・検証', exact: true });
  assert.ok(await read.isDisabled());
  await read.hover({ force: true });
  await colors(read, navy, white);
  const warning = page.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録', exact: true });
  if (await warning.count()) assert.ok(!(await warning.getAttribute('class')).includes('planner-button'));
  await page.getByRole('tab', { name: 'メディア', exact: true }).click();
  await hover(page.getByRole('button', { name: '全科目を共有', exact: true }));
  await page.getByRole('button', { name: '全科目を共有', exact: true }).click();
  await hover(page.getByRole('button', { name: '画像生成', exact: true }));
  await hover(page.getByRole('button', { name: '投稿文をコピー', exact: true }));
  await screenshot(page, 'desktop-media-share');
  await page.getByRole('button', { name: '共有モーダルを閉じる', exact: true }).click();
  await page.getByRole('tab', { name: 'プロフィール', exact: true }).click();
  await screenshot(page, 'desktop-profile');
  await noOverflow(page);
  await page.getByRole('tab', { name: '年間履修計画', exact: true }).click();
  await noOverflow(page);
  // Reach the image action through actual keyboard navigation.
  await csv.focus();
  await page.keyboard.press('Tab');
  assert.ok(await generate.evaluate(el => el === document.activeElement && el.matches(':focus-visible')));
  assert.equal(await generate.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  assert.equal(await generate.evaluate(el => getComputedStyle(el).outlineWidth), '2px');
});

test('390px touch and reduced motion: actions work without hover', async t => {
  const page = await open(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), false);
  const generate = page.getByRole('button', { name: '画像を生成', exact: true });
  assert.equal((await style(generate)).transition, '0s');
  await colors(generate, navy, white);
  await noOverflow(page);
  const add = page.getByRole('button', { name: /（.*）を履修計画に追加/ }).first();
  await add.scrollIntoViewIfNeeded();
  await screenshot(page, 'mobile-search');
  await add.tap();
  await page.waitForFunction(el => el.disabled, await add.elementHandle());
  await page.getByRole('tab', { name: 'メディア', exact: true }).tap();
  await noOverflow(page);
  await page.getByRole('button', { name: '全科目を共有', exact: true }).tap();
  await colors(page.getByRole('button', { name: '投稿文をコピー', exact: true }), white, navy);
  await screenshot(page, 'mobile-media-share');
  await noOverflow(page);
  await page.getByRole('button', { name: '共有モーダルを閉じる', exact: true }).tap();
  await page.getByRole('tab', { name: 'プロフィール', exact: true }).tap();
  await screenshot(page, 'mobile-profile');
  await noOverflow(page);
});
