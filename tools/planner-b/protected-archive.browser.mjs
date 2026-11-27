import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { startLocalGate } from './local-gate.mjs';
import { sha256 } from './materialize.mjs';

const { B78_DIST, B78_COLD_DIST, B78_EVIDENCE, PLANNER_PLAYWRIGHT_MODULE, PLANNER_BROWSER_EXECUTABLE } = process.env;
assert(B78_DIST && B78_COLD_DIST && B78_EVIDENCE && PLANNER_PLAYWRIGHT_MODULE);
const { chromium } = await import(PLANNER_PLAYWRIGHT_MODULE);
const fixture = await readFile(new URL('./fixtures/A-B77.json', import.meta.url));
assert.equal(sha256(fixture), 'c41d9bc022708cff2fb101fc6b3238ba531423ad493a1358b86af4045e624b07');
const envelope = JSON.parse(JSON.parse(fixture).envelope);
const originalTodo = JSON.parse(envelope.primaryRaw).todos[0];
const originalAssessment = envelope.tracks[0].progress.assessments[0];
const proxyOrigin = 'http://127.0.0.1:4177';
const upload = buffer => ({ name: 'synthetic-b78.json', mimeType: 'application/json', buffer });
const region = page => page.getByRole('region', { name: 'A 移行原本と計画未指定の本人記録' });
const confirmation = page => page.getByRole('group', { name: '保存確認', exact: true });
const status = page => page.getByTestId('save-status');
const readPut = page => page.evaluate(() => window.probe78.puts);
const todo = page => region(page).locator('[data-todo-id]');
const assessment = page => region(page).locator('form').filter({ has: page.getByRole('button', { name: '評価削除を確認' }) });
const field = (page, kind) => kind === 'todo' ? todo(page).getByLabel('TODO', { exact: true }) : assessment(page).getByLabel('評価名');
const done = (page, kind) => kind === 'todo' ? todo(page).getByLabel('完了', { exact: true }) : assessment(page).getByLabel('本人記録済み');
const submit = (page, kind) => kind === 'todo'
  ? todo(page).getByRole('button', { name: 'TODO の変更を確認' }) : assessment(page).getByRole('button', { name: '評価の変更を確認' });
const reset = (page, kind) => (kind === 'todo' ? todo(page) : assessment(page)).getByRole('button', { name: '入力を戻す' });

function readAuthority(page) {
  return page.evaluate(async () => {
    const name = 'hosei-yi06-isolated-v1';
    if (!(await indexedDB.databases()).some(database => database.name === name)) return null;
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => open.transaction.abort();
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, transaction = db.transaction('authority');
        const result = transaction.objectStore('authority').get('current');
        transaction.oncomplete = () => { db.close(); resolve(result.result ?? null); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    });
  });
}

async function download(page, button) {
  const pending = page.waitForEvent('download');
  await button.click();
  return readFile(await (await pending).path());
}

async function commit(page, action, restore = false) {
  const previous = await readAuthority(page);
  const puts = await readPut(page);
  await action();
  const group = confirmation(page);
  await group.waitFor();
  assert.deepEqual(await readAuthority(page), previous);
  const protection = group.getByRole('button', { name: '変更前の原文を保護', exact: true });
  if (await protection.count()) await download(page, protection);
  await group.getByLabel('保護ファイルと保存内容を確認しました').check();
  if (restore) await group.getByLabel('このバックアップを復元元として採用します').check();
  await group.getByRole('button', { name: '確認して保存', exact: true }).click();
  await status(page).filter({ hasText: '保存済み（正式保存が完了しました）' }).waitFor();
  const state = await readAuthority(page);
  assert.equal(await readPut(page), puts + 1);
  assert.equal(state.revision, (previous?.revision ?? 0) + 1);
  if (previous) {
    assert.deepEqual(state.issuedIds.slice(0, previous.issuedIds.length), previous.issuedIds);
    assert.deepEqual(state.committed.slice(0, previous.committed.length), previous.committed);
  }
  return state;
}

const last = state => JSON.parse(state.raw).events.at(-1);
function todoEvent(state, text, completed) {
  const command = last(state).command;
  assert.equal(command.kind, 'edit_payload');
  assert.deepEqual(command.payload, { id: originalTodo.id, text, done: completed });
  return command.recordId;
}
function evaluationEvent(state, label, completed) {
  const event = last(state);
  assert.equal(event.kind, 'independent-assessment');
  assert.equal(event.target, originalAssessment.id);
  assert.deepEqual(event.assessment, {
    type: originalAssessment.type, label, scheduledDate: originalAssessment.scheduledDate, completed,
  });
  return event.owner;
}
async function expectOriginal(page) {
  assert.deepEqual(await download(page, region(page).getByRole('button', { name: 'A の移行元ファイルをダウンロード' })), fixture);
}

