import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { initialState, loadState, recoverPlannerState, plannerRecoveryRetryRequired,
  preparePlannerInitialProtection, verifyPlannerInitialProtection, confirmPlannerInitialProtection, executePlannerInitialProtection,
  preparePlannerRecoveryRetry, verifyPlannerRecoveryRetryProtection, confirmPlannerRecoveryRetry,
  executePlannerRecoveryRetry, STORAGE_KEY, BACKUP_KEY } from '../src/planner/backup/storage.ts';

const original = ' \n{"schemaVersion":22,"fixture":"disposable","truncated":';
const keys = { p: STORAGE_KEY, r: BACKUP_KEY };
function fixture({ oldRecovery = null, failPrimary = false, failRecovery = false } = {}) {
  const values = new Map([[STORAGE_KEY, original], ...(oldRecovery === null ? [] : [[BACKUP_KEY, oldRecovery]])]);
  const attempts = [], successes = [];
  const store = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      attempts.push(key);
      if (key === STORAGE_KEY && failPrimary || key === BACKUP_KEY && failRecovery) throw new DOMException('fixture quota', 'QuotaExceededError');
      values.set(key, value); successes.push(key);
    },
  };
  const locks = { request(_name, _options, callback) { return Promise.resolve().then(callback); } };
  return { store, locks, values, attempts, successes,
    set failPrimary(value) { failPrimary = value; }, set failRecovery(value) { failRecovery = value; } };
}

test('normal success and initial R failure keep their old public behavior', async () => {
  const good = fixture();
  assert.ok(loadState(good.store, catalog).error);
  const raw = await recoverPlannerState(good.store, original, catalog, good.locks);
  assert.equal(raw, JSON.stringify(initialState()));
  assert.deepEqual(good.attempts, [keys.r, keys.p]);
  assert.equal(good.store.getItem(keys.r), original);
  assert.equal(plannerRecoveryRetryRequired(good.store), false);
  const fail = fixture({ failRecovery: true });
  await assert.rejects(recoverPlannerState(fail.store, original, catalog, fail.locks), /fixture quota/);
  assert.equal(plannerRecoveryRetryRequired(fail.store), false);
  assert.deepEqual(fail.attempts, [keys.r]);
  fail.failRecovery = false;
  await recoverPlannerState(fail.store, original, catalog, fail.locks);
});

test('partial blocks old entry; selected exact protection and fresh token permit one retry', async () => {
  const f = fixture({ oldRecovery: 'prior recovery', failPrimary: true });
  const initial = await preparePlannerInitialProtection(f.store, original, catalog, f.locks);
  await verifyPlannerInitialProtection(f.store, initial.id, initial.text, f.locks);
  const initialToken = await confirmPlannerInitialProtection(f.store, initial.id, f.locks);
  await assert.rejects(executePlannerInitialProtection(f.store, initial.id, initialToken, catalog, f.locks), /fixture quota/);
  assert.equal(plannerRecoveryRetryRequired(f.store), true);
  assert.deepEqual(f.attempts, [keys.r, keys.p]);
  await assert.rejects(recoverPlannerState(f.store, original, catalog, f.locks), /読戻し/);
  assert.deepEqual(f.attempts, [keys.r, keys.p]);
  const a = await preparePlannerRecoveryRetry(f.store, original, catalog, f.locks);
  const file = JSON.parse(a.text);
  assert.equal(file.current.primaryRaw, original);
  assert.equal(file.current.recoveryRaw, original);
  assert.equal(file.priorRecoveryRaw, 'prior recovery');
  await assert.rejects(confirmPlannerRecoveryRetry(f.store, a.id, f.locks));
  await assert.rejects(verifyPlannerRecoveryRetryProtection(f.store, a.id, a.text.replace('prior recovery', 'other recovery'), f.locks));
  assert.deepEqual(f.attempts, [keys.r, keys.p]);
  await verifyPlannerRecoveryRetryProtection(f.store, a.id, a.text, f.locks);
  const token = await confirmPlannerRecoveryRetry(f.store, a.id, f.locks);
  await assert.rejects(confirmPlannerRecoveryRetry(f.store, a.id, f.locks));
  f.failPrimary = false;
  const raw = await executePlannerRecoveryRetry(f.store, a.id, token, catalog, f.locks);
  assert.equal(raw, JSON.stringify(initialState()));
  assert.deepEqual(f.attempts, [keys.r, keys.p, keys.r, keys.p]);
  assert.deepEqual(f.successes, [keys.r, keys.r, keys.p]);
  assert.equal(plannerRecoveryRetryRequired(f.store), false);
  await assert.rejects(executePlannerRecoveryRetry(f.store, a.id, token, catalog, f.locks), /使用済み/);
  assert.deepEqual(f.attempts, [keys.r, keys.p, keys.r, keys.p]);
  console.log(JSON.stringify({ case: 'partial-retry-success', attempts: f.attempts, successes: f.successes,
    primary: f.store.getItem(keys.p), recovery: f.store.getItem(keys.r), priorRecoveryInFile: file.priorRecoveryRaw }));
});

