import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import type { ImportedGraduationNotice } from './importedGraduationNotices';
import type { PlannerCatalog } from './plannerCatalog';
import { exactImportedCurriculumId } from './officialCourseCredits';

/** Derived management projection only; successful rows stay in the course list. */
export function importedAchievementManagement(rows: ImportedCourseAchievement[], records: ImportedStudyRecord[], catalog: PlannerCatalog, notices: ImportedGraduationNotice[] = []) {
  const ids = rows.map(row => exactImportedCurriculumId(row, catalog));
  const counts = new Map<string, number>();
  for (const id of ids) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  const attention = new Set(notices.filter(notice => notice.kind !== 'out_of_scope').flatMap(notice => notice.sourceRowIds));
  const issueRows = rows.filter((row, index) => ids[index] === null || row.earnedCreditsTotal === null
    || (counts.get(ids[index] ?? '') ?? 0) > 1 || attention.has(row.id));
  const sourceIds = new Set(rows.map(row => row.id));
  const issueIds = new Set(issueRows.map(row => row.id));
  const issueRecords = records.filter(record => !sourceIds.has(record.sourceCourseId ?? '') || issueIds.has(record.sourceCourseId ?? ''));
  return { issueRows, issueRecords };
}
