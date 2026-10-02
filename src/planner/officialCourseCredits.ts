import type { ImportedCourseAchievement } from './gradeImportApply';
import type { Offering, PlannerCatalog, PlannerItem } from './plannerCatalog';
import { validImportedCurriculumIdentity } from './curriculumIdentityValidation';

/** Independent exact institutional identity; an annual opening is not required. */
export function exactImportedCurriculumId(row: ImportedCourseAchievement, catalog: PlannerCatalog): string | null {
  return row.curriculumMatch === 'exact_unique' && row.curriculumCourseId
    && validImportedCurriculumIdentity(row, catalog) ? row.curriculumCourseId : null;
}

/** Conservative official-priority policy for graduation and related calculations,
 * separate from CourseProgress's source-linked attempt deduplication.
 * Remove only earned duplicates from calculation inputs, never from saved/UI items.
 * An exact official Course aggregate owns all earned credit for that Course.
 * The source link also protects auto-created items whose institutional identity is unresolved.
 * Plans remain independent additional enrollments, including waiting items.
 */
export function plannerItemsWithoutOfficialEarned(items: PlannerItem[], offerings: Map<string, Offering>, rows: ImportedCourseAchievement[], catalog?: PlannerCatalog): PlannerItem[] {
  const sourceIds = new Set(rows.map(row => row.id));
  const officialCourses = new Set(catalog ? rows.flatMap(row => exactImportedCurriculumId(row, catalog) ?? []) : []);
  return items.filter(item => item.status !== 'earned'
    || (!sourceIds.has(item.importedSourceCourseId ?? '')
      && !officialCourses.has(offerings.get(item.offeringId)?.curriculumCourseId ?? '')));
}
