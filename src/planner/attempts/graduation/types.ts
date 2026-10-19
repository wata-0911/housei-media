import type { Attempt, AttemptGraph, AttemptId, AttemptValidationIssue } from '../types';
import type { RetainedState } from '../migration/contracts';
import type { CurriculumPlacement } from '../../institutional/types';
import type { GraduationProgress } from '../../graduation/graduationProgress';
import type { DerivedOfficialGraduationFacts } from '../../graduation/officialGraduationFacts';

/** A recorded amount is not a graduation allocation. Omission is not null or zero. */
export type RecordedQuantity =
  | { kind: 'omitted' }
  | { kind: 'unknown'; value: null }
  | { kind: 'zero'; value: 0 }
  | { kind: 'positive'; value: number };
export type GraduationAxis = 'completion' | 'ordinary' | 'schooling' | 'inProgress' | 'planned';
export type Decision<T> =
  | { status: 'supported'; value: T; reasons: string[] }
  | { status: 'held' | 'unsupported'; value: null; reasons: string[] };
export type AttemptHoldCode =
  | 'identity_unresolved' | 'placement_ambiguous' | 'placement_unresolved'
  | 'applicability_unverified' | 'method_evidence_insufficient' | 'official_year_unverified'
  | 'contribution_omitted' | 'contribution_unknown' | 'earned_order_unconfirmed'
  | 'official_overlap_possible' | 'official_matching_held' | 'official_detail_shared'
  | 'official_association_unverified' | 'completion_evidence_insufficient'
  | 'attempt_rule_unimplemented' | 'multiple_attempt_rule_unimplemented';
export type AttemptDiagnostic = {
  code: AttemptHoldCode;
  axes: GraduationAxis[];
  /** Entity-addressed paths (array entries by stable ID), not positional JSON pointers. */
  sourceRefs: string[];
};
/** Potential destinations only. No candidate is selected as an allocation. */
export type AttemptImpact = {
  extent: 'placements' | 'selected_scope_unknown' | 'none';
  scopeIds: string[];
  placementIds: string[];
  categories: string[];
  requirementIds: string[];
  cardIds: string[];
  referenceIds: string[];
};
export type AttemptGraduationInput = {
  attemptId: AttemptId;
  /** Exact independent record, including all candidates, original evidence and omissions. */
  record: Attempt;
  placementCandidates: CurriculumPlacement[];
  quantities: {
    composition: { authority: 'curriculum_placement'; placementId: string | null; quantity: RecordedQuantity };
    learnerContribution: { authority: 'learner'; quantity: RecordedQuantity };
    legacyRegistration: Array<{ authority: 'legacy_offering'; offeringId: string; quantity: RecordedQuantity }>;
  };
  official: {
    /** Exact Course identity proves ownership, including held official quantities.
     * An aggregate/detail pointer alone is never an exclusive association. */
    exclusiveAchievementIds: string[];
    possibleAchievementIds: string[];
    /** References are evidence candidates, never an assigned credit budget. */
    referencedStudyRecordIds: string[];
    sharedStudyRecordIds: string[];
  };
  evidence: {
    ownedRecordIds: string[];
    sameIdentityAttemptIds: AttemptId[];
    earnedOrder: number | null;
    ruleFamilies: string[];
    ruleSupport: Decision<never>;
  };
  /** Supported zero means an excluded INCREMENT, never a completed Course. */
  decisions: Record<GraduationAxis, Decision<number>>;
  diagnostics: AttemptDiagnostic[];
  impact: AttemptImpact;
};
export type AttemptGraduationResult =
  | { status: 'rejected'; diagnostics: AttemptValidationIssue[] }
  | {
    status: 'adapted'; graduationCheckComplete: false; sourceLinksReverified: false;
    source: { rawSha256: string; catalogSha256: string; sourceRevisionId: string; scopeId: string };
    graph: AttemptGraph;
    retained: RetainedState;
    attempts: AttemptGraduationInput[];
    unresolvedOwners: Array<{ recordId: string; sourceRef: string; reason: string }>;
    /** Unchanged existing rules over retained data only, WITHOUT any graph Attempt.
     * This is NOT the combined/new-model graduation result. */
    retainedProgress: GraduationProgress;
    /** Allocation INPUT budgets, not final ordinary or schooling graduation totals. */
    officialEvidence: DerivedOfficialGraduationFacts;
    /** Never sum raw contributions, detail credits, or facts with retainedProgress. */
    attemptImpacts: Array<{ attemptId: AttemptId; axes: GraduationAxis[]; impact: AttemptImpact }>;
  };
