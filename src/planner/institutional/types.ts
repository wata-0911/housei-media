import type curriculumAudit from '../../../docs/planner-yi-01/curriculum-crosswalk.json';
import type mappingAudit from '../../../docs/planner-yi-01/mapping-crosswalk.json';
import type officialRows from '../../../docs/planner-yi-01/official-rows.json';
import type officialNotes from '../../../docs/planner-yi-01/official-notes.json';
import type officialCodes from '../../../docs/planner-yi-01/official-codes.json';
import type legacyRelations from '../../../docs/planner-yi-01/legacy-relations.json';
import type registry from '../../data/institutional_registry.json';

/** YI-01 is a revision-bound evidence format, separate from PlannerCatalog/state. */
export type CurriculumAuditRow = (typeof curriculumAudit.rows)[number];
export type MappingAuditRow = Omit<(typeof mappingAudit.rows)[number], 'differences'> & { differences: Record<string, unknown> };
export type OfficialRow = (typeof officialRows.rows)[number];
export type OfficialNote = (typeof officialNotes.rows)[number];
export type OfficialCode = (typeof officialCodes.rows)[number];
export type LegacyArchive = typeof legacyRelations;
export type InstitutionalRegistry = typeof registry;
export type SourceRevision = InstitutionalRegistry['sourceRevision'];
export type CurriculumVersion = InstitutionalRegistry['curriculumVersions'][number];
export type InstitutionalScope = InstitutionalRegistry['scopes'][number];
export type IdentityStatus = 'safe' | 'ambiguous' | 'conflict' | 'unmatched';
export type Applicability = 'current_2026' | 'legacy_or_transition' | 'unknown';
export type InstitutionalInput = {
  auditVersion: number;
  sourceDigest: string;
  legacyDigests: Record<string, string>;
  curriculumRows: CurriculumAuditRow[];
  mappingRows: MappingAuditRow[];
  officialRows: OfficialRow[];
  notes: OfficialNote[];
  codes: OfficialCode[];
};
export type IdentityDecision = {
  oldEntityKind: 'CurriculumCourse' | 'Mapping';
  oldId: string;
  sourceRevisionId: string;
  sourceDigest: string;
  legacyDigest: string;
  /** Audit candidates can include unadopted legacy IDs; these are NOT master refs. */
  candidateAuditIds: string[];
  adoptedStableId: string | null;
  status: IdentityStatus;
  historicalContinuityStatus: 'unverified';
  evidenceIds: string[];
  scopeIds: string[];
  reason: string[];
  ruleId: string;
  ruleVersion: number;
  auditVersion: number;
};
export type InstitutionalCourse = {
  id: string;
  officialName: string;
  nameHistory: { name: string; sourceRevisionId: string; evidenceIds: string[] }[];
  status: 'documented' | 'unresolved' | 'retired';
  historicalContinuityStatus: 'unverified';
  identityDecision: IdentityDecision;
};
export type CurriculumPlacement = {
  id: string;
  curriculumVersionId: string;
  scopeId: string;
  placementRoleKey: string;
  institutionalCourseId: string | null;
  candidateAuditIds: string[];
  kind: 'course_placement' | 'non_course_bucket';
  officialName: string;
  compositionCredits: number | null;
  category: string;
  field: string | null;
  requirementType: string;
  methodConstraint: { requiredMethod: string | null; marker: string | null; evidenceKind: string | null; status: 'safe' | 'conflict' };
  sourceRevisionId: string;
  officialRow: OfficialRow;
  noteIds: string[];
  ruleRef: { id: string; version: number };
  identityDecision: IdentityDecision;
  /** Both sides of conflicts remain available; no repair of old booleans. */
  legacySnapshot: MappingAuditRow['legacySnapshot'];
  differences: Record<string, unknown>;
  auditRecord: MappingAuditRow;
};
export type InstitutionalCatalog = {
  sourceRevision: SourceRevision;
  scopes: InstitutionalScope[];
  curriculumVersions: CurriculumVersion[];
  institutionalCourses: InstitutionalCourse[];
  placements: CurriculumPlacement[];
  curriculumAudit: CurriculumAuditRow[];
  crosswalk: IdentityDecision[];
  notes: OfficialNote[];
  codes: OfficialCode[];
  legacyDigests: Record<string, string>;
  metadata: { graduationCheckComplete: false; sourceLinksReverified: false; historicalContinuityStatus: 'unverified' };
};
