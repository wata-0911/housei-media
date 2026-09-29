import type { HoseiGradeImportCourse, HoseiGradeImportV1 } from './gradeImportContract';
import type { Offering, PlannerState } from './plannerCatalog';

export type ImportMethod = 'correspondence' | 'schooling';
export type ImportMatch = 'exact_unique' | 'ambiguous' | 'unmatched';
/** One immutable source row from the grade table.  It is deliberately kept
 * independently from its correspondence/schooling detail records. */
export type ImportedCourseAchievement = { id: string; fingerprint: string; source: 'hosei_import'; rawName: string; categoryRaw: string | null; capturedAt: string; earnedCreditsTotal: number | null; schoolingCreditsTotal: number | null; compositionCredits: number | null; recognizedExemption: number | null; additionalEnrollment: number | null; academicYear: number | null; yearSource: 'source' | 'inferred' | 'manual' | 'unknown'; courseId: string | null; selectedOfferingId: string | null; match: ImportMatch; candidateOfferingIds: string[] };
/** A component is retained for display, while these optional fields preserve the
 * single source-course row.  Their absence identifies a v9 legacy record. */
export type ImportedStudyRecord = { id: string; fingerprint: string; source: 'hosei_import'; rawName: string; offeringId: string | null; match: ImportMatch; method: ImportMethod; academicYear: number | null; yearSource: 'source' | 'inferred' | 'manual' | 'unknown'; rawYear: string | null; term: string | null; rawTerm: string | null; date: string | null; credits: number | null; grade: string | null; reports?: HoseiGradeImportCourse['reports']; examGrade?: string | null; sourceCourseId?: string; earnedCreditsTotal?: number | null; schoolingCreditsTotal?: number | null; compositionCredits?: number | null; recognizedExemption?: number | null; additionalEnrollment?: number | null; capturedAt?: string };
export type ImportPreviewUnit = ImportedStudyRecord & { selected: boolean; candidates: Offering[]; duplicate: boolean; sourceCourse: ImportedCourseAchievement; sourceDuplicate: boolean; courseOnly?: boolean };

