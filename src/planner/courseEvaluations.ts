import type { CourseEvaluation, CourseGrade, Offering, PlannerItem } from './plannerCatalog';

export const COURSE_GRADES: CourseGrade[] = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];

export const gradeLabel = (grade: CourseGrade) => grade.replace('+', '＋').replace('-', '－');

export function evaluationFor(offeringId: string, evaluations: Record<string, CourseEvaluation>): CourseEvaluation {
  return evaluations[offeringId] ?? { offeringId, reportGrade: null, schoolingGrade: null };
}

export function evaluationItems(items: PlannerItem[], offerings: Map<string, Offering>): PlannerItem[] {
  return items.filter(item => offerings.has(item.offeringId));
}

/** Correspondence report results are recorded per report in the correspondence tab. */
export function usesLegacyReportEvaluation(offering: Offering): boolean {
  return offering.method !== 'correspondence';
}

export function evaluationIsUnrated(offering: Offering, evaluation: CourseEvaluation): boolean {
  return (usesLegacyReportEvaluation(offering) && evaluation.reportGrade === null)
    || (offering.method === 'schooling' && evaluation.schoolingGrade === null);
}

export function evaluationSummary(items: PlannerItem[], evaluations: Record<string, CourseEvaluation>, offerings: Map<string, Offering>) {
  const present = items.map(item => ({ offering: offerings.get(item.offeringId)!, evaluation: evaluationFor(item.offeringId, evaluations) }));
  const reportEligible = present.filter(entry => usesLegacyReportEvaluation(entry.offering));
  return {
    reportsEntered: reportEligible.filter(entry => entry.evaluation.reportGrade !== null).length,
    reportEligibleTotal: reportEligible.length,
    schoolingsEntered: present.filter(entry => entry.evaluation.schoolingGrade !== null).length,
  };
}
