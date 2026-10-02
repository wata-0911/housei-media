import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { catalog, offeringsById } from '../src/planner/catalog.ts';
import { annualCreditLimitReferences, createCreditClassifier, summarizeCategories } from '../src/planner/annualPlan.ts';
import { summarizeCredits } from '../src/planner/calculations.ts';
import CurriculumCourseList from '../src/components/planner/CurriculumCourseList.tsx';
import { deriveCurriculumCourseProgress, curriculumOfferingAdvisories } from '../src/planner/curriculumCourseProgress.ts';
import { deriveCurriculumCourseView } from '../src/planner/curriculumCourseView.ts';
import { applyImport, importedEarnedCreditsTotal, importPreview } from '../src/planner/gradeImportApply.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { deriveImportedAchievements } from '../src/planner/importedAchievementCalculations.ts';
import { plannerExportPresentation } from '../src/planner/plannerExport.ts';
import { plannerItemsWithoutOfficialEarned } from '../src/planner/officialCourseCredits.ts';
import { initialState, loadState, saveState, STORAGE_KEY } from '../src/planner/storage.ts';
import { economicsGradeCells } from './fixtures/economics-grade-row.mjs';

const economics = catalog.curriculum.courses.find(course => course.canonicalName === '経済学');
const correspondence = catalog.offerings.find(offering => offering.curriculumCourseId === economics.id && offering.method === 'correspondence');
const winter = catalog.offerings.find(offering => offering.curriculumCourseId === economics.id && offering.method === 'schooling' && offering.credits === 2);
assert.ok(economics); assert.ok(correspondence); assert.ok(winter);

function extractedEconomics() {
  const cells = economicsGradeCells();
  const row = { querySelectorAll: () => cells.map(textContent => ({ textContent, classList: { contains: () => false } })) };
  const context = { document: { querySelectorAll: () => [{ querySelectorAll: () => [row] }] } };
  runInNewContext(readFileSync(new URL('../extension/hosei-planner-import/parser/extractor.js', import.meta.url), 'utf8'), context);
  return JSON.parse(JSON.stringify(context.HoseiPlannerGradeExtractor.extractCurrentDocument().value));
}

function cleanImport() {
  return applyImport(initialState(), importPreview(extractedEconomics(), catalog.offerings), catalog.offerings);
}

function legacyEconomics(status = 'earned') {
  const clean = cleanImport();
  return {
    ...clean,
    items: [{
      ...clean.items[0], status, plannedYear: 2026, courseCreditContribution: 2,
    }],
  };
}

function progress(state, sourceCatalog = catalog) {
  return deriveCurriculumCourseProgress(
    state.items,
    sourceCatalog,
    state.importedCourseAchievements,
    state.selectedScopeId,
    state.importedStudyRecords,
  );
}

function economicsProgress(state, sourceCatalog = catalog) {
  return progress(state, sourceCatalog).courses.find(course => course.curriculumCourseId === economics.id);
}

function listProps(state, overrides = {}) {
  return {
    catalog,
    view: deriveCurriculumCourseView(state, catalog),
    offerings: offeringsById,
    classify: createCreditClassifier(catalog, state.selectedScopeId),
    publicCourses: state.publicCourses,
    disabled: false,
    onChange: () => {}, onRemove: () => {}, onChangeImportedMeta: () => {},
    onChangePublicCourse: () => {}, onRemovePublicCourse: () => {},
    onChangeEvaluation: () => {}, onChangeCorrespondence: () => {}, onOpenMedia: () => {},
    ...overrides,
  };
}

function matchingComponent(state, patch = {}) {
  const record = state.importedStudyRecords.find(value => value.method === 'correspondence');
  assert.ok(record);
  return { ...record, ...patch };
}

test('component provenance: clean current Economics import remains official4 with a separate planned attempt', () => {
  const state = cleanImport();
  const course = economicsProgress(state);
  assert.equal(state.importedCourseAchievements[0].earnedCreditsTotal, 4);
  assert.equal(state.items[0].status, 'planned');
  assert.equal(state.items[0].importedSourceCourseId, undefined);
  assert.deepEqual([course.earnedCredits, course.projectedCredits], [4, 8]);
  assert.equal(course.attempts[0].officialEarnedPreferred, false);
});

test('component provenance: legacy exact earned component is deduplicated without hiding official or attempt children', () => {
  const state = legacyEconomics();
  const course = economicsProgress(state);
  const view = deriveCurriculumCourseView(state, catalog).courses.find(value => value.curriculumCourse.id === economics.id);
  assert.deepEqual(
    [course.earnedCredits, course.projectedCredits, course.earnedExcessCredits, course.projectedExcessCredits],
    [4, 4, 0, 0],
  );
  assert.equal(course.attempts[0].officialEarnedPreferred, true);
  assert.equal(course.attempts[0].officialEarnedPreferenceReason, 'component_source_match');
  assert.deepEqual([course.attempts[0].earnedContribution, course.attempts[0].projectedContribution], [0, 0]);
  assert.equal(view.officialAchievements.length, 1); assert.equal(view.attempts.length, 1);
  assert.ok(course.warnings.some(warning => warning.includes('重複加算していません')));
  assert.ok(course.warnings.every(warning => !warning.includes('成績表とは別に修得済み')));
});

