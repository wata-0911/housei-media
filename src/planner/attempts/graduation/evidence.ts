import { adaptAttemptGraduation } from './adapter';
import { snapshotEvidenceSubmissions } from './evidenceSnapshot';
import { freeze, pointer } from '../migration/contracts';
import type { Attempt } from '../types';
import type { AttemptHoldCode, Decision, GraduationAxis, RecordedQuantity } from './types';
import type { AttemptEvidenceInput, AttemptEvidenceResult, EvidenceDecision, EvidenceReference,
  EvidenceRequirement, EvidenceSource, EvidenceSubmission, OfficialRecordedQuantities } from './evidenceTypes';

const applicabilityRequirements: EvidenceRequirement[] = ['official_learner_program', 'official_admission_context',
  'official_curriculum_transition_history', 'reviewed_applicability_rules'];
// Each obligation comes only from a diagnostic carried by that graduation axis.
// The mapping explains missing evidence; it never changes the adapter decision.
const graduationRequirements: Record<AttemptHoldCode, readonly EvidenceRequirement[]> = {
  identity_unresolved: ['reviewed_course_identity'],
  placement_ambiguous: ['unique_reviewed_placement'],
  placement_unresolved: ['unique_reviewed_placement'],
  applicability_unverified: applicabilityRequirements,
  method_evidence_insufficient: ['official_attempt_method', 'official_attempt_detail_binding'],
  official_year_unverified: ['official_attempt_academic_year', 'official_attempt_detail_binding'],
  contribution_omitted: ['explicit_attempt_contribution'],
  contribution_unknown: ['explicit_attempt_contribution'],
  earned_order_unconfirmed: ['reviewed_attempt_earned_order'],
  official_overlap_possible: ['same_course_aggregate'],
  official_matching_held: ['reviewed_official_course_matching'],
  official_detail_shared: ['official_attempt_detail_binding', 'exclusive_detail_assignment'],
  official_association_unverified: ['official_attempt_detail_binding'],
  completion_evidence_insufficient: ['official_course_completion_evidence'],
  attempt_rule_unimplemented: ['implemented_allocation_rule'],
  multiple_attempt_rule_unimplemented: ['implemented_allocation_rule'],
};
const quantity = (value: number | null | undefined): RecordedQuantity => value === undefined ? { kind: 'omitted' }
  : value === null ? { kind: 'unknown', value: null } : value === 0 ? { kind: 'zero', value: 0 } : { kind: 'positive', value };
function quantities(row: { earnedCreditsTotal?: number | null; schoolingCreditsTotal?: number | null;
  compositionCredits?: number | null }): OfficialRecordedQuantities {
  return { ordinary: quantity(row.earnedCreditsTotal), schooling: quantity(row.schoolingCreditsTotal), composition: quantity(row.compositionCredits) };
}
function detailIds(a: Attempt): string[] {
  return [...new Set([a.method.evidence, a.actualYear.evidence].flatMap(e => e?.kind === 'official_detail' ? [e.studyRecordId] : []))].sort();
}
function judgement<T>(decision: Decision<T>, missingEvidence: EvidenceRequirement[], references: EvidenceReference[]): EvidenceDecision<T> {
  return { ...decision, missingEvidence: [...new Set(missingEvidence)], references };
}
const supported = <T>(value: T, reason: string, references: EvidenceReference[]): EvidenceDecision<T> =>
  judgement({ status: 'supported', value, reasons: [reason] }, [], references);
const held = <T = never>(reasons: string[], missing: EvidenceRequirement[], references: EvidenceReference[]): EvidenceDecision<T> =>
  judgement<T>({ status: 'held', value: null, reasons }, missing, references);

/** Uses the stage-1 validation/snapshot boundary, never caller-supplied decisions.
 * Pure, read-only, no IO, time, new IDs, normalization, proof issuance or allocation.
 * Current YI-02 has no reviewed learner/Attempt attestation resolver: these claims
 * remain held even when their reference exists or only one Attempt refers to it. */
