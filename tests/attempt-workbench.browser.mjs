import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../', import.meta.url).pathname;
const port = Number(process.env.YI05_BROWSER_PORT || 4185), origin = `http://127.0.0.1:${port}`;
let browser; const servers = [], cacheDirs = [];
async function server(p, enabled, mode = 'development') {
  const cacheDir = await mkdtemp(join(tmpdir(), 'yi05-vite-')); cacheDirs.push(cacheDir);
  const source = `import { createServer } from 'vite'; const server = await createServer(${JSON.stringify({ mode, cacheDir, server: { host: '127.0.0.1', port: p, strictPort: true } })}); await server.listen();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source],
    { cwd: root, env: { ...process.env, YI05_WORKBENCH: enabled ? '1' : '', NODE_ENV: mode === 'production' ? 'production' : 'development' }, stdio: 'pipe' });
  servers.push(child); let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(`http://127.0.0.1:${p}`, { headers: { Connection: 'close' } })).ok) return; } catch (error) { if (i === 99) output += String(error) + String(error.cause); }
    await delay(200);
  }
  throw new Error(`server startup timeout: ${output}`);
}
before(async () => {
  await server(port, true); await server(port + 1, false); await server(port + 2, true, 'production');
  const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true, ...(process.env.PLANNER_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANNER_BROWSER_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); servers.forEach(s => s.kill('SIGTERM')); await Promise.all(cacheDirs.map(p => rm(p, { recursive: true, force: true }))); });
