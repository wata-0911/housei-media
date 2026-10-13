import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCurriculumCourseProgress } from '../src/planner/progress/curriculumCourseProgress.ts';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { course, corr, schools, programs, item, profile, batch, result } from './fixtures/calligraphy-progress.mjs';
for (const program of programs) {
  for (const [label, items, saved, earned, complete, credits] of [
    ['S1', [item(schools[0])], {}, 1, 'incomplete', 0],
    ['S1+S1', schools.slice(0, 2).map(o => item(o)), {}, 2, 'complete', 2],
    ['batch only', [item(corr)], batch('passed'), 0, 'incomplete', 0],
    ['batch grading+S1', [item(corr), item(schools[0])], batch('grading'), 1, 'incomplete', 0],
    ['batch passed+S1', [item(corr, 'in_progress'), item(schools[0])], batch('passed'), 2, 'complete', 2],
    ['batch passed+unearned S1', [item(corr), item(schools[0], 'planned')], batch('passed'), 0, 'incomplete', 0],
    ['legacy T2+S1', [item(corr), item(schools[0])], {}, 1, 'incomplete', 0],
    ['legacy T2 only', [item(corr)], {}, 0, 'incomplete', 0],
  ]) test(`calligraphy ${program.course}: ${label}`, () => {
    const { progress, graduation, credits: actual } = result(items, saved, [], program.scopeId);
    assert.equal(progress.earnedCredits, earned);
    assert.equal(progress.completion, complete);
    assert.equal(progress.earnedExcessCredits, 0);
    assert.equal(actual, credits);
    assert.equal(graduation.graduationCheckComplete, false);
  });
}