export function assessAttemptEvidence(input: AttemptEvidenceInput, source: EvidenceSource, scopeId: string): AttemptEvidenceResult {
  const adapted = adaptAttemptGraduation(input, source, scopeId);
  if (adapted.status === 'rejected') return adapted;
  // Optional submissions are inert references, never an escape from the closed
  // graph schema. Build plain snapshots from descriptors without cloning/re-reading inputs.
  let submissions: EvidenceSubmission[] = [];
  try {
    const property = Object.getOwnPropertyDescriptor(input, 'submittedEvidence');
    if (property) {
      if (!('value' in property)) throw new Error('non_json_submission');
      const copied = snapshotEvidenceSubmissions(property.value);
      for (const s of copied) {
        if (!s || typeof s !== 'object' || Object.keys(s).sort().join(',') !== 'attemptId,kind,sourceRefs,sourceRevisionId'
          || typeof s.attemptId !== 'string' || !adapted.graph.attempts.some(a => a.id === s.attemptId)
          || typeof s.kind !== 'string' || !s.kind || typeof s.sourceRevisionId !== 'string' || !s.sourceRevisionId
          || !Array.isArray(s.sourceRefs) || !s.sourceRefs.length || s.sourceRefs.some((r: unknown) => typeof r !== 'string' || !r)) {
          throw new Error('invalid_submission');
        }
      }
      submissions = copied;
    }
  } catch { return { status: 'rejected', diagnostics: [{ code: 'invalid_evidence_submission', path: '/submittedEvidence',
    message: 'Expected plain, revision-bound references to an existing Attempt; no proof kinds are accepted yet' }] }; }
  const master = source.context.catalog;
  const ref = (sourceRef: string, sourceRevisionId = master.sourceRevision.id): EvidenceReference =>
    ({ sourceRef, sourceRevisionId, sourceRawSha256: source.rawSha256 });
  const rows = adapted.retained.importedCourseAchievements, records = adapted.retained.importedStudyRecords;
  const attempts = adapted.attempts.map(entry => {
    const a = entry.record, base = `/graph/attempts/${pointer(a.id)}`;
    const course = master.institutionalCourses.find(c => c.id === a.identity.ref?.institutionalCourseId);
    const identityRefs = [ref(`${base}/identity`), ...(course ? [ref(`/institutionalCourses/${pointer(course.id)}`),
      ...a.identity.ref!.evidenceIds.map(id => ref(`/evidence/${pointer(id)}`, a.identity.ref!.sourceRevisionId))] : [])];
    const identity = a.identity.status === 'confirmed' && course
      ? supported(course.id, 'reviewed_course_identity', identityRefs)
      : held<string>(['identity_unresolved'], ['reviewed_course_identity'], identityRefs);
    const placementRefs = [ref(`${base}/placement`), ...entry.placementCandidates.flatMap(p =>
      [ref(`/placements/${pointer(p.id)}`, p.sourceRevisionId), ref(`/evidence/${pointer(p.officialRow.evidenceId)}`, p.sourceRevisionId)])];
    const placement = a.placement.status === 'confirmed'
      ? supported(a.placement.ref.placementId, 'reviewed_placement_definition', placementRefs)
      : held<string>([a.placement.status === 'conflict' ? 'placement_conflict' : entry.placementCandidates.length > 1
        ? 'placement_ambiguous' : 'placement_unresolved'], ['unique_reviewed_placement'], placementRefs);
    const appRefs = [ref(`${base}/applicability`), ...master.curriculumVersions
      .filter(v => v.id === a.applicability.curriculumVersionId || entry.placementCandidates.some(p => p.curriculumVersionId === v.id))
      .map(v => ref(`/curriculumVersions/${pointer(v.id)}`, v.sourceRevisionId)),
    ...(a.applicability.evidence?.evidenceIds.map(id => ref(`/evidence/${pointer(id)}`, a.applicability.evidence!.sourceRevisionId)) ?? [])];
    const applicability = { recordedStatus: a.applicability.status,
      decision: held(['applicability_unverified', 'learner_applicability_resolver_unimplemented'], applicabilityRequirements, appRefs) };
    const rowIds = new Set([...entry.official.exclusiveAchievementIds, ...entry.official.possibleAchievementIds]);
    const aggregates = rows.filter(row => rowIds.has(row.id)).map(row => {
      const refs = [ref(`/retained/importedCourseAchievements/${pointer(row.id)}`), ...identityRefs];
      const owns = entry.official.exclusiveAchievementIds.includes(row.id);
      return { record: row, referenceExists: supported(row.id, 'reference_exists', refs),
        courseIdentity: owns ? supported(course!.id, 'same_course_exact_safe_crosswalk', refs)
          : held<string>(['aggregate_course_identity_unverified'], ['same_course_aggregate'], refs),
        incrementOwnership: owns ? supported(row.id, 'official_aggregate_owns_course_increment', refs)
          : held<string>(['aggregate_ownership_unverified'], ['same_course_aggregate'], refs),
        explicitlyReferenced: a.plan?.importedSourceCourseId === row.id,
        possibleOverlap: entry.official.possibleAchievementIds.includes(row.id), quantities: quantities(row) };
    });
    const details = records.filter(d => detailIds(a).includes(d.id)).map(d => {
      const refs = [ref(`/retained/importedStudyRecords/${pointer(d.id)}`), ref(`${base}/method`), ref(`${base}/actualYear`)];
      const parent = aggregates.find(row => row.record.id === d.sourceCourseId);
      if (d.sourceCourseId) refs.push(ref(`/retained/importedCourseAchievements/${pointer(d.sourceCourseId)}`));
      const ids = adapted.graph.attempts.filter(peer => detailIds(peer).includes(d.id)).map(peer => peer.id).sort();
      const parentIdentity = parent?.courseIdentity.status === 'supported'
        ? supported(parent.courseIdentity.value, 'parent_aggregate_same_course', [...refs, ...parent.courseIdentity.references])
        : held<string>(['detail_parent_identity_unverified'], ['same_course_aggregate'], refs);
      return { record: d, referenceExists: supported(d.id, 'reference_exists', refs), parentCourseIdentity: parentIdentity,
        attemptAssociation: held(['official_attempt_association_unverified'], ['official_attempt_detail_binding'], refs),
        exclusivity: held(ids.length > 1 ? ['official_detail_shared', 'exclusive_association_unverified'] : ['exclusive_association_unverified'],
          ['official_attempt_detail_binding', 'exclusive_detail_assignment'], refs),
        referencingAttemptIds: ids, quantities: { ...quantities(d), component: quantity(d.credits) } };
    });
    const methodDetail = details.find(d => a.method.evidence?.kind === 'official_detail' && d.record.id === a.method.evidence.studyRecordId);
    const yearDetail = details.find(d => a.actualYear.evidence?.kind === 'official_detail' && d.record.id === a.actualYear.evidence.studyRecordId);
    const methodRefs = [ref(`${base}/method`), ...(methodDetail?.referenceExists.references ?? [])];
    // ImportedStudyRecord has no media subtype. A broad schooling label neither
    // proves media nor contradicts it; correspondence is an actual disagreement.
    const mediaUnverified = methodDetail?.record.method === 'schooling' && a.method.value === 'media';
    const methodConflict = methodDetail && a.method.value !== 'unknown' && a.method.value !== methodDetail.record.method && !mediaUnverified;
    const method = { record: a.method, decision: held(['method_evidence_insufficient',
      ...(methodConflict ? ['method_claim_conflict'] : []), ...(mediaUnverified ? ['media_method_unverified'] : [])],
    ['official_attempt_method', 'official_attempt_detail_binding'], methodRefs) };
    // A numeric source year can expose a disagreement, but still does not bind
    // the detail to this Attempt. Unknown/manual/inferred years are not official years.
    const yearConflict = a.actualYear.source === 'source' && a.actualYear.value !== null
      && yearDetail?.record.yearSource === 'source' && yearDetail.record.academicYear !== null
      && a.actualYear.value !== yearDetail.record.academicYear;
    const actualYear = { record: a.actualYear, decision: held(['official_year_unverified',
      ...(yearConflict ? ['actual_year_claim_conflict'] : [])],
    ['official_attempt_academic_year', 'official_attempt_detail_binding'], [ref(`${base}/actualYear`), ...(yearDetail?.referenceExists.references ?? [])]) };
    const graduation = Object.fromEntries(Object.entries(entry.decisions).map(([axis, decision]) => [axis,
      judgement(decision, decision.status === 'supported' ? [] : decision.reasons.flatMap(reason =>
        graduationRequirements[reason as AttemptHoldCode]), [ref(base), ...aggregates.flatMap(row => row.incrementOwnership.references)])])) as Record<GraduationAxis, EvidenceDecision<number>>;
    return { attemptId: a.id, record: a, identity, placement, placementCandidates: entry.placementCandidates, applicability,
      method, actualYear, quantities: entry.quantities, official: { aggregates, details }, graduation, impact: entry.impact,
      ruleSupport: judgement(entry.evidence.ruleSupport, ['implemented_allocation_rule'], [ref(base)]) };
  });
  return freeze({ status: 'assessed', graduationCheckComplete: false, sourceLinksReverified: false,
    source: adapted.source, attempts, retainedProgress: adapted.retainedProgress, officialEvidence: adapted.officialEvidence,
    submittedEvidence: submissions.map(record => ({ record, decision: held(['unreviewed_evidence_kind',
      ...(record.sourceRevisionId !== master.sourceRevision.id ? ['source_revision_unrecognized'] : [])], ['reviewed_evidence_kind'],
    record.sourceRefs.map(sourceRef => ({ sourceRef, sourceRevisionId: record.sourceRevisionId, sourceRawSha256: null }))) })) });
}
