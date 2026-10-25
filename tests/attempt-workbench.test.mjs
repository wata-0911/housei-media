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
import { validateAttemptPlanTransition } from '../src/planner/attempts/planTransition.ts';

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
test('Undo refuses an older deletion; reversing deletion order restores exact original positions', () => {
  const { workspace, context, a, b } = setup(); const da = remove(a), db = remove(b);
  let w = applyCommand(workspace, db, context); w = applyCommand(w, da, context);
  assert.throws(() => applyCommand(w, undo(b, db), context), /undo_order_conflict/);
  w = applyCommand(w, undo(a, da), context); w = applyCommand(w, undo(b, db), context);
  assert.deepEqual(w.graph, workspace.graph);
});
const undoScenarios = [
  [2, [0, 1]], [2, [1, 0]],
  [3, [0, 1, 2]], [3, [0, 2, 1]], [3, [1, 0, 2]],
  [3, [1, 2, 0]], [3, [2, 0, 1]], [3, [2, 1, 0]],
  [3, [0, 2]], [3, [2, 0]],
  [2, [0, 1], 1], [3, [2, 0, 1], 1], [3, [0, 1, 2], 2],
];
for (const [count, order, addAfter] of undoScenarios) test(`Undo stack: ${count} rows, delete ${order}, add after ${addAfter ?? 'none'}`, () => {
  const { graph, context, makeAttempt: fixtureAttempt } = attemptFixture();
  if (count === 3) graph.attempts.push(fixtureAttempt(2002));
  let w = createWorkspace(graph, context);
  const originals = graph.attempts, added = [];
  const activeIds = g => g.attempts.filter(a => a.membership.kind === 'active').map(a => a.id);
  const tickets = [], requests = new Map();
  for (const [index, row] of order.entries()) {
    const command = remove(originals[row]), before = w;
    w = applyCommand(w, command, context);
    assert.equal(validateAttemptPlanTransition(before.graph, w.graph, context, { kind: 'delete_plan', attemptId: command.attemptId, operationId: command.operationId }).valid, true);
    assert.deepEqual(w.graph.removals.slice(0, -1), tickets);
    tickets.push(structuredClone(w.graph.removals.at(-1)));
    assert.deepEqual(w.graph.ownedRecords, graph.ownedRecords);
    assert.deepEqual(w.receipts.slice(0, -1), before.receipts);
    if (addAfter === index + 1) {
      const next = created(context); added.push(next);
      w = applyCommand(w, add(next), context);
      assert.deepEqual(w.graph.removals, tickets);
      assert.equal(w.graph.ownedRecords.some(r => r.owner?.attemptId === next.id), false);
    }
  }
  if (count === 2 && order[0] === 0) assert.deepEqual(tickets.map(t => t.previousPosition), [0, 0]);
  while (w.graph.removals.length) {
    for (const ticket of w.graph.removals.slice(0, -1)) {
      const request = requests.get(ticket.operationId) ?? undo(ticket.attemptSnapshot, { operationId: ticket.operationId });
      requests.set(ticket.operationId, request);
      const untouched = structuredClone(w);
      assert.throws(() => applyCommand(w, request, context), /undo_order_conflict:.*最後に削除した履修回/);
      assert.deepEqual(w, untouched); // Failed requests consume neither receipt nor ticket.
    }
    const ticket = w.graph.removals.at(-1), before = w;
    const request = requests.get(ticket.operationId) ?? undo(ticket.attemptSnapshot, { operationId: ticket.operationId });
    requests.set(ticket.operationId, request);
    w = applyCommand(w, request, context);
    assert.equal(validateAttemptPlanTransition(before.graph, w.graph, context, { kind: 'undo_plan', attemptId: ticket.attemptSnapshot.id, operationId: ticket.operationId }).valid, true);
    assert.deepEqual(activeIds(before.graph), activeIds(w.graph).filter(id => id !== ticket.attemptSnapshot.id));
    assert.deepEqual(w.graph.removals, before.graph.removals.slice(0, -1));
    assert.deepEqual(w.graph.ownedRecords, graph.ownedRecords);
    assert.deepEqual(w.receipts, [...before.receipts, request]);
    assert.strictEqual(applyCommand(w, request, context), w);
  }
  assert.deepEqual(activeIds(w.graph), [...originals, ...added].map(a => a.id));
  assert.deepEqual(w.graph.attempts, [...originals, ...added]);
  // A successful Undo retry remains a no-op even after a new deletion of that row.
  const nextDeletion = remove(originals[0]); w = applyCommand(w, nextDeletion, context);
  for (const request of requests.values()) assert.strictEqual(applyCommand(w, request, context), w);
});
test('Undo fails closed when deletion receipt history is missing or ticket order is unproven', () => {
  const { workspace, context, a, b } = setup();
  const once = applyCommand(workspace, remove(a), context), twice = applyCommand(once, remove(b), context);
  const unproven = [createWorkspace(once.graph, context), createWorkspace(twice.graph, context),
    { ...twice, graph: { ...twice.graph, removals: [...twice.graph.removals].reverse() } }];
  for (const w of unproven) {
    const ticket = w.graph.removals.at(-1), untouched = structuredClone(w);
    assert.throws(() => applyCommand(w, undo(ticket.attemptSnapshot, { operationId: ticket.operationId }), context), /undo_history_unproven/);
    assert.deepEqual(w, untouched);
  }
});
test('multiple deletions retain detached owners and edited payloads through refused and reverse Undo', () => {
  const { workspace, context, a, b } = setup(), da = remove(a), db = remove(b);
  let w = applyCommand(applyCommand(workspace, da, context), db, context);
  const snapshots = structuredClone(w.graph.removals);
  for (const index of [0, 3, 4, 5]) {
    const r = w.graph.ownedRecords[index], payload = structuredClone(r.payload);
    if (r.kind === 'media') payload.lessons[0].testCompleted = true;
    if (r.kind === 'evaluation') payload.finalGrade = 'A';
    if (r.kind === 'todo') { payload.text += ' detached編集'; payload.done = !payload.done; }
    w = applyCommand(w, update(r, payload), context);
  }
  const records = structuredClone(w.graph.ownedRecords), before = structuredClone(w);
  assert.throws(() => applyCommand(w, undo(a, da), context), /undo_order_conflict/);
  assert.deepEqual(w, before); assert.deepEqual(w.graph.removals, snapshots);
  w = applyCommand(w, undo(b, db), context); w = applyCommand(w, undo(a, da), context);
  assert.deepEqual(w.graph.attempts, workspace.graph.attempts);
  assert.deepEqual(w.graph.ownedRecords, records);
  assert.deepEqual(w.graph.ownedRecords.map(r => r.owner), workspace.graph.ownedRecords.map(r => r.owner));
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

// Placement-search bridge: these tests cover the new conversion boundary, while
// the existing CRUD suite above remains the authority for generic owner/Undo rules.
const { loadCurrentCurriculumSearchAdapter } = await import('../src/planner/institutional/currentSearch.ts');
const { createInstitutionalSearchAdapter } = await import('../src/planner/institutional/search.ts');
const { CURRENT_CURRICULUM_SEARCH_TARGET } = await import('../src/planner/institutional/currentSearch.ts');
const { makeSearchAttempt } = await import('../src/planner/attempts/workbench/searchBridge.ts');
const { loadYi01InstitutionalCatalog } = await import('../src/planner/institutional/yi01.ts');
const searchMaster = loadYi01InstitutionalCatalog();
const searchRows = loadCurrentCurriculumSearchAdapter().search({ scope: { kind: 'all' } }).rows;
const searchInput = () => ({ plan: { ...plan(), plannedYear: null, plannedTerm: null }, method: 'unknown', note: '' });
const byStatus = status => searchRows.find(r => r.placement.kind === 'course_placement' && r.placement.identityDecision.status === status);

for (const status of ['safe', 'ambiguous', 'conflict']) test(`search bridge: ${status} selection retains identity, candidates and revision-bound evidence without Offering`, () => {
  const row = byStatus(status), p = row.placement, input = searchInput();
  const a = makeSearchAttempt(searchMaster, row, input);
  const context = { catalog: searchMaster, officialAchievementIds: [], officialStudyRecordIds: [] };
  const w = applyCommand(createWorkspace(blank(), context), add(a), context);
  assert.equal(w.graph.attempts.length, 1); assert.deepEqual(w.graph.ownedRecords, []);
  assert.equal(a.identity.status, status === 'safe' ? 'confirmed' : status);
  assert.equal(a.identity.ref?.institutionalCourseId ?? null, row.institutionalCourse?.id ?? null);
  assert.deepEqual(a.identity.candidateAuditIds, p.candidateAuditIds);
  assert.deepEqual(a.placement.candidateAuditIds, p.candidateAuditIds);
  assert.deepEqual(a.placement.candidatePlacementIds, [p.id]); assert.equal(a.placement.ref, null);
  assert.equal(a.placement.status, status === 'safe' ? 'unknown' : status);
  assert.deepEqual(a.applicability, { status: 'unknown', curriculumVersionId: null, scopeId: null, legacyApplicability: 'unknown', originalValue: null, evidence: null });
  assert.equal(a.plan.plannedYear, null); assert.equal(a.method.value, 'unknown'); assert.ok(!Object.hasOwn(a.plan, 'contribution'));
  assert.equal(a.legacyRefs[0].oldId, p.identityDecision.oldId);
  assert.equal(a.legacyRefs[0].sourceRevisionId, row.sourceRevision.id);
  assert.equal(a.legacyRefs[0].sourceDigest, row.sourceRevision.sha256);
  assert.deepEqual(a.legacyRefs[0].legacyDigests, searchMaster.legacyDigests);
  // The exact revision + Mapping and Placement IDs recover the full evidence.
  const linked = searchMaster.placements.find(p => p.id === a.placement.candidatePlacementIds[0]);
  assert.deepEqual(linked, p); assert.deepEqual(searchMaster.curriculumVersions.find(v => v.id === linked.curriculumVersionId), row.curriculumVersion);
  assert.deepEqual(searchMaster.notes.filter(n => linked.noteIds.includes(n.evidenceId)), row.notes);
  assert.ok(!Object.hasOwn(a, 'selection')); assert.ok(!Object.hasOwn(a, 'compositionCredits'));
  assert.deepEqual(input, searchInput());
});

test('search bridge: inconsistent or stale UI row is rejected before Workspace changes', () => {
  const row = byStatus('ambiguous'), context = { catalog: searchMaster, officialAchievementIds: [], officialStudyRecordIds: [] };
  const w = createWorkspace(blank(), context), before = structuredClone(w);
  const changes = [
    r => { r.placement.id = 'missing'; },
    r => { r.placement.scopeId = searchMaster.scopes.find(s => s.id !== r.placement.scopeId).id; },
    r => { r.scope = searchMaster.scopes.find(s => s.id !== r.scope.id); },
    r => { r.placement.curriculumVersionId = 'other-cv'; },
    r => { r.curriculumVersion.id = 'other-cv'; },
    r => { r.sourceRevision.sha256 = 'changed'; },
    r => { r.placement.sourceRevisionId = 'changed'; },
    r => { r.placement.institutionalCourseId = byStatus('safe').institutionalCourse.id; },
    r => { r.institutionalCourse = byStatus('safe').institutionalCourse; },
    r => { r.placement.identityDecision.status = 'safe'; },
    r => { r.placement.candidateAuditIds = []; },
    r => { r.placement.identityDecision.candidateAuditIds = []; },
    r => { r.placement.placementRoleKey = 'changed'; },
    r => { r.placement.compositionCredits = 0; },
    r => { r.notes = []; },
    r => { r.placement.methodConstraint.status = 'conflict'; },
    r => { r.codeEvidence.status = 'changed'; },
  ];
  for (const mutate of changes) {
    const changed = structuredClone(row); mutate(changed);
    assert.throws(() => applyCommand(w, add(makeSearchAttempt(searchMaster, changed, searchInput())), context), /search_selection_mismatch/);
    assert.deepEqual(w, before);
  }
  const other = structuredClone(searchMaster); other.sourceRevision.sha256 = 'changed';
  assert.throws(() => makeSearchAttempt(other, row, searchInput()), /search_selection_mismatch/);
  const safe = structuredClone(byStatus('safe')); safe.institutionalCourse = searchRows.find(r => r.institutionalCourse && r.institutionalCourse.id !== safe.institutionalCourse.id).institutionalCourse;
  assert.throws(() => makeSearchAttempt(searchMaster, safe, searchInput()), /search_selection_mismatch/);
});

test('search bridge: non-course buckets cannot become ordinary attempts, even after kind tampering', () => {
  const rows = searchRows.filter(r => r.placement.kind === 'non_course_bucket'); assert.equal(rows.length, 9);
  for (const row of rows) {
    assert.throws(() => makeSearchAttempt(searchMaster, row, searchInput()), /non_course_bucket/);
    const forged = structuredClone(row); forged.placement.kind = 'course_placement';
    assert.throws(() => makeSearchAttempt(searchMaster, forged, searchInput()), /search_selection_mismatch/);
  }
});

test('search bridge: deliberate identical additions are independent; fixed retry and changed replay use existing receipts', () => {
  const row = byStatus('ambiguous'), context = { catalog: searchMaster, officialAchievementIds: [], officialStudyRecordIds: [] };
  const a = makeSearchAttempt(searchMaster, row, searchInput()), b = makeSearchAttempt(searchMaster, row, searchInput());
  assert.notEqual(a.id, b.id); assert.notEqual(a.creationOperationId, b.creationOperationId);
  let w = createWorkspace(blank(), context); const request = add(a);
  w = applyCommand(w, request, context); assert.strictEqual(applyCommand(w, request, context), w);
  w = applyCommand(w, add(b), context); assert.equal(w.graph.attempts.length, 2);
  assert.throws(() => applyCommand(w, { ...request, attempt: { ...a, plan: { ...a.plan, plannedYear: 2031 } } }, context), /operation_replay_conflict/);
  assert.deepEqual(w.graph.ownedRecords, []);
});

test('search bridge: edit, delete and Undo retain selected refs and existing progress/evaluation/TODO owners', () => {
  const context = { catalog: searchMaster, officialAchievementIds: [], officialStudyRecordIds: [] };
  const old = created(context);
  const records = setup().workspace.graph.ownedRecords.filter(r => r.owner?.attemptId === setup().a.id).map(r => ({ ...structuredClone(r), owner: { kind: 'attempt', attemptId: old.id } }));
  const workspace = createWorkspace({ attempts: [old], ownedRecords: records, removals: [] }, context);
  const a = makeSearchAttempt(context.catalog, byStatus('conflict'), searchInput());
  let w = applyCommand(workspace, add(a), context);
  assert.deepEqual(w.graph.ownedRecords, workspace.graph.ownedRecords);
  w = applyCommand(w, edit(a, { plan: { ...a.plan, plannedYear: 2033 } }), context);
  const edited = w.graph.attempts.find(x => x.id === a.id), deletion = remove(a);
  w = applyCommand(w, deletion, context); w = applyCommand(w, undo(a, deletion), context);
  assert.deepEqual(w.graph.attempts.find(x => x.id === a.id), edited);
  assert.deepEqual(w.graph.ownedRecords, workspace.graph.ownedRecords);
});

test('search bridge: null/0 composition and absent/null/0 learner contribution remain separate', () => {
  for (const composition of [null, 0]) {
    const master = structuredClone(searchMaster), id = byStatus('ambiguous').placement.id;
    master.placements.find(p => p.id === id).compositionCredits = composition;
    const row = createInstitutionalSearchAdapter(master, CURRENT_CURRICULUM_SEARCH_TARGET).search({ scope: { kind: 'all' } }).rows.find(r => r.placement.id === id);
    for (const value of ['unset', null, 0]) {
      const input = searchInput(); if (value !== 'unset') input.plan.contribution = { value, source: 'learner', note: null };
      const a = makeSearchAttempt(master, row, input);
      assert.equal(Object.hasOwn(a.plan, 'contribution'), value !== 'unset');
      if (value !== 'unset') assert.equal(a.plan.contribution.value, value);
      assert.equal(master.placements.find(p => p.id === a.placement.candidatePlacementIds[0]).compositionCredits, composition);
    }
  }
});

test('search bridge: bad year/method/status and negative contribution fail before registration', () => {
  for (const mutate of [i => { i.plan.plannedYear = 22; }, i => { i.method = 'invented'; },
    i => { i.plan.status = 'invented'; }, i => { i.plan.contribution = { value: -1, source: 'learner', note: null }; }]) {
    const input = searchInput(); mutate(input);
    assert.throws(() => makeSearchAttempt(searchMaster, byStatus('safe'), input));
  }
});

test('search bridge: multiple audited candidates are retained without choosing the first', () => {
  const master = structuredClone(searchMaster), p = master.placements.find(p => p.id === byStatus('ambiguous').placement.id);
  const other = master.curriculumAudit.find(c => !p.candidateAuditIds.includes(c.oldCurriculumCourseId)).oldCurriculumCourseId;
  p.candidateAuditIds = [...p.candidateAuditIds, other]; p.identityDecision.candidateAuditIds = [...p.candidateAuditIds];
  const row = createInstitutionalSearchAdapter(master, CURRENT_CURRICULUM_SEARCH_TARGET).search({ scope: { kind: 'all' } }).rows.find(r => r.placement.id === p.id);
  const a = makeSearchAttempt(master, row, searchInput());
  assert.equal(a.identity.status, 'ambiguous'); assert.equal(a.identity.ref, null);
  assert.deepEqual(a.identity.candidateAuditIds, p.candidateAuditIds); assert.equal(a.identity.candidateAuditIds.length, 2);
  assert.deepEqual(a.placement.candidateAuditIds, p.candidateAuditIds);
});

test('search bridge UI stays opt-in; the shared YI-06 form keeps its legacy selection path', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AttemptForm } = await import('../dev/attempts/AttemptForm.tsx');
  const context = { catalog: searchMaster, officialAchievementIds: [], officialStudyRecordIds: [] };
  const render = props => renderToStaticMarkup(createElement(AttemptForm, { context, submit: () => true, close: () => {}, ...props }));
  assert.match(render({}), /Placement候補/); assert.doesNotMatch(render({}), /Placement検索結果/);
  assert.match(render({ searchEnabled: true }), /Placement検索結果/); assert.doesNotMatch(render({ searchEnabled: true }), /Placement候補/);
});
