import { catalog } from '../../src/planner/catalog.ts';
import { importPreview, applyImport } from '../../src/planner/gradeImportApply.ts';
import { initialState } from '../../src/planner/storage.ts';
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
