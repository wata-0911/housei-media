import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { catalog, offeringsById } from '../src/planner/catalog.ts';
import { deriveCurriculumCourseProgress, curriculumOfferingAdvisories, COMPLETED_COURSE_ADVISORY, MEDIA_REPEAT_ADVISORY } from '../src/planner/curriculumCourseProgress.ts';
import { plannerItemsWithoutOfficialEarned } from '../src/planner/officialCourseCredits.ts';
import { applyImport, importPreview } from '../src/planner/gradeImportApply.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { deriveImportedAchievements } from '../src/planner/importedAchievementCalculations.ts';
import { plannerItemFromCourseSearch, updatePlannerItem } from '../src/planner/plannerItemState.ts';
import { initialState, loadState, saveState, STORAGE_KEY } from '../src/planner/storage.ts';
import { validateState } from '../src/planner/validation.ts';
import { removePlannerItem, restorePlannerItem } from '../src/planner/removeUndo.ts';
import { annualCreditLimitReferences, createCreditClassifier, groupAnnualPlan } from '../src/planner/annualPlan.ts';
import { createUnifiedCourseRows } from '../src/planner/unifiedCourseView.ts';
import { searchOfferings } from '../src/planner/calculations.ts';
import CourseSearch from '../src/components/planner/CourseSearch.tsx';
import CourseProgress from '../src/components/planner/CurriculumCourseProgress.tsx';

function fixture() {
  const base = catalog.offerings.find(offering => offering.method === 'correspondence' && offering.credits === 4 && offering.curriculumCourseId
    && catalog.curriculum.courses.find(course => course.id === offering.curriculumCourseId)?.curriculumCredits === 4);
  const course = { ...catalog.curriculum.courses.find(course => course.id === base.curriculumCourseId), canonicalName: '進捗検証科目' };
  const offerings = catalog.offerings.slice(0, 3).map((offering, index) => ({ ...base, id: offering.id, name: course.canonicalName,
    credits: index === 2 ? 4 : 2, method: index === 2 ? 'correspondence' : 'schooling', period: index === 0 ? '夏期' : '冬期' }));
  const curriculum = { ...catalog.curriculum, courses: [course], offeringRelations: offerings.map(offering => ({ offeringId: offering.id, curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id] })) };
  return { ...catalog, offerings, curriculum, requirements: [], course };
}
const item = (offering, status = 'planned') => ({ ...plannerItemFromCourseSearch(offering.id), status });
function official(f, credits = 2, patch = {}) {
  return { id: 'official-row', fingerprint: 'official-source', source: 'hosei_import', rawName: f.course.canonicalName, categoryRaw: null,
    capturedAt: '2026-10-02T00:00:00Z', earnedCreditsTotal: credits, schoolingCreditsTotal: credits, compositionCredits: 4,
    recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source',
    curriculumCourseId: f.course.id, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [f.course.id],
    offeringMatch: 'unmatched', courseId: f.offerings[0].courseId, selectedOfferingId: null, selectionSource: 'none', match: 'exact_unique',
    candidateOfferingIds: [], ...patch };
}
const progress = (f, items, rows = []) => deriveCurriculumCourseProgress(items, f, rows).courses[0];

