import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:https';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const width = Number(process.argv[2]);
const profile = process.argv[3] ?? 'staging';
const mode = process.argv[4] ?? 'on';
const production = profile === 'production';
const dev = profile === 'dev';
assert.ok([390, 1280].includes(width) && ['on', 'off', 'ad'].includes(mode) && (mode !== 'ad' || production)
  && ['staging', 'production', 'dev'].includes(profile));
if (!process.argv[5]) throw new Error('usage: scenario.mjs WIDTH PROFILE MODE WORK_DIR');
const work = pathToFileURL(resolve(process.argv[5]) + sep);
const root = new URL('profiles/' + profile + '-' + mode + '/', work);
const parentRoot = production ? new URL('parent/', root) : dev ? new URL('dev-dist/', work) : root;
const childRoot = production ? new URL('child/', root) : root;
const parentRoutes = dev ? [{ handle: 'filesystem' }, { src: '^/.*$', dest: '/index.html' }]
  : JSON.parse(await readFile(new URL('vercel.json', parentRoot), 'utf8')).routes;
const childRoutes = production
  ? JSON.parse(await readFile(new URL('vercel.json', childRoot), 'utf8')).routes : parentRoutes;
const parent = production ? 'https://hosei-tsukyo-media.com'
  : dev ? 'https://dev.hosei-tsukyo-media.com' : 'https://staging.hosei-tsukyo-media.com';
const child = production ? 'https://planner.hosei-tsukyo-media.com' : 'https://planner-staging.hosei-tsukyo-media.com';
const outside = 'https://outside-a-fixture.example.test';
const alias = 'https://preview-a-fixture.vercel.app';
const childAlias = 'https://child-a-fixture.vercel.app';
const offScope = [outside, alias, ...(production ? ['https://staging.hosei-tsukyo-media.com'] : ['https://hosei-tsukyo-media.com'])];
const fixtureOrigins = [parent, child, childAlias, ...offScope];
const fixtureHosts = fixtureOrigins.map(value => new URL(value).hostname);
const childPath = '/child';
const parentHost = new URL(parent).hostname;
const childHost = new URL(child).hostname;
const A = 'hosei-planner:2026:authority:v2';
const P = 'hosei-planner:v1';
const R = P + ':recovery';
const lock = 'hosei-planner:v1:write';
const keys = [A, P, R];
const gaAttempts = [];
const localForwards = new Set();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const log = (test, details) => console.log(JSON.stringify({ test, profile, mode, width, node: process.version, ...details }));

function gaAddress(value, base = 'https://staging.hosei-tsukyo-media.com/') {
  try {
    const url = new URL(String(value), base);
    return /(?:^|\.)(?:google-analytics\.com|googletagmanager\.com|analytics\.google\.com|stats\.g\.doubleclick\.net)$/i.test(url.hostname)
      || /G-46M2R4RSX5/i.test(url.href)
      || /(?:^|\/)(?:(?:(?:g|j|r)\/)?collect|(?:gtag|gtm|analytics)\.js)(?:$|\/)/i.test(url.pathname);
  } catch { return false; }
}

const observeAnalytics = looksLikeGA => {
  function note(method, address) {
    if (looksLikeGA(address, location.href)) void window.stage73NoteGA({ method, url: String(address) });
  }
  const nativeFetch = window.fetch;
  window.fetch = function (input, ...options) {
    note('fetch', input instanceof Request ? input.url : input);
    return Reflect.apply(nativeFetch, this, [input, ...options]);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...options) {
    note('xhr', url);
    return Reflect.apply(open, this, [method, url, ...options]);
  };
  if (navigator.sendBeacon) {
    const sendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, ...args) {
      note('beacon', url);
      return Reflect.apply(sendBeacon, this, [url, ...args]);
    };
  }
  for (const [proto, label] of [[HTMLImageElement.prototype, 'img'], [HTMLScriptElement.prototype, 'script']]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
    Object.defineProperty(proto, 'src', { ...descriptor, set(url) {
      note(label + '.src', url);
      return descriptor.set.call(this, url);
    } });
  }
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === 'src' && ['img', 'script'].includes(this.localName)) note(this.localName + '.attribute', value);
    return Reflect.apply(setAttribute, this, [name, value]);
  };
  window.addEventListener('securitypolicyviolation', event => note('csp:' + event.effectiveDirective, event.blockedURI));
};
const server = createServer({
  key: await readFile(new URL('tls/key.pem', work)),
  cert: await readFile(new URL('tls/cert.pem', work)),
}, async (req, response) => {
  const host = req.headers.host;
  const method = req.method;
  const path = (req.url ?? '/').split('?')[0];
  response.setHeader('X-Test-Origin', 'stage73-loopback');
  if (host === new URL(outside).hostname && path === '/fixture-embed') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><iframe src="' + child + childPath + '"></iframe>');
    return;
  }
  const useChild = production && (host === childHost || host === new URL(childAlias).hostname);
  const which = useChild ? childRoot : parentRoot;
  const localRoutes = useChild ? childRoutes : parentRoutes;
  const contentType = name => name.endsWith('.html') ? 'text/html; charset=utf-8'
    : name.endsWith('.js') ? 'text/javascript; charset=utf-8'
    : name.endsWith('.css') ? 'text/css; charset=utf-8'
    : 'application/octet-stream';
  for (const route of localRoutes) {
    if (route.handle === 'filesystem') {
      try {
        if (!/^\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.split('/').includes('..')) continue;
        const bytes = await readFile(new URL(path.slice(1), which));
        response.writeHead(200, { 'Content-Type': contentType(path) });
        response.end(method === 'HEAD' ? undefined : bytes);
        return;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
        continue;
      }
    }
    if (!new RegExp(route.src).test(path)
      || (route.methods && !route.methods.includes(method))
      || (route.has && !route.has.every(predicate => predicate.type === 'host' && new RegExp(predicate.value).test(host)))) continue;
    if (!route.dest) {
      response.writeHead(route.status, { ...route.headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    response.writeHead(route.status ?? 200, { 'Content-Type': contentType(route.dest), ...route.headers });
    response.end(method === 'HEAD' ? undefined : await readFile(new URL(route.dest.slice(1), which)));
    return;
  }
  response.writeHead(500);
  response.end();

});
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const local = (origin, path, method = 'GET') => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: new URL(origin).hostname },
    rejectUnauthorized: false, agent: false }, res => { res.resume(); resolve(res); });
  req.on('error', reject).end();
});
let browser;
const reported = new Set();
const field = frame => frame.getByLabel('またはJSONを貼り付け');
const panel = frame => frame.getByRole('region', { name: '新しい保存先のバックアップ' });
const action = (frame, name) => panel(frame).getByRole('button', { name, exact: true });
const select = (frame, label, name, buffer) =>
  panel(frame).getByLabel(label, { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer });
const readRaw = frame => frame.evaluate(() => window.testRaw());