test('component provenance UI: parent is4/4, split2 remains editable, and the provenance reason is shown', () => {
  const state = legacyEconomics();
  const html = renderToStaticMarkup(createElement(CurriculumCourseList, listProps(state)));
  assert.match(html, /修得: 4 \/ 4単位/);
  assert.match(html, /予定込み: 4 \/ 4単位/);
  assert.match(html, /超過候補: 修得 0単位 \/ 予定込み 0単位/);
  assert.match(html, /スクーリング2単位 \+ 通信学習2単位/);
  assert.match(html, /公式成績表の履修内訳に対応するため、公式集計を優先し重複加算しない/);
  assert.equal((html.match(/data-attempt-id=/g) ?? []).length, 1);
  assert.equal((html.match(/data-official-id=/g) ?? []).length, 1);
  assert.doesNotMatch(html, /成績表とは別に修得済み/);
});

test('component provenance: independent winter earned2 without safe matching detail remains6/excess2', () => {
  const base = cleanImport();
  const state = { ...base, items: [{ ...base.items[0], offeringId: winter.id, status: 'earned', plannedYear: 2026, courseCreditContribution: 2 }] };
  const course = economicsProgress(state);
  assert.deepEqual([course.earnedCredits, course.projectedCredits, course.earnedExcessCredits], [6, 6, 2]);
  assert.equal(course.attempts[0].officialEarnedPreferred, false);
  assert.ok(course.warnings.some(warning => warning.includes('成績表とは別に修得済み')));
});

test('component provenance: same exact CurriculumCourse without a matching component does not deduplicate', () => {
  const state = legacyEconomics();
  state.importedStudyRecords = [];
  const course = economicsProgress(state);
  assert.deepEqual([course.earnedCredits, course.earnedExcessCredits], [6, 2]);
  assert.equal(course.attempts[0].officialEarnedPreferenceReason, null);
});

test('component provenance: same name alone does not deduplicate and a contradictory Course relation warns', () => {
  const state = legacyEconomics();
  const otherCourse = catalog.curriculum.courses.find(course => course.id !== economics.id && course.curriculumCredits === 4);
  assert.ok(otherCourse);
  const clonedOffering = { ...correspondence, id: 'same-name-other-course', curriculumCourseId: otherCourse.id };
  const sourceCatalog = { ...catalog, offerings: [...catalog.offerings, clonedOffering] };
  state.items = [{ ...state.items[0], offeringId: clonedOffering.id }];
  state.importedStudyRecords = [matchingComponent(state, { offeringId: clonedOffering.id })];
  const result = progress(state, sourceCatalog);
  const attemptCourse = result.courses.find(course => course.curriculumCourseId === otherCourse.id);
  assert.equal(attemptCourse.earnedCredits, 2);
  assert.equal(attemptCourse.attempts[0].officialEarnedPreferenceReason, null);
  assert.ok(attemptCourse.warnings.some(warning => warning.includes('制度科目が一致しない')));
});

for (const [label, patch] of [
  ['unmatched component', { match: 'unmatched' }],
  ['ambiguous component', { match: 'ambiguous' }],
  ['year mismatch', { academicYear: 2025 }],
  ['method mismatch', { method: 'schooling' }],
]) test(`component provenance: ${label} does not deduplicate`, () => {
  const state = legacyEconomics();
  state.importedStudyRecords = state.importedStudyRecords.map(record => record.method === 'correspondence' ? matchingComponent(state, patch) : record);
  const course = economicsProgress(state);
  assert.deepEqual([course.earnedCredits, course.earnedExcessCredits], [6, 2]);
  assert.equal(course.attempts[0].officialEarnedPreferenceReason, null);
});

test('component provenance: ambiguous official parent does not deduplicate', () => {
  const state = legacyEconomics();
  const row = state.importedCourseAchievements[0];
  state.importedCourseAchievements = [{ ...row, curriculumCourseId: null, curriculumMatch: 'ambiguous', candidateCurriculumCourseIds: [economics.id, catalog.curriculum.courses.find(course => course.id !== economics.id).id] }];
  const course = economicsProgress(state);
  assert.equal(course.earnedCredits, 2);
  assert.equal(course.attempts[0].officialEarnedPreferenceReason, null);
  assert.equal(progress(state).unassigned.some(entry => entry.sourceCourseId === row.id), true);
});

test('component provenance: orphan component does not deduplicate', () => {
  const state = legacyEconomics();
  state.importedStudyRecords = [matchingComponent(state, { sourceCourseId: 'missing-parent' })];
  const course = economicsProgress(state);
  assert.deepEqual([course.earnedCredits, course.earnedExcessCredits], [6, 2]);
  assert.equal(course.attempts[0].officialEarnedPreferenceReason, null);
});