test('course progress A: official exact earned2 with unknown opening plus planned2 gives earned2/projected4', () => {
  const f = fixture(); const row = official(f); const p = progress(f, [item(f.offerings[0])], [row]);
  assert.deepEqual([p.earnedCredits, p.projectedCredits, p.remainingCredits, p.completion, p.projectedCompletion], [2, 4, 2, 'incomplete', 'complete']);
  assert.equal(p.officialAchievements[0].selectedOfferingId, null);
});
test('CourseProgress retains separate earned attempts after planned2 becomes earned2; graduation keeps official priority', () => {
  const f = fixture(); const row = official(f, 2, { selectedOfferingId: f.offerings[0].id, offeringMatch: 'exact_unique', candidateOfferingIds: [f.offerings[0].id] });
  const items = [item(f.offerings[1])];
  const planned = progress(f, items, [row]);
  assert.deepEqual([planned.earnedCredits, planned.projectedCredits], [2, 4]);
  const changed = updatePlannerItem(items, items[0].offeringId, { status: 'earned' });
  const earned = progress(f, changed, [row]);
  assert.deepEqual([earned.earnedCredits, earned.projectedCredits, earned.completion, earned.projectedCompletion], [4, 4, 'complete', 'complete']);
  assert.equal(earned.attempts[0].earnedContribution, 2);
  assert.equal(earned.attempts[0].officialEarnedPreferred, false);
  assert.ok(earned.warnings.some(warning => warning.includes('成績表の再取込')));
  assert.deepEqual(plannerItemsWithoutOfficialEarned(changed, new Map(f.offerings.map(o => [o.id, o])), [row], f), []);
  for (const program of catalog.programs.filter(program => !program.isCommon)) {
    const run = items => calculateGraduationProgress(items, f, program.scopeId, [], 'undecided', [], [row]);
    assert.deepEqual(run(changed), run([]), program.department);
    assert.equal(run(changed).graduationCheckComplete, false);
  }
});
test('course progress B: two different earned2 offerings complete a four-credit course', () => {
  const f = fixture(); const items = f.offerings.slice(0, 2).map(o => item(o, 'earned')); const p = progress(f, items);
  assert.deepEqual([p.earnedCredits, p.projectedCredits, p.completion, p.attempts.length], [4, 4, 'complete', 2]);
  assert.equal(validateState({ ...initialState(), items }, f), true);
});
test('course progress C: correspondence earned4 completes a four-credit course', () => {
  const f = fixture(); const p = progress(f, [item(f.offerings[2], 'earned')]);
  assert.deepEqual([p.earnedCredits, p.completion, p.remainingCredits], [4, 'complete', 0]);
});
test('course progress D: only schooling earned2 remains incomplete', () => {
  const f = fixture(); const p = progress(f, [item(f.offerings[0], 'earned')]);
  assert.deepEqual([p.earnedCredits, p.projectedCredits, p.completion, p.projectedCompletion], [2, 2, 'incomplete', 'incomplete']);
});
test('official4 plus source-linked earned4 remains4 without a duplicate attempt contribution', () => {
  const f = fixture(); const row = official(f, 4);
  const p = progress(f, [{ ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id }], [row]);
  assert.equal(p.earnedCredits, 4); assert.equal(p.projectedCredits, 4);
  assert.ok(p.attempts.every(attempt => attempt.officialEarnedPreferred && attempt.earnedContribution === 0));
});
test('partial official aggregate2 never turns a four-credit earned auto item into four earned credits', () => {
  const f = fixture(); const row = official(f); const auto = { ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id };
  const p = progress(f, [auto, item(f.offerings[0])], [row]);
  assert.deepEqual([p.earnedCredits, p.projectedCredits], [2, 4]);
  assert.deepEqual([progress(f, [auto], [row]).earnedCredits, progress(f, [auto], [row]).projectedCredits], [2, 2]);
  const derived = deriveImportedAchievements([], new Map(f.offerings.map(o => [o.id, o])), [auto], [row], f);
  assert.equal(derived.plannerItems.length, 0);
  assert.equal(derived.offerings[0].credits, 2);
});
for (const status of ['planned', 'in_progress', 'waiting', 'failed', 'dropped']) test(`course progress: ${status} projected contribution`, () => {
  const f = fixture(); const p = progress(f, [item(f.offerings[0], status)], [official(f)]);
  assert.equal(p.earnedCredits, 2); assert.equal(p.projectedCredits, ['failed', 'dropped'].includes(status) ? 2 : 4);
});
test('ambiguous Offering remains in planner, annual and unified views without Course aggregation', () => {
  const f = fixture(); f.offerings[0].curriculumCourseId = null;
  f.curriculum.offeringRelations[0] = { offeringId: f.offerings[0].id, curriculumCourseId: null, candidateCurriculumCourseIds: [f.course.id, 'other-course'] };
  const items = [item(f.offerings[0], 'earned')]; const map = new Map(f.offerings.map(o => [o.id, o]));
  const result = deriveCurriculumCourseProgress(items, f);
  assert.equal(result.courses.length, 0); assert.match(result.unassigned[0].reason, /一意に判定できません/);
  assert.equal(groupAnnualPlan(items, map)[0].groups[0].items.length, 1);
  assert.equal(createUnifiedCourseRows(items, [], map).length, 1);
  const exact = deriveCurriculumCourseProgress(items, f, [official(f)]);
  assert.equal(exact.courses[0].earnedCredits, 2); assert.equal(exact.courses[0].attempts.length, 0);
});
test('different Offering identities remain editable, removable and restorable; same offering stays unique', () => {
  const f = fixture(); const items = f.offerings.slice(0, 2).map(o => item(o));
  const changed = updatePlannerItem(items, items[0].offeringId, { status: 'earned' });
  assert.equal(changed[1], items[1]);
  const removed = removePlannerItem(changed, items[0].offeringId);
  assert.deepEqual(restorePlannerItem(changed.slice(1), removed), changed);
  assert.equal(restorePlannerItem(changed, removed), null);
  assert.equal(validateState({ ...initialState(), items: [items[0], items[0]] }, f), false);
  assert.equal(searchOfferings(f.offerings, f.course.canonicalName).length, 3);
});
test('search retains both additional offerings after partial or full completion, with advisory only', () => {
  const f = fixture();
  for (const credits of [2, 4]) {
    const row = official(f, credits);
    const result = deriveCurriculumCourseProgress([{ ...item(f.offerings[0], 'earned'), importedSourceCourseId: row.id }], f, [row]);
    const html = renderToStaticMarkup(createElement(CourseSearch, { catalog: f, classify: createCreditClassifier(f, null), selectedScopeId: null,
      offerings: f.offerings, addedIds: new Set([f.offerings[0].id]), disabled: false, curriculumProgress: result, onAdd: () => {}, onAddPublicCourse: () => {} }));
    assert.equal((html.match(/>計画に追加<\/button>/g) ?? []).length, 2, 'two other offerings remain selectable');
    assert.equal((html.match(/>追加済み<\/button>/g) ?? []).length, 1);
    assert.equal(html.includes(COMPLETED_COURSE_ADVISORY), credits === 4);
  }
});
test('over-completion retains uncapped6 and reports2 excess candidates without invalidating credits', () => {
  const f = fixture(); const result = deriveCurriculumCourseProgress([item(f.offerings[0], 'earned'), item(f.offerings[2], 'earned')], f);
  const p = result.courses[0]; assert.deepEqual([p.earnedCredits, p.earnedExcessCredits, p.projectedExcessCredits, p.completion], [6, 2, 2, 'complete']);
  const html = renderToStaticMarkup(createElement(CourseProgress, { progress: result, catalog: f }));
  assert.match(html, /修得済み 4 \/ 4/); assert.match(html, /\+2単位 超過候補/);
});
test('unknown composition and unknown active offering credits never assert incomplete or complete', () => {
  const f = fixture(); f.course.curriculumCredits = null;
  assert.equal(progress(f, [item(f.offerings[2], 'earned')]).completion, 'unknown');
  f.course.curriculumCredits = 4; f.offerings[0].credits = null;
  const p = progress(f, [item(f.offerings[0], 'earned')]);
  assert.equal(p.completion, 'unknown'); assert.equal(p.remainingCredits, null); assert.equal(p.projectedCompletion, 'unknown');
});
test('official null or zero remains authoritative after an associated item was marked earned', () => {
  const f = fixture();
  for (const credits of [null, 0]) {
    const row = official(f, credits); const p = progress(f, [{ ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id }], [row]);
    assert.equal(p.earnedCredits, 0); assert.equal(p.completion, credits === null ? 'unknown' : 'incomplete');
  }
});
test('known repeatable institutional courses never receive the generic completed-Course advisory', () => {
  const names = ['基礎特講', '政治学', '法律学演習', '法律学特講', '総合特講', '経済学特講', '経営学特講', '史学演習', '歴史資料学', '（他学部・他学科公開科目）'];
  for (const name of names) {
    const course = catalog.curriculum.courses.find(course => course.canonicalName === name || (name === '史学演習' && /^史学演習[1-4]$/.test(course.canonicalName)) || (name === '歴史資料学' && course.canonicalName === '歴史資料学1〜6'));
    assert.ok(course, name);
    const f = { ...catalog, course };
    const p = deriveCurriculumCourseProgress([], f, [official(f, 16)]).courses[0];
    assert.equal(p.completion, 'repeatable', name); assert.equal(p.warnings.includes(COMPLETED_COURSE_ADVISORY), false, name);
  }
});
test('Media re-add advisory cites phone guidance and leaves the opening selectable, including after failure', () => {
  const f = fixture(); f.offerings[0].deliveryCategory = '前期メディア'; f.offerings[1].deliveryCategory = '後期メディア';
  const p = deriveCurriculumCourseProgress([item(f.offerings[0], 'failed')], f);
  assert.deepEqual(curriculumOfferingAdvisories(f.offerings[1], p), [MEDIA_REPEAT_ADVISORY]);
  assert.equal(searchOfferings(f.offerings, 'メディア').length, 2);
  assert.equal(curriculumOfferingAdvisories(f.offerings[2], p).includes(MEDIA_REPEAT_ADVISORY), false);
});
test('same-name History CurriculumCourses retain their official identities and independent totals', () => {
  const courses = catalog.curriculum.courses.filter(course => course.canonicalName === '日本史概説');
  assert.ok(courses.length > 1);
  const rows = courses.map((course, index) => official({ course, offerings: [catalog.offerings[0]] }, 2, { id: `history-${index}` }));
  const p = deriveCurriculumCourseProgress([], catalog, rows);
  assert.equal(p.courses.length, courses.length); assert.equal(new Set(p.courses.map(course => course.curriculumCourseId)).size, courses.length);
  assert.ok(p.courses.every(course => course.earnedCredits === 2));
});

