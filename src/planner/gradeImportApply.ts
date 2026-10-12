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
export type ImportPreviewUnit = ImportedStudyRecord & { selected: boolean; candidates: Offering[]; duplicate: boolean; sourceCourse: ImportedCourseAchievement; sourceDuplicate: boolean; sourceExistingId: string | null; sourceExistingSnapshot?: string; courseOnly?: boolean; sourceYearConflict?: boolean; sourceIdentityConflict?: boolean; sourceIdentityReason?: string; sourceComponentUpdateRequired?: boolean };

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
function sameSourceFingerprint(a: ImportedCourseAchievement, b: ImportedCourseAchievement) { return a.fingerprint === b.fingerprint; }
// Derived/manual years are not official aggregate facts. Explicit source years
// already belong to the unchanged source-v2 fingerprint.
function sameSourceFacts(a: ImportedCourseAchievement, b: ImportedCourseAchievement) { return a.earnedCreditsTotal === b.earnedCreditsTotal && a.schoolingCreditsTotal === b.schoolingCreditsTotal && a.compositionCredits === b.compositionCredits && a.recognizedExemption === b.recognizedExemption && a.additionalEnrollment === b.additionalEnrollment; }

type SourceEvidence = [string, string, string | null, string[][], unknown[][], unknown[], number];
function sourceEvidence(source: ImportedCourseAchievement): SourceEvidence | null {
  try {
    const value = JSON.parse(source.fingerprint);
    if (!Array.isArray(value) || value.length !== 7 || value[0] !== 'source-v2'
      || value[1] !== normalizeImportName(source.rawName)
      || value[2] !== (source.categoryRaw === null ? null : normalizeImportName(source.categoryRaw))
      || !Array.isArray(value[3]) || value[3].length !== 2
      || !value[3].every(slot => Array.isArray(slot) && slot.length === 5 && slot.every(field => typeof field === 'string'))
      || !Array.isArray(value[4]) || value[4].length !== 4
      || !value[4].every(report => Array.isArray(report) && report.length === 3 && typeof report[0] === 'string' && typeof report[1] === 'string' && (report[2] === null || typeof report[2] === 'string'))
      || !Array.isArray(value[5]) || value[5].length !== 4 || !value[5].slice(0, 3).every(field => typeof field === 'string') || typeof value[5][3] !== 'boolean'
      || !Number.isInteger(value[6]) || value[6] < 0) return null;
    return value as SourceEvidence;
  } catch { return null; }
}

/** A year may complete a native snapshot only when its other evidence survives.
 * A name/category match or aggregate total alone is not a row identity. */
function isSourceYearExtension(existing: ImportedCourseAchievement, incoming: ImportedCourseAchievement): boolean {
  const old = sourceEvidence(existing); const next = sourceEvidence(incoming);
  if (!old || !next || existing.fingerprint === incoming.fingerprint || !sameSourceFacts(existing, incoming)
    || incoming.yearSource !== 'source' || incoming.academicYear === null
    || old[6] !== 0 || next[6] !== 0
    || ![0, 1, 2, 4, 5, 6].every(index => JSON.stringify(old[index]) === JSON.stringify(next[index]))) return false;
  const years = new Set(next[3].map(slot => schoolingAcademicYear(slot[0])).filter(year => year !== null));
  if (years.size !== 1 || !years.has(incoming.academicYear)
    || next[3].some(slot => slot[0].trim() !== '' && schoolingAcademicYear(slot[0]) === null)
    || !next[3].some((slot, index) => old[3][index][0] === '' && schoolingAcademicYear(slot[0]) !== null)) return false;
  const anchored = old[3].some(slot => slot.some(field => field !== ''))
    || old[4].some(report => report[0] !== '' || report[1] !== 'none' || report[2] !== null)
    || old[5].some(field => field !== '' && field !== false);
  return anchored && old[3].every((slot, index) => slot.every((field, column) => field === '' || field === next[3][index][column]));
}

function canConfirmSourceYear(existing: ImportedCourseAchievement, incoming: ImportedCourseAchievement): boolean {
  return existing.academicYear === null && existing.yearSource === 'unknown' && isSourceYearExtension(existing, incoming);
}

function nativeDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const parts = /^(\d{2}|\d{4})[/.年](\d{1,2})[/.月](\d{1,2})日?$/.exec(raw.trim());
  if (!parts) return null;
  const year = parts[1].length === 2 ? 2000 + Number(parts[1]) : Number(parts[1]);
  const date = `${year}-${parts[2].padStart(2, '0')}-${parts[3].padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : date;
}

function nativeCredits(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/^\*/, '');
  return /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}

function sameCreditEvidence(old: unknown, next: unknown): boolean {
  return old === next || (nativeCredits(old) !== null && nativeCredits(old) === nativeCredits(next));
}

function sourceComponentDatesAgree(unit: ImportedStudyRecord & { sourceCourse: ImportedCourseAchievement; courseOnly?: boolean }): boolean {
  if (unit.courseOnly) return true;
  const evidence = sourceEvidence(unit.sourceCourse);
  if (!evidence) return false;
  if (unit.method === 'correspondence') {
    const examDate = nativeDate(evidence[5][0]);
    const reportDates = evidence[4].map(report => report[2]).filter((date): date is string => typeof date === 'string').sort();
    return examDate === (unit.examDate ?? null) && unit.date === (examDate ?? reportDates.at(-1) ?? null)
      && JSON.stringify(unit.reports?.map(report => [report.raw, report.status, report.date])) === JSON.stringify(evidence[4]);
  }
  const slot = /:([01])$/.exec(unit.fingerprint);
  return slot !== null && nativeDate(evidence[3][Number(slot[1])][2]) === unit.date;
}

/** Native learning dates, never capture dates or catalog matches, anchor a refresh.
 * Keep every occupied component's date/credits/method/slot; only dated results
 * may change. An additional slot may be retained without replacing old evidence.
 * This deliberately cannot authorize date corrections or undated result changes. */
function canRefreshSource(existing: ImportedCourseAchievement, incoming: ImportedCourseAchievement): boolean {
  if (isSourceYearExtension(existing, incoming)) return true;
  const old = sourceEvidence(existing); const next = sourceEvidence(incoming);
  if (!old || !next || old[6] !== 0 || next[6] !== 0
    || old[1] !== next[1] || old[2] !== next[2]
    || existing.compositionCredits !== incoming.compositionCredits
    || existing.recognizedExemption !== incoming.recognizedExemption
    || existing.additionalEnrollment !== incoming.additionalEnrollment) return false;
  let anchored = false;
  // Reports can change status on the same dated submission, not submission date.
  if (!old[4].every((report, index) => {
    const other = next[4][index];
    if (JSON.stringify(report) === JSON.stringify(other)) return true;
    return report[2] !== null && report[2] === other[2];
  })) return false;
  if (old[5][0] !== next[5][0] || !sameCreditEvidence(old[5][1], next[5][1])) return false;
  if (nativeDate(old[5][0]) !== null && nativeCredits(old[5][1]) !== null) anchored = true;
  else if (JSON.stringify(old[5]) !== JSON.stringify(next[5])) return false;
  if (!old[3].every((slot, index) => {
    const other = next[3][index];
    if (slot.every(field => field === '')) return true;
    if (![0, 1, 2].every(column => slot[column] === other[column]) || !sameCreditEvidence(slot[3], other[3])) return false;
    const datedSlot = nativeDate(slot[2]) !== null && schoolingAcademicYear(slot[0]) !== null && slot[1] !== '' && nativeCredits(slot[3]) !== null;
    if (datedSlot) anchored = true;
    return datedSlot || slot[4] === other[4];
  })) return false;
  // Adding/correcting an explicit year uses the stricter extension contract above.
  if (old[3].some((slot, index) => slot[0] !== next[3][index][0])) return false;
  return anchored;
}

type SourceResolution = { kind: 'new' | 'duplicate' | 'update' | 'held'; existing?: ImportedCourseAchievement };
/** Name/category/course candidates only locate possible collisions. Exact content
 * plus equal official facts permits a no-op; changing facts requires evidence. */
function resolveSource(incoming: ImportedCourseAchievement, saved: ImportedCourseAchievement[], incomingNameCount: number): SourceResolution {
  const candidates = saved.filter(row => normalizeImportName(row.rawName) === normalizeImportName(incoming.rawName));
  const exact = candidates.filter(row => sameSourceFingerprint(row, incoming));
  if (exact.length === 1 && sameSourceFacts(exact[0], incoming)) return { kind: 'duplicate', existing: exact[0] };
  if (candidates.length === 0) return { kind: 'new' };
  if (candidates.length === 1 && incomingNameCount === 1 && canRefreshSource(candidates[0], incoming)) return { kind: 'update', existing: candidates[0] };
  return { kind: 'held' };
}

/** Re-check against current state before either official writes or planner backfill.
 * Preview references/checkboxes are proposals, not identity evidence. A stale or
 * contradictory source group is rejected as a whole, including deselected units. */
export function revalidateImportIdentity(state: PlannerState, units: ImportPreviewUnit[]): ImportPreviewUnit[] {
  const groups = new Map<string, ImportPreviewUnit[]>();
  for (const unit of units) groups.set(unit.sourceCourse.id, [...(groups.get(unit.sourceCourse.id) ?? []), unit]);
  return holdIncompleteImportSelections([...groups.values()].flatMap<ImportPreviewUnit>(group => {
    const first = group[0];
    const count = [...groups.values()].filter(other => normalizeImportName(other[0].sourceCourse.rawName) === normalizeImportName(first.sourceCourse.rawName)).length;
    const resolved = resolveSource(first.sourceCourse, state.importedCourseAchievements, count);
    let reason: string | undefined;
    if (group.some(unit => unit.sourceIdentityConflict || unit.sourceYearConflict)) reason = 'preview-held';
    else if (new Set(group.map(unit => unit.id)).size !== group.length
      || group.some(unit => unit.sourceCourseId !== first.sourceCourse.id
      || normalizeImportName(unit.rawName) !== normalizeImportName(first.sourceCourse.rawName)
      || (['earnedCreditsTotal', 'schoolingCreditsTotal', 'compositionCredits', 'recognizedExemption', 'additionalEnrollment'] as const).some(key => unit[key] !== first.sourceCourse[key])
      || JSON.stringify(unit.sourceCourse) !== JSON.stringify(first.sourceCourse)
      || unit.sourceExistingId !== first.sourceExistingId
      || unit.sourceExistingSnapshot !== first.sourceExistingSnapshot)) reason = 'inconsistent-source-group';
    else if (resolved.kind === 'held') reason = 'unproven-source-identity';
    else if (resolved.kind !== 'new' && group.some(unit => !sourceComponentDatesAgree(unit))) reason = 'contradictory-component-date';
    else if (first.sourceExistingId !== null && first.sourceExistingId !== resolved.existing?.id) reason = 'invalid-source-reference';
    else if (resolved.kind === 'update' && (first.sourceExistingId !== resolved.existing!.id
      || first.sourceExistingSnapshot !== JSON.stringify(resolved.existing))) reason = 'stale-source-reference';
    else if (resolved.kind === 'new' && state.importedCourseAchievements.some(row => row.id === first.sourceCourse.id)) reason = 'source-id-collision';
    else if (resolved.kind === 'update' && hasComponentIdentityConflict(group, state.importedStudyRecords, resolved.existing!, first.sourceCourse, state.importedCourseAchievements)) reason = 'unproven-component-identity';
    else if (resolved.kind === 'update' && !hasCompleteComponentPreview(group, first.sourceCourse)) reason = 'incomplete-source-selection';
    if (reason) return group.map(unit => ({ ...unit, selected: false, sourceDuplicate: false, sourceIdentityConflict: true, sourceIdentityReason: reason }));
    const componentRefreshes = resolved.kind === 'update' ? currentComponentRefreshes(group, state.importedStudyRecords, resolved.existing!, first.sourceCourse) : null;
    return group.map(unit => ({ ...unit, sourceExistingId: resolved.existing?.id ?? null,
      duplicate: componentRefreshes?.get(unit.id)?.duplicate ?? unit.duplicate,
      sourceComponentUpdateRequired: componentRefreshes?.get(unit.id)?.updateRequired ?? false,
      sourceDuplicate: resolved.kind === 'duplicate', selected: resolved.kind === 'duplicate' ? false : unit.selected }));
  }));
}

/** Compare the native correspondence evidence, independently of other components
 * and aggregates. No legacy date is promoted to a learning date or rewritten. */
function sameUndatedComponent(old: ImportedStudyRecord, record: ImportedStudyRecord, source: ImportedCourseAchievement, existingSource?: ImportedCourseAchievement): boolean {
  if (!existingSource || old.sourceCourseId !== existingSource.id || record.method !== 'correspondence' || record.date !== null
    || old.fingerprint !== importFingerprint(old)
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
  const sourceYears = new Set(course.schoolings.flatMap(slot => [schoolingAcademicYear(slot.year), schoolingAcademicYear(slot.rawYear)]).filter(year => year !== null));
  const sourceYear = sourceYears.size === 1 ? [...sourceYears][0] : null;
  const inferred = sourceYears.size > 1 ? null : sourceYear ?? (schooling ? academicYearFromDate(schooling.date) : inferredCorrespondenceYear(course).academicYear);
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
    const resolution = resolveSource(sourceCourse, existingCourses,
      data.courses.filter(row => normalizeImportName(row.rawName) === normalizeImportName(course.rawName)).length);
    const existingCourse = resolution.existing;
    const sourceDuplicate = resolution.kind === 'duplicate';
    const sourceYearConflict = resolution.kind === 'held' && [sourceCourse, ...existingCourses.filter(row => normalizeImportName(row.rawName) === normalizeImportName(sourceCourse.rawName))]
      .some(row => sourceEvidence(row)?.[3].some(slot => schoolingAcademicYear(slot[0]) !== null));
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
    const components = rows.slice(firstUnit);
    const contradictoryDate = resolution.kind !== 'new' && components.some(unit => !sourceComponentDatesAgree(unit));
    const componentConflict = resolution.kind === 'update' && hasComponentIdentityConflict(components, existing, resolution.existing!, sourceCourse, existingCourses);
    const componentRefreshes = resolution.kind === 'update' && !componentConflict ? currentComponentRefreshes(components, existing, resolution.existing!, sourceCourse) : null;
    for (const unit of components) {
      if (resolution.existing) unit.sourceExistingSnapshot = JSON.stringify(resolution.existing);
      unit.duplicate = componentRefreshes?.get(unit.id)?.duplicate ?? unit.duplicate;
      unit.sourceComponentUpdateRequired = componentRefreshes?.get(unit.id)?.updateRequired ?? false;
    }
    if (sourceYearConflict || resolution.kind === 'held' || contradictoryDate || componentConflict) {
      for (const unit of components) {
        unit.sourceYearConflict = Boolean(sourceYearConflict); unit.sourceIdentityConflict = true;
        unit.sourceIdentityReason = contradictoryDate ? 'contradictory-component-date' : componentConflict ? 'unproven-component-identity' : 'unproven-source-identity';
        unit.sourceExistingId = null; unit.sourceDuplicate = false; unit.selected = false;
      }
    }
  }
  return rows;
}
/** Stage B retains the strict offering matcher. A course match never picks a representative opening. */
export function autoPlannerOfferingIdForImport(unit: ImportPreviewUnit, offerings: Offering[]): string | null {
  if (unit.sourceIdentityConflict || unit.sourceYearConflict || unit.academicYear === null) return null;
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
  // A held competing row must not disappear from attribution and turn another
  // same-name duplicate into an apparently one-to-one earned planner item.
  const heldNames = new Set(units.filter(unit => unit.sourceIdentityConflict || unit.sourceYearConflict).map(unit => normalizeImportName(unit.sourceCourse.rawName)));
  units = units.filter(unit => !heldNames.has(normalizeImportName(unit.sourceCourse.rawName)));
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

/** Slot is native fingerprint evidence, not an editable year/term or Offering. */
function componentSlot(record: ImportedStudyRecord): string | null {
  const base = importFingerprint(record);
  if (record.method === 'schooling') {
    const suffix = /:([01])$/.exec(record.fingerprint);
    return suffix && record.fingerprint === `${base}:${suffix[1]}` ? `schooling:${suffix[1]}` : null;
  }
  return record.fingerprint === base ? 'correspondence' : null;
}

/** Verify a component against its own retained native parent snapshot. Editable
 * academicYear/yearSource/term/Offering never supply a component identity. */
function componentIdentity(record: ImportedStudyRecord, source: ImportedCourseAchievement): string | null {
  const slot = componentSlot(record); const evidence = sourceEvidence(source);
  if (!slot || !evidence || record.sourceCourseId !== source.id
    || normalizeImportName(record.rawName) !== normalizeImportName(source.rawName)) return null;
  const schooling = record.method === 'schooling' ? evidence[3][Number(slot.at(-1))] : null;
  const date = nativeDate(schooling ? schooling[2] : evidence[5][0]);
  const credits = nativeCredits(schooling ? schooling[3] : evidence[5][1]);
  if (date === null || credits === null || record.date !== date || record.credits !== credits
    || (schooling ? record.rawYear !== (schooling[0] || null) || record.rawTerm !== (schooling[1] || null)
      : record.rawYear !== null || record.rawTerm !== null || importedExamDate(record, source) !== date)) return null;
  return JSON.stringify([source.id, normalizeImportName(source.rawName), slot, date, credits, schooling?.[0] ?? null, schooling?.[1] ?? null]);
}

function nativeGrade(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const grade = raw.trim();
  return ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'].includes(grade) ? grade : null;
}

/** Only native payloads can be added to a proven parent. The bounded explicit
 * year extension may retain another undated slot snapshot as source history. */
function isNativeComponentSnapshot(record: ImportedStudyRecord, source: ImportedCourseAchievement): boolean {
  const slot = componentSlot(record); const evidence = sourceEvidence(source);
  if (!slot || !evidence || record.sourceCourseId !== source.id
    || normalizeImportName(record.rawName) !== normalizeImportName(source.rawName)) return false;
  if (record.method === 'correspondence') {
    return sourceComponentDatesAgree({ ...record, examDate: importedExamDate(record, source), sourceCourse: source })
      && record.rawYear === null && record.rawTerm === null
      && record.credits === nativeCredits(evidence[5][1]) && record.grade === nativeGrade(evidence[5][2])
      && record.examGrade === nativeGrade(evidence[5][2]);
  }
  const raw = evidence[3][Number(slot.at(-1))];
  return record.rawYear === (raw[0] || null) && record.rawTerm === (raw[1] || null)
    && record.date === nativeDate(raw[2]) && record.credits === nativeCredits(raw[3])
    && record.grade === nativeGrade(raw[4]);
}

type ComponentResolution = { kind: 'duplicate' | 'update' | 'append' | 'held'; existing?: ImportedStudyRecord };
function resolveComponentRecord(record: ImportedStudyRecord, existing: ImportedStudyRecord[], allIncoming: ImportedStudyRecord[], previous: ImportedCourseAchievement, next: ImportedCourseAchievement): ComponentResolution {
  if (!isNativeComponentSnapshot(record, next)) return { kind: 'held' };
  const key = componentIdentity(record, next);
  const linked = existing.filter(old => old.sourceCourseId === previous.id);
  const matches = key === null ? [] : linked.filter(old => componentIdentity(old, previous) === key);
  const incomingMatches = key === null ? [] : allIncoming.filter(other => componentIdentity(other, next) === key);
  if (matches.length > 1 || incomingMatches.length > 1) return { kind: 'held' };
  const duplicates = linked.filter(old => old.fingerprint === record.fingerprint || sameUndatedComponent(old, record, next, previous));
  if (duplicates.length > 1) return { kind: 'held' };
  if (duplicates.length === 1) return isNativeComponentSnapshot(duplicates[0], previous)
    || sameUndatedComponent(duplicates[0], record, next, previous)
    || isSourceYearExtension(previous, next) && isNativeComponentSnapshot(duplicates[0], next)
    ? { kind: 'duplicate', existing: duplicates[0] } : { kind: 'held' };
  if (matches.length === 1 && incomingMatches.length === 1) return isNativeComponentSnapshot(matches[0], previous)
    ? { kind: 'update', existing: matches[0] } : { kind: 'held' };
  const slot = componentSlot(record);
  const sameSlot = linked.filter(old => old.method === record.method && (componentSlot(old) === slot || componentSlot(old) === null));
  if (!slot || sameSlot.length > 0) {
    // Preserve the bounded additive-year compatibility path, with both native
    // snapshots checked. No editable attribute can authorize this append.
    if (sameSlot.length === 1 && isSourceYearExtension(previous, next)
      && sameSlot[0].method === 'schooling' && record.method === 'schooling'
      && isNativeComponentSnapshot(sameSlot[0], previous)) return { kind: 'append', existing: sameSlot[0] };
    return { kind: 'held' };
  }
  return { kind: 'append' }; // a genuinely absent method/slot on a proven parent
}

function hasComponentIdentityConflict(units: ImportPreviewUnit[], existing: ImportedStudyRecord[], previous: ImportedCourseAchievement, incoming: ImportedCourseAchievement, sources: ImportedCourseAchievement[]): boolean {
  const next = { ...incoming, id: previous.id };
  const records = units.filter(unit => !unit.courseOnly).map(unit => ({ ...unit, sourceCourseId: previous.id }));
  return records.some(record => existing.some(old => normalizeImportName(old.rawName) === normalizeImportName(record.rawName)
    && old.method === record.method && (!old.sourceCourseId || !sources.some(source => source.id === old.sourceCourseId)))
    || resolveComponentRecord(record, existing, records, previous, next).kind === 'held');
}

/** Duplicate/required-refresh flags are preview hints; recompute from current owned
 * records so a stale/forged flag cannot suppress a proven component refresh. */
function currentComponentRefreshes(units: ImportPreviewUnit[], existing: ImportedStudyRecord[], previous: ImportedCourseAchievement, incoming: ImportedCourseAchievement): Map<string, { duplicate: boolean; updateRequired: boolean }> {
  const next = { ...incoming, id: previous.id };
  const records = units.filter(unit => !unit.courseOnly).map(unit => ({ ...unit, sourceCourseId: previous.id }));
  return new Map(records.map(record => {
    const resolution = resolveComponentRecord(record, existing, records, previous, next);
    return [record.id, { duplicate: resolution.kind === 'duplicate',
      updateRequired: resolution.kind === 'update' || resolution.kind === 'append' && resolution.existing !== undefined }];
  }));
}

/** A caller may deselect detail records, but may not omit them from the evidence
 * reviewed for an existing source refresh. Native source slots define coverage. */
function hasCompleteComponentPreview(units: ImportPreviewUnit[], source: ImportedCourseAchievement): boolean {
  const evidence = sourceEvidence(source);
  if (!evidence) return false;
  const expected: string[] = [];
  if (evidence[4].some(report => report[0] !== '' || report[1] !== 'none' || report[2] !== null)
    || evidence[5].some(field => field !== '' && field !== false)) expected.push('correspondence');
  evidence[3].forEach((slot, index) => { if (slot.some(field => field !== '')) expected.push(`schooling:${index}`); });
  const actual = units.filter(unit => !unit.courseOnly).map(componentSlot);
  return actual.length === expected.length && expected.every(slot => actual.filter(value => value === slot).length === 1)
    && (expected.length > 0 || units.length === 1 && units[0].courseOnly === true);
}

/** Selection is not identity evidence. A parent refresh must retain each owned
 * component's native snapshot agreement. Leave unchecked records untouched and
 * hold the whole source if a required refresh was unchecked. apply recomputes the
 * required flags from current state; UI uses the same projection for guidance. */
export function holdIncompleteImportSelections(units: ImportPreviewUnit[]): ImportPreviewUnit[] {
  const held = new Set(units.filter(unit => unit.sourceExistingId !== null && !unit.sourceDuplicate
    && !unit.sourceIdentityConflict && !unit.sourceYearConflict
    && unit.sourceComponentUpdateRequired && !unit.selected).map(unit => unit.sourceCourse.id));
  return units.map(unit => held.has(unit.sourceCourse.id)
    ? { ...unit, selected: false, sourceDuplicate: false, sourceIdentityConflict: true, sourceIdentityReason: 'incomplete-source-selection' }
    : unit);
}

function reconcileStudyRecords(existing: ImportedStudyRecord[], additions: ImportedStudyRecord[], allIncoming: ImportedStudyRecord[], previousSources: ImportedCourseAchievement[], nextSources: ImportedCourseAchievement[]): ImportedStudyRecord[] {
  const updates = new Map<string, ImportedStudyRecord>(); const appended: ImportedStudyRecord[] = [];
  for (const record of additions) {
    const previous = previousSources.find(source => source.id === record.sourceCourseId);
    const next = nextSources.find(source => source.id === record.sourceCourseId);
    const resolution = previous && next ? resolveComponentRecord(record, existing, allIncoming, previous, next) : { kind: 'append' as const };
    if (resolution.kind === 'update' && resolution.existing) {
      const old = resolution.existing;
      // Keep learner-managed association/year context; source content is refreshed.
      updates.set(old.id, { ...record, id: old.id, offeringId: old.offeringId, match: old.match, academicYear: old.academicYear, yearSource: old.yearSource, term: old.term });
    } else if (resolution.kind === 'append') appended.push(record);
  }
  return [...existing.map(old => updates.get(old.id) ?? old), ...appended];
}

export function applyImport(state: PlannerState, units: ImportPreviewUnit[], offerings: Offering[]): PlannerState {
  units = revalidateImportIdentity(state, units);
  const selected = units.filter(unit => unit.selected && !unit.sourceDuplicate && !unit.sourceYearConflict && !unit.sourceIdentityConflict);
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
  const rows = state.importedCourseAchievements.map(existing => { const update = sourceUpdates.get(existing.id); if (!update) return existing; const confirmYear = canConfirmSourceYear(existing, update); return { ...existing, ...update, id: existing.id, academicYear: confirmYear ? update.academicYear : existing.academicYear, yearSource: confirmYear ? update.yearSource : existing.yearSource, ...(existing.selectionSource === 'manual' ? { courseId: existing.courseId, match: existing.match, curriculumCourseId: existing.curriculumCourseId, curriculumMatch: existing.curriculumMatch, candidateCurriculumCourseIds: existing.candidateCurriculumCourseIds, offeringMatch: existing.offeringMatch, candidateOfferingIds: existing.candidateOfferingIds } : {}), selectedOfferingId: existing.selectionSource === 'manual' ? existing.selectedOfferingId : update.selectedOfferingId, selectionSource: existing.selectionSource === 'manual' ? 'manual' : update.selectionSource }; });
  const allIncoming = units.filter(unit => !unit.courseOnly).map(unit => ({ ...unit, sourceCourseId: unit.sourceExistingId ?? unit.sourceCourse.id }));
  // Reconciliation uses the verified incoming native snapshot. Persisted parent
  // years may be manual/inferred and cannot replace the source-year evidence.
  const nextEvidence = [...rows.map(row => sourceUpdates.has(row.id) ? { ...sourceUpdates.get(row.id)!, id: row.id } : row), ...sourceAdditions];
  return { ...state, items: [...state.items, ...plannerAdditions], importedStudyRecords: reconcileStudyRecords(state.importedStudyRecords, additions, allIncoming, state.importedCourseAchievements, nextEvidence), importedCourseAchievements: [...rows, ...sourceAdditions] };
}

export function importedEarnedCreditsTotal(rows: ImportedCourseAchievement[]): number { return rows.reduce((sum, row) => sum + (row.earnedCreditsTotal && row.earnedCreditsTotal > 0 ? row.earnedCreditsTotal : 0), 0); }

export function groupImportedAchievements(records: ImportedStudyRecord[]) {
  const groups = new Map<number | null, ImportedStudyRecord[]>();
  [...records].sort((a, b) => (b.academicYear ?? -Infinity) - (a.academicYear ?? -Infinity) || a.rawName.localeCompare(b.rawName, 'ja') || a.method.localeCompare(b.method) || (a.date ?? '').localeCompare(b.date ?? '')).forEach(record => {
    const group = groups.get(record.academicYear) ?? []; group.push(record); groups.set(record.academicYear, group);
  });
  return [...groups.entries()].sort(([a], [b]) => (b ?? -Infinity) - (a ?? -Infinity));
}