async function context(inject = '') {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true,
    ignoreHTTPSErrors: true, serviceWorkers: 'block', reducedMotion: 'reduce',
    ...(mode === 'ad' && width < 600 ? { hasTouch: true, isMobile: true } : {}) });
  await ctx.exposeBinding('stage73NoteGA', (_, event) => { gaAttempts.push(event); });
  await ctx.addInitScript({ content: `(${observeAnalytics})((${gaAddress}));` });
  ctx.on('request', request => {
    if (gaAddress(request.url())) gaAttempts.push({ method: request.resourceType(), url: request.url() });
  });
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (gaAddress(url.href)) {
      gaAttempts.push({ method: 'intercept', url: url.href });
      return route.abort();
    }
    if (fixtureOrigins.includes(url.origin)) {
      localForwards.add(url.origin);
      return route.continue();
    }
    reported.add(url.origin);
    if (url.href === 'https://platform.twitter.com/widgets.js') {
      return route.fulfill({ contentType: 'text/javascript', body: `
        window.twttr = { ready: callback => callback(window.twttr), widgets: { createTweet: async (_, container) => {
          const iframe = document.createElement('iframe');
          iframe.src = 'https://platform.twitter.com/stage69-fixture';
          iframe.title = 'Stage69 synthetic X post';
          container.append(iframe);
          return iframe;
        } } };
      ` });
    }
    if (url.href === 'https://platform.twitter.com/stage69-fixture') {
      return route.fulfill({ contentType: 'text/html', body: '<p id="fixture-x">Synthetic X</p>' });
    }
    if (url.hostname === 'script.google.com' && route.request().method() === 'GET') {
      return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': parent },
        body: '{"tweetIds":["111111111111111111"]}' });
    }
    return route.abort();
  });
  await ctx.addInitScript(([keys, child, inject, lock]) => {
    const storage = window.localStorage;
    const { getItem, setItem, removeItem } = Storage.prototype;
    const reads = [], writes = [];
    Storage.prototype.getItem = function (key) {
      if (this === storage && keys.includes(key)) reads.push(key);
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (this === storage && keys.includes(key)) writes.push(key);
      return setItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === storage && keys.includes(key)) writes.push('remove:' + key);
      return removeItem.call(this, key);
    };
    window.testRaw = () => ({ raw: keys.map(key => getItem.call(storage, key)), reads: [...reads], writes: [...writes] });
    window.testSet = (key, value) => setItem.call(storage, key, value);
    if (location.origin !== child) return;
    if (inject === 'seed-closed') {
      setItem.call(storage, keys[1], 'synthetic held P');
      setItem.call(storage, keys[2], 'synthetic held R');
    }
    window.stage69Events = [];
    window.addEventListener('message', event => {
      if (event.data?.type === 'synthetic-probe') {
        window.stage69Events.push([event.origin, event.source === window.parent, event.data.version]);
      }
    });
    if (inject === 'db-unknown') Object.defineProperty(indexedDB, 'databases', { value: undefined });
    if (inject === 'sw-unknown') Object.defineProperty(navigator.serviceWorker, 'getRegistrations', {
      value: async () => { throw new Error('synthetic unavailable SW enumeration'); },
    });
    if (inject === 'no-locks') Object.defineProperty(navigator, 'locks', { value: undefined });
    window.holdTestLock = () => new Promise(held => {
      void navigator.locks.request(lock, () => new Promise(release => {
        window.releaseTestLock = release;
        held(true);
      }));
    });
  }, [keys, child, inject, lock]);
  return ctx;
}

async function open(ctx, path = '/planner') {
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const response = await page.goto(parent + path);
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['x-test-origin'], 'stage73-loopback');
  return page;
}
async function workspace(page) {
  const iframe = page.getByTitle('2026年度版 履修プランナー');
  await iframe.waitFor({ timeout: 4000 });
  const frame = await (await iframe.elementHandle()).contentFrame();
  await frame.locator('#course-query').waitFor();
  return frame;
}
const parsed = snapshot => JSON.parse(snapshot.raw[0]);
const primary = snapshot => JSON.parse(parsed(snapshot).primaryRaw);

async function commit(frame, previous, trigger) {
  await trigger();
  await frame.waitForFunction(before => window.testRaw().raw[0] !== before, previous.raw[0]);
  const current = await readRaw(frame);
  assert.deepEqual(current.raw.slice(1), previous.raw.slice(1));
  assert.deepEqual(current.writes, [...previous.writes, A]);
  assert.notEqual(JSON.parse(current.raw[0]).generation, previous.raw[0] && JSON.parse(previous.raw[0]).generation);
  return current;
}
async function download(page, trigger) {
  const downloaded = page.waitForEvent('download');
  await trigger();
  const file = await downloaded;
  return readFile(await file.path());
}
async function prepare(page, frame, backup) {
  await select(frame, '移行・復元する通常バックアップを選択', 'portable.json', backup);
  const proof = await download(page, () => action(frame, '対象原文の保護ファイルを保存').click());
  await select(frame, '同じ入力ファイルを再選択', 'portable.json', backup);
  return proof;
}
async function verify(frame, proof) {
  await select(frame, '保存した保護ファイルを再選択', 'proof.json', proof);
  await action(frame, '全バイトを照合').click();
}
const course = '日本文芸研究特講・現代［戦後文学から日本を考える］(前期メディア)';
const matchedOffering = '04ff86ca-33da-4030-ae9e-6090938ddf7b';
const matchedName = '社会学(後期メディア)';
const searchOffering = '0432dfc2-8a48-498d-b754-f030b480f571';
const numeric = value => ({ raw: value === null ? '' : String(value), value });
const blank = { rawYear: '', year: null, rawTerm: '', term: null, rawDate: '', date: null, rawCredits: '', credits: null, rawGrade: '', grade: null };
const grade = {
  schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-11-21T00:00:00.000Z',
  courses: [{ rawName: course, categoryRaw: null, compositionCredits: numeric(4), earnedCredits: numeric(0),
    schoolingCredits: numeric(0), recognizedExemption: numeric(null), additionalEnrollment: numeric(null),
    reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
    creditExam: { rawDate: '', date: null, rawCredits: '', credits: null, rawGrade: '', grade: null, pendingMarker: false },
    schoolings: [{ ...blank, rawYear: '2026', year: '2026', rawTerm: 'メ', term: 'メ' }, blank] }],
};

const holdText = 'この配信先の編集資格を確認できないため、履修プランナーの保存領域は開きません。';
const shotFor = page => label => page.screenshot({ path: resolve(process.argv[5], 'screens', profile + '-' + mode + '-' + width + '-' + label + '.png') });

try {
  browser = await chromium.launch({
    ...(process.env.PLANNER_CI_CHROMIUM
      ? { executablePath: resolve(process.env.PLANNER_CI_CHROMIUM) } : { channel: 'chromium' }),
    args: ['--no-sandbox', '--disable-background-networking', '--disable-quic', '--no-proxy-server',
      '--host-resolver-rules=' + fixtureHosts.map(host => 'MAP ' + host + ' 127.0.0.1:' + port).join(',') + ',MAP * ~NOTFOUND'],
  });
  log('browser and loopback listener', { chromium: browser.version(), port });
  if (dev) await runDev();
  else {
    await routeChecks();
    if (mode === 'off') await holdChecks(true);
    else if (mode === 'ad') await runAd();
    else {
      await runCandidate();
      await runOrdinaryDevCarryForward();
      await runImportedDevCarryForward();
      await holdChecks(false);
    }
  }
  if (profile === 'staging') assert.deepEqual(gaAttempts, []);
  else assert.ok(gaAttempts.some(entry => entry.url.includes('gtag/js?id=G-46M2R4RSX5')));
  log('external network boundary', { gaAttemptsIntercepted: gaAttempts.length, externalForwarded: 0, stubbedOrBlocked: [...reported].sort() });
} finally {
  await browser?.close();
  await new Promise(ok => server.close(ok));
}

