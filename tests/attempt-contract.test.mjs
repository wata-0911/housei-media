import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateAttemptGraph } from '../src/planner/attempts/validation.ts';
import { validateAttemptPlanTransition } from '../src/planner/attempts/planTransition.ts';
import { attemptFixture, deletedFixture, unresolved, legacyRef, uuid, attemptId, operationId, recordId } from './fixtures/attempt-fixture.mjs';
import { loadYi01InstitutionalCatalog } from '../src/planner/institutional/yi01.ts';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { initialState } from '../src/planner/backup/storage.ts';
import { validateState } from '../src/planner/validation.ts';
import { isMediaSchooling } from '../src/planner/progress/mediaSchooling.ts';

const check = (graph, context) => validateAttemptGraph(graph, context);
const valid = (graph, context) => assert.deepEqual(check(graph, context), { valid: true, issues: [] });
const rejects = (graph, context, code) => {
  const result = check(graph, context);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(e => e.code === code), JSON.stringify(result.issues));
};
const freeze = value => {
  if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
  return value;
};

test('attempt: same course, year, method and Offering permits independent Attempts and owners', () => {
  const { graph, context } = attemptFixture(); valid(graph, context);
  assert.notEqual(graph.attempts[0].id, graph.attempts[1].id);
  assert.deepEqual(graph.attempts[0].identity, graph.attempts[1].identity);
  assert.equal(graph.ownedRecords[0].owner.attemptId, graph.attempts[0].id);
  assert.equal(graph.ownedRecords[1].owner.attemptId, graph.attempts[1].id);
  assert.deepEqual(graph.ownedRecords[1].payload.lessons, []);
});
for (const status of ['planned', 'in_progress', 'waiting', 'earned', 'failed', 'dropped']) test(`attempt: keeps ${status} independent of grades, method and earnedOrder`, () => {
  const { graph, context } = attemptFixture(); graph.attempts[0].plan.status = status;
  graph.attempts[0].plan.earnedOrder = 3;
  valid(graph, context); assert.equal(graph.attempts[0].plan.earnedOrder, 3);
  assert.equal(graph.ownedRecords[3].payload.finalGrade, null);
});
for (const status of ['unmatched', 'ambiguous', 'conflict', 'unknown']) test(`attempt: retains unresolved ${status} and unknown applicability without selecting candidates`, () => {
  const { graph, context } = attemptFixture();
  graph.attempts[0].identity = unresolved(status, context.catalog.curriculumAudit.map(r => r.oldCurriculumCourseId));
  graph.attempts[0].placement = { ...unresolved(status), candidatePlacementIds: context.catalog.placements.map(p => p.id) };
  valid(graph, context); assert.equal(graph.attempts[0].identity.ref, null); assert.equal(graph.attempts[0].applicability.curriculumVersionId, null);
});
test('attempt: confirmed course does not force a Placement or personal applicability', () => {
  const { graph, context } = attemptFixture(); graph.attempts[0].placement = { ...unresolved('ambiguous'), candidatePlacementIds: context.catalog.placements.slice(0, 2).map(p => p.id) };
  valid(graph, context);
});
test('attempt: documented Placement can remain confirmed while its master identity is unresolved', () => {
  const { graph, context } = attemptFixture();
  const real = loadYi01InstitutionalCatalog(); context.catalog = real; delete context.legacyArchive;
  const p = real.placements.find(p => p.kind === 'course_placement' && p.institutionalCourseId === null && p.auditRecord.placementStatus === 'safe');
  graph.attempts = [graph.attempts[0]]; graph.ownedRecords = [];
  const a = graph.attempts[0]; a.legacyRefs = []; a.identity = unresolved('ambiguous', p.candidateAuditIds);
  a.placement = { status: 'confirmed', ref: { placementId: p.id, curriculumVersionId: p.curriculumVersionId, scopeId: p.scopeId,
    sourceRevisionId: p.sourceRevisionId, evidenceIds: p.identityDecision.evidenceIds }, candidateAuditIds: [], candidatePlacementIds: [], reason: null };
  valid(graph, context); assert.equal(a.identity.ref, null);
});
test('attempt: 4 composition / manual contribution 2 stays partial data, no completion generated', () => {
  const { graph, context } = attemptFixture(); valid(graph, context);
  assert.equal(context.catalog.placements[0].compositionCredits, 4);
  assert.equal(graph.attempts[0].plan.contribution.value, 2);
  assert.ok(!('completedCredits' in graph.attempts[0].plan));
});
for (const value of [null, 0, 2]) test(`attempt: contribution ${value} is preserved without fallback`, () => {
  const { graph, context } = attemptFixture(); graph.attempts[0].plan.contribution.value = value;
  const before = structuredClone(graph); valid(graph, context); assert.deepEqual(graph, before);
});
test('attempt: missing contribution, null actualYear and null earnedOrder remain unset', () => {
  const { graph, context } = attemptFixture(); delete graph.attempts[0].plan.contribution;
  graph.attempts[0].actualYear = { value: null, source: 'unknown', evidence: null, reason: '不明' };
  valid(graph, context); assert.equal(Object.hasOwn(graph.attempts[0].plan, 'contribution'), false);
  assert.equal(graph.attempts[0].plan.earnedOrder, null); assert.equal(graph.attempts[0].actualYear.value, null);
});
test('attempt: planned 2027 / actual 2025, official detail and inferred year preserve independent provenance', () => {
  const { graph, context } = attemptFixture();
  for (const [source, evidence, reason] of [['source', { kind: 'official_detail', studyRecordId: 'official-detail' }, null],
    ['inferred', { kind: 'learner', note: '元の推定根拠' }, '推定の履歴']]) {
    graph.attempts[0].actualYear = { value: 2025, source, evidence, reason }; valid(graph, context);
    assert.equal(graph.attempts[0].plan.plannedYear, 2027);
  }
});
test('attempt: method provenance records learner, old reference, official detail and unknown independently', () => {
  const { graph, context } = attemptFixture();
  for (const method of [
    { value: 'schooling', source: 'legacy_reference', evidence: { kind: 'legacy', ref: graph.attempts[0].legacyRefs[0] } },
    { value: 'correspondence', source: 'official_detail', evidence: { kind: 'official_detail', studyRecordId: 'official-detail' } },
    { value: 'unknown', source: 'unknown', evidence: null },
  ]) { graph.attempts[0].method = method; valid(graph, context); assert.deepEqual(graph.attempts[0].method, method); }
});
test('attempt: legacy Offering alone never creates confirmed course or Placement', () => {
  const { graph, context } = attemptFixture(); const a = graph.attempts[0];
  a.identity = unresolved('unmatched'); a.placement = { ...unresolved('unmatched'), candidatePlacementIds: [] };
  const original = structuredClone(graph); valid(graph, context); assert.deepEqual(graph, original);
});
test('attempt: unknown legacy ID retained; a claim it is known is rejected', () => {
  const { graph, context } = attemptFixture(); graph.attempts[0].legacyRefs = [legacyRef(context.catalog, uuid(9999), 'Offering', 'unknown')];
  valid(graph, context); graph.attempts[0].legacyRefs[0].status = 'known'; graph.attempts[0].legacyRefs[0].reason = null;
  rejects(graph, context, 'unknown_legacy_id');
});
test('attempt: unverified known document slice and legacy applicability remain unverified', () => {
  const { graph, context } = attemptFixture(); const a = graph.attempts[0];
  a.applicability = { ...a.applicability, status: 'unverified', curriculumVersionId: a.placement.ref.curriculumVersionId,
    scopeId: a.placement.ref.scopeId, legacyApplicability: 'current_2026' };
  valid(graph, context); assert.equal(a.applicability.status, 'unverified');
  a.applicability.status = 'confirmed'; a.applicability.evidence = { sourceRevisionId: a.placement.ref.sourceRevisionId, evidenceIds: a.placement.ref.evidenceIds };
  rejects(graph, context, 'unreviewed_applicability');
});
test('attempt: Offering-free plans require no legacy archive', () => {
  const { graph, context } = attemptFixture(); graph.attempts.forEach(a => { a.legacyRefs = []; }); delete context.legacyArchive; valid(graph, context);
});
test('attempt: orphan owner holds progress without inventing a plan or status', () => {
  const { graph, context } = attemptFixture(); graph.attempts[0].membership = { kind: 'detached', reason: 'legacy_orphan', deletionOperationId: null };
  graph.attempts[0].plan = null; valid(graph, context);
  assert.equal(graph.ownedRecords[0].owner.attemptId, graph.attempts[0].id);
});
test('attempt: unresolved old progress and unowned TODO stay unchanged', () => {
  const { graph, context } = attemptFixture(); graph.ownedRecords = [graph.ownedRecords[0], graph.ownedRecords[4]];
  graph.ownedRecords[0].owner = { kind: 'unresolved_legacy', ref: legacyRef(context.catalog), reason: '対応不明' };
  graph.ownedRecords[1].owner = null; const before = structuredClone(graph); valid(graph, context); assert.deepEqual(graph, before);
});
test('attempt: explicit unknown legacy owner stays unresolved even with one same-course Attempt', () => {
  const { graph, context } = attemptFixture(); graph.ownedRecords = [graph.ownedRecords[0]];
  graph.ownedRecords[0].owner = { kind: 'unresolved_legacy', ref: legacyRef(context.catalog, uuid(9999), 'Offering', 'unknown'), reason: '未照合' };
  valid(graph, context); assert.equal(graph.ownedRecords[0].owner.kind, 'unresolved_legacy');
});
test('attempt: delete and Undo preserve original ID, both owners, TODOs and complete payloads', () => {
  const { graph, context } = attemptFixture(), { deleted, action } = deletedFixture(graph);
  valid(deleted, context);
  assert.deepEqual(validateAttemptPlanTransition(graph, deleted, context, action), { valid: true, issues: [] });
  assert.deepEqual(validateAttemptPlanTransition(deleted, graph, context, { ...action, kind: 'undo_plan' }), { valid: true, issues: [] });
  assert.deepEqual(deleted.ownedRecords, graph.ownedRecords);
});

