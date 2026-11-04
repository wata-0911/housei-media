// Local: PLANNER_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:home-planner-browser
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const origin = `http://127.0.0.1:${process.env.PLANNER_BROWSER_PORT || 4198}`;
let browser, server;
before(async () => {
  const engine = process.env.PLANNER_BROWSER_ENGINE || 'chromium';
  assert.ok(['chromium', 'webkit'].includes(engine));
  const browserType = (await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright'))[engine];
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', new URL(origin).port, '--strictPort'], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* Wait for Vite. */ }
    await delay(200);
  }
  assert.ok(ready, output);
  browser = await browserType.launch({ headless: true, ...(process.env.PLANNER_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANNER_BROWSER_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(t, path = '/', options = {}) {
  const context = await browser.newContext(options);
  t.after(() => context.close());
  // Home's external X/GAS requests are irrelevant to navigation and deterministic QA.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.navigationScrolls = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      window.navigationScrolls.push({ id: this.id, options });
      return original.call(this, options);
    };
  });
  await page.goto(origin + path);
  return page;
}
const nav = page => page.getByRole('navigation', { name: 'ページ移動', exact: true });
async function shortcut(page, name) {
  await nav(page).locator('.edge-scroll').focus();
  if (await nav(page).locator('.edge-scroll').getAttribute('aria-expanded') !== 'true') await page.keyboard.press('Space');
  await nav(page).getByRole('button', { name, exact: true }).click();
}
async function focused(page, id) {
  await page.waitForFunction(id => document.activeElement?.id === id, id);
  const box = await page.locator(`#${id}`).boundingBox();
  const header = await page.locator('header').boundingBox();
  assert.ok(box.y >= header.y + header.height - 1 && box.y < (await page.viewportSize()).height, `${id} clears header`);
}
for (const [path, name, id] of [['/', '科目検索へ', 'course-query'], ['/contact', '履修・修得一覧へ', 'planned-heading'], ['/', 'メディア記録へ', 'media-panel']]) {
  test(`${path} → ${id}, reload, repeat and history`, async t => {
    const page = await open(t, path, { reducedMotion: 'reduce' });
    await shortcut(page, name); await focused(page, id);
    assert.equal(new URL(page.url()).hash, `#${id}`);
    await page.reload(); await focused(page, id);
    await shortcut(page, name); await focused(page, id);
    await page.goBack(); await focused(page, id);
    await page.goForward(); await focused(page, id);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
  });
}
test('Q&A → graduation, missing destination fallback, valid destination and tab switching', async t => {
  const page = await open(t, '/qa', { reducedMotion: 'reduce' });
  await shortcut(page, '卒業要件へ');
  await focused(page, 'planner-start');
  await page.getByText('このセクションは現在利用できません。プロフィール設定や保存状態を確認してください。', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'プロフィール', exact: true }).click();
  await page.getByLabel('所属学科', { exact: true }).selectOption({ index: 1 });
  await page.waitForFunction(() => localStorage.length > 0);
  await page.goto(origin + '/qa');
  await shortcut(page, '卒業要件へ'); await focused(page, 'graduation-progress-heading');
  await shortcut(page, 'メディア記録へ'); await focused(page, 'media-panel');
  await shortcut(page, '卒業要件へ'); await focused(page, 'graduation-progress-heading');
  await shortcut(page, 'メディア記録へ'); await focused(page, 'media-panel');
  await page.goBack(); await focused(page, 'graduation-progress-heading');
});
test('hover bridge, keyboard, Escape, outside, focus on close, resize and edge dragging', async t => {
  const page = await open(t, '/', { viewport: { width: 1200, height: 900 } });
  const toggle = nav(page).locator('.edge-scroll');
  await toggle.hover();
  const item = nav(page).getByRole('button', { name: '科目検索へ', exact: true });
  await item.hover(); assert.equal(await item.isVisible(), true);
  if (process.env.PLANNER_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PLANNER_SCREENSHOT_DIR}/edge-desktop.png` });
  await item.focus(); await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false'); assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await page.mouse.click(5, 300); assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  const drag = nav(page).locator('.edge-scroll');
  const start = await drag.boundingBox();
  await page.mouse.move(start.x + 20, start.y + 20); await page.mouse.down();
  await page.mouse.move(-100, -100, { steps: 12 }); await page.mouse.up();
  await toggle.hover();
  for (const button of await nav(page).getByRole('button').all()) {
    const box = await button.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1200 && box.y + box.height <= 900);
  }
  await page.setViewportSize({ width: 640, height: 320 });
  await toggle.focus();
  await page.waitForFunction(() => {
    const box = document.querySelector('.page-edge-navigation').getBoundingClientRect();
    return box.bottom <= innerHeight && box.right <= innerWidth;
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await toggle.focus();
  await page.waitForFunction(() => document.querySelector('.page-edge-navigation').getBoundingClientRect().right <= innerWidth);
});
test('short page menu remains available without inert edge scroll', async t => {
  const page = await open(t, '/not-found-short-page', { viewport: { width: 1200, height: 2400 } });
  await page.waitForFunction(() => document.documentElement.scrollHeight <= innerHeight + 8);
  assert.equal(await nav(page).getByRole('button', { name: /ページ[上下]部へ/ }).count(), 0);
  await shortcut(page, '履修・修得一覧へ'); await focused(page, 'planned-heading');
});
test('ordinary edge scrolling outside Planner and scroll closes menu', async t => {
  const page = await open(t, '/qa', { reducedMotion: 'reduce' });
  await nav(page).getByRole('button', { name: '↓ ページ下部へ', exact: true }).click();
  await page.waitForFunction(() => scrollY > 100);
  await nav(page).getByRole('button', { name: '↑ ページ上部へ', exact: true }).click();
  await page.waitForFunction(() => scrollY === 0);
  await nav(page).locator('.edge-scroll').focus();
  await page.evaluate(() => scrollTo(0, 200));
  await page.waitForFunction(() => document.querySelector('.edge-scroll').getAttribute('aria-expanded') === 'false');
});
test('touch long-press tap alternative, slide release, early drag and click suppression', async t => {
  const page = await open(t, '/', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const toggle = nav(page).locator('.edge-scroll');
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }] });
  const initial = await toggle.boundingBox();
  await touch('touchStart', initial.x + initial.width / 2, initial.y + initial.height / 2); await delay(510); await touch('touchEnd');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  if (process.env.PLANNER_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PLANNER_SCREENSHOT_DIR}/edge-touch.png` });
  await nav(page).getByRole('button', { name: 'メディア記録へ', exact: true }).tap(); await focused(page, 'media-panel');
  let box = await toggle.boundingBox();
  await touch('touchStart', box.x + box.width / 2, box.y + box.height / 2);
  await delay(500);
  const item = await nav(page).getByRole('button', { name: '科目検索へ', exact: true }).boundingBox();
  await touch('touchMove', item.x + item.width / 2, item.y + item.height / 2); await touch('touchEnd');
  await focused(page, 'course-query');
  await page.locator('#course-query').blur();
  box = await toggle.boundingBox();
  const url = page.url();
  const up = nav(page).getByRole('button', { name: '↑ ページ上部へ', exact: true });
  await up.tap(); await page.waitForFunction(() => scrollY === 0);
  const down = await nav(page).getByRole('button', { name: '↓ ページ下部へ', exact: true }).boundingBox();
  await touch('touchStart', down.x + 20, down.y + 20); await delay(500); await touch('touchEnd');
  assert.equal(await page.evaluate(() => scrollY), 0, 'long press must not scroll or select on release in center');
  assert.equal(page.url(), url);
  box = await toggle.boundingBox();
  await touch('touchStart', box.x + 20, box.y + 20); await touch('touchMove', box.x + 50, box.y + 20); await delay(500); await touch('touchEnd');
  assert.equal(page.url(), url);
  const drag = await nav(page).locator('.edge-scroll').boundingBox();
  await touch('touchStart', drag.x + 20, drag.y + 20); await touch('touchMove', 8, 8); await touch('touchEnd');
  assert.equal(page.url(), url);
  await page.waitForFunction(() => document.querySelector('.edge-scroll').getAttribute('aria-expanded') === 'false');
});
