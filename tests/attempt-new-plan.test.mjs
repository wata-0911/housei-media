import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptPersistence } from '../src/planner/attempts/persistence/controller.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { replayState, replayMigrationState } from '../src/planner/attempts/persistence/codec.ts';
import { replayNewPlan } from '../src/planner/attempts/persistence/newPlan.ts';
import { backupDigest } from '../src/planner/backup/plannerBackupCompatibility.ts';
import { createInstitutionalSearchAdapter } from '../src/planner/institutional/search.ts';
import { CURRENT_CURRICULUM_SEARCH_TARGET } from '../src/planner/institutional/currentSearch.ts';
import { makeSearchAttempt } from '../src/planner/attempts/workbench/searchBridge.ts';
import { makeAttempt } from '../src/planner/attempts/workbench/catalogView.ts';
import { newOperationId, newRecordId } from '../src/planner/attempts/workbench/operations.ts';
import { emptyProgress } from '../dev/attempts/progressDefaults.ts';

const locks = { request: async (_name, _options, action) => action() };
function memory() {
  let data = emptyAuthority();
  return { writes: 0, failure: '', snapshot: () => structuredClone(data),
    async read() { return structuredClone(data); },
    async commit(expected, next) {
      if (this.failure) throw new Error(this.failure);
      if (JSON.stringify(expected) !== JSON.stringify(data)) throw new Error('stale_commit');
      data = structuredClone(next); this.writes++;
    } };
}
const controller = (store, lock = locks) => createAttemptPersistence(store, lock); // NO migration environment / Offering catalog.
const commit = (api, p, confirmed = true, consent) => api.commit(p, confirmed, p.previousRaw, p.sourceRaw, consent);
async function start(store = memory()) {
  const api = controller(store), p = await api.prepareNewPlan();
  return { api, store, loaded: await commit(api, p) };
}
async function save(api, h, commands) { return commit(api, await api.prepareEdits(h, commands)); }
function rows(h) { return createInstitutionalSearchAdapter(h.source.context.catalog, CURRENT_CURRICULUM_SEARCH_TARGET).search({ scope: { kind: 'all' } }).rows; }
const input = { plan: { plannedYear: null, plannedTerm: null, studyYear: null, status: 'planned', earnedOrder: null }, method: 'unknown', note: '' };
function add(h, status = 'safe') {
  const row = rows(h).find(r => r.placement.kind === 'course_placement' && r.placement.identityDecision.status === status);
  assert.ok(row, status);
  const attempt = makeSearchAttempt(h.source.context.catalog, row, input);
  return { kind: 'add', operationId: attempt.creationOperationId, attempt };
}
const remove = a => ({ kind: 'remove', attemptId: a.id, operationId: newOperationId() });
const undo = t => ({ kind: 'undo', attemptId: t.attemptSnapshot.id, removalOperationId: t.operationId, operationId: newOperationId() });
const portableConsent = p => ({ acceptedBackupRawSha256: p.recovery.rawSha256, protectedBackupRaw: p.recovery.raw });
async function rehash(backup) { const { sha256, ...body } = backup; void sha256; return JSON.stringify({ ...body, sha256: await backupDigest(body) }); }

