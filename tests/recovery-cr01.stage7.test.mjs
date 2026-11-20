import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { BACKUP_KEY, STORAGE_KEY, recoverState, recoverPlannerState, plannerRecoveryRetryRequired,
  preparePlannerInitialProtection, verifyPlannerInitialProtection, confirmPlannerInitialProtection,
  executePlannerInitialProtection, preparePlannerRecoveryRetry, verifyPlannerRecoveryRetryProtection,
  confirmPlannerRecoveryRetry, executePlannerRecoveryRetry } from '../src/planner/backup/storage.ts';

const P = '{"schemaVersion":22,"truncated":', R = '{"schemaVersion":22,"validOldRecovery":true}';
function fixture(oldR = R) {
  const values = new Map([[STORAGE_KEY, P], [BACKUP_KEY, oldR]]), attempts = [], successes = [];
  let failP = false;
  const store = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { attempts.push(key); if (failP && key === STORAGE_KEY) throw new DOMException('fixture quota','QuotaExceededError'); values.set(key, value); successes.push(key); },
  };
  const locks = { request(_name, _options, fn) { return Promise.resolve().then(fn); } };
  return { store, locks, values, attempts, successes, setFailP(value) { failP = value; } };
}
async function ready(f) {
  const record = await preparePlannerInitialProtection(f.store, P, catalog, f.locks);
  await verifyPlannerInitialProtection(f.store, record.id, record.text, f.locks);
  return { ...record, token: await confirmPlannerInitialProtection(f.store, record.id, f.locks) };
}

test('non-null old R including empty string blocks both public entries before writes', async () => {
  for (const oldR of [R, '']) {
    const f = fixture(oldR);
    assert.throws(() => recoverState(f.store, P, catalog), /保護ファイル/);
    await assert.rejects(recoverPlannerState(f.store, P, catalog, f.locks), /保護ファイル/);
    assert.deepEqual(f.attempts, []); assert.equal(f.store.getItem(BACKUP_KEY), oldR);
  }
});

test('preparation, missing or wrong file, and cancelled consent perform zero writes', async () => {
  const f = fixture();
  const record = await preparePlannerInitialProtection(f.store, P, catalog, f.locks);
  await assert.rejects(confirmPlannerInitialProtection(f.store, record.id, f.locks));
  await assert.rejects(verifyPlannerInitialProtection(f.store, record.id, record.text + ' ', f.locks));
  assert.deepEqual(f.attempts, []);
  assert.equal(f.store.getItem(BACKUP_KEY), R);
});

test('stale P or R before confirmation or final lock refuses both writes', async () => {
  for (const key of [STORAGE_KEY, BACKUP_KEY]) {
    const f = fixture(), record = await preparePlannerInitialProtection(f.store, P, catalog, f.locks);
    await verifyPlannerInitialProtection(f.store, record.id, record.text, f.locks);
    f.values.set(key, 'other-tab');
    await assert.rejects(confirmPlannerInitialProtection(f.store, record.id, f.locks));
    assert.deepEqual(f.attempts, []); assert.equal(f.store.getItem(key), 'other-tab');
  }
  const f = fixture(), record = await ready(f);
  f.values.set(BACKUP_KEY, 'other-tab');
  await assert.rejects(executePlannerInitialProtection(f.store, record.id, record.token, catalog, f.locks));
  assert.deepEqual(f.attempts, []); assert.equal(f.store.getItem(BACKUP_KEY), 'other-tab');
});

test('saved file readback protects exact old R through initial success and replay is blocked', async () => {
  const f = fixture(), record = await ready(f);
  assert.equal(JSON.parse(record.text).recoveryRaw, R);
  const fresh = await executePlannerInitialProtection(f.store, record.id, record.token, catalog, f.locks);
  assert.deepEqual(f.attempts, [BACKUP_KEY, STORAGE_KEY]);
  assert.equal(f.store.getItem(BACKUP_KEY), P);
  assert.equal(f.store.getItem(STORAGE_KEY), fresh);
  await assert.rejects(executePlannerInitialProtection(f.store, record.id, record.token, catalog, f.locks));
  assert.deepEqual(f.attempts, [BACKUP_KEY, STORAGE_KEY]);
});

test('retired document generation consumes an initial operation without any write', async () => {
  const f = fixture(), record = await ready(f);
  await assert.rejects(executePlannerInitialProtection(f.store, record.id, record.token, catalog, f.locks, () => false), /原文/);
  assert.deepEqual(f.attempts, []);
  await assert.rejects(executePlannerInitialProtection(f.store, record.id, record.token, catalog, f.locks, () => true));
  assert.deepEqual(f.attempts, []);
  assert.equal(f.store.getItem(BACKUP_KEY), R);
});

test('protected initial P quota failure retains old R externally and permits fresh protected retry', async () => {
  const f = fixture(), record = await ready(f);
  f.setFailP(true);
  await assert.rejects(executePlannerInitialProtection(f.store, record.id, record.token, catalog, f.locks), { name: 'QuotaExceededError' });
  assert.equal(plannerRecoveryRetryRequired(f.store), true);
  assert.equal(JSON.parse(record.text).recoveryRaw, R);
  assert.deepEqual(f.attempts, [BACKUP_KEY, STORAGE_KEY]);
  await assert.rejects(executePlannerInitialProtection(f.store, record.id, record.token, catalog, f.locks));
  assert.deepEqual(f.attempts, [BACKUP_KEY, STORAGE_KEY]);
  const retry = await preparePlannerRecoveryRetry(f.store, P, catalog, f.locks);
  assert.equal(JSON.parse(retry.text).priorRecoveryRaw, R);
  await verifyPlannerRecoveryRetryProtection(f.store, retry.id, retry.text, f.locks);
  const token = await confirmPlannerRecoveryRetry(f.store, retry.id, f.locks);
  f.setFailP(false);
  await executePlannerRecoveryRetry(f.store, retry.id, token, catalog, f.locks);
  assert.deepEqual(f.attempts, [BACKUP_KEY, STORAGE_KEY, BACKUP_KEY, STORAGE_KEY]);
  assert.equal(plannerRecoveryRetryRequired(f.store), false);
});

test('protected initial R failure leaves P/R unchanged and does not create partial phase', async () => {
  const f = fixture(), record = await ready(f);
  const originalSet = f.store.setItem;
  f.store.setItem = (key, value) => {
    if (key === BACKUP_KEY) { f.attempts.push(key); throw new DOMException('fixture recovery quota','QuotaExceededError'); }
    return originalSet(key, value);
  };
  await assert.rejects(executePlannerInitialProtection(f.store, record.id, record.token, catalog, f.locks), { name: 'QuotaExceededError' });
  assert.deepEqual(f.attempts, [BACKUP_KEY]);
  assert.deepEqual(f.successes, []);
  assert.equal(f.store.getItem(STORAGE_KEY), P);
  assert.equal(f.store.getItem(BACKUP_KEY), R);
  assert.equal(plannerRecoveryRetryRequired(f.store), false);
});
