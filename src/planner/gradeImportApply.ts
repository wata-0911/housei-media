import type { HoseiGradeImportCourse, HoseiGradeImportV1 } from './gradeImportContract';
import type { Offering, PlannerItem, PlannerState } from './plannerCatalog';
import { plannerItemFromCourseSearch } from './plannerItemState';
import { isStandardTerm } from './planTable';
import { matchImportedCurriculumCourse, type CurriculumImportMatch } from './curriculumImportMatch';
import { curriculumCatalog } from './curriculumCatalog';
import catalogSnapshot from '../data/planner_catalog_2026.json';
import type { CurriculumCatalog, Mapping } from './plannerCatalog';

export type ImportCurriculumContext = { curriculum: CurriculumCatalog; mappings: Mapping[] };
const defaultCurriculumContext: ImportCurriculumContext = { curriculum: curriculumCatalog, mappings: catalogSnapshot.mappings as Mapping[] };

export type ImportMethod = 'correspondence' | 'schooling';
export type ImportMatch = 'exact_unique' | 'ambiguous' | 'unmatched';
export type ImportSelectionSource = 'none' | 'auto' | 'manual';
/** One immutable source row from the grade table.  It is deliberately kept
 * independently from its correspondence/schooling detail records. */
export type ImportedCourseAchievement = Partial<CurriculumImportMatch> & { offeringMatch?: ImportMatch; id: string; fingerprint: string; source: 'hosei_import'; rawName: string; categoryRaw: string | null; capturedAt: string; earnedCreditsTotal: number | null; schoolingCreditsTotal: number | null; compositionCredits: number | null; recognizedExemption: number | null; additionalEnrollment: number | null; academicYear: number | null; yearSource: 'source' | 'inferred' | 'manual' | 'unknown'; courseId: string | null; selectedOfferingId: string | null; selectionSource: ImportSelectionSource; match: ImportMatch; candidateOfferingIds: string[] };
/** A component is retained for display, while these optional fields preserve the
 * single source-course row.  Their absence identifies a v9 legacy record. */
