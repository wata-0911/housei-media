import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { initialState, STORAGE_KEY, BACKUP_KEY } from '../src/planner/backup/storage.ts';
import { validateState } from '../src/planner/validation.ts';
import { createPlannerBackup, parsePlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { restorePlannerBackup } from '../src/planner/backup/plannerBackupStorage.ts';

// Fixed dev tests/migration.test.mjs:37 has a direct old22 assertion before
// calling the future decoder. Keep the two boundaries distinct.
test('old22 null contribution is invalid without losing a valid zero/number input', () => {
  const item = { offeringId: catalog.offerings[0].id, status: 'earned', plannedYear: null,
    plannedTerm: null, studyYear: null, earnedOrder: null, courseCreditContribution: 2 };
  const state = { ...initialState(), items: [item] };
  assert.equal(validateState(state, catalog), true);
  assert.equal(validateState({ ...state, items: [{ ...item, courseCreditContribution: 0 }] }, catalog), true);
  assert.equal(validateState({ ...state, items: [{ ...item, courseCreditContribution: null }] }, catalog), false);
});

// Fixed dev tests/migration.test.mjs:118 tests the future decoder. These
// assertions cover only current 2026 backup/restore rejection and write0.
for (const version of [0, 3, 999]) test(`old22 backup version ${version} refuses restore with P/R unchanged`, async () => {
  const raw = JSON.stringify(initialState()), recovery = 'synthetic recovery raw';
  const valid = await createPlannerBackup(raw, catalog);
  const text = JSON.stringify({ ...valid, backupVersion: version });
  const values = new Map([[STORAGE_KEY, raw], [BACKUP_KEY, recovery]]), writes = [];
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); } };
  const locks = { request: async (_name, _options, callback) => callback() };
  await assert.rejects(parsePlannerBackup(text, catalog), /版が未対応/);
  await assert.rejects(restorePlannerBackup(store, text, raw, catalog, locks), /版が未対応/);
  assert.deepEqual(writes, []);
  assert.equal(store.getItem(STORAGE_KEY), raw);
  assert.equal(store.getItem(BACKUP_KEY), recovery);
});
