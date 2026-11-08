import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptPersistence } from '../src/planner/attempts/persistence/controller.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { backupDigest } from '../src/planner/digest.ts';
import { makeAttempt } from '../src/planner/attempts/workbench/catalogView.ts';
import { newOperationId } from '../src/planner/attempts/workbench/operations.ts';

const locks = { request: async (_name, _options, run) => run() };
function host() {
  let record = emptyAuthority();
  let puts = 0;
  const store = {
    read: async () => structuredClone(record),
    commit: async (expected, next) => {
      assert.deepEqual(record, expected);
      record = structuredClone(next);
      puts++;
    },
  };
  return { api: createAttemptPersistence(store, locks), record: () => structuredClone(record), puts: () => puts };
}
async function save(api, preview) {
  return api.commit(preview, true, preview.previousRaw, preview.sourceRaw);
}
async function add(api, handle, title) {
  const attempt = makeAttempt(handle.source.context.catalog, {
    title, courseId: null, placementId: null,
    plan: { plannedYear: null, plannedTerm: null, studyYear: null, status: 'planned', earnedOrder: null },
    method: 'unknown', note: '',
  });
  const preview = await api.prepareEdits(handle, [{ kind: 'add', operationId: attempt.creationOperationId, attempt }]);
  return { handle: await save(api, preview), attempt };
}

test('R8 restore keeps existing host prefix, incoming order and removed IDs across another restore', async () => {
  const source = host();
  let sourceHandle = await save(source.api, await source.api.prepareNewPlan());
  const added = await add(source.api, sourceHandle, 'source attempt');
  sourceHandle = added.handle;
  sourceHandle = await save(source.api, await source.api.prepareEdits(sourceHandle,
    [{ kind: 'remove', operationId: newOperationId(), attemptId: added.attempt.id }]));
  const sourceRaw = source.record().raw;
  const backup = await source.api.createBackup(sourceHandle);
  const incoming = JSON.parse(backup).reservedIds;
  assert.deepEqual(incoming, source.record().issuedIds);
  assert.ok(incoming.includes(added.attempt.id), 'deleted attempt ID remains reserved');

  const target = host();
  let targetHandle = await save(target.api, await target.api.prepareNewPlan());
  targetHandle = (await add(target.api, targetHandle, 'host attempt')).handle;
  const hostPrefix = target.record().issuedIds;
  const expected = [...new Set([...hostPrefix, ...incoming])];
  const hostOnly = hostPrefix.find(id => !incoming.includes(id));
  assert.ok(hostOnly);
  const conflicting = JSON.parse(backup);
  conflicting.reservedIds.push(`hosei:owned:${hostOnly.split(':').at(-1)}`);
  delete conflicting.sha256;
  await assert.rejects(target.api.inspectBackup(JSON.stringify({ ...conflicting,
    sha256: await backupDigest(conflicting) })), /recovery_host_collision|reservation_uuid_collision/);
  assert.equal(target.puts(), 2, 'alias conflict cannot write');
  const preview = await target.api.inspectBackup(backup);
  assert.equal(target.puts(), 2, 'preview is read only');
  await assert.rejects(save(target.api, preview), /portable_adoption_and_protection_required/);
  assert.equal(target.puts(), 2, 'missing consent cannot write');
  await target.api.commit(preview, true, preview.previousRaw, preview.sourceRaw,
    { acceptedBackupRawSha256: preview.recovery.rawSha256, protectedBackupRaw: backup });
  assert.deepEqual(target.record().issuedIds, expected);
  assert.equal(target.record().raw, sourceRaw);
  const loaded = await target.api.load();
  const repeated = await target.api.createBackup(loaded);
  assert.deepEqual(JSON.parse(repeated).reservedIds, expected);
  const again = await target.api.inspectBackup(repeated);
  await save(target.api, again);
  assert.deepEqual(target.record().issuedIds, expected);
  assert.equal(target.record().raw, sourceRaw);
});
