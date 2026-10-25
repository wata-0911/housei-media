import { CURRENT_CURRICULUM_SEARCH_TARGET } from '../../institutional/currentSearch';
import { createInstitutionalSearchAdapter, type InstitutionalSearchRow } from '../../institutional/search';
import type { InstitutionalCatalog } from '../../institutional/types';
import type { Attempt } from '../types';
import { sameAttemptData, validateAttemptGraph } from '../validation';
import { makeAttempt } from './catalogView';
import { newAttemptIds } from './operations';

/** Search output is untrusted. Re-read the pinned slice from the caller's trusted
 * YI-02 master and require an exact plain-data match, including all candidates,
 * scope/role, code channels, source revision, notes and nullable quantities.
 * No search row is embedded in the Attempt and no applicability is inferred. */
export function makeSearchAttempt(catalog: InstitutionalCatalog, selection: InstitutionalSearchRow,
  input: Pick<Parameters<typeof makeAttempt>[1], 'plan' | 'method' | 'note'>, ids = newAttemptIds()): Attempt {
  const result = createInstitutionalSearchAdapter(catalog, CURRENT_CURRICULUM_SEARCH_TARGET).search({ scope: { kind: 'all' } });
  const row = result.rows.find(r => r.placement.id === selection?.placement?.id);
  if (result.status !== 'documented_slice_only' || !row || !sameAttemptData(selection, row)) {
    throw new Error('search_selection_mismatch: 配置・候補・資料版を再確認してください');
  }
  const p = row.placement, course = row.institutionalCourse;
  if (p.kind !== 'course_placement') throw new Error('non_course_bucket: 非科目枠は通常Attemptに登録できません');
  const safe = p.identityDecision.status === 'safe' && course?.identityDecision.status === 'safe'
    && course.identityDecision.adoptedStableId === course.id && p.identityDecision.adoptedStableId === course.id
    && p.institutionalCourseId === course.id && p.identityDecision.evidenceIds.includes(p.officialRow.evidenceId);
  if (p.identityDecision.status === 'safe' && !safe) throw new Error('unreviewed_course_binding');
  // Begin with the existing manual constructor: never pass ambiguous candidates
  // through selectedReferences(courseId), which would promote them to confirmed.
  const attempt = makeAttempt(catalog, { ...input, title: p.officialName, courseId: null, placementId: null }, ids);
  const candidates = [...p.candidateAuditIds];
  attempt.identity = safe && course
    ? { status: 'confirmed', ref: { institutionalCourseId: course.id, sourceRevisionId: row.sourceRevision.id,
      evidenceIds: [...course.identityDecision.evidenceIds] }, candidateAuditIds: candidates, reason: null }
    : { status: p.identityDecision.status === 'safe' ? 'unknown' : p.identityDecision.status, ref: null,
      candidateAuditIds: candidates, reason: p.identityDecision.reason.join('\n') };
  attempt.placement = { status: p.identityDecision.status === 'conflict' || p.methodConstraint.status === 'conflict' ? 'conflict'
    : p.identityDecision.status === 'safe' ? 'unknown' : p.identityDecision.status,
    ref: null, candidateAuditIds: [...candidates], candidatePlacementIds: [p.id],
    reason: `本人が配置を選択。本人適用は未確認。${p.identityDecision.reason.join('\n')}` };
  // Revision-bound Mapping + candidate Placement pins CV/scope/role and the full
  // evidence in the existing master. This is a reference, not migrated progress.
  attempt.legacyRefs = [{ status: 'known', entityKind: 'Mapping', oldId: p.identityDecision.oldId,
    sourceRevisionId: row.sourceRevision.id, sourceDigest: row.sourceRevision.sha256,
    legacyDigests: { ...catalog.legacyDigests }, reason: null }];
  const checked = validateAttemptGraph({ attempts: [attempt], ownedRecords: [], removals: [] },
    { catalog, officialAchievementIds: [], officialStudyRecordIds: [] });
  if (!checked.valid) throw new Error(checked.issues.map(i => `${i.code}: ${i.message}`).join('\n'));
  return attempt;
}
