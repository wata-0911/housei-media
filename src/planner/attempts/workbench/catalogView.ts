import type { InstitutionalCatalog } from '../../institutional/types';
import { searchInstitutionalPlacements } from '../../institutional/query';
import type { Attempt, AttemptGraph, AttemptOwnedRecord } from '../types';
import { newAttemptIds } from './operations';

export function courseChoices(catalog: InstitutionalCatalog, text: string) {
  return catalog.institutionalCourses.filter(c => c.officialName.includes(text));
}
export function placementChoices(catalog: InstitutionalCatalog, courseId: string | null, text = '') {
  return searchInstitutionalPlacements(catalog, text).filter(p => courseId === null || p.institutionalCourseId === courseId);
}
export function selectedReferences(catalog: InstitutionalCatalog, courseId: string | null, placementId: string | null): Pick<Attempt, 'identity' | 'placement'> {
  const course = courseId === null ? null : catalog.institutionalCourses.find(c => c.id === courseId);
  const placement = placementId === null ? null : catalog.placements.find(p => p.id === placementId);
  if (courseId && !course || placementId && !placement) throw new Error('unknown_reference');
  return {
    identity: course ? { status: 'confirmed', ref: { institutionalCourseId: course.id, sourceRevisionId: catalog.sourceRevision.id,
      evidenceIds: [...course.identityDecision.evidenceIds] }, candidateAuditIds: [], reason: null }
      : { status: 'unknown', ref: null, candidateAuditIds: [], reason: '本人が制度identityを未確定として記録' },
    // Selection means a candidate, not a claim of applicability or automatic identity resolution.
    placement: { status: placement?.identityDecision.status === 'conflict' ? 'conflict' : 'unknown', ref: null,
      candidateAuditIds: [], candidatePlacementIds: placement ? [placement.id] : [], reason: placement ? '本人が選んだ配置候補。本人適用は未確認' : '配置候補未選択' },
  };
}
export function makeAttempt(catalog: InstitutionalCatalog, input: {
  title: string; courseId: string | null; placementId: string | null; plan: NonNullable<Attempt['plan']>;
  method: Attempt['method']['value']; note: string;
}, ids = newAttemptIds()): Attempt {
  return { ...ids, originalTitle: input.title, ...selectedReferences(catalog, input.courseId, input.placementId),
    applicability: { status: 'unknown', curriculumVersionId: null, scopeId: null, legacyApplicability: 'unknown', originalValue: null, evidence: null },
    legacyRefs: [], membership: { kind: 'active' }, plan: structuredClone(input.plan),
    method: { value: input.method, source: 'learner', evidence: { kind: 'learner', note: input.note || '本人希望（開講・履修可否は未確認）' } },
    actualYear: { value: null, source: 'unknown', evidence: null, reason: null } };
}
export function contributionLabel(attempt: Attempt) {
  if (!attempt.plan || !Object.hasOwn(attempt.plan, 'contribution')) return '未設定';
  return attempt.plan.contribution!.value === null ? '不明 (null)' : `${attempt.plan.contribution!.value}単位`;
}
export function ownerLabel(owner: AttemptOwnedRecord['owner'], graph: AttemptGraph) {
  if (owner === null) return 'ownerなし';
  if (owner.kind === 'unresolved_legacy') return `旧Offering未解決: ${owner.ref.oldId}`;
  const attempt = graph.attempts.find(a => a.id === owner.attemptId);
  return `${attempt?.originalTitle ?? '不明'} / ${owner.attemptId} / ${attempt?.membership.kind ?? '不明'}`;
}
export function attemptView(attempt: Attempt, graph: AttemptGraph, catalog: InstitutionalCatalog) {
  const records = graph.ownedRecords.filter(r => r.owner?.kind === 'attempt' && r.owner.attemptId === attempt.id);
  const placementIds = attempt.placement.ref ? [attempt.placement.ref.placementId] : attempt.placement.candidatePlacementIds;
  return { attempt, records, contribution: contributionLabel(attempt),
    placements: catalog.placements.filter(p => placementIds.includes(p.id)),
    progressSummary: records.map(r => r.kind === 'media' ? `動画 ${r.payload.lessons.filter(l => l.videoCompleted).length} / ${r.payload.totalLessons ?? '不明'}、テスト ${r.payload.lessons.filter(l => l.testCompleted).length}`
      : r.kind === 'correspondence' ? `リポート合格 ${r.payload.reports.filter(p => p.status === 'passed').length} / ${r.payload.requiredReports ?? '不明'}`
      : r.kind === 'evaluation' ? `最終評価 ${r.payload.finalGrade ?? '未評価'}` : `TODO ${r.payload.done ? '完了' : '未完了'}`).join(' / ') || '記録なし' };
}
/** Empty is explicitly null; invalid text is never coerced to zero or truncated. */
export function optionalNumber(text: string): number | null {
  if (text === '') return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) throw new Error(`数値が不正です: ${text}`);
  return Number(text);
}
