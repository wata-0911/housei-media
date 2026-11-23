import assert from 'node:assert/strict';
import test from 'node:test';
import { createAcController } from '../src/planner/attempts/production/acController.ts';
import { createPlannerAttemptSession } from '../src/planner/attempts/production/session.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { inventoryFromVerifiedBackup } from '../src/planner/attempts/progress/savedInventory.ts';
import { CURRENT_CURRICULUM_SEARCH_TARGET } from '../src/planner/institutional/currentSearch.ts';
import { env, master, mixed } from './fixtures/migration-fixture.mjs';

const locks = { request: async (_name, _options, run) => run() };
const mediaPlacement = 'hosei:cp:13f6e301-6356-4670-a2cc-e285d49d343e';
const draft = year => JSON.stringify({ plannedYear: year, method: 'media', status: 'in_progress' });
const evaluation = finalGrade => JSON.stringify({ finalGrade, reportGrade: null, schoolingGrade: 'A' });

function host(primaryRaw = null) {
  let authority = emptyAuthority();
  const legacy = { primaryRaw, recoveryRaw: primaryRaw === null ? null : 'synthetic recovery\t' };
  const store = {
    read: async () => structuredClone(authority),
    commit: async (expected, next, beforePut) => {
      assert.deepEqual(authority, expected);
      beforePut?.();
      authority = structuredClone(next);
    },
  };
  return { legacy, snapshot: () => structuredClone(authority),
    session: () => createPlannerAttemptSession(store, locks, {
      readLegacy: () => ({ ...legacy }), migrationEnvironment: async () => env,
    }) };
}

async function save(controller) {
  assert.equal(await controller.prepare(), true);
  const proposal = controller.getSnapshot().proposal;
  assert.equal(await controller.save(proposal, true), true, controller.getSnapshot().error);
}

test('F04 read binds ordered schema23 owners and provenance to F01; HOLD retains the unassociated original 1/4', async () => {
  const source = mixed();
  source.importedCourseAchievements[0].earnedCreditsTotal = 1;
  const raw = ' \n' + JSON.stringify(source, null, 2) + '\r\n';
  const h = host(raw);
  const session = h.session(), controller = createAcController(session);
  assert.equal(await controller.load(), true);
  assert.equal(await controller.prepareMigration(raw), true);
  assert.equal(await controller.save(controller.getSnapshot().proposal, true), true);
  const state = controller.getSnapshot();
  assert.equal(state.saved.status, 'pinned');
  const view = state.saved.past;
  const committed = h.snapshot();
  const saved = JSON.parse(committed.raw);
  assert.equal(view.snapshot.schemaVersion, 23);
  assert.equal(view.snapshot.sourceDigest, CURRENT_CURRICULUM_SEARCH_TARGET.sourceDigest);
  assert.equal(view.ownerInventory.sourcePin, view.snapshot);
  assert.deepEqual(view.ownerInventory.records.map(({ order, provenance, ...row }) => {
    assert.deepEqual(provenance, saved.ledger.records.find(slot => slot.recordId === row.id));
    assert.ok(order >= 0);
    return row;
  }), saved.graph.ownedRecords);
  assert.ok(view.ownerInventory.records.some(record => record.owner === null && record.kind === 'todo'));
  assert.equal(view.officialSource.raw, raw);
  assert.equal(view.retained.importedCourseAchievements[0].earnedCreditsTotal, 1);
  assert.equal(view.retained.importedCourseAchievements[0].compositionCredits, 4);
  assert.equal(view.retained.importedCourseAchievements[0].courseId, null);
  assert.deepEqual(view.projection.officialHistory, []);
  assert.equal(view.projection.creditEvidence.knownOfficialCredits, null);
  const attempt = state.graph.attempts.find(attempt => attempt.membership.kind === 'active');
  assert.ok(controller.progress(attempt.id, evaluation('S'), 'evaluation'));
  const dirty = controller.getSnapshot();
  assert.equal(dirty.saved.status, 'hold');
  assert.equal(dirty.saved.past, view);
  assert.equal(dirty.dirty, true);
  assert.deepEqual(h.snapshot(), committed);
  await assert.rejects(controller.createBackup(), /保存済み/);
  assert.equal(await controller.prepareRestore(JSON.stringify({})), false);
  assert.deepEqual(controller.getSnapshot().graph, dirty.graph);
  await save(controller);
  const next = controller.getSnapshot().saved.past;
  assert.equal(next.officialSource.raw, raw);
  assert.deepEqual(next.retained, view.retained);
  assert.deepEqual(h.legacy, { primaryRaw: raw, recoveryRaw: 'synthetic recovery\t' });
  const backup = await controller.createBackup();
  assert.equal(JSON.parse(backup).state.source.raw, raw);
  await assert.rejects(inventoryFromVerifiedBackup(backup, { ...master, sourceRevision: { ...master.sourceRevision, sha256: 'different' } }),
    /saved_inventory_master_mismatch/);
});

