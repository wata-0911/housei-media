import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The harness lives on a diagnostic branch. Every product import below comes
// from the fixed, separately verified PR #241 checkout.
const product = resolve(process.env.PRODUCT_ROOT || '');
const out = resolve(process.env.GEO_UI_ARTIFACT_DIR || 'geo-ui-evidence');
const fixtureDir = new URL('./fixtures/', import.meta.url);
if (!process.env.PRODUCT_ROOT || !process.env.PLANNER_PLAYWRIGHT_MODULE) throw Error('Product and Playwright paths are required');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLANNER_PLAYWRIGHT_MODULE).href);
const { serveAc } = await import(pathToFileURL(join(product, 'tests/ac-static-server.mjs')).href);
const { catalog, initialState, officialRow } = await import(pathToFileURL(join(product, 'tests/fixtures/yi07-graduation.mjs')).href);

const geography = '4d450b06-fb99-4bf2-a769-fe5f68dd337a';
const r1Id = 'curriculum:6c7dc42c-bd35-47df-9bc2-4b6f6da77e95';
const r1Name = '人文地理学特講（地域・産業・生活）';
const destinations = ['地理特講（地誌学特講）', '地理特講（人文地理学演習）', '地理特講（自然地理学演習）', '地域特講（現地研究）'];
const widths = [1280, 390];
const fixture = async name => readFile(new URL(name, fixtureDir));
const phase = (name, data = {}) => console.log(JSON.stringify({ phase: name, at: new Date().toISOString(), ...data }));

async function environment(width, entry) {
  const server = await serveAc(join(product, entry === 'planner' ? 'dist' : '..', entry === 'planner' ? '' : 'dist-ac'), entry === 'planner' ? 'index.html' : 'dev/ac/index.html');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLANNER_BROWSER_EXECUTABLE });
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const errors = [], consoleErrors = [], network = [];
  await context.route('**/*', route => new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', request => network.push({ type: 'failed', url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) network.push({ type: 'http', url: response.url(), status: response.status() }); });
  await page.goto(`${server.origin}/${entry === 'planner' ? 'planner' : '__dev/ac'}`);
  if (entry === 'ac') await page.getByTestId('save-status').filter({ hasText: /新規計画を開始できます|再読込・照合/ }).waitFor();
  const label = `${entry}-${width}`;
  return { page, errors, consoleErrors, network, async close(failed = false) {
    await page.screenshot({ path: join(out, `${label}-${failed ? 'failure' : 'final'}.png`), fullPage: true }).catch(() => {});
    await writeFile(join(out, `${label}-browser.json`), JSON.stringify({ errors, consoleErrors, network, viewport: width, userAgent: await page.evaluate(() => navigator.userAgent).catch(() => null) }, null, 2));
    await context.close(); await browser.close(); await server.close();
  } };
}

async function authority(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('hosei-yi06-isolated-v1', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('authority', 'readonly'), request = tx.objectStore('authority').get('current');
      let value; request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  });
}

