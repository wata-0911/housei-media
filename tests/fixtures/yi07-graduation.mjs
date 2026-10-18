import { catalog } from '../../src/planner/catalog/catalog.ts';
import { initialState } from '../../src/planner/backup/storage.ts';
import { calculateGraduationProgress } from '../../src/planner/graduation/graduationProgress.ts';
import { thesisProgressForScope, setThesisProgressForScope } from '../../src/planner/graduation/thesisSelection.ts';
import { scenarios, officialRow, plannerItem } from './unresolved-condition-scenarios.mjs';
import { detail } from './migration-fixture.mjs';
import { makeAttempt } from '../../src/planner/attempts/workbench/catalogView.ts';
import { newAttemptIds } from '../../src/planner/attempts/workbench/operations.ts';
import { deriveCurriculumCourseProgress } from '../../src/planner/progress/curriculumCourseProgress.ts';

export const programs = catalog.programs.filter(p => !p.isCommon);
// Baseline serialization preserves present-undefined keys as well as omission.
// No numeric rounding, sorting, whitelisting or tolerated output differences.
export function snapshotValue(value) {
  if (value === undefined) return { $yi07Type: 'undefined' };
  if (typeof value === 'number' && !Number.isFinite(value)) return { $yi07Type: String(value) };
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,snapshotValue(v)]));
  return value;
}
export function retained(state) {
  const { items, todos, mediaSchoolingProgress, correspondenceProgress, courseEvaluations, ...rest } = state;
  void items; void todos; void mediaSchoolingProgress; void correspondenceProgress; void courseEvaluations;
  return structuredClone(rest);
}
export function calculateState(state, scopeId, sourceCatalog = catalog) {
  return calculateGraduationProgress(state.items, sourceCatalog, scopeId, state.publicCourses, state.thesisSelection,
    state.importedStudyRecords, state.importedCourseAchievements, state.graduationProfile,
    thesisProgressForScope(state, sourceCatalog, scopeId), state.correspondenceProgress);
}
export function calculateCompletion(state, scopeId, sourceCatalog = catalog) {
  return deriveCurriculumCourseProgress(state.items, sourceCatalog, state.importedCourseAchievements, scopeId,
    state.importedStudyRecords, state.correspondenceProgress, state.graduationProfile);
}
export function legacyCases() {
  const original = scenarios().filter(s => !s.name.endsWith('/I-credits')).map(s => ({ name: s.name, scopeId: s.scopeId,
    state: { ...initialState(), items: s.items, importedCourseAchievements: s.rows, importedStudyRecords: s.records,
      graduationProfile: s.profile, thesisSelection: s.selection } }));
  const common = new Set(catalog.programs.filter(p => p.isCommon).map(p => p.scopeId));
  const commonCourse = catalog.curriculum.courses.find(c => c.curriculumCredits === 4 && c.mappingIds.some(id =>
    catalog.mappings.some(m => m.mappingId === id && common.has(m.scopeId) && m.category === '一般教育')));
  return [...original, ...programs.flatMap(p => ['earned', 'in_progress', 'planned', 'mixed'].map(mode => {
    let state = initialState();
    state.graduationProfile.admissionType = 'first_year';
    state.graduationProfile.admissionYear = 2026;
    state.graduationProfile.curriculumApplicability = 'current_2026';
    const relevant = catalog.offerings.filter(o => o.mappingIds.some(id => catalog.mappings.some(m => m.mappingId === id
      && (m.scopeId === p.scopeId || common.has(m.scopeId)))));
    state.items = relevant.map((o, i) => ({ ...plannerItem(o, mode === 'mixed' ? ['earned', 'in_progress', 'planned', 'waiting'][i % 4] : mode),
      ...(i % 3 === 0 && o.credits !== null ? { courseCreditContribution: Math.min(2, o.credits) } : {}),
      earnedOrder: null }));
    let order = 0;
    for (const item of state.items) if (item.status === 'earned' && catalog.offerings.find(o => o.id === item.offeringId).name.startsWith('史学演習（')) item.earnedOrder = ++order;
    const row = officialRow(commonCourse);
    state.importedCourseAchievements = [row];
    state.importedStudyRecords = [detail({ id: 'yi07-detail-B', fingerprint: 'yi07-detail-B', rawName: row.rawName, sourceCourseId: row.id, credits: 17 }),
      detail({ id: 'yi07-detail-A', fingerprint: 'yi07-detail-A', rawName: row.rawName, sourceCourseId: row.id, credits: 2, schoolingCreditsTotal: 0 })];
    state.importedCourseUserMeta[row.id] = { lifecycleStatus: 'waiting', plannedYear: 2035, plannedTerm: '本人予定', studyYear: null };
    state.publicCourses = [{ id: '00000000-0000-4000-8000-000000099707', title: '合成公開科目', status: 'earned',
      credits: 2, plannedYear: 2035, plannedTerm: null, studyYear: null, finalGrade: null }];
    state = setThesisProgressForScope(state, catalog, p.scopeId, { selection: 'selected', status: mode === 'earned' ? 'earned' : 'in_progress' });
    return { name: `${p.displayName}/dense-${mode}`, scopeId: p.scopeId, state };
  }))];
}
export function newAttempt(master, placement = null, contribution = 2, status = 'earned', method = 'schooling') {
  const a = makeAttempt(master, { title: placement?.officialName ?? '同名の独立履修回', courseId: placement?.institutionalCourseId ?? null,
    placementId: placement?.id ?? null, method, note: '本人記録（算入根拠ではない）',
    plan: { plannedYear: 2035, plannedTerm: '希望期', studyYear: null, status, earnedOrder: null,
      ...(contribution === undefined ? {} : { contribution: { value: contribution, source: 'learner', note: null } }) } }, newAttemptIds());
  return a;
}
export function confirmPlacement(a, p) {
  a.placement = { status: 'confirmed', ref: { placementId: p.id, curriculumVersionId: p.curriculumVersionId,
    scopeId: p.scopeId, sourceRevisionId: p.sourceRevisionId, evidenceIds: [p.officialRow.evidenceId] },
    candidateAuditIds: [], candidatePlacementIds: [], reason: null };
  a.applicability = { status: 'unverified', curriculumVersionId: p.curriculumVersionId, scopeId: p.scopeId,
    legacyApplicability: 'current_2026', originalValue: 'current_2026', evidence: null };
  return a;
}
export { catalog, initialState, officialRow };
