import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { initialState, STORAGE_KEY, BACKUP_KEY, PLANNER_WRITE_LOCK } from '../src/planner/backup/storage.ts';
import { createPlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { restorePlannerBackup, restorePlannerBackupWithIntent } from '../src/planner/backup/plannerBackupStorage.ts';

const original = JSON.stringify(initialState());
const target = JSON.stringify({ ...initialState(), todos: [{ id: '00000000-0000-4000-8000-000000000101', offeringId: null, text: '合成TODO', done: false }] });
const text = JSON.stringify(await createPlannerBackup(target, catalog));
function fixture() {
  const values = new Map([[STORAGE_KEY, original], [BACKUP_KEY, 'synthetic recovery bytes']]);
  const writes = [];
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push([key, value]); values.set(key, value); } };
  return { store, writes };
}
function heldLock() {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const requests = [];
  const locks = { request: async (name, options, callback) => { requests.push([name, options.mode]); await gate; return callback(); } };
  return { locks, release, requests };
}

test('private intent becomes stale while waiting; the single lock writes neither P nor R', async () => {
  const { store, writes } = fixture(), { locks, release, requests } = heldLock();
  let current = true;
  const pending = restorePlannerBackupWithIntent(store, text, original, catalog, locks, () => current);
  current = false; release();
  await assert.rejects(pending, /復元操作が失効/);
  assert.deepEqual(requests, [[PLANNER_WRITE_LOCK, 'exclusive']]);
  assert.deepEqual(writes, []);
  assert.equal(store.getItem(STORAGE_KEY), original);
  assert.equal(store.getItem(BACKUP_KEY), 'synthetic recovery bytes');
});

test('unchanged public five-argument API restores P once and leaves R untouched', async () => {
  const { store, writes } = fixture(), { locks, release, requests } = heldLock();
  const pending = restorePlannerBackup(store, text, original, catalog, locks); release();
  const result = await pending;
  assert.equal(result.raw, target);
  assert.deepEqual(requests, [[PLANNER_WRITE_LOCK, 'exclusive']]);
  assert.deepEqual(writes, [[STORAGE_KEY, target]]);
  assert.equal(store.getItem(BACKUP_KEY), 'synthetic recovery bytes');
});

test('P changed before lock entry prevents a second write', async () => {
  const { store, writes } = fixture(), { locks, release } = heldLock();
  const pending = restorePlannerBackupWithIntent(store, text, original, catalog, locks, () => true);
  store.setItem(STORAGE_KEY, 'other writer bytes'); writes.length = 0; release();
  await assert.rejects(pending, /プレビュー後に保存データが変更/);
  assert.deepEqual(writes, []);
  assert.equal(store.getItem(STORAGE_KEY), 'other writer bytes');
});

test('setItem failure preserves the exact DOMException object', async () => {
  const { store } = fixture();
  const originalSet = store.setItem, error = new DOMException('synthetic quota', 'QuotaExceededError');
  store.setItem = (key, value) => { if (key === STORAGE_KEY) throw error; originalSet(key, value); };
  const locks = { request: async (_name, _options, callback) => callback() };
  let caught; try { await restorePlannerBackupWithIntent(store, text, original, catalog, locks, () => true); } catch (e) { caught = e; }
  assert.equal(caught, error);
  assert.equal(store.getItem(STORAGE_KEY), original);
  assert.equal(store.getItem(BACKUP_KEY), 'synthetic recovery bytes');
});