for (const status of ['planned', 'in_progress', 'waiting']) test(`component provenance: safe ${status} attempt keeps projected contribution`, () => {
  const state = legacyEconomics(status);
  const course = economicsProgress(state);
  assert.deepEqual([course.earnedCredits, course.projectedCredits], [4, 6]);
  assert.deepEqual([course.attempts[0].earnedContribution, course.attempts[0].projectedContribution], [0, 2]);
  assert.equal(course.attempts[0].officialEarnedPreferenceReason, null);
});

test('component provenance: annual split2 remains2 and never attributes official4 to correspondence', () => {
  const state = legacyEconomics();
  assert.deepEqual(annualCreditLimitReferences(state.items, offeringsById, state.importedCourseAchievements), [{
    year: 2026, correspondenceCredits: 2, unknownCorrespondenceItems: 0,
    schoolingRegistrationCredits: 0, knownTotalCredits: 2, exceedsOfficial49: false,
  }]);
  assert.equal(state.items[0].importedSourceCourseId, undefined);
});

test('component provenance: graduation official-priority remains unchanged', () => {
  const state = legacyEconomics();
  assert.deepEqual(plannerItemsWithoutOfficialEarned(state.items, offeringsById, state.importedCourseAchievements, catalog), []);
  for (const program of catalog.programs.filter(program => !program.isCommon)) {
    const withLegacy = calculateGraduationProgress(state.items, catalog, program.scopeId, [], 'undecided', state.importedStudyRecords, state.importedCourseAchievements);
    const officialOnly = calculateGraduationProgress([], catalog, program.scopeId, [], 'undecided', state.importedStudyRecords, state.importedCourseAchievements);
    assert.deepEqual(withLegacy, officialOnly);
    assert.equal(withLegacy.graduationCheckComplete, false);
  }
});

test('component provenance: legacy v22 reload derives4 without mutating or saving a repair field', () => {
  const state = legacyEconomics();
  const before = structuredClone(state);
  const values = new Map();
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  saveState(store, state, null, catalog);
  const raw = values.get(STORAGE_KEY);
  assert.deepEqual(state, before);
  assert.equal(JSON.parse(raw).schemaVersion, 22);
  assert.equal(raw.includes('component_source_match'), false);
  assert.equal(raw.includes('officialEarnedPreferenceReason'), false);
  const loaded = loadState(store, catalog);
  assert.equal(loaded.error, null); assert.deepEqual(loaded.state, before);
  const course = economicsProgress(loaded.state);
  assert.deepEqual([course.earnedCredits, course.projectedCredits, course.earnedExcessCredits], [4, 4, 0]);
  assert.equal(loaded.state.items[0].importedSourceCourseId, undefined);
  assert.equal(values.get(STORAGE_KEY), raw);
});

test('component provenance: actual extractor retains aggregate4 plus communication and winter2/A source details', () => {
  const state = cleanImport();
  assert.equal(state.importedCourseAchievements.length, 1);
  assert.equal(state.importedCourseAchievements[0].earnedCreditsTotal, 4);
  assert.equal(state.importedCourseAchievements[0].curriculumCourseId, economics.id);
  const communication = state.importedStudyRecords.find(record => record.method === 'correspondence');
  const schooling = state.importedStudyRecords.find(record => record.method === 'schooling');
  assert.deepEqual([communication.match, communication.offeringId, communication.credits, communication.grade], ['exact_unique', correspondence.id, 2, 'S']);
  assert.deepEqual([schooling.term, schooling.credits, schooling.grade], ['冬期', 2, 'A']);
});

test('component provenance: Course-only repair does not alter summaries, annual policy, or export', () => {
  const state = legacyEconomics();
  const scope = catalog.programs.find(program => !program.isCommon).scopeId;
  const imported = deriveImportedAchievements(state.importedStudyRecords, offeringsById, state.items, state.importedCourseAchievements, catalog, scope);
  assert.equal(importedEarnedCreditsTotal(state.importedCourseAchievements), 4);
  assert.equal(summarizeCredits(imported.plannerItems, offeringsById).earned, 0);
  const categories = summarizeCategories(imported.plannerItems, catalog, scope, [], imported.categoryItems, imported.categoryOfferings, imported.categoryOverrides);
  assert.equal(categories.reduce((sum, row) => sum + row.earned, 0) >= 4, true);
  assert.equal(annualCreditLimitReferences(state.items, offeringsById, state.importedCourseAchievements)[0].correspondenceCredits, 2);
  const exported = plannerExportPresentation(state, catalog).rows.find(row => row.title === correspondence.name);
  assert.equal(exported.courseCreditContribution, 2); assert.equal(exported.statusLabel, '修得済み');
  assert.ok(curriculumOfferingAdvisories(correspondence, progress(state)).some(message => message.includes('科目構成単位を満たしています')));
});
