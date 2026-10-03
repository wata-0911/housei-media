import { deriveCurriculumCourseProgress, type CurriculumCourseAttempt, type CurriculumCourseProgress } from './curriculumCourseProgress';
import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import type { CorrespondenceCourseProgress, CourseEvaluation, CurriculumCourse, ImportedCourseUserMeta, MediaCourseProgress, Offering, PlannerCatalog, PlannerItem, PlannerState } from './plannerCatalog';
import { importedAchievementDisplayStatus } from './unifiedCourseView';

export type OfficialAchievementView = {
  achievement: ImportedCourseAchievement;
  studyRecords: ImportedStudyRecord[];
  userMeta: ImportedCourseUserMeta | null;
  displayStatus: ReturnType<typeof importedAchievementDisplayStatus>;
};

export type PlannerAttemptView = {
  plannerItem: PlannerItem;
  offering: Offering | null;
  /** Saved attempt data only. Absence does not create progress or imply completion. */
  progress: { correspondence: CorrespondenceCourseProgress | null; mediaSchooling: MediaCourseProgress | null };
  evaluation: CourseEvaluation | null;
};

export type CurriculumCourseView = Omit<CurriculumCourseProgress, 'attempts' | 'officialAchievements'> & {
  curriculumCourse: CurriculumCourse;
  officialAchievements: OfficialAchievementView[];
  attempts: Array<PlannerAttemptView & Pick<CurriculumCourseAttempt, 'earnedContribution' | 'projectedContribution' | 'officialEarnedPreferred' | 'officialEarnedPreferenceReason'>>;
};

export type UnresolvedCurriculumEntry =
  | { kind: 'official'; official: OfficialAchievementView; reason: string }
  | { kind: 'attempt'; attempt: PlannerAttemptView; reason: string };

export type CurriculumCourseViewResult = {
  courses: CurriculumCourseView[];
  unresolved: UnresolvedCurriculumEntry[];
  orphanStudyRecords: ImportedStudyRecord[];
};

export type CurriculumCourseViewInput = Pick<PlannerState, 'items' | 'importedCourseAchievements' | 'importedStudyRecords' | 'importedCourseUserMeta' | 'correspondenceProgress' | 'mediaSchoolingProgress' | 'courseEvaluations' | 'selectedScopeId'>;

/** Presentation projection of v22 identities, not an identity resolver or a graduation
 * allocator. Input source objects are borrowed: consumers must treat them as read-only.
 * Only exact CourseProgress groups are displayed; unresolved facts remain first-class.
 */
export function deriveCurriculumCourseView(state: CurriculumCourseViewInput, catalog: PlannerCatalog): CurriculumCourseViewResult {
  const progress = deriveCurriculumCourseProgress(state.items, catalog, state.importedCourseAchievements, state.selectedScopeId, state.importedStudyRecords);
  const coursesById = new Map(catalog.curriculum?.courses.map(course => [course.id, course]) ?? []);
  const offeringsById = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const detailsBySource = new Map<string, ImportedStudyRecord[]>();
  const sourceIds = new Set(state.importedCourseAchievements.map(achievement => achievement.id));
  const orphanStudyRecords: ImportedStudyRecord[] = [];
  for (const record of state.importedStudyRecords) {
    if (!record.sourceCourseId || !sourceIds.has(record.sourceCourseId)) orphanStudyRecords.push(record);
    else detailsBySource.set(record.sourceCourseId, [...(detailsBySource.get(record.sourceCourseId) ?? []), record]);
  }
  const officialView = (achievement: ImportedCourseAchievement): OfficialAchievementView => ({
    achievement,
    studyRecords: detailsBySource.get(achievement.id) ?? [],
    userMeta: state.importedCourseUserMeta[achievement.id] ?? null,
    displayStatus: importedAchievementDisplayStatus(achievement, state.importedCourseUserMeta[achievement.id]),
  });
  const attemptView = (plannerItem: PlannerItem, offering: Offering | null): PlannerAttemptView => ({
    plannerItem, offering,
    progress: {
      correspondence: state.correspondenceProgress[plannerItem.offeringId] ?? null,
      mediaSchooling: state.mediaSchoolingProgress[plannerItem.offeringId] ?? null,
    },
    evaluation: state.courseEvaluations[plannerItem.offeringId] ?? null,
  });
  const assignedItems = new Set<PlannerItem>();
  const assignedAchievements = new Set<ImportedCourseAchievement>();
  const courses = progress.courses.map(({ attempts, officialAchievements, ...summary }): CurriculumCourseView => ({
    ...summary,
    curriculumCourse: coursesById.get(summary.curriculumCourseId)!,
    officialAchievements: officialAchievements.map(achievement => {
      assignedAchievements.add(achievement);
      return officialView(achievement);
    }),
    attempts: attempts.map(({ item, offering, ...contributions }) => {
      assignedItems.add(item);
      return { ...attemptView(item, offering), ...contributions };
    }),
  }));
  const unresolved: UnresolvedCurriculumEntry[] = [
    ...state.items.filter(item => !assignedItems.has(item)).map(item => ({
      kind: 'attempt' as const,
      attempt: attemptView(item, offeringsById.get(item.offeringId) ?? null),
      reason: progress.unassigned.find(warning => warning.offeringId === item.offeringId)?.reason ?? '制度科目を一意に判定できません。',
    })),
    ...state.importedCourseAchievements.filter(achievement => !assignedAchievements.has(achievement)).map(achievement => ({
      kind: 'official' as const,
      official: officialView(achievement),
      reason: progress.unassigned.find(warning => warning.sourceCourseId === achievement.id)?.reason ?? '成績表行の制度科目を一意に判定できません。',
    })),
  ];
  return { courses, unresolved, orphanStudyRecords };
}