test('F03 exact distinct owners survive explicit save, reload, remove/Undo and hash-bound portable restore', async () => {
  const h = host(), c = createAcController(h.session());
  await c.load();
  await save(c);
  assert.ok(c.add(mediaPlacement, draft(2027)));
  assert.ok(c.add(mediaPlacement, draft(2028)));
  const [first, second] = c.getSnapshot().graph.attempts;
  assert.equal(first.originalTitle, second.originalTitle);
  assert.notEqual(first.id, second.id);
  assert.equal(c.progress(first.id, '{}', 'correspondence'), false);
  assert.ok(c.progress(first.id, JSON.stringify({ totalLessons: null, lessons: [
    { lesson: 1, videoCompleted: true, testCompleted: false }], assessments: [] }), 'media'));
  assert.ok(c.progress(second.id, evaluation('D'), 'evaluation'));
  assert.equal(h.snapshot().revision, 1);
  await save(c);
  assert.equal(h.snapshot().revision, 2);
  const original = c.getSnapshot().graph;
  assert.equal(c.getSnapshot().saved.status, 'pinned');
  assert.deepEqual(c.getSnapshot().saved.past.ownerInventory.records.map(x => x.owner.attemptId), [first.id, second.id]);
  assert.ok(c.remove(second.id));
  await save(c);
  await c.load();
  assert.equal(c.getSnapshot().graph.attempts[1].membership.kind, 'detached');
  assert.ok(c.undo(second.id));
  await save(c);
  assert.deepEqual(c.getSnapshot().graph, original);
  const backup = await c.createBackup();
  const target = host(), receiver = createAcController(target.session());
  await receiver.load();
  assert.ok(await receiver.prepareRestore(backup));
  const proposal = receiver.getSnapshot().proposal;
  assert.equal(proposal.action, 'restore');
  assert.ok(proposal.adoptionSha256);
  assert.equal(await receiver.save(proposal, true), false);
  assert.deepEqual(target.snapshot(), emptyAuthority());
  assert.ok(await receiver.save(proposal, true, proposal.adoptionSha256));
  await receiver.load();
  assert.deepEqual(receiver.getSnapshot().graph, original);
  assert.equal(receiver.getSnapshot().saved.status, 'pinned');
  for (const id of h.snapshot().issuedIds) assert.ok(target.snapshot().issuedIds.includes(id));
});

test('a competing save invalidates fresh display and edit authority while the historical pin survives', async () => {
  const h = host(), c = createAcController(h.session());
  await c.load();
  await save(c);
  assert.ok(c.add(mediaPlacement, draft(2027)));
  await save(c);
  const past = c.getSnapshot().saved.past;
  const other = h.session();
  await other.load();
  other.progress(other.graph().attempts[0].id, 'evaluation', evaluation('A'));
  await other.save(await other.prepareSave(), true);
  const winner = h.snapshot();
  await c.verifySaved();
  assert.equal(c.getSnapshot().saved.status, 'hold');
  assert.equal(c.getSnapshot().saved.past, past);
  assert.equal(c.getSnapshot().ready, false);
  assert.deepEqual(h.snapshot(), winner);
  await c.load();
  assert.equal(c.getSnapshot().saved.status, 'pinned');
  assert.equal(c.getSnapshot().saved.past.ownerInventory.records[0].payload.finalGrade, 'A');
});

test('a late provider response cannot replace HOLD after a revocation notification', async () => {
  const h = host(), initial = createAcController(h.session());
  await initial.load();
  await save(initial);
  const session = h.session();
  const originalRead = session.readSavedInventory;
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  session.readSavedInventory = async () => {
    const value = await originalRead();
    entered();
    await pending;
    return value;
  };
  const controller = createAcController(session);
  const loading = controller.load();
  await started;
  controller.invalidateSaved();
  release();
  await loading;
  assert.equal(controller.getSnapshot().saved.status, 'hold');
  assert.equal(controller.getSnapshot().saved.past, null);
  assert.equal(controller.getSnapshot().ready, false);
});
