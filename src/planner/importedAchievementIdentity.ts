import type { ImportedCourseAchievement } from './gradeImportApply';
import { normalizeImportBaseName } from './importedAchievementRepair';
import type { Offering } from './plannerCatalog';

function oneMatchedCourseId(candidates: Iterable<Offering>) {
  const courseIds = [...new Set([...candidates]
    .filter(offering => offering.resolutionStatus === 'matched')
    .map(offering => offering.courseId)
    .filter((courseId): courseId is string => courseId !== null))];
  return courseIds.length === 1 ? courseIds[0] : null;
}

/**
 * Resolves a display-time-only identity for an imported achievement.  This
 * deliberately never changes the source row: repair and candidate evidence
 * are useful conclusions, not new official import facts.
 */
export function resolveSafeImportedCourseId(row: ImportedCourseAchievement, offerings: Map<string, Offering>): string | null {
  const selectionSource = row.selectionSource ?? (row.selectedOfferingId ? 'manual' : 'none');
  if (selectionSource === 'manual') {
    const selected = row.selectedOfferingId ? offerings.get(row.selectedOfferingId) : undefined;
    // An explicit selection is authoritative, but only when it confirms the
    // source identity written at the time of that selection. Do not fall back
    // to name/candidate inference if those facts disagree.
    return selected?.resolutionStatus === 'matched' && selected.courseId !== null && selected.courseId === row.courseId
      ? selected.courseId
      : null;
  }

  if (row.courseId && row.match === 'exact_unique'
    && [...offerings.values()].some(offering => offering.resolutionStatus === 'matched' && offering.courseId === row.courseId)) return row.courseId;

  const repairedCourseId = oneMatchedCourseId([...offerings.values()]
    .filter(offering => normalizeImportBaseName(offering.name) === normalizeImportBaseName(row.rawName)));
  if (repairedCourseId) return repairedCourseId;

  return oneMatchedCourseId(row.candidateOfferingIds
    .map(offeringId => offerings.get(offeringId))
    .filter((offering): offering is Offering => offering !== undefined));
}
