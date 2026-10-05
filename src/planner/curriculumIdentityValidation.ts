import type { ImportedCourseAchievement } from './gradeImportApply';
import type { PlannerCatalog, PlannerState } from './plannerCatalog';

/** Legacy objects may omit the extension; partial or contradictory new identities cannot be saved. */
export function validImportedInstitutionalIdentity(row: ImportedCourseAchievement, catalog: PlannerCatalog): boolean {
  const fields = [row.curriculumCourseId, row.curriculumMatch, row.candidateCurriculumCourseIds, row.offeringMatch];
  if (fields.every(field => field === undefined)) return true;
  if (fields.some(field => field === undefined)) return false;
  const ids = row.candidateCurriculumCourseIds;
  if (!Array.isArray(ids) || !['exact_unique', 'ambiguous', 'unmatched'].includes(row.curriculumMatch!)
    || !['exact_unique', 'ambiguous', 'unmatched'].includes(row.offeringMatch!)) return false;
  const courses = new Set(catalog.curriculum?.courses.map(course => course.id) ?? []);
  if (ids.some(id => !courses.has(id))) return false;
  if (row.curriculumMatch === 'exact_unique') {
    if (!row.curriculumCourseId || ids.length !== 1 || ids[0] !== row.curriculumCourseId) return false;
  } else if (row.curriculumCourseId !== null || (row.curriculumMatch === 'unmatched' ? ids.length !== 0 : ids.length === 0)) return false;
  return true;
}

/** Persistence requires both internally valid institutional fields and compatible annual exact claims. */
export function validImportedCurriculumIdentity(row: ImportedCourseAchievement, catalog: PlannerCatalog): boolean {
  if (!validImportedInstitutionalIdentity(row, catalog)) return false;
  const ids = row.candidateCurriculumCourseIds!;
  // A legacy automatic representative can remain stored after migration, but its offeringMatch is not exact.
  if (row.offeringMatch !== 'exact_unique') return true;
  const offering = catalog.offerings.find(candidate => candidate.id === row.selectedOfferingId);
  if (!row.selectedOfferingId || !offering) return false;
  if (offering.curriculumCourseId) {
    return row.curriculumMatch === 'exact_unique'
      && row.curriculumCourseId === offering.curriculumCourseId
      && ids.length === 1 && ids[0] === offering.curriculumCourseId;
  }
  // Annual selection is exact independently of its curriculum relation. Stage A may
  // already have resolved one of the official candidates using imported source facts.
  const candidates = catalog.curriculum?.offeringRelations.find(relation => relation.offeringId === offering.id)?.candidateCurriculumCourseIds ?? [];
  if (row.curriculumMatch === 'exact_unique') return candidates.includes(row.curriculumCourseId!);
  return row.curriculumCourseId === null
    && row.curriculumMatch === (candidates.length > 0 ? 'ambiguous' : 'unmatched')
    && ids.length === candidates.length && new Set(ids).size === ids.length
    && ids.every(id => candidates.includes(id));
}

/** v22 catalog-refresh recovery, not a new match: retain the selection for review,
 * as v21 migration does, and downgrade only its stale annual exact assertion.
 * Never repair malformed institutional fields or promote ambiguous candidates.
 */
export function recoverImportedAnnualMatches(state: PlannerState, catalog: PlannerCatalog): PlannerState {
  if (!Array.isArray(state.importedCourseAchievements)) return state;
  let changed = false;
  const importedCourseAchievements = state.importedCourseAchievements.map(row => {
    if (!row || row.curriculumMatch !== 'exact_unique' || row.offeringMatch !== 'exact_unique'
      || typeof row.selectedOfferingId !== 'string' || row.selectedOfferingId.length === 0
      || !validImportedInstitutionalIdentity(row, catalog) || validImportedCurriculumIdentity(row, catalog)) return row;
    changed = true;
    return { ...row, offeringMatch: 'ambiguous' as const };
  });
  return changed ? { ...state, importedCourseAchievements } : state;
}
