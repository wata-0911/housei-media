import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { serveAc } from './ac-static-server.mjs';

const { chromium } = process.env.PLANNER_PLAYWRIGHT_MODULE
  ? await import(process.env.PLANNER_PLAYWRIGHT_MODULE) : createRequire(import.meta.url)('playwright');
const lock = 'hosei-planner:v1:write';
const authorityDatabase = 'hosei-yi06-isolated-v1';
const status = page => page.getByTestId('save-status');
const savedDisplay = page => page.getByTestId('saved-display-state');
const pinned = page => savedDisplay(page).filter({ hasText: '読取時点の検証済み' }).waitFor();

async function readAuthority(page) {
  return page.evaluate(database => new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('authority', 'readonly');
      const record = tx.objectStore('authority').get('current');
      tx.oncomplete = () => { db.close(); resolve(record.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), authorityDatabase);
}

async function getConfirmation(page, init = false) {
  await page.getByRole('button', { name: init ? '新規計画の保存を準備' : '保存内容を準備', exact: true }).click();
  const proposal = page.getByRole('group', { name: '保存確認' });
  const downloaded = page.waitForEvent('download');
  await proposal.getByRole('button', { name: '変更前の原文を保護' }).click();
  await downloaded;
  await proposal.getByLabel('保護ファイルと保存内容を確認しました').check();
  return proposal.getByRole('button', { name: '確認して保存' });
}

async function stage(page, year) {
  await page.locator('#course-query').fill('ビジネス英語A');
  await page.getByRole('list', { name: '制度科目の検索結果' })
    .getByRole('button', { name: 'この配置を選ぶ' }).first().click();
  const form = page.getByRole('form', { name: '履修記録の入力' });
  await form.getByLabel('予定年度（空欄は未設定）').fill(year);
  await form.getByLabel('履修方法', { exact: true }).selectOption('media');
  await form.getByRole('button', { name: '下書きへ追加' }).click();
  await form.waitFor({ state: 'detached' });
}

test('B-INT07 native Web Lock wait leaves zero authority puts when the confirmed save is revoked', { timeout: 90000 }, async () => {
  const outDir = process.env.B_INT07_DIST;
  assert.ok(outDir, 'the isolated AC verification build is required');
  const server = await serveAc(outDir);
  const denied = [], errors = [];
  let browser, context;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLANNER_BROWSER_EXECUTABLE || '/usr/bin/chromium', headless: true,
      args: ['--disable-background-networking', '--disable-quic',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1'] });
    context = await browser.newContext({ viewport: { width: 390, height: 900 }, acceptDownloads: true,
      serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if (origin === server.origin) return route.continue();
      denied.push(origin);
      return route.abort('blockedbyclient');
    });
    await context.addInitScript(database => {
      window.bInt07Puts = 0;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.transaction.db.name === database && this.name === 'authority') window.bInt07Puts++;
        return put.apply(this, args);
      };
    }, authorityDatabase);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(server.origin + '/__dev/ac');
    await status(page).filter({ hasText: '新規計画を開始できます' }).waitFor();
    await (await getConfirmation(page, true)).click();
    await pinned(page);
    const before = await readAuthority(page);
    assert.equal(await page.evaluate(() => window.bInt07Puts), 1);
    await stage(page, '2039');
    const confirmation = await getConfirmation(page);
    await page.evaluate(name => new Promise(resolve => {
      void navigator.locks.request(name, () => new Promise(release => {
        window.bInt07Release = release;
        resolve();
      }));
    }), lock);
    try {
      await confirmation.click();
      await page.waitForFunction(async name => (await navigator.locks.query()).pending.some(row => row.name === name), lock);
      await page.evaluate(() => {
        const signal = new BroadcastChannel('hosei-attempt-authority-invalidation');
        signal.postMessage('recheck');
        signal.close();
      });
      await savedDisplay(page).filter({ hasText: '別画面で変更された可能性' }).waitFor();
    } finally {
      await page.evaluate(() => window.bInt07Release());
    }
    await status(page).filter({ hasText: '書込み前に保存資格が失効' }).waitFor();
    assert.equal(await page.evaluate(() => window.bInt07Puts), 1);
    assert.deepEqual(await readAuthority(page), before);
    const draft = page.locator('[data-attempt-id]');
    assert.equal(await draft.count(), 1);
    assert.match(await draft.textContent(), /2039/);
    assert.equal(await draft.getByRole('button', { name: '履修記録を編集' }).isDisabled(), true);
    await page.getByRole('button', { name: '保存内容を再読込' }).click();
    await pinned(page);
    assert.equal(await draft.count(), 0);
    await stage(page, '2040');
    await (await getConfirmation(page)).click();
    await pinned(page);
    const after = await readAuthority(page);
    assert.deepEqual(JSON.parse(after.raw).graph.attempts.map(row => row.plan.plannedYear), [2040]);
    assert.equal(await page.evaluate(() => window.bInt07Puts), 2);
    assert.deepEqual(errors, []);
    assert.deepEqual(denied, []);
    console.log(JSON.stringify({ chromium: browser.version(), viewport: 390, revokedPuts: 0,
      unrevokedPuts: 1, sameAuthorityBeforeAndAfterRevocation: true, draftRetainedUntilReload: true }));
  } finally {
    await context?.close();
    await browser?.close();
    await server.close();
  }
});
