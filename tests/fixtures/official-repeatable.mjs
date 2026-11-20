import { catalog } from '../../src/planner/catalog/catalog.ts';
import { importPreview, applyImport } from '../../src/planner/gradeImport/gradeImportApply.ts';
import { initialState } from '../../src/planner/backup/storage.ts';
export const repeatProfile = { ...initialState().graduationProfile, admissionYear: 2018, admissionType: 'first_year', curriculumApplicability: 'current_2026' };
export const numeric = value => ({ raw: value === null ? '' : String(value), value });
export const emptySlot = () => ({ rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null });
export const slot = (year, date = `${year}-08-01`) => ({ rawYear: String(year), year: String(year), rawTerm: '夏', term: '夏', rawDate: date?.replaceAll('-', '/') ?? '', date, rawCredits: '2', credits: 2, rawGrade: 'A', grade: 'A' });
export const nativeRow = (name, years) => ({
  rawName: name, categoryRaw: '専門教育', compositionCredits: numeric(2), earnedCredits: numeric(years.length * 2), schoolingCredits: numeric(years.length * 2),
  recognizedExemption: numeric(null), additionalEnrollment: numeric(null),
  reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
  creditExam: { rawDate: '', date: null, rawCredits: '', credits: null, rawGrade: '', grade: null, pendingMarker: false },
  schoolings: [years[0] === undefined ? emptySlot() : slot(years[0]), years[1] === undefined ? emptySlot() : slot(years[1])],
});
export const payload = courses => ({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-13T00:00:00.000Z', courses });
export const repeatedPayload = (name, count) => payload(Array.from({ length: count }, (_, n) => nativeRow(name, [2018 + n])));
export function importRepeated(data, state = initialState()) {
  return applyImport(state, importPreview(data, catalog.offerings, state.importedStudyRecords, state.importedCourseAchievements), catalog.offerings);
}

export function auditConflictPayload(kind, name = '政治学') {
  const data = payload([nativeRow(name, [2025])]), row = data.courses[0];
  if (kind === 'R1 S null') { row.earnedCredits = numeric(0); row.schoolingCredits = numeric(null); }
  if (kind === 'R1 composition null') { row.earnedCredits = numeric(0); row.schoolingCredits = numeric(0); row.compositionCredits = numeric(null); }
  if (kind === 'R2 year absent') { row.schoolingCredits = numeric(0); row.schoolings[0].year = null; row.schoolings[0].rawYear = ''; }
  return data;
}

export function nonzeroAggregateBoundaryPayload(caseId, name = '政治学') {
  const aggregates = { A: [2, 1], B: [1, 1], C: [2, 2], D: [2, null], E: [0, 0] };
  const [earned, schooling] = aggregates[caseId];
  const data = payload([nativeRow(name, [2025])]), row = data.courses[0];
  row.earnedCredits = numeric(earned); row.schoolingCredits = numeric(schooling);
  row.schoolings[0].rawYear = ''; row.schoolings[0].year = null;
  if (caseId === 'E') { row.schoolings[0].rawGrade = 'D'; row.schoolings[0].grade = 'D'; }
  return data;
}

export function sameIdNativeLegacyConflict(earned = 0, reverse = false) {
  const data = payload([nativeRow('政治学', [2025])]);
  data.courses[0].earnedCredits = numeric(earned); data.courses[0].schoolingCredits = numeric(earned);
  const state = importRepeated(data), native = state.importedCourseAchievements[0];
  const legacy = { ...structuredClone(native), fingerprint: 'legacy-f1-audit-copy' };
  state.importedCourseAchievements = reverse ? [legacy, native] : [native, legacy];
  return state;
}
export function completeRowMismatchPayload(includeA = true, includeB = true) {
  const a = nativeRow('政治学', [2024]); a.schoolings[0].rawYear = ''; a.schoolings[0].year = null;
  const b = nativeRow('政治学', [2025]); b.earnedCredits = numeric(4); b.schoolingCredits = numeric(4);
  return payload([...(includeA ? [a] : []), ...(includeB ? [b] : [])]);
}