test('Law conditional partial2 graduation count remains separate from incomplete2/4 Course progress', () => {
  const law = catalog.programs.find(program => program.department === '法律学科');
  const mappings = catalog.mappings.slice(0, 9).map((mapping, index) => ({ ...mapping, scopeId: law.scopeId,
    category: '専門教育', field: null, requirementType: index === 8 ? '選択' : '選択必修', curriculumCredits: 4 }));
  const courses = mappings.map((mapping, index) => ({ id: `curriculum:${mapping.mappingId}`, canonicalName: `法律進捗${index}`,
    curriculumCredits: 4, mappingIds: [mapping.mappingId], scopeIds: [law.scopeId] }));
  const offerings = catalog.offerings.slice(0, 9).map((offering, index) => ({ ...offering, courseId: `law-legacy-${index}`,
    curriculumCourseId: courses[index].id, name: courses[index].canonicalName, resolutionStatus: 'matched',
    credits: index === 8 ? 2 : 4, method: index === 8 ? 'schooling' : 'correspondence', mappingIds: [mappings[index].mappingId] }));
  const f = { ...catalog, mappings, offerings, curriculum: { ...catalog.curriculum, courses } };
  const items = offerings.map(o => item(o, 'earned'));
  const p = deriveCurriculumCourseProgress(items, f, [], law.scopeId).courses.find(course => course.curriculumCourseId === courses[8].id);
  assert.deepEqual([p.earnedCredits, p.completion], [2, 'incomplete']);
  const beforePrerequisite = calculateGraduationProgress([items[8]], f, law.scopeId, [], 'not_selected');
  assert.equal(beforePrerequisite.cards.find(card => card.requirementId === 'professional-law-elective').earned, 0);
  const qualified = calculateGraduationProgress(items, f, law.scopeId, [], 'not_selected');
  assert.equal(qualified.cards.find(card => card.requirementId === 'professional-law-required-elective').earned, 32);
  assert.equal(qualified.cards.find(card => card.requirementId === 'professional-law-elective').earned, 2);
  assert.equal(qualified.graduationCheckComplete, false);
});

