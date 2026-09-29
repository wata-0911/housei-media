import { normalizeImportName, type ImportedCourseAchievement, type ImportedStudyRecord } from './gradeImportApply';
import type { Offering, PlannerCatalog, PlannerState } from './plannerCatalog';

export type ImportedAchievementRepair = { state: PlannerState; repaired: boolean; warnings: string[] };

function isManual(row: ImportedCourseAchievement) { return row.selectionSource === 'manual'; }
function matchedNameOfferings(name: string, catalog: PlannerCatalog) {
  const normalized = normalizeImportName(name);
  return catalog.offerings.filter(offering => offering.resolutionStatus === 'matched' && offering.courseId !== null && normalizeImportName(offering.name) === normalized);
}
function oneCourseId(candidates: Offering[]) {
  const ids = [...new Set(candidates.map(candidate => candidate.courseId).filter((id): id is string => id !== null))];
  return ids.length === 1 ? ids[0] : null;
}
function sameAggregate(record: ImportedStudyRecord, row: ImportedCourseAchievement) {
  const facts: Array<[number | null | undefined, number | null]> = [
    [record.earnedCreditsTotal, row.earnedCreditsTotal],
    [record.schoolingCreditsTotal, row.schoolingCreditsTotal],
    [record.compositionCredits, row.compositionCredits],
  ];
  return facts.every(([component, source]) => component === undefined || component === source);
}

/** Repairs only facts that can be determined without guessing. */
export function repairImportedAchievements(state: PlannerState, catalog: PlannerCatalog): ImportedAchievementRepair {
  let repaired = false;
  const warnings: string[] = [];
  const rows = state.importedCourseAchievements.map(row => {
    if (isManual(row) || row.categoryRaw !== null || row.courseId !== null) return row;
    const candidates = matchedNameOfferings(row.rawName, catalog);
    const courseId = oneCourseId(candidates);
    if (!courseId) return row;
    const courseCandidates = candidates.filter(candidate => candidate.courseId === courseId);
    const selected = courseCandidates.length === 1 ? courseCandidates[0] : null;
    repaired = true;
    return { ...row, courseId, selectedOfferingId: selected?.id ?? row.selectedOfferingId, selectionSource: 'auto' as const, match: 'exact_unique' as const, candidateOfferingIds: [...new Set([...row.candidateOfferingIds, ...courseCandidates.map(candidate => candidate.id)])] };
  });
  const ids = new Set(rows.map(row => row.id));
  const records = state.importedStudyRecords.map(record => {
    if (record.sourceCourseId && ids.has(record.sourceCourseId)) return record;
    const candidates = rows.filter(row => normalizeImportName(row.rawName) === normalizeImportName(record.rawName) && sameAggregate(record, row));
    if (candidates.length !== 1) {
      if (candidates.length > 1) warnings.push(`${record.rawName}: 成績表行を一意に再接続できません`);
      return record;
    }
    repaired = true;
    return { ...record, sourceCourseId: candidates[0].id };
  });
  return { state: repaired ? { ...state, importedCourseAchievements: rows, importedStudyRecords: records } : state, repaired, warnings };
}
