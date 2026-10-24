// Local: PLANNER_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:home-planner-browser
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { GRADE_HANDOFF_REQUEST, GRADE_HANDOFF_RESPONSE } from '../src/planner/gradeImport/directGradeHandoff.ts';
import { STORAGE_KEY } from '../src/planner/backup/storage.ts';

const origin = `http://127.0.0.1:${process.env.PLANNER_BROWSER_PORT || 4187}`;
let browser, server;
before(async () => {
  const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
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
  browser = await chromium.launch({ headless: true, ...(process.env.PLANNER_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANNER_BROWSER_EXECUTABLE } : {}) });
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
async function destination(page, id, tab) {
  if (id === 'planner-start') await page.getByRole('heading', { name: '履修計画表', exact: true }).waitFor();
  else await page.waitForFunction(id => window.navigationScrolls.some(row => row.id === id), id);
  if (tab) await page.getByRole('tab', { name: tab, exact: true }).and(page.locator('[aria-selected="true"]')).waitFor();
  const target = page.locator(`#${id}`);
  await target.waitFor();
  await page.waitForFunction(id => {
    const target = document.getElementById(id)?.getBoundingClientRect();
    const header = document.querySelector('header')?.getBoundingClientRect();
    return target && header && target.y >= header.bottom - 1 && target.y < innerHeight;
  }, id);
  const box = await target.boundingBox();
  const header = await page.locator('header').first().boundingBox();
  assert.ok(box.y >= header.y + header.height - 1, `target ${box.y} behind header ${header.height}`);
  assert.ok(box.y < page.viewportSize().height, 'target starts below viewport');
  if (id !== 'planner-start') assert.equal(await page.evaluate(id => document.activeElement.id === id, id), true);
}
async function scrollCount(page) { return page.evaluate(() => window.navigationScrolls.length); }

for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
  test(`SCHEDULE retains order/calendar/X and three keyboard accessible CTAs (${viewport.width}px, reduced motion)`, async t => {
    const page = await open(t, '/', { viewport, reducedMotion: 'reduce' });
    const nav = page.getByRole('navigation', { name: '履修プランナー', exact: true });
    assert.equal(await nav.getByRole('link').count(), 3);
    const section = page.locator('section').filter({ has: nav });
    assert.equal(await section.locator('img[src="/schedule-calendar.png"]').count(), 1);
    assert.equal(await section.locator('a[href^="https://x.com/"]').count(), 2);
    assert.equal(await page.locator('main > div > section').first().getByRole('textbox').count(), 1);
    assert.equal(await section.evaluate(el => el.previousElementSibling.querySelector('#home-search') !== null), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const link = nav.getByRole('link').filter({ hasText: '年間の学習予定を立てる' });
    await link.focus();
    assert.equal(await link.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    assert.equal(await link.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.keyboard.press('Enter');
    await destination(page, 'planner-start', '年間履修計画');
    assert.equal(new URL(page.url()).pathname, '/planner');
  });
}

for (const [hash, id, tab] of [['#grade-import', 'grade-import', '年間履修計画'], ['#media', 'media-panel', 'メディア']]) {
  test(`${hash}: Home CTA, reload, direct access, back/forward and no writes`, async t => {
    const page = await open(t, '/', { viewport: { width: 375, height: 812 } });
    const nav = page.getByRole('navigation', { name: '履修プランナー', exact: true });
    await nav.locator(`a[href="/planner${hash}"]`).click();
    await destination(page, id, tab);
    if (id === 'grade-import') assert.equal(await page.locator('#grade-import').getAttribute('open'), '');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), null);
    await page.reload(); await destination(page, id, tab);
    await page.goto(origin + '/planner' + hash); await destination(page, id, tab);
    // Same Planner instance: URL transitions must select/mount each destination again.
    await page.locator('header').getByRole('link', { name: '履修計画', exact: true }).click();
    await destination(page, 'planner-start', '年間履修計画');
    await page.goBack(); await destination(page, id, tab);
    await page.goForward(); await destination(page, 'planner-start', '年間履修計画');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), null);
  });
}

