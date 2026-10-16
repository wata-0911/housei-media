import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attemptFixture, operationId, recordId, legacyRef } from './fixtures/attempt-fixture.mjs';
import { applyCommand, createWorkspace, newAttemptIds, newOperationId, newRecordId } from '../src/planner/attempts/workbench/operations.ts';
import { makeAttempt, selectedReferences, contributionLabel, attemptView, optionalNumber, courseChoices, placementChoices } from '../src/planner/attempts/workbench/catalogView.ts';
import { createMigrationWorkbench, heldDates } from '../src/planner/attempts/workbench/migrationSession.ts';
import { attemptWorkbenchEnabled } from '../dev/attempts/gate.ts';
import { nullableText } from '../dev/attempts/formHelpers.ts';
import { env, catalog, mixed, media } from './fixtures/migration-fixture.mjs';
import { verifyMigrationPreservation } from '../src/planner/attempts/migration/preview.ts';

const blank = () => ({ attempts: [], ownedRecords: [], removals: [] });
const plan = () => ({ status: 'planned', plannedYear: 2030, plannedTerm: '本人希望', studyYear: null, earnedOrder: null });
function setup() { const { graph, context } = attemptFixture(); return { context, workspace: createWorkspace(graph, context), a: graph.attempts[0], b: graph.attempts[1] }; }
function created(context, extra = {}) { return makeAttempt(context.catalog, { title: '独立した同名科目', courseId: null, placementId: null, plan: plan(), method: 'media', note: '本人希望', ...extra }); }
const add = attempt => ({ kind: 'add', operationId: attempt.creationOperationId, attempt });
const edit = (a, changes) => ({ kind: 'edit', operationId: newOperationId(), attemptId: a.id, changes });
const remove = a => ({ kind: 'remove', operationId: newOperationId(), attemptId: a.id });
const undo = (a, deletion) => ({ kind: 'undo', operationId: newOperationId(), attemptId: a.id, removalOperationId: deletion.operationId });
const update = (record, payload) => ({ kind: 'edit_payload', operationId: newOperationId(), recordId: record.id, payload });