async function routeChecks() {
  const planner = await local(parent, '/planner');
  assert.equal(planner.statusCode, 200);
  assert.equal((await local(parent, '/planner/', 'HEAD')).statusCode, 200);
  assert.match(planner.headers['content-security-policy'], new RegExp('frame-src ' + child.replaceAll('.', '\\.')));
  const childResponse = await local(child, childPath);
  assert.equal(childResponse.statusCode, 200);
  assert.match(childResponse.headers['content-type'], /^text\/html/);
  assert.ok(childResponse.headers['content-security-policy'].includes('frame-ancestors ' + parent));
  assert.ok(!childResponse.headers['content-security-policy'].includes('google'));
  const asset = childRoutes.find(route => route.dest?.endsWith('.js') && route.dest.includes('child'));
  assert.ok(asset);
  const file = asset.dest.split('/').at(-1);
  const assetPath = (production ? '/_planner-child/assets/' : '/_stage69-child/assets/') + file;
  assert.equal((await local(child, assetPath)).statusCode, 200);
  for (const [origin, path] of [[parent, childPath], [child, '/planner'], [alias, '/planner'], [alias, assetPath], [childAlias, childPath], [childAlias, assetPath],
    [parent, assetPath], [child, '/release-child/planner.html'], [child, '/unknown']]) {
    assert.equal((await local(origin, path)).statusCode, 404, origin + path);
  }
  assert.equal((await local(child, '/child', 'POST')).statusCode, 404);
  log('HTTP host, asset and normalized path checks', { strictFrameAncestors: true, strictFrameSrc: true,
    deniedWrongHostAndPath: true, childAssetNotServedOnParent: true });
}

async function holdChecks(disabled) {
  const ctx = await context();
  const direct = await ctx.newPage();
  await direct.goto(child + childPath);
  await direct.getByRole('status').filter({ hasText: holdText }).waitFor();
  assert.deepEqual(await readRaw(direct), { raw: [null, null, null], reads: [], writes: [] });
  const wrong = await ctx.newPage();
  await wrong.goto(outside + '/fixture-embed');
  const blocked = wrong.frames().find(frame => frame.parentFrame());
  assert.ok(blocked);
  await blocked.waitForLoadState().catch(() => {});
  assert.equal(await blocked.locator('#course-query').count(), 0);
  const cases = disabled ? ['seed-closed'] : ['no-locks', 'db-unknown', 'sw-unknown'];
  for (const reason of cases) {
    const scoped = await context(reason);
    const page = await open(scoped);
    const frame = await (await page.getByTitle('2026年度版 履修プランナー').elementHandle()).contentFrame();
    await frame.getByRole('status').filter({ hasText: holdText }).waitFor();
    const sample = await readRaw(frame);
    assert.deepEqual(sample.reads, []);
    assert.deepEqual(sample.writes, []);
    if (disabled) assert.deepEqual(sample.raw.slice(1), ['synthetic held P', 'synthetic held R']);
    await scoped.close();
  }
  log('holding states', { disabled, cases, directChildWrites: 0, outsideFrameBlocked: true });
  await ctx.close();
}

async function homeLinks(page, embedded, shot) {
  await page.goto(parent + '/');
  assert.equal(await page.getByRole('banner').getByRole('link', { name: '履修計画', exact: true }).count(), 1);
  const navigation = () => page.getByRole('navigation', { name: '履修プランナー', exact: true });
  for (const [label, href, target] of [
    ['成績取り込み', '/planner#grade-import', 'grade-import'],
    ['メディア進捗記録', '/planner#media', 'media-panel'],
    ['履修計画', '/planner', 'course-query'],
  ]) {
    const link = navigation().getByRole('link', { name: label, exact: true });
    assert.equal(await link.getAttribute('href'), href);
    if (label === '成績取り込み') {
      await link.scrollIntoViewIfNeeded();
      await shot('home-links');
    }
    await link.click();
    await page.waitForURL(parent + href);
    const shell = page.getByTitle('2026年度版 履修プランナー');
    if (embedded) {
      await shell.waitFor();
      const permissions = (await shell.getAttribute('allow')).split(';').map(value => value.trim());
      assert.deepEqual(permissions.filter(value => value.startsWith('focus-without-user-activation')),
        ['focus-without-user-activation ' + child]);
    }
    const view = embedded ? await (await shell.elementHandle()).contentFrame() : page.mainFrame();
    if (embedded) await view.waitForURL(child + childPath + new URL(href, parent).hash);
    await view.locator('#' + target).waitFor();
    if (target !== 'course-query') await view.waitForFunction(target => document.activeElement?.id === target, target);
    if (target === 'grade-import') assert.equal(await view.locator('#grade-import').evaluate(node => node.open), true);
    await page.goto(parent + '/');
  }
  log('Home and Header navigation', { links: 3, madeItToTarget: true });
}

async function runDev() {
  const ctx = await context();
  const page = await open(ctx);
  const shot = shotFor(page);
  await homeLinks(page, false, shot);
  await page.goto(parent + '/planner');
  await page.locator('#course-query').waitFor();
  assert.equal(await page.getByRole('tab').count(), 3);
  assert.equal(await page.getByRole('button', { name: '画像を生成', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'CSVで保存', exact: true }).count(), 1);
  assert.equal(await page.getByRole('navigation', { name: 'ページ移動' }).count(), 1);
  assert.equal(await page.locator('footer').count(), 1);
  await page.locator('.edge-scroll').waitFor();
  await shot('annual');
  log('fixed dev runtime comparison', { tabs: 3, csv: true, originalPlanPng: true, footerAndEdge: true });
  await ctx.close();
}