export type ImportedStudyRecord = { id: string; fingerprint: string; source: 'hosei_import'; rawName: string; offeringId: string | null; match: ImportMatch; method: ImportMethod; academicYear: number | null; yearSource: 'source' | 'inferred' | 'manual' | 'unknown'; rawYear: string | null; term: string | null; rawTerm: string | null; date: string | null; credits: number | null; grade: string | null; reports?: HoseiGradeImportCourse['reports']; examGrade?: string | null; sourceCourseId?: string; earnedCreditsTotal?: number | null; schoolingCreditsTotal?: number | null; compositionCredits?: number | null; recognizedExemption?: number | null; additionalEnrollment?: number | null; capturedAt?: string };
export type ImportPreviewUnit = ImportedStudyRecord & { selected: boolean; candidates: Offering[]; duplicate: boolean; sourceCourse: ImportedCourseAchievement; sourceDuplicate: boolean; sourceExistingId: string | null; courseOnly?: boolean };

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
function sourceFingerprint(course: HoseiGradeImportCourse, occurrence: number) {
  const schoolings = course.schoolings.map(slot => [slot.rawYear, slot.rawTerm, slot.rawDate, slot.rawCredits, slot.rawGrade]);
  const reports = course.reports.map(report => [report.raw, report.status, report.date]);
  const exam = [course.creditExam.rawDate, course.creditExam.rawCredits, course.creditExam.rawGrade, course.creditExam.pendingMarker];
  return JSON.stringify(['source-v2', normalizeImportName(course.rawName), course.categoryRaw === null ? null : normalizeImportName(course.categoryRaw), schoolings, reports, exam, occurrence]);
}
function sameSourceIdentity(a: ImportedCourseAchievement, b: ImportedCourseAchievement) { return a.fingerprint === b.fingerprint; }
function sameSourceFacts(a: ImportedCourseAchievement, b: ImportedCourseAchievement) { return a.earnedCreditsTotal === b.earnedCreditsTotal && a.schoolingCreditsTotal === b.schoolingCreditsTotal && a.compositionCredits === b.compositionCredits && a.recognizedExemption === b.recognizedExemption && a.additionalEnrollment === b.additionalEnrollment && a.academicYear === b.academicYear; }
function sourceCourseFor(course: HoseiGradeImportCourse, capturedAt: string, occurrence: number, offerings: Offering[], context: ImportCurriculumContext): ImportedCourseAchievement {
  const candidates = offerings.filter(o => normalizeImportName(o.name) === normalizeImportName(course.rawName));
  const courseIds = new Set(candidates.filter(o => o.resolutionStatus === 'matched' && o.courseId !== null).map(o => o.courseId!));
  const courseId = courseIds.size === 1 ? [...courseIds][0] : null;
  const correspondenceEvidence = hasCorrespondenceEvidence(course);
  const schoolingEvidence = course.schoolings.some(slot => slot.rawYear || slot.rawTerm || slot.rawDate || slot.rawCredits || slot.rawGrade);
  const openingCandidates = candidates.filter(offering => (!correspondenceEvidence && !schoolingEvidence)
    || (offering.method === 'correspondence' ? correspondenceEvidence : schoolingEvidence));
  const selectedOffering = openingCandidates.length === 1 && openingCandidates[0].resolutionStatus === 'matched' ? openingCandidates[0] : null;
  const curriculumMatch = matchImportedCurriculumCourse(course, offerings, context.curriculum, context.mappings);
  const schooling = course.schoolings.find(slot => slot.rawYear || slot.rawTerm || slot.rawDate || slot.rawCredits || slot.rawGrade);
  const sourceYear = schooling ? schoolingAcademicYear(schooling.year) ?? schoolingAcademicYear(schooling.rawYear) : null;
  const inferred = sourceYear ?? (schooling ? academicYearFromDate(schooling.date ?? capturedAt.slice(0, 10)) : inferredCorrespondenceYear(course, capturedAt).academicYear);
  return { id: crypto.randomUUID(), fingerprint: sourceFingerprint(course, occurrence), source: 'hosei_import', rawName: course.rawName, categoryRaw: course.categoryRaw, capturedAt, earnedCreditsTotal: course.earnedCredits.value, schoolingCreditsTotal: course.schoolingCredits.value, compositionCredits: course.compositionCredits.value, recognizedExemption: course.recognizedExemption.value, additionalEnrollment: course.additionalEnrollment.value, academicYear: inferred, yearSource: sourceYear !== null ? 'source' : inferred !== null ? 'inferred' : 'unknown', ...curriculumMatch, offeringMatch: selectedOffering ? 'exact_unique' : openingCandidates.length ? 'ambiguous' : 'unmatched', courseId, selectedOfferingId: selectedOffering?.id ?? null, selectionSource: selectedOffering ? 'auto' : 'none', match: courseId ? 'exact_unique' : candidates.length ? 'ambiguous' : 'unmatched', candidateOfferingIds: candidates.map(candidate => candidate.id) };
}
export function importPreview(data: HoseiGradeImportV1, offerings: Offering[], existing: ImportedStudyRecord[] = [], existingCourses: ImportedCourseAchievement[] = [], context: ImportCurriculumContext = defaultCurriculumContext): ImportPreviewUnit[] {
  const rows: ImportPreviewUnit[] = [];
  const occurrences = new Map<string, number>();
  for (const course of data.courses) {
    const baseFingerprint = sourceFingerprint(course, 0);
    const occurrence = occurrences.get(baseFingerprint) ?? 0;
    occurrences.set(baseFingerprint, occurrence + 1);
    const sourceCourse = sourceCourseFor(course, data.capturedAt, occurrence, offerings, context);
    const sourceCourseId = sourceCourse.id;
    const exactExisting = existingCourses.find(value => sameSourceIdentity(value, sourceCourse));
    const legacyMatches = existingCourses.filter(value => normalizeImportName(value.rawName) === normalizeImportName(sourceCourse.rawName) && value.categoryRaw === sourceCourse.categoryRaw);
    const existingCourse = exactExisting ?? (legacyMatches.length === 1 ? legacyMatches[0] : undefined);
    const sourceDuplicate = existingCourse !== undefined && sameSourceFacts(existingCourse, sourceCourse);
    const aggregate = { sourceCourseId, earnedCreditsTotal: course.earnedCredits.value, schoolingCreditsTotal: course.schoolingCredits.value, compositionCredits: course.compositionCredits.value, recognizedExemption: course.recognizedExemption.value, additionalEnrollment: course.additionalEnrollment.value, capturedAt: data.capturedAt };
    if (hasCorrespondenceEvidence(course)) {
      const correspondence = match(course.rawName, 'correspondence', offerings);
      const inferred = inferredCorrespondenceYear(course, data.capturedAt);
      const base = { rawName: course.rawName, method: 'correspondence' as const, academicYear: inferred.academicYear, yearSource: inferred.academicYear === null ? 'unknown' as const : 'inferred' as const, rawYear: null, term: null, rawTerm: null, date: course.creditExam.date ?? inferred.date, credits: course.creditExam.credits, grade: course.creditExam.grade, reports: course.reports, examGrade: course.creditExam.grade, ...aggregate };
      const record = { ...base, id: crypto.randomUUID(), source: 'hosei_import' as const, offeringId: correspondence.match === 'exact_unique' ? correspondence.candidates[0].id : null, match: correspondence.match };
      const fingerprint = importFingerprint(record); const duplicate = existing.some(x => x.fingerprint === fingerprint); rows.push({ ...record, fingerprint, candidates: correspondence.candidates, duplicate, sourceCourse, sourceDuplicate, sourceExistingId: existingCourse?.id ?? null, selected: !sourceDuplicate });
    }
    course.schoolings.forEach((slot, index) => {
      if (!slot.rawYear && !slot.rawTerm && !slot.rawDate && !slot.rawCredits && !slot.rawGrade) return;
      const result = match(course.rawName, 'schooling', offerings);
      const sourceYear = schoolingAcademicYear(slot.year) ?? schoolingAcademicYear(slot.rawYear);
      const inferredYear = sourceYear ?? academicYearFromDate(slot.date ?? data.capturedAt.slice(0, 10));
      const candidate = { rawName: course.rawName, method: 'schooling' as const, academicYear: inferredYear, yearSource: sourceYear !== null ? 'source' as const : inferredYear !== null ? 'inferred' as const : 'unknown' as const, rawYear: slot.rawYear || null, term: slot.term, rawTerm: slot.rawTerm || null, date: slot.date, credits: slot.credits, grade: slot.grade, ...aggregate };
      const record = { ...candidate, id: crypto.randomUUID(), source: 'hosei_import' as const, offeringId: result.match === 'exact_unique' ? result.candidates[0].id : null, match: result.match };
      const fingerprint = `${importFingerprint(record)}:${index}`; const duplicate = existing.some(x => x.fingerprint === fingerprint); rows.push({ ...record, fingerprint, candidates: result.candidates, duplicate, sourceCourse, sourceDuplicate, sourceExistingId: existingCourse?.id ?? null, selected: !sourceDuplicate });
    });
    if (!hasCorrespondenceEvidence(course) && !course.schoolings.some(slot => slot.rawYear || slot.rawTerm || slot.rawDate || slot.rawCredits || slot.rawGrade)) {
      const result = match(course.rawName, 'correspondence', offerings);
      const record = { id: crypto.randomUUID(), fingerprint: `course-only:${sourceCourse.fingerprint}`, source: 'hosei_import' as const, rawName: course.rawName, offeringId: null, match: result.match, method: 'correspondence' as const, academicYear: sourceCourse.academicYear, yearSource: sourceCourse.yearSource, rawYear: null, term: null, rawTerm: null, date: null, credits: null, grade: null, ...aggregate };
      rows.push({ ...record, candidates: result.candidates, duplicate: false, sourceCourse, sourceDuplicate, sourceExistingId: existingCourse?.id ?? null, selected: !sourceDuplicate, courseOnly: true });
    }
  }
  return rows;
}
/** Stage B retains the strict offering matcher. A course match never picks a representative opening. */
export function autoPlannerOfferingIdForImport(unit: ImportPreviewUnit, offerings: Offering[]): string | null {
  const candidates = unit.courseOnly
    ? offerings.filter(offering => normalizeImportName(offering.name) === normalizeImportName(unit.rawName))
    : match(unit.rawName, unit.method, offerings).candidates;
  if (candidates.length !== 1) return null;
  const offering = candidates[0];
  if (!unit.courseOnly && (unit.match !== 'exact_unique' || unit.offeringId !== offering.id
    || unit.candidates.length !== 1 || unit.candidates[0].id !== offering.id)) return null;
  if (unit.courseOnly && (unit.sourceCourse.match !== 'exact_unique'
    || unit.sourceCourse.candidateOfferingIds.length !== 1
    || unit.sourceCourse.candidateOfferingIds[0] !== offering.id)) return null;
  return offering.resolutionStatus === 'matched' && offering.courseId !== null ? offering.id : null;
}

