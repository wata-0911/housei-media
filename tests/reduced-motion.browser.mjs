// Focused Chromium checks using the repository's external Playwright convention.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.PLANNER_BROWSER_PORT || 4185);
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

const appearance = locator => locator.evaluate(el => {
  const s = getComputedStyle(el);
  return { opacity: Number(s.opacity), transform: s.transform, transition: s.transitionDuration, width: s.width };
});
async function settled(locator) {
  await locator.page().waitForFunction(el => getComputedStyle(el).opacity === '1', await locator.elementHandle());
}
async function screenshot(page, name) {
  if (!process.env.PLANNER_SCREENSHOT_DIR) return;
  await mkdir(process.env.PLANNER_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PLANNER_SCREENSHOT_DIR, `${name}.png`) });
}

for (const width of [1440, 390]) for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`${width}px / ${reducedMotion}: pages, scrolling and controls remain usable`, async t => {
    const reduce = reducedMotion === 'reduce';
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) });
    t.after(() => context.close());
    // Keep external embeds and contact delivery out of this local UI test.
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const prefix = `${width}-${reducedMotion}`;

    for (const path of ['/', '/qa', '/contact', '/planner', '/message', '/privacy', '/member', '/calendar-approve', '/missing-motion-test']) {
      await page.goto(origin + path);
      const content = path === '/member' ? page.locator('.profile-card') : page.locator('main h1, main h2').first();
      if (path === '/calendar-approve') await page.locator('main').waitFor();
      else {
        await content.waitFor();
        const before = await appearance(content);
        if (reduce) assert.equal(before.opacity, 1, `${path} is visible immediately`);
        await settled(content);
      }
      if (!reduce) await page.waitForTimeout(1700);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path}: no horizontal overflow`);
      const transitions = await page.locator('.transition-all, .transition-colors, .transition-transform, .select-btn, .planner-button').evaluateAll(els => els.map(el => getComputedStyle(el).transitionDuration));
      assert.ok(transitions.length > 0);
      if (reduce) assert.ok(transitions.every(value => value === '0s'), `${path}: CSS transitions disabled`);
      else assert.ok(transitions.some(value => value !== '0s'), `${path}: normal transitions retained`);

      if (path === '/') {
        const hero = page.locator('main header').first();
        const background = hero.locator(':scope > div').first();
        await page.evaluate(() => window.scrollTo(0, 200));
        await page.waitForTimeout(100);
        const transform = (await appearance(background)).transform;
        assert.equal(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)', reduce, 'existing parallax preference respected');
        const cta = page.getByRole('link', { name: 'メンバープロフィールを見る' });
        await cta.scrollIntoViewIfNeeded();
        await settled(cta.locator('..'));
        if (width === 1440) {
          await cta.hover();
          await page.waitForTimeout(350);
          const moved = (await appearance(cta)).transform;
          assert.equal(moved === 'matrix(1, 0, 0, 1, 0, -2)', !reduce, 'hover lift follows preference');
          const line = page.locator('a[href="https://x.com/hosei_c_media?s=20"]');
          await line.hover();
          await page.waitForTimeout(350);
          assert.equal((await appearance(line.locator('span').first())).width, reduce ? '32px' : '48px');
        }
      }
      if (path === '/qa') {
        await page.getByRole('textbox', { name: 'Q&Aをキーワードで検索' }).fill('スクーリング');
        const details = page.locator('details').first();
        await details.locator('summary').click();
        assert.ok(await details.evaluate(el => el.open), 'Q&A expands');
        await screenshot(page, `${prefix}-qa-open`);
      }
      if (path === '/planner') {
        const generate = page.getByRole('button', { name: '画像を生成', exact: true });
        assert.equal((await appearance(generate)).transition, reduce ? '0s' : '0.2s, 0.2s', '#173 unchanged');
        for (const name of ['メディア', 'プロフィール', '年間履修計画']) {
          const tab = page.getByRole('tab', { name, exact: true });
          await tab.click();
          assert.equal(await tab.getAttribute('aria-selected'), 'true');
        }
        if (reduce) {
          // Check the existing edge navigation uses instant scrolling.
          await page.evaluate(() => {
            const original = window.scrollTo.bind(window);
            window.scrollTo = (...args) => { window.__lastScroll = args[0]; original(...args); };
          });
          await page.getByRole('button', { name: /ページ(下部|上部)へ/ }).click();
          assert.equal(await page.evaluate(() => window.__lastScroll.behavior), 'instant');
        }
      }
      if (path === '/member') {
        await page.getByRole('button', { name: 'メンバー 2', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.select-btn.active')?.textContent === 'メンバー 2');
        await page.locator('.member-name').filter({ hasText: '黒糖' }).waitFor();
        await settled(page.locator('.profile-card').last());
        await page.waitForFunction(() => document.querySelectorAll('.profile-card').length === 1);
        assert.equal((await appearance(page.locator('.profile-card'))).opacity, 1);
      }
      if (reduce) {
        const hidden = await page.locator('main [style]').evaluateAll(els => els.filter(el => el.style.opacity === '0').map(el => el.outerHTML.slice(0, 120)));
        assert.deepEqual(hidden, [], `${path}: no animation leaves content hidden`);
      }
      await screenshot(page, `${prefix}-${path.replaceAll('/', '') || 'home'}`);
    }

    await page.goto(origin + '/contact');
    await page.getByLabel('お名前', { exact: true }).fill('UIテスト');
    await page.getByLabel('メールアドレス', { exact: true }).fill('ui-test@example.invalid');
    await page.getByLabel('お問い合わせ内容', { exact: true }).fill('ローカルテスト。外部送信しません。');
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('https://script.google.com/**', async route => { await pending; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'error', message: 'mock failure' }) }); });
    const submit = page.getByRole('button', { name: '送信する', exact: true });
    await submit.scrollIntoViewIfNeeded();
    await settled(submit.locator('xpath=ancestor::form/..'));
    await submit.dispatchEvent('pointerdown', { pointerType: 'mouse', isPrimary: true, button: 0 });
    await page.waitForTimeout(200);
    if (reduce) assert.equal((await appearance(submit)).transform, 'none', 'tap scale disabled');
    await submit.dispatchEvent('pointerup', { pointerType: 'mouse', isPrimary: true, button: 0 });
    await submit.click();
    await page.getByRole('button', { name: '送信中...', exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: '送信中...', exact: true }).isDisabled());
    const dialog = page.waitForEvent('dialog');
    release();
    const alert = await dialog;
    assert.match(alert.message(), /送信に失敗/);
    await alert.accept();
    await page.getByRole('button', { name: '送信する', exact: true }).waitFor();
    assert.deepEqual(errors, [], 'no uncaught browser errors');
  });
}
