import { createCreditClassifier } from './annualPlan';
import { correspondenceCreditResult, progressForCorrespondence } from './correspondenceProgress';
import { evaluationFor, gradeLabel } from './courseEvaluations';
import { assessmentDateLabel, assessmentLabel, mediaProgressSummary, progressFor } from './mediaSchooling';
import { offeringFormLabel, progressSummaryForOffering, statusLabels } from './planTable';
import type { CourseGrade, PlannerCatalog, PlannerState } from './plannerCatalog';

export type PlannerExportRow = {
  sourceType: 'catalog' | 'public';
  plannedYear: number | null;
  studyYear: 1 | 2 | 3 | 4 | null;
  plannedTerm: string | null;
  title: string;
  credits: number | null;
  formLabel: string;
  statusLabel: string;
  progressSummary: string;
  finalGrade: CourseGrade | null;
  classificationLabel: string | null;
  requiredReports: number | null;
  passedReports: number | null;
  examGrade: CourseGrade | null;
  correspondenceResult: '単位修得条件達成' | '未修得' | '判定不可' | null;
  totalLessons: number | null;
  completedVideos: number | null;
  completedTests: number | null;
  assessmentSummary: string | null;
};

export type PlannerExportPresentation = {
  affiliation: string;
  rows: PlannerExportRow[];
};

const studyYears: Array<1 | 2 | 3 | 4 | null> = [1, 2, 3, 4, null];

function correspondenceResult(value: boolean | null): PlannerExportRow['correspondenceResult'] {
  return value === null ? '判定不可' : value ? '単位修得条件達成' : '未修得';
}

function assessmentSummary(course: ReturnType<typeof progressFor>): string | null {
  if (course.assessments.length === 0) return null;
  return course.assessments.map(assessment => `${assessmentLabel(assessment)} ${assessmentDateLabel(assessment)} ${assessment.completed ? '実施済み' : '未実施'}`).join(' / ');
}

/** Builds export-only data from current plan rows. Orphan state is intentionally not enumerated. */
export function plannerExportPresentation(state: PlannerState, catalog: PlannerCatalog): PlannerExportPresentation {
  const offerings = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const classify = createCreditClassifier(catalog, state.selectedScopeId);
  const program = catalog.programs.find(entry => entry.scopeId === state.selectedScopeId && !entry.isCommon);
  const affiliation = program?.displayName ?? '所属未設定';
  const catalogRows = state.items.flatMap<PlannerExportRow>(item => {
    const offering = offerings.get(item.offeringId);
    if (!offering) return [];
    const evaluation = evaluationFor(item.offeringId, state.courseEvaluations);
    const base: PlannerExportRow = {
      sourceType: 'catalog' as const,
      plannedYear: item.plannedYear,
      studyYear: item.studyYear,
      plannedTerm: item.plannedTerm,
      title: offering.name,
      credits: offering.credits,
      formLabel: offeringFormLabel(offering),
      statusLabel: statusLabels[item.status],
      progressSummary: progressSummaryForOffering(item, offering, state.correspondenceProgress, state.mediaSchoolingProgress),
      finalGrade: evaluation.finalGrade,
      classificationLabel: classify(offering),
      requiredReports: null,
      passedReports: null,
      examGrade: null,
      correspondenceResult: null,
      totalLessons: null,
      completedVideos: null,
      completedTests: null,
      assessmentSummary: null,
    };
    if (offering.method === 'correspondence') {
      const course = progressForCorrespondence(offering, state.correspondenceProgress);
      const result = correspondenceCreditResult(course);
      return [{ ...base, requiredReports: course.requiredReports, passedReports: course.requiredReports === null ? null : course.reports.filter(report => report.reportNumber <= course.requiredReports! && report.status === 'passed' && report.grade !== null).length, examGrade: course.examGrade, correspondenceResult: correspondenceResult(result.creditEarned) }];
    }
    if (base.formLabel === 'メディア') {
      const course = progressFor(offering.id, state.mediaSchoolingProgress);
      const summary = mediaProgressSummary(course);
      return [{ ...base, totalLessons: course.totalLessons, completedVideos: summary.video, completedTests: summary.test, assessmentSummary: assessmentSummary(course) }];
    }
    return [base];
  });
  const publicRows: PlannerExportRow[] = state.publicCourses.map(course => ({
    sourceType: 'public', plannedYear: course.plannedYear, studyYear: course.studyYear, plannedTerm: course.plannedTerm,
    title: course.title, credits: course.credits, formLabel: '公開科目', statusLabel: statusLabels[course.status], progressSummary: '—', finalGrade: course.finalGrade,
    classificationLabel: '専門教育', requiredReports: null, passedReports: null, examGrade: null, correspondenceResult: null,
    totalLessons: null, completedVideos: null, completedTests: null, assessmentSummary: null,
  }));
  const rows = studyYears.flatMap(year => [...catalogRows.filter(row => row.studyYear === year), ...publicRows.filter(row => row.studyYear === year)]);
  return { affiliation, rows };
}

const csvHeaders = ['所属', '計画年度', '履修学年', '履修時期', '科目名', '単位', '履修形態', '履修状態', '進捗', '最終評価', '区分', 'catalog / 公開科目', '必要リポート数', '合格リポート数', '単位修得試験評価', '通信学習分の判定', '総回数', '動画完了数', 'テスト完了数', '試験・評価予定'];

function csvEscape(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC4180-compatible cells with a UTF-8 BOM for Japanese Excel imports. */
export function plannerExportCsv(presentation: PlannerExportPresentation): string {
  const rows = presentation.rows.map(row => [
    presentation.affiliation, row.plannedYear, row.studyYear === null ? null : `${row.studyYear}年`, row.plannedTerm, row.title, row.credits,
    row.formLabel, row.statusLabel, row.progressSummary, row.finalGrade === null ? null : gradeLabel(row.finalGrade), row.classificationLabel,
    row.sourceType === 'catalog' ? 'catalog' : '公開科目', row.requiredReports, row.passedReports, row.examGrade === null ? null : gradeLabel(row.examGrade), row.correspondenceResult,
    row.totalLessons, row.completedVideos, row.completedTests, row.assessmentSummary,
  ].map(csvEscape).join(','));
  return `\uFEFF${csvHeaders.map(csvEscape).join(',')}\r\n${rows.join('\r\n')}`;
}

export function plannerExportFileName(date: Date): string {
  const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return `hosei-planner-${stamp}`;
}

export function exportGradeLabel(grade: CourseGrade | null): string { return grade === null ? '—' : gradeLabel(grade); }
export function exportStudyYearLabel(year: PlannerExportRow['studyYear']): string { return year === null ? '未設定' : `${year}年`; }
export function exportTermLabel(term: string | null): string { return term ?? '—'; }
export function exportValue(value: string | number | null): string { return value === null ? '—' : String(value); }

export type { CreditClassification } from './annualPlan';
