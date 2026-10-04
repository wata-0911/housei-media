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

export type HoseiGradeImportValidationIssue = {
  /** Zero-based contract course index; never a course name or source value. */
  courseIndex: number | null;
  fieldPath: string;
  category: 'type' | 'value' | 'empty' | 'length' | 'date' | 'non_finite' | 'negative' | 'schema';
};

/**
 * Explains a rejection only. The unchanged validator above remains authoritative.
 * Paths come exclusively from schema literals and array indexes; no input keys,
 * values, exception messages or stacks are included. Return only the first issue.
 */
export function diagnoseHoseiGradeImportV1(value: unknown): HoseiGradeImportValidationIssue | null {
  if (isHoseiGradeImportV1(value)) return null;
  type Category = HoseiGradeImportValidationIssue['category'];
  const issue = (fieldPath: string, category: Category, courseIndex: number | null = null): HoseiGradeImportValidationIssue => ({ courseIndex, fieldPath, category });
  if (!isRecord(value)) return issue('$', 'type');
  if (value.schemaVersion !== 1) return issue('schemaVersion', 'value');
  if (value.source !== 'hosei_web_learning_grade_table') return issue('source', 'value');
  if (typeof value.capturedAt !== 'string') return issue('capturedAt', 'type');
  if (Number.isNaN(Date.parse(value.capturedAt))) return issue('capturedAt', 'date');
  if (!Array.isArray(value.courses)) return issue('courses', 'type');
  const numberCategory = (number: unknown): Category | null => number === null ? null
    : typeof number !== 'number' ? 'type' : !Number.isFinite(number) ? 'non_finite' : number < 0 ? 'negative' : null;
  // Match the validator's every semantics (including sparse arrays).
  let failure: HoseiGradeImportValidationIssue | null = null;
  value.courses.every((course, index) => {
    const at = (path: string, category: Category) => issue(`courses[${index}]${path ? `.${path}` : ''}`, category, index);
    const inspect = (): HoseiGradeImportValidationIssue | null => {
      if (!isRecord(course)) return at('', 'type');
      if (typeof course.rawName !== 'string') return at('rawName', 'type');
      if (course.rawName.trim() === '') return at('rawName', 'empty');
      if (!isStringOrNull(course.categoryRaw)) return at('categoryRaw', 'type');
      for (const key of ['compositionCredits', 'additionalEnrollment', 'recognizedExemption', 'earnedCredits', 'schoolingCredits']) {
        const field = course[key];
        if (!isRecord(field)) return at(key, 'type');
        if (typeof field.raw !== 'string') return at(`${key}.raw`, 'type');
        const category = numberCategory(field.value);
        if (category) return at(`${key}.value`, category);
      }
      if (!Array.isArray(course.reports)) return at('reports', 'type');
      if (course.reports.length !== 4) return at('reports', 'length');
      if (!isRecord(course.creditExam)) return at('creditExam', 'type');
      if (!Array.isArray(course.schoolings)) return at('schoolings', 'type');
      if (course.schoolings.length !== 2) return at('schoolings', 'length');
      const exam = course.creditExam;
      for (const key of ['rawDate', 'rawCredits', 'rawGrade']) if (typeof exam[key] !== 'string') return at(`creditExam.${key}`, 'type');
      if (!(exam.date === null || isDate(exam.date))) return at('creditExam.date', 'date');
      const examNumber = numberCategory(exam.credits);
      if (examNumber) return at('creditExam.credits', examNumber);
      if (!grade(exam.grade)) return at('creditExam.grade', 'value');
      if (typeof exam.pendingMarker !== 'boolean') return at('creditExam.pendingMarker', 'type');
      let nested: HoseiGradeImportValidationIssue | null = null;
      course.reports.every((report, reportIndex) => {
        const path = `reports[${reportIndex}]`;
        nested = !isRecord(report) ? at(path, 'type')
          : typeof report.raw !== 'string' ? at(`${path}.raw`, 'type')
          : typeof report.status !== 'string' || !reportStatuses.includes(report.status as HoseiReportStatus) ? at(`${path}.status`, 'value')
          : !(report.date === null || isDate(report.date)) ? at(`${path}.date`, 'date') : null;
        return nested === null;
      });
      if (nested) return nested;
      course.schoolings.every((schooling, schoolingIndex) => {
        const path = `schoolings[${schoolingIndex}]`;
        if (!isRecord(schooling)) { nested = at(path, 'type'); return false; }
        for (const key of ['rawYear', 'rawTerm', 'rawDate', 'rawCredits', 'rawGrade']) {
          if (typeof schooling[key] !== 'string') { nested = at(`${path}.${key}`, 'type'); return false; }
        }
        const category = numberCategory(schooling.credits);
        nested = !isStringOrNull(schooling.year) ? at(`${path}.year`, 'type')
          : !isStringOrNull(schooling.term) ? at(`${path}.term`, 'type')
          : !(schooling.date === null || isDate(schooling.date)) ? at(`${path}.date`, 'date')
          : category ? at(`${path}.credits`, category)
          : !grade(schooling.grade) ? at(`${path}.grade`, 'value') : null;
        return nested === null;
      });
      return nested;
    };
    failure = inspect();
    return failure === null;
  });
  // Fail closed if a future validator rule has no explanatory path yet.
  return failure ?? issue('$', 'schema');
}