async function runAd() {
  const ctx = await context();
  const page = await open(ctx, '/');
  const shot = shotFor(page);
  const ad = page.getByRole('complementary', { name: '広告', exact: true });
  const box = () => ad.boundingBox();
  const adTopAfterLayout = async () => {
    await page.waitForFunction(() => {
      const rectangle = document.querySelector('aside[aria-label="広告"]')?.getBoundingClientRect();
      return rectangle && rectangle.height > 20 && Math.abs(rectangle.bottom - innerHeight) <= 2;
    });
    return (await box()).y;
  };
  await adTopAfterLayout();
  assert.equal(await ad.getByRole('img', { name: '合成素材・配置確認のみ' }).count(), 1);
  const first = await box();
  await page.evaluate(() => window.scrollTo(0, 640));
  assert.deepEqual(await box(), first);
  const parentNav = page.getByRole('navigation', { name: 'ページ移動' }).locator('.edge-scroll');
  await page.waitForFunction(() => document.querySelector('.edge-scroll').getBoundingClientRect().bottom
    <= document.querySelector('aside[aria-label="広告"]').getBoundingClientRect().top);
  await parentNav.press('End');
  await page.waitForFunction(() => Math.abs(document.documentElement.scrollHeight - (scrollY + innerHeight)) <= 2);
  const footerBottom = await page.locator('footer').evaluate(node => node.getBoundingClientRect().bottom);
  assert.ok(footerBottom <= first.y + 1);
  await shot('home-footer');
  await page.goto(parent + '/planner');
  let frame = await workspace(page);
  let top = await adTopAfterLayout();
  let iframe = await page.getByTitle('2026年度版 履修プランナー').boundingBox();
  assert.ok(iframe.y + iframe.height <= top + 1);
  assert.equal(await frame.getByRole('complementary', { name: '広告' }).count(), 0);
  const input = frame.locator('#course-query');
  await input.fill('60073');
  const prev = await readRaw(frame);
  const planned = await commit(frame, prev, () => frame.getByRole('button', { name: /（60073）を履修計画に追加/ }).click());
  const backup = await download(page, () => action(frame, '新版の通常バックアップ').click());
  const proof = await prepare(page, frame, backup);
  await verify(frame, proof);
  const confirmation = panel(frame).getByRole('checkbox');
  await confirmation.scrollIntoViewIfNeeded();
  const focusBox = await confirmation.boundingBox();
  assert.ok(focusBox.y + focusBox.height <= top + 1);
  await confirmation.check();
  await commit(frame, planned, () => action(frame, '移行・復元を確定').click());
  await shot('planner-protected-restore');
  await frame.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  assert.equal((await box()).y, top);
  assert.ok(await frame.locator('footer').evaluate(node => node.getBoundingClientRect().top < innerHeight));
  await shot('planner-footer');
  if (width < 600) {
    await page.setViewportSize({ width: 844, height: 390 });
    top = await adTopAfterLayout();
    iframe = await page.getByTitle('2026年度版 履修プランナー').boundingBox();
    assert.ok(iframe.y + iframe.height <= top + 1);
    await shot('landscape');
    await page.setViewportSize({ width: 390, height: 900 });
    await adTopAfterLayout();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: innerHeight - 260 });
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await ad.waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      Reflect.deleteProperty(window.visualViewport, 'height');
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await adTopAfterLayout();
  }
  assert.deepEqual(await readRaw(page), { raw: [null, null, null], reads: [], writes: [] });
  log('synthetic fixed bottom banner', { parentOnly: true, fixedDuringBothScrolls: true,
    parentFooterAndNavigationClear: true, childPanelClear: true, restorationWithBanner: true,
    rotatedAndVisualViewportKeyboardSimulated: width < 600 });
  await ctx.close();
}

async function runOrdinaryDevCarryForward() {
  const input = gunzipSync(await readFile(new URL('../fixtures/planner-release/ordinary-dev.json.gz', import.meta.url)));
  const sourceHash = '55dbb1ff7dc5d0adcb8136ce7572be53d7559e22aa65ce2d867b9b0460848648';
  assert.equal(digest(input), sourceHash);
  const sourceState = JSON.parse(input.toString()).state;
  const ctx = await context();
  const page = await open(ctx);
  let frame = await workspace(page);
  const before = await readRaw(frame);
  const proof = await prepare(page, frame, input);
  const proofHash = digest(proof);
  await verify(frame, proof);
  await panel(frame).getByRole('checkbox').check();
  const restored = await commit(frame, before, () => action(frame, '移行・復元を確定').click());
  assert.deepEqual(primary(restored), sourceState);
  assert.equal(parsed(restored).version, 2);
  assert.deepEqual(parsed(restored).tracks, []);
  await frame.getByRole('tab', { name: 'メディア', exact: true }).click();
  const held = frame.locator('[data-media-held-offering-id="' + searchOffering + '"]');
  await held.getByText(/動画 1\/14/).waitFor();
  const card = () => frame.locator('[data-media-offering-id="' + searchOffering + '"]');
  const selectClaim = held.getByRole('checkbox');
  const confirm = held.getByRole('button', { name: '旧進捗の引継ぎを確定', exact: true });
  log('P1 restored old progress before confirmation', {
    held: await held.count(), editableRows: await card().count(), confirmControl: await confirm.count(),
    writes: restored.writes,
  });
  assert.equal(await card().count(), 0);
  await selectClaim.waitFor();
  assert.equal(await confirm.isDisabled(), true);
  await selectClaim.check();
  await held.getByRole('button', { name: '引継ぎを取り消す' }).click();
  assert.equal(await confirm.isDisabled(), true);
  assert.deepEqual(await readRaw(frame), restored);
  await selectClaim.check();
  const claimed = await commit(frame, restored, () => confirm.click());
  assert.equal(parsed(claimed).version, 4);
  assert.equal(parsed(claimed).primaryRaw, parsed(restored).primaryRaw);
  const [track] = parsed(claimed).tracks;
  assert.deepEqual(track.progress, sourceState.mediaSchoolingProgress[searchOffering]);
  await card().getByText('動画 1/14', { exact: true }).waitFor();
  await card().getByRole('button', { name: /各回一覧を表示/ }).click();
  const edited = await commit(frame, claimed,
    () => card().getByRole('checkbox', { name: '動画', exact: true }).nth(1).click());
  await card().getByText('動画 2/14', { exact: true }).waitFor();
  assert.equal(parsed(edited).tracks[0].id, track.id);
  assert.equal(parsed(edited).primaryRaw, parsed(restored).primaryRaw);
  await page.reload();
  frame = await workspace(page);
  await frame.getByRole('tab', { name: 'メディア', exact: true }).click();
  await card().getByText('動画 2/14', { exact: true }).waitFor();
  assert.deepEqual((await readRaw(frame)).raw, edited.raw);
  await frame.getByRole('tab', { name: '年間履修計画', exact: true }).click();
  const portable = await download(page, () => action(frame, '新版の通常バックアップ').click());
  assert.equal(JSON.parse(portable).format, 'hosei-planner:2026:portable:v4');

  const destination = await open(await context());
  const restoredFrame = await workspace(destination);
  const empty = await readRaw(restoredFrame);
  const portableProof = await prepare(destination, restoredFrame, portable);
  await verify(restoredFrame, Buffer.concat([portableProof, Buffer.from(' ')]));
  await panel(restoredFrame).getByRole('alert').filter({ hasText: '一致しません' }).waitFor();
  assert.deepEqual((await readRaw(restoredFrame)).writes, empty.writes);
  await verify(restoredFrame, portableProof);
  await panel(restoredFrame).getByRole('checkbox').check();
  const roundtrip = await commit(restoredFrame, empty, () => action(restoredFrame, '移行・復元を確定').click());
  assert.deepEqual(parsed(roundtrip).tracks, parsed(edited).tracks);
  assert.equal(parsed(roundtrip).primaryRaw, parsed(restored).primaryRaw);
  assert.deepEqual(roundtrip.raw.slice(1), before.raw.slice(1));
  assert.deepEqual(await readRaw(page), { raw: [null, null, null], writes: [], reads: [] });
  assert.deepEqual(edited.raw.slice(1), before.raw.slice(1));
  assert.equal(digest(input), sourceHash);
  assert.equal(digest(proof), proofHash);
  log('P1 explicit legacy progress carry-forward', {
    sourceHash, proofHash, videoBefore: 1, videoAfter: 2, videoAfterReload: 2,
    offering: searchOffering, total: 14, primaryRawPreserved: true, parentAndLegacyPreserved: true,
    v4TracksAndUuidRoundTrip: true, cancelledWrites: 0, alteredProofWrites: 0,
  });
  await destination.context().close();
  await ctx.close();
}

