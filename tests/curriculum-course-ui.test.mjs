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
import CorrespondenceStudyMethod from '../src/components/planner/CorrespondenceStudyMethod.tsx';
import { CorrespondenceDetails } from '../src/components/planner/CorrespondenceProgress.tsx';
import { GradeSelect, StatusSelect, StudyYearSelect, YearInput, TermSelect, CompletionOrderInput } from '../src/components/planner/PlannerRowControls.tsx';
import { economics, correspondence, winter, item, official, detail, communicationDetail, state } from './fixtures/curriculum-course-ui.mjs';
import { economicsGradeCells } from './fixtures/economics-grade-row.mjs';

const noop = () => {};
const props = (input, overrides = {}) => ({
  catalog, view: deriveCurriculumCourseView(input, catalog), offerings: offeringsById, classify: createCreditClassifier(catalog, input.selectedScopeId),
  publicCourses: input.publicCourses, disabled: false, onChange: noop, onRemove: noop, onChangeImportedMeta: noop,
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
  const input = state({ items: [item(correspondence)] }); const calls = []; const grades = [];
  const tree = PlannerAttemptChild({ attempt: attemptFor(input), editor: props(input, { onChange: (...args) => calls.push(args), onChangeEvaluation: (...args) => grades.push(args) }) });
  for (const [type, value, field] of [[StatusSelect, 'waiting', 'status'], [YearInput, 2028, 'plannedYear'], [StudyYearSelect, 3, 'studyYear'], [TermSelect, '冬期', 'plannedTerm'], [CompletionOrderInput, 2, 'earnedOrder']]) {
    find(tree, type).props.onChange(value); assert.deepEqual(calls.at(-1), [correspondence.id, { [field]: value }]);
  }
  elements(tree).filter(node => node.type === GradeSelect).forEach(node => node.props.onChange('A'));
  assert.ok(grades.length >= 2); assert.ok(grades.every(([id, grade]) => id === correspondence.id && grade.offeringId === id));
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
