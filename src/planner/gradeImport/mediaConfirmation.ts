import type { ImportedCourseAchievement } from './gradeImportApply';
import type { ImportedMediaAchievement, ImportedMediaPending } from './importedAchievementCalculations';

export function canConfirmMedia(row: ImportedCourseAchievement | undefined) {
  return !!row && (row.selectionSource ?? (row.selectedOfferingId ? 'manual' : 'none')) !== 'manual';
}

export type MediaConfirmation = { sourceCourseId: string; offeringId: string; reviewedRaw: string | null };

/** Resolve only candidates derived for this source in the current saved state. */
export function mediaConfirmationPatch(
  request: MediaConfirmation, currentRaw: string | null, rows: ImportedCourseAchievement[],
  pending: ImportedMediaPending[], history: ImportedMediaAchievement[],
): Partial<ImportedCourseAchievement> | null {
  if (request.reviewedRaw !== currentRaw) return null;
  const owners = rows.filter(row => row.id === request.sourceCourseId);
  if (owners.length !== 1 || !canConfirmMedia(owners[0])) return null;
  const waiting = pending.find(row => row.sourceCourseId === request.sourceCourseId);
  const offering = waiting
    ? waiting.candidates.find(candidate => candidate.id === request.offeringId)
    : history.find(row => row.sourceCourseId === request.sourceCourseId && row.offering.id === request.offeringId)?.offering;
  if (!offering) return null;
  return { selectedOfferingId: offering.id, selectionSource: 'manual', courseId: offering.courseId,
    match: offering.courseId && offering.resolutionStatus === 'matched' ? 'exact_unique' : 'ambiguous' };
}

/** The common update boundary preserves ambiguous owners and semantic no-ops. */
export function importedCoursesAfterPatch(
  rows: ImportedCourseAchievement[], id: string, patch: Partial<ImportedCourseAchievement>,
): ImportedCourseAchievement[] | null {
  const owners = rows.filter(row => row.id === id);
  if (owners.length !== 1) return null;
  const row = owners[0];
  const changed = (Object.keys(patch) as (keyof ImportedCourseAchievement)[]).some(key => {
    const before = row[key], after = patch[key];
    if ((key === 'candidateOfferingIds' || key === 'candidateCurriculumCourseIds')
      && Array.isArray(before) && Array.isArray(after)) {
      return before.length !== after.length || before.some((value, index) => value !== after[index]);
    }
    return !(before === after || Object.is(before, after));
  });
  if (!changed) return null;
  return rows.map(current => current === row ? { ...row, ...patch } : current);
}
