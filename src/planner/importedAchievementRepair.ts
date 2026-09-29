import { normalizeImportName, type ImportedCourseAchievement, type ImportedStudyRecord } from './gradeImportApply';
import type { Offering, PlannerCatalog, PlannerState } from './plannerCatalog';

export type ImportedAchievementRepair = { state: PlannerState; repaired: boolean; warnings: string[] };

function isManual(row: ImportedCourseAchievement) { return row.selectionSource === 'manual'; }
/** Comparison-only normalisation.  Keep Roman numerals distinct from ASCII I/V. */
export function normalizeImportBaseName(name: string) {
  const protectedRomans: Array<[string, string]> = [['Ⅰ', '\uE000'], ['Ⅱ', '\uE001'], ['Ⅲ', '\uE002'], ['Ⅳ', '\uE003'], ['Ⅴ', '\uE004'], ['Ⅵ', '\uE005'], ['Ⅶ', '\uE006'], ['Ⅷ', '\uE007'], ['Ⅸ', '\uE008'], ['Ⅹ', '\uE009']];
  let value = name;
  for (const [roman, token] of protectedRomans) value = value.replaceAll(roman, token);
  value = value.normalize('NFKC').trim().replace(/[\s\u3000]+/g, '');
  // These are catalogue delivery labels, never a subject variant.  In
  // particular, bracketed theme and language-number labels are retained.
  let previous = '';
  while (previous !== value) {
    previous = value;
    value = value
      .replace(/(?:\((?:夏期|冬期|春期|秋期|前期週末|後期週末|ゴールデンウィーク)スクーリング[^)]*\)|\([^)]*市スクーリング\)|\((?:前期|後期)メディア\)|\[講義\]|(?:\[|【)オンライン(?:\]|】))$/u, '');
  }
  for (const [roman, token] of protectedRomans) value = value.replaceAll(token, roman);
  return value;
}

export function matchedNameOfferings(name: string, catalog: PlannerCatalog) {
  const normalized = normalizeImportBaseName(name);
  return catalog.offerings.filter(offering => normalizeImportBaseName(offering.name) === normalized);
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
    const courseId = oneCourseId(candidates.filter(candidate => candidate.resolutionStatus === 'matched'));
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
