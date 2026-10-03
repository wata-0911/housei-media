/** Versioned, untrusted hand-off format produced by the browser extension or self-contained bookmarklet. */
export type HoseiGrade = 'S' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D';
export type HoseiReportStatus = 'none' | 'passed' | 'resubmit' | 'processing' | 'unknown';

export type HoseiGradeImportReport = { raw: string; status: HoseiReportStatus; date: string | null };
export type HoseiGradeImportNumeric = { raw: string; value: number | null };
export type HoseiGradeImportExam = {
  rawDate: string; rawCredits: string; rawGrade: string;
  date: string | null; credits: number | null; grade: HoseiGrade | null; pendingMarker: boolean;
};
export type HoseiGradeImportSchooling = {
  rawYear: string; rawTerm: string; rawDate: string; rawCredits: string; rawGrade: string;
  year: string | null; term: string | null; date: string | null; credits: number | null; grade: HoseiGrade | null;
};
export type HoseiGradeImportCourse = {
  rawName: string; categoryRaw: string | null;
  compositionCredits: HoseiGradeImportNumeric; additionalEnrollment: HoseiGradeImportNumeric;
  recognizedExemption: HoseiGradeImportNumeric; earnedCredits: HoseiGradeImportNumeric;
  schoolingCredits: HoseiGradeImportNumeric;
  reports: HoseiGradeImportReport[]; creditExam: HoseiGradeImportExam;
  schoolings: [HoseiGradeImportSchooling, HoseiGradeImportSchooling];
};
export type HoseiGradeImportV1 = {
  schemaVersion: 1; source: 'hosei_web_learning_grade_table'; capturedAt: string; courses: HoseiGradeImportCourse[];
};

const grades: HoseiGrade[] = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];
const reportStatuses: HoseiReportStatus[] = ['none', 'passed', 'resubmit', 'processing', 'unknown'];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringOrNull = (value: unknown) => typeof value === 'string' || value === null;
const isDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const numeric = (value: unknown) => isRecord(value) && typeof value.raw === 'string' && (value.value === null || (typeof value.value === 'number' && Number.isFinite(value.value) && value.value >= 0));
const grade = (value: unknown) => value === null || (typeof value === 'string' && grades.includes(value as HoseiGrade));

/** Validates every nested field because extension JSON is always treated as untrusted input. */
export function isHoseiGradeImportV1(value: unknown): value is HoseiGradeImportV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.source !== 'hosei_web_learning_grade_table' || typeof value.capturedAt !== 'string' || Number.isNaN(Date.parse(value.capturedAt)) || !Array.isArray(value.courses)) return false;
  return value.courses.every(course => {
    if (!isRecord(course) || typeof course.rawName !== 'string' || course.rawName.trim() === '' || !isStringOrNull(course.categoryRaw) || !numeric(course.compositionCredits) || !numeric(course.additionalEnrollment) || !numeric(course.recognizedExemption) || !numeric(course.earnedCredits) || !numeric(course.schoolingCredits) || !Array.isArray(course.reports) || course.reports.length !== 4 || !isRecord(course.creditExam) || !Array.isArray(course.schoolings) || course.schoolings.length !== 2) return false;
    const exam = course.creditExam;
    if (!['rawDate', 'rawCredits', 'rawGrade'].every(key => typeof exam[key] === 'string') || !(exam.date === null || isDate(exam.date)) || !(exam.credits === null || (typeof exam.credits === 'number' && Number.isFinite(exam.credits) && exam.credits >= 0)) || !grade(exam.grade) || typeof exam.pendingMarker !== 'boolean') return false;
    const reportsOk = course.reports.every(report => isRecord(report) && typeof report.raw === 'string' && typeof report.status === 'string' && reportStatuses.includes(report.status as HoseiReportStatus) && (report.date === null || isDate(report.date)));
    const schoolingsOk = course.schoolings.every(schooling => isRecord(schooling) && ['rawYear', 'rawTerm', 'rawDate', 'rawCredits', 'rawGrade'].every(key => typeof schooling[key] === 'string') && isStringOrNull(schooling.year) && isStringOrNull(schooling.term) && (schooling.date === null || isDate(schooling.date)) && (schooling.credits === null || (typeof schooling.credits === 'number' && Number.isFinite(schooling.credits) && schooling.credits >= 0)) && grade(schooling.grade));
    return reportsOk && schoolingsOk;
  });
}
