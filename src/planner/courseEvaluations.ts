import type { CourseEvaluation, CourseGrade, Offering, PlannerItem } from './plannerCatalog';

export const COURSE_GRADES: CourseGrade[] = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];

export const gradeLabel = (grade: CourseGrade) => grade.replace('+', '＋').replace('-', '－');

export function evaluationFor(offeringId: string, evaluations: Record<string, CourseEvaluation>): CourseEvaluation {
  return evaluations[offeringId] ?? { offeringId, reportGrade: null, schoolingGrade: null };
}

export function evaluationItems(items: PlannerItem[], offerings: Map<string, Offering>): PlannerItem[] {
  return items.filter(item => offerings.has(item.offeringId));
}

export function evaluationSummary(items: PlannerItem[], evaluations: Record<string, CourseEvaluation>) {
  const present = items.map(item => evaluationFor(item.offeringId, evaluations));
  return {
    reportsEntered: present.filter(entry => entry.reportGrade !== null).length,
    schoolingsEntered: present.filter(entry => entry.schoolingGrade !== null).length,
    total: present.length,
  };
}