test('stale P/R and late confirmation preserve both raw values with zero new writes', async () => {
  const f = fixture({ failPrimary: true });
  await assert.rejects(recoverPlannerState(f.store, original, catalog, f.locks));
  const a = await preparePlannerRecoveryRetry(f.store, original, catalog, f.locks);
  await verifyPlannerRecoveryRetryProtection(f.store, a.id, a.text, f.locks);
  f.values.set(keys.p, 'another document edit');
  await assert.rejects(confirmPlannerRecoveryRetry(f.store, a.id, f.locks), /原文が変わり/);
  assert.equal(f.store.getItem(keys.p), 'another document edit');
  assert.equal(f.store.getItem(keys.r), original);
  assert.deepEqual(f.attempts, [keys.r, keys.p]);
  await assert.rejects(preparePlannerRecoveryRetry(f.store, original, catalog, f.locks));
});

test('retry R/P failure retains phase and invalidates old record/token', async () => {
  const f = fixture({ failPrimary: true });
  await assert.rejects(recoverPlannerState(f.store, original, catalog, f.locks));
  const a = await preparePlannerRecoveryRetry(f.store, original, catalog, f.locks);
  await verifyPlannerRecoveryRetryProtection(f.store, a.id, a.text, f.locks);
  const token = await confirmPlannerRecoveryRetry(f.store, a.id, f.locks);
  f.failRecovery = true;
  await assert.rejects(executePlannerRecoveryRetry(f.store, a.id, token, catalog, f.locks), /fixture quota/);
  assert.equal(plannerRecoveryRetryRequired(f.store), true);
  assert.deepEqual(f.attempts, [keys.r, keys.p, keys.r]);
  f.failRecovery = false;
  await assert.rejects(executePlannerRecoveryRetry(f.store, a.id, token, catalog, f.locks), /使用済み/);
  const b = await preparePlannerRecoveryRetry(f.store, original, catalog, f.locks);
  await verifyPlannerRecoveryRetryProtection(f.store, b.id, b.text, f.locks);
  const nextToken = await confirmPlannerRecoveryRetry(f.store, b.id, f.locks);
  await assert.rejects(executePlannerRecoveryRetry(f.store, b.id, nextToken, catalog, f.locks), /fixture quota/);
  assert.equal(plannerRecoveryRetryRequired(f.store), true);
  assert.deepEqual(f.attempts, [keys.r, keys.p, keys.r, keys.r, keys.p]);
});

test('unreadable recovery key holds without a protection presentation or another write', async () => {
  const f = fixture({ failPrimary: true });
  await assert.rejects(recoverPlannerState(f.store, original, catalog, f.locks));
  const originalGet = f.store.getItem;
  f.store.getItem = key => {
    if (key === keys.r) throw new DOMException('fixture read failure', 'NotReadableError');
    return originalGet.call(f.store, key);
  };
  await assert.rejects(preparePlannerRecoveryRetry(f.store, original, catalog, f.locks), /fixture read failure/);
  assert.equal(plannerRecoveryRetryRequired(f.store), true);
  assert.deepEqual(f.attempts, [keys.r, keys.p]);
  f.store.getItem = originalGet;
  const prepared = await preparePlannerRecoveryRetry(f.store, original, catalog, f.locks);
  assert.equal(prepared.recoverySha256 !== null, true);
});

test('retired document generation invalidates retry token without another write', async () => {
  const f = fixture({ failPrimary: true });
  await assert.rejects(recoverPlannerState(f.store, original, catalog, f.locks));
  const a = await preparePlannerRecoveryRetry(f.store, original, catalog, f.locks);
  await verifyPlannerRecoveryRetryProtection(f.store, a.id, a.text, f.locks);
  const token = await confirmPlannerRecoveryRetry(f.store, a.id, f.locks);
  const before = [...f.attempts];
  await assert.rejects(executePlannerRecoveryRetry(f.store, a.id, token, catalog, f.locks, () => false), /原文/);
  assert.deepEqual(f.attempts, before);
  await assert.rejects(executePlannerRecoveryRetry(f.store, a.id, token, catalog, f.locks, () => true), /使用済み/);
  assert.deepEqual(f.attempts, before);
});