function proxyStorage(page) {
  return page.evaluate(async () => ({
    count: window.probe78,
    keys: Object.keys(localStorage),
    databases: await indexedDB.databases(),
  }));
}

test('B78 real protected primary and cold routes preserve unedited archive text', { timeout: 600000 }, async t => {
  await mkdir(B78_EVIDENCE, { recursive: true });
  const password = randomBytes(32).toString('hex');
  const primary = await startLocalGate({ port: 4178, dist: B78_DIST, enabled: true, password, variant: 'b78-split' });
  t.after(primary.close);
  const cold = await startLocalGate({ port: 4179, dist: B78_COLD_DIST, enabled: true, password, variant: 'b78-cold' });
  t.after(cold.close);
  const proxy = createServer((_req, response) => response.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>A synthetic storage origin</title>'));
  await new Promise((resolve, reject) => proxy.once('error', reject).listen(4177, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const browser = await chromium.launch({ executablePath: PLANNER_BROWSER_EXECUTABLE, headless: true,
    args: ['--disable-background-networking', '--disable-quic'] });
  t.after(() => browser.close());
  for (const width of [390, 1280]) await t.test(String(width), async () => {
    const external = [], errors = [];
    const context = await browser.newContext({ viewport: { width, height: 920 }, acceptDownloads: true, serviceWorkers: 'block',
      httpCredentials: { username: 'b72', password } });
    try {
      await context.addInitScript(() => {
        window.probe78 = { puts: 0, opens: 0, storageWrites: 0 };
        const originalOpen = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (...args) {
          window.probe78.opens++;
          return originalOpen.apply(this, args);
        };
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          window.probe78.puts++;
          return originalPut.apply(this, args);
        };
        for (const method of ['setItem', 'removeItem', 'clear']) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (...args) {
            window.probe78.storageWrites++;
            return original.apply(this, args);
          };
        }
      });
      const a = await context.newPage();
      await a.goto(proxyOrigin + '/fixture');
      const aBefore = await proxyStorage(a);
      assert.deepEqual(aBefore, { count: { puts: 0, opens: 0, storageWrites: 0 }, keys: [], databases: [] });
      await context.route('**/*', route => {
        const origin = new URL(route.request().url()).origin;
        if (origin === primary.origin || origin === cold.origin) return route.continue();
        external.push(origin);
        return route.abort();
      });
      const newPage = async origin => {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/planner');
        return page;
      };
      const page = await newPage(primary.origin);
      await status(page).filter({ hasText: '新規計画を開始できます' }).waitFor();
      const starting = await commit(page, async () => {
        await page.getByLabel('A 可搬 v2〜v5 を空の B へ採用').setInputFiles(upload(fixture));
        await confirmation(page).getByLabel('同じ A 元ファイルを再選択').setInputFiles(upload(fixture));
        await confirmation(page).getByText('元ファイルの一致を確認しました。').waitFor();
      });
      assert.equal(starting.revision, 1);
      const baselineTodo = originalTodo.text.replace(/\r\n?/g, '\n');
      assert.equal(await field(page, 'todo').inputValue(), baselineTodo);
      assert.equal(await field(page, 'evaluation').inputValue(), originalAssessment.label);
      const todoId = todoEvent(await commit(page, async () => {
        await done(page, 'todo').check(); await submit(page, 'todo').click();
      }), originalTodo.text, true);
      const completed = await commit(page, async () => {
        await done(page, 'evaluation').check(); await submit(page, 'evaluation').click();
      });
      const owner = evaluationEvent(completed, originalAssessment.label, true);
      assert.equal(completed.revision, 3);
      await expectOriginal(page);
      const portable = await download(page, page.getByRole('button', { name: '可搬バックアップをダウンロード' }));
      const csv = await download(page, page.getByRole('button', { name: '保存済み履修計画をCSV出力' }));
      assert.ok(csv.toString().includes(JSON.stringify(originalTodo.text).slice(1, -1)));
      assert.ok(csv.toString().includes(JSON.stringify(originalAssessment.label).slice(1, -1)));
      await page.getByRole('button', { name: '同じ履修計画をPNGで確認' }).click();
      await page.getByAltText('照合した保存済み履修計画のプレビュー').waitFor();
      const png = await download(page, page.getByRole('button', { name: '確認したPNGを保存' }));
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(await readPut(page), 3);
      await writeFile(join(B78_EVIDENCE, width + '-protected.csv'), csv);
      await writeFile(join(B78_EVIDENCE, width + '-protected.png'), png);

      const restoredPage = await newPage(cold.origin);
      await status(restoredPage).filter({ hasText: '新規計画を開始できます' }).waitFor();
      assert.equal(await readAuthority(restoredPage), null);
      const restored = await commit(restoredPage, () => restoredPage.getByLabel('可搬バックアップから復元').setInputFiles(upload(portable)), true);
      assert.equal(restored.revision, 1);
      assert.equal(restored.raw, completed.raw);
      assert.deepEqual(restored.issuedIds, completed.issuedIds);
      await expectOriginal(restoredPage);
      const coldCSV = await download(restoredPage, restoredPage.getByRole('button', { name: '保存済み履修計画をCSV出力' }));
      assert.deepEqual(coldCSV, csv);
      assert.equal(await readPut(restoredPage), 1);

      // A dirty other row blocks confirmation. Cancelling a prepared form
      // and resetting both controls leaves the four authority fields intact.
      await field(page, 'todo').fill('取消する下書き');
      await submit(page, 'evaluation').click();
      assert.equal(await confirmation(page).count(), 0);
      assert.equal(await page.getByRole('button', { name: '可搬バックアップをダウンロード' }).isDisabled(), true);
      await submit(page, 'todo').click();
      await confirmation(page).getByRole('button', { name: '保存確認を取り消す' }).click();
      await reset(page, 'todo').click();
      assert.equal(await field(page, 'todo').inputValue(), baselineTodo);
      assert.deepEqual(await readAuthority(page), completed);
      assert.equal(await readPut(page), 3);

      assert.equal(todoEvent(await commit(page, async () => {
        await field(page, 'todo').fill('一時値'); await field(page, 'todo').fill(baselineTodo);
        await done(page, 'todo').uncheck(); await submit(page, 'todo').click();
      }), originalTodo.text, false), todoId);
      assert.equal(evaluationEvent(await commit(page, async () => {
        await field(page, 'evaluation').fill('一時値'); await field(page, 'evaluation').fill(originalAssessment.label);
        await done(page, 'evaluation').uncheck(); await submit(page, 'evaluation').click();
      }), originalAssessment.label, false), owner);
      await field(page, 'evaluation').fill('破棄される下書き');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: '保存内容を再読込', exact: true }).click();
      await status(page).filter({ hasText: /保存済み|照合しました/ }).waitFor();
      assert.equal(await field(page, 'evaluation').inputValue(), originalAssessment.label);
      assert.equal(await readPut(page), 5);

      const newTodo = '本人の変更\n二行目', newAssessment = '変更した評価\n次の行';
      assert.equal(todoEvent(await commit(page, async () => {
        await field(page, 'todo').fill(newTodo); await submit(page, 'todo').click();
      }), newTodo, false), todoId);
      assert.equal(evaluationEvent(await commit(page, async () => {
        await field(page, 'evaluation').fill(newAssessment); await submit(page, 'evaluation').click();
      }), newAssessment, false), owner);

      await commit(page, () => todo(page).getByRole('button', { name: 'TODO 削除を確認' }).click());
      await commit(page, () => region(page).getByRole('button', { name: '直前の TODO 削除を取り消す' }).click());
      assert.equal(await todo(page).getAttribute('data-todo-id'), todoId);
      assert.equal(await field(page, 'todo').inputValue(), newTodo);
      await commit(page, () => assessment(page).getByRole('button', { name: '評価削除を確認' }).click());
      await commit(page, () => region(page).getByRole('button', { name: '直前のメディア編集を取り消す' }).click());
      assert.equal(await field(page, 'evaluation').inputValue(), newAssessment);
      await expectOriginal(page);

      const other = await newPage(primary.origin);
      await region(other).waitFor();
      await done(page, 'todo').check();
      await submit(page, 'todo').click();
      await confirmation(page).waitFor();
      const beforeOther = await readPut(page);
      const winner = await commit(other, async () => {
        await done(other, 'evaluation').check(); await submit(other, 'evaluation').click();
      });
      await confirmation(page).waitFor({ state: 'hidden' });
      assert.deepEqual(await readAuthority(page), winner);
      assert.equal(await readPut(page), beforeOther);
      assert.equal(await readPut(other), 1);
      assert.deepEqual(await proxyStorage(a), aBefore);
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
      const result = {
        width, chromium: browser.version(), fixtureSha: sha256(fixture), initialRev: starting.revision, completedRev: completed.revision,
        restoreRev: restored.revision, preserveTodo: originalTodo.text, preserveAssessment: originalAssessment.label,
        restorePuts: 1, initialSavePuts: 3, exportsPuts: 0, cancelledPuts: 0, staleTabPuts: 0, otherTabPuts: 1,
        primaryPuts: beforeOther, proxyOperations: aBefore.count, external, errors, csvSha: sha256(csv), pngSha: sha256(png),
      };
      await writeFile(join(B78_EVIDENCE, width + '-protected.json'), JSON.stringify(result, null, 2));
      console.log(result);
    } finally {
      await context.close();
    }
  });
});
