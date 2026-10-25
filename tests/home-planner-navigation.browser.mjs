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

// WCAG sRGB relative luminance; compare the rendered text color with its opaque background.
function contrast(first, second) {
  const luminance = rgb => rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const values = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}
async function assertTextContrast(link, color) {
  const appearance = await link.locator('span').last().evaluate(el => {
    const style = getComputedStyle(el);
    let parent = el;
    while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement;
    return { color: style.color, background: getComputedStyle(parent).backgroundColor, shadow: style.textShadow, stroke: style.webkitTextStrokeWidth };
  });
  assert.equal(appearance.color, color);
  assert.equal(appearance.shadow, 'none', 'no obsolete black outline');
  assert.equal(appearance.stroke, '0px');
  const rgb = value => value.match(/\d+/g).map(Number);
  assert.ok(contrast(rgb(appearance.color), rgb(appearance.background)) >= 4.5, JSON.stringify(appearance));
  assert.equal(await link.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'no filled CTA');
  assert.equal(await link.locator('svg').count(), 0, 'decorative rule replaces the button arrow');
}
const paragraphs = [
  'こちらのボタンから履修の計画を検索しながら立てられます。',
  '公式の成績表からデータを取り込むとすぐに今後の予定を立てられます。また、メディアの進捗も記録でき、すぐにsnsなどに共有できます。',
  '卒業までに足りない単位数を確かめられますが、卒業の可否を保証しません。',
  '卒業の可否や科目の内容などはシラバスやしおり、公式ホームページを参照してください。',
];
const labels = ['履修計画', '成績取り込み', 'メディア進捗記録'];
const hrefs = ['/planner', '/planner#grade-import', '/planner#media'];
function unifiedLinks(page) {
  return page.locator('nav[aria-label="履修プランナー"] a, main a[href="/member"], main a[href="/message"]');
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
  test(`Planner explanation and unified links precede unchanged SCHEDULE (${viewport.width}px, reduced motion)`, async t => {
    const page = await open(t, '/', { viewport, reducedMotion: 'reduce' });
    const nav = page.getByRole('navigation', { name: '履修プランナー', exact: true });
    assert.deepEqual(await nav.getByRole('link').evaluateAll(links => links.map(link => link.textContent.trim())), labels);
    assert.deepEqual(await nav.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href'))), hrefs);
    assert.deepEqual(await page.locator('main section span').filter({ hasText: /^\d{2} \/ / }).allTextContents(), [
      '01 / PLANNER', '02 / SCHEDULE', '03 / OFFICIAL X TIMELINE', '04 / MEMBERS', "05 / FOUNDER'S MESSAGE",
    ]);
    const section = page.locator('section').filter({ has: nav });
    assert.equal(await section.getByRole('heading', { name: '履修プランナー', exact: true }).count(), 1);
    assert.equal(await section.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(250, 250, 250)');
    assert.deepEqual(await section.locator('p').allTextContents(), paragraphs);
    assert.equal(await section.getByText('履修計画や成績の取り込み、メディアの進捗記録をまとめて。', { exact: true }).count(), 0);
    assert.equal(await nav.locator('p').count(), 0);
    assert.equal(await section.getByText(/年間の学習予定を立てる|成績データを取り込んで確認する|メディアスクーリングの進捗を記録する/).count(), 0);
    for (const p of await section.locator('p').all()) {
      assert.equal(await p.evaluate(el => getComputedStyle(el).color), 'rgb(102, 102, 102)');
      assert.equal(await p.evaluate(el => getComputedStyle(el).textAlign), 'left');
    }
    assert.ok(contrast([102, 102, 102], [250, 250, 250]) >= 4.5, 'explanation contrast');
    assert.equal(await section.locator('img[src="/schedule-calendar.png"]').count(), 0);
    const schedule = page.locator('section').filter({ has: page.locator('img[src="/schedule-calendar.png"]') });
    assert.equal(await schedule.locator('img[src="/schedule-calendar.png"]').count(), 1);
    assert.equal(await schedule.locator('a[href^="https://x.com/"]').count(), 2);
    assert.equal(await schedule.getByRole('navigation', { name: '履修プランナー', exact: true }).count(), 0);
    assert.equal(await section.evaluate(el => el.nextElementSibling.querySelector('img[src="/schedule-calendar.png"]') !== null), true);
    const links = await nav.getByRole('link').evaluateAll(links => links.map(link => {
      const { x, y, width, height } = link.getBoundingClientRect();
      return { x, y, width, height };
    }));
    assert.ok(links.every(link => Math.abs(link.x - links[0].x) <= 1), 'all three links share a left edge');
    assert.ok(links[1].y >= links[0].y + links[0].height + 15 && links[2].y >= links[1].y + links[1].height + 15, 'links always stacked with space');
    const copy = await section.locator('p').first().locator('..').boundingBox();
    const navigation = await nav.boundingBox();
    if (viewport.width >= 768) {
      assert.ok(navigation.x >= copy.x + copy.width, 'desktop text and navigation in separate columns');
      assert.ok(navigation.y < copy.y + copy.height && navigation.y + navigation.height > copy.y, 'columns overlap vertically');
    } else {
      assert.ok(navigation.y >= copy.y + copy.height, 'mobile navigation follows all four paragraphs');
    }
    assert.equal(await page.locator('main > div > section').first().getByRole('textbox').count(), 1);
    assert.equal(await section.evaluate(el => el.previousElementSibling.querySelector('#home-search') !== null), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('main a[href="/member"]').innerText(), 'メンバープロフィールを見る');
    assert.equal(await page.locator('main a[href="/message"]').innerText(), 'メッセージの続きを読む');
    for (const link of await unifiedLinks(page).all()) {
      await page.mouse.move(0, 0);
      await assertTextContrast(link, 'rgb(102, 102, 102)');
      assert.ok((await link.boundingBox()).height >= 44, 'clickable target at least 44px high');
      await link.scrollIntoViewIfNeeded();
      const rule = link.locator('span').first();
      const text = link.locator('span').last();
      const before = await text.boundingBox();
      assert.equal(await rule.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(230, 92, 0)');
      assert.equal((await rule.boundingBox()).width, 32);
      await link.hover();
      await assertTextContrast(link, 'rgb(0, 34, 85)');
      assert.equal((await rule.boundingBox()).width, 32, 'reduced motion suppresses rule growth');
      assert.equal((await text.boundingBox()).x, before.x, 'reduced motion suppresses text movement');
      assert.equal(await rule.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
      await page.keyboard.press('Tab');
      await link.focus();
      assert.equal(await link.evaluate(el => el.matches(':focus-visible')), true);
      assert.equal(await link.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    }
    const link = nav.getByRole('link', { name: '履修計画', exact: true });
    await link.focus();
    if (process.env.HOME_PLANNER_SCREENSHOT_DIR) {
      await page.screenshot({ path: `${process.env.HOME_PLANNER_SCREENSHOT_DIR}/home-${viewport.width}.png`, fullPage: true });
      await section.screenshot({ path: `${process.env.HOME_PLANNER_SCREENSHOT_DIR}/planner-${viewport.width}.png` });
    }
    await page.keyboard.press('Enter');
    await destination(page, 'planner-start', '年間履修計画');
    assert.equal(new URL(page.url()).pathname, '/planner');
  });
}

test('unified navigation matches SCHEDULE hover colors, rule growth and text movement', async t => {
  const page = await open(t, '/', { viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  const schedule = page.locator('section').filter({ has: page.locator('img[src="/schedule-calendar.png"]') });
  const allLinks = [...await unifiedLinks(page).all(), ...await schedule.locator('a[href^="https://x.com/"]').all()];
  for (const link of allLinks) {
    await link.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForFunction(el => getComputedStyle(el).color === 'rgb(102, 102, 102)' && !el.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'), await link.elementHandle());
    await assertTextContrast(link, 'rgb(102, 102, 102)');
    const rule = link.locator('span').first();
    assert.equal(await rule.evaluate(el => getComputedStyle(el).transitionDuration), '0.3s');
    // Finish Home's entrance transform before measuring the horizontal hover shift.
    await page.waitForFunction(el => {
      for (let p = el; p; p = p.parentElement) if (getComputedStyle(p).opacity !== '1' || (getComputedStyle(p).transform !== 'none' && getComputedStyle(p).transform !== 'matrix(1, 0, 0, 1, 0, 0)')) return false;
      return true;
    }, await link.elementHandle());
    const before = await link.locator('span').last().boundingBox();
    const ruleBefore = (await rule.boundingBox()).width;
    await link.hover();
    await page.waitForFunction(el => getComputedStyle(el).color === 'rgb(0, 34, 85)' && !el.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'), await link.elementHandle());
    await assertTextContrast(link, 'rgb(0, 34, 85)');
    const growth = (await rule.boundingBox()).width - ruleBefore;
    assert.ok(growth > 0, 'orange rule grows on hover');
    assert.ok(Math.abs((await link.locator('span').last().boundingBox()).x - before.x - growth) < 1, 'rule growth pushes the whole label right');
    if ((await link.getAttribute('href')).startsWith('/')) assert.ok(Math.abs(growth - 16) < 1, 'new rules grow from 32px to 48px');
  }
});

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