const mutations = [
  ['duplicate_attempt_id', g => { g.attempts.push(structuredClone(g.attempts[0])); }],
  ['duplicate_creation_operation', g => { g.attempts[1].creationOperationId = g.attempts[0].creationOperationId; }],
  ['shape_pattern', g => { g.attempts[0].id = g.attempts[0].legacyRefs[0].oldId; }],
  ['shape_pattern', g => { g.attempts[0].id = `hosei:ic:${uuid(7777)}`; }],
  ['shape_pattern', g => { g.attempts[0].id = 'hosei:attempt:2027-course-0'; }],
  ['uuid_collision', g => { g.attempts[0].id = `hosei:attempt:${g.attempts[0].placement.ref.placementId.split(':').at(-1)}`; }],
  ['unknown_course', g => { g.attempts[0].identity.ref.institutionalCourseId = `hosei:ic:${uuid(9999)}`; }],
  ['unknown_placement', g => { g.attempts[0].placement.ref.placementId = `hosei:cp:${uuid(9999)}`; }],
  ['unknown_placement_context', g => { g.attempts[0].placement.ref.curriculumVersionId = `hosei:cv:${uuid(9999)}`; }],
  ['placement_context_mismatch', g => { g.attempts[0].placement.ref.scopeId = uuid(9999); }],
  ['source_revision_mismatch', g => { g.attempts[0].identity.ref.sourceRevisionId = 'future-unknown'; }],
  ['unknown_evidence', g => { g.attempts[0].identity.ref.evidenceIds = ['unverified']; }],
  ['shape_oneOf', g => { g.attempts[0].identity.status = 'ambiguous'; }],
  ['unknown_audit_candidate', g => { g.attempts[0].identity = unresolved('ambiguous', ['missing']); }],
  ['unknown_placement_candidate', g => { g.attempts[0].placement.candidatePlacementIds = [`hosei:cp:${uuid(9999)}`]; }],
  ['resolution_candidate_conflict', (g, c) => { g.attempts[0].identity.candidateAuditIds = [c.catalog.curriculumAudit[1].oldCurriculumCourseId]; }],
  ['resolution_candidate_conflict', (g, c) => { g.attempts[0].placement.candidatePlacementIds = [c.catalog.placements[1].id]; }],
  ['placement_identity_conflict', (g, c) => { g.attempts[0].identity.ref.institutionalCourseId = c.catalog.institutionalCourses[1].id; }],
  ['legacy_identity_conflict', (g, c) => { const p = c.catalog.placements[2]; g.attempts[0].identity.ref = { institutionalCourseId: p.institutionalCourseId, sourceRevisionId: p.sourceRevisionId, evidenceIds: [p.officialRow.evidenceId] }; g.attempts[0].placement = { ...unresolved(), candidatePlacementIds: [] }; }],
  ['legacy_placement_conflict', (g, c) => { const p = c.catalog.placements[1]; g.attempts[0].placement.ref = { placementId: p.id, curriculumVersionId: p.curriculumVersionId, scopeId: p.scopeId, sourceRevisionId: p.sourceRevisionId, evidenceIds: [p.officialRow.evidenceId] }; }],
  ['legacy_revision_mismatch', g => { g.attempts[0].legacyRefs[0].sourceDigest = '0'.repeat(64); }],
  ['legacy_revision_mismatch', g => { delete g.attempts[0].legacyRefs[0].legacyDigests['src/data/planner_catalog_2026.json']; }],
  ['legacy_namespace', g => { g.attempts[0].legacyRefs[0].oldId = `hosei:ic:${uuid(9999)}`; }],
  ['duplicate_legacy_ref', g => { g.attempts[0].legacyRefs.push(structuredClone(g.attempts[0].legacyRefs[0])); }],
  ['unknown_legacy_id', (_g, c) => { delete c.legacyArchive; }],
  ['unknown_applicability_ref', g => { g.attempts[0].applicability.curriculumVersionId = g.attempts[0].placement.ref.curriculumVersionId; }],
  ['unknown_applicability_context', g => { g.attempts[0].applicability.status = 'unverified'; }],
  ['active_without_plan', g => { g.attempts[0].plan = null; }],
  ['missing_removal', g => { g.attempts[0].membership = { kind: 'detached', reason: 'plan_deleted', deletionOperationId: operationId(9999) }; }],
  ['invalid_orphan', g => { g.attempts[0].membership = { kind: 'detached', reason: 'legacy_orphan', deletionOperationId: null }; }],
  ['unknown_official_achievement', g => { g.attempts[0].plan.importedSourceCourseId = 'missing'; }],
  ['unknown_official_detail', g => { g.attempts[0].method = { value: 'media', source: 'official_detail', evidence: { kind: 'official_detail', studyRecordId: 'missing' } }; }],
  ['method_provenance', g => { g.attempts[0].method.source = 'legacy_reference'; }],
  ['year_provenance', g => { g.attempts[0].actualYear.source = 'unknown'; }],
  ['year_provenance', g => { g.attempts[0].actualYear.source = 'source'; }],
  ['year_provenance', g => { g.attempts[0].actualYear.source = 'inferred'; }],
  ['duplicate_owned_record_id', g => { g.ownedRecords[1].id = g.ownedRecords[0].id; }],
  ['duplicate_owner_payload', g => { g.ownedRecords[1].owner = structuredClone(g.ownedRecords[0].owner); }],
  ['dangling_owner', g => { g.ownedRecords[0].owner.attemptId = attemptId(9999); }],
  ['duplicate_todo_id', g => { g.ownedRecords[5].payload.id = g.ownedRecords[4].payload.id; }],
  ['competing_legacy_owner', (g, c) => { g.ownedRecords[1].owner = { kind: 'unresolved_legacy', ref: legacyRef(c.catalog), reason: '未解決' }; }],
  ['legacy_owner_kind', (g, c) => { g.ownedRecords[0].owner = { kind: 'unresolved_legacy', ref: legacyRef(c.catalog, c.catalog.curriculumAudit[0].oldCurriculumCourseId, 'CurriculumCourse'), reason: '不正' }; }],
  ['duplicate_lesson', g => { g.ownedRecords[0].payload.lessons.push(structuredClone(g.ownedRecords[0].payload.lessons[0])); }],
  ['lesson_range', g => { g.ownedRecords[0].payload.totalLessons = 0; }],
  ['duplicate_assessment', g => { g.ownedRecords[0].payload.assessments.push(structuredClone(g.ownedRecords[0].payload.assessments[0])); }],
  ['assessment_date', g => { g.ownedRecords[0].payload.assessments[0].scheduledDate = '2027-02-30'; }],
  ['assessment_date', g => { g.ownedRecords[0].payload.assessments[0].scheduledDate = '2027-99-99'; }],
  ['duplicate_report', g => { g.ownedRecords[2].payload.reports.push(structuredClone(g.ownedRecords[2].payload.reports[0])); }],
  ['report_grade_status', g => { g.ownedRecords[2].payload.reports[0].status = 'grading'; }],
  ['shape_minimum', g => { g.attempts[0].plan.contribution.value = -1; }],
  ['shape_type', g => { g.attempts[0].plan.contribution.value = '2'; }],
  ['shape_minimum', g => { g.attempts[0].plan.earnedOrder = 0; }],
  ['shape_type', g => { g.attempts[0].plan.earnedOrder = 1.5; }],
  ['shape_minimum', g => { g.attempts[0].plan.plannedYear = 999; }],
  ['shape_maximum', g => { g.attempts[0].actualYear.value = 10000; }],
  ['shape_additionalProperties', g => { g.attempts[0].identity.unverifiedField = 'do not drop'; }],
  ['shape_additionalProperties', g => { g.attempts[0].plan.earnedCreditsTotal = 4; }],
  ['non_json_value', g => { g.attempts[0].plan.contribution = undefined; }],
  ['non_json_value', g => { g.attempts[0].plan.contribution.value = NaN; }],
  ['non_json_value', g => { g.attempts[0].plan.contribution.value = Infinity; }],
];
for (const [index, [code, mutate]] of mutations.entries()) test(`attempt: rejects ${code} mutation ${index + 1} without modifying data`, () => {
  const { graph, context } = attemptFixture(); mutate(graph, context);
  const original = structuredClone(graph); rejects(freeze(graph), freeze(context), code); assert.deepEqual(graph, original);
});

