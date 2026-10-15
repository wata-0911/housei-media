import { readFileSync } from 'node:fs';
import { institutionalFixture } from './institutional-fixture.mjs';
import { loadInstitutionalCatalog } from '../../src/planner/institutional/loader.ts';

export const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const attemptId = n => `hosei:attempt:${uuid(n)}`;
export const operationId = n => `hosei:attempt-op:${uuid(n)}`;
export const recordId = n => `hosei:owned:${uuid(n)}`;
export const unresolved = (status = 'unknown', candidateAuditIds = []) => ({ status, ref: null, candidateAuditIds, reason: '合成fixture: 根拠未確認' });
export const legacyRef = (catalog, oldId = uuid(9000), entityKind = 'Offering', status = 'known') => ({
  status, entityKind, oldId, sourceRevisionId: catalog.sourceRevision.id, sourceDigest: catalog.sourceRevision.sha256,
  legacyDigests: { ...catalog.legacyDigests }, reason: status === 'unknown' ? '合成fixture: 未知旧ID' : null,
});

/** All learner data is synthetic. No user state or annual catalog is generated. */
export function attemptFixture() {
  const f = institutionalFixture();
  const catalog = loadInstitutionalCatalog(f.input, f.registry, f.baseline);
  const first = catalog.placements[0];
  const makeAttempt = n => ({
    id: attemptId(n), creationOperationId: operationId(1000 + n), originalTitle: '合成fixture科目',
    identity: { status: 'confirmed', ref: { institutionalCourseId: first.institutionalCourseId,
      sourceRevisionId: first.sourceRevisionId, evidenceIds: [first.officialRow.evidenceId] }, candidateAuditIds: [], reason: null },
    placement: { status: 'confirmed', ref: { placementId: first.id, curriculumVersionId: first.curriculumVersionId,
      scopeId: first.scopeId, sourceRevisionId: first.sourceRevisionId, evidenceIds: [first.officialRow.evidenceId] }, candidateAuditIds: [], candidatePlacementIds: [], reason: null },
    applicability: { status: 'unknown', curriculumVersionId: null, scopeId: null, legacyApplicability: 'unknown', originalValue: '未知適用課程', evidence: null },
    legacyRefs: [legacyRef(catalog)], membership: { kind: 'active' },
    plan: { status: 'earned', plannedYear: 2027, plannedTerm: '本人希望: 春', studyYear: 2, earnedOrder: null,
      contribution: { value: 2, source: 'learner', note: '本人が記録した寄与2。構成4とは別' } },
    method: { value: 'media', source: 'learner', evidence: { kind: 'learner', note: '本人の希望方式' } },
    actualYear: { value: 2025, source: 'manual', evidence: { kind: 'learner', note: '自己申告の実績年度' }, reason: null },
  });
  const archive = JSON.parse(readFileSync(new URL('../../docs/planner-yi-01/legacy-relations.json', import.meta.url), 'utf8'));
  archive.offeringEdges = [{ ...archive.offeringEdges[0], offeringId: uuid(9000), legacyCourseId: null,
    mappingIds: [first.identityDecision.oldId], relation: { ...archive.offeringEdges[0].relation, offeringId: uuid(9000),
      curriculumCourseId: first.auditRecord.oldCurriculumCourseId, candidateCurriculumCourseIds: [first.auditRecord.oldCurriculumCourseId] } }];
  archive.legacyCourseRelations = [];
  const a = makeAttempt(2000), b = makeAttempt(2001);
  const owned = (n, kind, attempt, payload) => ({ id: recordId(n), kind, owner: { kind: 'attempt', attemptId: attempt.id }, payload });
  const graph = { attempts: [a, b], ownedRecords: [
    owned(4000, 'media', a, { totalLessons: 2, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }],
      assessments: [{ id: 'old-assessment-A', type: 'other', label: '任意試験', scheduledDate: '2027-02-28', completed: false }] }),
    owned(4001, 'media', b, { totalLessons: null, lessons: [], assessments: [] }),
    owned(4002, 'correspondence', a, { requiredReports: null, reports: [{ reportNumber: 1, status: 'passed', grade: 'A' }], examGrade: 'D', calligraphyBatchStatus: 'grading' }),
    owned(4003, 'evaluation', a, { finalGrade: null, reportGrade: 'A', schoolingGrade: 'S' }),
    owned(4004, 'todo', a, { id: 'old-todo-A', text: 'TODO A', done: false }),
    owned(4005, 'todo', b, { id: 'old-todo-B', text: 'TODO B', done: true }),
  ], removals: [] };
  const context = { catalog, legacyArchive: archive, officialAchievementIds: ['official-aggregate'], officialStudyRecordIds: ['official-detail'] };
  return { graph, context, makeAttempt };
}
export function deletedFixture(graph, index = 0) {
  const deleted = structuredClone(graph), snapshot = structuredClone(graph.attempts[index]);
  const op = operationId(6000 + index);
  deleted.attempts[index].membership = { kind: 'detached', reason: 'plan_deleted', deletionOperationId: op };
  deleted.removals.push({ operationId: op, attemptSnapshot: snapshot,
    previousPosition: graph.attempts.filter(a => a.membership.kind === 'active').findIndex(a => a.id === snapshot.id) });
  return { deleted, action: { kind: 'delete_plan', attemptId: snapshot.id, operationId: op } };
}
