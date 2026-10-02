import type { ImportedCourseAchievement } from './gradeImportApply';
import type { PlannerCatalog } from './plannerCatalog';

/** Legacy objects may omit the extension; partial or contradictory new identities cannot be saved. */
export function validImportedCurriculumIdentity(row: ImportedCourseAchievement, catalog: PlannerCatalog): boolean {
  const fields = [row.curriculumCourseId, row.curriculumMatch, row.candidateCurriculumCourseIds, row.offeringMatch];
  if (fields.every(field => field === undefined)) return true;
  if (fields.some(field => field === undefined)) return false;
  const ids = row.candidateCurriculumCourseIds!;
  const courses = new Set(catalog.curriculum?.courses.map(course => course.id) ?? []);
  if (catalog.curriculum && ids.some(id => !courses.has(id))) return false;
  if (row.curriculumMatch === 'exact_unique') {
    if (!row.curriculumCourseId || ids.length !== 1 || ids[0] !== row.curriculumCourseId) return false;
  } else if (row.curriculumCourseId !== null || (row.curriculumMatch === 'unmatched' ? ids.length !== 0 : ids.length === 0)) return false;
  // A legacy automatic representative can remain stored after migration, but its offeringMatch is not exact.
  if (row.offeringMatch === 'exact_unique' && !row.selectedOfferingId) return false;
  return true;
}