test('new plan: preview is empty, explicit, read-only, no v22/Offering/migration fields or fabricated quantities', async () => {
  const store = memory(); let migrationReads = 0;
  const api = createAttemptPersistence(store, locks, async () => { migrationReads++; throw new Error('Offering environment must not be read'); });
  assert.equal(await api.load(), null);
  const p = await api.prepareNewPlan(), s = p.handle.state;
  assert.equal(s.schemaVersion, 24); assert.equal(s.source.origin, 'new-plan'); assert.equal(p.action, 'new-plan');
  for (const key of ['raw', 'schemaVersion', 'catalog']) assert.equal(Object.hasOwn(s.source, key), false);
  for (const key of ['assignments', 'ledger', 'corrections', 'catalog']) assert.equal(Object.hasOwn(s, key), false);
  assert.deepEqual(s.graph, { attempts: [], ownedRecords: [], removals: [] });
  assert.deepEqual(s.history, { commands: [], issuedIds: [], usedTodoIds: [] });
  assert.deepEqual(s.retained, { importedCourseAchievements: [], importedStudyRecords: [], applicability: 'unknown', scopeId: null, graduationEvaluation: 'not_evaluated', graduationCheckComplete: false, sourceLinksReverified: false });
  assert.equal(p.handle.source.context.legacyArchive, undefined); assert.equal(store.writes, 0);
  await assert.rejects(commit(api, p, false), /confirmation/);
  await assert.rejects(api.commit(p, true, null, 'fake source'), /protection/);
  await assert.rejects(api.createBackup(p.handle), /committed/);
  await assert.rejects(commit(api, structuredClone(p)), /confirmation/);
  const loaded = await commit(api, p); assert.equal(store.writes, 1);
  assert.deepEqual((await controller(store).load()).state, loaded.state); assert.equal(migrationReads, 0);
});

test('first Attempt can be staged from the empty source without creating a DB checkpoint', async () => {
  const store = memory(), api = controller(store), initial = await api.prepareNewPlan(), c = add(initial.handle);
  const p = await api.prepareEdits(initial.handle, [c]);
  assert.equal(store.writes, 0); assert.equal(store.snapshot().raw, null);
  assert.equal(p.handle.state.graph.attempts[0].id, c.attempt.id);
  const loaded = await commit(api, p); assert.equal(store.writes, 1);
  assert.deepEqual((await controller(store).load()).state, loaded.state);
  await assert.rejects(commit(api, initial), /stale_commit/);
});

test('Placement safe/ambiguous/conflict, bucket refusal, duplicates and idempotence survive commit/reload', async () => {
  let { api, store, loaded } = await start();
  const commands = ['safe', 'ambiguous', 'conflict', 'safe'].map(status => add(loaded, status));
  const bucket = rows(loaded).find(r => r.placement.kind === 'non_course_bucket');
  assert.throws(() => makeSearchAttempt(loaded.source.context.catalog, bucket, input), /non_course_bucket/);
  let draft = loaded.workspace;
  for (const c of commands) draft = api.dispatch(loaded, draft, c);
  assert.equal(api.dispatch(loaded, draft, commands[0]), draft);
  assert.equal(JSON.parse(store.snapshot().raw).graph.attempts.length, 0);
  loaded = await save(api, loaded, commands); loaded = await controller(store).load();
  assert.deepEqual(loaded.state.history.commands, commands);
  assert.equal(new Set(loaded.state.history.issuedIds).size, 8);
  assert.equal(loaded.state.graph.attempts[0].identity.status, 'confirmed');
  assert.equal(loaded.state.graph.attempts[1].identity.status, 'ambiguous');
  assert.equal(loaded.state.graph.attempts[2].identity.status, 'conflict');
  for (const a of loaded.state.graph.attempts) { assert.equal(a.applicability.status, 'unknown'); assert.equal(a.plan.plannedYear, null); assert.equal(a.method.value, 'unknown'); assert.equal(Object.hasOwn(a.plan, 'contribution'), false); }
  api = controller(store); loaded = await api.load();
  assert.equal((await save(api, loaded, [commands[0]])).state.graph.attempts.length, 4);
  await assert.rejects(api.prepareEdits(loaded, [{ ...commands[0], attempt: { ...commands[0].attempt, originalTitle: 'altered' } }]), /replay_conflict/);
});

