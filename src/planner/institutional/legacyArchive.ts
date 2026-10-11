import type { InstitutionalCatalog, LegacyArchive } from './types';
import { requireInvariant, sameDigests, sameSet, uniqueIndex, idPattern } from './validation';

/** Optional compatibility archive. Its absence/empty offerings cannot block the master.
 * Relations are legacy candidates, never a route to stable identity promotion. */
export function validateInstitutionalLegacyArchive(catalog: InstitutionalCatalog, archive: LegacyArchive): void {
  requireInvariant(sameDigests(archive.sourceDigests, catalog.legacyDigests), 'archive raw digest mismatch');
  const mappings = new Set(catalog.placements.map(p => p.identityDecision.oldId));
  const cc = new Set(catalog.curriculumAudit.map(c => c.oldCurriculumCourseId));
  const offerings = uniqueIndex(archive.offeringEdges, r => r.offeringId);
  const courses = uniqueIndex(archive.legacyCourseRelations, r => r.legacyCourseId);
  const checkRelation = (relation: { curriculumCourseId: string | null; candidateCurriculumCourseIds: string[] }) => {
    requireInvariant(relation.candidateCurriculumCourseIds.every(id => cc.has(id))
      && new Set(relation.candidateCurriculumCourseIds).size === relation.candidateCurriculumCourseIds.length
      && (relation.curriculumCourseId === null || (relation.candidateCurriculumCourseIds.length === 1
        && relation.curriculumCourseId === relation.candidateCurriculumCourseIds[0])), 'dangling/invalid archive relation');
  };
  for (const relation of courses.values()) {
    requireInvariant(idPattern('').test(relation.legacyCourseId), 'unknown legacy Course namespace');
    checkRelation(relation);
  }
  for (const edge of offerings.values()) {
    requireInvariant(idPattern('').test(edge.offeringId) && edge.mappingIds.every(id => mappings.has(id))
      && (edge.legacyCourseId === null || courses.has(edge.legacyCourseId))
      && edge.relation.offeringId === edge.offeringId, 'dangling archive edge');
    checkRelation(edge.relation);
    const candidates = [...new Set(catalog.placements.filter(p => (edge.mappingIds as string[]).includes(p.identityDecision.oldId))
      .map(p => p.auditRecord.oldCurriculumCourseId))];
    requireInvariant(sameSet(candidates, edge.relation.candidateCurriculumCourseIds), 'archive candidate membership mismatch');
  }
}

export function resolveInstitutionalArchiveRef(catalog: InstitutionalCatalog, archive: LegacyArchive, ref: {
  oldEntityKind: 'Offering' | 'legacyCourse'; oldId: string; legacyDigest: string; sourceDigest: string;
}) {
  validateInstitutionalLegacyArchive(catalog, archive);
  requireInvariant(ref.sourceDigest === catalog.sourceRevision.sha256
    && ref.legacyDigest === catalog.legacyDigests['src/data/planner_catalog_2026.json'], 'archive revision mismatch');
  const relation = ref.oldEntityKind === 'Offering' ? archive.offeringEdges.find(r => r.offeringId === ref.oldId)?.relation
    : ref.oldEntityKind === 'legacyCourse' ? archive.legacyCourseRelations.find(r => r.legacyCourseId === ref.oldId) : undefined;
  requireInvariant(relation, 'unknown archive entity');
  // Return ALL source candidates and their decisions, retaining even non-safe unique relations.
  return { legacyRelation: relation, decisions: catalog.crosswalk.filter(d => d.oldEntityKind === 'CurriculumCourse'
    && relation.candidateCurriculumCourseIds.includes(d.oldId)) };
}
