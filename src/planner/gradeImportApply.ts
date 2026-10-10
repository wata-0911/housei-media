import { parseHoseiGradeImportV1, type HoseiGradeImportCourse } from './gradeImportContract';
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
 * single source-course row. Their absence identifies a v9 legacy record.
 * date is the learning evidence date: exam, otherwise latest report for correspondence;
 * actual session date for schooling. It is not an exam-date field (use examDate).
 * Legacy date/year values are retained on reimport, never reinterpreted as source facts. */
export type ImportedStudyRecord = { id: string; fingerprint: string; source: 'hosei_import'; rawName: string; offeringId: string | null; match: ImportMatch; method: ImportMethod; academicYear: number | null; yearSource: 'source' | 'inferred' | 'manual' | 'unknown'; rawYear: string | null; term: string | null; rawTerm: string | null; date: string | null; credits: number | null; grade: string | null; reports?: HoseiGradeImportCourse['reports']; examGrade?: string | null; sourceCourseId?: string; earnedCreditsTotal?: number | null; schoolingCreditsTotal?: number | null; compositionCredits?: number | null; recognizedExemption?: number | null; additionalEnrollment?: number | null; examDate?: string | null; capturedAt?: string };
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
export function inferredCorrespondenceYear(course: HoseiGradeImportCourse): { academicYear: number | null; date: string | null } {
  const reportDates = course.reports.map(report => report.date).filter((date): date is string => date !== null).sort();
  const date = course.creditExam.date ?? reportDates.at(-1) ?? null;
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
function match(name: string, method: ImportMethod, offerings: Offering[], academicYear?: number | null) { const candidates = offerings.filter(o => o.method === method && normalizeImportName(o.name) === normalizeImportName(name) && (academicYear == null || o.academicYear === academicYear)); return { candidates, match: academicYear !== null && candidates.length === 1 ? 'exact_unique' as const : candidates.length ? 'ambiguous' as const : 'unmatched' as const }; }
function sourceFingerprint(course: HoseiGradeImportCourse, occurrence: number) {
  const schoolings = course.schoolings.map(slot => [slot.rawYear, slot.rawTerm, slot.rawDate, slot.rawCredits, slot.rawGrade]);
  const reports = course.reports.map(report => [report.raw, report.status, report.date]);
  const exam = [course.creditExam.rawDate, course.creditExam.rawCredits, course.creditExam.rawGrade, course.creditExam.pendingMarker];
  return JSON.stringify(['source-v2', normalizeImportName(course.rawName), course.categoryRaw === null ? null : normalizeImportName(course.categoryRaw), schoolings, reports, exam, occurrence]);
}
/**
 * 取込元の試験日を表示用に取得する。
 * 新しいレコードは examDate を優先する。
 * 古いレコードのみ、元の成績表行の fingerprint から復元する。
 */
export function importedExamDate(
  record: ImportedStudyRecord,
  source?: ImportedCourseAchievement
): string | null {
  if (record.method !== 'correspondence') return null;

  const validDate = (value: string): boolean => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  };

  // 新形式: null は明示的に「試験日なし」を意味する。
  if (record.examDate !== undefined) {
    return typeof record.examDate === 'string'
      && validDate(record.examDate)
      ? record.examDate
      : null;
  }

  // 旧形式: 公式成績表の元レコードがなければ推測しない。
  if (!source ||
    !record.sourceCourseId ||
    source.id !== record.sourceCourseId ||
    normalizeImportName(source.rawName) !== normalizeImportName(record.rawName)) {
    return null;
  }

  let fingerprint: unknown;

  try {
    fingerprint = JSON.parse(source.fingerprint);
  } catch {
    return null;
  }

  if (!Array.isArray(fingerprint) ||
    fingerprint.length !== 7 ||
    fingerprint[0] !== 'source-v2' ||
    fingerprint[1] !== normalizeImportName(record.rawName) ||
    !Array.isArray(fingerprint[3]) ||
    fingerprint[3].length !== 2 ||
    !Array.isArray(fingerprint[4]) ||
    fingerprint[4].length !== 4 ||
    !Array.isArray(fingerprint[5]) ||
    fingerprint[5].length !== 4 ||
    typeof fingerprint[5][0] !== 'string' ||
    typeof fingerprint[5][3] !== 'boolean') {
    return null;
  }

  const rawDate = fingerprint[5][0].trim();

  // extractor.js と同じ日付表記を解釈する。
  const match = /^(\d{2}|\d{4})[/.年](\d{1,2})[/.月](\d{1,2})(?:日)?$/.exec(rawDate);

  if (!match) return null;

  const year = match[1].length === 2
    ? 2000 + Number(match[1])
    : Number(match[1]);

  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');

  // 実在する日付で、従来保存した日付とも一致する場合だけ採用。
  if (!validDate(date) || record.date !== date) return null;

  return date;
}
function sameSourceIdentity(a: ImportedCourseAchievement, b: ImportedCourseAchievement) { return a.fingerprint === b.fingerprint; }
// Derived/manual years are not official aggregate facts. Explicit source years
// already belong to the unchanged source-v2 fingerprint.
function sameSourceFacts(a: ImportedCourseAchievement, b: ImportedCourseAchievement) { return a.earnedCreditsTotal === b.earnedCreditsTotal && a.schoolingCreditsTotal === b.schoolingCreditsTotal && a.compositionCredits === b.compositionCredits && a.recognizedExemption === b.recognizedExemption && a.additionalEnrollment === b.additionalEnrollment; }