async function runImportedDevCarryForward() {
  const input = gunzipSync(await readFile(new URL('../fixtures/planner-release/ordinary-dev-import.json.gz', import.meta.url)));
  const sourceHash = '703d3cfc72af2bc8a0d5fac2903fc7b5c814608c9536072655af244b107a900a';
  assert.equal(digest(input), sourceHash);
  const sourceState = JSON.parse(input.toString()).state;
  const [originalRow] = sourceState.importedCourseAchievements;
  const [originalDetail] = sourceState.importedStudyRecords;
  const ctx = await context();
  const page = await open(ctx);
  let frame = await workspace(page);
  const before = await readRaw(frame);
  const proof = await prepare(page, frame, input);
  const protectionHash = digest(proof);
  await verify(frame, proof);
  await panel(frame).getByRole('checkbox').check();
  const restored = await commit(frame, before, () => action(frame, '移行・復元を確定').click());
  assert.deepEqual(primary(restored), sourceState);
  assert.equal(parsed(restored).version, 2);
  assert.deepEqual(parsed(restored).tracks, []);
  const media = () => frame.getByRole('tab', { name: 'メディア', exact: true });
  const annual = () => frame.getByRole('tab', { name: '年間履修計画', exact: true });
  await media().click();
  const held = frame.locator('[data-media-held-offering-id="' + matchedOffering + '"]');
  await held.getByText(/動画 1[/]14/).waitFor();
  const card = () => frame.locator('[data-media-source-record="' + originalDetail.id + '"]');
  const selectClaim = held.getByRole('checkbox');
  const confirm = held.getByRole('button', { name: '旧進捗の引継ぎを確定', exact: true });
  log('imported P1 before confirmation', { editableRows: await card().count(), claimButtons: await confirm.count(), writes: restored.writes });
  await held.getByText(/2026年度・後期メディアの成績取込の本人詳細回/).waitFor();
  assert.equal(await card().count(), 0);
  assert.equal(await confirm.isDisabled(), true);
  await selectClaim.check();
  await annual().click();
  await media().click();
  assert.equal(await confirm.isDisabled(), true);
  assert.deepEqual(await readRaw(frame), restored);
  await selectClaim.check();
  await held.getByRole('button', { name: '引継ぎを取り消す' }).click();
  assert.equal(await confirm.isDisabled(), true);
  assert.deepEqual(await readRaw(frame), restored);
  await selectClaim.check();
  const claimed = await commit(frame, restored, () => confirm.click());
  const [track] = parsed(claimed).tracks;
  assert.equal(parsed(claimed).version, 5);
  assert.equal(track.owner, originalDetail.id);
  assert.equal(track.sourceId, originalRow.id);
  assert.deepEqual(track.progress, { totalLessons: 14, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }], assessments: [] });
  assert.equal(await held.count(), 0);
  await card().getByText('動画 1/14', { exact: true }).waitFor();
  await card().getByRole('button', { name: /各回一覧を表示/ }).click();
  const edited = await commit(frame, claimed, () => card().getByRole('checkbox', { name: 'テスト', exact: true }).nth(1).click());
  const [updated] = parsed(edited).tracks;
  assert.equal(updated.id, track.id);
  assert.equal(updated.owner, originalDetail.id);
  assert.equal(updated.sourceId, originalRow.id);
  assert.deepEqual(updated.progress.lessons, [
    { lesson: 1, videoCompleted: true, testCompleted: false },
    { lesson: 2, videoCompleted: false, testCompleted: true },
  ]);
  assert.equal(parsed(edited).primaryRaw, parsed(restored).primaryRaw);
  await page.reload();
  frame = await workspace(page);
  await media().click();
  await card().getByText('動画 1/14', { exact: true }).waitFor();
  await card().getByText('テスト 1/14', { exact: true }).waitFor();
  assert.deepEqual((await readRaw(frame)).raw, edited.raw);
  assert.equal(await frame.locator('[data-media-held-offering-id="' + matchedOffering + '"]').count(), 0);
  await annual().click();
  const backup = await download(page, () => action(frame, '新版の通常バックアップ').click());
  assert.equal(JSON.parse(backup).format, 'hosei-planner:2026:portable:v5');

  const destination = await open(await context());
  const target = await workspace(destination);
  const empty = await readRaw(target);
  const portableProof = await prepare(destination, target, backup);
  await verify(target, Buffer.concat([portableProof, Buffer.from(' ')]));
  await panel(target).getByRole('alert').filter({ hasText: '一致しません' }).waitFor();
  assert.deepEqual((await readRaw(target)).writes, empty.writes);
  await verify(target, portableProof);
  await panel(target).getByRole('checkbox').check();
  const roundtrip = await commit(target, empty, () => action(target, '移行・復元を確定').click());
  assert.deepEqual(parsed(roundtrip).tracks, [updated]);
  assert.equal(parsed(roundtrip).primaryRaw, parsed(restored).primaryRaw);
  assert.deepEqual(roundtrip.raw.slice(1), before.raw.slice(1));
  assert.deepEqual(await readRaw(page), { raw: [null, null, null], writes: [], reads: [] });
  assert.equal(digest(input), sourceHash);
  assert.equal(digest(proof), protectionHash);
  log('imported P1 video 1 plus test 2 on the existing detail', {
    sourceHash, protectionHash, offering: matchedOffering, source: originalRow.id, detail: originalDetail.id,
    sameTrackUuid: true, preservedVideoLesson: 1, newTestLesson: 2, portableAndReload: true,
    rawAndProtectionPreserved: true, cancelledWrites: 0, alteredProofWrites: 0,
  });
  await destination.context().close();
  await ctx.close();
}

async function revealOfficial(frame, sourceId) {
  const row = frame.locator('[data-official-id="' + sourceId + '"]');
  const enclosingCourse = row.locator('xpath=ancestor::section[@data-curriculum-course-id]');
  const toggle = enclosingCourse.getByRole('button', { name: '詳細・編集を開く', exact: true });
  if (await toggle.count()) await toggle.click();
  return row;
}

