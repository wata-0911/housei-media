import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { recoverPlannerState, initialState, STORAGE_KEY, BACKUP_KEY, plannerRecoveryRetryRequired } from '../src/planner/backup/storage.ts';

const raw = ' \n{"schemaVersion":22,"fixture":"a08","truncated":';
function fixture(failure = null) {
  const values = new Map([[STORAGE_KEY, raw]]), attempts = [], successes = [];
  const store = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      attempts.push({ key, value });
      if (key === STORAGE_KEY && failure) throw failure;
      values.set(key, value); successes.push({ key, value });
    },
  };
  let entered, release;
  const acquired = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const locks = { request(_name, _options, callback) { entered(); return gate.then(callback); } };
  return { store, values, attempts, successes, locks, acquired, release };
}

test('retired R=null operation rejects inside lock before first R write', async () => {
  const f = fixture(); let current = true;
  const pending = recoverPlannerState(f.store, raw, catalog, f.locks, () => current);
  await f.acquired; current = false; f.release();
  await assert.rejects(pending, /原文が変わり/);
  assert.deepEqual(f.attempts, []); assert.deepEqual(f.successes, []);
  assert.equal(f.store.getItem(STORAGE_KEY), raw); assert.equal(f.store.getItem(BACKUP_KEY), null);
  assert.equal(plannerRecoveryRetryRequired(f.store), false);
});

test('unknown current operation fails closed without P/R writes', async () => {
  const f = fixture();
  const pending = recoverPlannerState(f.store, raw, catalog, f.locks, () => { throw new Error('unknown generation'); });
  await f.acquired; f.release();
  await assert.rejects(pending, /unknown generation/);
  assert.deepEqual(f.attempts, []);
});

test('current R=null operation still writes R then P once and reports success', async () => {
  const f = fixture(); let checks = 0;
  const pending = recoverPlannerState(f.store, raw, catalog, f.locks, () => { checks++; return true; });
  await f.acquired; f.release();
  const newRaw = await pending;
  assert.equal(checks, 1); assert.equal(newRaw, JSON.stringify(initialState()));
  assert.deepEqual(f.attempts.map(x => x.key), [BACKUP_KEY, STORAGE_KEY]);
  assert.equal(f.store.getItem(BACKUP_KEY), raw); assert.equal(f.store.getItem(STORAGE_KEY), newRaw);
});

test('P quota preserves original DOMException object and partial phase', async () => {
  const quota = new DOMException('fixture quota', 'QuotaExceededError');
  const f = fixture(quota);
  const pending = recoverPlannerState(f.store, raw, catalog, f.locks, () => true);
  await f.acquired; f.release();
  let caught; try { await pending; } catch (error) { caught = error; }
  assert.equal(caught, quota); assert.equal(caught.name, 'QuotaExceededError');
  assert.deepEqual(f.attempts.map(x => x.key), [BACKUP_KEY, STORAGE_KEY]);
  assert.equal(f.store.getItem(STORAGE_KEY), raw); assert.equal(f.store.getItem(BACKUP_KEY), raw);
  assert.equal(plannerRecoveryRetryRequired(f.store), true);
});
