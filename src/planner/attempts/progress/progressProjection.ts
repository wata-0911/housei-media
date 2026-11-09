import type { Attempt, AttemptGraph, AttemptId, AttemptOwnedRecord } from '../types';

/** Boundary DTO only. It is deliberately not a schema 22/23/24 persistence shape. */
export type OfficialObservation = Readonly<{
  observationId: string;
  source: Readonly<{ revisionId: string; rawSha256: string; raw: string; rowId: string; slotId: string | null }>;
  result: 'unpublished' | 'earned' | 'failed' | 'dropped';
  grade: string | null;
  aggregate: number | null;
  composition: number | null;
  actualYear: number | null;
  methodEvidence: string | null;
  /** Descriptive source detail; never sufficient to prove same Attempt. */
  occurrenceDate?: string | null;
}>;
export type Association = Readonly<{
  status: 'none' | 'unverified' | 'verified' | 'conflict';
  attemptId: AttemptId | null;
  observationId: string | null;
  /** An external resolver's claim. This string alone is never trusted. */
  receiptRef: string | null;
}>;
export type EnrollmentEvidence = Readonly<{
  status: 'insufficient' | 'verified_enrollment';
  attemptId: AttemptId | null;
  observationId: string | null;
  /** Snapshot coordinates supplied to, and verified by, the independent resolver. */
  source: Pick<OfficialObservation['source'], 'revisionId' | 'rawSha256' | 'rowId' | 'slotId'> | null;
  receiptRef: string | null;
}>;
export type TrustedEvidenceResolver = Readonly<{
  sameAttempt?: (claim: Association, attempt: Attempt, observation: OfficialObservation) => boolean;
  /** Must verify owner, source coordinates, enrollment fact, and receipt authority outside this model. */
  enrollment?: (claim: EnrollmentEvidence, attempt: Attempt, observation: OfficialObservation) => boolean;
}>;
export type CreditEvidence = Readonly<{
  additionalCredits: 0;
  completionClaim: false;
  creditEarned: null;
  /** Candidate aggregate is descriptive, even when its association is unverified. */
  officialAggregate: number | null;
  officialAggregateAssociation: 'verified' | 'unverified' | null;
  attemptAllocatedQuantity: null;
}>;
export type OwnerProgress = Readonly<{
  attemptId: AttemptId;
  editableProgress: boolean;
  effectiveStatus: string;
  effectiveResult: string | null;
  resultOrigin: 'official' | 'learner' | 'official_enrollment' | 'unconfirmed';
  effectiveGrade: string | null;
  learnerOriginal: Attempt;
  ownedRecords: readonly AttemptOwnedRecord[];
  /** Only independently verified same-Attempt observations. Global history is on Projection. */
  officialHistory: readonly OfficialObservation[];
  unverifiedOfficialRefs: readonly string[];
  holdReasons: readonly string[];
  creditEvidence: CreditEvidence;
  associationStatus: Association['status'];
}>;
export type Projection = Readonly<{
  owners: readonly OwnerProgress[];
  officialHistory: readonly OfficialObservation[];
  sourceOnly: readonly OfficialObservation[];
  holdReasons: readonly string[];
  creditEvidence: Readonly<{ knownOfficialCredits: number | null; additionalCredits: 0 }>;
  createdOfferingCount: 0;
}>;
export type ProjectionInput = Readonly<{
  graph: Pick<AttemptGraph, 'attempts' | 'ownedRecords'>;
  officialObservations: readonly OfficialObservation[];
  associations: readonly Association[];
  enrollmentEvidence: readonly EnrollmentEvidence[];
  /** Already verified by F02. Null means no F02 result was supplied. */
  knownF02OfficialCredits: number | null;
  resolver?: TrustedEvidenceResolver;
}>;

function validOfficial(row: OfficialObservation): boolean {
  return !!row.observationId && !!row.source.revisionId && /^[a-f0-9]{64}$/i.test(row.source.rawSha256)
    && !!row.source.rowId && (row.aggregate === null || (Number.isFinite(row.aggregate) && row.aggregate >= 0))
    && (row.composition === null || (Number.isFinite(row.composition) && row.composition >= 0));
}
function slotKey(row: OfficialObservation): string | null {
  return typeof row.source.slotId !== 'string' || row.source.slotId.length === 0 ? null : JSON.stringify([
    row.source.revisionId, row.source.rawSha256, row.source.rowId, row.source.slotId,
  ]);
}
function sameSourceCoordinates(claim: NonNullable<EnrollmentEvidence['source']>, row: OfficialObservation): boolean {
  return claim.revisionId === row.source.revisionId && claim.rawSha256 === row.source.rawSha256
    && claim.rowId === row.source.rowId && claim.slotId === row.source.slotId;
}