test('CRUD: independent UUIDv4 allocation and deliberate identical course/year/method additions', () => {
  const { context } = setup(); let w = createWorkspace(blank(), context);
  const first = created(context), second = created(context);
  assert.notEqual(first.id, second.id); assert.notEqual(first.creationOperationId, second.creationOperationId);
  assert.match(first.id, /^hosei:attempt:[\da-f-]{14}4/);
  w = applyCommand(w, add(first), context); w = applyCommand(w, add(second), context);
  assert.equal(w.graph.attempts.length, 2); assert.equal(w.graph.ownedRecords.length, 0);
});
test('CRUD: fixed request retry after later edit/delete is no-op; changed retry rejects', () => {
  const { context } = setup(); const a = created(context), request = add(a);
  let w = applyCommand(createWorkspace(blank(), context), request, context);
  w = applyCommand(w, edit(a, { plan: { ...a.plan, plannedYear: 2040 } }), context);
  w = applyCommand(w, remove(a), context);
  assert.strictEqual(applyCommand(w, request, context), w);
  assert.throws(() => applyCommand(w, { ...request, attempt: { ...a, originalTitle: 'changed' } }, context), /replay_conflict/);
});
test('CRUD: same institutional identity, year, method and old Offering may be separate attempts', () => {
  const { workspace, context, a } = setup();
  const next = { ...structuredClone(a), ...newAttemptIds(), actualYear: { value: null, source: 'unknown', evidence: null, reason: null } };
  const w = applyCommand(workspace, add(next), context);
  assert.equal(w.graph.attempts.length, 3); assert.deepEqual(w.graph.ownedRecords, workspace.graph.ownedRecords);
});
test('CRUD: edits retain actual year, legacy/official context, other Attempt and all owner payloads', () => {
  const { workspace, context, a, b } = setup();
  const w = applyCommand(workspace, edit(a, { plan: { ...a.plan, plannedYear: 2099, status: 'failed', contribution: { value: 0, source: 'learner', note: null } } }), context);
  assert.equal(w.graph.attempts[0].id, a.id); assert.deepEqual(w.graph.attempts[0].actualYear, a.actualYear);
  assert.deepEqual(w.graph.attempts[1], b); assert.deepEqual(w.graph.ownedRecords, workspace.graph.ownedRecords);
  assert.equal(w.graph.attempts[0].plan.earnedOrder, null);
});
for (const [name, changes] of [
  ['Attempt ID', { id: 'bad' }], ['creation operation', { creationOperationId: 'bad' }], ['membership', { membership: { kind: 'active' } }],
  ['actual year', { actualYear: { value: 2030 } }], ['negative quantity', { plan: { ...plan(), contribution: { value: -1, source: 'learner', note: null } } }],
  ['bad year', { plan: { ...plan(), plannedYear: 22 } }], ['fractional study year', { plan: { ...plan(), studyYear: 1.5 } }],
  ['bad status', { plan: { ...plan(), status: 'passed' } }], ['invented earned order', { plan: { ...plan(), earnedOrder: 0 } }],
  ['unknown identity', { identity: { status: 'confirmed', ref: { institutionalCourseId: 'missing' }, candidateAuditIds: [], reason: null } }],
  ['official method promotion', { method: { value: 'media', source: 'official_detail', evidence: { kind: 'official_detail', studyRecordId: 'official-detail' } } }],
  ['official link', { plan: { ...plan(), importedSourceCourseId: 'official-aggregate' } }],
]) test(`CRUD refuses ${name} without mutation`, () => {
  const { workspace, context, a } = setup(); const before = structuredClone(workspace);
  assert.throws(() => applyCommand(workspace, edit(a, changes), context)); assert.deepEqual(workspace, before);
});
for (const value of ['unset', null, 0, 2]) test(`view: contribution ${value} remains distinct`, () => {
  const { workspace, context, a } = setup(); const p = { ...a.plan }; delete p.contribution;
  if (value !== 'unset') p.contribution = { value, source: 'learner', note: null };
  const result = applyCommand(workspace, edit(a, { plan: p }), context).graph.attempts[0];
  assert.equal(contributionLabel(result), value === 'unset' ? '未設定' : value === null ? '不明 (null)' : `${value}単位`);
});
test('references: master search and candidate Placement need no Offering; unknown is never resolved', () => {
  const { context } = setup(); const course = context.catalog.institutionalCourses[0];
  assert.ok(courseChoices(context.catalog, course.officialName).length);
  const p = placementChoices(context.catalog, course.id)[0];
  const refs = selectedReferences(context.catalog, course.id, p.id);
  assert.equal(refs.identity.status, 'confirmed'); assert.equal(refs.placement.ref, null); assert.deepEqual(refs.placement.candidatePlacementIds, [p.id]);
  const a = created(context); assert.equal(a.identity.status, 'unknown'); assert.equal(a.actualYear.source, 'unknown');
  assert.equal(a.plan.plannedYear, 2030); assert.deepEqual(a.legacyRefs, []);
  assert.throws(() => selectedReferences(context.catalog, 'missing', null));
});
for (const status of ['unknown', 'ambiguous', 'conflict', 'unmatched']) test(`view preserves ${status}`, () => {
  const { workspace, context, a } = setup(); const candidate = created(context);
  candidate.identity.status = status;
  assert.equal(attemptView(candidate, workspace.graph, context.catalog).attempt.identity.status, status);
  assert.equal(attemptView(a, workspace.graph, context.catalog).records.length, 4);
});
test('delete and Undo retain original active position, ID, snapshots, every owner/payload and unrelated order', () => {
  const { workspace, context, a } = setup(); const deletion = remove(a);
  const deleted = applyCommand(workspace, deletion, context);
  assert.equal(deleted.graph.attempts[0].membership.kind, 'detached'); assert.equal(deleted.graph.removals[0].previousPosition, 0);
  assert.deepEqual(deleted.graph.removals[0].attemptSnapshot, a); assert.deepEqual(deleted.graph.ownedRecords, workspace.graph.ownedRecords);
  assert.strictEqual(applyCommand(deleted, deletion, context), deleted);
  const request = undo(a, deletion), restored = applyCommand(deleted, request, context);
  assert.deepEqual(restored.graph, workspace.graph); assert.strictEqual(applyCommand(restored, request, context), restored);
});
test('Undo conflicts refuse clamping; restoring later deletions allows exact original position', () => {
  const { workspace, context, a, b } = setup(); const da = remove(a), db = remove(b);
  let w = applyCommand(workspace, db, context); w = applyCommand(w, da, context);
  assert.throws(() => applyCommand(w, undo(b, db), context), /undo_position_conflict/);
  w = applyCommand(w, undo(a, da), context); w = applyCommand(w, undo(b, db), context);
  assert.deepEqual(w.graph, workspace.graph);
});
test('detached plan edit is refused; new enrollment has fresh ID/no copied records', () => {
  const { workspace, context, a } = setup(); let w = applyCommand(workspace, remove(a), context);
  assert.throws(() => applyCommand(w, edit(a, { plan: plan() }), context), /restore_before_edit/);
  const next = created(context); w = applyCommand(w, add(next), context);
  assert.equal(w.graph.ownedRecords.filter(r => r.owner?.attemptId === next.id).length, 0);
});
test('progress: media and correspondence coexist; edit never moves owner or synchronizes status/evaluation', () => {
  const { workspace, context } = setup(); const record = workspace.graph.ownedRecords[0];
  const payload = structuredClone(record.payload); payload.lessons[0].testCompleted = true;
  const w = applyCommand(workspace, update(record, payload), context);
  assert.deepEqual(w.graph.attempts, workspace.graph.attempts); assert.deepEqual(w.graph.ownedRecords.slice(1), workspace.graph.ownedRecords.slice(1));
  assert.deepEqual(w.graph.ownedRecords[0].owner, record.owner);
});
for (const [name, index, patch] of [
  ['negative media count', 0, { totalLessons: -1 }], ['shrunk lesson count', 0, { totalLessons: 0 }], ['fractional count', 0, { totalLessons: 1.5 }],
  ['lost lesson', 0, { lessons: [] }], ['lost assessment', 0, { assessments: [] }], ['lost report', 2, { reports: [] }],
  ['invalid exam grade', 2, { examGrade: 'F' }], ['invalid evaluation', 3, { finalGrade: 'F' }],
  ['bad report status/grade', 2, { reports: [{ reportNumber: 1, status: 'submitted', grade: 'A' }] }],
  ['invalid calendar', 0, { assessments: [{ id: 'old-assessment-A', type: 'other', label: 'bad', scheduledDate: '2027-02-30', completed: false }] }],
]) test(`progress rejects ${name} preserving original`, () => {
  const { workspace, context } = setup(), record = workspace.graph.ownedRecords[index];
  assert.throws(() => applyCommand(workspace, update(record, { ...record.payload, ...patch }), context));
  assert.deepEqual(workspace.graph.ownedRecords[index], record);
});
test('progress shrinking required reports preserves extras; null/zero and batch status remain explicit', () => {
  const { workspace, context } = setup(), r = workspace.graph.ownedRecords[2];
  const next = applyCommand(workspace, update(r, { ...r.payload, requiredReports: 0, calligraphyBatchStatus: 'passed' }), context);
  assert.equal(next.graph.ownedRecords[2].payload.reports.length, 1); assert.equal(next.graph.ownedRecords[2].payload.requiredReports, 0);
  const p = structuredClone(r.payload); delete p.calligraphyBatchStatus;
  assert.throws(() => applyCommand(workspace, update(r, p), context), /progress_field_lost/);
});
test('detached owner progress edits are explicit and preserved by Undo', () => {
  const { workspace, context, a } = setup(), deletion = remove(a); let w = applyCommand(workspace, deletion, context);
  const r = w.graph.ownedRecords[3]; w = applyCommand(w, update(r, { ...r.payload, finalGrade: 'A' }), context);
  w = applyCommand(w, undo(a, deletion), context); assert.equal(w.graph.ownedRecords[3].payload.finalGrade, 'A');
});
test('TODO CRUD supports no owner/legacy/Attempt; payload edit cannot reassign or change TODO ID', () => {
  const { workspace, context, a } = setup();
  const r = { id: newRecordId(), kind: 'todo', owner: null, payload: { id: crypto.randomUUID(), text: 'new', done: false } };
  let w = applyCommand(workspace, { kind: 'add_record', operationId: newOperationId(), record: r }, context);
  w = applyCommand(w, update(r, { ...r.payload, text: 'edited', done: true }), context);
  const legacy = { kind: 'unresolved_legacy', ref: legacyRef(context.catalog), reason: '明示選択' };
  const ownerChange = { kind: 'assign_todo', operationId: newOperationId(), recordId: r.id, expectedOwner: null, owner: legacy };
  w = applyCommand(w, ownerChange, context); assert.strictEqual(applyCommand(w, ownerChange, context), w);
  assert.throws(() => applyCommand(w, { ...ownerChange, operationId: newOperationId() }, context), /stale_owner/);
  w = applyCommand(w, { ...ownerChange, operationId: newOperationId(), expectedOwner: legacy, owner: { kind: 'attempt', attemptId: a.id } }, context);
  assert.throws(() => applyCommand(w, update(r, { ...r.payload, id: 'different' }), context), /todo_id_immutable/);
  assert.throws(() => applyCommand(w, { ...update(r, r.payload), owner: null }, context), /unknown_operation_field/);
  const del = { kind: 'delete_todo', operationId: newOperationId(), recordId: r.id };
  w = applyCommand(w, del, context); assert.strictEqual(applyCommand(w, del, context), w);
  assert.throws(() => applyCommand(w, { kind: 'add_record', operationId: newOperationId(), record: r }, context), /record_id_reused/);
  assert.throws(() => applyCommand(w, { kind: 'add_record', operationId: newOperationId(), record: { ...r, id: newRecordId() } }, context), /todo_id_reused/);
});
test('owner safety: unknown owner, duplicate payload/TODO ID, progress owner change/delete all rejected', () => {
  const { workspace, context, b } = setup(); const record = workspace.graph.ownedRecords[0];
  for (const cmd of [
    { kind: 'assign_todo', recordId: record.id, owner: { kind: 'attempt', attemptId: b.id }, expectedOwner: record.owner },
    { kind: 'delete_todo', recordId: record.id },
    { kind: 'add_record', record: { ...record, id: newRecordId() } },
    { kind: 'add_record', record: { ...workspace.graph.ownedRecords[4], id: newRecordId() } },
    { kind: 'add_record', record: { ...record, id: newRecordId(), owner: { kind: 'attempt', attemptId: newAttemptIds().id } } },
  ]) assert.throws(() => applyCommand(workspace, { ...cmd, operationId: newOperationId() }, context));
});
test('operation ID collisions, unknown fields and invalid ID rejected; inputs and receipts frozen', () => {
  const { workspace, context, a } = setup();
  assert.throws(() => applyCommand(workspace, { ...edit(a, {}), operationId: a.creationOperationId }, context), /operation_collision/);
  assert.throws(() => applyCommand(workspace, { ...edit(a, {}), operationId: 'bad' }, context));
  assert.throws(() => applyCommand(workspace, { ...edit(a, {}), bad: true }, context));
  assert.ok(Object.isFrozen(workspace.graph.attempts[0]));
  assert.notEqual(operationId(1), recordId(1));
});
for (const input of ['-1', '1e3', 'NaN', ' 2', '2x', 'Infinity', '-0']) test(`number parser rejects raw ${input}`, () => assert.throws(() => optionalNumber(input)));
test('form parsers preserve null, empty text, zero and fraction; domain validates field-specific limits', () => {
  assert.equal(optionalNumber(''), null); assert.equal(optionalNumber('0'), 0); assert.equal(optionalNumber('1.5'), 1.5);
  const data = new FormData(); data.set('note', '');
  assert.equal(nullableText(data, 'note', ''), ''); assert.equal(nullableText(data, 'note', null), null);
  assert.equal(nullableText(data, 'note', 'cleared'), null); assert.equal(nullableText(data, 'note'), null);
  data.set('note', 'new'); assert.equal(nullableText(data, 'note', ''), 'new');
});
for (const args of [['serve', 'development', undefined], ['serve', 'development', 'true'], ['build', 'development', '1'], ['build', 'production', '1'], ['serve', 'production', '1'], ['serve', 'development', '1', 'production']]) test(`flag rejects ${args}`, () => assert.equal(attemptWorkbenchEnabled(...args), false));
test('flag only enables explicit dev/test serve', () => { assert.equal(attemptWorkbenchEnabled('serve', 'development', '1'), true); assert.equal(attemptWorkbenchEnabled('serve', 'test', '1'), true); });

