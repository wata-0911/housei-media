import { readFileSync } from 'node:fs';
import { catalog } from '../../src/planner/catalog/catalog.ts';
import { initialState } from '../../src/planner/backup/storage.ts';
import { loadYi01InstitutionalCatalog } from '../../src/planner/institutional/yi01.ts';
import { isMediaSchooling } from '../../src/planner/progress/mediaSchooling.ts';
import { plannerItemFromCourseSearch } from '../../src/planner/planning/plannerItemState.ts';
import { prepareMigrationEnvironment, decodeMigrationSource } from '../../src/planner/attempts/migration/source.ts';
import { prepareMigrationIds } from '../../src/planner/attempts/migration/assignments.ts';
import { previewMigration } from '../../src/planner/attempts/migration/preview.ts';
import { createBackupCatalogSnapshot } from '../../src/planner/backup/plannerBackupCompatibility.ts';

export const master = loadYi01InstitutionalCatalog();
export const files = Object.fromEntries(Object.keys(master.legacyDigests).map(path => [path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')]));
export const env = await prepareMigrationEnvironment(files);
export const snapshot = await createBackupCatalogSnapshot(catalog);
export const media = catalog.offerings.find(isMediaSchooling);
export const correspondence = catalog.offerings.find(o => o.method === 'correspondence' && o.credits === 4 && !/史学演習|史料学/.test(o.name));
export const schooling = catalog.offerings.find(o => o.method === 'schooling' && !isMediaSchooling(o));
export const item = offering => plannerItemFromCourseSearch(offering.id);
export const originalRow = (overrides = {}) => ({ id: 'official-A', fingerprint: 'literal-original-fingerprint', source: 'hosei_import', rawName: '未照合の原名称', categoryRaw: '原区分',
  capturedAt: '2026-10-10T00:00:00.000Z', earnedCreditsTotal: 2, schoolingCreditsTotal: null, compositionCredits: 4, recognizedExemption: 0, additionalEnrollment: null,
  academicYear: null, yearSource: 'unknown', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched', candidateOfferingIds: [], ...overrides });
export const detail = (overrides = {}) => ({ id: 'detail-A', fingerprint: 'literal-detail-fingerprint', source: 'hosei_import', rawName: '未照合の原名称', offeringId: null, match: 'unmatched', method: 'correspondence',
  academicYear: 2025, yearSource: 'manual', rawYear: '25', term: null, rawTerm: '元期', date: null, credits: 17, grade: '原評価', ...overrides });
export function mixed() {
  const state = initialState();
  state.items = [item(media), { ...item(correspondence), status: 'earned', courseCreditContribution: 2, importedSourceCourseId: 'official-A' }, item(schooling)];
  state.mediaSchoolingProgress[media.id] = { offeringId: media.id, totalLessons: null, lessons: [{ lesson: 2, videoCompleted: false, testCompleted: true }, { lesson: 1, videoCompleted: true, testCompleted: false }],
    assessments: [{ id: 'assessment/raw~id', type: 'other', label: '原試験', scheduledDate: '2027-02-28', completed: false }] };
  state.correspondenceProgress[correspondence.id] = { offeringId: correspondence.id, requiredReports: null, reports: [{ reportNumber: 2, status: 'passed', grade: 'A' }, { reportNumber: 1, status: 'submitted', grade: null }], examGrade: 'D' };
  state.courseEvaluations[media.id] = { offeringId: media.id, finalGrade: null, reportGrade: 'A', schoolingGrade: 'S' };
  state.todos = [{ id: '00000000-0000-4000-8000-000000000101', offeringId: media.id, text: '元TODO B', done: false }, { id: '00000000-0000-4000-8000-000000000102', offeringId: null, text: '元TODO A', done: true }];
  state.importedCourseAchievements = [originalRow()];
  state.importedStudyRecords = [detail({ sourceCourseId: 'official-A', earnedCreditsTotal: null, schoolingCreditsTotal: 0, compositionCredits: 4, recognizedExemption: null, additionalEnrollment: 0,
    reports: [{ raw: '元report', status: 'unknown', date: null }], examDate: null, examGrade: '原試験評価', capturedAt: 'original capture' })];
  state.importedCourseUserMeta['official-A'] = { lifecycleStatus: 'waiting', plannedYear: 2028, plannedTerm: '手動期', studyYear: 3 };
  state.publicCourses = [{ id: '00000000-0000-4000-8000-000000000104', title: '公開科目', status: 'earned', plannedYear: 2026, plannedTerm: null, studyYear: null, finalGrade: null, credits: 2 }];
  return state;
}
export async function decode(state, kind = 'local', environment = env, original = catalog) {
  const raw = kind === 'local' ? JSON.stringify(state, null, 2) : JSON.stringify({ format: 'hosei-planner-backup', backupVersion: kind === 'v1' ? 1 : 2,
    createdAt: '2026-10-15T00:00:00.000Z', catalog: kind === 'v1' ? Object.fromEntries(Object.entries(snapshot).filter(([key]) => ['schemaVersion', 'academicYear', 'snapshot', 'sha256'].includes(key))) : snapshot, state });
  return decodeMigrationSource(raw, environment, kind === 'local' ? original : undefined);
}
export async function preview(state = mixed(), kind = 'local') {
  const decoded = await decode(state, kind);
  if (decoded.status !== 'decoded') throw new Error(JSON.stringify(decoded.diagnostics));
  const source = decoded.source, table = prepareMigrationIds(source), result = previewMigration(source, table);
  return { source, table, result };
}
export { catalog, initialState };