/** Compare the native correspondence evidence, independently of other components
 * and aggregates. No legacy date is promoted to a learning date or rewritten. */
function sameUndatedComponent(old: ImportedStudyRecord, record: ImportedStudyRecord, source: ImportedCourseAchievement, existingSource?: ImportedCourseAchievement): boolean {
  if (!existingSource || old.sourceCourseId !== existingSource.id || record.method !== 'correspondence' || record.date !== null
    || old.fingerprint !== importFingerprint({ ...record, date: old.date })) return false;
  try {
    const previous: unknown = JSON.parse(existingSource.fingerprint);
    const incoming = JSON.parse(source.fingerprint);
    return Array.isArray(previous) && previous.length === 7 && previous[0] === 'source-v2'
      && [0, 1, 2, 4, 5, 6].every(index => JSON.stringify(previous[index]) === JSON.stringify(incoming[index]));
  } catch { return false; }
}
function sourceCourseFor(course: HoseiGradeImportCourse, capturedAt: string, occurrence: number, offerings: Offering[], context: ImportCurriculumContext): ImportedCourseAchievement {
  const candidates = offerings.filter(o => normalizeImportName(o.name) === normalizeImportName(course.rawName));
  const courseIds = new Set(candidates.filter(o => o.resolutionStatus === 'matched' && o.courseId !== null).map(o => o.courseId!));
  const courseId = courseIds.size === 1 ? [...courseIds][0] : null;
  // Stage B resolves every substantive component independently. A missing
  // opening must not disappear from the evidence for the whole source row.
  const resolveComponent = (method: ImportMethod, academicYear: number | null) => {
    const resolution = match(course.rawName, method, offerings, academicYear);
    const offering = resolution.candidates[0];
    return { candidates: resolution.candidates, safeOffering: academicYear !== null && resolution.match === 'exact_unique'
      && offering.resolutionStatus === 'matched' && offering.courseId !== null ? offering : null };
  };
  const components = [];
  if (hasCorrespondenceEvidence(course)) components.push(resolveComponent('correspondence', inferredCorrespondenceYear(course).academicYear));
  for (const slot of course.schoolings) {
    if (!slot.rawYear && !slot.rawTerm && !slot.rawDate && !slot.rawCredits && !slot.rawGrade) continue;
    const year = schoolingAcademicYear(slot.year) ?? schoolingAcademicYear(slot.rawYear) ?? academicYearFromDate(slot.date);
    components.push(resolveComponent('schooling', year));
  }
  // Course identity alone supplies no evidence of a particular year's opening.
  const openingCandidates = components.length ? components.flatMap(component => component.candidates) : candidates;
  const safeOpenings = new Map(components.flatMap(component => component.safeOffering ? [[component.safeOffering.id, component.safeOffering] as const] : []));
  const selectedOffering = components.length
    ? components.every(component => component.safeOffering !== null) && safeOpenings.size === 1 ? [...safeOpenings.values()][0] : null
    : null;
  const curriculumMatch = matchImportedCurriculumCourse(course, offerings, context.curriculum, context.mappings);
  const schooling = course.schoolings.find(slot => slot.rawYear || slot.rawTerm || slot.rawDate || slot.rawCredits || slot.rawGrade);
  const sourceYear = course.schoolings.map(slot => schoolingAcademicYear(slot.year) ?? schoolingAcademicYear(slot.rawYear)).find(year => year !== null) ?? null;
  const inferred = sourceYear ?? (schooling ? academicYearFromDate(schooling.date) : inferredCorrespondenceYear(course).academicYear);
  return { id: crypto.randomUUID(), fingerprint: sourceFingerprint(course, occurrence), source: 'hosei_import', rawName: course.rawName, categoryRaw: course.categoryRaw, capturedAt, earnedCreditsTotal: course.earnedCredits.value, schoolingCreditsTotal: course.schoolingCredits.value, compositionCredits: course.compositionCredits.value, recognizedExemption: course.recognizedExemption.value, additionalEnrollment: course.additionalEnrollment.value, academicYear: inferred, yearSource: sourceYear !== null ? 'source' : inferred !== null ? 'inferred' : 'unknown', ...curriculumMatch, offeringMatch: selectedOffering ? 'exact_unique' : openingCandidates.length ? 'ambiguous' : 'unmatched', courseId, selectedOfferingId: selectedOffering?.id ?? null, selectionSource: selectedOffering ? 'auto' : 'none', match: courseId ? 'exact_unique' : candidates.length ? 'ambiguous' : 'unmatched', candidateOfferingIds: candidates.map(candidate => candidate.id) };
}
export function importPreview(value: unknown, offerings: Offering[], existing: ImportedStudyRecord[] = [], existingCourses: ImportedCourseAchievement[] = [], context: ImportCurriculumContext = defaultCurriculumContext): ImportPreviewUnit[] {
  // All entry points, including direct callers, cross the same boundary before
  // matching, fingerprinting or retaining any source data in preview units.
  const data = parseHoseiGradeImportV1(value);
  if (!data) throw new Error('JSON が成績表 contract v1 を満たしていません。');
  const rows: ImportPreviewUnit[] = [];
  const occurrences = new Map<string, number>();
  for (const course of data.courses) {
    const firstUnit = rows.length;
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
      const inferred = inferredCorrespondenceYear(course);
      const correspondence = match(course.rawName, 'correspondence', offerings, inferred.academicYear);
      const base = { rawName: course.rawName, method: 'correspondence' as const, academicYear: inferred.academicYear, yearSource: inferred.academicYear === null ? 'unknown' as const : 'inferred' as const, rawYear: null, term: null, rawTerm: null, date: course.creditExam.date ?? inferred.date, examDate: course.creditExam.date, credits: course.creditExam.credits, grade: course.creditExam.grade, reports: course.reports, examGrade: course.creditExam.grade, ...aggregate };
      const record = { ...base, id: crypto.randomUUID(), source: 'hosei_import' as const, offeringId: correspondence.match === 'exact_unique' ? correspondence.candidates[0].id : null, match: correspondence.match };
      const fingerprint = importFingerprint(record); const duplicate = existing.some(x => x.fingerprint === fingerprint || sameUndatedComponent(x, { ...record, fingerprint }, sourceCourse, existingCourse)); rows.push({ ...record, fingerprint, candidates: correspondence.candidates, duplicate, sourceCourse, sourceDuplicate, sourceExistingId: existingCourse?.id ?? null, selected: !sourceDuplicate });
    }
    course.schoolings.forEach((slot, index) => {
      if (!slot.rawYear && !slot.rawTerm && !slot.rawDate && !slot.rawCredits && !slot.rawGrade) return;
      const sourceYear = schoolingAcademicYear(slot.year) ?? schoolingAcademicYear(slot.rawYear);
      const inferredYear = sourceYear ?? academicYearFromDate(slot.date);
      const result = match(course.rawName, 'schooling', offerings, inferredYear);
      const candidate = { rawName: course.rawName, method: 'schooling' as const, academicYear: inferredYear, yearSource: sourceYear !== null ? 'source' as const : inferredYear !== null ? 'inferred' as const : 'unknown' as const, rawYear: slot.rawYear || null, term: slot.term, rawTerm: slot.rawTerm || null, date: slot.date, credits: slot.credits, grade: slot.grade, ...aggregate };
      const record = { ...candidate, id: crypto.randomUUID(), source: 'hosei_import' as const, offeringId: result.match === 'exact_unique' ? result.candidates[0].id : null, match: result.match };
      const fingerprint = `${importFingerprint(record)}:${index}`; const duplicate = existing.some(x => x.fingerprint === fingerprint); rows.push({ ...record, fingerprint, candidates: result.candidates, duplicate, sourceCourse, sourceDuplicate, sourceExistingId: existingCourse?.id ?? null, selected: !sourceDuplicate });
    });
    if (!hasCorrespondenceEvidence(course) && !course.schoolings.some(slot => slot.rawYear || slot.rawTerm || slot.rawDate || slot.rawCredits || slot.rawGrade)) {
      const result = match(course.rawName, 'correspondence', offerings, null);
      const record = { id: crypto.randomUUID(), fingerprint: `course-only:${sourceCourse.fingerprint}`, source: 'hosei_import' as const, rawName: course.rawName, offeringId: null, match: result.match, method: 'correspondence' as const, academicYear: sourceCourse.academicYear, yearSource: sourceCourse.yearSource, rawYear: null, term: null, rawTerm: null, date: null, credits: null, grade: null, ...aggregate };
      rows.push({ ...record, candidates: result.candidates, duplicate: false, sourceCourse, sourceDuplicate, sourceExistingId: existingCourse?.id ?? null, selected: !sourceDuplicate, courseOnly: true });
    }
    // A changed source payload can add a component while its aggregates stay
    // identical. Make that update reviewable instead of suppressing its details.
    // An unchanged payload stays a duplicate, including intentionally removed records.
    const components = rows.slice(firstUnit);
    if (sourceDuplicate && existingCourse?.fingerprint !== sourceCourse.fingerprint
      && components.some(unit => !unit.duplicate && !unit.courseOnly)) {
      for (const unit of components) { unit.sourceDuplicate = false; unit.selected = true; }
    }
  }
  return rows;
}
/** Stage B retains the strict offering matcher. A course match never picks a representative opening. */
export function autoPlannerOfferingIdForImport(unit: ImportPreviewUnit, offerings: Offering[]): string | null {
  if (unit.academicYear === null) return null;
  const candidates = unit.courseOnly
    ? offerings.filter(offering => normalizeImportName(offering.name) === normalizeImportName(unit.rawName))
    : match(unit.rawName, unit.method, offerings).candidates;
  if (candidates.length !== 1) return null;
  const offering = candidates[0];
  // A source's historical year is not a registration in the current catalog.
  if (!unit.courseOnly && unit.yearSource !== 'manual' && unit.academicYear !== null && unit.academicYear !== offering.academicYear) return null;
  if (!unit.courseOnly && (unit.match !== 'exact_unique' || unit.offeringId !== offering.id
    || unit.candidates.length !== 1 || unit.candidates[0].id !== offering.id)) return null;
  if (unit.courseOnly && (unit.sourceCourse.match !== 'exact_unique'
    || unit.sourceCourse.candidateOfferingIds.length !== 1
    || unit.sourceCourse.candidateOfferingIds[0] !== offering.id)) return null;
  return offering.resolutionStatus === 'matched' && offering.courseId !== null ? offering.id : null;
}

