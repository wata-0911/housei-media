import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { recoverState, recoverPlannerState, plannerRecoveryRetryRequired, STORAGE_KEY, BACKUP_KEY } from '../src/planner/backup/storage.ts';

const raw = ' \n{"schemaVersion":22,"fixture":"disposable","truncated":';
function fixture(failKey, failure) {
  const values = new Map([[STORAGE_KEY, raw]]), attempts = [], successes = [];
  const store = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      attempts.push(key);
      if (key === failKey) throw failure;
      values.set(key, value); successes.push(key);
    },
  };
  const locks = { request(_name, _options, callback) { return Promise.resolve().then(callback); } };
  return { store, locks, attempts, successes };
}

test('public async P failure rejects the exact DOMException and records partial internally', async () => {
  const quota = new DOMException('fixture quota', 'QuotaExceededError');
  const f = fixture(STORAGE_KEY, quota);
  let caught;
  try { await recoverPlannerState(f.store, raw, catalog, f.locks); } catch (error) { caught = error; }
  assert.equal(caught, quota);
  assert.ok(caught instanceof DOMException);
  assert.equal(caught.name, 'QuotaExceededError');
  assert.equal(plannerRecoveryRetryRequired(f.store), true);
  assert.deepEqual(f.attempts, [BACKUP_KEY, STORAGE_KEY]);
  assert.deepEqual(f.successes, [BACKUP_KEY]);
  await assert.rejects(recoverPlannerState(f.store, raw, catalog, f.locks), /読戻し/);
  assert.deepEqual(f.attempts, [BACKUP_KEY, STORAGE_KEY]);
  console.log(JSON.stringify({entry:'recoverPlannerState',type:caught.constructor.name,name:caught.name,
    sameObject:caught===quota,attempts:f.attempts,successes:f.successes}));
});

test('public sync recoverState P failure throws the exact DOMException', () => {
  const quota = new DOMException('fixture quota', 'QuotaExceededError');
  const f = fixture(STORAGE_KEY, quota);
  let caught;
  try { recoverState(f.store, raw, catalog); } catch (error) { caught = error; }
  assert.equal(caught, quota);
  assert.ok(caught instanceof DOMException);
  assert.equal(caught.name, 'QuotaExceededError');
  assert.deepEqual(f.attempts, [BACKUP_KEY, STORAGE_KEY]);
  assert.deepEqual(f.successes, [BACKUP_KEY]);
  console.log(JSON.stringify({entry:'recoverState',type:caught.constructor.name,name:caught.name,
    sameObject:caught===quota,attempts:f.attempts,successes:f.successes}));
});

test('R failure propagates exactly and does not enter partial phase', async () => {
  const quota = new DOMException('fixture recovery quota', 'QuotaExceededError');
  const f = fixture(BACKUP_KEY, quota);
  let caught;
  try { await recoverPlannerState(f.store, raw, catalog, f.locks); } catch (error) { caught = error; }
  assert.equal(caught, quota);
  assert.equal(plannerRecoveryRetryRequired(f.store), false);
  assert.deepEqual(f.attempts, [BACKUP_KEY]);
  assert.deepEqual(f.successes, []);
});
