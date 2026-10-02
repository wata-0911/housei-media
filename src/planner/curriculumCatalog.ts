import data from '../data/planner_curriculum_2026.json';
import type { CurriculumCatalog, PlannerCatalog } from './plannerCatalog';

export const curriculumCatalog = data as CurriculumCatalog;

/** Join generated, explicit mapping relations once at catalog load. No runtime name matching. */
export function attachCurriculumCatalog(catalog: PlannerCatalog, curriculum = curriculumCatalog): PlannerCatalog {
  const byMapping = new Map(catalog.mappings.map(mapping => [mapping.mappingId, mapping]));
  const courses = new Set<string>();
  const usedMappings = new Set<string>();
  for (const course of curriculum.courses) {
    if (courses.has(course.id) || course.mappingIds.length === 0) throw new Error('Duplicate/empty curriculum identity');
    courses.add(course.id);
    for (const id of course.mappingIds) {
      const mapping = byMapping.get(id);
      if (!mapping || usedMappings.has(id) || mapping.curriculumCredits !== course.curriculumCredits || !course.scopeIds.includes(mapping.scopeId)) throw new Error('Invalid curriculum mapping');
      usedMappings.add(id);
    }
  }
  if (usedMappings.size !== catalog.mappings.length) throw new Error('Incomplete curriculum master');
  const relations = new Map(curriculum.offeringRelations.map(relation => [relation.offeringId, relation]));
  if (relations.size !== catalog.offerings.length || relations.size !== curriculum.offeringRelations.length) throw new Error('Invalid annual relation coverage');
  const courseByMapping = new Map(curriculum.courses.flatMap(course => course.mappingIds.map(id => [id, course.id] as const)));
  return { ...catalog, curriculum, offerings: catalog.offerings.map(offering => {
    const relation = relations.get(offering.id);
    const ids = offering.resolutionStatus === 'matched' ? [...new Set(offering.mappingIds.map(id => courseByMapping.get(id)!))].sort() : [];
    if (!relation || JSON.stringify(ids) !== JSON.stringify(relation.candidateCurriculumCourseIds)
      || relation.curriculumCourseId !== (ids.length === 1 ? ids[0] : null)) throw new Error('Stale annual curriculum relation');
    return { ...offering, curriculumCourseId: relation.curriculumCourseId };
  }) };
}