/** Completion evidence comes from the source aggregate itself, never a catalog
 * target or component credits. Unknown/zero composition is not completion. */
function sourceAggregateComplete(source: ImportedCourseAchievement): boolean {
  return source.compositionCredits !== null && source.compositionCredits > 0
    && source.earnedCreditsTotal !== null && source.earnedCreditsTotal >= source.compositionCredits;
}

/** Official source duplicates may still fill a missing planner item. Their
 * unchecked preview selection only excludes official-data writes. A completed
 * source cannot manufacture a planned fallback when aggregate attribution is unsafe. */
export function autoPlannerItemsForImport(units: ImportPreviewUnit[], existing: PlannerItem[], offerings: Offering[]): PlannerItem[] {
  const existingIds = new Set(existing.map(item => item.offeringId));
  const unitsByOffering = new Map<string, ImportPreviewUnit[]>();
  const offeringsBySource = new Map<string, Set<string>>();
  const sourcesByOffering = new Map<string, Set<string>>();
  const unresolvedSources = new Set<string>();
  // Pass 1: bidirectional evidence includes every safe component, even deselected or
  // already planned ones. Checkboxes cannot attribute a row aggregate to an opening.
  for (const unit of units) {
    const id = autoPlannerOfferingIdForImport(unit, offerings);
    const sourceId = unit.sourceExistingId ?? unit.sourceCourse.id;
    if (!id) { if (!unit.courseOnly) unresolvedSources.add(sourceId); continue; }
    const sourceOfferings = offeringsBySource.get(sourceId) ?? new Set<string>();
    sourceOfferings.add(id);
    offeringsBySource.set(sourceId, sourceOfferings);
    const offeringSources = sourcesByOffering.get(id) ?? new Set<string>();
    offeringSources.add(sourceId);
    sourcesByOffering.set(id, offeringSources);
  }
  // Pass 2: selection/backfill controls additions only; existing items are preserved.
  for (const unit of units.filter(unit => unit.selected || unit.sourceDuplicate)) {
    const id = autoPlannerOfferingIdForImport(unit, offerings);
    const sourceId = unit.sourceExistingId ?? unit.sourceCourse.id;
    const aggregateAttributable = id !== null && offeringsBySource.get(sourceId)?.size === 1
      && !unresolvedSources.has(sourceId) && sourcesByOffering.get(id)?.size === 1;
    // Keep safe one-to-one earned generation. Otherwise a completed source is
    // official history only; incomplete sources retain the existing planned fallback.
    if (sourceAggregateComplete(unit.sourceCourse) && !aggregateAttributable) continue;
    if (id && !existingIds.has(id)) unitsByOffering.set(id, [...(unitsByOffering.get(id) ?? []), unit]);
  }
  return [...unitsByOffering].map(([id, units]) => {
    // Conflicting occurrences and inferred dates must not become certain plans.
    const years = new Set(units.map(unit => unit.yearSource === 'source' || unit.yearSource === 'manual' ? unit.academicYear : null));
    const terms = new Set(units.map(unit => unit.term === unit.rawTerm && isStandardTerm(unit.term) ? unit.term : null));
    // Only a one-to-one source/Offering relation in the full preview establishes earned.
    // Detail grades, exams, reports and their credit fields never decide it.
    const sourceIds = new Set(units.map(unit => unit.sourceExistingId ?? unit.sourceCourse.id));
    const earned = sourceIds.size === 1 && offeringsBySource.get([...sourceIds][0])?.size === 1
      && !unresolvedSources.has([...sourceIds][0])
      && sourcesByOffering.get(id)?.size === 1
      && units.every(unit => unit.sourceCourse.earnedCreditsTotal !== null && unit.sourceCourse.earnedCreditsTotal > 0);
    return { ...plannerItemFromCourseSearch(id), ...(earned ? { status: 'earned' as const, importedSourceCourseId: [...sourceIds][0] } : {}), plannedYear: years.size === 1 ? [...years][0] : null,
      plannedTerm: terms.size === 1 ? [...terms][0] : null };
  });
}

