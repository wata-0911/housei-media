import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createElement, Children, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { catalog, offeringsById } from '../src/planner/catalog.ts';
import { createCreditClassifier } from '../src/planner/annualPlan.ts';
import { deriveCurriculumCourseView } from '../src/planner/curriculumCourseView.ts';
import { applyImport, importPreview } from '../src/planner/gradeImportApply.ts';
import { updatePlannerItem } from '../src/planner/plannerItemState.ts';
import { loadState, saveState, STORAGE_KEY } from '../src/planner/storage.ts';
import { removePlannerItem, restorePlannerItem } from '../src/planner/removeUndo.ts';
import CurriculumCourseList from '../src/components/planner/CurriculumCourseList.tsx';
import PlannerAttemptChild from '../src/components/planner/PlannerAttemptChild.tsx';
import OfficialAchievementChild from '../src/components/planner/OfficialAchievementChild.tsx';
import ImportedAchievements, { ImportedManagementPanel } from '../src/components/planner/ImportedAchievements.tsx';
import { ImportedCourseRepairControls } from '../src/components/planner/ImportedCourseRepair.tsx';
import ImportedCourseRepair from '../src/components/planner/ImportedCourseRepair.tsx';
import ImportedStudyRecordEditor from '../src/components/planner/ImportedStudyRecordEditor.tsx';
import UnresolvedCurriculumSection from '../src/components/planner/UnresolvedCurriculumSection.tsx';
import GradeImportPanel from '../src/components/planner/GradeImportPanel.tsx';
import GraduationProgress from '../src/components/planner/GraduationProgress.tsx';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { importedAchievementManagement } from '../src/planner/importedAchievementManagement.ts';
import { focusImportedCourseList, IMPORT_RESULT_TARGET } from '../src/planner/importNavigation.ts';

import CorrespondenceStudyMethod from '../src/components/planner/CorrespondenceStudyMethod.tsx';
import { CorrespondenceDetails } from '../src/components/planner/CorrespondenceProgress.tsx';
import { GradeSelect, StatusSelect, StudyYearSelect, YearInput, TermSelect, CompletionOrderInput } from '../src/components/planner/PlannerRowControls.tsx';
import { economics, correspondence, winter, item, official, detail, communicationDetail, state } from './fixtures/curriculum-course-ui.mjs';
import { economicsGradeCells } from './fixtures/economics-grade-row.mjs';

const noop = () => {};
const props = (input, overrides = {}) => ({
  catalog, view: deriveCurriculumCourseView(input, catalog), offerings: offeringsById, classify: createCreditClassifier(catalog, input.selectedScopeId),
  publicCourses: input.publicCourses, disabled: false, onChange: noop, onRemove: noop, onChangeImportedMeta: noop, onChangeImportedCourse: noop,
  onChangePublicCourse: noop, onRemovePublicCourse: noop, onChangeEvaluation: noop, onChangeCorrespondence: noop, onOpenMedia: noop, ...overrides,
});
const html = input => renderToStaticMarkup(createElement(CurriculumCourseList, props(input)));
const count = (markup, attribute) => (markup.match(new RegExp(`${attribute}="`, 'g')) ?? []).length;
function elements(tree) {
  const result = [];
  function walk(node) {
    Children.forEach(node, child => { if (!isValidElement(child)) return; result.push(child); walk(child.props.children); });
  }
  walk(tree); return result;
}
const find = (tree, type) => elements(tree).find(node => node.type === type);
const attemptFor = input => deriveCurriculumCourseView(input, catalog).courses[0].attempts[0];

