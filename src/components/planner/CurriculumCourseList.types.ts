import type { createCreditClassifier } from '../../planner/annualPlan';
import type { CurriculumCourseViewResult } from '../../planner/curriculumCourseView';
import type { ImportedCourseAchievement } from '../../planner/gradeImportApply';
import type { CorrespondenceCourseProgress, CourseEvaluation, ImportedCourseUserMeta, Offering, PlannerCatalog, PlannerItem, PublicCourse } from '../../planner/plannerCatalog';

// All write callbacks retain their existing source owner. The derived view is read-only.
export type AttemptEditorProps = {
  classify: ReturnType<typeof createCreditClassifier>;
  disabled: boolean;
  onChange: (offeringId: string, patch: Partial<Omit<PlannerItem, 'offeringId'>>) => void;
  onRemove: (offeringId: string) => void;
  onChangeEvaluation: (offeringId: string, evaluation: CourseEvaluation) => void;
  onChangeCorrespondence: (offeringId: string, progress: CorrespondenceCourseProgress) => void;
  onOpenMedia: () => void;
};
export type OfficialEditorProps = {
  offerings: Map<string, Offering>;
  disabled: boolean;
  onChangeImportedMeta: (achievementId: string, patch: Partial<ImportedCourseUserMeta>) => void;
  onChangeImportedCourse: (achievementId: string, patch: Partial<ImportedCourseAchievement>) => void;
};
export type CurriculumCourseListProps = AttemptEditorProps & OfficialEditorProps & {
  catalog: PlannerCatalog;
  view: CurriculumCourseViewResult;
  publicCourses: PublicCourse[];
  onChangePublicCourse: (id: string, patch: Partial<Omit<PublicCourse, 'id' | 'credits'>>) => void;
  onRemovePublicCourse: (id: string) => void;
};
