import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fixture as f } from './yi-readonly-search.fixtures.mjs';
const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
const evidence = resolve(process.env.YI_SIDECAR_EVIDENCE || '/tmp/yi-readonly-search-browser');
await mkdir(evidence, { recursive: true });
const server = await createServer({
  configFile: false, root: process.cwd(), plugins: [react(), {
    name: 'yi-sidecar-test-only-entry',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!['/__yi-sidecar', '/__yi-empty'].includes(req.url)) return next();
        try {
          const script = req.url === '/__yi-sidecar' ? '<script type="module" src="/tests/yi-readonly-search.entry.tsx"></script>' : '';
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml(req.url, `<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Work B isolated source test</title><style>body{font-family:sans-serif;margin:0}button,input,select{font:inherit}h1{font-size:1.5rem}[hidden]{display:none!important}</style></head><body><div id="root"></div>${script}</body></html>`));
        } catch (error) { next(error); }
      });
    },
  }], server: { host: '127.0.0.1', port: Number(process.env.YI_SIDECAR_PORT || 4209), strictPort: true },
});
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLANNER_BROWSER_EXECUTABLE || '/usr/bin/chromium' }).catch(async e => { await server.close(); throw e; });
const reports = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [], urls = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => urls.push(r.url()));
    await page.goto(base + '__yi-empty');
    // Synthetic pre-existing bytes, never represented as genuine learner records.
    await page.evaluate(async () => {
      localStorage.setItem('yi-test-schema22', '{"schemaVersion":22,"raw":"preserve UTF-8 原文"}');
      localStorage.setItem('yi-test-media', '{"video":3,"pending":"preserve"}');
      await new Promise((ok, no) => {
        const request = indexedDB.open('yi-test-f01-sentinel', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('sentinel');
        request.onerror = () => no(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('sentinel', 'readwrite');
          tx.objectStore('sentinel').put('fixed-authority-bytes', 'raw');
          tx.oncomplete = () => { db.close(); ok(); }; tx.onerror = () => no(tx.error);
        };
      });
    });
    await page.addInitScript(() => {
      const calls = [];
      window.__yiCalls = calls;
      const local = window.localStorage, get = Storage.prototype.getItem.bind(local);
      const open = indexedDB.open.bind(indexedDB);
      window.__yiRetention = async () => ({
        legacy: get('yi-test-schema22'), media: get('yi-test-media'),
        authority: await new Promise((ok, no) => {
          const req = open('yi-test-f01-sentinel', 1);
          req.onerror = () => no(req.error);
          req.onsuccess = () => {
            const db = req.result, tx = db.transaction('sentinel', 'readonly');
            const read = tx.objectStore('sentinel').get('raw');
            read.onsuccess = () => ok(read.result); read.onerror = () => no(read.error);
            tx.oncomplete = () => db.close();
          };
        }),
      });
      const blocked = name => () => { calls.push(name); throw new Error('forbidden sidecar API: ' + name); };
      for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { configurable: true, get: blocked(name) });
      for (const name of ['getItem', 'setItem', 'removeItem', 'clear']) Storage.prototype[name] = blocked('Storage.' + name);
      indexedDB.open = blocked('indexedDB.open'); indexedDB.deleteDatabase = blocked('indexedDB.deleteDatabase');
      window.confirm = blocked('confirm'); crypto.randomUUID = blocked('crypto.randomUUID');
      if (navigator.locks) navigator.locks.request = blocked('locks.request');
    });
    await page.goto(base + '__yi-sidecar');
    await page.getByRole('heading', { name: '年度に依存しない制度科目検索・入力プレビュー', exact: true }).waitFor();
    const query = page.getByRole('textbox', { name: '正式科目名', exact: true });
    const partial = page.getByRole('radio', { name: '部分一致', exact: true });
    const exact = page.getByRole('radio', { name: '完全一致', exact: true });
    const scope = page.getByRole('combobox', { name: '学科・コース・共通科目', exact: true });
    const common = page.getByRole('checkbox', { name: '選択した学科に共通科目を含める', exact: true });
    const items = page.getByRole('list', { name: '制度科目の検索結果' }).locator(':scope > li');
    assert.equal(await page.getByRole('status').textContent(), '検索結果 502件 / 表示 30件');
    assert.equal(await items.count(), 30);
    await page.getByRole('button', { name: /さらに30件表示/ }).click(); assert.equal(await items.count(), 60);
    await query.fill(f.safeTitle); await exact.check();
    assert.equal(await items.count(), 1);
    assert.ok((await items.first().textContent()).includes('4単位'));
    await items.first().getByText('公式根拠・未確定事項を確認', { exact: true }).click();
    assert.ok((await items.first().innerText()).includes('SHA-256: ' + f.sourceDigest));
    assert.ok((await items.first().innerText()).includes('公式科目コード証拠'));
    await items.first().getByRole('button', { name: 'この配置を選ぶ', exact: true }).click();
    const year = page.getByRole('textbox', { name: '予定年度（空欄は未設定）', exact: true });
    const method = page.getByRole('combobox', { name: '希望する履修方法', exact: true });
    const before = await items.allTextContents();
    for (const raw of ['2027', '2028', '']) {
      await year.fill(raw);
      assert.ok((await page.getByTestId('draft-preview').textContent()).includes('plannedYear=' + (raw || 'null')));
      assert.deepEqual(await items.allTextContents(), before);
      assert.equal(await query.inputValue(), f.safeTitle);
    }
    await year.fill('2028'); await method.selectOption('media');
    await page.getByRole('tab', { name: '確認事項', exact: true }).click();
    assert.ok((await page.getByRole('tabpanel').innerText()).includes('未接続・未受入'));
    const sibling = await context.newPage(); await sibling.goto(base + '__yi-empty'); await sibling.bringToFront();
    await new Promise(r => setTimeout(r, 350));
    await page.bringToFront(); await page.getByRole('tab', { name: '検索と未保存入力', exact: true }).click();
    assert.equal(await year.inputValue(), '2028'); assert.equal(await method.inputValue(), 'media');
    await sibling.close();
    await page.getByRole('tab', { name: '検索と未保存入力', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: '確認事項', exact: true }).getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await page.getByRole('tab', { name: '検索と未保存入力', exact: true }).evaluate(el => el === document.activeElement), true);
    assert.equal(await year.inputValue(), '2028');
    await page.getByRole('region', { name: '未保存の履修回入力' }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${evidence}/draft-${width}.png`, fullPage: true });
    await year.fill('20x8'); assert.equal(await year.getAttribute('aria-invalid'), 'true');
    await page.getByRole('tab', { name: '確認事項', exact: true }).click();
    await page.getByRole('tab', { name: '検索と未保存入力', exact: true }).click();
    assert.equal(await year.inputValue(), '20x8');
    await query.fill(f.holdTitle);
    assert.equal(await items.count(), 2);
    for (const label of f.holdScopes) assert.ok((await items.allTextContents()).some(t => t.includes(label)));
    await items.first().getByRole('button', { name: 'この配置を選ぶ', exact: true }).click();
    assert.ok((await page.getByRole('alert').allTextContents()).some(t => t.includes('HOLD:')));
    assert.equal(await year.inputValue(), '20x8'); assert.equal(await method.inputValue(), 'media');
    await page.screenshot({ path: `${evidence}/hold-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '選択を取り消して入力を消去', exact: true }).click();
    assert.equal(await page.getByRole('region', { name: '未保存の履修回入力' }).count(), 0);
    assert.equal(await page.getByRole('alert').count(), 0);
    await query.fill(f.safeTitle); await items.first().getByRole('button', { name: 'この配置を選ぶ', exact: true }).click();
    assert.equal(await year.inputValue(), ''); assert.equal(await method.inputValue(), 'unknown');
    await scope.selectOption(f.lawScope); await common.uncheck(); await query.fill(''); await partial.check();
    assert.equal(await common.isChecked(), false);
    const departmentCount = await page.getByRole('status').textContent();
    await common.check(); assert.notEqual(await page.getByRole('status').textContent(), departmentCount);
    await scope.selectOption(f.commonScope); await common.uncheck();
    assert.equal(await scope.inputValue(), f.commonScope); assert.ok(await items.count() > 0);
    await scope.selectOption(''); await query.fill('簿記 Ⅰ');
    assert.ok(await items.count() >= 2); await exact.check(); assert.equal(await items.count(), 0);
    await query.fill(f.absentTitle); assert.equal(await items.count(), 0);
    await query.fill('　 '); assert.equal(await page.getByRole('status').textContent(), '検索結果 502件 / 表示 30件');
    await query.fill(f.differentCreditsTitle);
    assert.equal(await items.count(), 8);
    const creditText = (await items.allTextContents()).join('\n');
    for (const c of f.differentCredits) assert.ok(creditText.includes(`${c}単位`));
    await query.fill('放送大学単位認定科目');
    assert.equal(await items.count(), 1); assert.equal(await items.getByRole('button', { name: 'この配置を選ぶ', exact: true }).count(), 0);
    await items.first().getByText('公式根拠・未確定事項を確認', { exact: true }).click();
    assert.ok((await items.first().innerText()).includes('非科目枠'));
    await query.fill('財務会計論Ⅰ');
    const evidenceCard = items.first(); await evidenceCard.getByText('公式根拠・未確定事項を確認', { exact: true }).click();
    assert.ok((await evidenceCard.innerText()).includes('p57-m'));
    await evidenceCard.getByText('原行・方式矛盾・旧値の監査記録', { exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${evidence}/evidence-${width}.png`, fullPage: true });
    const calls = await page.evaluate(() => window.__yiCalls);
    assert.deepEqual(calls, []); assert.deepEqual(errors, []);
    assert.ok(urls.every(url => !/planner_catalog_|\/attempts\/|\/backup\/|PlannerPage/.test(url)));
    const retained = await page.evaluate(() => window.__yiRetention());
    assert.deepEqual(retained, { legacy: '{"schemaVersion":22,"raw":"preserve UTF-8 原文"}', media: '{"video":3,"pending":"preserve"}', authority: 'fixed-authority-bytes' });
    await page.reload(); await query.waitFor();
    assert.equal(await page.getByRole('region', { name: '未保存の履修回入力' }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__yiCalls), []);
    reports.push({ width, browser: browser.version(), node: process.version, calls, retained, errors, requests: [...new Set(urls)], checks: 'real React StrictMode; 502/30/60; 2027/2028/null invariance; held identity; distinct placement/composition; scope/common; exact/AND/blank/zero; notes/code/source digest; tab/background wait; invalid input; explicit clear; reload clears local preview; overflow' });
    console.log(`PASS ${width}px: real sidecar and source, positive/negative controls, prohibited API calls=0`);
    await context.close();
  }
} finally {
  await writeFile(`${evidence}/browser-report.json`, JSON.stringify(reports, null, 2));
  await browser.close(); await server.close();
}