/** Official source duplicates may still fill a missing planner item. Their
 * unchecked preview selection only excludes official-data writes. */
export function autoPlannerItemsForImport(units: ImportPreviewUnit[], existing: PlannerItem[], offerings: Offering[]): PlannerItem[] {
  const existingIds = new Set(existing.map(item => item.offeringId));
  const unitsByOffering = new Map<string, ImportPreviewUnit[]>();
  const offeringsBySource = new Map<string, Set<string>>();
  for (const unit of units.filter(unit => unit.selected || unit.sourceDuplicate)) {
    const id = autoPlannerOfferingIdForImport(unit, offerings);
    if (!id) continue;
    const sourceId = unit.sourceExistingId ?? unit.sourceCourse.id;
    const sourceOfferings = offeringsBySource.get(sourceId) ?? new Set<string>();
    sourceOfferings.add(id);
    offeringsBySource.set(sourceId, sourceOfferings);
    // Count existing components too: filling only one missing item does not prove
    // that the row aggregate belongs to that component.
    if (!existingIds.has(id)) unitsByOffering.set(id, [...(unitsByOffering.get(id) ?? []), unit]);
  }
  return [...unitsByOffering].map(([id, units]) => {
    // Conflicting occurrences and inferred dates must not become certain plans.
    const years = new Set(units.map(unit => unit.yearSource === 'source' || unit.yearSource === 'manual' ? unit.academicYear : null));
    const terms = new Set(units.map(unit => unit.term === unit.rawTerm && isStandardTerm(unit.term) ? unit.term : null));
    // Only a single source with one distinct safe Offering can establish earned.
    // Detail grades, exams, reports and their credit fields never decide it.
    const sourceIds = new Set(units.map(unit => unit.sourceExistingId ?? unit.sourceCourse.id));
    const earned = sourceIds.size === 1 && offeringsBySource.get([...sourceIds][0])?.size === 1
      && units.every(unit => unit.sourceCourse.earnedCreditsTotal !== null && unit.sourceCourse.earnedCreditsTotal > 0);
    return { ...plannerItemFromCourseSearch(id), ...(earned ? { status: 'earned' as const, importedSourceCourseId: [...sourceIds][0] } : {}), plannedYear: years.size === 1 ? [...years][0] : null,
      plannedTerm: terms.size === 1 ? [...terms][0] : null };
  });
}