async function open(t, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    set.call(localStorage, 'hosei-planner:v1', 'primary-original-bytes'); set.call(localStorage, 'hosei-planner:v1:recovery', 'recovery-original-bytes');
    window.storageCalls = [];
    Storage.prototype.getItem = function(k) { window.storageCalls.push(['read', k]); throw new Error('storage read forbidden'); };
    Storage.prototype.setItem = function(k) { window.storageCalls.push(['write', k]); throw new Error('storage write forbidden'); };
    Storage.prototype.removeItem = function(k) { window.storageCalls.push(['remove', k]); throw new Error('storage remove forbidden'); };
    Storage.prototype.clear = function() { window.storageCalls.push(['clear']); throw new Error('storage clear forbidden'); };
    window.originalBytes = () => [get.call(localStorage, 'hosei-planner:v1'), get.call(localStorage, 'hosei-planner:v1:recovery')];
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${origin}/__dev/attempts`, { timeout: 60000 }); await page.getByRole('heading', { name: '独立Attempt ワークベンチ' }).waitFor();
  t.after(async () => { try { assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.storageCalls), []); assert.deepEqual(await page.evaluate(() => window.originalBytes()), ['primary-original-bytes', 'recovery-original-bytes']); } finally { await context.close(); } });
  return page;
}
async function add(page, name = '将来年度の未確定科目', contribution = 'unset') {
  await page.getByRole('button', { name: '新しい履修回', exact: true }).click();
  const form = page.getByRole('form', { name: '新規履修回' });
  await form.getByLabel('未確定科目の名称').fill(name); await form.getByLabel('予定年度', { exact: true }).fill('2035');
  await form.getByLabel('履修方法（本人希望）').selectOption('media'); await form.getByLabel('本人寄与単位の入力状態').selectOption(contribution);
  if (contribution === 'number') await form.getByLabel('本人入力の寄与単位', { exact: true }).fill('0');
  await form.getByRole('button', { name: '新規Attemptを追加' }).click(); await form.waitFor({ state: 'detached' });
  return page.locator('[data-attempt-id]').last();
}
async function initProgress(card, button) { await card.locator('details').last().locator('summary').click(); await card.getByRole('button', { name: button }).click(); }

test('flag: default disabled, query cannot enable, direct module blocked, production serve rejects even flag=1', async () => {
  for (const p of [port + 1, port + 2]) for (const path of ['/__dev/attempts', '/__dev/attempts?YI05_WORKBENCH=1', '/dev/attempts/main.tsx', '/src/planner/attempts/workbench/operations.ts']) {
    assert.equal((await fetch(`http://127.0.0.1:${p}${path}`, { headers: { Connection: 'close' } })).status, 404);
  }
  const page = await browser.newPage();
  try { await page.goto(`http://127.0.0.1:${port + 1}/planner?YI05_WORKBENCH=1`); await page.getByRole('heading', { name: '全データのJSONバックアップ・復元', exact: true }).waitFor({ timeout: 60000 }); assert.equal(await page.getByText('独立Attempt ワークベンチ').count(), 0); }
  finally { await page.close(); }
});
test('React: future Offering-free unknown attempts, same-name separate rows, null/0/unset, sort and keyboard edit', async t => {
  const page = await open(t); await add(page); await add(page, '将来年度の未確定科目', 'null'); await add(page, '将来年度の未確定科目', 'number');
  const cards = page.locator('[data-attempt-id]'); assert.equal(await cards.count(), 3);
  const ids = await cards.evaluateAll(nodes => nodes.map(n => n.dataset.attemptId)); assert.equal(new Set(ids).size, 3);
  assert.match(await cards.nth(0).innerText(), /本人寄与単位\n未設定/); assert.match(await cards.nth(1).innerText(), /不明 \(null\)/); assert.match(await cards.nth(2).innerText(), /0単位/);
  assert.match(await cards.nth(0).innerText(), /unknown/); assert.match(await cards.nth(0).innerText(), /2035/);
  await page.getByLabel('表示順（ID・計画順は維持）').selectOption('name'); assert.deepEqual(await cards.evaluateAll(nodes => nodes.map(n => n.dataset.attemptId)), ids);
  await cards.first().getByRole('button', { name: '予定を編集' }).focus(); await page.keyboard.press('Enter');
  const form = page.getByRole('form', { name: 'Attempt編集' }); await form.getByLabel('予定年度', { exact: true }).fill('2040');
  await form.getByRole('button', { name: '編集をメモリに反映' }).focus(); await page.keyboard.press('Enter'); await form.waitFor({ state: 'detached' });
  assert.equal(await cards.first().getAttribute('data-attempt-id'), ids[0]); assert.match(await cards.first().innerText(), /2040/); assert.match(await cards.nth(1).innerText(), /2035/);
  await page.reload(); await page.getByRole('heading', { name: '履修計画 / active 0件' }).waitFor(); assert.equal(await cards.count(), 0);
});
test('React: master search and explicit Placement selection creates independent course reference', async t => {
  const page = await open(t); await page.getByRole('button', { name: '新しい履修回', exact: true }).click();
  const form = page.getByRole('form', { name: '新規履修回' }); await form.getByLabel('制度科目を検索').fill('日本');
  const option = await form.getByLabel('制度科目', { exact: true }).locator('option').nth(1).getAttribute('value');
  await form.getByLabel('制度科目', { exact: true }).selectOption(option);
  const placement = await form.getByLabel('Placement候補').locator('option').nth(1).getAttribute('value'); await form.getByLabel('Placement候補').selectOption(placement);
  await form.getByRole('button', { name: '新規Attemptを追加' }).click(); await form.waitFor({ state: 'detached' });
  const card = page.locator('[data-attempt-id]'); assert.match(await card.innerText(), /制度identity: confirmed/); assert.match(await card.innerText(), /制度構成/); assert.match(await card.innerText(), /本人適用: unknown/);
});
test('React: media video/test/exam and correspondence/report/batch and independent evaluations', async t => {
  const page = await open(t), card = await add(page); await initProgress(card, 'メディア進捗を開始');
  let form = card.getByRole('form', { name: 'メディア進捗' });
  await form.getByLabel('総動画・テスト回数（空欄=null）').fill('12'); await form.getByRole('button', { name: '動画・テスト回を追加' }).click();
  await form.getByLabel('動画視聴 第1回').check(); await form.getByLabel('テスト 第1回').check(); await form.getByRole('button', { name: '試験を追加', exact: true }).click();
  await form.getByLabel('試験種別 1').selectOption('midterm'); await form.getByLabel('試験名 1').fill('中間 日本語の連続入力');
  await form.getByLabel('予定日 1（YYYY-MM-DD・空欄=null）').fill('2027-02-30');
  await form.getByRole('button', { name: 'メディア進捗をメモリに反映' }).click(); await page.getByRole('alert').filter({ hasText: 'assessment_date' }).waitFor();
  assert.equal(await form.getByLabel('試験名 1').inputValue(), '中間 日本語の連続入力');
  await form.getByLabel('予定日 1（YYYY-MM-DD・空欄=null）').fill('2028-02-29'); await form.getByLabel('試験完了 1').check(); await form.getByRole('button', { name: 'メディア進捗をメモリに反映' }).click();
  await card.getByTestId('progress-summary').filter({ hasText: '動画 1 / 12' }).waitFor();
  await card.getByRole('button', { name: '通信進捗を開始' }).click(); form = card.getByRole('form', { name: '通信進捗' });
  await form.getByLabel('必要リポート数（空欄=null）').fill('0'); await form.getByRole('button', { name: 'リポートを追加', exact: true }).click();
  await form.getByLabel('リポート状態 1').selectOption('passed'); await form.getByLabel('リポート評価 1', { exact: true }).selectOption('A');
  await form.getByLabel('単位修得試験の評価').selectOption('B'); await form.getByLabel('書道実技の一括進捗').selectOption('grading');
  await form.getByRole('button', { name: '通信進捗をメモリに反映' }).click(); await card.getByTestId('progress-summary').filter({ hasText: 'リポート合格 1 / 0' }).waitFor();
  await card.getByRole('button', { name: '科目評価を開始' }).click(); form = card.getByRole('form', { name: '科目評価' });
  await form.getByLabel('最終評価', { exact: true }).selectOption('A'); await form.getByLabel('リポート評価（科目）').selectOption('B'); await form.getByLabel('スクーリング評価').selectOption('S');
  await form.getByRole('button', { name: '科目評価をメモリに反映' }).click(); await card.getByTestId('progress-summary').filter({ hasText: '最終評価 A' }).waitFor();
  assert.match(await card.innerText(), /履修状態\nplanned/); assert.equal(await card.getByRole('form', { name: 'メディア進捗' }).getByLabel('試験名 1').inputValue(), '中間 日本語の連続入力');
});
test('React mobile: TODO owner/edit/complete/delete, detached protection, exact Undo and new enrollment', async t => {
  const page = await open(t, { width: 390, height: 844 }); const a = await add(page, '履修回A'); const aId = await a.getAttribute('data-attempt-id');
  await add(page, '履修回B'); const cardA = page.locator(`[data-attempt-id="${aId}"]`);
  let form = page.getByRole('form', { name: 'TODO追加' }); await form.getByLabel('新しいTODO').fill('添削を確認'); await form.getByLabel('追加先owner').selectOption(aId); await form.getByRole('button', { name: 'TODOを追加', exact: true }).click();
  let todo = page.getByRole('article', { name: 'TODO 添削を確認', exact: true }); await todo.getByLabel('TODO完了').check(); await todo.getByLabel('TODO本文').fill('添削確認済み'); await todo.getByRole('button', { name: 'TODOをメモリに反映' }).click();
  todo = page.getByRole('article', { name: 'TODO 添削確認済み', exact: true });
  await cardA.getByRole('button', { name: '計画から削除' }).click(); await page.getByRole('heading', { name: 'detached / 計画外のowner 1件' }).waitFor(); assert.match(await todo.innerText(), /detached/); assert.equal(await todo.getByLabel('TODO完了').isChecked(), true);
  await cardA.getByRole('button', { name: 'このAttemptをUndo' }).click(); assert.equal(await page.locator('[data-attempt-id]').first().getAttribute('data-attempt-id'), aId);
  await cardA.getByRole('button', { name: '別の新規履修回を追加' }).click(); form = page.getByRole('form', { name: '新規履修回' }); await form.getByLabel('未確定科目の名称').fill('履修回A'); await form.getByRole('button', { name: '新規Attemptを追加' }).click(); await form.waitFor({ state: 'detached' });
  const next = page.locator('[data-attempt-id]').last(); assert.notEqual(await next.getAttribute('data-attempt-id'), aId); assert.equal(await next.getByTestId('progress-summary').innerText(), '記録なし');
  await todo.getByLabel('TODOの新owner').selectOption('none'); await todo.getByRole('button', { name: 'owner変更を明示実行' }).click(); assert.match(await todo.innerText(), /ownerなし/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  if (process.env.YI05_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.YI05_SCREENSHOT_DIR}/mobile.png`, fullPage: true });
  await todo.getByRole('button', { name: 'このTODOを削除' }).click(); await todo.waitFor({ state: 'detached' });
});
for (const fixture of ['held-day', 'held-month']) test(`React: ${fixture} original/correction comparison, explicit confirmation, revalidation and fixed-table retry`, async t => {
  const page = await open(t); await page.getByLabel('移行fixture').selectOption(fixture); await page.getByRole('button', { name: 'decodeしてpreview' }).click(); await page.getByText('移行結果: held', { exact: true }).waitFor();
  assert.match(await page.innerText('main'), /fixture-assessment\/raw~id/); const raw = await page.getByTestId('source-raw-0').textContent();
  await page.getByLabel('日付の修正案').fill('2027-02-28'); await page.getByRole('button', { name: '修正案を比較', exact: true }).click();
  const apply = page.getByRole('button', { name: '確認した修正だけを新sourceに適用' }); await apply.waitFor(); assert.equal(await apply.isDisabled(), true); assert.equal(await page.getByTestId('source-raw-0').textContent(), raw);
  await page.getByLabel('原値と修正案、新規ID割当を確認しました').check(); await apply.click(); await page.getByText('移行結果: ready', { exact: true }).waitFor(); assert.equal(await page.getByTestId('source-raw-0').textContent(), raw);
  await page.getByLabel('現在の隔離編集を破棄し、readyを新しい作業の初期状態にします').check(); await page.getByRole('button', { name: 'readyから隔離作業を開始' }).click();
  const card = page.locator('[data-attempt-id]').first(), id = await card.getAttribute('data-attempt-id');
  await card.getByRole('button', { name: '予定を編集' }).click(); const form = page.getByRole('form', { name: 'Attempt編集' }); await form.getByLabel('予定年度', { exact: true }).fill('2090'); await form.getByRole('button', { name: '編集をメモリに反映' }).click(); await form.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '同じ割当で再preview' }).click(); await page.getByText(/固定割当を再利用: ready/).waitFor(); assert.equal(await card.getAttribute('data-attempt-id'), id); assert.match(await card.innerText(), /2090/);
  // Explicit legacy owner is retained as unresolved, never guessed to a new Attempt.
  const todoForm = page.getByRole('form', { name: 'TODO追加' }); await todoForm.getByLabel('新しいTODO').fill('旧owner記録');
  const legacy = await todoForm.getByLabel('追加先owner').locator('option').filter({ hasText: '未解決旧Offering' }).first().getAttribute('value'); await todoForm.getByLabel('追加先owner').selectOption(legacy); await todoForm.getByRole('button', { name: 'TODOを追加', exact: true }).click();
  assert.match(await page.getByRole('article', { name: 'TODO 旧owner記録', exact: true }).innerText(), /旧Offering未解決/);
  if (process.env.YI05_SCREENSHOT_DIR && fixture === 'held-day') await page.screenshot({ path: `${process.env.YI05_SCREENSHOT_DIR}/desktop.png`, fullPage: true });
});
test('React: rejected source cannot initialize an editable graph', async t => {
  const page = await open(t); await page.getByLabel('移行fixture').selectOption('rejected'); await page.getByRole('button', { name: 'decodeしてpreview' }).click(); await page.getByText('移行結果: rejected', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'readyから隔離作業を開始' }).count(), 0);
});