/** A conservative identity for updates to a native source snapshot. Content
 * fingerprints alone are not identities. Legacy/edited/undated records stay append-only. */
function componentIdentity(record: ImportedStudyRecord): string | null {
  if (!record.sourceCourseId || !record.date || record.credits === null || record.academicYear === null) return null;
  let slot: number | null = null;
  const base = importFingerprint(record);
  if (record.method === 'schooling') {
    const suffix = /:([01])$/.exec(record.fingerprint);
    if (!suffix || record.fingerprint !== `${base}:${suffix[1]}` || !record.rawYear || !record.rawTerm) return null;
    slot = Number(suffix[1]);
  } else if (record.fingerprint !== base) return null;
  return JSON.stringify([record.sourceCourseId, record.rawName, record.method, slot, record.academicYear, record.rawYear, record.rawTerm, record.date, record.credits]);
}

function reconcileStudyRecords(existing: ImportedStudyRecord[], additions: ImportedStudyRecord[], allIncoming: ImportedStudyRecord[]): ImportedStudyRecord[] {
  const updates = new Map<string, ImportedStudyRecord>(); const appended: ImportedStudyRecord[] = [];
  for (const record of additions) {
    const key = componentIdentity(record);
    const matches = key === null ? [] : existing.filter(old => componentIdentity(old) === key);
    // Selection must not turn competing incoming slots into a unique update.
    const incoming = key === null ? [] : allIncoming.filter(next => componentIdentity(next) === key);
    if (matches.length === 1 && incoming.length === 1) {
      const old = matches[0];
      // Keep learner-managed association/year context; source content is refreshed.
      updates.set(old.id, { ...record, id: old.id, offeringId: old.offeringId, match: old.match, academicYear: old.academicYear, yearSource: old.yearSource, term: old.term });
    } else appended.push(record);
  }
  return [...existing.map(old => updates.get(old.id) ?? old), ...appended];
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
    date: unit.date,
    examDate: unit.examDate ?? null,
    credits: unit.credits,
    grade: unit.grade, ...(unit.reports ? { reports: unit.reports } : {}), ...(unit.examGrade !== undefined ? { examGrade: unit.examGrade } : {}),
    sourceCourseId: sourceIdFor.get(unit.sourceCourseId!) ?? unit.sourceCourseId, earnedCreditsTotal: unit.earnedCreditsTotal, schoolingCreditsTotal: unit.schoolingCreditsTotal, compositionCredits: unit.compositionCredits, recognizedExemption: unit.recognizedExemption, additionalEnrollment: unit.additionalEnrollment, capturedAt: unit.capturedAt,
  }));
  const rows = state.importedCourseAchievements.map(existing => { const update = sourceUpdates.get(existing.id); if (!update) return existing; return { ...existing, ...update, id: existing.id, academicYear: existing.academicYear, yearSource: existing.yearSource, ...(existing.selectionSource === 'manual' ? { courseId: existing.courseId, match: existing.match, curriculumCourseId: existing.curriculumCourseId, curriculumMatch: existing.curriculumMatch, candidateCurriculumCourseIds: existing.candidateCurriculumCourseIds, offeringMatch: existing.offeringMatch, candidateOfferingIds: existing.candidateOfferingIds } : {}), selectedOfferingId: existing.selectionSource === 'manual' ? existing.selectedOfferingId : update.selectedOfferingId, selectionSource: existing.selectionSource === 'manual' ? 'manual' : update.selectionSource }; });
  const allIncoming = units.filter(unit => !unit.courseOnly).map(unit => ({ ...unit, sourceCourseId: unit.sourceExistingId ?? unit.sourceCourse.id }));
  return { ...state, items: [...state.items, ...plannerAdditions], importedStudyRecords: reconcileStudyRecords(state.importedStudyRecords, additions, allIncoming), importedCourseAchievements: [...rows, ...sourceAdditions] };
}

export function importedEarnedCreditsTotal(rows: ImportedCourseAchievement[]): number { return rows.reduce((sum, row) => sum + (row.earnedCreditsTotal && row.earnedCreditsTotal > 0 ? row.earnedCreditsTotal : 0), 0); }

export function groupImportedAchievements(records: ImportedStudyRecord[]) {
  const groups = new Map<number | null, ImportedStudyRecord[]>();
  [...records].sort((a, b) => (b.academicYear ?? -Infinity) - (a.academicYear ?? -Infinity) || a.rawName.localeCompare(b.rawName, 'ja') || a.method.localeCompare(b.method) || (a.date ?? '').localeCompare(b.date ?? '')).forEach(record => {
    const group = groups.get(record.academicYear) ?? []; group.push(record); groups.set(record.academicYear, group);
  });
  return [...groups.entries()].sort(([a], [b]) => (b ?? -Infinity) - (a ?? -Infinity));
}