test('consumed destination does not scroll again on tab changes, collapse, search, input or save', async t => {
  const page = await open(t, '/planner#grade-import');
  await destination(page, 'grade-import', '年間履修計画');
  const count = await scrollCount(page);
  await page.locator('#grade-import > summary').click();
  await page.getByRole('tab', { name: 'メディア', exact: true }).click();
  await page.getByRole('tab', { name: '年間履修計画', exact: true }).click();
  const search = page.getByLabel('科目名・科目コード・クラスコード・開講区分・期', { exact: true });
  await search.fill('日本');
  await page.getByRole('tab', { name: 'プロフィール', exact: true }).click();
  const department = page.getByLabel('所属学科', { exact: true });
  await department.selectOption({ index: 1 });
  await page.waitForFunction(key => localStorage.getItem(key) !== null, STORAGE_KEY);
  await page.getByLabel('入学年度', { exact: true }).fill('2024');
  await page.getByLabel('入学年度', { exact: true }).press('Enter');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).graduationProfile.admissionYear === 2024, STORAGE_KEY);
  assert.equal(await scrollCount(page), count);
});

test('ordinary Planner stays annual with import closed; unknown hashes are untouched', async t => {
  const page = await open(t, '/planner');
  await destination(page, 'planner-start', '年間履修計画');
  assert.equal(await page.locator('#grade-import').getAttribute('open'), null);
  assert.equal(await scrollCount(page), 0);
  const unknown = await open(t, '/planner#unknown');
  await unknown.getByRole('tab', { name: '年間履修計画', exact: true }).waitFor();
  assert.equal(await scrollCount(unknown), 0);
});

test('extension #hosei-import still requests and receives its handoff without destination navigation', async t => {
  const page = await open(t, '/');
  await page.addInitScript(({ request, response }) => {
    window.addEventListener('message', event => {
      if (event.source === window && event.data?.type === request) {
        window.handoffRequested = true;
        window.postMessage({ type: response, token: event.data.token, ok: false }, location.origin);
      }
    });
  }, { request: GRADE_HANDOFF_REQUEST, response: GRADE_HANDOFF_RESPONSE });
  await page.goto(origin + '/planner#hosei-import=12345678-1234-4123-8123-123456789abc');
  await page.getByText('拡張機能から成績データを受信できませんでした。JSONを保存またはコピーして取り込めます。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.handoffRequested), true);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await scrollCount(page), 0);
});


test('native same-page fragment navigation and history entries select destinations again', async t => {
  const page = await open(t, '/planner#grade-import');
  await destination(page, 'grade-import', '年間履修計画');
  await page.goto(origin + '/planner#media');
  await destination(page, 'media-panel', 'メディア');
  await page.goBack(); await destination(page, 'grade-import', '年間履修計画');
  await page.goForward(); await destination(page, 'media-panel', 'メディア');
});

test('successful extension handoff opens import and previews without saving', async t => {
  const page = await open(t, '/');
  await page.addInitScript(({ request, response }) => {
    window.addEventListener('message', event => {
      if (event.source === window && event.data?.type === request) {
        window.postMessage({ type: response, token: event.data.token, ok: true, importData: {
          schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-01-01T00:00:00Z', courses: [],
        } }, location.origin);
      }
    });
  }, { request: GRADE_HANDOFF_REQUEST, response: GRADE_HANDOFF_RESPONSE });
  await page.goto(origin + '/planner#hosei-import=12345678-1234-4123-8123-123456789abc');
  await page.getByText('拡張機能から0科目を受信しました。内容を確認してから反映してください。', { exact: true }).waitFor();
  assert.equal(await page.locator('#grade-import').getAttribute('open'), '');
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), null);
  assert.equal(await scrollCount(page), 0);
});
