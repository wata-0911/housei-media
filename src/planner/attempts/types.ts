import type {
  CorrespondenceCourseProgress, CourseEvaluation, MediaCourseProgress, PlannerItem, PlannerTodo,
} from '../plannerCatalog';
import type { Applicability, InstitutionalCatalog, LegacyArchive } from '../institutional/types';

/** Allocated once using random UUIDv4; never derived from course/year/Offering/index. */
export type AttemptId = `hosei:attempt:${string}`;
export type AttemptOperationId = `hosei:attempt-op:${string}`;
export type OwnedRecordId = `hosei:owned:${string}`;
export type UnresolvedStatus = 'unmatched' | 'ambiguous' | 'conflict' | 'unknown';
export type DocumentEvidence = { sourceRevisionId: string; evidenceIds: string[] };
/** Audit candidates are old identities, not confirmed InstitutionalCourse refs. */
export type Resolution<T> =
  | { status: 'confirmed'; ref: T; candidateAuditIds: string[]; reason: null }
  | { status: UnresolvedStatus; ref: null; candidateAuditIds: string[]; reason: string };
export type PlacementResolution = Resolution<PlacementRef> & { candidatePlacementIds: string[] };
export type CourseRef = DocumentEvidence & { institutionalCourseId: string };
export type PlacementRef = DocumentEvidence & { placementId: string; curriculumVersionId: string; scopeId: string };

/** Raw byte digests of ALL six source files, distinct from backup semantic digests. */
export type AttemptLegacyRef = {
  status: 'known' | 'unknown';
  entityKind: 'Offering' | 'legacyCourse' | 'CurriculumCourse' | 'Mapping';
  oldId: string;
  sourceRevisionId: string;
  sourceDigest: string;
  legacyDigests: Record<string, string>;
  reason: string | null;
};
export type AttemptEvidence =
  | { kind: 'learner'; note: string }
  | { kind: 'document'; ref: DocumentEvidence }
  | { kind: 'legacy'; ref: AttemptLegacyRef }
  | { kind: 'official_detail'; studyRecordId: string };
export type AttemptMethod = {
  value: 'correspondence' | 'schooling' | 'media' | 'unknown';
  source: 'learner' | 'legacy_reference' | 'official_detail' | 'unknown';
  evidence: AttemptEvidence | null;
};
export type AttemptActualYear = {
  value: number | null;
  source: 'manual' | 'source' | 'inferred' | 'unknown';
  evidence: AttemptEvidence | null;
  /** Required explanation for inferred context; inference does not assert official year. */
  reason: string | null;
};
export type AttemptPlan = Pick<PlannerItem, 'status' | 'plannedYear' | 'plannedTerm' | 'studyYear' | 'earnedOrder'> & {
  /** Absent != explicitly unknown null != explicitly recorded zero. No credit fallback. */
  contribution?: { value: number | null; source: 'learner'; note: string | null };
  /** Retains the old explicit source link only; does not own/copy its official values. */
  importedSourceCourseId?: string;
};
export type AttemptMembership =
  | { kind: 'active' }
  | { kind: 'detached'; reason: 'plan_deleted'; deletionOperationId: AttemptOperationId }
  | { kind: 'detached'; reason: 'legacy_orphan'; deletionOperationId: null };
export type Attempt = {
  readonly id: AttemptId;
  /** Retry uses this same operation ID AND Attempt ID. Intentional addition uses new IDs. */
  readonly creationOperationId: AttemptOperationId;
  originalTitle: string;
  identity: Resolution<CourseRef>;
  placement: PlacementResolution;
  applicability: {
    status: 'unknown' | 'unverified' | 'confirmed';
    curriculumVersionId: string | null;
    scopeId: string | null;
    legacyApplicability: Applicability;
    originalValue: string | null;
    evidence: DocumentEvidence | null;
  };
  legacyRefs: AttemptLegacyRef[];
  membership: AttemptMembership;
  /** Orphan progress need not invent a plan, status, contribution or earned order. */
  plan: AttemptPlan | null;
  method: AttemptMethod;
  actualYear: AttemptActualYear;
};
export type AttemptOwner = { kind: 'attempt'; attemptId: AttemptId };
export type LegacyOwner = { kind: 'unresolved_legacy'; ref: AttemptLegacyRef; reason: string };
export type ProgressOwner = AttemptOwner | LegacyOwner;
export type AttemptOwnedRecord =
  | { readonly id: OwnedRecordId; kind: 'media'; owner: ProgressOwner; payload: Omit<MediaCourseProgress, 'offeringId'> }
  | { readonly id: OwnedRecordId; kind: 'correspondence'; owner: ProgressOwner; payload: Omit<CorrespondenceCourseProgress, 'offeringId'> }
  | { readonly id: OwnedRecordId; kind: 'evaluation'; owner: ProgressOwner; payload: Omit<CourseEvaluation, 'offeringId'> }
  | { readonly id: OwnedRecordId; kind: 'todo'; owner: ProgressOwner | null; payload: Omit<PlannerTodo, 'offeringId'> };
export type AttemptRemoval = {
  operationId: AttemptOperationId;
  /** Complete original active record, including the immutable ID. */
  attemptSnapshot: Attempt;
  previousPosition: number;
};
/** Independent domain contract, NOT PlannerState or a new backup/storage schema. */
export type AttemptGraph = {
  attempts: Attempt[];
  ownedRecords: AttemptOwnedRecord[];
  removals: AttemptRemoval[];
};
/** Trusted prevalidated YI-02 master/archive; source IDs from the source decoder. */
export type AttemptValidationContext = {
  catalog: InstitutionalCatalog;
  legacyArchive?: LegacyArchive;
  officialAchievementIds: readonly string[];
  officialStudyRecordIds: readonly string[];
};
export type AttemptValidationIssue = { code: string; path: string; message: string };
export type AttemptValidationResult = { valid: boolean; issues: AttemptValidationIssue[] };