test('attempt: valid and invalid input are read-only; semantic errors and master/registry reordering are stable', () => {
  const { graph, context } = attemptFixture(); valid(freeze(graph), freeze(context));
  const bad = structuredClone(graph); bad.ownedRecords[0].owner.attemptId = attemptId(9999); bad.attempts[0].applicability.status = 'unverified';
  const first = check(bad, context), shuffled = structuredClone(bad), ctx = structuredClone(context);
  shuffled.attempts.reverse(); shuffled.ownedRecords.reverse();
  ctx.catalog.placements.reverse(); ctx.catalog.institutionalCourses.reverse(); ctx.catalog.curriculumVersions.reverse(); ctx.catalog.crosswalk.reverse(); ctx.catalog.curriculumAudit.reverse();
  assert.deepEqual(check(shuffled, ctx), first);
});
test('attempt: zero and null progress counts differ, excess original reports are retained', () => {
  const { graph, context } = attemptFixture(); graph.ownedRecords[1].payload.totalLessons = 0;
  graph.ownedRecords[2].payload.requiredReports = 0;
  valid(graph, context); assert.equal(graph.ownedRecords[2].payload.reports.length, 1);
  graph.ownedRecords[2].payload.requiredReports = null; valid(graph, context);
});
test('attempt: official aggregate stays external; manual contribution and explicit association do not add to it', () => {
  const { graph, context } = attemptFixture();
  const official = freeze({ id: 'official-aggregate', earnedCreditsTotal: 4, compositionCredits: 4, schoolingCreditsTotal: null });
  graph.attempts[0].plan.importedSourceCourseId = official.id;
  const before = structuredClone(graph); valid(graph, context);
  assert.deepEqual(graph, before); assert.equal(official.earnedCreditsTotal, 4);
  assert.equal(graph.attempts[0].plan.contribution.value, 2);
  graph.officialAggregates = [official]; rejects(graph, context, 'shape_additionalProperties');
});
for (const kind of ['thesisProgress', 'officialRows', 'officialDetails', 'publicCourses', 'officialMeta']) test(`attempt: ${kind} cannot be unconditionally absorbed into owned records`, () => {
  const { graph, context } = attemptFixture(); graph.ownedRecords[0].kind = kind; rejects(graph, context, 'shape_const');
});
const transitionMutations = [
  ['owner_reassigned', d => { d.ownedRecords[4].owner = structuredClone(d.ownedRecords[5].owner); }],
  ['owned_record_lost', d => { d.ownedRecords.splice(0, 1); }],
  ['owned_payload_changed', d => { d.ownedRecords[0].payload.lessons[0].videoCompleted = false; }],
  ['invalid_delete_ticket', d => { d.removals[0].previousPosition = 1; }],
  ['attempt_id_reassigned', d => {
    const old = d.attempts[0].id; d.attempts[0].id = attemptId(9999); d.removals[0].attemptSnapshot.id = attemptId(9999);
    d.ownedRecords.forEach(r => { if (r.owner?.attemptId === old) r.owner.attemptId = attemptId(9999); });
  }],
];
for (const [code, mutate] of transitionMutations) test(`attempt: deletion refuses ${code}`, () => {
  const { graph, context } = attemptFixture(), { deleted, action } = deletedFixture(graph); mutate(deleted);
  valid(deleted, context); const original = structuredClone(deleted);
  const result = validateAttemptPlanTransition(freeze(graph), freeze(deleted), freeze(context), action);
  assert.equal(result.valid, false); assert.ok(result.issues.some(i => i.code === code), JSON.stringify(result)); assert.deepEqual(deleted, original);
});
test('attempt: detached snapshot modifications, extra tickets and active ticket conflict are detected', () => {
  const { graph, context } = attemptFixture(), { deleted } = deletedFixture(graph);
  deleted.attempts[0].plan.contribution.value = 0; rejects(deleted, context, 'undo_snapshot_mismatch');
  deleted.attempts[0].plan.contribution.value = 2;
  deleted.removals.push(structuredClone(deleted.removals[0])); rejects(deleted, context, 'duplicate_removal_operation');
});
test('attempt: Undo rejects a new Attempt/operation and incorrect restore position', () => {
  const { graph, context } = attemptFixture(), { deleted, action } = deletedFixture(graph);
  const restored = structuredClone(graph); restored.attempts.reverse(); valid(restored, context);
  const badPosition = validateAttemptPlanTransition(deleted, restored, context, { ...action, kind: 'undo_plan' });
  assert.ok(badPosition.issues.some(i => i.code === 'invalid_undo_ticket'));
  const badOperation = validateAttemptPlanTransition(deleted, graph, context, { ...action, operationId: operationId(9999), kind: 'undo_plan' });
  assert.ok(badOperation.issues.some(i => i.code === 'invalid_undo_ticket'));
});
test('attempt: schema validates malformed primitives without throwing or stripping unknown data', () => {
  const { context } = attemptFixture();
  for (const value of [null, 1, 'x', [], {}, { attempts: [null], ownedRecords: [], removals: [] }]) assert.equal(check(value, context).valid, false);
  const cycle = {}; cycle.self = cycle; rejects(cycle, context, 'non_json_value');
});
test('attempt: no production runtime imports the new independent module', () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
  const root = new URL('../src/', import.meta.url).pathname;
  const outside = walk(root).filter(p => /\.(ts|tsx)$/.test(p) && !p.includes('/planner/attempts/'));
  for (const path of outside) assert.doesNotMatch(readFileSync(path, 'utf8'), /(?:from\s*|import\s*\()['"][^'"]*attempts\//, path);
});

test('attempt: confirmed Placement rejects a competing audit identity', () => {
  const { graph, context } = attemptFixture(); graph.attempts[0].placement.candidateAuditIds = [context.catalog.curriculumAudit[1].oldCurriculumCourseId];
  rejects(graph, context, 'resolution_candidate_conflict');
});
for (const kind of ['conflict', 'non_course_bucket']) test(`attempt: real ${kind} Placement cannot become confirmed`, () => {
  const { graph, context } = attemptFixture(); context.catalog = loadYi01InstitutionalCatalog(); delete context.legacyArchive;
  const p = context.catalog.placements.find(p => kind === 'conflict' ? p.methodConstraint.status === 'conflict' : p.kind === kind);
  graph.attempts = [graph.attempts[0]]; graph.ownedRecords = [];
  const a = graph.attempts[0]; a.legacyRefs = []; a.identity = unresolved();
  a.placement = { status: 'confirmed', ref: { placementId: p.id, curriculumVersionId: p.curriculumVersionId, scopeId: p.scopeId,
    sourceRevisionId: p.sourceRevisionId, evidenceIds: p.identityDecision.evidenceIds }, candidateAuditIds: [], candidatePlacementIds: [], reason: null };
  rejects(graph, context, 'unconfirmed_placement');
});
test('attempt: raw digest set rejects an extra file and semantic digest substitution', () => {
  const { graph, context } = attemptFixture();
  graph.attempts[0].legacyRefs[0].legacyDigests.extra = '0'.repeat(64); rejects(graph, context, 'legacy_revision_mismatch');
  delete graph.attempts[0].legacyRefs[0].legacyDigests.extra;
  graph.attempts[0].legacyRefs[0].legacyDigests['src/data/planner_catalog_2026.json'] = '0'.repeat(64); rejects(graph, context, 'legacy_revision_mismatch');
});
test('attempt: corrupt archive and duplicate official IDs cannot establish reference integrity', () => {
  const { graph, context } = attemptFixture(); context.legacyArchive.sourceDigests.extra = '0'.repeat(64);
  rejects(graph, context, 'invalid_legacy_archive'); delete context.legacyArchive.sourceDigests.extra;
  context.officialAchievementIds.push(context.officialAchievementIds[0]); rejects(graph, context, 'duplicate_official_id');
});
test('attempt: reversed duplicate records still yield the same complete semantic errors', () => {
  const { graph, context } = attemptFixture(); graph.attempts.push(structuredClone(graph.attempts[0]));
  graph.ownedRecords.push({ ...structuredClone(graph.ownedRecords[0]), id: recordId(7777) });
  const first = check(graph, context), reverse = structuredClone(graph); reverse.attempts.reverse(); reverse.ownedRecords.reverse();
  assert.deepEqual(check(reverse, context), first);
});
for (const variation of ['symbol', 'hidden', 'accessor', 'array_property']) test(`attempt: non-JSON ${variation} is rejected without executing accessors`, () => {
  const { graph, context } = attemptFixture();
  if (variation === 'symbol') graph.attempts[0][Symbol('unknown')] = 'retained';
  if (variation === 'hidden') Object.defineProperty(graph.attempts[0], 'unknown', { value: 'retained' });
  if (variation === 'accessor') Object.defineProperty(graph.attempts[0], 'originalTitle', { enumerable: true, get() { throw new Error('Accessor must not run'); } });
  if (variation === 'array_property') graph.attempts.extra = 'retained';
  rejects(graph, context, 'non_json_value');
});
test('attempt: deletion/Undo keep unrelated orphan owners and unowned TODOs too', () => {
  const { graph, context, makeAttempt } = attemptFixture(); const orphan = makeAttempt(2002);
  orphan.membership = { kind: 'detached', reason: 'legacy_orphan', deletionOperationId: null }; orphan.plan = null;
  graph.attempts.push(orphan);
  graph.ownedRecords.push({ id: recordId(4006), kind: 'evaluation', owner: { kind: 'attempt', attemptId: orphan.id }, payload: { finalGrade: 'B', reportGrade: null, schoolingGrade: null } });
  graph.ownedRecords[5].owner = null;
  const { deleted, action } = deletedFixture(graph); valid(deleted, context);
  assert.deepEqual(validateAttemptPlanTransition(graph, deleted, context, action), { valid: true, issues: [] });
  assert.deepEqual(validateAttemptPlanTransition(deleted, graph, context, { ...action, kind: 'undo_plan' }), { valid: true, issues: [] });
});

// P2 follow-up: active-plan position is defined by filtering the owner registry.
// Detached registry entries may move freely; their complete owned data must survive.
const activeIds = graph => graph.attempts.filter(a => a.membership.kind === 'active').map(a => a.id);
function orderedPlanFixture() {
  const f = attemptFixture(), [a, b] = f.graph.attempts;
  const c = f.makeAttempt(2002), orphan = f.makeAttempt(2003);
  orphan.membership = { kind: 'detached', reason: 'legacy_orphan', deletionOperationId: null }; orphan.plan = null;
  f.graph.attempts = [a, orphan, b, c];
  for (const [index, source] of [f.graph.ownedRecords[0], f.graph.ownedRecords[3], f.graph.ownedRecords[4]].entries()) {
    f.graph.ownedRecords.push({ ...structuredClone(source), id: recordId(4006 + index),
      owner: { kind: 'attempt', attemptId: orphan.id },
      payload: source.kind === 'todo' ? { ...source.payload, id: 'orphan-todo', text: 'detached TODO' } : structuredClone(source.payload) });
  }
  return { ...f, a, b, c, orphan };
}
function transitionResult(before, after, context, action) {
  valid(before, context); valid(after, context); // Rule out an unrelated static-graph rejection.
  const originalBefore = structuredClone(before), originalAfter = structuredClone(after);
  const checked = validateAttemptPlanTransition(freeze(before), freeze(after), freeze(context), action);
  assert.deepEqual(before, originalBefore); assert.deepEqual(after, originalAfter);
  return checked;
}
for (const target of ['a', 'b']) test(`P2 order: delete ${target.toUpperCase()} from [A,B,C] rejects reversed remaining active IDs`, () => {
  const f = orderedPlanFixture(), { graph, context } = f;
  const { deleted, action } = deletedFixture(graph, graph.attempts.indexOf(f[target]));
  const remaining = deleted.attempts.filter(a => a.membership.kind === 'active');
  const detached = deleted.attempts.filter(a => a.membership.kind === 'detached');
  deleted.attempts = [...detached, ...remaining.reverse()];
  assert.deepEqual(activeIds(deleted), target === 'a' ? [f.c.id, f.b.id] : [f.c.id, f.a.id]);
  const checked = transitionResult(graph, deleted, context, action);
  assert.equal(checked.valid, false);
  assert.ok(checked.issues.some(i => i.code === 'active_plan_order_changed'), JSON.stringify(checked));
});
for (const target of ['a', 'b', 'c']) test(`P2 order: legal ${target.toUpperCase()} deletion and Undo preserve [A,B,C] and all owned data`, () => {
  const f = orderedPlanFixture(), { graph, context } = f;
  const { deleted, action } = deletedFixture(graph, graph.attempts.indexOf(f[target]));
  assert.deepEqual(activeIds(deleted), [f.a, f.b, f.c].filter(a => a.id !== action.attemptId).map(a => a.id));
  assert.deepEqual(transitionResult(graph, deleted, context, action), { valid: true, issues: [] });
  assert.deepEqual(transitionResult(deleted, graph, context, { ...action, kind: 'undo_plan' }), { valid: true, issues: [] });
  assert.deepEqual(activeIds(graph), [f.a.id, f.b.id, f.c.id]);
  assert.deepEqual(deleted.ownedRecords, graph.ownedRecords);
  for (const attempt of graph.attempts) {
    const saved = deleted.attempts.find(a => a.id === attempt.id);
    assert.equal(saved.creationOperationId, attempt.creationOperationId);
  }
  assert.deepEqual(deleted.removals[0].attemptSnapshot, f[target]);
  assert.equal(deleted.removals[0].previousPosition, ['a', 'b', 'c'].indexOf(target));
});
for (const target of ['a', 'b']) test(`P2 order: Undo ${target.toUpperCase()} at the correct index still rejects reordered unrelated active IDs`, () => {
  const f = orderedPlanFixture(), { graph, context } = f;
  const { deleted, action } = deletedFixture(graph, graph.attempts.indexOf(f[target]));
  const restored = structuredClone(graph), byId = new Map(restored.attempts.map(a => [a.id, a]));
  const wrongOrder = target === 'a' ? [f.a, f.c, f.b] : [f.c, f.b, f.a];
  restored.attempts = [byId.get(f.orphan.id), ...wrongOrder.map(a => byId.get(a.id))];
  assert.equal(activeIds(restored).indexOf(action.attemptId), deleted.removals[0].previousPosition);
  const checked = transitionResult(deleted, restored, context, { ...action, kind: 'undo_plan' });
  assert.equal(checked.valid, false);
  assert.ok(checked.issues.some(i => i.code === 'active_plan_order_changed'), JSON.stringify(checked));
  assert.ok(!checked.issues.some(i => i.code === 'invalid_undo_ticket'), JSON.stringify(checked));
});
test('P2 order: detached registry reordering is legal on deletion and Undo; unrelated removal ticket survives', () => {
  const f = orderedPlanFixture();
  const { deleted: before } = deletedFixture(f.graph, f.graph.attempts.indexOf(f.c));
  const { deleted: after, action } = deletedFixture(before, before.attempts.findIndex(a => a.id === f.b.id));
  const afterMap = new Map(after.attempts.map(a => [a.id, a]));
  after.attempts = [f.c, f.b, f.orphan, f.a].map(a => afterMap.get(a.id));
  after.ownedRecords.reverse(); after.removals.reverse();
  assert.deepEqual(transitionResult(before, after, f.context, action), { valid: true, issues: [] });
  const restored = structuredClone(before), restoredMap = new Map(restored.attempts.map(a => [a.id, a]));
  restored.attempts = [f.orphan, f.a, f.c, f.b].map(a => restoredMap.get(a.id));
  assert.deepEqual(transitionResult(after, restored, f.context, { ...action, kind: 'undo_plan' }), { valid: true, issues: [] });
  assert.deepEqual(after.removals.find(r => r.attemptSnapshot.id === f.c.id), before.removals[0]);
});
for (const kind of ['media', 'evaluation', 'todo']) test(`P2 order: detached ${kind} payload is still protected while detached positions move`, () => {
  const f = orderedPlanFixture(), { deleted, action } = deletedFixture(f.graph, f.graph.attempts.indexOf(f.b));
  const orphanRecords = deleted.ownedRecords.filter(r => r.owner?.attemptId === f.orphan.id);
  const record = orphanRecords.find(r => r.kind === kind);
  if (kind === 'media') record.payload.lessons[0].videoCompleted = false;
  if (kind === 'evaluation') record.payload.finalGrade = 'B';
  if (kind === 'todo') record.payload.text = '変更してはいけない';
  const checked = transitionResult(f.graph, deleted, f.context, action);
  assert.ok(checked.issues.some(i => i.code === 'owned_payload_changed' && i.path.endsWith(record.id)), JSON.stringify(checked));
});

// Cross-validator observation only: this constructs a synthetic legacy state and
// reuses its date string in a separate synthetic Attempt, not a migration API.
for (const [date, acceptedByAttempt] of [['2027-02-30', false], ['2027-99-99', false], ['2027-02-28', true], ['2028-02-29', true], [null, true]]) {
  test(`P2 date compatibility: v22 accepts ${date}; Attempt ${acceptedByAttempt ? 'accepts' : 'holds'} it without rewriting`, () => {
    const legacyState = initialState(), offering = catalog.offerings.find(isMediaSchooling);
    assert.ok(offering, 'A real existing media Offering is required for the v22 validation path');
    legacyState.mediaSchoolingProgress[offering.id] = { offeringId: offering.id, totalLessons: null, lessons: [],
      assessments: [{ id: 'date-compatibility-assessment', type: 'other', label: 'synthetic date', scheduledDate: date, completed: false }] };
    const originalLegacy = structuredClone(legacyState);
    assert.equal(validateState(freeze(legacyState), catalog), true);
    const { graph, context } = attemptFixture(); graph.ownedRecords[0].payload.assessments[0].scheduledDate = date;
    const originalGraph = structuredClone(graph), checked = check(freeze(graph), context);
    assert.equal(checked.valid, acceptedByAttempt, JSON.stringify(checked));
    if (!acceptedByAttempt) {
      assert.deepEqual(checked.issues.map(i => i.code), ['assessment_date']);
      assert.equal(checked.issues[0].path, `/ownedRecords/${graph.ownedRecords[0].id}/assessments/old-assessment-A`);
    }
    assert.deepEqual(legacyState, originalLegacy); assert.deepEqual(graph, originalGraph);
    assert.equal(legacyState.mediaSchoolingProgress[offering.id].assessments[0].scheduledDate, date);
    assert.equal(graph.ownedRecords[0].payload.assessments[0].scheduledDate, date);
  });
}
