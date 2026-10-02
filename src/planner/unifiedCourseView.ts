import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import { resolveSafeImportedCourseId } from './importedAchievementIdentity';
import type { ImportedCourseUserMeta, Offering, PlannerItem } from './plannerCatalog';

export type UnifiedCourseRow = {
  key: string;
  plannerItem: PlannerItem | null;
  /** Official grade-table rows are retained as source facts, never copied into the planner item. */
  importedAchievements: ImportedCourseAchievement[];
  /** Source components are presentation details, never additional credit inputs. */
  importedStudyRecords: ImportedStudyRecord[];
  offering: Offering | null;
  studyYear: PlannerItem['studyYear'];
  source: 'planner' | 'imported' | 'planner_imported';
  /** Official facts win. Metadata only supplies context for unresolved rows. */
  displayStatus: 'planner' | 'earned_imported' | 'failed_imported' | 'waiting_imported' | 'in_progress_imported' | 'pending_imported';
};

function safePlannerCourseId(item: PlannerItem, offerings: Map<string, Offering>) {
  const offering = offerings.get(item.offeringId);
  return offering?.resolutionStatus === 'matched' && offering.courseId ? offering.courseId : null;
}

/**
 * Creates a presentation-only combined view.  It does not write planner
 * state, change final grades, or reuse imported credits for calculations.
 */
export function importedAchievementDisplayStatus(achievement: ImportedCourseAchievement, meta: ImportedCourseUserMeta | undefined): UnifiedCourseRow['displayStatus'] {
  if (achievement.earnedCreditsTotal !== null && achievement.earnedCreditsTotal > 0) return 'earned_imported';
  // A component grade is not a final grade, so it must never manufacture an
  // official failure here. Unresolved official rows remain pending unless the
  // learner adds lifecycle context.
  if (meta?.lifecycleStatus === 'waiting') return 'waiting_imported';
  if (meta?.lifecycleStatus === 'in_progress') return 'in_progress_imported';
  return 'pending_imported';
}

/** Compact source-fact context displayed alongside a retained planner row. */
export function importedAchievementStatusLabel(achievement: ImportedCourseAchievement, meta: ImportedCourseUserMeta | undefined) {
  switch (importedAchievementDisplayStatus(achievement, meta)) {
    case 'earned_imported': return '修得済み（成績表）';
    case 'failed_imported': return '不合格（成績表）';
    case 'waiting_imported': return '成績表取込: 結果待ち';
    case 'in_progress_imported': return '成績表取込: 履修中';
    case 'pending_imported': return '成績表取込: 判定保留';
    case 'planner': return '';
  }
}

export function safeImportedStudyOffering(record: ImportedStudyRecord, offerings: Map<string, Offering>): Offering | null {
  const offering = record.offeringId ? offerings.get(record.offeringId) : undefined;
  return record.match === 'exact_unique' && offering?.resolutionStatus === 'matched' && offering.courseId !== null
    && record.method === offering.method && record.academicYear === offering.academicYear
    ? offering : null;
}

export function createUnifiedCourseRows(items: PlannerItem[], importedAchievements: ImportedCourseAchievement[], offerings: Map<string, Offering>, userMeta: Record<string, ImportedCourseUserMeta> = {}, importedStudyRecords: ImportedStudyRecord[] = []): UnifiedCourseRow[] {
  const rows: UnifiedCourseRow[] = items.map(item => ({
    key: `planner:${item.offeringId}`,
    plannerItem: item,
    importedAchievements: [],
    importedStudyRecords: [],
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
    const sourceDetails = importedStudyRecords.filter(record => record.sourceCourseId === achievement.id);
    const displayStatus = importedAchievementDisplayStatus(achievement, userMeta[achievement.id]);
    const courseId = resolveSafeImportedCourseId(achievement, offerings);
    // Multiple planner offerings may legitimately share one course identity.
    // Coalesce only the unambiguous one-to-one case; otherwise preserve the
    // imported achievement as its own read-only row.
    const plannerRows = courseId ? plannerRowsByCourseId.get(courseId) : undefined;
    const plannerRow = plannerRows?.length === 1 ? plannerRows[0] : undefined;
    if (plannerRow) {
      plannerRow.importedAchievements.push(achievement);
      plannerRow.importedStudyRecords.push(...sourceDetails);
      plannerRow.source = 'planner_imported';
      continue;
    }
    rows.push({
      key: `imported:${achievement.id}`,
      plannerItem: null,
      importedAchievements: [achievement],
      importedStudyRecords: sourceDetails,
      offering: null,
      studyYear: userMeta[achievement.id]?.studyYear ?? null,
      source: 'imported',
      displayStatus,
    });
  }
  // v9/orphan records must remain visible without inventing a source identity
  // or treating component credits as an official aggregate.
  const sourceIds = new Set(importedAchievements.map(achievement => achievement.id));
  for (const record of importedStudyRecords.filter(record => !record.sourceCourseId || !sourceIds.has(record.sourceCourseId))) {
    rows.push({ key: `detail:${record.id}`, plannerItem: null, importedAchievements: [], importedStudyRecords: [record], offering: null, studyYear: null, source: 'imported', displayStatus: 'pending_imported' });
  }
  return rows;
}
