import type { Attempt, AttemptValidationIssue } from '../types';
import type { SourceArchive, RetainedState } from '../migration/contracts';
import type { ImportedCourseAchievement, ImportedStudyRecord } from '../../gradeImport/gradeImportApply';
import type { AttemptGraduationInput, AttemptGraduationResult, Decision, RecordedQuantity } from './types';

/** These are missing proof obligations, NOT accepted attestation formats. */
export type EvidenceRequirement =
  | 'reviewed_course_identity' | 'unique_reviewed_placement'
  | 'official_learner_program' | 'official_admission_context'
  | 'official_curriculum_transition_history' | 'reviewed_applicability_rules'
  | 'official_attempt_method' | 'official_attempt_academic_year'
  | 'same_course_aggregate' | 'official_attempt_detail_binding' | 'exclusive_detail_assignment'
  | 'reviewed_evidence_kind' | 'implemented_allocation_rule';
export type EvidenceReference = {
  sourceRef: string;
  sourceRevisionId: string;
  /** The local source snapshot, not a signature from the university. */
  sourceRawSha256: string | null;
};
export type EvidenceDecision<T> = Decision<T> & {
  missingEvidence: EvidenceRequirement[];
  references: EvidenceReference[];
};
/** Out-of-band, read-only submission. No kind is an accepted official proof yet.
 * Does not extend Attempt/persistence/backup schemas. Never fetches references. */
export type EvidenceSubmission = {
  attemptId: string;
  kind: string;
  sourceRevisionId: string;
  sourceRefs: string[];
};
export type OfficialRecordedQuantities = {
  ordinary: RecordedQuantity;
  schooling: RecordedQuantity;
  composition: RecordedQuantity;
};
export type AggregateEvidence = {
  record: ImportedCourseAchievement;
  referenceExists: EvidenceDecision<string>;
  courseIdentity: EvidenceDecision<string>;
  /** Course-level ownership only. Does NOT assign any detail to an Attempt. */
  incrementOwnership: EvidenceDecision<string>;
  explicitlyReferenced: boolean;
  possibleOverlap: boolean;
  quantities: OfficialRecordedQuantities;
};
export type DetailEvidence = {
  record: ImportedStudyRecord;
  referenceExists: EvidenceDecision<string>;
  /** Identity of the parent aggregate; NOT independent detail/Attempt identity. */
  parentCourseIdentity: EvidenceDecision<string>;
  attemptAssociation: EvidenceDecision<never>;
  exclusivity: EvidenceDecision<never>;
  referencingAttemptIds: string[];
  quantities: OfficialRecordedQuantities & { component: RecordedQuantity };
};
export type AttemptEvidenceAssessment = {
  attemptId: string;
  record: Attempt;
  identity: EvidenceDecision<string>;
  placement: EvidenceDecision<string>;
  placementCandidates: AttemptGraduationInput['placementCandidates'];
  applicability: { recordedStatus: Attempt['applicability']['status']; decision: EvidenceDecision<never> };
  method: { record: Attempt['method']; decision: EvidenceDecision<never> };
  actualYear: { record: Attempt['actualYear']; decision: EvidenceDecision<never> };
  quantities: AttemptGraduationInput['quantities'];
  official: { aggregates: AggregateEvidence[]; details: DetailEvidence[] };
  /** Unchanged stage-1 decisions; supported 0 is exclusion, never completion. */
  graduation: Record<keyof AttemptGraduationInput['decisions'], EvidenceDecision<number>>;
  impact: AttemptGraduationInput['impact'];
  ruleSupport: EvidenceDecision<never>;
};
type Adapted = Extract<AttemptGraduationResult, { status: 'adapted' }>;
export type AttemptEvidenceInput = { graph: unknown; retained: RetainedState; submittedEvidence?: readonly EvidenceSubmission[] };
export type AttemptEvidenceResult =
  | { status: 'rejected'; diagnostics: AttemptValidationIssue[] }
  | {
    status: 'assessed'; graduationCheckComplete: false; sourceLinksReverified: false;
    source: Adapted['source'];
    attempts: AttemptEvidenceAssessment[];
    submittedEvidence: Array<{ record: EvidenceSubmission; decision: EvidenceDecision<never> }>;
    /** Existing source-only result; never a combined graduation determination. */
    retainedProgress: Adapted['retainedProgress'];
    officialEvidence: Adapted['officialEvidence'];
  };
export type EvidenceSource = SourceArchive;