import { official } from './fixtures/calligraphy-progress.mjs';
import { stateForScopeChange } from '../src/planner/graduation/thesisSelection.ts';
import { initialState, saveState, loadState, STORAGE_KEY } from '../src/planner/backup/storage.ts';
import { validateState } from '../src/planner/validation.ts';
import { createPlannerBackup, parsePlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { deriveCurriculumCourseView } from '../src/planner/progress/curriculumCourseView.ts';
import { correspondenceCreditResult, progressForCorrespondence } from '../src/planner/progress/correspondenceProgress.ts';
import { plannerExportPresentation } from '../src/planner/exports/plannerExport.ts';
import { CorrespondenceDetails } from '../src/components/planner/progress/CorrespondenceProgress.tsx';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

for (const program of programs) for (const s of [1, 2]) for (const status of ['earned', 'planned', 'in_progress', 'waiting']) test(`calligraphy official2/S${s} ${program.course} excludes manual ${status}`, () => {
  const items = [item(corr, status), ...schools.slice(0, 2).map(o => item(o, status))];
  const x = result(items, batch('passed'), [official({ schoolingCreditsTotal: s })], program.scopeId);
  assert.equal(x.progress.earnedCredits, 2); assert.equal(x.progress.projectedCredits, 2);
  assert.equal(x.progress.completion, 'complete'); assert.equal(x.progress.completionEvidence, 'official');
  assert.equal(x.credits, 2); assert.equal(x.graduation.importedContributionCount, 1);
  assert.equal(x.graduation.referenceProgress.find(r => r.id === 'schooling-reference-progress').earned, s);
});
for (const patch of [
  { earnedCreditsTotal: null }, { earnedCreditsTotal: 0 }, { earnedCreditsTotal: 1 },
  { schoolingCreditsTotal: 0 }, { schoolingCreditsTotal: null }, { schoolingCreditsTotal: 3 },
  { compositionCredits: null }, { recognizedExemption: 1 }, { additionalEnrollment: 1 },
]) test(`calligraphy official held ${JSON.stringify(patch)} cannot be supplemented by batch`, () => {
  const row = official(patch); const before = structuredClone(row);
  const x = result([item(corr), ...schools.slice(0, 2).map(o => item(o))], batch('passed'), [row]);
  assert.notEqual(x.progress.completion, 'complete'); assert.equal(x.credits, 0);
  assert.equal(x.progress.earnedCredits, row.earnedCreditsTotal ?? 0);
  assert.deepEqual(row, before);
});
test('calligraphy unresolved source-link stays unresolved and cannot complete from manual batch', () => {
  const row = official({ curriculumCourseId: null, curriculumMatch: 'ambiguous', candidateCurriculumCourseIds: [course.id] });
  const linked = { ...item(corr), importedSourceCourseId: row.id };
  const x = result([linked, item(schools[0])], batch('passed'), [row]);
  assert.equal(x.progress.completion, 'unknown'); assert.equal(x.progress.earnedCredits, 0); assert.equal(x.credits, 0);
  assert.equal(deriveCurriculumCourseProgress([linked], catalog, [row], programs[0].scopeId, [], batch('passed'), profile).unassigned.length, 1);
});
test('calligraphy conflicting official snapshots are never summed', () => {
  const x = result([item(corr), item(schools[0])], batch('passed'), [official(), official({ id: 'other', fingerprint: 'other' })]);
  assert.equal(x.progress.completion, 'unknown'); assert.equal(x.progress.earnedCredits, 0); assert.equal(x.credits, 0);
});
for (const curriculumApplicability of ['unknown', 'legacy_or_transition']) test(`calligraphy ${curriculumApplicability} has no current completion`, () => {
  const x = result([item(corr), item(schools[0])], batch('passed'), [], programs[0].scopeId, { curriculumApplicability });
  assert.equal(x.progress.completion, 'unknown'); assert.equal(x.credits, 0);
});
test('calligraphy revocation and dropping batch remove learner completion immediately', () => {
  const items = [item(corr), item(schools[0])];
  assert.equal(result(items, batch('passed')).progress.completionEvidence, 'learner');
  assert.equal(result(items, batch('grading')).credits, 0);
  assert.equal(result([item(corr, 'dropped'), item(schools[0])], batch('passed')).credits, 0);
  assert.equal(result([item(corr), item(schools[0], 'in_progress')], batch('passed')).credits, 0);
});
test('calligraphy old reports/exam/earned never infer batch passed or mutate source', () => {
  const saved = { [corr.id]: { offeringId: corr.id, requiredReports: 10, reports: Array.from({ length: 10 }, (_, i) => ({ reportNumber: i + 1, status: 'passed', grade: 'A' })), examGrade: 'A' } };
  const before = structuredClone(saved);
  const x = result([item(corr), item(schools[0])], saved);
  assert.equal(x.progress.completion, 'incomplete'); assert.equal(x.credits, 0); assert.deepEqual(saved, before);
  assert.match(x.progress.warnings.join(), /自動変換/);
});
for (const status of [undefined, 'not_submitted', 'grading', 'passed']) test(`calligraphy schema22 save/reload/backup preserves ${status ?? 'old-v22'} and source owners`, async () => {
  const state = { ...stateForScopeChange(initialState(), catalog, programs[0].scopeId), graduationProfile: profile,
    items: [{ ...item(corr), plannedYear: 2025, courseCreditContribution: 2 }, item(schools[0])],
    correspondenceProgress: { [corr.id]: { ...progressForCorrespondence(corr, {}), requiredReports: 2,
      reports: [{ reportNumber: 1, status: 'passed', grade: 'A' }], examGrade: 'B', ...(status === undefined ? {} : { calligraphyBatchStatus: status }) } },
    importedCourseAchievements: [official()], importedStudyRecords: [{ id: 'detail', fingerprint: 'detail', source: 'hosei_import', sourceCourseId: 'official-calligraphy', rawName: '書道実技', offeringId: corr.id, match: 'exact_unique', method: 'correspondence', academicYear: 2025, yearSource: 'source', rawYear: '25', term: null, rawTerm: '通', date: null, credits: null, grade: null, reports: [], examGrade: null, capturedAt: '2026-10-13T00:00:00Z' }],
    importedCourseUserMeta: { 'official-calligraphy': { lifecycleStatus: null, plannedYear: 2025, plannedTerm: null, studyYear: 3 } },
    courseEvaluations: { [corr.id]: { offeringId: corr.id, finalGrade: 'A', reportGrade: 'B', schoolingGrade: null } } };
  const before = structuredClone(state); const memory = new Map(); const store = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  assert.equal(validateState(state, catalog), true);
  const raw = saveState(store, state, null, catalog); const loaded = loadState(store, catalog);
  assert.equal(loaded.error, null); assert.deepEqual(loaded.state, state); assert.equal(loaded.state.schemaVersion, 22);
  const backup = await createPlannerBackup(raw, catalog); const parsed = await parsePlannerBackup(JSON.stringify(backup), catalog);
  assert.deepEqual(parsed.state, before); assert.deepEqual(state, before); assert.equal(store.getItem(STORAGE_KEY), raw);
  assert.equal(deriveCurriculumCourseView(loaded.state, catalog).courses[0].completionEvidence, 'official');
});
test('calligraphy rejects field on normal4 and invalid batch enums without broadening report schema', () => {
  const ordinary = catalog.offerings.find(o => o.method === 'correspondence' && o.credits === 4);
  const state = initialState(); state.correspondenceProgress[ordinary.id] = { ...progressForCorrespondence(ordinary, {}), calligraphyBatchStatus: 'passed' };
  assert.equal(validateState(state, catalog), false);
  state.correspondenceProgress = batch('submitted'); assert.equal(validateState(state, catalog), false);
});
test('calligraphy UI/export retain original records while describing batch as progress, never T credit', () => {
  const saved = { ...batch('passed')[corr.id], requiredReports: 1, reports: [{ reportNumber: 1, status: 'passed', grade: 'A' }], examGrade: 'S' };
  const html = renderToStaticMarkup(createElement(CorrespondenceDetails, { item: item(corr), offering: corr, saved, disabled: false, onChange: () => {} }));
  assert.match(html, /添削10課題一括/); assert.match(html, /正式な1単位/); assert.match(html, /リポート 1/);
  assert.doesNotMatch(html, /単位修得条件達成|単位修得試験<select/);
  assert.equal(correspondenceCreditResult(saved).creditEarned, false);
  const row = plannerExportPresentation({ ...initialState(), items: [item(corr)], correspondenceProgress: { [corr.id]: saved } }, catalog).rows[0];
  assert.match(row.progressSummary, /合格済み/); assert.equal(row.correspondenceResult, null); assert.equal(row.credits, 2);
});
test('calligraphy ambiguous institutional candidate holds independently recorded manual completion without name inference', () => {
  const row = official({ curriculumCourseId: null, curriculumMatch: 'ambiguous', candidateCurriculumCourseIds: [course.id] });
  const x = result([item(corr), item(schools[0])], batch('passed'), [row]);
  assert.equal(x.progress.completion, 'unknown'); assert.equal(x.progress.earnedCredits, 0); assert.equal(x.credits, 0);
});
test('calligraphy institutional mismatch is not repaired from matching raw name', () => {
  const f = structuredClone(catalog); const o = f.offerings.find(o => o.id === corr.id); o.curriculumCourseId = null;
  const p = deriveCurriculumCourseProgress([item(corr)], f, [], programs[0].scopeId, [], batch('passed'), profile);
  assert.equal(p.courses.length, 0); assert.equal(p.unassigned.length, 1);
});
for (const corrupt of ['missing-mapping', 'wrong-composition', 'wrong-department']) test(`calligraphy ${corrupt} keeps exact subject on hold rather than falling into ordinary summation`, () => {
  const f = structuredClone(catalog); const target = f.curriculum.courses.find(c => c.id === course.id);
  if (corrupt === 'missing-mapping') target.mappingIds = ['missing'];
  if (corrupt === 'wrong-composition') target.curriculumCredits = 4;
  if (corrupt === 'wrong-department') f.mappings.find(m => m.mappingId === target.mappingIds[0]).department = '史学科';
  const items = [item(corr), ...schools.slice(0, 2).map(o => item(o))];
  const p = deriveCurriculumCourseProgress(items, f, [], programs[0].scopeId, [], batch('passed'), profile).courses[0];
  assert.equal(p.completion, 'unknown'); assert.equal(p.earnedExcessCredits, 0); assert.ok(p.earnedCredits <= 2);
});