async function confirm(page) {
  await page.getByRole('group', { name: '保存確認', exact: true }).waitFor();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '変更前の原文を保護', exact: true }).click();
  await download;
  await page.getByLabel('保護ファイルと保存内容を確認しました').check();
  await page.getByRole('button', { name: '確認して保存', exact: true }).click();
  await page.getByTestId('save-status').filter({ hasText: '保存済み' }).waitFor();
}
async function save(page) {
  await page.getByRole('button', { name: /^(新規計画の保存を準備|保存内容を準備)$/ }).click();
  await confirm(page);
}
async function reload(page) {
  await page.reload();
  await page.getByTestId('save-status').filter({ hasText: '再読込・照合' }).waitFor();
}
async function calculate(page) {
  await page.getByLabel('計算に仮定する教育課程').selectOption(geography);
  await page.getByRole('button', { name: '保存済み記録で条件付き計算' }).click();
  await page.getByTestId('recorded-calculation').waitFor();
}
async function cardValue(page, id) {
  const row = page.getByTestId('recorded-calculation').locator(`[data-requirement-id="${id}"]`);
  await row.waitFor();
  return { earned: await row.locator('td').nth(1).getAttribute('data-value'), text: await row.textContent() };
}
async function add(page, name, amount, method = 'schooling') {
  await page.locator('#course-query').fill(name);
  await page.getByRole('radio', { name: '完全一致' }).check();
  await page.getByLabel('学科・コース・共通科目', { exact: true }).selectOption(geography);
  const row = page.getByRole('list', { name: '制度科目の検索結果' }).getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
  assert.equal(await row.count(), 1, `${name}: unique geography placement`);
  await row.getByRole('button', { name: 'この配置を選ぶ' }).click();
  const form = page.getByRole('form', { name: '履修記録の入力' });
  await form.getByLabel('履修方法', { exact: true }).selectOption(method);
  await form.getByLabel('進捗', { exact: true }).selectOption('earned');
  await form.getByRole('button', { name: '下書きへ追加' }).click();
  await form.waitFor({ state: 'detached' });
  const card = page.locator('[data-attempt-id]').filter({ has: page.getByRole('heading', { name, exact: true }) }).last();
  const id = await card.getAttribute('data-attempt-id');
  await contribution(page, id, amount);
  return id;
}
async function contribution(page, id, amount) {
  const card = page.locator(`[data-attempt-id="${id}"]`);
  const form = card.getByRole('form', { name: /本人記録単位/ });
  await form.getByLabel('単位数（空欄は不明）').fill(amount === null ? '' : String(amount));
  await form.getByRole('button', { name: '単位数を下書きに反映' }).click();
  await page.getByTestId('save-status').filter({ hasText: /未保存/ }).waitFor();
}
function attempt(state, id) { const found = state.graph.attempts.find(a => a.id === id); assert.ok(found, id); return found; }
function assertBrowserClean(h) {
  assert.deepEqual(h.errors, [], 'pageerror');
  assert.deepEqual(h.consoleErrors, [], 'console errors');
  assert.deepEqual(h.network.filter(e => !e.url.endsWith('/favicon.ico')), [], 'failed/error network');
}
async function assertViewport(page, width) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px overflow`);
}

for (const width of widths) test(`A: old Planner K5 S0/S2/S6 backup restore and reload at ${width}px`, { timeout: 600000 }, async () => {
  const h = await environment(width, 'planner'), { page } = h; let failed = true;
  try {
    for (const [name, expected] of [['zero', 0], ['S2', 2], ['S6', 6]]) {
      const file = await fixture(`K5-${name}-backup.json`), backup = JSON.parse(file);
      await page.getByLabel('復元するJSONファイル').setInputFiles({ name: `K5-${name}-backup.json`, mimeType: 'application/json', buffer: file });
      await page.getByRole('heading', { name: '復元対象の概要' }).waitFor();
      await page.getByLabel('他のタブ・画面を閉じ、現在の全データが置き換わることを確認しました').check();
      await page.getByRole('button', { name: '確認したバックアップで全件置換する' }).click();
      await page.getByText('全データを置き換えて保存しました。再読み込み後も保持されます。').waitFor();
      await page.reload();
      const cards = page.locator('section[aria-labelledby="graduation-progress-heading"] article');
      for (const label of ['専門教育：スクーリング必修', '専門教育：合計']) {
        const card = cards.filter({ has: page.getByRole('heading', { name: label, exact: true }) });
        assert.equal(await card.count(), 1, label);
        assert.match(await card.textContent(), new RegExp(`${expected}\\s*/\\s*${label.includes('合計') ? 82 : 6}単位`));
        if (expected < 6 && label.includes('スクーリング')) {
          assert.match(await card.textContent(), /判定保留/);
          assert.doesNotMatch(await card.textContent(), /達成/);
        }
      }
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hosei-planner:v1')));
      assert.deepEqual(saved.items, backup.state.items, `${name}: raw attempt IDs, status and explicit 0`);
      phase(`A-${name}-reloaded`, { width, schooling: expected });
      await page.screenshot({ path: join(out, `A-${name}-${width}.png`), fullPage: true });
    }
    await assertViewport(page, width); assertBrowserClean(h); failed = false;
  } finally { await h.close(failed); }
});

for (const width of widths) test(`B: native24 K4 transfer hold, edit, delete and Undo at ${width}px`, { timeout: 600000 }, async () => {
  const h = await environment(width, 'ac'), { page } = h; let failed = true;
  try {
    await save(page); await reload(page);
    const ids = [];
    for (const [i, name] of destinations.entries()) ids.push(await add(page, name, [2, 2, 2, 1][i]));
    await save(page); await reload(page);
    let stored = JSON.parse((await authority(page)).raw);
    assert.equal(stored.schemaVersion, 24);
    assert.deepEqual(ids.map(id => attempt(stored, id).plan.contribution.value), [2, 2, 2, 1]);
    await calculate(page);
    for (const id of ids) {
      const row = page.locator(`[data-held-attempt-id="${id}"]`);
      await row.waitFor(); assert.ok((await row.textContent()).trim().length > 10);
    }
    for (const id of ['professional-geography-schooling-required', 'professional-geography-elective', 'professional-geography-total']) assert.equal((await cardValue(page, id)).earned, '0', id);
    phase('B-four-held', { width, ids });
    await page.screenshot({ path: join(out, `B-four-held-${width}.png`), fullPage: true });
    const id = ids[1];
    for (const value of [0, null, 2]) {
      await contribution(page, id, value); await save(page); await reload(page);
      stored = JSON.parse((await authority(page)).raw);
      assert.equal(attempt(stored, id).plan.contribution.value, value);
      assert.deepEqual(stored.graph.attempts.map(a => a.id), ids);
      await calculate(page);
      assert.equal((await cardValue(page, 'professional-geography-schooling-required')).earned, '0');
      phase('B-edit-reloaded', { width, value });
    }
    await page.locator(`[data-attempt-id="${id}"]`).getByRole('button', { name: '計画から削除' }).click();
    await save(page); await reload(page);
    assert.equal(attempt(JSON.parse((await authority(page)).raw), id).membership.kind, 'detached');
    await page.locator(`[data-attempt-id="${id}"]`).getByRole('button', { name: 'この履修回をUndo' }).click();
    await save(page); await reload(page); await calculate(page);
    stored = JSON.parse((await authority(page)).raw);
    assert.equal(attempt(stored, id).membership.kind, 'active');
    assert.equal(attempt(stored, id).plan.contribution.value, 2);
    assert.equal((await cardValue(page, 'professional-geography-total')).earned, '0');
    await page.screenshot({ path: join(out, `B-undo-${width}.png`), fullPage: true });
    await writeFile(join(out, `B-authority-${width}.json`), JSON.stringify({ ids, attempts: stored.graph.attempts, source: stored.source, calculation: await page.getByTestId('recorded-calculation').textContent() }, null, 2));
    await assertViewport(page, width); assertBrowserClean(h); failed = false;
    phase('B-undo-reloaded', { width, id });
  } finally { await h.close(failed); }
});

for (const width of widths) test(`C/D: official22 to formal23 R1 exact raw and 4/4 at ${width}px`, { timeout: 600000 }, async () => {
  const h = await environment(width, 'ac'), { page } = h; let failed = true;
  try {
    const course = catalog.curriculum.courses.find(c => c.id === r1Id); assert.ok(course);
    const legacy = initialState();
    legacy.selectedScopeId = geography;
    Object.assign(legacy.graduationProfile, { admissionYear: 2026, admissionType: 'first_year', curriculumApplicability: 'current_2026' });
    legacy.importedCourseAchievements = [officialRow(course, 4)];
    const raw = ` \n${JSON.stringify(legacy, null, 2)}\r\n`;
    await page.getByLabel('旧schema22原文から明示移行').setInputFiles({ name: 'synthetic-r1-official22.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
    await confirm(page); await reload(page);
    const stored = JSON.parse((await authority(page)).raw);
    assert.equal(stored.schemaVersion, 23);
    assert.equal(stored.source.raw, raw, 'source.raw bytes');
    assert.deepEqual(stored.retained.importedCourseAchievements, legacy.importedCourseAchievements);
    await calculate(page);
    assert.equal((await cardValue(page, 'professional-geography-required-elective')).earned, '4');
    assert.equal((await cardValue(page, 'professional-geography-total')).earned, '4');
    await page.screenshot({ path: join(out, `C-D-official-r1-${width}.png`), fullPage: true });
    await writeFile(join(out, `C-D-official-r1-${width}.json`), JSON.stringify({ sourceRaw: stored.source.raw, official: stored.retained.importedCourseAchievements, calculation: await page.getByTestId('recorded-calculation').textContent() }, null, 2));
    await assertViewport(page, width); assertBrowserClean(h); failed = false;
    phase('C-D-official-r1-preserved', { width, sourceBytes: Buffer.byteLength(raw) });
  } finally { await h.close(failed); }
});

for (const width of widths) for (const [name, expected] of [['zero', [0, 0, 0, 0]], ['S2', [1, 1, 0, 0]]]) test(`C: K5 ${name} schema22 to formal23 retains source and zero at ${width}px`, { timeout: 600000 }, async () => {
  const h = await environment(width, 'ac'), { page } = h; let failed = true;
  try {
    const bytes = await fixture(`K5-${name}-schema22.json`), raw = bytes.toString('utf8');
    const source = JSON.parse(raw);
    assert.deepEqual(source.items.map(item => item.courseCreditContribution), expected);
    await page.getByLabel('旧schema22原文から明示移行').setInputFiles({ name: `K5-${name}-schema22.json`, mimeType: 'application/json', buffer: bytes });
    await confirm(page); await reload(page);
    let saved = JSON.parse((await authority(page)).raw);
    assert.equal(saved.schemaVersion, 23);
    assert.equal(saved.source.raw, raw);
    assert.deepEqual(saved.graph.attempts.map(a => a.plan.contribution.value), expected);
    const originalIds = saved.graph.attempts.map(a => a.id);
    await calculate(page);
    assert.notEqual((await cardValue(page, 'professional-geography-schooling-required')).earned, '6', 'formal23 has no synthetic S6 unlock');
    await page.screenshot({ path: join(out, `C-${name}-migration-${width}.png`), fullPage: true });
    const first = originalIds[0];
    await contribution(page, first, 0); await save(page); await reload(page);
    saved = JSON.parse((await authority(page)).raw);
    assert.equal(saved.source.raw, raw);
    assert.deepEqual(saved.graph.attempts.map(a => a.id), originalIds);
    assert.equal(attempt(saved, first).plan.contribution.value, 0);
    await page.locator(`[data-attempt-id="${first}"]`).getByRole('button', { name: '計画から削除' }).click();
    await save(page); await reload(page);
    await page.locator(`[data-attempt-id="${first}"]`).getByRole('button', { name: 'この履修回をUndo' }).click();
    await save(page); await reload(page);
    saved = JSON.parse((await authority(page)).raw);
    assert.equal(saved.source.raw, raw);
    assert.deepEqual(saved.graph.attempts.map(a => a.id), originalIds);
    assert.equal(attempt(saved, first).membership.kind, 'active');
    await writeFile(join(out, `C-${name}-${width}.json`), JSON.stringify({ sourceRaw: saved.source.raw, attempts: saved.graph.attempts, calculationBeforeEdit: 'see C migration screenshot and test.log' }, null, 2));
    await assertViewport(page, width); assertBrowserClean(h); failed = false;
    phase(`C-${name}-edited-undone`, { width, sourceBytes: bytes.length, originalIds });
  } finally { await h.close(failed); }
});

for (const width of widths) test(`D: native24 R1 T4 edit 0/null/4 and Undo at ${width}px`, { timeout: 600000 }, async () => {
  const h = await environment(width, 'ac'), { page } = h; let failed = true;
  try {
    await save(page); await reload(page);
    const id = await add(page, r1Name, 4, 'correspondence');
    await save(page); await reload(page); await calculate(page);
    for (const requirement of ['professional-geography-required-elective', 'professional-geography-total']) assert.equal((await cardValue(page, requirement)).earned, '4');
    assert.equal(attempt(JSON.parse((await authority(page)).raw), id).identity.ref.institutionalCourseId, r1Id);
    phase('D-r1-four', { width, id });
    await page.screenshot({ path: join(out, `D-r1-four-${width}.png`), fullPage: true });
    for (const value of [0, null, 4]) {
      await contribution(page, id, value); await save(page); await reload(page); await calculate(page);
      const stored = JSON.parse((await authority(page)).raw);
      assert.equal(attempt(stored, id).plan.contribution.value, value);
      assert.equal((await cardValue(page, 'professional-geography-required-elective')).earned, value === 4 ? '4' : '0');
      phase('D-r1-edit', { width, value });
    }
    await page.locator(`[data-attempt-id="${id}"]`).getByRole('button', { name: '計画から削除' }).click();
    await save(page); await reload(page); await calculate(page);
    assert.equal((await cardValue(page, 'professional-geography-required-elective')).earned, '0');
    await page.locator(`[data-attempt-id="${id}"]`).getByRole('button', { name: 'この履修回をUndo' }).click();
    await save(page); await reload(page); await calculate(page);
    assert.equal((await cardValue(page, 'professional-geography-required-elective')).earned, '4');
    assert.equal(attempt(JSON.parse((await authority(page)).raw), id).id, id);
    await writeFile(join(out, `D-native-r1-${width}.json`), JSON.stringify({ authority: await authority(page), calculation: await page.getByTestId('recorded-calculation').textContent() }, null, 2));
    await assertViewport(page, width); assertBrowserClean(h); failed = false;
    phase('D-r1-undo', { width, id });
  } finally { await h.close(failed); }
});
