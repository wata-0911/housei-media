import type { HoseiGradeImportCourse, HoseiGradeImportV1 } from './gradeImportContract';
import type { Offering, PlannerState } from './plannerCatalog';

export type ImportMethod = 'correspondence' | 'schooling';
export type ImportMatch = 'exact_unique' | 'ambiguous' | 'unmatched';
export type ImportedStudyRecord = { id: string; fingerprint: string; source: 'hosei_import'; rawName: string; offeringId: string | null; match: ImportMatch; method: ImportMethod; academicYear: number | null; yearSource: 'source' | 'inferred' | 'manual' | 'unknown'; rawYear: string | null; term: string | null; rawTerm: string | null; date: string | null; credits: number | null; grade: string | null; reports?: HoseiGradeImportCourse['reports']; examGrade?: string | null };
export type ImportPreviewUnit = ImportedStudyRecord & { selected: boolean; candidates: Offering[]; duplicate: boolean };

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
export function importFingerprint(record: Omit<ImportedStudyRecord, 'id' | 'fingerprint' | 'source' | 'offeringId' | 'match'>): string { return JSON.stringify([record.rawName, record.method, record.rawYear, record.rawTerm, record.date, record.credits, record.grade, record.method === 'correspondence' ? record.reports?.map(x => x.raw) : null, record.examGrade ?? null]); }
function match(name: string, method: ImportMethod, offerings: Offering[]) { const candidates = offerings.filter(o => o.method === method && normalizeImportName(o.name) === normalizeImportName(name)); return { candidates, match: candidates.length === 1 ? 'exact_unique' as const : candidates.length ? 'ambiguous' as const : 'unmatched' as const }; }
export function importPreview(data: HoseiGradeImportV1, offerings: Offering[], existing: ImportedStudyRecord[] = []): ImportPreviewUnit[] {
  const rows: ImportPreviewUnit[] = [];
  for (const course of data.courses) {
    const correspondence = match(course.rawName, 'correspondence', offerings);
    const inferred = inferredCorrespondenceYear(course, data.capturedAt);
    const base = { rawName: course.rawName, method: 'correspondence' as const, academicYear: inferred.academicYear, yearSource: inferred.academicYear === null ? 'unknown' as const : 'inferred' as const, rawYear: null, term: null, rawTerm: null, date: course.creditExam.date ?? inferred.date, credits: course.creditExam.credits, grade: course.creditExam.grade, reports: course.reports, examGrade: course.creditExam.grade };
    const record = { ...base, id: crypto.randomUUID(), source: 'hosei_import' as const, offeringId: correspondence.candidates[0]?.id ?? null, match: correspondence.match };
    const fingerprint = importFingerprint(record); const duplicate = existing.some(x => x.fingerprint === fingerprint); rows.push({ ...record, fingerprint, candidates: correspondence.candidates, duplicate, selected: !duplicate });
    course.schoolings.forEach((slot, index) => {
      if (!slot.rawYear && !slot.rawTerm && !slot.rawDate && !slot.rawCredits && !slot.rawGrade) return;
      const result = match(course.rawName, 'schooling', offerings); const year = schoolingAcademicYear(slot.year);
      const candidate = { rawName: course.rawName, method: 'schooling' as const, academicYear: year, yearSource: year === null ? 'unknown' as const : 'source' as const, rawYear: slot.rawYear || null, term: slot.term, rawTerm: slot.rawTerm || null, date: slot.date, credits: slot.credits, grade: slot.grade };
      const record = { ...candidate, id: crypto.randomUUID(), source: 'hosei_import' as const, offeringId: result.candidates[0]?.id ?? null, match: result.match };
      const fingerprint = `${importFingerprint(record)}:${index}`; const duplicate = existing.some(x => x.fingerprint === fingerprint); rows.push({ ...record, fingerprint, candidates: result.candidates, duplicate, selected: !duplicate });
    });
  }
  return rows;
}
export function applyImport(state: PlannerState, units: ImportPreviewUnit[]): PlannerState {
  const additions: ImportedStudyRecord[] = units.filter(x => x.selected && !x.duplicate).map(unit => ({
    id: unit.id, fingerprint: unit.fingerprint, source: unit.source, rawName: unit.rawName, offeringId: unit.offeringId, match: unit.match,
    method: unit.method, academicYear: unit.academicYear, yearSource: unit.yearSource, rawYear: unit.rawYear, term: unit.term, rawTerm: unit.rawTerm,
    date: unit.date, credits: unit.credits, grade: unit.grade, ...(unit.reports ? { reports: unit.reports } : {}), ...(unit.examGrade !== undefined ? { examGrade: unit.examGrade } : {}),
  }));
  return { ...state, importedStudyRecords: [...state.importedStudyRecords, ...additions] };
}

export function groupImportedAchievements(records: ImportedStudyRecord[]) {
  const groups = new Map<number | null, ImportedStudyRecord[]>();
  [...records].sort((a, b) => (b.academicYear ?? -Infinity) - (a.academicYear ?? -Infinity) || a.rawName.localeCompare(b.rawName, 'ja') || a.method.localeCompare(b.method) || (a.date ?? '').localeCompare(b.date ?? '')).forEach(record => {
    const group = groups.get(record.academicYear) ?? []; group.push(record); groups.set(record.academicYear, group);
  });
  return [...groups.entries()].sort(([a], [b]) => (b ?? -Infinity) - (a ?? -Infinity));
}