export function applyImport(state: PlannerState, units: ImportPreviewUnit[], offerings: Offering[]): PlannerState {
  const selected = units.filter(unit => unit.selected && !unit.sourceDuplicate);
  const plannerAdditions = autoPlannerItemsForImport(units, state.items, offerings);
  // Preserve the official arrays (and the whole state for a complete no-op).
  if (selected.length === 0) return plannerAdditions.length > 0
    ? { ...state, items: [...state.items, ...plannerAdditions] } : state;
  const selectedSources = [...new Map(selected.map(unit => [unit.sourceCourse.fingerprint, unit])).values()];
  const sourceIdFor = new Map(selectedSources.map(unit => [unit.sourceCourse.id, unit.sourceExistingId ?? unit.sourceCourse.id]));
  const sourceAdditions = selectedSources.filter(unit => unit.sourceExistingId === null).map(unit => unit.sourceCourse);
  const sourceUpdates = new Map(selectedSources.filter(unit => unit.sourceExistingId !== null).map(unit => [unit.sourceExistingId!, unit.sourceCourse]));
  const additions: ImportedStudyRecord[] = selected.filter(x => !x.duplicate && !x.courseOnly).map(unit => ({
    id: unit.id, fingerprint: unit.fingerprint, source: unit.source, rawName: unit.rawName, offeringId: unit.offeringId, match: unit.match,
    method: unit.method, academicYear: unit.academicYear, yearSource: unit.yearSource, rawYear: unit.rawYear, term: unit.term, rawTerm: unit.rawTerm,
    date: unit.date, credits: unit.credits, grade: unit.grade, ...(unit.reports ? { reports: unit.reports } : {}), ...(unit.examGrade !== undefined ? { examGrade: unit.examGrade } : {}),
    sourceCourseId: sourceIdFor.get(unit.sourceCourseId!) ?? unit.sourceCourseId, earnedCreditsTotal: unit.earnedCreditsTotal, schoolingCreditsTotal: unit.schoolingCreditsTotal, compositionCredits: unit.compositionCredits, recognizedExemption: unit.recognizedExemption, additionalEnrollment: unit.additionalEnrollment, capturedAt: unit.capturedAt,
  }));
  const rows = state.importedCourseAchievements.map(existing => { const update = sourceUpdates.get(existing.id); if (!update) return existing; return { ...existing, ...update, id: existing.id, ...(existing.selectionSource === 'manual' ? { courseId: existing.courseId, match: existing.match, curriculumCourseId: existing.curriculumCourseId, curriculumMatch: existing.curriculumMatch, candidateCurriculumCourseIds: existing.candidateCurriculumCourseIds, offeringMatch: existing.offeringMatch } : {}), selectedOfferingId: existing.selectionSource === 'manual' ? existing.selectedOfferingId : update.selectedOfferingId, selectionSource: existing.selectionSource === 'manual' ? 'manual' : update.selectionSource }; });
  return { ...state, items: [...state.items, ...plannerAdditions], importedStudyRecords: [...state.importedStudyRecords, ...additions], importedCourseAchievements: [...rows, ...sourceAdditions] };
}

export function importedEarnedCreditsTotal(rows: ImportedCourseAchievement[]): number { return rows.reduce((sum, row) => sum + (row.earnedCreditsTotal && row.earnedCreditsTotal > 0 ? row.earnedCreditsTotal : 0), 0); }

export function groupImportedAchievements(records: ImportedStudyRecord[]) {
  const groups = new Map<number | null, ImportedStudyRecord[]>();
  [...records].sort((a, b) => (b.academicYear ?? -Infinity) - (a.academicYear ?? -Infinity) || a.rawName.localeCompare(b.rawName, 'ja') || a.method.localeCompare(b.method) || (a.date ?? '').localeCompare(b.date ?? '')).forEach(record => {
    const group = groups.get(record.academicYear) ?? []; group.push(record); groups.set(record.academicYear, group);
  });
  return [...groups.entries()].sort(([a], [b]) => (b ?? -Infinity) - (a ?? -Infinity));
}