export const normalizeImportName = (name: string) => name.trim().replace(/[\s\u3000]+/g, ' ');
export function schoolingAcademicYear(raw: string | null): number | null { const n = raw?.trim(); if (!n || !/^\d{2}(?:\d{2})?$/.test(n)) return null; const value = Number(n); return n.length === 2 ? 2000 + value : value; }
/** The university year runs from April 1 through the following March 31. */
export function academicYearFromDate(date: string | null): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return null;
  return month < 4 ? year - 1 : year;
}
export function inferredCorrespondenceYear(course: HoseiGradeImportCourse, capturedAt: string): { academicYear: number | null; date: string | null } {
  const reportDates = course.reports.map(report => report.date).filter((date): date is string => date !== null).sort();
  const date = course.creditExam.date ?? reportDates.at(-1) ?? capturedAt.slice(0, 10);
  return { academicYear: academicYearFromDate(date), date };
}
export function hasCorrespondenceEvidence(course: HoseiGradeImportCourse): boolean {
  return course.reports.some(report => report.raw.trim() !== '' || report.status !== 'none' || report.date !== null)
    || course.creditExam.rawDate.trim() !== ''
    || course.creditExam.date !== null
    || course.creditExam.rawCredits.trim() !== ''
    || course.creditExam.credits !== null
    || course.creditExam.rawGrade.trim() !== ''
    || course.creditExam.grade !== null
    || course.creditExam.pendingMarker;
}
export function importFingerprint(record: Omit<ImportedStudyRecord, 'id' | 'fingerprint' | 'source' | 'offeringId' | 'match'>): string { return JSON.stringify([record.rawName, record.method, record.rawYear, record.rawTerm, record.date, record.credits, record.grade, record.method === 'correspondence' ? record.reports?.map(x => x.raw) : null, record.examGrade ?? null]); }
function match(name: string, method: ImportMethod, offerings: Offering[]) { const candidates = offerings.filter(o => o.method === method && normalizeImportName(o.name) === normalizeImportName(name)); return { candidates, match: candidates.length === 1 ? 'exact_unique' as const : candidates.length ? 'ambiguous' as const : 'unmatched' as const }; }
function sourceFingerprint(course: HoseiGradeImportCourse, index: number) { return JSON.stringify([course.rawName, course.categoryRaw, course.compositionCredits.value, course.additionalEnrollment.value, course.recognizedExemption.value, course.earnedCredits.value, course.schoolingCredits.value, course.reports.map(report => [report.raw, report.date]), course.creditExam.rawDate, course.creditExam.rawCredits, course.creditExam.rawGrade, course.schoolings.map(slot => [slot.rawYear, slot.rawTerm, slot.rawDate, slot.rawCredits, slot.rawGrade]), index]); }
function sameSourceIdentity(a: ImportedCourseAchievement, b: ImportedCourseAchievement) { return a.rawName === b.rawName && a.categoryRaw === b.categoryRaw && a.compositionCredits === b.compositionCredits && a.additionalEnrollment === b.additionalEnrollment && a.recognizedExemption === b.recognizedExemption && a.earnedCreditsTotal === b.earnedCreditsTotal && a.schoolingCreditsTotal === b.schoolingCreditsTotal && a.academicYear === b.academicYear; }
function sourceCourseFor(course: HoseiGradeImportCourse, capturedAt: string, index: number, offerings: Offering[]): ImportedCourseAchievement {
  const candidates = offerings.filter(o => normalizeImportName(o.name) === normalizeImportName(course.rawName));
  const courseIds = new Set(candidates.filter(o => o.resolutionStatus === 'matched' && o.courseId !== null).map(o => o.courseId!));
  const courseId = courseIds.size === 1 ? [...courseIds][0] : null;
  const representative = candidates.find(o => o.courseId === courseId) ?? null;
  const schooling = course.schoolings.find(slot => slot.rawYear || slot.rawTerm || slot.rawDate || slot.rawCredits || slot.rawGrade);
  const sourceYear = schooling ? schoolingAcademicYear(schooling.year) ?? schoolingAcademicYear(schooling.rawYear) : null;
  const inferred = sourceYear ?? (schooling ? academicYearFromDate(schooling.date ?? capturedAt.slice(0, 10)) : inferredCorrespondenceYear(course, capturedAt).academicYear);
  return { id: crypto.randomUUID(), fingerprint: sourceFingerprint(course, index), source: 'hosei_import', rawName: course.rawName, categoryRaw: course.categoryRaw, capturedAt, earnedCreditsTotal: course.earnedCredits.value, schoolingCreditsTotal: course.schoolingCredits.value, compositionCredits: course.compositionCredits.value, recognizedExemption: course.recognizedExemption.value, additionalEnrollment: course.additionalEnrollment.value, academicYear: inferred, yearSource: sourceYear !== null ? 'source' : inferred !== null ? 'inferred' : 'unknown', courseId, selectedOfferingId: representative?.id ?? null, match: courseId ? 'exact_unique' : candidates.length ? 'ambiguous' : 'unmatched', candidateOfferingIds: candidates.map(candidate => candidate.id) };
}
export function importPreview(data: HoseiGradeImportV1, offerings: Offering[], existing: ImportedStudyRecord[] = [], existingCourses: ImportedCourseAchievement[] = []): ImportPreviewUnit[] {
  const rows: ImportPreviewUnit[] = [];
  for (const [courseIndex, course] of data.courses.entries()) {
    const sourceCourse = sourceCourseFor(course, data.capturedAt, courseIndex, offerings);
    const sourceCourseId = sourceCourse.id;
    const sourceDuplicate = existingCourses.some(value => value.fingerprint === sourceCourse.fingerprint || sameSourceIdentity(value, sourceCourse));
    const aggregate = { sourceCourseId, earnedCreditsTotal: course.earnedCredits.value, schoolingCreditsTotal: course.schoolingCredits.value, compositionCredits: course.compositionCredits.value, recognizedExemption: course.recognizedExemption.value, additionalEnrollment: course.additionalEnrollment.value, capturedAt: data.capturedAt };
    if (hasCorrespondenceEvidence(course)) {
      const correspondence = match(course.rawName, 'correspondence', offerings);
      const inferred = inferredCorrespondenceYear(course, data.capturedAt);
      const base = { rawName: course.rawName, method: 'correspondence' as const, academicYear: inferred.academicYear, yearSource: inferred.academicYear === null ? 'unknown' as const : 'inferred' as const, rawYear: null, term: null, rawTerm: null, date: course.creditExam.date ?? inferred.date, credits: course.creditExam.credits, grade: course.creditExam.grade, reports: course.reports, examGrade: course.creditExam.grade, ...aggregate };
      const record = { ...base, id: crypto.randomUUID(), source: 'hosei_import' as const, offeringId: correspondence.candidates[0]?.id ?? null, match: correspondence.match };
      const fingerprint = importFingerprint(record); const duplicate = existing.some(x => x.fingerprint === fingerprint); rows.push({ ...record, fingerprint, candidates: correspondence.candidates, duplicate, sourceCourse, sourceDuplicate, selected: !sourceDuplicate });
    }
    course.schoolings.forEach((slot, index) => {
      if (!slot.rawYear && !slot.rawTerm && !slot.rawDate && !slot.rawCredits && !slot.rawGrade) return;
      const result = match(course.rawName, 'schooling', offerings);
      const sourceYear = schoolingAcademicYear(slot.year) ?? schoolingAcademicYear(slot.rawYear);
      const inferredYear = sourceYear ?? academicYearFromDate(slot.date ?? data.capturedAt.slice(0, 10));
      const candidate = { rawName: course.rawName, method: 'schooling' as const, academicYear: inferredYear, yearSource: sourceYear !== null ? 'source' as const : inferredYear !== null ? 'inferred' as const : 'unknown' as const, rawYear: slot.rawYear || null, term: slot.term, rawTerm: slot.rawTerm || null, date: slot.date, credits: slot.credits, grade: slot.grade, ...aggregate };
      const record = { ...candidate, id: crypto.randomUUID(), source: 'hosei_import' as const, offeringId: result.candidates[0]?.id ?? null, match: result.match };
      const fingerprint = `${importFingerprint(record)}:${index}`; const duplicate = existing.some(x => x.fingerprint === fingerprint); rows.push({ ...record, fingerprint, candidates: result.candidates, duplicate, sourceCourse, sourceDuplicate, selected: !sourceDuplicate });
    });
    if (!hasCorrespondenceEvidence(course) && !course.schoolings.some(slot => slot.rawYear || slot.rawTerm || slot.rawDate || slot.rawCredits || slot.rawGrade)) {
      const result = match(course.rawName, 'correspondence', offerings);
      const record = { id: crypto.randomUUID(), fingerprint: `course-only:${sourceCourse.fingerprint}`, source: 'hosei_import' as const, rawName: course.rawName, offeringId: null, match: result.match, method: 'correspondence' as const, academicYear: sourceCourse.academicYear, yearSource: sourceCourse.yearSource, rawYear: null, term: null, rawTerm: null, date: null, credits: null, grade: null, ...aggregate };
      rows.push({ ...record, candidates: result.candidates, duplicate: false, sourceCourse, sourceDuplicate, selected: !sourceDuplicate, courseOnly: true });
    }
  }
  return rows;
}
export function applyImport(state: PlannerState, units: ImportPreviewUnit[]): PlannerState {
  const selected = units.filter(unit => unit.selected && !unit.sourceDuplicate);
  const sourceAdditions = [...new Map(selected.map(unit => [unit.sourceCourse.fingerprint, unit.sourceCourse])).values()]
    .filter(course => !state.importedCourseAchievements.some(existing => existing.fingerprint === course.fingerprint));
  const additions: ImportedStudyRecord[] = selected.filter(x => !x.duplicate && !x.courseOnly).map(unit => ({
    id: unit.id, fingerprint: unit.fingerprint, source: unit.source, rawName: unit.rawName, offeringId: unit.offeringId, match: unit.match,
    method: unit.method, academicYear: unit.academicYear, yearSource: unit.yearSource, rawYear: unit.rawYear, term: unit.term, rawTerm: unit.rawTerm,
    date: unit.date, credits: unit.credits, grade: unit.grade, ...(unit.reports ? { reports: unit.reports } : {}), ...(unit.examGrade !== undefined ? { examGrade: unit.examGrade } : {}),
    sourceCourseId: unit.sourceCourseId, earnedCreditsTotal: unit.earnedCreditsTotal, schoolingCreditsTotal: unit.schoolingCreditsTotal, compositionCredits: unit.compositionCredits, recognizedExemption: unit.recognizedExemption, additionalEnrollment: unit.additionalEnrollment, capturedAt: unit.capturedAt,
  }));
  return { ...state, importedStudyRecords: [...state.importedStudyRecords, ...additions], importedCourseAchievements: [...state.importedCourseAchievements, ...sourceAdditions] };
}

export function importedEarnedCreditsTotal(rows: ImportedCourseAchievement[]): number { return rows.reduce((sum, row) => sum + (row.earnedCreditsTotal && row.earnedCreditsTotal > 0 ? row.earnedCreditsTotal : 0), 0); }

export function groupImportedAchievements(records: ImportedStudyRecord[]) {
  const groups = new Map<number | null, ImportedStudyRecord[]>();
  [...records].sort((a, b) => (b.academicYear ?? -Infinity) - (a.academicYear ?? -Infinity) || a.rawName.localeCompare(b.rawName, 'ja') || a.method.localeCompare(b.method) || (a.date ?? '').localeCompare(b.date ?? '')).forEach(record => {
    const group = groups.get(record.academicYear) ?? []; group.push(record); groups.set(record.academicYear, group);
  });
  return [...groups.entries()].sort(([a], [b]) => (b ?? -Infinity) - (a ?? -Infinity));
}