test('migration: repeated and concurrent inspections reuse source/table; CRUD is a separate contract', async () => {
  const workbench = createMigrationWorkbench(env, catalog), raw = JSON.stringify(mixed());
  const [a, b] = await Promise.all([workbench.inspect(raw), workbench.inspect(raw)]);
  assert.strictEqual(a, b); assert.equal(a.preview.status, 'ready'); assert.deepEqual(workbench.repeat(a), a.preview);
  let w = createWorkspace(a.preview.target.graph, a.decoded.source.context);
  const at = w.graph.attempts[0]; w = applyCommand(w, edit(at, { plan: { ...at.plan, plannedYear: 2040 } }), a.decoded.source.context);
  assert.equal(w.graph.attempts[0].plan.plannedYear, 2040);
  assert.notEqual(verifyMigrationPreservation(a.decoded.source, a.table, { ...a.preview.target, graph: w.graph }).status, 'ready');
  assert.equal(workbench.repeat(a).status, 'ready'); assert.equal(w.graph.attempts[0].plan.plannedYear, 2040);
});
for (const date of ['2027-02-30', '2027-99-99']) for (const replacement of ['2027-02-28', '2028-02-29', null]) test(`held ${date} -> explicit ${replacement} preserves source/other fields, new binding and IDs`, async () => {
  const service = createMigrationWorkbench(env, catalog), source = mixed(); source.mediaSchoolingProgress[media.id].assessments[0].scheduledDate = date;
  const raw = JSON.stringify(source), original = await service.inspect(raw); assert.equal(original.preview.status, 'held');
  const held = heldDates(original)[0]; assert.equal(held.date, date); assert.equal(held.offeringId, media.id);
  const proposal = service.proposeDate(original, held.offeringId, held.assessmentId, replacement);
  assert.equal(original.raw, raw); assert.equal(service.repeat(original).status, 'held');
  await assert.rejects(service.confirmDate(proposal, false), /explicit_confirmation/);
  await assert.rejects(service.confirmDate(structuredClone(proposal), true), /explicit_confirmation/);
  const corrected = await service.confirmDate(proposal, true); assert.equal(corrected.preview.status, 'ready');
  const expected = structuredClone(source); expected.mediaSchoolingProgress[media.id].assessments[0].scheduledDate = replacement;
  assert.deepEqual(corrected.decoded.source.state, expected); assert.equal(original.raw, raw);
  assert.notEqual(original.table.binding.rawSha256, corrected.table.binding.rawSha256);
  assert.notDeepEqual(original.table.attempts.map(a => a.attemptId), corrected.table.attempts.map(a => a.attemptId));
  assert.strictEqual(await service.confirmDate(proposal, true), corrected);
});
test('held: invalid correction refused; remaining invalid date keeps entire new source held', async () => {
  const service = createMigrationWorkbench(env, catalog), source = mixed(); const assessment = source.mediaSchoolingProgress[media.id].assessments[0];
  assessment.scheduledDate = '2027-02-30'; source.mediaSchoolingProgress[media.id].assessments.push({ ...assessment, id: 'second', scheduledDate: '2027-99-99' });
  const original = await service.inspect(JSON.stringify(source));
  assert.throws(() => service.proposeDate(original, media.id, assessment.id, '2027-99-99'), /assessment_date/);
  const corrected = await service.confirmDate(service.proposeDate(original, media.id, assessment.id, '2028-02-29'), true);
  assert.equal(corrected.preview.status, 'held'); assert.equal(heldDates(corrected).length, 1);
});
test('rejected input is preserved, never receives assignments or a ready graph', async () => {
  const service = createMigrationWorkbench(env, catalog); const session = await service.inspect('{"schemaVersion":999}');
  assert.equal(session.decoded.status, 'rejected'); assert.equal(session.table, null); assert.equal(session.preview, null);
  assert.equal(session.raw, '{"schemaVersion":999}'); assert.equal(service.repeat(session), null);
});
test('safety: no storage, legacy projection or preservation verification in CRUD/UI consumer', () => {
  for (const p of ['src/planner/attempts/workbench/operations.ts', 'src/planner/attempts/workbench/migrationSession.ts', 'dev/attempts/Workbench.tsx', 'dev/attempts/MigrationPanel.tsx']) {
    const text = readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /localStorage|sessionStorage|savePlannerState|createPlannerBackup|projectLegacyState|verifyMigrationPreservation/);
  }
});
