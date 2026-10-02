import type { ImportedCourseAchievement, ImportMatch } from './gradeImportApply';
import type { PlannerCatalog, PlannerState } from './plannerCatalog';

/** Add institutional identity without rewriting any v21 field or imported source fact. */
export function migrateCurriculumState(state: PlannerState, catalog: PlannerCatalog): PlannerState {
  if ((state.schemaVersion as number) === 22) return state;
  const curriculum = catalog.curriculum;
  const byOffering = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const legacy = new Map(curriculum?.legacyCourseRelations.map(relation => [relation.legacyCourseId, relation]) ?? []);
  const importedCourseAchievements = state.importedCourseAchievements.map(row => {
    const selected = row.selectedOfferingId ? byOffering.get(row.selectedOfferingId) : undefined;
    const crosswalk = row.courseId ? legacy.get(row.courseId) : undefined;
    let courseId: string | null = null;
    let candidates: string[] = [];
    if (row.selectionSource === 'manual') {
      // Manual selection remains authoritative; inconsistent old identity stays unresolved.
      if (selected?.resolutionStatus === 'matched' && selected.courseId === row.courseId) {
        courseId = selected.curriculumCourseId ?? null;
        candidates = courseId ? [courseId] : [];
      }
    } else if (row.courseId) {
      courseId = crosswalk?.curriculumCourseId ?? null;
      candidates = crosswalk?.candidateCurriculumCourseIds ?? [];
    } else {
      const relations = row.candidateOfferingIds.map(id => byOffering.get(id));
      candidates = [...new Set(relations.flatMap(offering => offering?.curriculumCourseId ? [offering.curriculumCourseId] : []))].sort();
      if (relations.length > 0 && relations.every(offering => offering?.resolutionStatus === 'matched' && offering.curriculumCourseId) && candidates.length === 1) courseId = candidates[0];
    }
    const curriculumMatch: ImportMatch = courseId ? 'exact_unique' : candidates.length ? 'ambiguous' : 'unmatched';
    const offeringMatch: ImportMatch = row.selectionSource === 'manual' && selected ? 'exact_unique'
      : row.candidateOfferingIds.length === 1 && selected?.id === row.candidateOfferingIds[0] ? 'exact_unique'
      : row.candidateOfferingIds.length > 0 ? 'ambiguous' : 'unmatched';
    return { ...row, curriculumCourseId: courseId, curriculumMatch, candidateCurriculumCourseIds: candidates, offeringMatch } satisfies ImportedCourseAchievement;
  });
  return { ...state, schemaVersion: 22, importedCourseAchievements };
}