// One responsive tree: every source child is present at every breakpoint.
test('UI: one exact Course parent keeps communication and winter attempts with different studyYears', () => {
  const markup = html(state({ items: [item(correspondence, 'planned', { studyYear: 1 }), item(winter, 'earned', { studyYear: 3 })] }));
  assert.equal(count(markup, 'data-curriculum-course-id'), 1); assert.equal(count(markup, 'data-attempt-id'), 2);
  assert.match(markup, /1年/); assert.match(markup, /3年/); assert.match(markup, /2026 通信/); assert.match(markup, /冬期/);
});
test('UI: exact official row with unknown Offering survives under its Course', () => {
  const markup = html(state({ importedCourseAchievements: [official()] }));
  assert.equal(count(markup, 'data-curriculum-course-id'), 1); assert.equal(count(markup, 'data-official-id'), 1); assert.equal(count(markup, 'data-attempt-id'), 0);
  assert.match(markup, /公式修得 4単位/); assert.match(markup, /開講照合: 未特定/); assert.match(markup, /2025年度（成績表記載）/);
});
test('UI: communication reports/exam and winter2/A details remain separate from official4', () => {
  const markup = html(state({ importedCourseAchievements: [official()], importedStudyRecords: [communicationDetail(), detail()] }));
  for (const text of ['成績表の履修内訳（2件）', 'リポート 1: ○25/06/01', '単位修得試験: S', '冬期', '2026-02-01', '2単位 / 評価: A', '修得: 4 / 4単位']) assert.ok(markup.includes(text), text);
});
test('UI: official4 and source-linked earned display4 and preserve the editable attempt', () => {
  const markup = html(state({ importedCourseAchievements: [official()], items: [item(correspondence, 'earned', { importedSourceCourseId: 'official-economics' })] }));
  assert.match(markup, /修得: 4 \/ 4単位/); assert.equal(count(markup, 'data-attempt-id'), 1); assert.equal(count(markup, 'data-official-id'), 1);
  assert.match(markup, /重複加算なし/); assert.match(markup, /通信学習で4単位修得/);
});
test('UI: official4 and independent earned2 display uncapped6 and excess2', () => {
  const markup = html(state({ importedCourseAchievements: [official()], items: [item(winter, 'earned')] }));
  assert.match(markup, /修得: 6 \/ 4単位/); assert.match(markup, /超過候補: 修得 2単位 \/ 予定込み 2単位/);
});
test('UI: same-name 2/4-unit identities have separate parents', () => {
  const courses = catalog.curriculum.courses.filter(c => c.canonicalName === '日本史概説');
  const markup = html(state({ importedCourseAchievements: courses.map((c, i) => official({ id: `history-${i}`, rawName: c.canonicalName, curriculumCourseId: c.id, candidateCurriculumCourseIds: [c.id], compositionCredits: c.curriculumCredits })) }));
  assert.equal(count(markup, 'data-curriculum-course-id'), 2);
  for (const c of courses) assert.ok(markup.includes(`data-curriculum-course-id="${c.id}"`));
});
test('UI: ambiguous official exposes both candidate identities, source detail, metadata and reason', () => {
  const candidates = catalog.curriculum.courses.filter(c => c.canonicalName === '日本史概説').map(c => c.id);
  const markup = html(state({ importedCourseAchievements: [official({ rawName: '日本史概説', curriculumCourseId: null, curriculumMatch: 'ambiguous', candidateCurriculumCourseIds: candidates })], importedStudyRecords: [detail()], importedCourseUserMeta: { 'official-economics': { lifecycleStatus: 'waiting', plannedYear: 2028, plannedTerm: '冬期', studyYear: 2 } } }));
  assert.equal(count(markup, 'data-curriculum-course-id'), 0); assert.match(markup, /data-unresolved-kind="official"/); assert.match(markup, /一意に判定できません/); assert.match(markup, /冬期/); assert.match(markup, /2028/);
  for (const id of candidates) assert.ok(markup.includes(id));
});
test('UI: ambiguous and missing Offering attempts retain saved progress/evaluation and editable item', () => {
  const ambiguous = catalog.offerings.find(o => catalog.curriculum.offeringRelations.some(r => r.offeringId === o.id && r.candidateCurriculumCourseIds.length > 1));
  const missing = 'missing-opening';
  const markup = html(state({ items: [item(ambiguous), item({ id: missing })], correspondenceProgress: { [missing]: { offeringId: missing, requiredReports: 4, reports: [{ reportNumber: 4, status: 'passed', grade: 'A' }], examGrade: 'S' } }, mediaSchoolingProgress: { [missing]: { offeringId: missing, totalLessons: 5, lessons: [{ lesson: 2, videoCompleted: true, testCompleted: false }], assessments: [{ id: 'exam', type: 'other', label: '確認課題', scheduledDate: '2027-01-02', completed: true }] } }, courseEvaluations: { [missing]: { offeringId: missing, finalGrade: 'B', reportGrade: 'A', schoolingGrade: 'S' } } }));
  assert.equal(count(markup, 'data-unresolved-kind'), 2); assert.equal(count(markup, 'data-attempt-id'), 2);
  for (const text of ['開講情報なし', 'リポート 4: 合格済み / A', '単位修得試験 S', '第2回: 動画 完了 / テスト 未完了', '確認課題: 2027-01-02 / 完了', 'value="B" selected=""']) assert.ok(markup.includes(text), text);
});
test('UI: legacy and missing-parent orphans are read-only and never generate a Course or official aggregate', () => {
  const markup = html(state({ importedStudyRecords: [detail({ id: 'legacy', sourceCourseId: undefined }), detail({ id: 'missing-parent', sourceCourseId: 'deleted' })] }));
  assert.equal(count(markup, 'data-orphan-study-id'), 2); assert.equal(count(markup, 'data-curriculum-course-id'), 0); assert.equal(count(markup, 'data-official-id'), 0);
  assert.match(markup, /公式科目との対応未確認/); assert.doesNotMatch(markup, /<input|<select/);
});
test('UI: repeatable official16 plus independent earned2 retains18 without normal completion denominator or block', () => {
  const course = catalog.curriculum.courses.find(c => c.canonicalName.startsWith('基礎特講'));
  const opening = catalog.offerings.find(o => o.curriculumCourseId === course.id);
  const markup = html(state({ importedCourseAchievements: [official({ curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id], compositionCredits: course.curriculumCredits, earnedCreditsTotal: 16 })], items: [item(opening, 'earned', { courseCreditContribution: 2 })] }));
  assert.match(markup, /修得: 18単位 · 反復履修可能科目/); assert.doesNotMatch(markup, /修得: 18 \/|完成後の再履修/); assert.match(markup, /履修attemptの詳細・編集/);
});
test('UI callbacks: status/year/studyYear/term/order and grades route by offeringId, not Course id', () => {
  const calls = []; const grades = [];
  for (const opening of [correspondence, winter]) {
    const input = state({ items: [item(opening)] });
    const tree = PlannerAttemptChild({ attempt: attemptFor(input), editor: props(input, { onChange: (...args) => calls.push(args), onChangeEvaluation: (...args) => grades.push(args) }) });
    for (const [type, value, field] of [[StatusSelect, 'waiting', 'status'], [YearInput, 2028, 'plannedYear'], [StudyYearSelect, 3, 'studyYear'], [TermSelect, '冬期', 'plannedTerm'], [CompletionOrderInput, 2, 'earnedOrder']]) {
      find(tree, type).props.onChange(value); assert.deepEqual(calls.at(-1), [opening.id, { [field]: value }]);
    }
    const selects = elements(tree).filter(node => node.type === GradeSelect);
    assert.equal(selects.length, opening.method === 'schooling' ? 3 : 1);
    selects.forEach(node => {
      node.props.onChange('A');
      assert.equal(grades.at(-1)[0], opening.id); assert.equal(grades.at(-1)[1].offeringId, opening.id);
    });
  }
  assert.ok(grades.length >= 2); assert.equal(grades.length, 4);
  assert.ok(grades.every(([id, grade]) => [correspondence.id, winter.id].includes(id) && grade.offeringId === id));
});
test('UI callbacks: official year/studyYear/term/lifecycle metadata use achievement.id', () => {
  const input = state({ importedCourseAchievements: [official({ earnedCreditsTotal: 0 })] }); const calls = [];
  const tree = OfficialAchievementChild({ official: props(input).view.courses[0].officialAchievements[0], editor: props(input, { onChangeImportedMeta: (...args) => calls.push(args) }) });
  for (const [type, value, field] of [[YearInput, 2028, 'plannedYear'], [StudyYearSelect, 2, 'studyYear'], [TermSelect, '冬期', 'plannedTerm']]) { find(tree, type).props.onChange(value); assert.deepEqual(calls.at(-1), ['official-economics', { [field]: value }]); }
  find(tree, 'select').props.onChange({ target: { value: 'waiting' } }); assert.deepEqual(calls.at(-1), ['official-economics', { lifecycleStatus: 'waiting' }]);
});
test('UI callbacks: full4/split2 and correspondence progress remain offering-owned even alongside official credits', () => {
  const input = state({ items: [item(correspondence)], importedCourseAchievements: [official()] }); const calls = [];
  const editor = props(input, { onChange: (...args) => calls.push(args), onChangeCorrespondence: (...args) => calls.push(args) });
  const child = PlannerAttemptChild({ attempt: attemptFor(input), editor });
  const details = find(child, CorrespondenceDetails);
  const tree = CorrespondenceStudyMethod({ item: details.props.item, offering: details.props.offering, onChange: details.props.onChangeItem });
  for (const [value, credit] of [['split2', 2], ['full4', 4]]) { find(tree, 'select').props.onChange({ target: { value } }); assert.deepEqual(calls.at(-1), [correspondence.id, { courseCreditContribution: credit }]); }
  const saved = { offeringId: correspondence.id, requiredReports: 4, reports: [], examGrade: 'A' };
  details.props.onChange(correspondence.id, saved); assert.deepEqual(calls.at(-1), [correspondence.id, saved]);
});
test('UI delete callback and existing undo preserve official facts and saved progress/evaluation', () => {
  let input = state({ items: [item(correspondence), item(winter)], importedCourseAchievements: [official()], correspondenceProgress: { [correspondence.id]: { offeringId: correspondence.id, requiredReports: 4, reports: [], examGrade: 'A' } } });
  input = { ...input, courseEvaluations: { [correspondence.id]: { offeringId: correspondence.id, finalGrade: 'B', reportGrade: 'A', schoolingGrade: 'S' } } };
  const original = structuredClone(input); let removed;
  const tree = PlannerAttemptChild({ attempt: attemptFor(input), editor: props(input, { onRemove: id => { assert.equal(id, correspondence.id); removed = removePlannerItem(input.items, id); input = { ...input, items: input.items.filter(i => i.offeringId !== id) }; } }) });
  find(tree, 'button').props.onClick(); assert.equal(count(html(input), 'data-attempt-id'), 1); assert.equal(count(html(input), 'data-official-id'), 1); assert.deepEqual(input.correspondenceProgress, original.correspondenceProgress); assert.deepEqual(input.courseEvaluations, original.courseEvaluations);
  input = { ...input, items: restorePlannerItem(input.items, removed) }; assert.deepEqual(input, original); assert.equal(count(html(input), 'data-attempt-id'), 2);
});
test('UI: one responsive presentation contains official/attempt/unresolved/orphan at all breakpoints', () => {
  const markup = html(state({ items: [item(correspondence), item({ id: 'missing' })], importedCourseAchievements: [official()], importedStudyRecords: [detail({ id: 'orphan', sourceCourseId: undefined })] }));
  for (const attr of ['data-curriculum-course-id', 'data-official-id', 'data-orphan-study-id', 'data-unresolved-kind']) assert.equal(count(markup, attr), 1);
  assert.equal(count(markup, 'data-attempt-id'), 2); assert.doesNotMatch(markup, /md:hidden|hidden md:block/); assert.match(markup, /sm:grid-cols-2/);
});
test('UI callbacks persist only the existing owners; reload rederives the view without persisting it', () => {
  let input = state({ items: [item(correspondence)], importedCourseAchievements: [official()] });
  const before = structuredClone(input); const editor = props(input, { onChange: (id, patch) => { input = { ...input, items: updatePlannerItem(input.items, id, patch) }; } });
  const tree = PlannerAttemptChild({ attempt: attemptFor(input), editor }); find(tree, StudyYearSelect).props.onChange(4);
  assert.deepEqual(before.items[0].studyYear, null); assert.deepEqual(input.importedCourseAchievements, before.importedCourseAchievements);
  const data = new Map(); const store = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  saveState(store, input, null, catalog); const loaded = loadState(store, catalog); assert.equal(loaded.error, null); assert.equal(loaded.state.schemaVersion, 22);
  assert.equal(attemptFor(loaded.state).plannerItem.studyYear, 4); assert.deepEqual(Object.keys(JSON.parse(data.get(STORAGE_KEY))).sort(), Object.keys(before).sort());
  assert.doesNotMatch(data.get(STORAGE_KEY), /"projectedCompletion"|"earnedExcessCredits"|"officialAchievements"|"curriculumCourseView"/);
  const page = readFileSync(new URL('../src/pages/PlannerPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /deriveCurriculumCourseView\(state, catalog\)/); assert.match(page, /view=\{curriculumCourseView\}/); assert.doesNotMatch(page, /createUnifiedCourseRows|commit\(curriculumCourseView/);
});
test('UI: extracted Economics source keeps official4 and both components, never attributed to the2026 communication attempt', () => {
  const cells = economicsGradeCells(); const context = { document: { querySelectorAll: () => [{ querySelectorAll: () => [{ querySelectorAll: () => cells.map(textContent => ({ textContent, classList: { contains: () => false } })) }] }] } };
  runInNewContext(readFileSync(new URL('../extension/hosei-planner-import/parser/extractor.js', import.meta.url), 'utf8'), context);
  const data = JSON.parse(JSON.stringify(context.HoseiPlannerGradeExtractor.extractCurrentDocument().value));
  const imported = applyImport(state(), importPreview(data, catalog.offerings), catalog.offerings);
  assert.equal(imported.importedCourseAchievements[0].selectedOfferingId, null);
  const input = { ...imported, items: [item(correspondence), item(winter)] }; const view = props(input).view;
  assert.equal(view.courses[0].earnedCredits, 4); assert.equal(view.courses[0].attempts.length, 2);
  assert.ok(view.courses[0].attempts.every(a => !a.plannerItem.importedSourceCourseId));
  const markup = html(input); assert.match(markup, /公式修得 4単位/); assert.match(markup, /成績表の履修内訳（2件）/); assert.match(markup, /冬期/); assert.match(markup, /2単位 \/ 評価: A/);
});
test('UI: future notice, media editing, public independence and disabled delete remain available', () => {
  const media = catalog.offerings.find(o => o.curriculumCourseId && ['前期メディア', '後期メディア'].includes(o.deliveryCategory)); assert.ok(media);
  const input = state({ items: [item(media, 'planned', { plannedYear: 2028 })], publicCourses: [{ id: 'public', title: '経済学', credits: 2, status: 'planned', plannedYear: 2026, plannedTerm: null, studyYear: 1, finalGrade: null }] });
  const markup = renderToStaticMarkup(createElement(CurriculumCourseList, props(input, { disabled: true })));
  assert.match(markup, /将来年度の開講は未確認/); assert.match(markup, /メディア進捗で編集/); assert.match(markup, /aria-label="公開科目"/); assert.equal(count(markup, 'data-curriculum-course-id'), 1);
  const tree = PlannerAttemptChild({ attempt: attemptFor(input), editor: props(input, { disabled: true }) }); assert.equal(elements(tree).filter(n => n.type === 'button').at(-1).props.disabled, true);
});

test('UI: rendering deeply frozen source state/catalog/view cannot mutate or persist derived parents', () => {
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const input = freeze(state({ items: [item(correspondence)], importedCourseAchievements: [official()], importedStudyRecords: [communicationDetail(), detail()] }));
  const sourceCatalog = freeze(structuredClone(catalog));
  const view = freeze(deriveCurriculumCourseView(input, sourceCatalog));
  const before = JSON.stringify(input);
  const markup = renderToStaticMarkup(createElement(CurriculumCourseList, props(input, { catalog: sourceCatalog, view })));
  assert.equal(count(markup, 'data-official-id'), 1); assert.equal(count(markup, 'data-attempt-id'), 1);
  assert.equal(JSON.stringify(input), before); assert.equal(input.schemaVersion, 22);
});

const twoCreditCorrespondence = catalog.offerings.find(o => o.method === 'correspondence' && o.credits === 2);
const mediaOffering = catalog.offerings.find(o => ['前期メディア', '後期メディア'].includes(o.deliveryCategory));
const ambiguousOffering = catalog.offerings.find(o => catalog.curriculum.offeringRelations.some(r => r.offeringId === o.id && r.candidateCurriculumCourseIds.length > 1));
const anyAttempt = input => {
  const view = deriveCurriculumCourseView(input, catalog);
  return view.courses.flatMap(course => course.attempts)[0] ?? view.unresolved.find(entry => entry.kind === 'attempt').attempt;
};
const attemptMarkup = input => renderToStaticMarkup(createElement(PlannerAttemptChild, { attempt: anyAttempt(input), editor: props(input) }));
const noContributionInput = markup => assert.doesNotMatch(markup, /aria-label="科目進捗への寄与単位"|通信学習の修得方法|value="full4"|value="split2"/);

test('P2-A: schooling2 has no arbitrary contribution editor or study-method selector', () => {
  assert.equal(winter.credits, 2);
  noContributionInput(attemptMarkup(state({ items: [item(winter)] })));
});
test('P2-A: correspondence2 has no arbitrary contribution editor or study-method selector', () => {
  assert.ok(twoCreditCorrespondence);
  noContributionInput(attemptMarkup(state({ items: [item(twoCreditCorrespondence)] })));
});
test('P2-A: missing Offering has no contribution editor and preserves a saved setting read-only', () => {
  const input = state({ items: [item({ id: 'missing-contribution' }, 'planned', { courseCreditContribution: 1 })] });
  const before = structuredClone(input);
  const markup = attemptMarkup(input);
  noContributionInput(markup);
  assert.match(markup, /保存済み寄与設定 1単位（要確認）/);
  assert.deepEqual(input, before);
});
test('P2-A: correspondence4 retains only unset/full4/split2 with offeringId callbacks', () => {
  const input = state({ items: [item(correspondence)] }); const calls = [];
  const editor = props(input, { onChange: (...args) => calls.push(args) });
  const child = PlannerAttemptChild({ attempt: anyAttempt(input), editor });
  const details = find(child, CorrespondenceDetails);
  const method = CorrespondenceStudyMethod({ item: details.props.item, offering: details.props.offering, onChange: details.props.onChangeItem });
  const choices = elements(method).filter(node => node.type === 'option').map(node => node.props.value);
  assert.deepEqual(choices, ['', 'full4', 'split2']);
  for (const [value, credits] of [['split2', 2], ['full4', 4], ['', undefined]]) {
    find(method, 'select').props.onChange({ target: { value } });
    assert.deepEqual(calls.at(-1), [correspondence.id, { courseCreditContribution: credits }]);
  }
  const markup = attemptMarkup(input);
  assert.doesNotMatch(markup, /aria-label="科目進捗への寄与単位"/);
  assert.match(markup, /value="full4"/); assert.match(markup, /value="split2"/);
});
test('P2-A: existing non-standard contributions remain read-only and survive render/save/reload', () => {
  for (const [opening, credits] of [[winter, 1], [twoCreditCorrespondence, 1], [correspondence, 3], [mediaOffering, 1]]) {
    assert.ok(opening);
    const input = state({ items: [item(opening, 'planned', { courseCreditContribution: credits })] });
    const before = structuredClone(input);
    Object.freeze(input.items[0]);
    const markup = attemptMarkup(input);
    assert.doesNotMatch(markup, /aria-label="科目進捗への寄与単位"/);
    assert.ok(markup.includes(`保存済み寄与設定 ${credits}単位（要確認）`));
    assert.deepEqual(input, before);
    const data = new Map(); const store = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    saveState(store, input, null, catalog);
    const loaded = loadState(store, catalog); assert.equal(loaded.error, null);
    assert.equal(loaded.state.items[0].courseCreditContribution, credits);
    assert.deepEqual(loaded.state, before);
  }
});
test('P2-B: correspondence never exposes schoolingGrade editing, even with a saved value', () => {
  const input = state({ items: [item(correspondence)], courseEvaluations: { [correspondence.id]: { offeringId: correspondence.id, finalGrade: 'B', reportGrade: null, schoolingGrade: 'A' } } });
  const before = structuredClone(input);
  const markup = attemptMarkup(input);
  assert.doesNotMatch(markup, /aria-label="スクーリング評価"/);
  assert.match(markup, /保存済みスクーリング評価: A/);
  assert.deepEqual(input, before);
});
test('P2-B: schooling keeps schoolingGrade and reportGrade editors with offeringId ownership', () => {
  const input = state({ items: [item(winter)], courseEvaluations: { [winter.id]: { offeringId: winter.id, finalGrade: 'B', reportGrade: 'A', schoolingGrade: 'S' } } });
  const calls = [];
  const child = PlannerAttemptChild({ attempt: anyAttempt(input), editor: props(input, { onChangeEvaluation: (...args) => calls.push(args) }) });
  const select = elements(child).find(node => node.type === GradeSelect && node.props.label === 'スクーリング評価');
  assert.ok(select); select.props.onChange('A');
  assert.deepEqual(calls.at(-1), [winter.id, { ...input.courseEvaluations[winter.id], schoolingGrade: 'A' }]);
  const markup = attemptMarkup(input);
  assert.match(markup, /aria-label="スクーリング評価"/);
  assert.match(markup, /aria-label="リポート評価（従来記録）"/);
});
test('P2-B: missing and ambiguous saved evaluations survive rendering and finalGrade edits', () => {
  for (const opening of [{ id: 'missing-evaluation' }, ambiguousOffering]) {
    assert.ok(opening);
    let input = state({ items: [item(opening)], courseEvaluations: { [opening.id]: { offeringId: opening.id, finalGrade: 'B', reportGrade: 'A', schoolingGrade: 'S' } } });
    const before = structuredClone(input);
    const markup = attemptMarkup(input);
    assert.deepEqual(input, before);
    const child = PlannerAttemptChild({ attempt: anyAttempt(input), editor: props(input, { onChangeEvaluation: (id, evaluation) => { assert.equal(id, opening.id); input = { ...input, courseEvaluations: { ...input.courseEvaluations, [id]: evaluation } }; } }) });
    const final = elements(child).find(node => node.type === GradeSelect && node.props.label.endsWith('の最終評価'));
    final.props.onChange('A');
    assert.deepEqual(input.courseEvaluations[opening.id], { ...before.courseEvaluations[opening.id], finalGrade: 'A' });
    if (opening.id === 'missing-evaluation') {
      assert.doesNotMatch(markup, /aria-label="スクーリング評価"|aria-label="リポート評価（従来記録）"/);
      assert.match(markup, /保存済みリポート評価: A/); assert.match(markup, /保存済みスクーリング評価: S/);
    } else {
      assert.equal(markup.includes('aria-label="スクーリング評価"'), opening.method === 'schooling');
      assert.equal(markup.includes('aria-label="リポート評価（従来記録）"'), opening.method !== 'correspondence');
      const data = new Map(); const store = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
      saveState(store, input, null, catalog); assert.deepEqual(loadState(store, catalog).state, input);
    }
  }
});
test('P2-A: media schooling has no arbitrary contribution editor', () => {
  assert.ok(mediaOffering);
  noContributionInput(attemptMarkup(state({ items: [item(mediaOffering)] })));
});
test('P2-B: legacy reportGrade follows method policy; correspondence and missing values are read-only', () => {
  for (const opening of [correspondence, twoCreditCorrespondence, { id: 'missing-report' }]) {
    const input = state({ items: [item(opening)], courseEvaluations: { [opening.id]: { offeringId: opening.id, finalGrade: null, reportGrade: 'A+', schoolingGrade: null } } });
    const markup = attemptMarkup(input);
    assert.doesNotMatch(markup, /aria-label="リポート評価（従来記録）"/);
    assert.match(markup, /保存済みリポート評価: A＋/);
    assert.equal(input.courseEvaluations[opening.id].reportGrade, 'A+');
  }
});

// Imported achievement UX cleanup: source facts, repair ownership, maintenance and navigation.
test('import UX: earned official lifecycle is fixed; all context edits preserve stored lifecycle and source facts', () => {
  for (const lifecycleStatus of [null, 'waiting', 'in_progress']) {
    let input = state({ importedCourseAchievements: [official()], importedCourseUserMeta: { 'official-economics': { lifecycleStatus, plannedYear: 2027, studyYear: 2, plannedTerm: '前期' } } });
    const before = structuredClone(input);
    const editor = props(input, { onChangeImportedMeta: (id, patch) => { input = { ...input, importedCourseUserMeta: { ...input.importedCourseUserMeta, [id]: { ...input.importedCourseUserMeta[id], ...patch } } }; } });
    const child = OfficialAchievementChild({ official: editor.view.courses[0].officialAchievements[0], editor });
    assert.equal(find(child, 'select'), undefined);
    const markup = renderToStaticMarkup(child);
    assert.match(markup, /履修状態: 修得済み（成績表）/); assert.doesNotMatch(markup, /判定保留/);
    for (const [type, value, field] of [[YearInput, 2028, 'plannedYear'], [StudyYearSelect, 3, 'studyYear'], [TermSelect, '冬期', 'plannedTerm']]) {
      const control = find(child, type); assert.equal(control.props.disabled, false); control.props.onChange(value);
      assert.equal(input.importedCourseUserMeta['official-economics'][field], value);
      assert.equal(input.importedCourseUserMeta['official-economics'].lifecycleStatus, lifecycleStatus);
    }
    assert.deepEqual(input.importedCourseAchievements, before.importedCourseAchievements);
    const data = new Map(); const store = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    saveState(store, input, null, catalog); assert.deepEqual(loadState(store, catalog).state, input);
    assert.equal(input.schemaVersion, 22); assert.deepEqual(Object.keys(input).sort(), Object.keys(before).sort());
  }
});
for (const earnedCreditsTotal of [0, null]) test(`import UX: ${earnedCreditsTotal} lifecycle supports pending/in-progress/waiting and preserves official credit semantics`, () => {
  const input = state({ importedCourseAchievements: [official({ earnedCreditsTotal })] }); const calls = [];
  const before = structuredClone(input); const editor = props(input, { onChangeImportedMeta: (...args) => calls.push(args) });
  const child = OfficialAchievementChild({ official: editor.view.courses[0].officialAchievements[0], editor });
  const select = find(child, 'select'); assert.equal(select.props.disabled, false);
  for (const value of ['', 'in_progress', 'waiting']) {
    select.props.onChange({ target: { value } }); assert.deepEqual(calls.at(-1), ['official-economics', { lifecycleStatus: value || null }]);
  }
  const markup = renderToStaticMarkup(child);
  assert.match(markup, earnedCreditsTotal === 0 ? /成績表では未修得（0単位）/ : /成績表の修得単位は不明/);
  assert.deepEqual(input, before);
});
test('import UX: successful official and linked detail appear once in course list; normal management has no duplicate', () => {
  const input = state({ importedCourseAchievements: [official()], importedStudyRecords: [detail()] });
  const markup = html(input); assert.equal(count(markup, 'data-official-id'), 1); assert.match(markup, /成績表の履修内訳（1件）/);
  const manage = renderToStaticMarkup(createElement(ImportedAchievements, { records: input.importedStudyRecords, courseRows: input.importedCourseAchievements, offerings: catalog.offerings, disabled: false, onChange: noop, onChangeCourse: noop, onDelete: noop }));
  assert.match(manage, /成績取込の管理/); assert.match(manage, /確認対象はありません/);
  assert.equal(count(manage, 'data-import-management-id'), 0); assert.equal(count(manage, 'data-import-study-id'), 0);
  assert.doesNotMatch(manage, /<details open/);
});
test('import UX: explicit full maintenance restores source editing; filter switch is reversible', () => {
  const input = state({ importedCourseAchievements: [official()], importedStudyRecords: [detail()] });
  let showAll = false;
  const panelProps = () => ({ records: input.importedStudyRecords, courseRows: input.importedCourseAchievements, offerings: catalog.offerings, disabled: false, onChange: noop, onChangeCourse: noop, onDelete: noop, showAll, onShowAll: value => { showAll = value; } });
  let panel = ImportedManagementPanel(panelProps()); find(panel, 'button').props.onClick(); assert.equal(showAll, true);
  panel = ImportedManagementPanel(panelProps()); let markup = renderToStaticMarkup(panel);
  assert.equal(count(markup, 'data-import-management-id'), 1); assert.equal(count(markup, 'data-import-study-id'), 1); assert.match(markup, /削除/); assert.match(markup, /value="冬期"/);
  find(panel, 'button').props.onClick(); assert.equal(showAll, false);
  markup = renderToStaticMarkup(ImportedManagementPanel(panelProps())); assert.equal(count(markup, 'data-import-management-id'), 0);
});
test('import UX: unresolved official repairs from course list using the shared safe selection callback', () => {
  const row = official({ curriculumCourseId: null, curriculumMatch: 'ambiguous', candidateCurriculumCourseIds: [economics.id], candidateOfferingIds: [correspondence.id] });
  const input = state({ importedCourseAchievements: [row] }); const calls = [];
  const editor = props(input, { onChangeImportedCourse: (...args) => calls.push(args) });
  const unresolved = UnresolvedCurriculumSection({ editor }); const repair = find(unresolved, ImportedCourseRepair);
  assert.ok(repair); assert.equal(repair.props.onChangeCourse, editor.onChangeImportedCourse);
  assert.match(html(input), /data-import-repair-id="official-economics"/);
  const controls = ImportedCourseRepairControls({ ...repair.props, query: '', onSearch: noop });
  find(controls, 'select').props.onChange({ target: { value: correspondence.id } });
  const [id, patch] = calls.at(-1); assert.equal(id, row.id); assert.equal(patch.curriculumCourseId, economics.id); assert.equal(patch.curriculumMatch, 'exact_unique');
  assert.equal(patch.selectionSource, 'manual'); assert.equal(patch.selectedOfferingId, correspondence.id);
  assert.equal(row.curriculumMatch, 'ambiguous'); assert.equal(row.curriculumCourseId, null);
  const resolved = { ...input, importedCourseAchievements: [{ ...row, ...patch }] };
  assert.equal(deriveCurriculumCourseView(resolved, catalog).unresolved.length, 0);
  const data = new Map(); const store = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  saveState(store, resolved, null, catalog); assert.deepEqual(loadState(store, catalog).state, resolved);
});
test('import UX: search alone does not resolve identity; ambiguous Offering remains ambiguous and clearing retains known Course', () => {
  const ambiguous = catalog.offerings.find(o => !o.curriculumCourseId && catalog.curriculum.offeringRelations.some(r => r.offeringId === o.id && r.candidateCurriculumCourseIds.length > 1)); assert.ok(ambiguous);
  const calls = [], searches = []; const row = official({ curriculumCourseId: null, curriculumMatch: 'unmatched', candidateCurriculumCourseIds: [] });
  const commonProps = { row, offerings: catalog.offerings, curriculum: catalog.curriculum, disabled: false, onChangeCourse: (...args) => calls.push(args), query: ambiguous.name, onSearch: value => searches.push(value) };
  const controls = ImportedCourseRepairControls(commonProps);
  find(controls, 'input').props.onChange({ target: { value: '経済学' } }); assert.deepEqual(searches, ['経済学']); assert.deepEqual(calls, []);
  find(controls, 'select').props.onChange({ target: { value: ambiguous.id } }); assert.equal(calls.at(-1)[1].curriculumMatch, 'ambiguous'); assert.equal(calls.at(-1)[1].curriculumCourseId, null);
  const clear = ImportedCourseRepairControls({ ...commonProps, row: official({ selectedOfferingId: correspondence.id, selectionSource: 'manual' }) });
  find(clear, 'select').props.onChange({ target: { value: '' } }); const patch = calls.at(-1)[1];
  assert.equal(patch.curriculumCourseId, economics.id); assert.equal(patch.curriculumMatch, 'exact_unique'); assert.equal(patch.selectedOfferingId, null);
});
test('import UX: orphan/duplicate/unknown/held/schooling confirmation remain visible while confirmed exclusions need no action', () => {
  const rows = [official(), official({ id: 'duplicate' }), official({ id: 'unknown', earnedCreditsTotal: null }), official({ id: 'unresolved', curriculumCourseId: null, curriculumMatch: 'unmatched' })];
  const orphan = detail({ id: 'orphan', sourceCourseId: 'absent' });
  const projection = importedAchievementManagement(rows, [orphan], catalog);
  assert.deepEqual(projection.issueRows, rows); assert.deepEqual(projection.issueRecords, [orphan]);
  const input = state({ importedCourseAchievements: [official()], importedStudyRecords: [orphan] });
  assert.match(html(input), /data-orphan-study-id="orphan"/); assert.match(html(input), /成績取込の管理で/);
  const manageProps = { records: [orphan], courseRows: [official()], offerings: catalog.offerings, disabled: false, onChange: noop, onChangeCourse: noop, onDelete: noop };
  assert.match(renderToStaticMarkup(createElement(ImportedAchievements, manageProps)), /data-import-study-id="orphan"/);
  for (const kind of ['allocation_held', 'schooling_confirmation']) {
    const notices = [{ kind, sourceRowIds: ['official-economics'], rawName: '経済学', reason: '確認' }];
    assert.equal(importedAchievementManagement([official()], [], catalog, notices).issueRows.length, 1);
  }
  assert.equal(importedAchievementManagement([official()], [], catalog, [{ kind: 'out_of_scope', sourceRowIds: ['official-economics'] }]).issueRows.length, 0);
});
test('import UX: record maintenance preserves year/term/matching/delete callbacks, source aggregates and read-only disable', () => {
  const record = detail({ method: 'correspondence' }); const calls = [], deleted = [];
  const child = ImportedStudyRecordEditor({ record, offerings: [{ ...correspondence, name: record.rawName }], disabled: false, onChange: (...args) => calls.push(args), onDelete: id => deleted.push(id) });
  const inputs = elements(child).filter(n => n.type === 'input');
  inputs[0].props.onChange({ target: { value: '2028' } }); assert.deepEqual(calls.at(-1), [record.id, { academicYear: 2028, yearSource: 'manual' }]);
  inputs[0].props.onChange({ target: { value: '' } }); assert.deepEqual(calls.at(-1), [record.id, { academicYear: null, yearSource: 'manual' }]);
  inputs[1].props.onChange({ target: { value: '後期' } }); assert.deepEqual(calls.at(-1), [record.id, { term: '後期' }]);
  find(child, 'select').props.onChange({ target: { value: correspondence.id } }); assert.deepEqual(calls.at(-1), [record.id, { offeringId: correspondence.id }]);
  const oldWindow = globalThis.window; globalThis.window = { confirm: () => true };
  try { find(child, 'button').props.onClick(); assert.deepEqual(deleted, [record.id]); } finally { globalThis.window = oldWindow; }
  const locked = ImportedStudyRecordEditor({ record, offerings: [], disabled: true, onChange: noop, onDelete: noop });
  assert.ok(elements(locked).filter(n => ['input', 'select', 'button'].includes(n.type)).every(n => n.props.disabled === true));
  assert.ok(calls.every(([, patch]) => !Object.hasOwn(patch, 'earnedCreditsTotal')));
});
test('import UX: successful apply navigates after commit to existing focusable course-list target', () => {
  const markup = html(state()); assert.match(markup, new RegExp(`id="${IMPORT_RESULT_TARGET}" tabindex="-1"`));
  const doc = globalThis.document, raf = globalThis.requestAnimationFrame; const calls = []; let frame;
  globalThis.requestAnimationFrame = callback => { frame = callback; };
  globalThis.document = { getElementById: id => { assert.equal(id, IMPORT_RESULT_TARGET); return { focus: options => calls.push(['focus', options]), scrollIntoView: options => calls.push(['scroll', options]) }; } };
  try { focusImportedCourseList(); assert.deepEqual(calls, []); frame(); assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scroll', { behavior: 'smooth', block: 'start' }]]); } finally { globalThis.document = doc; globalThis.requestAnimationFrame = raf; }
  const source = readFileSync(new URL('../src/components/planner/GradeImportPanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(onApply\(units\)\).*focusImportedCourseList\(\)/);
  assert.match(renderToStaticMarkup(createElement(GradeImportPanel, { offerings: [], plannedItems: [], existing: [], disabled: false, onApply: noop })), /id="grade-import-panel"/);
});
test('import UX: graduation notices render distinct counts, schooling explanation and neutral excluded information', () => {
  const progress = calculateGraduationProgress([], catalog, catalog.programs.find(p => !p.isCommon).scopeId);
  const notices = ['allocation_held', 'credits_unknown', 'schooling_confirmation', 'out_of_scope'].map(kind => ({ kind, sourceRowIds: [], rawName: kind, reason: kind === 'schooling_confirmation' ? '通常の卒業単位は算入済みです。' : kind }));
  const markup = renderToStaticMarkup(createElement(GraduationProgress, { progress: { ...progress, importedWarnings: notices } }));
  for (const label of ['卒業単位の算入を保留：1件', '修得単位の確認が必要：1件', 'スクーリング算入の確認が必要：1件', '卒業算入対象外（自動除外）：1件', '通常の卒業単位は算入済み']) assert.ok(markup.includes(label), label);
  assert.match(markup, /data-import-notice-kind="out_of_scope" class="[^"]*bg-slate-50/);
  assert.doesNotMatch(markup, /成績取込から自動算入しなかった実績/);
});