test('an unresolved official source linked to an earned auto item cannot manufacture Course credit', () => {
  const f = fixture(); const row = official(f, 2, { curriculumCourseId: null, curriculumMatch: 'unmatched', candidateCurriculumCourseIds: [] });
  const result = deriveCurriculumCourseProgress([{ ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id }], f, [row]);
  assert.equal(result.unassigned.length, 1);
  assert.equal(result.courses[0].earnedCredits, 0);
  assert.equal(result.courses[0].completion, 'unknown');
});

function importData(name, earned) {
  const empty = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null };
  return { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-02T00:00:00Z', courses: [{ rawName: name, categoryRaw: null,
    compositionCredits: { raw: '4', value: 4 }, earnedCredits: { raw: earned === null ? '' : String(earned), value: earned }, schoolingCredits: { raw: '', value: null },
    recognizedExemption: { raw: '', value: null }, additionalEnrollment: { raw: '', value: null },
    reports: Array.from({ length: 4 }, () => ({ raw: '合格', status: 'passed', date: '2026-06-01' })),
    creditExam: { rawDate: '2026/07/01', rawCredits: '4', rawGrade: 'S', date: '2026-07-01', credits: 4, grade: 'S', pendingMarker: false }, schoolings: [empty, empty] }] };
}
function withPassingSchoolings(data) {
  const schooling = { rawYear: '26', rawTerm: '前期', rawDate: '2026/07/01', rawCredits: '2', rawGrade: 'A',
    year: '26', term: '前期', date: '2026-07-01', credits: 2, grade: 'A' };
  data.courses[0].schoolings = [schooling, { ...schooling, rawDate: '2026/08/01', date: '2026-08-01' }];
  data.courses[0].schoolingCredits = { raw: '2', value: 2 };
  return data;
}
function competingSourceData(name) {
  const data = importData(name, 2);
  data.courses = ['source A', 'source B'].map(categoryRaw => ({ ...structuredClone(data.courses[0]), categoryRaw }));
  return data;
}
for (const deselectedSource of [null, 'source A', 'source B']) test(`two official sources for one Offering stay planned when deselected source is ${deselectedSource}`, () => {
  const f = fixture(); const offerings = [f.offerings[2]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const preview = importPreview(competingSourceData(f.course.canonicalName), offerings, [], [], context);
  assert.equal(preview.length, 2);
  assert.equal(new Set(preview.map(unit => unit.sourceCourse.id)).size, 2);
  assert.ok(preview.every(unit => unit.selected && unit.match === 'exact_unique' && unit.offeringId === offerings[0].id));
  const units = preview.map(unit => ({ ...unit, selected: unit.sourceCourse.categoryRaw !== deselectedSource }));
  const next = applyImport(initialState(), units, offerings);
  assert.equal(next.items.length, 1); assert.equal(next.items[0].status, 'planned');
  assert.equal('importedSourceCourseId' in next.items[0], false);
  const selectedSources = deselectedSource === null ? ['source A', 'source B'] : ['source A', 'source B'].filter(source => source !== deselectedSource);
  assert.deepEqual(next.importedCourseAchievements.map(row => row.categoryRaw), selectedSources);
  assert.equal(next.importedStudyRecords.length, selectedSources.length);
  assert.equal(validateState(next, f), true); assert.equal(next.schemaVersion, 22);
});
for (const savedSource of ['source A', 'source B', 'both']) {
  for (const selectNewSource of savedSource === 'both' ? [false] : [false, true]) test(`competing-source backfill stays planned with ${savedSource} saved and new source selected=${selectNewSource}`, () => {
    const f = fixture(); const offerings = [f.offerings[2]];
    const context = { curriculum: f.curriculum, mappings: f.mappings };
    const data = competingSourceData(f.course.canonicalName);
    const savedData = { ...data, courses: data.courses.filter(course => savedSource === 'both' || course.categoryRaw === savedSource) };
    const imported = applyImport(initialState(), importPreview(savedData, offerings, [], [], context), offerings);
    const before = { ...imported, items: [] }; const snapshot = structuredClone(before);
    const preview = importPreview(data, offerings, before.importedStudyRecords, before.importedCourseAchievements, context);
    assert.equal(preview.length, 2);
    assert.equal(new Set(preview.map(unit => unit.sourceExistingId ?? unit.sourceCourse.id)).size, 2);
    const duplicates = preview.filter(unit => unit.sourceDuplicate);
    assert.equal(duplicates.length, savedData.courses.length);
    assert.ok(duplicates.every(unit => !unit.selected && unit.sourceExistingId !== null && unit.sourceExistingId !== unit.sourceCourse.id));
    const units = preview.map(unit => ({ ...unit, selected: !unit.sourceDuplicate && selectNewSource }));
    const next = applyImport(before, units, offerings);
    assert.equal(next.items.length, 1); assert.equal(next.items[0].status, 'planned');
    assert.equal('importedSourceCourseId' in next.items[0], false);
    assert.deepEqual(before, snapshot);
    assert.equal(next.importedCourseAchievements.length, selectNewSource ? 2 : savedData.courses.length);
    if (!selectNewSource) {
      assert.equal(next.importedCourseAchievements, before.importedCourseAchievements);
      assert.equal(next.importedStudyRecords, before.importedStudyRecords);
    }
    assert.equal(validateState(next, f), true); assert.equal(next.schemaVersion, 22);
    assert.equal(applyImport(next, units, offerings).items[0], next.items[0]);
  });
}
test('one official row with correspondence and schooling Offerings generates planned items without source markers', () => {
  const f = fixture(); const offerings = [f.offerings[2], f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  for (const credits of [null, 0, 2, 4]) {
    const data = withPassingSchoolings(importData(f.course.canonicalName, credits));
    const next = applyImport(initialState(), importPreview(data, offerings, [], [], context), offerings);
    assert.equal(next.importedCourseAchievements.length, 1);
    assert.equal(next.items.length, 2);
    assert.ok(next.items.every(item => item.status === 'planned' && item.importedSourceCourseId === undefined));
    assert.equal(progress(f, next.items, next.importedCourseAchievements).earnedCredits, credits ?? 0);
    assert.equal(validateState(next, f), true);
    assert.equal(applyImport(next, importPreview(data, offerings, next.importedStudyRecords, next.importedCourseAchievements, context), offerings), next);
  }
});
for (const deselectedMethod of ['schooling', 'correspondence']) test(`deselecting ${deselectedMethod} does not attribute a multi-Offering source aggregate to the remaining item`, () => {
  const f = fixture(); const offerings = [f.offerings[2], f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const data = importData(f.course.canonicalName, 2); const emptySlot = data.courses[0].schoolings[1];
  withPassingSchoolings(data); data.courses[0].schoolings[1] = emptySlot;
  const preview = importPreview(data, offerings, [], [], context);
  assert.equal(preview.length, 2); assert.ok(preview.every(unit => unit.selected && unit.match === 'exact_unique'));
  assert.equal(new Set(preview.map(unit => unit.sourceCourse.id)).size, 1);
  const units = preview.map(unit => ({ ...unit, selected: unit.method !== deselectedMethod }));
  const next = applyImport(initialState(), units, offerings);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].offeringId, offerings.find(offering => offering.method !== deselectedMethod).id);
  assert.equal(next.items[0].status, 'planned');
  assert.equal(next.items[0].importedSourceCourseId, undefined);
  assert.equal(next.importedStudyRecords.length, 1);
  assert.equal(next.importedCourseAchievements.length, 1);
  assert.equal(progress(f, next.items, next.importedCourseAchievements).earnedCredits, 2);
  assert.equal(validateState(next, f), true);
});
test('deselecting every component adds neither PlannerItems nor a new official source', () => {
  const f = fixture(); const offerings = [f.offerings[2], f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const preview = importPreview(withPassingSchoolings(importData(f.course.canonicalName, 2)), offerings, [], [], context);
  const state = initialState();
  const next = applyImport(state, preview.map(unit => ({ ...unit, selected: false })), offerings);
  assert.equal(next, state);
  assert.deepEqual(next.items, []); assert.deepEqual(next.importedCourseAchievements, []); assert.deepEqual(next.importedStudyRecords, []);
});
test('deselecting one of two slots for the same Offering still permits a single source-linked earned item', () => {
  const f = fixture(); const offerings = [f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const preview = importPreview(withPassingSchoolings(importData(f.course.canonicalName, 2)), offerings, [], [], context);
  const schoolings = preview.filter(unit => unit.method === 'schooling');
  assert.equal(schoolings.length, 2); assert.ok(schoolings.every(unit => unit.match === 'exact_unique' && unit.offeringId === offerings[0].id));
  const units = preview.map(unit => ({ ...unit, selected: unit.id === schoolings[0].id }));
  const next = applyImport(initialState(), units, offerings);
  assert.equal(next.items.length, 1); assert.equal(next.items[0].status, 'earned');
  assert.equal(next.items[0].importedSourceCourseId, next.importedCourseAchievements[0].id);
  assert.equal(next.importedStudyRecords.length, 1);
  assert.equal(progress(f, next.items, next.importedCourseAchievements).earnedCredits, 2);
});
test('a missing component of a multi-Offering source remains planned on backfill even if the other item already exists', () => {
  const f = fixture(); const offerings = [f.offerings[2], f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const data = withPassingSchoolings(importData(f.course.canonicalName, 2));
  const imported = applyImport(initialState(), importPreview(data, offerings, [], [], context), offerings);
  for (const kept of imported.items) {
    const state = { ...imported, items: [kept] };
    const restored = applyImport(state, importPreview(data, offerings, state.importedStudyRecords, state.importedCourseAchievements, context), offerings);
    assert.equal(restored.items.length, 2);
    assert.equal(restored.items[0], kept);
    assert.equal(restored.items[1].status, 'planned');
    assert.equal(restored.items[1].importedSourceCourseId, undefined);
    assert.equal(progress(f, restored.items, restored.importedCourseAchievements).earnedCredits, 2);
  }
});
test('two component slots matching one distinct Offering can still create one source-linked earned item', () => {
  const f = fixture(); const offerings = [f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const next = applyImport(initialState(), importPreview(withPassingSchoolings(importData(f.course.canonicalName, 2)), offerings, [], [], context), offerings);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].status, 'earned');
  assert.equal(next.items[0].importedSourceCourseId, next.importedCourseAchievements[0].id);
  assert.equal(progress(f, next.items, next.importedCourseAchievements).earnedCredits, 2);
});
test('auto import earned status depends only on a positive official aggregate, never passing grades/reports', () => {
  const f = fixture(); const offerings = [f.offerings[2]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  for (const earned of [null, 0, 2, 4]) {
    const data = importData(f.course.canonicalName, earned);
    const next = applyImport(initialState(), importPreview(data, offerings, [], [], context), offerings);
    assert.equal(next.items[0].status, earned > 0 ? 'earned' : 'planned');
    assert.equal(next.items[0].importedSourceCourseId, earned > 0 ? next.importedCourseAchievements[0].id : undefined);
    assert.deepEqual(next.courseEvaluations, {}); assert.deepEqual(next.correspondenceProgress, {});
    assert.equal(progress(f, next.items, next.importedCourseAchievements).earnedCredits, earned ?? 0);
  }
});
test('v22 saves and reloads optional source association losslessly and retains progress, evaluations, todos and undo', () => {
  const f = fixture(); const row = official(f, 4); const o = f.offerings[2]; const i = { ...item(o, 'earned'), importedSourceCourseId: row.id };
  const state = { ...initialState(), items: [i, item(f.offerings[0])], importedCourseAchievements: [row],
    courseEvaluations: { [o.id]: { offeringId: o.id, finalGrade: 'A', reportGrade: null, schoolingGrade: null } },
    correspondenceProgress: { [o.id]: { offeringId: o.id, requiredReports: 2, reports: [{ reportNumber: 1, status: 'passed', grade: 'A' }], examGrade: 'S' } },
    todos: [{ id: catalog.offerings[0].id, offeringId: o.id, text: '公式結果を確認', done: false }] };
  const values = new Map(); const store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  assert.equal(validateState(state, f), true);
  const raw = saveState(store, state, null, f); const loaded = loadState(store, f);
  assert.equal(loaded.error, null); assert.deepEqual(loaded.state, state); assert.equal(loaded.state.schemaVersion, 22);
  const removed = removePlannerItem(state.items, o.id);
  const deleted = { ...state, items: state.items.filter(item => item.offeringId !== o.id) };
  const deletedRaw = saveState(store, deleted, raw, f);
  saveState(store, { ...deleted, items: restorePlannerItem(deleted.items, removed) }, deletedRaw, f);
  assert.deepEqual(loadState(store, f).state, state);
  assert.equal(values.has(STORAGE_KEY), true);
  assert.equal(validateState({ ...state, items: [{ ...i, importedSourceCourseId: 'missing-source' }] }, f), false);
  const unlinked = { ...state, items: state.items.map(({ importedSourceCourseId: _source, ...item }) => item) };
  assert.equal(validateState(unlinked, f), true, 'existing v22 records require no new metadata');
});
test('v22 reload and delete undo preserve source-linked and separate user-earned contributions', () => {
  const f = fixture(); const row = official(f, 2);
  const auto = { ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id };
  const items = updatePlannerItem([auto, item(f.offerings[0])], f.offerings[0].id, { status: 'earned' });
  const state = { ...initialState(), items, importedCourseAchievements: [row] };
  const values = new Map(); const store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  assert.equal(validateState(state, f), true);
  const raw = saveState(store, state, null, f);
  const loaded = loadState(store, f);
  assert.equal(loaded.error, null); assert.deepEqual(loaded.state, state);
  assert.deepEqual([progress(f, loaded.state.items, loaded.state.importedCourseAchievements).earnedCredits,
    progress(f, loaded.state.items, loaded.state.importedCourseAchievements).projectedCredits], [4, 4]);
  const removed = removePlannerItem(loaded.state.items, f.offerings[0].id);
  const deleted = { ...loaded.state, items: [auto] };
  const deletedRaw = saveState(store, deleted, raw, f);
  assert.equal(progress(f, loadState(store, f).state.items, [row]).earnedCredits, 2);
  const restored = { ...deleted, items: restorePlannerItem(deleted.items, removed) };
  saveState(store, restored, deletedRaw, f);
  assert.deepEqual(loadState(store, f).state, state);
  assert.equal(progress(f, restored.items, [row]).earnedCredits, 4);
});
test('all eight graduation programs retain official-only output after positive2/4 auto import; annual limits remain Offering based', () => {
  const base = catalog.offerings.find(o => o.method === 'correspondence' && o.credits === 4 && o.curriculumCourseId && o.resolutionStatus === 'matched');
  const programs = catalog.programs.filter(program => !program.isCommon); assert.equal(programs.length, 8);
  for (const earned of [2, 4]) {
    const data = importData(base.name, earned);
    const next = applyImport(initialState(), importPreview(data, [base]), [base]);
    assert.equal(next.items[0].status, 'earned');
    for (const program of programs) {
      const run = items => calculateGraduationProgress(items, catalog, program.scopeId, [], 'undecided', next.importedStudyRecords, next.importedCourseAchievements, next.graduationProfile);
      assert.deepEqual(run(next.items), run([]), `${program.displayName}: official${earned}`);
      assert.equal(run(next.items).graduationCheckComplete, false);
    }
    const withYear = next.items.map(item => ({ ...item, plannedYear: 2026 }));
    assert.equal(annualCreditLimitReferences(withYear, offeringsById)[0].knownTotalCredits, 4);
    assert.equal(plannerItemsWithoutOfficialEarned(withYear, offeringsById, next.importedCourseAchievements, catalog).length, 0);
  }
});
