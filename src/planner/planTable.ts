import { correspondenceCreditResult, progressForCorrespondence } from './correspondenceProgress';
import { gradeLabel } from './courseEvaluations';
import { isMediaSchooling, mediaProgressSummary, progressFor } from './mediaSchooling';
import type { CorrespondenceCourseProgress, MediaCourseProgress, Offering, PlannerItem } from './plannerCatalog';

export const STANDARD_TERMS = ['前期', '後期', '通年', '夏期', '冬期', 'その他'] as const;
export type StandardTerm = typeof STANDARD_TERMS[number];
export const statusLabels: Record<PlannerItem['status'], string> = { planned: '計画中', in_progress: '履修中', waiting: '結果待ち', earned: '修得済み', failed: '不合格', dropped: '取りやめ' };

export function isStandardTerm(term: string | null): term is StandardTerm { return term !== null && (STANDARD_TERMS as readonly string[]).includes(term); }

/** Uses catalog structure only; labels never infer a method from a course name. */
export function offeringFormLabel(offering: Offering): '通信' | 'メディア' | 'スクーリング' {
  if (offering.method === 'correspondence') return '通信';
  if (isMediaSchooling(offering)) return 'メディア';
  return 'スクーリング';
}

export function correspondenceProgressSummary(course: CorrespondenceCourseProgress): string {
  const exam = course.examGrade === null ? '未受験' : gradeLabel(course.examGrade);
  if (course.requiredReports === null) return `リポート要件 未確認・試験 ${exam}`;
  const requiredReports = course.requiredReports;
  const passed = course.reports.filter(report => report.reportNumber <= requiredReports && report.status === 'passed').length;
  return `リポート ${passed}/${requiredReports}・試験 ${exam}`;
}

export function mediaProgressText(course: MediaCourseProgress): string {
  const summary = mediaProgressSummary(course);
  const denominator = course.totalLessons === null ? '' : `/${course.totalLessons}`;
  return `動画 ${summary.video}${denominator}・テスト ${summary.test}${denominator}`;
}

export function progressSummaryForOffering(item: PlannerItem, offering: Offering, correspondence: Record<string, CorrespondenceCourseProgress>, media: Record<string, MediaCourseProgress>): string {
  if (offering.method === 'correspondence') return correspondenceProgressSummary(progressForCorrespondence(offering, correspondence));
  if (isMediaSchooling(offering)) return mediaProgressText(progressFor(offering.id, media));
  return statusLabels[item.status];
}

export function correspondenceDecision(course: CorrespondenceCourseProgress) { return correspondenceCreditResult(course); }
