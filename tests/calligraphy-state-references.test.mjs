import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programs, schools, item, result } from './fixtures/calligraphy-progress.mjs';

for (const program of programs) test(`calligraphy P2 audit minimum ${program.course}: S1 in_progress is I1/P0/earned0`, () => {
  const x = result([item(schools[0], 'in_progress')], {}, [], program.scopeId);
  for (const id of ['professional-elective', 'professional-japanese-total']) {
    const row = x.graduation.cards.find(c => c.requirementId === id);
    assert.deepEqual([row.earned, row.inProgress, row.planned], [0, 1, 0], id);
  }
  assert.deepEqual([x.progress.earnedCredits, x.progress.projectedCredits, x.progress.completion], [0, 1, 'incomplete']);
});

import { catalog } from '../src/planner/catalog/catalog.ts';
import { deriveCalligraphyProgress } from '../src/planner/progress/calligraphyProgress.ts';
import { initialState, loadState, saveState, STORAGE_KEY } from '../src/planner/backup/storage.ts';
import { createPlannerBackup, parsePlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { stateForScopeChange } from '../src/planner/graduation/thesisSelection.ts';
import { validateState } from '../src/planner/validation.ts';
import { course, corr, profile, batch, official } from './fixtures/calligraphy-progress.mjs';
import { referenceCases, persistenceCaseLabels } from './fixtures/calligraphy-state-references.mjs';

function assertContract(scenario, scope) {
  const { items, saved, rows, expected: e } = scenario;
  const x = result(items, saved, rows, scope);
  const model = deriveCalligraphyProgress(course, items, catalog, scope, saved, rows, [], profile);
  assert.deepEqual([x.progress.earnedCredits, x.progress.projectedCredits, x.progress.completion], [e.earned, e.projected, scenario.completion]);
  assert.equal(x.progress.projectedCompletion, rows.length ? scenario.completion : e.projected === 2 ? 'complete' : 'incomplete');
  assert.deepEqual([model.inProgressCredits, model.plannedCredits, model.waitingCredits], [e.inProgress, e.planned, e.waiting]);
  assert.equal(model.completedCredits, e.graduation);
  assert.equal(x.progress.earnedExcessCredits, 0); assert.equal(x.progress.projectedExcessCredits, 0);
  assert.ok(e.earned + model.inProgressCredits + model.plannedCredits + model.waitingCredits <= 2);
  for (const id of ['professional-elective', 'professional-japanese-total']) {
    const row = x.graduation.cards.find(c => c.requirementId === id);
    assert.deepEqual([row.earned, row.inProgress, row.planned], [e.graduation, e.inProgress, e.planned], id);
  }
  const minima = catalog.requirements.filter(r => r.scopeId === scope && r.status === 'structured' && r.ruleType === 'min_credits'
    && r.target.curriculum_category === '専門教育' && ['選択', undefined].includes(r.target.requirement_type) && r.target.curriculum_field === undefined);
  assert.equal(minima.length, 2);
  for (const rule of minima) {
    const row = x.graduation.requirements.find(r => r.requirementId === rule.id);
    assert.deepEqual([row.earned, row.inProgress, row.planned], [e.graduation, e.inProgress, e.planned], rule.ruleId);
  }
  assert.equal(x.graduation.graduationCheckComplete, false);
  assert.equal(catalog.metadata.sourceLinksReverified, false);
  return x;
}
for (const program of programs) for (const scenario of referenceCases) test(`calligraphy P2 contract ${program.course}: ${scenario.label}`, () => {
  const before = structuredClone(scenario); assertContract(scenario, program.scopeId); assert.deepEqual(scenario, before);
  const reversed = { ...scenario, items: [...scenario.items].reverse() };
  // Compare the explicit state/allocation contract, not unrelated presentation labels.
  assertContract(reversed, program.scopeId);
});
for (const program of programs) test(`calligraphy P2 lifecycle changes ${program.course} revoke S1 completion without relabelling progress`, () => {
  let items = [item(corr, 'in_progress'), item(schools[0])]; const saved = batch('passed');
  const sequence = [
    ['earned', [2, 0, 0, 2]], ['in_progress', [0, 1, 0, 2]],
    ['waiting', [0, 0, 0, 2]], ['planned', [0, 0, 1, 2]], ['earned', [2, 0, 0, 2]],
  ];
  for (const [status, values] of sequence) {
    items = items.map(i => i.offeringId === schools[0].id ? { ...i, status } : i);
    const x = result(items, saved, [], program.scopeId); const row = x.graduation.cards.find(c => c.requirementId === 'professional-elective');
    assert.deepEqual([row.earned, row.inProgress, row.planned, x.progress.projectedCredits], values);
  }
});
for (const program of programs) for (const label of persistenceCaseLabels) test(`calligraphy P2 v22 persistence ${program.course}: ${label}`, async () => {
  const scenario = referenceCases.find(s => s.label === label); assert.ok(scenario);
  const state = { ...stateForScopeChange(initialState(), catalog, program.scopeId), graduationProfile: profile,
    items: structuredClone(scenario.items), correspondenceProgress: structuredClone(scenario.saved),
    importedCourseAchievements: structuredClone(scenario.rows) };
  if (state.importedCourseAchievements.length) {
    const row = state.importedCourseAchievements[0];
    state.items[0].importedSourceCourseId = row.id;
    state.importedStudyRecords = [{ id: 'p2-retained-detail', fingerprint: 'p2-retained-detail', source: 'hosei_import', sourceCourseId: row.id,
      rawName: '書道実技', offeringId: null, match: 'unmatched', method: 'correspondence', academicYear: 2025, yearSource: 'source',
      rawYear: '25', term: null, rawTerm: '通', date: null, credits: null, grade: null, reports: [], examGrade: null, capturedAt: '2026-10-13T00:00:00Z' }];
    state.importedCourseUserMeta = { [row.id]: { lifecycleStatus: 'waiting', plannedYear: 2027, plannedTerm: '保存済みの期', studyYear: 3 } };
  }
  assert.equal(validateState(state, catalog), true); const before = structuredClone(state);
  const memory = new Map(); const store = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const raw = saveState(store, state, null, catalog); const loaded = loadState(store, catalog);
  assert.equal(loaded.error, null); assert.deepEqual(loaded.state, before);
  const backup = await createPlannerBackup(raw, catalog); const restored = (await parsePlannerBackup(JSON.stringify(backup), catalog)).state;
  assert.deepEqual(restored, before); assert.equal(restored.schemaVersion, 22); assert.deepEqual(state, before);
  assertContract({ ...scenario, items: restored.items, saved: restored.correspondenceProgress, rows: restored.importedCourseAchievements }, program.scopeId);
  assert.equal(store.getItem(STORAGE_KEY), raw);
});
test('calligraphy P2 null and explicit0 remain distinct official states with pending manual S1', () => {
  const items = [item(corr), item(schools[0], 'in_progress')]; const saved = batch('passed');
  const unknown = result(items, saved, [official({ earnedCreditsTotal: null, schoolingCreditsTotal: null })]);
  const zero = result(items, saved, [official({ earnedCreditsTotal: 0, schoolingCreditsTotal: 0 })]);
  assert.equal(unknown.progress.officialAchievements[0].earnedCreditsTotal, null);
  assert.equal(zero.progress.officialAchievements[0].earnedCreditsTotal, 0);
  assert.equal(unknown.progress.completion, 'unknown'); assert.equal(zero.progress.completion, 'incomplete');
  assert.equal(unknown.credits, 0); assert.equal(zero.credits, 0);
});
