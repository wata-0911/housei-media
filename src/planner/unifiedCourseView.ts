import type { ImportedCourseAchievement } from './gradeImportApply';
import type { Offering, PlannerItem } from './plannerCatalog';

export type UnifiedCourseRow = {
  key: string;
  plannerItem: PlannerItem | null;
  /** Official grade-table rows are retained as source facts, never copied into the planner item. */
  importedAchievements: ImportedCourseAchievement[];
  offering: Offering | null;
  studyYear: PlannerItem['studyYear'];
  source: 'planner' | 'imported' | 'planner_imported';
  displayStatus: 'planner' | 'earned_imported';
};

function safePlannerCourseId(item: PlannerItem, offerings: Map<string, Offering>) {
  const offering = offerings.get(item.offeringId);
  return offering?.resolutionStatus === 'matched' && offering.courseId ? offering.courseId : null;
}

/**
 * An imported identity is usable for display coalescing only when the import
 * already has a safe course identity.  A manual selection is also safe when
 * its selected offering confirms that same identity.  Names are intentionally
 * never used here: name-only matches remain separate read-only rows.
 */
function safeImportedCourseId(row: ImportedCourseAchievement, offerings: Map<string, Offering>) {
  if (!row.courseId) return null;
  if (row.selectionSource === 'manual') {
    const selected = row.selectedOfferingId ? offerings.get(row.selectedOfferingId) : undefined;
    return selected?.resolutionStatus === 'matched' && selected.courseId === row.courseId ? row.courseId : null;
  }
  if (row.match !== 'exact_unique') return null;
  return [...offerings.values()].some(offering => offering.resolutionStatus === 'matched' && offering.courseId === row.courseId) ? row.courseId : null;
}

/**
 * Creates a presentation-only combined view.  It does not write planner
 * state, change final grades, or reuse imported credits for calculations.
 */
export function createUnifiedCourseRows(items: PlannerItem[], importedAchievements: ImportedCourseAchievement[], offerings: Map<string, Offering>): UnifiedCourseRow[] {
  const rows: UnifiedCourseRow[] = items.map(item => ({
    key: `planner:${item.offeringId}`,
    plannerItem: item,
    importedAchievements: [],
    offering: offerings.get(item.offeringId) ?? null,
    studyYear: item.studyYear,
    source: 'planner' as const,
    displayStatus: 'planner' as const,
  }));
  const plannerRowsByCourseId = new Map<string, UnifiedCourseRow[]>();
  for (const row of rows) {
    if (!row.plannerItem) continue;
    const courseId = safePlannerCourseId(row.plannerItem, offerings);
    if (courseId) plannerRowsByCourseId.set(courseId, [...(plannerRowsByCourseId.get(courseId) ?? []), row]);
  }

  for (const achievement of importedAchievements) {
    if (achievement.earnedCreditsTotal === null || achievement.earnedCreditsTotal <= 0) continue;
    const courseId = safeImportedCourseId(achievement, offerings);
    // Multiple planner offerings may legitimately share one course identity.
    // Coalesce only the unambiguous one-to-one case; otherwise preserve the
    // official achievement as its own read-only row.
    const plannerRows = courseId ? plannerRowsByCourseId.get(courseId) : undefined;
    const plannerRow = plannerRows?.length === 1 ? plannerRows[0] : undefined;
    if (plannerRow) {
      plannerRow.importedAchievements.push(achievement);
      plannerRow.source = 'planner_imported';
      continue;
    }
    rows.push({
      key: `imported:${achievement.id}`,
      plannerItem: null,
      importedAchievements: [achievement],
      offering: null,
      studyYear: null,
      source: 'imported',
      displayStatus: 'earned_imported',
    });
  }
  return rows;
}