/** Pure, fail-closed display projection. It never issues IDs, writes data, or infers receipts. */
export function projectProgress(input: ProjectionInput): Projection {
  const attempts = input.graph.attempts;
  const ids = new Set<string>();
  if (attempts.some(a => !a.id || ids.has(a.id) || (ids.add(a.id), false))) throw new Error('duplicate_or_missing_attempt_id');
  const recordIds = new Set<string>();
  for (const record of input.graph.ownedRecords) {
    if (!record.id || recordIds.has(record.id)) throw new Error('duplicate_or_missing_owned_record_id');
    recordIds.add(record.id);
    if (record.owner?.kind === 'attempt' && !ids.has(record.owner.attemptId)) throw new Error('dangling_owned_record');
  }
  const observationIds = new Set<string>();
  for (const row of input.officialObservations) {
    if (!validOfficial(row) || observationIds.has(row.observationId)) throw new Error('invalid_or_duplicate_official_observation');
    observationIds.add(row.observationId);
  }
  const claims = new Map<string, number>();
  const canonicalRows = new Map<string, number>();
  const canonicalClaims = new Map<string, number>();
  const rowById = new Map(input.officialObservations.map(row => [row.observationId, row]));
  for (const row of input.officialObservations) {
    const key = slotKey(row);
    if (key !== null) canonicalRows.set(key, (canonicalRows.get(key) ?? 0) + 1);
  }
  for (const claim of input.associations) {
    if (claim.attemptId && !ids.has(claim.attemptId)) throw new Error('dangling_association_attempt');
    if (claim.observationId && !observationIds.has(claim.observationId)) throw new Error('dangling_association_observation');
    if (claim.attemptId) claims.set(claim.attemptId, (claims.get(claim.attemptId) ?? 0) + 1);
    const row = claim.observationId ? rowById.get(claim.observationId) : undefined;
    const key = row ? slotKey(row) : null;
    if (key !== null) canonicalClaims.set(key, (canonicalClaims.get(key) ?? 0) + 1);
  }
  const verifiedRows = new Set<string>();
  const owners: OwnerProgress[] = attempts.map(attempt => {
    const records = input.graph.ownedRecords.filter(r => r.owner?.kind === 'attempt' && r.owner.attemptId === attempt.id);
    const candidateClaims = input.associations.filter(c => c.attemptId === attempt.id);
    const claim = candidateClaims.length === 1 ? candidateClaims[0] : null;
    const observation = claim?.observationId ? rowById.get(claim.observationId) : undefined;
    const key = observation ? slotKey(observation) : null;
    const exclusive = key !== null && canonicalRows.get(key) === 1 && canonicalClaims.get(key) === 1;
    const verified = !!(claim?.status === 'verified' && claim.receiptRef && observation && exclusive
      && claims.get(attempt.id) === 1
      && input.resolver?.sameAttempt?.(claim, attempt, observation));
    if (verified && observation) verifiedRows.add(observation.observationId);
    const enrollmentCandidates = observation ? input.enrollmentEvidence.filter(e => e.observationId === observation.observationId && e.attemptId === attempt.id) : [];
    const enrollmentClaim = enrollmentCandidates.length === 1 ? enrollmentCandidates[0] : null;
    const enrolled = !!(claim && claim.status !== 'conflict' && exclusive && enrollmentClaim?.status === 'verified_enrollment'
      && enrollmentClaim.receiptRef && enrollmentClaim.source && observation
      && sameSourceCoordinates(enrollmentClaim.source, observation)
      && input.resolver?.enrollment?.(enrollmentClaim, attempt, observation));
    const confirmedResult = verified && observation && observation.result !== 'unpublished' ? observation : null;
    const origin = confirmedResult ? 'official' : attempt.plan ? 'learner' : enrolled ? 'official_enrollment' : 'unconfirmed';
    const status = confirmedResult ? confirmedResult.result : attempt.plan?.status ?? (enrolled ? 'in_progress' : 'needs_review');
    const hold: string[] = [];
    if (attempt.identity.status !== 'confirmed') hold.push('identity_unresolved');
    const associationConflict = candidateClaims.length > 1 || claim?.status === 'conflict' || (key !== null && !exclusive);
    const sharedObservation = !!(claim?.observationId && input.associations.filter(c => c.observationId === claim.observationId).length > 1);
    if (associationConflict) hold.push('association_conflict');
    else if (claim && !verified) hold.push('association_unverified');
    if (key !== null && !exclusive) hold.push('canonical_slot_conflict');
    if (!attempt.plan && !enrolled) hold.push('enrollment_unverified');
    if (observation?.aggregate !== null && observation?.aggregate !== undefined && status !== 'earned') hold.push('official_aggregate_not_attempt_completion');
    const creditEvidence: CreditEvidence = {
      additionalCredits: 0,
      completionClaim: false,
      creditEarned: null,
      officialAggregate: observation?.aggregate ?? null,
      officialAggregateAssociation: observation ? verified ? 'verified' : 'unverified' : null,
      attemptAllocatedQuantity: null,
    };
    return {
      attemptId: attempt.id,
      editableProgress: attempt.membership.kind === 'active' && attempt.plan !== null,
      effectiveStatus: status,
      effectiveResult: confirmedResult?.result ?? null,
      resultOrigin: origin,
      effectiveGrade: confirmedResult?.grade ?? null,
      learnerOriginal: attempt,
      ownedRecords: records,
      officialHistory: verified && observation ? [observation] : [],
      unverifiedOfficialRefs: candidateClaims.filter(c => !verified && c.observationId !== null).map(c => c.observationId!),
      holdReasons: hold,
      creditEvidence,
      // Keep the old rejected-claim display label for one observation claimed twice;
      // the explicit association_conflict hold still prevents promotion.
      associationStatus: associationConflict ? sharedObservation && candidateClaims.length === 1 && claim?.status === 'verified' ? 'unverified' : 'conflict'
        : verified ? 'verified' : claim?.status === 'verified' ? 'unverified' : claim?.status ?? 'none',
    };
  });
  const globalHold = [...new Set(owners.flatMap(o => o.holdReasons))];
  return {
    owners,
    officialHistory: input.officialObservations,
    sourceOnly: input.officialObservations.filter(r => !verifiedRows.has(r.observationId)),
    holdReasons: globalHold,
    creditEvidence: { knownOfficialCredits: input.knownF02OfficialCredits, additionalCredits: 0 },
    createdOfferingCount: 0,
  };
}