async function runCandidate() {
  const ctx = await context();
  const page = await open(ctx);
  const shot = shotFor(page);
  await homeLinks(page, true, shot);
  await page.goto(parent + '/planner#synthetic-sensitive-value');
  let frame = await workspace(page);
  // Only explicit navigation fragments may transit into the child.
  assert.equal(new URL(frame.url()).hash, '');
  await page.goto(parent + '/planner');
  frame = await workspace(page);
  await page.evaluate(([p, r]) => { window.testSet(p, 'synthetic parent primary'); window.testSet(r, 'synthetic parent recovery'); }, [P, R]);
  assert.equal(await page.getByRole('banner').count(), 1);
  assert.equal(await page.getByRole('complementary', { name: '広告', exact: true }).count(), 0);
  assert.equal(await frame.getByRole('tab').count(), 3);
  assert.equal(await page.evaluate(() => document.querySelector('iframe').contentDocument), null);
  const exportActions = frame.getByRole('region', { name: '履修計画の保存', exact: true });
  assert.equal(await exportActions.getByRole('button', { name: 'CSVで保存', exact: true }).count(), 1);
  assert.equal(await exportActions.getByRole('button', { name: /画像を生成|共有・保存/ }).count(), 0);
  assert.equal(await exportActions.getByText('生成されたPNGの確認', { exact: true }).count(), 0);
  assert.equal(await exportActions.locator('img, a[download], a[href^="data:image/"]').count(), 0);
  assert.equal(await frame.getByRole('button', { name: 'CSVで保存', exact: true }).count(), 1);
  await frame.locator('.edge-scroll').waitFor();
  await shot('annual');
  const nav = frame.getByRole('navigation', { name: 'ページ移動' });
  const rawName = '健康・スポーツ科学概論［スポーツコーチングの基礎］(後期メディア)';
  const courseSlot = { ...grade.courses[0].schoolings[0], rawTerm: '後期メディア', term: '後期メディア' };
  const sport = { ...grade.courses[0], rawName, schoolings: [courseSlot, blank] };
  const rows = [sport,
    { ...sport, schoolings: [{ ...courseSlot, rawYear: '2027', year: '2027' }, blank] },
    { ...sport, rawName: '経営学特講（合成未照合）', earnedCredits: numeric(1) },
    { ...sport, rawName: '合成構成不明メディア', earnedCredits: numeric(2), compositionCredits: numeric(null),
      schoolings: [{ ...courseSlot, rawGrade: 'B', grade: 'B' }, blank] },
    { ...sport, rawName: '合成修得済メディア', earnedCredits: numeric(4),
      schoolings: [{ ...courseSlot, rawGrade: 'A', grade: 'A' }, blank] },
    { ...sport, rawName: '合成確定済み科目', earnedCredits: numeric(0),
      schoolings: [{ ...courseSlot, rawGrade: 'D', grade: 'D' }, blank] },
    { ...sport, rawName: matchedName,
      schoolings: [{ ...courseSlot, rawTerm: '後期メディア', term: '後期メディア' }, blank] }];
  const data = { ...grade, courses: rows };
  await uploadGrade(frame, data);
  let initial = await readRaw(frame);
  initial = await commit(frame, initial, () => frame.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録' }).click());
  const state = JSON.parse(JSON.parse(initial.raw[0]).primaryRaw);
  const src = state.importedCourseAchievements[0];
  assert.equal(src.courseId, null);
  assert.equal(src.selectedOfferingId, null);
  const unresolvedOffering = 'debf7f03-4af5-45ee-b815-065c230b1a74';
  assert.deepEqual(src.candidateOfferingIds, [unresolvedOffering]);
  assert.equal(state.items.some(item => item.offeringId === unresolvedOffering), false);
  const sportRecord = state.importedStudyRecords.find(record => record.sourceCourseId === src.id);
  assert.equal(sportRecord.offeringId, unresolvedOffering);
  assert.equal(sportRecord.rawTerm, '後期メディア');
  assert.equal(sportRecord.grade, null);
  const unmatched = state.importedCourseAchievements.find(row => row.rawName.includes('合成未照合'));
  assert.equal(unmatched.courseId, null);
  assert.deepEqual(unmatched.candidateOfferingIds, []);
  for (const name of ['合成構成不明メディア', '合成修得済メディア']) {
    const source = state.importedCourseAchievements.find(row => row.rawName === name);
    assert.equal(state.importedCourseUserMeta[source.id], undefined);
    const official = await revealOfficial(frame, source.id);
    await official.locator('summary').filter({ hasText: 'ユーザー管理情報' }).click();
    initial = await commit(frame, initial, () => official.getByRole('combobox', { name: '履修状態' }).selectOption('in_progress'));
  }
  await frame.getByRole('tab', { name: 'メディア', exact: true }).click();
  const independentCard = frame.locator('[data-media-source-record]');
  await runGreen({ frame, page, shot, nav, imported: initial, src, independentCard, payload: JSON.stringify(data) });
  await ctx.close();
}

async function runGreen({ frame, page, shot, nav, imported, src, independentCard, payload }) {
  assert.equal(await page.getByRole('banner').count(), 1);
  assert.equal(await frame.getByRole('banner').count(), 0);
  assert.equal(await page.locator('footer').count(), 0);
  assert.equal(await frame.locator('footer').count(), 1);
  const homeLink = frame.locator('footer').getByRole('link', { name: 'ホーム', exact: true });
  assert.equal(new URL(await homeLink.getAttribute('href')).origin, parent);
  assert.equal(await homeLink.getAttribute('target'), '_top');
  assert.equal(await page.evaluate(() => scrollY), 0);
  const firstState = primary(imported);
  const sport = firstState.importedCourseAchievements.filter(row => row.rawName === src.rawName);
  const partial = firstState.importedCourseAchievements.find(row => row.rawName === '経営学特講（合成未照合）');
  const finished = firstState.importedCourseAchievements.find(row => row.rawName === '合成確定済み科目');
  assert.equal(sport.length, 2);
  assert.ok(sport.every(row => firstState.importedCourseUserMeta[row.id].lifecycleStatus === 'in_progress'));
  assert.equal(firstState.importedCourseUserMeta[partial.id].lifecycleStatus, 'in_progress');
  assert.equal(firstState.importedCourseUserMeta[finished.id], undefined);
  const auto = firstState.importedCourseAchievements.find(row => row.rawName === matchedName);
  assert.equal(auto.selectionSource, 'auto');
  assert.equal(auto.selectedOfferingId, matchedOffering);
  assert.equal(firstState.items.filter(item => item.offeringId === matchedOffering).length, 1);
  assert.equal(await frame.locator('[data-media-offering-id="' + matchedOffering + '"]').count(), 0);
  assert.equal(await independentCard.count(), 6);
  log('fresh lifecycle, repeats and partial evidence', { repeatRows: sport.map(row => row.academicYear),
    finishedDefault: null, partialEarned: partial.earnedCreditsTotal, creditUnknownAndEarnedManual: true, activeCards: await independentCard.count() });
  let annual = frame.getByRole('tab', { name: '年間履修計画', exact: true });
  let media = frame.getByRole('tab', { name: 'メディア', exact: true });
  await annual.click();
  const search = frame.locator('#course-query');
  await search.fill('60073');
  let stage = await commit(frame, imported, () => frame.getByRole('button', { name: /（60073）を履修計画に追加/ }).click());
  await media.click();
  const catalogCard = frame.locator('[data-media-offering-id="' + searchOffering + '"]');
  stage = await commit(frame, stage, () => catalogCard.getByRole('button', { name: '14回', exact: true }).click());
  const linked = parsed(stage).tracks[0];
  assert.equal(linked.offeringId, searchOffering);
  assert.equal(parsed(stage).version, 2);
  await annual.click();
  const csv = await download(page, () => frame.getByRole('button', { name: 'CSVで保存', exact: true }).click());
  assert.ok(csv.toString().includes('科目名'));
  assert.ok(csv.toString().includes('60073') || csv.toString().includes('メディア'));
  const oldBackup = await download(page, () => action(frame, '新版の通常バックアップ').click());
  assert.equal(JSON.parse(oldBackup).format, 'hosei-planner:2026:portable:v2');

  await media.click();
  const oldRecords = firstState.importedStudyRecords;
  const sportId = oldRecords.find(record => record.sourceCourseId === src.id && record.method === 'schooling').id;
  let sportCard = frame.locator('[data-media-source-record="' + sportId + '"]');
  assert.equal(await sportCard.getByRole('button', { name: '14回', exact: true }).isDisabled(), true);
  assert.deepEqual((await readRaw(frame)).raw, stage.raw);
  await frame.getByRole('checkbox', { name: /保存形式をv3に更新/ }).check();
  stage = await commit(frame, stage, () => sportCard.getByRole('button', { name: '14回', exact: true }).click());
  const v3 = parsed(stage);
  assert.equal(v3.version, 3);
  assert.deepEqual(v3.tracks.find(track => track.id === linked.id), linked);
  const track = v3.tracks.find(track => track.owner === sportId);
  assert.equal(track.offeringId, null);
  assert.equal(track.sourceId, src.id);
  assert.equal(Object.hasOwn(track.progress, 'offeringId'), false);
  await sportCard.getByRole('button', { name: /各回一覧を表示/ }).click();
  stage = await commit(frame, stage, () => sportCard.getByRole('checkbox', { name: '動画', exact: true }).first().click());
  stage = await commit(frame, stage, () => sportCard.getByRole('checkbox', { name: 'テスト', exact: true }).nth(1).click());
  stage = await commit(frame, stage, () => sportCard.getByRole('button', { name: '試験を追加', exact: true }).click());
  const assessment = parsed(stage).tracks.find(row => row.id === track.id).progress.assessments[0];
  await sportCard.getByLabel('予定日', { exact: true }).fill('2026-12-18');
  stage = await commit(frame, stage, () => sportCard.getByLabel('予定日', { exact: true }).press('Enter'));
  let partialCard = independentCard.filter({ hasText: '経営学特講' });
  stage = await commit(frame, stage, () => partialCard.getByRole('button', { name: '15回', exact: true }).click());
  for (const name of ['合成構成不明メディア', '合成修得済メディア', matchedName]) {
    const card = independentCard.filter({ hasText: name });
    stage = await commit(frame, stage, () => card.getByRole('button', { name: '14回', exact: true }).click());
  }
  assert.deepEqual(primary(stage).importedCourseAchievements, firstState.importedCourseAchievements);
  assert.deepEqual(primary(stage).importedStudyRecords, firstState.importedStudyRecords);
  const autoTrack = parsed(stage).tracks.find(row => row.sourceId === auto.id);
  await annual.click();
  const management = frame.locator('#imported-achievements');
  await management.locator('details > summary').first().click();
  await management.getByRole('button', { name: '保存済み全件のメンテナンスを表示' }).click();
  const repair = management.locator('[data-import-repair-id="' + auto.id + '"]');
  const choose = repair.getByRole('combobox', { name: matchedName + 'の照合先' });
  stage = await commit(frame, stage, () => choose.selectOption(''));
  await repair.getByRole('textbox', { name: matchedName + 'の開講検索' }).fill('社会学');
  stage = await commit(frame, stage, () => choose.selectOption(matchedOffering));
  const updated = primary(stage).importedCourseAchievements.find(row => row.id === auto.id);
  assert.equal(updated.selectionSource, 'manual');
  assert.equal(updated.fingerprint, auto.fingerprint);
  assert.equal(updated.earnedCreditsTotal, auto.earnedCreditsTotal);
  assert.deepEqual(parsed(stage).tracks.find(row => row.sourceId === auto.id), autoTrack);
  await page.reload();
  frame = await workspace(page);
  nav = frame.getByRole('navigation', { name: 'ページ移動' });
  annual = frame.getByRole('tab', { name: '年間履修計画', exact: true });
  media = frame.getByRole('tab', { name: 'メディア', exact: true });
  sportCard = frame.locator('[data-media-source-record="' + sportId + '"]');
  partialCard = frame.locator('[data-media-source-record]').filter({ hasText: '経営学特講' });
  const reopened = await readRaw(frame);
  assert.deepEqual(reopened.raw, stage.raw);
  stage = reopened;
  await media.click();
  await sportCard.getByText('動画 1/14', { exact: true }).waitFor();
  await sportCard.getByText('テスト 1/14', { exact: true }).waitFor();
  assert.equal(await sportCard.getByLabel('予定日', { exact: true }).inputValue(), '2026-12-18');
  stage = await commit(frame, stage, () => sportCard.getByRole('checkbox', { name: '実施済み', exact: true }).click());
  const afterReload = parsed(stage).tracks.find(row => row.owner === sportId);
  assert.equal(afterReload.id, track.id);
  assert.equal(afterReload.progress.assessments[0].id, assessment.id);
  assert.equal(afterReload.progress.assessments[0].completed, true);
  assert.deepEqual(afterReload.progress.lessons, [
    { lesson: 1, videoCompleted: true, testCompleted: false },
    { lesson: 2, videoCompleted: false, testCompleted: true },
  ]);
  log('unresolved real catalog media progress', { offeringCourseId: src.courseId, source: src.id, detail: sportId,
    track: track.id, videoOneAndTestTwoPreserved: true, assessmentPersistedAndEditable: true });
  await partialCard.getByText('動画 0/15', { exact: true }).waitFor();
  for (const name of ['合成構成不明メディア', '合成修得済メディア', matchedName]) {
    await frame.locator('[data-media-source-record]').filter({ hasText: name }).getByText('動画 0/14', { exact: true }).waitFor();
  }
  log('automatic and manual catalog reference', { oneActiveCard: true, recordUuidUnchanged: true, officialRawFingerprintUnchanged: true });
  await frame.getByRole('button', { name: '全科目を共有' }).click();
  const dialog = frame.getByRole('dialog', { name: 'メディア進捗を共有' });
  await dialog.getByRole('button', { name: '画像生成', exact: true }).click();
  await dialog.getByText('PNGを生成しました。共有・保存ボタンから保存できます。', { exact: true }).waitFor();
  await shot('media-share');
  assert.ok(await dialog.getByText(/合成構成不明メディア/).count() > 0);
  await dialog.getByRole('button', { name: '共有モーダルを閉じる' }).click();
  log('CSV and media PNG parity', { localCsvDownload: true, pngPreviewGenerated: true, gradeBearingPlanPngHidden: true });
  stage = await readRaw(frame);
  await annual.click();
  const official = await revealOfficial(frame, src.id);
  await official.locator('summary').filter({ hasText: 'ユーザー管理情報' }).click();
  stage = await commit(frame, stage, () => official.getByRole('combobox', { name: '履修状態' }).selectOption(''));
  assert.equal(primary(stage).importedCourseUserMeta[src.id].lifecycleStatus, null);
  const partialOfficial = await revealOfficial(frame, partial.id);
  if (!await partialOfficial.getByRole('combobox', { name: '履修状態' }).isVisible()) {
    await partialOfficial.locator('summary').filter({ hasText: 'ユーザー管理情報' }).click();
  }
  stage = await commit(frame, stage, () => partialOfficial.getByRole('combobox', { name: '履修状態' }).selectOption('waiting'));

  const nextImport = JSON.parse(payload);
  nextImport.courses.push({ ...nextImport.courses[0], rawName: '合成追加科目' });
  await uploadGrade(frame, nextImport);
  stage = await commit(frame, stage, () => frame.getByRole('button', { name: '確認した履修実績を保存・履修計画に仮登録' }).click());
  assert.equal(primary(stage).importedCourseUserMeta[src.id].lifecycleStatus, null);
  assert.equal(primary(stage).importedCourseUserMeta[partial.id].lifecycleStatus, 'waiting');
  assert.deepEqual(parsed(stage).tracks.find(row => row.owner === sportId), afterReload);
  assert.ok(primary(stage).importedStudyRecords.some(row => row.id === sportId));
  assert.deepEqual(await readRaw(page), { raw: [null, 'synthetic parent primary', 'synthetic parent recovery'], reads: [], writes: [] });
  log('both entry points and re-import', { oldTrackIdPreserved: true, sourceRecordIdPreserved: true, explicitNullPreserved: true, explicitWaitingPreserved: true,
    parentData: await readRaw(page), allProgressWritesChildA: true });
  const backup = await download(page, () => action(frame, '新版の通常バックアップ').click());
  assert.equal(JSON.parse(backup).format, 'hosei-planner:2026:portable:v3');
  for (const [bytes, version] of [[oldBackup, 2], [backup, 3]]) {
    const freshPage = await open(await context());
    const fresh = await workspace(freshPage);
    const initial = await readRaw(fresh);
    const proof = await prepare(freshPage, fresh, bytes);
    if (version === 3) {
      await verify(fresh, Buffer.concat([proof, Buffer.from(' ')]));
      await panel(fresh).getByRole('alert').filter({ hasText: '一致しません' }).waitFor();
      assert.deepEqual(await readRaw(fresh), { ...await readRaw(fresh), raw: initial.raw, writes: initial.writes });
    }
    await verify(fresh, proof);
    await panel(fresh).getByRole('checkbox').check();
    const restored = await commit(fresh, initial, () => action(fresh, '移行・復元を確定').click());
    const expected = JSON.parse(JSON.parse(bytes).envelope);
    assert.equal(parsed(restored).version, version);
    assert.deepEqual(parsed(restored).tracks, expected.tracks);
    assert.equal(parsed(restored).primaryRaw, expected.primaryRaw);
    await freshPage.close();
  }
  log('protected v2 and v3 regular backup', { originalPrimaryAndTrackIdsPreserved: true, alteredProofWrites: 0 });
  await frame.getByRole('tab', { name: 'プロフィール', exact: true }).click();
  const program = frame.getByLabel('所属学科');
  const scope = await program.locator('option').evaluateAll(options => options.map(option => option.value).find(Boolean));
  await commit(frame, stage, () => program.selectOption(scope));

  const edgeButton = nav.locator('.edge-scroll');
  for (const [label, expected] of [
    ['科目検索へ', 'course-query'], ['卒業要件へ', 'graduation-progress-heading'],
    ['履修・修得一覧へ', 'planned-heading'], ['メディア記録へ', 'media-panel'],
  ]) {
    // A hash change and its scroll can close the old menu on the next frame.
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await edgeButton.press('ArrowDown');
    await frame.waitForFunction(() => document.activeElement?.matches('[data-edge-destination="0"]'));
    await nav.getByRole('button', { name: label, exact: true }).click();
    await frame.waitForFunction(id => document.activeElement?.id === id, expected);
    assert.equal(await frame.evaluate(id => {
      const target = document.getElementById(id).getBoundingClientRect();
      const edge = document.querySelector('.edge-scroll').getBoundingClientRect();
      return target.top >= 0 && target.top < innerHeight && (target.top < edge.top || target.right < edge.left);
    }, expected), true);
  }
  await shot('shortcuts');
  await edgeButton.press('Home');
  await frame.waitForFunction(() => scrollY === 0);
  assert.equal(await frame.locator('footer').evaluate(node => node.getBoundingClientRect().top > innerHeight), true);
  await shot('top');
  await edgeButton.press('End');
  await frame.waitForFunction(() => Math.abs(document.documentElement.scrollHeight - (scrollY + innerHeight)) <= 2);
  assert.equal(await frame.locator('footer').evaluate(node => node.getBoundingClientRect().top < innerHeight), true);
  assert.equal(await page.evaluate(() => scrollY), 0);
  await shot('footer');
  log('edge focus and footer', { shortcuts: 4, parentScroll: 0, footerVisibleOnlyAtEnd: true });
  await annual.click();
  const current = await readRaw(frame);
  const newBackup = await download(page, () => action(frame, '新版の通常バックアップ').click());
  const peer = await open(page.context());
  const peerFrame = await workspace(peer);
  const proof = await prepare(page, frame, newBackup);
  await verify(frame, proof);
  await panel(frame).getByRole('checkbox').check();
  await peerFrame.evaluate(() => window.holdTestLock());
  await action(frame, '移行・復元を確定').click();
  await peerFrame.waitForFunction(async lock => (await navigator.locks.query()).pending.some(entry => entry.name === lock), lock);
  if (!await frame.locator('#grade-import').evaluate(node => node.open)) await frame.locator('#grade-import > summary').click();
  const draft = '{"synthetic":"保存待ちに変更"}';
  await field(frame).fill(draft);
  await peerFrame.evaluate(() => window.releaseTestLock());
  await panel(frame).getByRole('alert').filter({ hasText: '復元の同意を取り消しました' }).first().waitFor();
  assert.equal(await field(frame).inputValue(), draft);
  assert.deepEqual((await readRaw(frame)).raw, current.raw);
  assert.deepEqual((await readRaw(frame)).writes, current.writes);
  await peerFrame.evaluate(key => localStorage.setItem(key, 'synthetic competing legacy write'), P);
  await frame.getByText('保存先または旧保存が変わりました。編集を停止しました。', { exact: true }).first().waitFor();
  assert.equal(await field(frame).isDisabled(), true);
  assert.equal(await field(frame).inputValue(), draft);
  assert.equal((await readRaw(frame)).raw[0], current.raw[0]);
  assert.deepEqual((await readRaw(frame)).writes, current.writes);
  log('v3 concurrent HOLD', { writeCount: 0, retainedDraft: true, childAUnchanged: true });
}

async function uploadGrade(frame, data) {
  const details = frame.locator('#grade-import');
  if (!await details.evaluate(node => node.open)) await frame.locator('#grade-import > summary').click();
  const payload = JSON.stringify(data);
  if (width < 600) {
    await field(frame).fill(payload);
    await frame.getByRole('button', { name: '読み込み・検証' }).click();
  } else await details.getByLabel('JSONファイル').setInputFiles({ name: 'synthetic.json',
    mimeType: 'application/json', buffer: Buffer.from(payload) });
}