test('owner/progress/evaluation/TODO, plan edit, strict LIFO and deleted ID reservations persist', async () => {
  let { api, store, loaded } = await start(); const c1 = add(loaded), c2 = add(loaded); loaded = await save(api, loaded, [c1, c2]);
  const records = ['media', 'correspondence', 'evaluation'].map(kind => emptyProgress(kind, c1.attempt.id));
  records[0].payload = { totalLessons: 1, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }], assessments: [] };
  records[1].payload = { requiredReports: 1, reports: [{ reportNumber: 1, status: 'passed', grade: 'A' }], examGrade: null };
  records[2].payload.finalGrade = 'A';
  const todo = { id: newRecordId(), kind: 'todo', owner: { kind: 'attempt', attemptId: c1.attempt.id }, payload: { id: crypto.randomUUID(), text: '研究', done: false } };
  records.push(todo);
  loaded = await save(api, loaded, records.map(record => ({ kind: 'add_record', operationId: newOperationId(), record })));
  loaded = await save(api, loaded, [{ kind: 'edit', operationId: newOperationId(), attemptId: c1.attempt.id, changes: { plan: { ...c1.attempt.plan, plannedYear: 2031, status: 'in_progress', contribution: { value: 0, source: 'learner', note: null } } } }, { kind: 'edit_payload', operationId: newOperationId(), recordId: todo.id, payload: { ...todo.payload, done: true } }]);
  const original = structuredClone(loaded.state.graph);
  loaded = await save(api, loaded, [remove(c1.attempt), remove(c2.attempt)]);
  api = controller(store); loaded = await api.load(); const tickets = loaded.state.graph.removals;
  await assert.rejects(api.prepareEdits(loaded, [undo(tickets[0])]), /undo_order/);
  loaded = await save(api, loaded, [undo(tickets[1]), undo(tickets[0])]); assert.deepEqual(loaded.state.graph, original);
  loaded = await save(api, loaded, [{ kind: 'delete_todo', operationId: newOperationId(), recordId: todo.id }]);
  api = controller(store); loaded = await api.load();
  assert.ok(loaded.state.history.usedTodoIds.includes(todo.payload.id)); assert.ok(store.snapshot().issuedIds.includes(todo.payload.id));
  await assert.rejects(api.prepareEdits(loaded, [{ kind: 'add_record', operationId: newOperationId(), record: { ...todo, id: newRecordId() } }]), /historical_id_reused/);
});

for (const [name, change] of Object.entries({
  origin: s => s.source.origin = 'local-v22', version: s => s.source.initializationVersion = 2,
  cv: s => s.source.curriculumVersionId = 'unknown', revision: s => s.source.sourceRevisionId += '-new',
  digest: s => s.source.masterSha256 = '0'.repeat(64), missing: s => delete s.source.sourceDigest,
  legacy: s => s.source.raw = '{"schemaVersion":22}', retained: s => s.retained.applicability = 'confirmed',
  quantity: s => s.retained.importedCourseAchievements.push({ earnedCreditsTotal: 12 }),
  receipts: s => s.history.commands = [], order: s => s.history.commands.reverse(),
  graph: s => s.graph.attempts[0].originalTitle = 'altered', ids: s => s.history.issuedIds.pop(),
  duplicate: s => s.history.commands.push(s.history.commands[0]),
  undo: s => s.graph.removals[0].previousPosition = 99,
  todo: s => s.history.usedTodoIds.push(crypto.randomUUID()),
})) test(`new origin/replay rejects ${name}`, async () => {
  const { api, loaded } = await start(), c = add(loaded);
  const p = await api.prepareEdits(loaded, [c, remove(c.attempt)]), state = structuredClone(p.handle.state); change(state);
  await assert.rejects(replayState(state));
});

test('schema23/new24 decoders refuse source confusion; backup3 can port only after explicit adoption', async () => {
  let { api, loaded, store } = await start(); loaded = await save(api, loaded, [add(loaded)]);
  await assert.rejects(replayMigrationState(loaded.state));
  await assert.rejects(replayNewPlan({ ...loaded.state, schemaVersion: 23 }));
  const raw = await api.createBackup(loaded), backup = JSON.parse(raw); assert.equal(backup.backupVersion, 3);
  const target = memory(), portable = controller(target), p = await portable.inspectBackup(raw); assert.equal(target.writes, 0);
  await assert.rejects(commit(portable, p), /adoption/); await assert.rejects(portable.prepareEdits(p.handle, []), /unconfirmed_recovery/);
  await assert.rejects(commit(portable, p, true, { ...portableConsent(p), protectedBackupRaw: 'wrong' }), /adoption/);
  const restored = await commit(portable, p, true, portableConsent(p));
  assert.deepEqual(restored.state, loaded.state); assert.deepEqual((await controller(target).load()).workspace, loaded.workspace);
  // Reservations are a restriction set; host union insertion order is not portable authority.
  assert.deepEqual(new Set(target.snapshot().issuedIds), new Set(store.snapshot().issuedIds));
  const collision = controller(store); loaded = await collision.load();
  const altered = JSON.parse(raw); altered.state.history.commands[0].attempt.originalTitle = '別履歴'; altered.state.graph.attempts[0].originalTitle = '別履歴'; altered.state.verification.graphSha256 = await backupDigest(altered.state.graph);
  await assert.rejects(collision.inspectBackup(await rehash(altered)), /host_collision/);
});

