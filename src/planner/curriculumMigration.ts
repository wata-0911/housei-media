import type { ImportedCourseAchievement, ImportMatch } from './gradeImportApply';
import type { PlannerCatalog, PlannerState } from './plannerCatalog';
import { validImportedCurriculumIdentity } from './curriculumIdentityValidation';

/** Add institutional identity without rewriting any v21 field or imported source fact. */
export function migrateCurriculumState(state: PlannerState, catalog: PlannerCatalog): PlannerState {
  if ((state.schemaVersion as number) === 22) return state;
  const curriculum = catalog.curriculum;
  const byOffering = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const byRelation = new Map(curriculum?.offeringRelations.map(relation => [relation.offeringId, relation]) ?? []);
  const candidatesFor = (id: string): string[] => {
    const offering = byOffering.get(id);
    if (!offering) return [];
    return offering.curriculumCourseId ? [offering.curriculumCourseId] : byRelation.get(id)?.candidateCurriculumCourseIds ?? [];
  };
  const legacy = new Map(curriculum?.legacyCourseRelations.map(relation => [relation.legacyCourseId, relation]) ?? []);
  const importedCourseAchievements = state.importedCourseAchievements.map(row => {
    const selected = row.selectedOfferingId ? byOffering.get(row.selectedOfferingId) : undefined;
    const crosswalk = row.courseId ? legacy.get(row.courseId) : undefined;
    const offeringIds = [...new Set([...row.candidateOfferingIds, ...(row.selectedOfferingId ? [row.selectedOfferingId] : [])])];
    let courseId: string | null = null;
    let candidates: string[] = [];
    if (row.selectionSource === 'manual') {
      // Retain an independently safe crosswalk; selection cannot silently replace it.
      // Contradictory old selections remain stored for review with an ambiguous annual match.
      if (crosswalk?.curriculumCourseId) {
        courseId = crosswalk.curriculumCourseId;
        candidates = [courseId];
      } else {
        candidates = selected ? candidatesFor(selected.id) : [...new Set([
          ...(crosswalk?.candidateCurriculumCourseIds ?? []),
          ...offeringIds.flatMap(candidatesFor),
        ])].sort();
      }
      if (!courseId && selected?.resolutionStatus === 'matched' && selected.courseId === row.courseId) {
        courseId = selected.curriculumCourseId ?? null;
      }
    } else if (row.courseId) {
      courseId = crosswalk?.curriculumCourseId ?? null;
      candidates = courseId ? [courseId] : [...new Set([
        ...(crosswalk?.candidateCurriculumCourseIds ?? []),
        ...offeringIds.flatMap(candidatesFor),
      ])].sort();
    } else {
      const relations = offeringIds.map(id => byOffering.get(id));
      candidates = [...new Set(offeringIds.flatMap(candidatesFor))].sort();
      if (relations.length > 0 && relations.every(offering => offering?.resolutionStatus === 'matched' && offering.curriculumCourseId) && candidates.length === 1) courseId = candidates[0];
    }
    const curriculumMatch: ImportMatch = courseId ? 'exact_unique' : candidates.length ? 'ambiguous' : 'unmatched';
    const offeringMatch: ImportMatch = row.selectionSource === 'manual' && selected ? 'exact_unique'
      : row.candidateOfferingIds.length === 1 && selected?.id === row.candidateOfferingIds[0] ? 'exact_unique'
      : row.candidateOfferingIds.length > 0 || selected ? 'ambiguous' : 'unmatched';
    const migrated = { ...row, curriculumCourseId: courseId, curriculumMatch, candidateCurriculumCourseIds: candidates, offeringMatch } satisfies ImportedCourseAchievement;
    if (offeringMatch === 'exact_unique' && !validImportedCurriculumIdentity(migrated, catalog)) migrated.offeringMatch = 'ambiguous';
    return migrated;
  });
  return { ...state, schemaVersion: 22, importedCourseAchievements };
}
