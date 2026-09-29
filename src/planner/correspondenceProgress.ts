import type { CorrespondenceCourseProgress, CourseGrade, Offering, PlannerItem, ReportPassingGrade, ReportProgress, ReportProgressStatus } from './plannerCatalog';
import { correspondenceRequirementFor } from './correspondenceRequirements';

export const REPORT_PASSING_GRADES: ReportPassingGrade[] = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-'];
export const CREDIT_EXAM_GRADES: CourseGrade[] = [...REPORT_PASSING_GRADES, 'D'];
export const REPORT_STATUSES: ReportProgressStatus[] = ['not_submitted', 'submitted', 'grading', 'resubmit', 'passed'];

export function isCorrespondenceOffering(offering: Offering | undefined): boolean { return offering?.method === 'correspondence'; }
export function correspondencePlanItems(items: PlannerItem[], offerings: Map<string, Offering>): PlannerItem[] { return items.filter(item => isCorrespondenceOffering(offerings.get(item.offeringId))); }
export function progressForCorrespondence(offering: Offering | undefined, saved: Record<string, CorrespondenceCourseProgress>): CorrespondenceCourseProgress {
  if (!offering) throw new Error('Offering is required');
  const requirement = correspondenceRequirementFor(offering);
  return saved[offering.id] ?? { offeringId: offering.id, requiredReports: requirement?.requiredReports ?? null, reports: requirement ? Array.from({ length: requirement.requiredReports }, (_, index) => ({ reportNumber: index + 1, status: 'not_submitted' as const, grade: null })) : [], examGrade: null };
}
export function setReportStatus(course: CorrespondenceCourseProgress, reportNumber: number, status: ReportProgressStatus): CorrespondenceCourseProgress {
  const reports = course.reports.map(report => report.reportNumber === reportNumber ? { ...report, status, grade: status === 'passed' ? report.grade : null } : report);
  return { ...course, reports };
}
export function setReportGrade(course: CorrespondenceCourseProgress, reportNumber: number, grade: ReportPassingGrade | null): CorrespondenceCourseProgress {
  return { ...course, reports: course.reports.map(report => report.reportNumber === reportNumber ? { ...report, status: grade === null ? report.status : 'passed', grade } : report) };
}
export type CorrespondenceCreditResult = { examEligible: boolean | null; reportsPassed: boolean | null; examPassed: boolean | null; creditEarned: boolean | null; reason: string };
export function correspondenceCreditResult(course: CorrespondenceCourseProgress): CorrespondenceCreditResult {
  if (course.requiredReports === null) return { examEligible: null, reportsPassed: null, examPassed: course.examGrade === null ? null : course.examGrade !== 'D', creditEarned: null, reason: '設題総覧との安全な対応付けが未確認のため、必要リポート数を自動判定しません。' };
  const requiredReports = course.requiredReports;
  const reports = course.reports.filter(report => report.reportNumber <= requiredReports);
  if (reports.length !== requiredReports) return { examEligible: null, reportsPassed: null, examPassed: course.examGrade === null ? null : course.examGrade !== 'D', creditEarned: null, reason: '必要リポートの記録が不足しています。' };
  const examEligible = reports.every(report => report.status !== 'not_submitted');
  // A report's completion state is the source of truth for the progress
  // workflow. Its optional grade records a known result, but must not prevent
  // a learner-selected "passed" state from counting as passed.
  const reportsPassed = reports.every(report => report.status === 'passed');
  const examPassed = course.examGrade === null ? null : course.examGrade !== 'D';
  const creditEarned = examPassed === null ? false : reportsPassed && examPassed;
  return { examEligible, reportsPassed, examPassed, creditEarned, reason: creditEarned ? '必要リポートがすべて合格し、単位修得試験も合格です。' : !examEligible ? '必要リポートがすべて提出済みになると、単位修得試験の受験資格を満たします。' : !reportsPassed ? '単位修得には必要リポートの全件合格が必要です。' : examPassed === null ? '単位修得試験は未受験です。' : '単位修得試験が不合格です。' };
}
export function validCorrespondenceProgress(course: CorrespondenceCourseProgress): boolean {
  return (course.requiredReports === null || (Number.isInteger(course.requiredReports) && course.requiredReports >= 1 && course.requiredReports <= 20))
    && course.reports.every((report: ReportProgress) => Number.isInteger(report.reportNumber) && report.reportNumber >= 1 && REPORT_STATUSES.includes(report.status) && (report.grade === null || (report.status === 'passed' && REPORT_PASSING_GRADES.includes(report.grade))))
    && new Set(course.reports.map(report => report.reportNumber)).size === course.reports.length
    && (course.examGrade === null || CREDIT_EXAM_GRADES.includes(course.examGrade));
}
