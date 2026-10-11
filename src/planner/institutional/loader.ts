import type { CurriculumAuditRow, MappingAuditRow, IdentityDecision, IdentityStatus, InstitutionalCatalog, InstitutionalInput, InstitutionalRegistry } from './types';
import { validateInstitutionalInput } from './validation';

/** Pure conversion: no ID issuance, annual catalog import, storage, or date inference.
 * The trusted registry is pinned at issuance; inputs are detached before returning. */
export function loadInstitutionalCatalog(input: InstitutionalInput, registry: InstitutionalRegistry): InstitutionalCatalog {
  validateInstitutionalInput(input, registry);
  const sourceRevisionId = registry.sourceRevision.id;
  const decision = (row: CurriculumAuditRow | MappingAuditRow): IdentityDecision => ({
    oldEntityKind: 'oldMappingId' in row ? 'Mapping' : 'CurriculumCourse',
    oldId: 'oldMappingId' in row ? row.oldMappingId : row.oldCurriculumCourseId,
    sourceRevisionId, sourceDigest: row.sourceDigest, legacyDigest: row.legacyDigest,
    candidateAuditIds: row.candidateStableIds, adoptedStableId: row.adoptedStableId,
    status: row.status as IdentityStatus, historicalContinuityStatus: 'unverified',
    evidenceIds: 'officialEvidenceIds' in row ? row.officialEvidenceIds : row.evidenceIds,
    scopeIds: 'scopeId' in row ? [row.scopeId] : row.scopeIds,
    reason: row.reason, ruleId: row.ruleId, ruleVersion: row.ruleVersion, auditVersion: input.auditVersion,
  });
  const cc = new Map(input.curriculumRows.map(row => [row.oldCurriculumCourseId, row]));
  const mappings = new Map(input.mappingRows.map(row => [row.oldMappingId, row]));
  const rows = new Map(input.officialRows.map(row => [row.evidenceId, row]));
  const result: InstitutionalCatalog = {
    sourceRevision: registry.sourceRevision,
    scopes: registry.scopes,
    curriculumVersions: registry.curriculumVersions,
    institutionalCourses: registry.institutionalCourses.map(entry => {
      const row = cc.get(entry.oldCurriculumCourseId)!;
      const officialName = rows.get(row.evidenceIds.find(id => rows.has(id))!)!.canonicalName;
      return { id: entry.id, officialName, nameHistory: [{ name: officialName, sourceRevisionId, evidenceIds: row.evidenceIds }],
        status: 'documented', historicalContinuityStatus: 'unverified', identityDecision: decision(row) };
    }),
    placements: registry.placements.map(entry => {
      const mapping = mappings.get(entry.oldMappingId)!;
      const row = rows.get(entry.evidenceId)!;
      return { id: entry.id, curriculumVersionId: entry.curriculumVersionId, scopeId: entry.scopeId,
        placementRoleKey: entry.placementRoleKey, institutionalCourseId: mapping.adoptedStableId,
        candidateAuditIds: mapping.candidateStableIds,
        kind: mapping.status === 'unmatched' ? 'non_course_bucket' : 'course_placement',
        officialName: row.officialLabel, compositionCredits: row.curriculumCredits, category: row.category,
        field: row.field, requirementType: row.requirementType,
        methodConstraint: { requiredMethod: row.requiredMethod, marker: row.methodMarker, evidenceKind: row.methodEvidenceKind,
          status: mapping.status === 'conflict' ? 'conflict' : 'safe' },
        sourceRevisionId, officialRow: row,
        // A page-level note applies to the table even when it has no per-row marker.
        noteIds: input.notes.filter(note => note.printedPage === row.notesPage).map(note => note.evidenceId),
        ruleRef: { id: mapping.ruleId, version: mapping.ruleVersion }, identityDecision: decision(mapping),
        legacySnapshot: mapping.legacySnapshot, differences: mapping.differences, auditRecord: mapping,
      };
    }),
    curriculumAudit: input.curriculumRows,
    crosswalk: [...input.curriculumRows, ...input.mappingRows].map(decision),
    notes: input.notes, codes: input.codes, legacyDigests: input.legacyDigests,
    metadata: { graduationCheckComplete: false, sourceLinksReverified: false, historicalContinuityStatus: 'unverified' },
  };
  return structuredClone(result);
}