for (const [name, change] of Object.entries({
  future: b => b.backupVersion = 99, oldEnvelope: b => b.backupVersion = 2,
  oldState: b => b.state.schemaVersion = 23, source: b => b.state.source.origin = 'migration',
  reservation: b => b.reservedIds.pop(), missing: b => delete b.state.history,
  modified: b => b.state.graph.attempts[0].plan.plannedYear = 2040,
})) test(`portable new backup rejects rehashed ${name}, preserves empty host`, async () => {
  const { api, loaded } = await start(), h = await save(api, loaded, [add(loaded)]), b = JSON.parse(await api.createBackup(h)); change(b);
  const target = memory(); await assert.rejects(controller(target).inspectBackup(await rehash(b))); assert.equal(target.writes, 0);
});

test('new plan replacement protects original and never shrinks permanent IDs; stale preview rejected', async () => {
  let { api, store, loaded } = await start(); const c = add(loaded); loaded = await save(api, loaded, [c]);
  const before = store.snapshot(), oldBackup = await api.createBackup(loaded), empty = await api.prepareNewPlan();
  assert.equal(empty.previousRaw, before.raw); assert.deepEqual(store.snapshot(), before);
  await assert.rejects(api.commit(empty, true, null, empty.sourceRaw), /protection/);
  const stale = await api.prepareEdits(loaded, []); loaded = await commit(api, empty);
  assert.equal(loaded.state.graph.attempts.length, 0); for (const id of before.issuedIds) assert.ok(store.snapshot().issuedIds.includes(id));
  await assert.rejects(commit(api, stale), /stale_commit/);
  await assert.rejects(api.prepareEdits(loaded, [c]), /historical_id_reused/);
  const p = await api.inspectBackup(oldBackup); loaded = await commit(api, p, true, portableConsent(p)); assert.equal(loaded.state.graph.attempts[0].id, c.attempt.id);
});

for (const failure of ['QuotaExceededError', 'transaction_aborted', 'SecurityError', 'lock']) test(`new commit ${failure} keeps old state and witness`, async () => {
  const { store, loaded } = await start(), api = failure === 'lock' ? createAttemptPersistence(store, undefined) : controller(store), h = await api.load();
  const p = await api.prepareEdits(h, [add(loaded)]), before = store.snapshot();
  if (failure !== 'lock') store.failure = failure;
  await assert.rejects(commit(api, p), failure === 'lock' ? /Web Locks/ : new RegExp(failure)); assert.deepEqual(store.snapshot(), before);
});

test('manual unknown identity/scope and contribution absent/null/zero are preserved without official credit fallback', async () => {
  const { api, loaded } = await start();
  const commands = [undefined, null, 0].map(value => {
    const plan = { ...input.plan, ...(value === undefined ? {} : { contribution: { value, source: 'learner', note: null } }) };
    const attempt = makeAttempt(loaded.source.context.catalog, { title: '未確定科目', courseId: null, placementId: null, plan, method: 'unknown', note: '' });
    return { kind: 'add', operationId: attempt.creationOperationId, attempt };
  });
  const h = await save(api, loaded, commands); assert.deepEqual(h.state.history.commands, commands);
  for (const a of h.state.graph.attempts) { assert.equal(a.identity.status, 'unknown'); assert.equal(a.applicability.scopeId, null); }
  assert.deepEqual(h.state.retained.importedCourseAchievements, []);
});
