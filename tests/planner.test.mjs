import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { catalog, offeringsById } from '../src/planner/catalog.ts';
import { manualMappingOverrideLedger, officialMappingOverrideLedger } from '../src/planner/manualMappingOverrides.ts';
import { validateCatalog, validateState } from '../src/planner/validation.ts';
import { summarizeCredits, searchOfferings } from '../src/planner/calculations.ts';
import { STORAGE_KEY, BACKUP_KEY, initialState, loadState, saveState, recoverState } from '../src/planner/storage.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { REPEATABLE_CREDIT_RULES, repeatableRule } from '../src/planner/repeatableRules.ts';
import { removePlannerItem, removePublicCourse, restorePlannerItem, restorePublicCourse } from '../src/planner/removeUndo.ts';
import { evaluatePublicCourseLimit, publicCourseLimitFor } from '../src/planner/publicCourseRules.ts';
import { createPublicCourse, isValidPublicCourseTitle, matchesPublicCourseSearch, normalizePublicCourseTitle, PUBLIC_COURSE_TITLE } from '../src/planner/publicCourses.ts';
import { eligibilityYearsLabel, filterOfferingsByYear, showSyntheticPublicCourse, yearEligibility } from '../src/planner/yearEligibility.ts';
import { stateForScopeChange, supportsThesisSelection, thesisPolicyForScope } from '../src/planner/thesisSelection.ts';
import { completedMediaLessons, isMediaSchooling, mediaPlanItems, mediaProgressSummary, mediaShareIntentUrl, mediaSharePost, mediaShareViewModel, setTotalLessons, toggleLesson } from '../src/planner/mediaSchooling.ts';
import { COURSE_GRADES, evaluationFor, evaluationItems, evaluationSummary } from '../src/planner/courseEvaluations.ts';
import { correspondenceCreditResult, progressForCorrespondence, setReportStatus } from '../src/planner/correspondenceProgress.ts';

function memoryStore(raw = null) {
  const values = new Map(raw === null ? [] : [[STORAGE_KEY, raw]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const item = (offeringId, status = 'planned') => ({ offeringId, status, plannedYear: 2026, plannedTerm: null, earnedOrder: null });
const publicCourse = (id, status = 'planned', title = `公開科目 ${id}`) => ({ id, title, status, plannedYear: 2026, plannedTerm: null, credits: 2 });
const first = catalog.offerings[0];
const rawCatalog = JSON.parse(readFileSync(new URL('../src/data/planner_catalog_2026.json', import.meta.url), 'utf8'));
const rawOfferingsById = new Map(rawCatalog.offerings.map(offering => [offering.id, offering]));

test('year eligibility uses the common mapping for a first-year offering', () => {
  const offering = catalog.offerings.find(current => current.name === '健康・スポーツ科学概論');
  const common = catalog.programs.find(program => program.isCommon).scopeId;
  assert.equal(yearEligibility(offering, common, 1, catalog), 'eligible');
  assert.equal(yearEligibility(offering, common, 4, catalog), 'eligible');
  assert.equal(eligibilityYearsLabel(offering, common, catalog), '履修可能学年: 1〜4年');
});

test('year eligibility distinguishes ineligible and eligible years through the selected scope mapping', () => {
  const offering = catalog.offerings.find(current => current.name === '債権総論');
  const law = catalog.programs.find(program => program.department === '法律学科').scopeId;
  assert.equal(yearEligibility(offering, law, 1, catalog), 'ineligible');
  assert.equal(yearEligibility(offering, law, 2, catalog), 'ineligible');
  assert.equal(yearEligibility(offering, law, 3, catalog), 'eligible');
  assert.equal(yearEligibility(offering, law, 4, catalog), 'eligible');
});

test('a selected scope can resolve mapping-only 2-to-4 year data', () => {
  const scope = catalog.programs.find(program => program.department === '商業学科').scopeId;
  const base = catalog.offerings[0];
  const fixture = {
    ...catalog,
    mappings: [{ ...catalog.mappings[0], mappingId: 'scope-map', scopeId: scope, eligibleYears: [2, 3, 4] }],
    offerings: [{ ...base, id: 'mapping-only', resolutionStatus: 'matched', eligibleYears: null, mappingIds: ['scope-map'] }],
  };
  assert.equal(yearEligibility(fixture.offerings[0], scope, 1, fixture), 'ineligible');
  assert.equal(yearEligibility(fixture.offerings[0], scope, 2, fixture), 'eligible');
  assert.equal(yearEligibility(fixture.offerings[0], scope, 3, fixture), 'eligible');
  assert.equal(yearEligibility(fixture.offerings[0], scope, 4, fixture), 'eligible');
});

test('null, conflicting, and same-scope multi-edge year data are safely unknown', () => {
  const scope = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const base = catalog.offerings[0];
  const nullFixture = { ...catalog, offerings: [{ ...base, id: 'null-years', resolutionStatus: 'matched', eligibleYears: null, mappingIds: [] }] };
  assert.equal(yearEligibility(nullFixture.offerings[0], null, 1, nullFixture), 'unknown');

  const conflictFixture = {
    ...catalog,
    mappings: [{ ...catalog.mappings[0], mappingId: 'conflict', scopeId: scope, eligibleYears: [2, 3, 4] }],
    offerings: [{ ...base, id: 'conflict-offering', resolutionStatus: 'matched', eligibleYears: [1, 2, 3, 4], mappingIds: ['conflict'] }],
  };
  assert.equal(yearEligibility(conflictFixture.offerings[0], scope, 2, conflictFixture), 'unknown');

  const multiEdgeFixture = {
    ...catalog,
    mappings: [
      { ...catalog.mappings[0], mappingId: 'edge-one', scopeId: scope, eligibleYears: [2, 3, 4] },
      { ...catalog.mappings[0], mappingId: 'edge-two', scopeId: scope, eligibleYears: [3, 4] },
    ],
    offerings: [{ ...base, id: 'multi-edge', resolutionStatus: 'matched', eligibleYears: null, mappingIds: ['edge-one', 'edge-two'] }],
  };
  assert.equal(yearEligibility(multiEdgeFixture.offerings[0], scope, 3, multiEdgeFixture), 'unknown');
});

test('manual-review and outside-scope offerings never become eligible from year data', () => {
  const base = catalog.offerings[0];
  for (const resolutionStatus of ['manual_review', 'outside_mapping_scope']) {
    const fixture = { ...catalog, offerings: [{ ...base, resolutionStatus, eligibleYears: [1, 2, 3, 4], mappingIds: [] }] };
    assert.equal(yearEligibility(fixture.offerings[0], null, 1, fixture), 'unknown');
  }
});

test('text search and year filtering are ANDed, all-years preserves results, and synthetic public courses are unknown', () => {
  const law = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const queried = searchOfferings(catalog.offerings, '債権総論');
  assert.ok(queried.length > 0);
  assert.equal(filterOfferingsByYear(queried, law, 2, false, catalog).length, 0);
  assert.equal(filterOfferingsByYear(queried, law, 3, false, catalog).length, queried.length);
  assert.deepEqual(filterOfferingsByYear(queried, law, null, false, catalog), queried);
  assert.equal(showSyntheticPublicCourse(null, false), true);
  assert.equal(showSyntheticPublicCourse(2, false), false);
  assert.equal(showSyntheticPublicCourse(2, true), true);
});

test('unknown catalog offerings appear only when the unknown toggle is enabled', () => {
  const scope = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const base = catalog.offerings[0];
  const fixture = {
    ...catalog,
    mappings: [{ ...catalog.mappings[0], mappingId: 'known-map', scopeId: scope, eligibleYears: [2, 3, 4] }],
    offerings: [
      { ...base, id: 'known', name: '検索対象', resolutionStatus: 'matched', eligibleYears: null, mappingIds: ['known-map'] },
      { ...base, id: 'unknown', name: '検索対象（保留）', resolutionStatus: 'manual_review', eligibleYears: null, mappingIds: [] },
    ],
  };
  assert.deepEqual(filterOfferingsByYear(fixture.offerings, scope, 2, false, fixture).map(offering => offering.id), ['known']);
  assert.deepEqual(filterOfferingsByYear(fixture.offerings, scope, 2, true, fixture).map(offering => offering.id), ['known', 'unknown']);
});

test('removing one planned item preserves every other item and its order', () => {
  const removedItem = { offeringId: 'second', status: 'earned', plannedYear: 2028, plannedTerm: '秋期', earnedOrder: 3 };
  const items = [item('first'), removedItem, { ...item('third'), status: 'failed', plannedYear: null }];
  const removed = removePlannerItem(items, 'second');
  assert.deepEqual(removed, { item: removedItem, index: 1 });
  assert.deepEqual(items.filter(current => current.offeringId !== 'second'), [items[0], items[2]]);
  assert.deepEqual(restorePlannerItem(items.filter(current => current.offeringId !== 'second'), removed), items);
});

test('only the latest removal is undoable and restoring never duplicates a re-added offering', () => {
  const firstRemoved = removePlannerItem([item('one'), item('two')], 'one');
  const latestRemoved = removePlannerItem([item('two')], 'two');
  assert.equal(firstRemoved.item.offeringId, 'one');
  assert.deepEqual(restorePlannerItem([], latestRemoved), [item('two')]);
  assert.equal(restorePlannerItem([item('two')], latestRemoved), null);
});

test('a removed public course restores every field at its original index', () => {
  const courses = [publicCourse('11111111-1111-4111-8111-111111111111', 'planned', '先頭'), publicCourse('22222222-2222-4222-8222-222222222222', 'earned', '法律学特講［○○］')];
  const removed = removePublicCourse(courses, courses[1].id);
  assert.deepEqual(removed, { course: courses[1], index: 1 });
  assert.deepEqual(restorePublicCourse([courses[0]], removed), courses);
  assert.equal(restorePublicCourse(courses, removed), null);
});

test('a failed removal save leaves the saved plan unchanged for a later retry', () => {
  const state = { ...initialState(), items: [item(first.id), item(catalog.offerings[1].id)] };
  const raw = JSON.stringify(state);
  const store = { getItem: () => raw, setItem() { throw new Error('quota'); } };
  const removed = removePlannerItem(state.items, first.id);
  assert.throws(() => saveState(store, { ...state, items: state.items.filter(current => current.offeringId !== first.id) }, raw, catalog), /quota/);
  assert.deepEqual(loadState(store, catalog).state, state);
  assert.deepEqual(removed, { item: state.items[0], index: 0 });
});

test('catalog preserves all 686 offerings, 348 null course IDs and incomplete graduation coverage', () => {
  assert.equal(catalog.offerings.length, 686);
  assert.equal(catalog.offerings.filter(o => o.courseId === null).length, 348);
  assert.equal(catalog.metadata.graduationCheckComplete, false);
  assert.equal(validateCatalog({ ...catalog, metadata: { ...catalog.metadata, graduationCheckComplete: true } }), false);
});

test('public course is a search-only synthetic result, not a catalog offering', () => {
  assert.equal(matchesPublicCourseSearch('公開科目'), true);
  assert.equal(matchesPublicCourseSearch('公開'), true);
  assert.equal(matchesPublicCourseSearch('政治学'), false);
  assert.equal(matchesPublicCourseSearch(''), false);
  assert.equal(catalog.offerings.length, 686);
  assert.equal(catalog.offerings.some(offering => offering.name === PUBLIC_COURSE_TITLE), false);
});

test('a public course can be added repeatedly with the agreed initial values', () => {
  const firstPublic = createPublicCourse('11111111-1111-4111-8111-111111111111');
  const secondPublic = createPublicCourse('22222222-2222-4222-8222-222222222222');
  assert.deepEqual(firstPublic, { id: firstPublic.id, title: '公開科目', status: 'planned', plannedYear: 2026, plannedTerm: null, credits: 2 });
  assert.equal([firstPublic, secondPublic].length, 2);
});

test('public course names are saved as real names and reject an empty title', () => {
  assert.equal(normalizePublicCourseTitle(' 法律学特講［○○］ '), '法律学特講［○○］');
  assert.equal(isValidPublicCourseTitle('法律学特講［○○］'), true);
  assert.equal(isValidPublicCourseTitle(''), false);
  assert.equal(isValidPublicCourseTitle('a'.repeat(201)), false);
});

test('2026 public-course limits are eight courses and sixteen credits for every documented department', () => {
  for (const department of ['日本文学科', '史学科', '地理学科', '法律学科', '経済学科', '商業学科']) {
    const scope = catalog.programs.find(program => program.department === department).scopeId;
    assert.deepEqual(publicCourseLimitFor(catalog, scope), { maxCredits: 16, maxCourses: 8, sourcePage: {
      日本文学科: 48, 史学科: 53, 地理学科: 55, 法律学科: 47, 経済学科: 57, 商業学科: 59,
    }[department] });
  }
});

test('public-course cap counts explicit earned records only and excludes a ninth course', () => {
  const progress = evaluatePublicCourseLimit([
    ...Array.from({ length: 9 }, (_, index) => publicCourse(`00000000-0000-4000-8000-00000000000${index}`, 'earned')),
    publicCourse('10000000-0000-4000-8000-000000000000', 'planned'), publicCourse('20000000-0000-4000-8000-000000000000', 'in_progress'),
    publicCourse('30000000-0000-4000-8000-000000000000', 'waiting'), publicCourse('40000000-0000-4000-8000-000000000000', 'failed'), publicCourse('50000000-0000-4000-8000-000000000000', 'dropped'),
  ], { maxCredits: 16, maxCourses: 8, sourcePage: 1 });
  assert.deepEqual(progress, {
    earnedCredits: 18, countedCredits: 16, earnedCourses: 9, countedCourses: 8,
    inProgressCredits: 2, plannedCredits: 2, excludedCredits: 2,
    limit: { maxCredits: 16, maxCourses: 8, sourcePage: 1 },
  });
});

test('explicit public courses have a calculable cap card and feed counted credits into professional elective', () => {
  const scope = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const courses = Array.from({ length: 9 }, (_, index) => publicCourse(`60000000-0000-4000-8000-00000000000${index}`, 'earned'));
  const progress = calculateGraduationProgress([], catalog, scope, courses);
  const card = progress.cards.find(row => row.ruleType === 'public_course_limit');
  assert.equal(card.status, 'satisfied');
  assert.equal(card.target, 16);
  assert.equal(card.publicCourse.excludedCredits, 2);
  assert.equal(progress.cards.find(row => row.requirementId === 'professional-law-elective').earned, 16);
});

test('partial graduation progress uses earned only and includes common plus selected scope', () => {
  const scope = catalog.programs.find(program => !program.isCommon).scopeId;
  const common = catalog.programs.find(program => program.isCommon).scopeId;
  const baseMapping = catalog.mappings[0];
  const baseOffering = catalog.offerings[0];
  const requirements = [
    { id: 'common-rule', ruleId: 'common-rule', scopeId: common, sourcePage: 1, status: 'structured', ruleType: 'min_credits', target: { curriculum_category: '一般教育' }, value: 4, unit: 'credits', conditions: null },
    { id: 'selected-rule', ruleId: 'selected-rule', scopeId: scope, sourcePage: 1, status: 'structured', ruleType: 'min_credits', target: { curriculum_category: '専門教育' }, value: 4, unit: 'credits', conditions: null },
  ];
  const fixture = {
    ...catalog,
    mappings: [
      { ...baseMapping, mappingId: 'common-map', scopeId: common, category: '一般教育', field: '人文', requirementType: null },
      { ...baseMapping, mappingId: 'selected-map', scopeId: scope, category: '専門教育', field: null, requirementType: null },
    ],
    offerings: [
      { ...baseOffering, id: 'earned-common', credits: 4, resolutionStatus: 'matched', mappingIds: ['common-map'] },
      { ...baseOffering, id: 'planned-selected', credits: 4, resolutionStatus: 'matched', mappingIds: ['selected-map'] },
      { ...baseOffering, id: 'progress-selected', credits: 2, resolutionStatus: 'matched', mappingIds: ['selected-map'] },
    ],
    requirements,
  };
  const progress = calculateGraduationProgress([
    item('earned-common', 'earned'), item('planned-selected', 'planned'), item('progress-selected', 'in_progress'),
  ], fixture, scope);
  assert.equal(progress.graduationCheckComplete, false);
  assert.deepEqual(progress.requirements.map(row => ({ id: row.requirementId, status: row.status, earned: row.earned, inProgress: row.inProgress, planned: row.planned })), [
    { id: 'common-rule', status: 'satisfied', earned: 4, inProgress: 0, planned: 0 },
    { id: 'selected-rule', status: 'unsatisfied', earned: 0, inProgress: 2, planned: 4 },
  ]);
});

test('partial progress treats null credits, unsupported and special conditions as unknown', () => {
  const scope = catalog.programs.find(program => !program.isCommon).scopeId;
  const baseMapping = { ...catalog.mappings[0], mappingId: 'map', scopeId: scope, category: '専門教育', field: null, requirementType: null };
  const fixture = {
    ...catalog,
    mappings: [baseMapping],
    offerings: [{ ...catalog.offerings[0], id: 'null-credit', credits: null, resolutionStatus: 'matched', mappingIds: ['map'] }],
    requirements: [
      { id: 'null-rule', ruleId: 'null-rule', scopeId: scope, sourcePage: 1, status: 'structured', ruleType: 'min_credits', target: { curriculum_category: '専門教育' }, value: 4, unit: 'credits', conditions: null },
      { id: 'special-rule', ruleId: 'special-rule', scopeId: scope, sourcePage: 1, status: 'structured', ruleType: 'min_credits', target: { curriculum_category: '専門教育' }, value: 4, unit: 'credits', conditions: { when: { thesis_selected: true } } },
      { id: 'overflow-rule', ruleId: 'overflow-rule', scopeId: scope, sourcePage: 1, status: 'structured', ruleType: 'overflow_credit_transfer', target: { curriculum_category: '専門教育' }, value: null, unit: null, conditions: null },
      { id: 'unsupported-rule', ruleId: 'unsupported-rule', scopeId: null, scopeLabel: '全体', category: null, reason: '未対応', sourcePage: 1, status: 'unsupported', ruleType: null, target: null, value: null, unit: null, conditions: null },
    ],
  };
  const progress = calculateGraduationProgress([item('null-credit', 'earned')], fixture, scope);
  assert.equal(progress.evaluableCount, 0);
  assert.equal(progress.unknownCount, 4);
  assert.ok(progress.requirements.every(row => row.status === 'unknown'));
});

test('structured course-count conditions require completed curriculum courses and never turn null-value guidance into credits', () => {
  const scope = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const base = catalog.mappings[0];
  const fixture = {
    ...catalog,
    mappings: [
      { ...base, mappingId: 'first-course', scopeId: scope, category: '専門教育', field: null, requirementType: '選択必修', curriculumCredits: 4 },
      { ...base, mappingId: 'second-course', scopeId: scope, category: '専門教育', field: null, requirementType: '選択必修', curriculumCredits: 4 },
    ],
    offerings: [
      { ...catalog.offerings[0], id: 'first-part', credits: 2, resolutionStatus: 'matched', mappingIds: ['first-course'] },
      { ...catalog.offerings[0], id: 'first-rest', credits: 2, resolutionStatus: 'matched', mappingIds: ['first-course'] },
      { ...catalog.offerings[0], id: 'second', credits: 4, resolutionStatus: 'matched', mappingIds: ['second-course'] },
    ],
    requirements: [
      { id: 'eight-credits-two-courses', ruleId: 'eight-credits-two-courses', scopeId: scope, sourcePage: 47, status: 'structured', ruleType: 'min_credits', target: { curriculum_category: '専門教育', requirement_type: '選択必修' }, value: 8, unit: 'credits', conditions: { full_course_credits_required: true, min_courses: 2 } },
      { id: 'guidance', ruleId: 'guidance', scopeId: scope, sourcePage: 47, status: 'structured', ruleType: 'required_course', target: { course_name: '卒業論文一般指導' }, value: null, unit: null, conditions: { before: '卒業論文' } },
    ],
  };
  const evaluate = items => calculateGraduationProgress(items, fixture, scope).requirements;
  assert.deepEqual(evaluate([item('first-part', 'earned'), item('second', 'earned')]).map(row => row.status), ['unsatisfied', 'unknown']);
  const completed = evaluate([item('first-part', 'earned'), item('first-rest', 'earned'), item('second', 'earned')]);
  assert.equal(completed[0].status, 'satisfied');
  assert.equal(completed[0].earned, 8);
  assert.equal(completed[1].earned, null);
  assert.match(completed[1].reason, /条件または例外|必要値/);
});

test('one offering with duplicate matching mappings is counted once and outside-scope offerings are excluded', () => {
  const scope = catalog.programs.find(program => !program.isCommon).scopeId;
  const base = catalog.mappings[0];
  const fixture = {
    ...catalog,
    mappings: [
      { ...base, mappingId: 'map-a', scopeId: scope, category: '専門教育', field: null, requirementType: null },
      { ...base, mappingId: 'map-b', scopeId: scope, category: '専門教育', field: null, requirementType: null },
    ],
    offerings: [
      { ...catalog.offerings[0], id: 'duplicate-edge', credits: 4, resolutionStatus: 'matched', mappingIds: ['map-a', 'map-b'] },
      { ...catalog.offerings[0], id: 'teacher', credits: 4, resolutionStatus: 'outside_mapping_scope', mappingIds: [] },
    ],
    requirements: [{ id: 'rule', ruleId: 'rule', scopeId: scope, sourcePage: 1, status: 'structured', ruleType: 'min_credits', target: { curriculum_category: '専門教育' }, value: 8, unit: 'credits', conditions: null }],
  };
  const row = calculateGraduationProgress([item('duplicate-edge', 'earned'), item('teacher', 'earned')], fixture, scope).requirements[0];
  assert.equal(row.earned, 4);
  assert.equal(row.status, 'unsatisfied');
});

test('graduation progress copy never asserts graduation eligibility', () => {
  const source = [
    readFileSync(new URL('../src/pages/PlannerPage.tsx', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/components/planner/GraduationProgress.tsx', import.meta.url), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(source, /卒業できます|卒業可能|卒業不可/);
  assert.match(source, /卒業可否を保証しません/);
});

test('grouped requirements use earned credits, one language, and one mapped offering', () => {
  const scope = catalog.programs.find(program => !program.isCommon).scopeId;
  const common = catalog.programs.find(program => program.isCommon).scopeId;
  const base = catalog.mappings[0];
  const maps = [
    ['human', '一般教育', '人文'], ['other', '一般教育', 'その他'],
    ['physical', '保健体育', null], ['english', '外国語', '英語'],
    ['english-duplicate', '外国語', '英語'], ['german', '外国語', '独語'],
  ].map(([mappingId, category, field]) => ({ ...base, mappingId, scopeId: common, category, field }));
  const offering = (id, name, credits, method, mappingIds) => ({ ...catalog.offerings[0], id, name, credits, method, mappingIds, resolutionStatus: 'matched' });
  const fixture = { ...catalog, mappings: maps, offerings: [
    offering('literature', '文学', 4, 'correspondence', ['human']),
    offering('general-other', 'その他科目', 28, 'correspondence', ['other']),
    offering('health', '健康・スポーツ科学概論', 2, 'correspondence', ['physical']),
    offering('sport', 'スポーツ総合演習（春期）', 2, 'schooling', ['physical']),
    offering('english2', '英語2', 2, 'correspondence', ['english', 'english-duplicate']),
    offering('englishS1', '英語S［1］', 1, 'schooling', ['english']),
    offering('englishS2', '英語S［2］', 1, 'schooling', ['english']),
    offering('german2', '独語2', 2, 'correspondence', ['german']),
    offering('germanS', '独語S', 2, 'schooling', ['german']),
  ] };
  const card = (items, id) => calculateGraduationProgress(items, fixture, scope).cards.find(row => row.requirementId === `group-${id}`);
  const empty = calculateGraduationProgress([], fixture, scope);
  assert.equal(empty.graduationCheckComplete, false);
  assert.deepEqual(['general', 'foreign', 'physical'].map(id => card([], id).status), ['unsatisfied', 'unsatisfied', 'unsatisfied']);
  assert.deepEqual(['general', 'foreign', 'physical'].map(id => card([], id).earned), [0, 0, 0]);
  assert.ok(empty.cards.every(row => row.ruleType !== 'max_credits'));
  for (const [status, key] of [['planned', 'planned'], ['in_progress', 'inProgress'], ['earned', 'earned']]) {
    const general = card([item('literature', status)], 'general');
    assert.equal(general[key], 4);
    assert.equal(general.details[0][key], 4);
    assert.equal(general.status, 'unsatisfied');
    const foreign = card([item('english2', status)], 'foreign');
    assert.equal(foreign[key], 2);
    assert.equal(foreign.details[0][key], 2);
    assert.equal(foreign.status, 'unsatisfied');
    const physical = card([item('health', status)], 'physical');
    assert.equal(physical.status, status === 'earned' ? 'satisfied' : 'unsatisfied');
  }
  for (const status of ['waiting', 'failed', 'dropped']) {
    const general = card([item('literature', status)], 'general');
    assert.deepEqual(
      { earned: general.earned, inProgress: general.inProgress, planned: general.planned, status: general.status },
      { earned: 0, inProgress: 0, planned: 0, status: 'unsatisfied' },
    );
  }
  assert.equal(card([item('sport', 'earned')], 'physical').status, 'satisfied');
  assert.equal(card([item('literature', 'earned'), item('general-other', 'earned')], 'general').status, 'unsatisfied');
  assert.equal(card([item('english2', 'earned'), item('englishS1', 'earned'), item('englishS2', 'earned')], 'foreign').status, 'satisfied');
  assert.equal(card([item('english2', 'earned'), item('german2', 'earned')], 'foreign').details[0].schooling, 0);
  assert.equal(card([item('english2', 'earned'), item('german2', 'earned')], 'foreign').status, 'unsatisfied');
  assert.equal(card([item('english2', 'earned'), item('german2', 'earned'), item('germanS', 'earned')], 'foreign').earned, 4);
  assert.equal(card([item('english2', 'earned'), item('englishS1', 'earned'), item('englishS2', 'earned'), item('german2', 'earned'), item('germanS', 'earned')], 'foreign').earned, 4);
});

test('real catalog groups literature, English 2 and curated English S', () => {
  const scope = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const find = name => catalog.offerings.find(offering => offering.name === name && offering.resolutionStatus === 'matched');
  const literature = find('文学');
  const english = find('英語２');
  const englishS = catalog.offerings.filter(offering => offering.name.startsWith('英語Ｓ［') && offering.credits === 1 && offering.resolutionStatus === 'matched').slice(0, 2);
  assert.ok(literature && english && englishS.length === 2);
  const progress = calculateGraduationProgress([
    item(literature.id, 'earned'), item(english.id, 'earned'), ...englishS.map(offering => item(offering.id, 'earned')),
  ], catalog, scope);
  assert.equal(progress.cards.filter(row => row.label === '一般教育').length, 1);
  assert.equal(progress.cards.filter(row => row.label === '外国語').length, 1);
  assert.equal(progress.cards.filter(row => row.label === '保健体育').length, 1);
  assert.equal(progress.cards.find(row => row.label === '一般教育').details[0].earned, 4);
  assert.equal(progress.cards.find(row => row.label === '外国語').status, 'satisfied');
  assert.ok(progress.cards.every(row => row.ruleType !== 'max_credits'));
  assert.equal(progress.graduationCheckComplete, false);
});

test('search spans every offering and each specified field, normalizes full-width input', () => {
  assert.equal(searchOfferings(catalog.offerings, '').length, 686);
  for (const offering of catalog.offerings) {
    for (const field of ['name', 'subjectCode', 'classCode', 'deliveryCategory', 'period']) {
      if (offering[field]) assert.ok(searchOfferings(catalog.offerings, offering[field]).some(o => o.id === offering.id));
    }
  }
  assert.equal(searchOfferings([{ ...first, subjectCode: 'ABC123' }], 'ａｂｃ１２３').length, 1);
});

test('all six statuses round-trip, including null course identity', () => {
  const offering = catalog.offerings.find(o => o.courseId === null);
  const store = memoryStore();
  let expected = null;
  for (const status of ['planned', 'in_progress', 'waiting', 'earned', 'failed', 'dropped']) {
    const state = { ...initialState(), items: [item(offering.id, status)] };
    expected = saveState(store, state, expected, catalog);
    assert.deepEqual(loadState(store, catalog).state, state);
  }
});

test('invalid JSON, schema version, references, duplicate items and invalid fields remain intact', () => {
  const valid = { ...initialState(), items: [item(first.id)] };
  const invalid = [
    '{broken', JSON.stringify({ ...valid, schemaVersion: 8 }),
    JSON.stringify({ ...valid, items: [item('missing')] }),
    JSON.stringify({ ...valid, items: [item(first.id), item(first.id)] }),
    JSON.stringify({ ...valid, selectedScopeId: 'missing' }),
    JSON.stringify({ ...valid, items: [{ ...item(first.id), status: 'invalid' }] }),
    JSON.stringify({ ...valid, items: [{ ...item(first.id), plannedYear: '2026' }] }),
    JSON.stringify({ ...valid, todos: null }),
    JSON.stringify({ ...valid, publicCourses: [publicCourse('70000000-0000-4000-8000-000000000000', 'earned', '   ')] }),
    JSON.stringify({ ...valid, publicCourses: [{ ...publicCourse('80000000-0000-4000-8000-000000000000'), title: ' a ' }] }),
    JSON.stringify({ ...valid, publicCourses: [{ ...publicCourse('90000000-0000-4000-8000-000000000000'), credits: 4 }] }),
  ];
  for (const raw of invalid) {
    const store = memoryStore(raw);
    const result = loadState(store, catalog);
    assert.ok(result.error);
    assert.equal(result.raw, raw);
    assert.equal(store.getItem(STORAGE_KEY), raw);
    assert.deepEqual(result.state, initialState());
  }
});

test('public courses remain actual earned professional credits beyond the graduation cap', () => {
  const scope = catalog.programs.find(program => program.department === '商業学科').scopeId;
  const courses = Array.from({ length: 9 }, (_, index) => publicCourse(`a0000000-0000-4000-8000-00000000000${index}`, 'earned'));
  const professional = summarizeCategories([], catalog, scope, courses).find(row => row.category === '専門教育');
  assert.equal(professional.count, 9);
  assert.equal(professional.earned, 18);
});

test('credit totals exclude waiting/failed/dropped, unknown count covers all statuses', () => {
  const statuses = ['earned', 'in_progress', 'planned', 'waiting', 'failed', 'dropped'];
  const offerings = new Map();
  const items = [];
  for (const [index, status] of statuses.entries()) {
    offerings.set(`known-${index}`, { ...first, credits: 4 });
    offerings.set(`unknown-${index}`, { ...first, credits: null });
    items.push(item(`known-${index}`, status), item(`unknown-${index}`, status));
  }
  assert.deepEqual(summarizeCredits(items, offerings), { earned: 4, in_progress: 4, planned: 4, unknownCreditItems: 6 });
  assert.throws(() => summarizeCredits([item('missing')], offeringsById));
});

test('read denial and write quota errors cannot erase prior data', () => {
  assert.ok(loadState({ getItem() { throw new Error('denied'); } }, catalog).error);
  const raw = JSON.stringify(initialState());
  const store = { getItem: () => raw, setItem() { throw new Error('quota'); } };
  assert.throws(() => saveState(store, initialState(), raw, catalog), /quota/);
  assert.throws(() => recoverState(store, raw, catalog), /quota/);
  assert.equal(store.getItem(STORAGE_KEY), raw);
});

test('recovery backs up exact original bytes; stale writes and recovery are rejected', () => {
  const raw = '  {invalid';
  const store = memoryStore(raw);
  recoverState(store, raw, catalog);
  assert.equal(store.getItem(BACKUP_KEY), raw);
  assert.deepEqual(loadState(store, catalog).state, initialState());
  assert.throws(() => saveState(store, initialState(), raw, catalog));
  assert.throws(() => recoverState(store, raw, catalog));
  assert.equal(store.getItem(BACKUP_KEY), raw);
});

test('existing scope and todos survive state changes without adding todo UI', () => {
  const state = { ...initialState(), selectedScopeId: catalog.programs[0].scopeId,
    todos: [{ id: first.id, offeringId: first.id, text: '保持する', done: false }], items: [item(first.id)] };
  assert.equal(validateState(state, catalog), true);
  const store = memoryStore();
  saveState(store, state, null, catalog);
  assert.deepEqual(loadState(store, catalog).state, state);
  assert.equal(validateState({ ...state, todos: [state.todos[0], state.todos[0]] }, catalog), false);
});

const { selectablePrograms, termOptions, groupAnnualPlan, createCreditClassifier, summarizeCategories } = await import('../src/planner/annualPlan.ts');

test('all eight affiliations round-trip with year, catalog term, legacy term and todos', () => {
  assert.equal(selectablePrograms(catalog).length, 8);
  assert.ok(selectablePrograms(catalog).every(p => !p.isCommon));
  for (const program of selectablePrograms(catalog)) {
    for (const plannedTerm of [null, '', '以前の自由入力', ...termOptions(catalog.offerings)]) {
      const state = { ...initialState(), selectedScopeId: program.scopeId, items: [{ ...item(first.id), plannedYear: 2027, plannedTerm }], todos: [{ id: first.id, offeringId: null, text: '既存todo', done: true }] };
      const raw = JSON.stringify(state);
      const store = memoryStore(raw);
      const loaded = loadState(store, catalog);
      assert.equal(loaded.error, null);
      const changed = { ...loaded.state, items: [{ ...loaded.state.items[0], status: 'earned' }] };
      saveState(store, changed, loaded.raw, catalog);
      assert.deepEqual(loadState(store, catalog).state, changed);
    }
  }
});

test('annual grouping respects years and exact delivery data without interpreting legacy terms', () => {
  const offerings = new Map([
    ['a', { ...first, id: 'a', courseId: null, method: 'correspondence', deliveryCategory: null }],
    ['b', { ...first, id: 'b', method: 'schooling', deliveryCategory: '前期メディア' }],
    ['c', { ...first, id: 'c', method: 'schooling', deliveryCategory: null, period: null }],
  ]);
  const items = [{ ...item('c'), plannedYear: null, plannedTerm: '夏期にしたい' }, { ...item('b'), plannedYear: 2027 }, item('a')];
  const groups = groupAnnualPlan(items, offerings);
  assert.deepEqual(groups.map(g => g.year), [2026, 2027, null]);
  assert.deepEqual(groups.map(g => g.groups[0].label), ['通信学習', '前期メディア', '未分類']);
  assert.equal(groups.flatMap(g => g.groups.flatMap(x => x.items)).length, 3);
  assert.throws(() => groupAnnualPlan([item('missing')], offerings));
});

test('classification uses exact common/selected mappings; unresolved, conflicting and other-scope mappings remain unknown', () => {
  const scope = selectablePrograms(catalog)[0].scopeId;
  const common = catalog.programs.find(p => p.isCommon).scopeId;
  const base = catalog.mappings[0];
  const mappings = [
    { ...base, mappingId: 'human', scopeId: common, category: '一般教育', field: '人文' },
    { ...base, mappingId: 'human2', scopeId: common, category: '一般教育', field: '人文' },
    { ...base, mappingId: 'special', scopeId: scope, category: '専門教育' },
    { ...base, mappingId: 'other', scopeId: 'other', category: '専門教育' },
    { ...base, mappingId: 'unknown', scopeId: common, category: '一般教育', field: 'その他' },
  ];
  const fixture = { ...catalog, mappings };
  const classify = createCreditClassifier(fixture, scope);
  const offering = { ...first, courseId: null, resolutionStatus: 'matched', mappingIds: ['human', 'human2'] };
  assert.equal(classify(offering), '一般教育：人文');
  assert.equal(classify({ ...offering, mappingIds: ['special', 'other'] }), '専門教育');
  for (const mappingIds of [[], ['human', 'special'], ['human', 'unknown']]) {
    assert.equal(classify({ ...offering, mappingIds }), '対応情報を確認中');
  }
  assert.equal(classify({ ...offering, resolutionStatus: 'manual_review' }), '対応情報を確認中');
  assert.equal(classify({ ...offering, resolutionStatus: 'outside_mapping_scope' }), '教職等・通常カリキュラム対象外');
  assert.equal(classify({ ...offering, mappingIds: ['other'] }), '選択した所属のカリキュラム対象外');
  assert.equal(classify({ ...offering, mappingIds: ['unknown'] }), '一般教育：その他');
  assert.equal(createCreditClassifier(fixture, null)(offering), '所属を選択すると区分を表示');
  assert.equal(createCreditClassifier(fixture, common)(offering), '所属を選択すると区分を表示');
});

test('category totals conserve overall credits and unknown counts across every offering/status and scope', () => {
  const statuses = ['earned', 'in_progress', 'planned', 'waiting', 'failed', 'dropped'];
  const items = catalog.offerings.map((o, index) => item(o.id, statuses[index % statuses.length]));
  const total = summarizeCredits(items, offeringsById);
  for (const program of selectablePrograms(catalog)) {
    const rows = summarizeCategories(items, catalog, program.scopeId);
    for (const key of ['earned', 'in_progress', 'planned', 'unknownCreditItems']) {
      assert.equal(rows.reduce((sum, row) => sum + row[key], 0), total[key]);
    }
    assert.equal(rows.reduce((sum, row) => sum + row.count, 0), 686);
    assert.equal(rows.find(r => r.category === '教職等・通常カリキュラム対象外').count, 30);
    assert.ok(rows.find(r => r.category === '対応情報を確認中').count >= 8);
  }
});

test('catalog and manual-curated foreign-language mappings count for all eight affiliations', () => {
  const foreignMappings = catalog.mappings.filter(m => m.category === '外国語');
  assert.equal(foreignMappings.length, 7);
  assert.deepEqual([...new Set(foreignMappings.map(m => m.field))].sort(), ['仏語', '独語', '英語']);
  const commonScopes = new Set(catalog.programs.filter(p => p.isCommon).map(p => p.scopeId));
  assert.ok(foreignMappings.every(m => commonScopes.has(m.scopeId)));
  const ids = new Set(foreignMappings.map(m => m.mappingId));
  const offerings = catalog.offerings.filter(o => o.mappingIds.some(id => ids.has(id)));
  assert.equal(offerings.length, 41);
  assert.ok(offerings.some(o => o.name === '英語２'));
  assert.ok(offerings.some(o => o.name === '仏語S(後期メディア)'));
  for (const { scopeId } of selectablePrograms(catalog)) {
    const classify = createCreditClassifier(catalog, scopeId);
    for (const offering of offerings) {
      assert.equal(classify(offering), '外国語', `${scopeId}: ${offering.name}`);
    }
    const items = offerings.map(o => item(o.id));
    const rows = summarizeCategories(items, catalog, scopeId);
    assert.deepEqual(rows.find(r => r.category === '外国語'), {
      category: '外国語', count: 41, ...summarizeCredits(items, offeringsById),
    });
    assert.equal(rows.find(r => r.category === '対応情報を確認中').count, 0);
  }
});

test('matching common and selected scope mappings count each offering once for all common categories', () => {
  const scope = selectablePrograms(catalog)[0].scopeId;
  const commonScopes = new Set(catalog.programs.filter(p => p.isCommon).map(p => p.scopeId));
  for (const category of ['一般教育：人文', '一般教育：社会', '一般教育：自然', '外国語', '保健体育']) {
    const classify = createCreditClassifier(catalog, scope);
    const offering = catalog.offerings.find(o => classify(o) === category && o.credits !== null);
    assert.ok(offering, category);
    const commonMapping = catalog.mappings.find(m => offering.mappingIds.includes(m.mappingId) && commonScopes.has(m.scopeId));
    assert.ok(commonMapping);
    const selectedMapping = { ...commonMapping, mappingId: 'selected-copy', scopeId: scope };
    const fixture = {
      ...catalog,
      mappings: [...catalog.mappings, selectedMapping],
      offerings: [{ ...offering, mappingIds: [...offering.mappingIds, selectedMapping.mappingId] }],
    };
    for (const status of ['planned', 'in_progress', 'earned']) {
      const rows = summarizeCategories([item(offering.id, status)], fixture, scope);
      assert.equal(rows.find(r => r.category === category)[status], offering.credits);
      assert.equal(rows.find(r => r.category === category).count, 1);
      assert.equal(rows.reduce((sum, r) => sum + r[status], 0), offering.credits);
      assert.equal(rows.reduce((sum, r) => sum + r.count, 0), 1);
    }
  }
});

test('manual curated ledger resolves only the 53 approved offerings and preserves source identity', () => {
  assert.equal(manualMappingOverrideLedger.provenance, 'manual_curated');
  assert.equal(manualMappingOverrideLedger.officialVerified, false);
  const curatedIds = manualMappingOverrideLedger.overrides.flatMap(entry => entry.offeringIds);
  assert.equal(curatedIds.length, 53);
  assert.equal(new Set(curatedIds).size, 53);
  assert.equal(rawCatalog.offerings.filter(o => o.resolutionStatus !== 'matched').length, 93);
  assert.equal(catalog.offerings.filter(o => o.resolutionStatus !== 'matched').length, 38);
  assert.equal(catalog.metadata.unresolvedOfferingCount, 38);
  assert.equal(catalog.metadata.catalogCoverage.matchedOfferingCount, 648);
  assert.equal(catalog.metadata.catalogCoverage.manualReviewOfferingCount, 8);
  assert.equal(catalog.metadata.catalogCoverage.outsideMappingScopeOfferingCount, 30);
  assert.equal(catalog.metadata.catalogCoverage.mappingEdgeCount, 1230);
  for (const entry of manualMappingOverrideLedger.overrides) {
    for (const offeringId of entry.offeringIds) {
      const raw = rawOfferingsById.get(offeringId);
      const patched = offeringsById.get(offeringId);
      assert.equal(raw.resolutionStatus, 'manual_review');
      assert.deepEqual(raw.mappingIds, []);
      assert.equal(patched.name, raw.name);
      assert.equal(patched.courseId, raw.courseId);
      assert.equal(patched.classCode, raw.classCode);
      assert.equal(patched.subjectCode, raw.subjectCode);
      assert.equal(patched.resolutionStatus, 'matched');
      assert.deepEqual(patched.mappingIds, entry.mappingIds);
    }
  }
  for (const raw of rawCatalog.offerings.filter(o => o.resolutionStatus === 'matched')) {
    assert.deepEqual(offeringsById.get(raw.id), raw, raw.id);
  }
});

test('all 26 numbered English S offerings classify as foreign language, including class 21005', () => {
  const entry = manualMappingOverrideLedger.overrides.find(item => item.ruleId === 'english_s_numbered_classes');
  assert.equal(entry.offeringIds.length, 26);
  for (const { scopeId } of selectablePrograms(catalog)) {
    const classify = createCreditClassifier(catalog, scopeId);
    for (const offeringId of entry.offeringIds) {
      assert.equal(classify(offeringsById.get(offeringId)), '外国語');
    }
  }
  const offering = offeringsById.get('066427dc-1df4-47bd-a6b1-538ab161e869');
  assert.equal(offering.name, '英語Ｓ［５］（秋期スクーリング）');
  assert.equal(offering.classCode, '21005');
  assert.equal(createCreditClassifier(catalog, selectablePrograms(catalog)[0].scopeId)(offering), '外国語');
});

test('history [S] overrides retain every candidate mapping and classify only in their proper scopes', () => {
  const historyScope = catalog.programs.find(p => p.displayName === '文学部 / 史学科').scopeId;
  const geographyScope = catalog.programs.find(p => p.displayName === '文学部 / 地理学科').scopeId;
  const overviewRules = manualMappingOverrideLedger.overrides.filter(entry => entry.ruleId.includes('history_overview'));
  assert.equal(overviewRules.length, 3);
  for (const entry of overviewRules) {
    assert.equal(entry.offeringIds.length, 2);
    assert.equal(entry.mappingIds.length, 3);
    for (const offeringId of entry.offeringIds) {
      const offering = offeringsById.get(offeringId);
      assert.equal(createCreditClassifier(catalog, historyScope)(offering), '専門教育');
      assert.equal(createCreditClassifier(catalog, geographyScope)(offering), '専門教育');
      for (const program of selectablePrograms(catalog).filter(p => ![historyScope, geographyScope].includes(p.scopeId))) {
        assert.equal(createCreditClassifier(catalog, program.scopeId)(offering), '選択した所属のカリキュラム対象外');
      }
    }
  }
  const geographyRule = manualMappingOverrideLedger.overrides.find(entry => entry.ruleId === 'regional_geography_special_schooling_marker');
  for (const offeringId of geographyRule.offeringIds) {
    const offering = offeringsById.get(offeringId);
    assert.equal(createCreditClassifier(catalog, geographyScope)(offering), '専門教育');
    for (const program of selectablePrograms(catalog).filter(p => p.scopeId !== geographyScope)) {
      assert.equal(createCreditClassifier(catalog, program.scopeId)(offering), '選択した所属のカリキュラム対象外');
    }
  }
});

test('information and computer offerings preserve distinct names while only history seminars stay unresolved', () => {
  const information = catalog.offerings.filter(o => /^(情報学入門|コンピュータ入門)［[1-6]］［(表計算|データ演習|データベース)］/.test(o.name));
  assert.equal(information.length, 16);
  assert.ok(information.every(o => o.resolutionStatus === 'matched' && o.mappingIds.length > 0));
  assert.ok(information.every(o => rawOfferingsById.get(o.id).name === o.name));

  const held = catalog.offerings.filter(o => /^史学演習（(日本|西洋|東洋)）/.test(o.name));
  assert.equal(held.length, 8);
  assert.ok(held.every(o => o.resolutionStatus === 'manual_review' && o.mappingIds.length === 0));
});


test('outside selected scope is a reference row and never contributes to normal curriculum categories', async () => {
  const { isCreditCategory } = await import('../src/planner/annualPlan.ts');
  const scope = selectablePrograms(catalog)[0].scopeId;
  const classify = createCreditClassifier(catalog, scope);
  const offering = catalog.offerings.find(o => classify(o) === '選択した所属のカリキュラム対象外' && o.credits > 0);
  assert.ok(offering);
  const rows = summarizeCategories([item(offering.id, 'earned')], catalog, scope);
  assert.equal(rows.filter(row => isCreditCategory(row.category)).reduce((sum, row) => sum + row.earned, 0), 0);
  assert.equal(rows.find(row => row.category === classify(offering)).earned, offering.credits);
});

test('general education other is a normal category even with a null course identity', () => {
  const scope = selectablePrograms(catalog)[0].scopeId;
  const classify = createCreditClassifier(catalog, scope);
  const offering = catalog.offerings.find(o => classify(o) === '一般教育：その他');
  assert.ok(offering);
  assert.equal(classify({ ...offering, courseId: null }), '一般教育：その他');
  const rows = summarizeCategories([item(offering.id)], catalog, scope);
  assert.equal(rows.find(row => row.category === '一般教育：その他').count, 1);
  assert.equal(rows.find(row => row.category === '対応情報を確認中').count, 0);
});

test('outside mapping and manual review keep distinct labels and remain saveable', () => {
  for (const [status, label, count] of [
    ['outside_mapping_scope', '教職等・通常カリキュラム対象外', 30],
    ['manual_review', '対応情報を確認中', 8],
  ]) {
    const offerings = catalog.offerings.filter(o => o.resolutionStatus === status);
    assert.equal(offerings.length, count);
    for (const scope of [null, ...selectablePrograms(catalog).map(p => p.scopeId)]) {
      const classify = createCreditClassifier(catalog, scope);
      assert.ok(offerings.every(o => classify(o) === label));
      const state = { ...initialState(), selectedScopeId: scope, items: offerings.map(o => item(o.id)) };
      const store = memoryStore();
      saveState(store, state, null, catalog);
      assert.deepEqual(loadState(store, catalog).state, state);
    }
  }
});

// Freeze the pre-cleanup ledger so extending it cannot silently rewrite its 34 offerings.
const beforeCleanupLedger = JSON.parse(readFileSync(new URL('./fixtures/planner-manual-overrides-before-cleanup.json', import.meta.url), 'utf8'));
const cleanupAudit = JSON.parse(readFileSync(new URL('../docs/planner-mapping-cleanup-audit-2026.json', import.meta.url), 'utf8'));
const beforeOverrides = new Map(beforeCleanupLedger.overrides.flatMap(entry => entry.offeringIds.map(id => [id, entry.mappingIds])));
const beforeCleanupCatalog = {
  ...rawCatalog,
  offerings: rawCatalog.offerings.map(o => beforeOverrides.has(o.id)
    ? { ...o, resolutionStatus: 'matched', mappingIds: beforeOverrides.get(o.id) } : o),
};

test('cleanup preserves every field and UI classification of all 627 previously matched offerings', () => {
  assert.deepEqual(manualMappingOverrideLedger.overrides.slice(0, beforeCleanupLedger.overrides.length), beforeCleanupLedger.overrides);
  assert.equal(beforeOverrides.size, 34);
  const matched = beforeCleanupCatalog.offerings.filter(o => o.resolutionStatus === 'matched');
  assert.equal(matched.length, 627);
  for (const offering of matched) assert.deepEqual(offeringsById.get(offering.id), offering);
  for (const scope of [null, ...selectablePrograms(catalog).map(p => p.scopeId)]) {
    const before = createCreditClassifier(beforeCleanupCatalog, scope);
    const after = createCreditClassifier(catalog, scope);
    for (const offering of matched) assert.equal(after(offeringsById.get(offering.id)), before(offering));
  }
  const outside = rawCatalog.offerings.filter(o => o.resolutionStatus === 'outside_mapping_scope');
  assert.equal(outside.length, 30);
  for (const offering of outside) assert.deepEqual(offeringsById.get(offering.id), offering);
});

const cleanupCatalog = { ...catalog, offerings: catalog.offerings.map(o =>
  (officialMappingOverrideLedger.overrides.some(entry => entry.offeringIds.includes(o.id)) || o.classCode === '35009')
    ? rawOfferingsById.get(o.id) : o) };
const cleanupOfferingsById = new Map(cleanupCatalog.offerings.map(o => [o.id, o]));

test('audit covers exactly the 29 remaining offerings, and only the 18 safe decisions enter the ledger', () => {
  const expected = beforeCleanupCatalog.offerings.filter(o => o.resolutionStatus === 'manual_review');
  assert.equal(expected.length, 29);
  assert.deepEqual(cleanupAudit.offerings.map(o => o.offeringId).sort(), expected.map(o => o.id).sort());
  const added = manualMappingOverrideLedger.overrides.slice(beforeCleanupLedger.overrides.length)
    .filter(entry => entry.ruleId.startsWith('cleanup_2026_'));
  assert.equal(added.length, 18);
  assert.ok(added.every(entry => entry.offeringIds.length === 1));
  const safe = cleanupAudit.offerings.filter(o => o.proposedDecision === 'safe_manual_curated');
  const held = cleanupAudit.offerings.filter(o => o.proposedDecision === 'remain_manual_review');
  assert.equal(safe.length, 18);
  assert.equal(held.length, 11);
  assert.deepEqual(added.flatMap(e => e.offeringIds).sort(), safe.map(o => o.offeringId).sort());
  const mappingIds = new Set(catalog.mappings.map(m => m.mappingId));
  for (const row of cleanupAudit.offerings) {
    const raw = rawOfferingsById.get(row.offeringId);
    assert.equal(row.courseName, raw.name);
    assert.equal(row.classCode, raw.classCode);
    assert.equal(row.subjectCode, raw.subjectCode);
    assert.equal(row.currentResolutionStatus, 'manual_review');
    assert.deepEqual(row.currentMappingIds, []);
    assert.equal(row.currentUiClassification, '対応情報を確認中');
    assert.ok(row.reason.length > 0 && row.evidenceType.length > 0 && row.evidence.length > 0);
    assert.equal(row.officialVerified, false);
    assert.ok(row.candidateMappings.every(m => mappingIds.has(m.mappingId)));
    assert.equal(row.selectedCommonScopeRelation.bySelectedScope.length, 8);
    for (const relation of row.selectedCommonScopeRelation.bySelectedScope) {
      assert.equal(createCreditClassifier(beforeCleanupCatalog, relation.selectedScopeId)(raw), relation.currentUiClassification);
      assert.equal(createCreditClassifier(cleanupCatalog, relation.selectedScopeId)(cleanupOfferingsById.get(raw.id)), relation.proposedUiClassification);
    }
    if (row.proposedDecision === 'safe_manual_curated') {
      assert.deepEqual(cleanupOfferingsById.get(row.offeringId).mappingIds, row.proposedMappingTargets);
      assert.deepEqual(row.proposedMappingTargets, row.candidateMappings.map(m => m.mappingId));
    } else {
      assert.deepEqual(row.proposedMappingTargets, []);
      assert.deepEqual(cleanupOfferingsById.get(row.offeringId), raw);
    }
  }
});

test('all 686 offering identities survive cleanup; same content labels with different classes remain separate saved items', () => {
  assert.equal(new Set(catalog.offerings.map(o => o.id)).size, 686);
  for (const raw of rawCatalog.offerings) {
    const { resolutionStatus: rawStatus, mappingIds: rawMappings, ...rawIdentity } = raw;
    const { resolutionStatus: status, mappingIds, ...identity } = offeringsById.get(raw.id);
    assert.ok(rawStatus && status && rawMappings && mappingIds);
    assert.deepEqual(identity, rawIdentity);
  }
  const information = catalog.offerings.filter(o => /^(情報学入門|コンピュータ入門)［/.test(o.name));
  assert.equal(information.length, 16);
  assert.equal(new Set(information.map(o => o.id)).size, 16);
  assert.equal(new Set(information.map(o => o.classCode)).size, 16);
  assert.ok(information.every(o => o.courseId === null));
  for (const label of ['表計算', 'データ演習', 'データベース']) {
    const sameLabel = information.filter(o => o.name.includes(`［${label}］`));
    assert.ok(sameLabel.length > 1);
    assert.equal(new Set(sameLabel.map(o => o.classCode)).size, sameLabel.length);
  }
  const state = { ...initialState(), items: information.map(o => item(o.id)) };
  const store = memoryStore();
  saveState(store, state, null, catalog);
  assert.deepEqual(loadState(store, catalog).state, state);
  assert.equal(summarizeCredits(state.items, offeringsById).planned, 32);
});

test('information retains all seven professional scopes and computer only economics, without a common mapping', () => {
  const economics = '3641eb3c-91bd-4094-a56e-6e0f0da660f5';
  const informationIds = [
    'ee06b350-5b46-4398-aff8-c187161defba', '1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d',
    'cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2', '431409fd-5e1e-4272-aa03-36e0e5a27968',
    '4eec8986-f2ec-4b6c-9292-3ee4dcd078f0', '5736899c-eb14-4e2a-8328-f482291833ca',
    'eae25b18-9c9f-410e-84fa-907103fdc9af',
  ];
  for (const [prefix, expectedIds, count] of [
    ['情報学入門［', informationIds, 8],
    ['コンピュータ入門［', ['b9f5f378-0985-40ad-918e-32f6f6ae5818'], 8],
  ]) {
    const offerings = catalog.offerings.filter(o => o.name.startsWith(prefix));
    assert.equal(offerings.length, count);
    for (const offering of offerings) {
      assert.deepEqual(offering.mappingIds, expectedIds);
      for (const program of selectablePrograms(catalog)) {
        const included = prefix.startsWith('情報') ? program.scopeId !== economics : program.scopeId === economics;
        assert.equal(createCreditClassifier(catalog, program.scopeId)(offering), included ? '専門教育' : '選択した所属のカリキュラム対象外');
      }
    }
  }
});

test('historical materials use the single grouped mapping while seminar sequence remains held and 35009 stays geography-only', () => {
  const materials = catalog.offerings.filter(o => /^歴史資料学（日本(近代|近世)）/.test(o.name));
  assert.equal(materials.length, 2);
  const expectedId = 'e50dd61e-27ef-4e93-afe7-9c61624661b7';
  const mapping = catalog.mappings.find(m => m.mappingId === expectedId);
  assert.equal(mapping.scopeId, '118c5183-6aec-4fa1-905a-265f25d86db1');
  assert.equal(mapping.category, '専門教育');
  assert.equal(mapping.field, null);
  assert.equal(mapping.requirementType, '選択');
  for (const offering of materials) assert.deepEqual(offering.mappingIds, [expectedId]);
  const held = catalog.offerings.filter(o => o.resolutionStatus === 'manual_review');
  assert.equal(held.filter(o => o.name.startsWith('史学演習')).length, 8);
  assert.equal(held.filter(o => o.name.startsWith('日本史特講（日本仏教史）（地理）')).length, 0);
  assert.equal(held.filter(o => o.name.startsWith('【教職】政治学')).length, 0);
  assert.ok(held.every(o => o.mappingIds.length === 0));
  const geographyScope = '4d450b06-fb99-4bf2-a769-fe5f68dd337a';
  const historyScope = '118c5183-6aec-4fa1-905a-265f25d86db1';
  const buddhism = catalog.offerings.find(o => o.classCode === '35009');
  assert.deepEqual(buddhism.mappingIds, ['540bd399-8d5a-4133-adf7-2668b266b2e1']);
  assert.equal(createCreditClassifier(catalog, geographyScope)(buddhism), '専門教育');
  assert.equal(createCreditClassifier(catalog, historyScope)(buddhism), '選択した所属のカリキュラム対象外');
});

test('history seminars use recorded completion order, never offering order, and cap graduation credits at four completions', () => {
  const scope = '118c5183-6aec-4fa1-905a-265f25d86db1';
  const seminars = catalog.offerings.filter(o => /^史学演習（(日本|西洋|東洋)）/.test(o.name));
  const card = (items, id) => calculateGraduationProgress(items, catalog, scope).cards.find(row => row.requirementId === id);
  const required = 'history-seminar-required-elective';
  const elective = 'history-seminar-elective';
  const earned = (count) => seminars.slice(0, count).map((offering, index) => ({ ...item(offering.id, 'earned'), earnedOrder: index < 4 ? index + 1 : null }));

  assert.deepEqual([card(earned(1), required).earned, card(earned(1), elective).earned], [2, 0]);
  assert.deepEqual([card(earned(2), required).earned, card(earned(2), elective).earned], [4, 0]);
  assert.deepEqual([card(earned(3), required).earned, card(earned(3), elective).earned], [4, 2]);
  assert.deepEqual([card(earned(4), required).earned, card(earned(4), elective).earned], [4, 4]);
  assert.deepEqual([card(earned(5), required).earned, card(earned(5), elective).earned], [4, 4]);

  const pending = [{ ...item(seminars[0].id, 'planned'), earnedOrder: null }, { ...item(seminars[1].id, 'in_progress'), earnedOrder: null }];
  assert.deepEqual([card(pending, required).earned, card(pending, elective).earned], [0, 0]);
  assert.equal(card(pending, required).status, 'unsatisfied');
  const unknown = [{ ...item(seminars[0].id, 'earned'), earnedOrder: null }];
  assert.equal(card(unknown, required).status, 'unknown');
  assert.match(card(unknown, required).reason, /修得順が未確定/);
});

test('history seminar completion order is unique, consecutive, earned-only, and prior state versions migrate without inference', () => {
  const seminars = catalog.offerings.filter(o => /^史学演習（/.test(o.name));
  const state = { ...initialState(), items: [
    { ...item(seminars[0].id, 'earned'), earnedOrder: 1 },
    { ...item(seminars[1].id, 'earned'), earnedOrder: 2 },
  ] };
  assert.equal(validateState(state, catalog), true);
  assert.equal(validateState({ ...state, items: [{ ...state.items[0], earnedOrder: 2 }, state.items[1]] }, catalog), false);
  assert.equal(validateState({ ...state, items: [{ ...state.items[0], earnedOrder: 1 }, { ...state.items[1], earnedOrder: 3 }] }, catalog), false);
  assert.equal(validateState({ ...state, items: [{ ...state.items[0], status: 'planned' }] }, catalog), false);
  const v1 = { schemaVersion: 1, selectedScopeId: null, items: [{ offeringId: seminars[0].id, status: 'earned', plannedYear: 2026, plannedTerm: null }], todos: [] };
  const store = memoryStore(JSON.stringify(v1));
  const loaded = loadState(store, catalog);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.schemaVersion, 7);
  assert.equal(loaded.state.items[0].earnedOrder, null);
  assert.deepEqual(loaded.state.publicCourses, []);
  assert.equal(store.getItem(STORAGE_KEY), JSON.stringify(v1));
  const v2 = { ...loaded.state, schemaVersion: 2 };
  delete v2.publicCourses;
  const v2Loaded = loadState(memoryStore(JSON.stringify(v2)), catalog);
  assert.equal(v2Loaded.error, null);
  assert.equal(v2Loaded.state.schemaVersion, 7);
  assert.deepEqual(v2Loaded.state.publicCourses, []);
});

test('v3 state migrates through v6 without losing saved planner data, and validation permits only thesis choices', () => {
  const current = { ...initialState(), selectedScopeId: catalog.programs[0].scopeId, items: [item(first.id)], publicCourses: [publicCourse('11111111-1111-4111-8111-111111111111')], todos: [{ id: first.id, offeringId: null, text: '保持', done: false }] };
  const v3 = { ...current, schemaVersion: 3 };
  delete v3.thesisSelection;
  const loaded = loadState(memoryStore(JSON.stringify(v3)), catalog);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.schemaVersion, 7);
  assert.equal(loaded.state.thesisSelection, 'undecided');
  assert.deepEqual({ items: loaded.state.items, publicCourses: loaded.state.publicCourses, todos: loaded.state.todos, selectedScopeId: loaded.state.selectedScopeId }, { items: current.items, publicCourses: current.publicCourses, todos: current.todos, selectedScopeId: current.selectedScopeId });
  assert.equal(validateState({ ...current, thesisSelection: 'selected' }, catalog), true);
  assert.equal(validateState({ ...current, thesisSelection: 'not_selected' }, catalog), true);
  assert.equal(validateState({ ...current, thesisSelection: 'maybe' }, catalog), false);
});

test('media schooling uses structured method and delivery category, not course names', () => {
  const media = catalog.offerings.find(isMediaSchooling);
  const nonMedia = catalog.offerings.find(offering => !isMediaSchooling(offering));
  assert.ok(media);
  assert.equal(media.method, 'schooling');
  assert.match(media.deliveryCategory, /^(前期|後期)メディア$/);
  assert.equal(isMediaSchooling({ ...media, name: '別名', deliveryCategory: '夏期' }), false);
  assert.equal(isMediaSchooling(nonMedia), false);
  assert.deepEqual(mediaPlanItems([item(media.id), item(nonMedia.id)], offeringsById).map(entry => entry.offeringId), [media.id]);
});

test('media progress stores independent toggles, calculates rate, safely limits shrinking, and survives plan removal/re-add', () => {
  const media = catalog.offerings.find(isMediaSchooling);
  let course = { offeringId: media.id, totalLessons: null, lessons: [] };
  course = setTotalLessons(course, 3);
  course = toggleLesson(course, 1, 'videoCompleted');
  course = toggleLesson(course, 1, 'testCompleted');
  assert.deepEqual(mediaProgressSummary(course), { video: 1, test: 1, percent: 33 });
  assert.equal(setTotalLessons(course, 0), null);
  assert.equal(setTotalLessons(course, null).totalLessons, null);
  assert.equal(setTotalLessons(course, 0), null);
  assert.equal(setTotalLessons({ ...course, lessons: [...course.lessons, { lesson: 3, videoCompleted: true, testCompleted: false }] }, 2), null);
  const state = { ...initialState(), items: [item(media.id)], mediaSchoolingProgress: { [media.id]: course } };
  assert.equal(validateState(state, catalog), true);
  assert.deepEqual(mediaPlanItems([], offeringsById), []);
  assert.equal(state.mediaSchoolingProgress[media.id].lessons[0].videoCompleted, true);
});

test('media share view model groups current media plan items, preserves order, and omits orphan/non-media data', () => {
  const media = catalog.offerings.filter(isMediaSchooling);
  const firstTerm = media.find(offering => offering.deliveryCategory === '前期メディア');
  const secondTerm = media.find(offering => offering.deliveryCategory === '後期メディア');
  const nonMedia = catalog.offerings.find(offering => !isMediaSchooling(offering));
  const items = [item(secondTerm.id), item(nonMedia.id), item(firstTerm.id)];
  const progress = {
    [secondTerm.id]: { offeringId: secondTerm.id, totalLessons: 3, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }, { lesson: 2, videoCompleted: true, testCompleted: true }, { lesson: 3, videoCompleted: true, testCompleted: false }] },
    [firstTerm.id]: { offeringId: firstTerm.id, totalLessons: 2, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: true }, { lesson: 2, videoCompleted: true, testCompleted: true }] },
    orphan: { offeringId: 'orphan', totalLessons: 99, lessons: [] },
  };
  assert.equal(completedMediaLessons(progress[firstTerm.id]), 2);
  const groups = mediaShareViewModel(items, offeringsById, progress);
  assert.deepEqual(groups.map(group => group.deliveryCategory), ['前期メディア', '後期メディア']);
  assert.deepEqual(groups.map(group => group.courses.map(course => course.name)), [[firstTerm.name], [secondTerm.name]]);
  assert.deepEqual(groups.map(group => [group.totalVideoCompleted, group.totalTestCompleted, group.totalLessons, group.courses[0].videoDone, group.courses[0].testDone]), [[2, 2, 2, true, true], [3, 1, 3, true, false]]);
  const post = mediaSharePost(groups, 'あと少し');
  assert.match(post, /前期メディア進捗/);
  assert.ok(post.includes(`・${firstTerm.name}  動画 2/2 ✅・テスト 2/2 ✅`));
  assert.match(post, /動画トータル  3\/3/);
  assert.match(post, /テストトータル  1\/3/);
  assert.match(post, /\n\nあと少し$/);
  assert.doesNotMatch(post, /orphan|#法政通信/);
  assert.equal(mediaShareIntentUrl(post), `https://x.com/intent/post?text=${encodeURIComponent(post)}`);
});

test('media share does not invent a category denominator when any course has no lesson total', () => {
  const media = catalog.offerings.filter(isMediaSchooling).filter(offering => offering.deliveryCategory === '前期メディア').slice(0, 2);
  const groups = mediaShareViewModel(media.map(offering => item(offering.id)), offeringsById, {
    [media[0].id]: { offeringId: media[0].id, totalLessons: 3, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }] },
    [media[1].id]: { offeringId: media[1].id, totalLessons: null, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }] },
  });
  assert.equal(groups[0].totalLessons, null);
  const post = mediaSharePost(groups);
  assert.ok(post.includes(`・${media[1].name}  動画 1回・テスト 0回（全回数未設定）`));
  assert.match(post, /全回数未設定の科目あり/);
  assert.doesNotMatch(post, /トータル  2\/3/);
});

test('media share keeps video and test completion states independent in each course', () => {
  const media = catalog.offerings.filter(isMediaSchooling).find(offering => offering.deliveryCategory === '後期メディア');
  const groups = mediaShareViewModel([item(media.id)], offeringsById, {
    [media.id]: { offeringId: media.id, totalLessons: 2, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: true }, { lesson: 2, videoCompleted: false, testCompleted: true }] },
  });
  const [course] = groups[0].courses;
  assert.deepEqual(course, { name: media.name, videoCompletedCount: 1, testCompletedCount: 2, totalLessons: 2, videoDone: false, testDone: true });
  assert.match(mediaSharePost(groups), new RegExp(`動画 1/2・テスト 2/2 ✅`));
  assert.equal(groups[0].totalVideoCompleted, 1);
  assert.equal(groups[0].totalTestCompleted, 2);
});

test('media share preserves both completion counts without denominators for unconfigured courses', () => {
  const media = catalog.offerings.filter(isMediaSchooling).find(offering => offering.deliveryCategory === '前期メディア');
  const groups = mediaShareViewModel([item(media.id)], offeringsById, {
    [media.id]: { offeringId: media.id, totalLessons: null, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: true }, { lesson: 2, videoCompleted: true, testCompleted: false }] },
  });
  const post = mediaSharePost(groups);
  assert.ok(post.includes(`・${media.name}  動画 2回・テスト 1回（全回数未設定）`));
  assert.doesNotMatch(post, /動画 2\/|テスト 1\//);
});

test('v4 migration adds empty media progress without losing items, public courses, thesis choice, or earned order', () => {
  const media = catalog.offerings.find(isMediaSchooling);
  const saved = { ...initialState(), schemaVersion: 4, selectedScopeId: catalog.programs[0].scopeId, thesisSelection: 'selected', items: [{ ...item(media.id, 'earned'), earnedOrder: null }], publicCourses: [publicCourse('22222222-2222-4222-8222-222222222222')], todos: [{ id: media.id, offeringId: media.id, text: '保持', done: false }] };
  delete saved.mediaSchoolingProgress;
  const loaded = loadState(memoryStore(JSON.stringify(saved)), catalog);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.schemaVersion, 7);
  assert.deepEqual(loaded.state.mediaSchoolingProgress, {});
  assert.deepEqual({ items: loaded.state.items, publicCourses: loaded.state.publicCourses, thesisSelection: loaded.state.thesisSelection, todos: loaded.state.todos, selectedScopeId: loaded.state.selectedScopeId }, { items: saved.items, publicCourses: saved.publicCourses, thesisSelection: saved.thesisSelection, todos: saved.todos, selectedScopeId: saved.selectedScopeId });
  assert.deepEqual(calculateGraduationProgress(loaded.state.items, catalog, loaded.state.selectedScopeId, loaded.state.publicCourses, loaded.state.thesisSelection), calculateGraduationProgress(saved.items, catalog, saved.selectedScopeId, saved.publicCourses, saved.thesisSelection));
});

test('course evaluations accept all eleven grades, null, and reject invalid values', () => {
  assert.deepEqual(COURSE_GRADES, ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D']);
  for (const grade of COURSE_GRADES) {
    const state = { ...initialState(), courseEvaluations: { [first.id]: { offeringId: first.id, reportGrade: grade, schoolingGrade: null } } };
    assert.equal(validateState(state, catalog), true);
  }
  assert.equal(validateState({ ...initialState(), courseEvaluations: { [first.id]: { offeringId: first.id, reportGrade: 'F', schoolingGrade: null } } }, catalog), false);
  assert.equal(validateState({ ...initialState(), courseEvaluations: { [first.id]: { offeringId: first.id, reportGrade: null, schoolingGrade: null } } }, catalog), true);
});

test('v5 migration preserves planner and media data while adding empty evaluations', () => {
  const media = catalog.offerings.find(isMediaSchooling);
  const mediaSchoolingProgress = { [media.id]: { offeringId: media.id, totalLessons: 2, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: true }] } };
  const saved = { ...initialState(), schemaVersion: 5, selectedScopeId: catalog.programs[0].scopeId, thesisSelection: 'selected', items: [{ ...item(media.id, 'earned'), earnedOrder: null }], publicCourses: [publicCourse('33333333-3333-4333-8333-333333333333')], todos: [{ id: media.id, offeringId: media.id, text: '保持', done: false }], mediaSchoolingProgress };
  delete saved.courseEvaluations;
  const loaded = loadState(memoryStore(JSON.stringify(saved)), catalog);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.schemaVersion, 7);
  assert.deepEqual(loaded.state.courseEvaluations, {});
  assert.deepEqual(loaded.state.mediaSchoolingProgress, mediaSchoolingProgress);
  assert.deepEqual({ items: loaded.state.items, publicCourses: loaded.state.publicCourses, thesisSelection: loaded.state.thesisSelection, todos: loaded.state.todos, selectedScopeId: loaded.state.selectedScopeId }, { items: saved.items, publicCourses: saved.publicCourses, thesisSelection: saved.thesisSelection, todos: saved.todos, selectedScopeId: saved.selectedScopeId });
});

test('course evaluations follow current annual plan, preserve orphans for safe re-add, and never change status or graduation progress', () => {
  const media = catalog.offerings.find(isMediaSchooling);
  const nonMedia = catalog.offerings.find(offering => offering.method === 'correspondence');
  const evaluations = {
    [media.id]: { offeringId: media.id, reportGrade: 'A+', schoolingGrade: 'B-' },
    [nonMedia.id]: { offeringId: nonMedia.id, reportGrade: 'D', schoolingGrade: null },
  };
  const items = [{ ...item(media.id, 'planned'), plannedYear: 2027 }, item(nonMedia.id, 'earned')];
  assert.deepEqual(evaluationItems(items, offeringsById).map(entry => entry.offeringId), [media.id, nonMedia.id]);
  assert.deepEqual(evaluationSummary(items, evaluations), { reportsEntered: 2, schoolingsEntered: 1, total: 2 });
  assert.deepEqual(evaluationItems(items.filter(entry => entry.offeringId !== media.id), offeringsById).map(entry => entry.offeringId), [nonMedia.id]);
  assert.deepEqual(evaluationFor(media.id, evaluations), evaluations[media.id]);
  assert.equal(items[0].status, 'planned');
  assert.equal(items[1].status, 'earned');
  const before = calculateGraduationProgress(items, catalog, null, [], 'undecided');
  const after = calculateGraduationProgress(items, catalog, null, [], 'undecided');
  assert.deepEqual(after, before);
});

test('law thesis selection safely switches catalog targets without showing both branches', () => {
  const law = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const dependent = ruleId => calculateGraduationProgress([], catalog, law, [], 'undecided').requirements.find(row => row.requirementId === catalog.requirements.find(rule => rule.ruleId === ruleId).id);
  assert.match(dependent('law_elective_with_thesis_min_credits').reason, /卒論有無が未定/);
  assert.match(dependent('law_elective_without_thesis_min_credits').reason, /卒論有無が未定/);
  for (const [selection, elective, total, present, absent] of [['selected', 50, 82, 'law_elective_with_thesis_min_credits', 'law_elective_without_thesis_min_credits'], ['not_selected', 54, 86, 'law_elective_without_thesis_min_credits', 'law_elective_with_thesis_min_credits']]) {
    const progress = calculateGraduationProgress([], catalog, law, [], selection);
    assert.equal(progress.cards.find(row => row.requirementId === 'professional-law-elective').target, elective);
    assert.equal(progress.cards.find(row => row.requirementId === 'professional-law-total').target, total);
    assert.equal(progress.requirements.filter(row => row.requirementId === catalog.requirements.find(rule => rule.ruleId === present).id).length, 1);
    assert.equal(progress.requirements.filter(row => row.requirementId === catalog.requirements.find(rule => rule.ruleId === absent).id).length, 0);
    assert.equal(progress.graduationCheckComplete, false);
  }
});

test('thesis policy distinguishes optional, required, and unknown scopes; only optional exposes a choice', () => {
  const law = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const literature = catalog.programs.find(program => program.department === '日本文学科' && program.course === '文学コース').scopeId;
  const commerce = catalog.programs.find(program => program.department === '商業学科').scopeId;
  assert.equal(thesisPolicyForScope(catalog, law), 'optional');
  assert.equal(thesisPolicyForScope(catalog, literature), 'required');
  assert.equal(thesisPolicyForScope(catalog, commerce), 'unknown');
  assert.equal(supportsThesisSelection(catalog, law), true);
  assert.equal(supportsThesisSelection(catalog, literature), false);
  assert.equal(supportsThesisSelection(catalog, commerce), false);
  const state = { ...initialState(), selectedScopeId: law, thesisSelection: 'selected', items: [item(first.id)] };
  assert.deepEqual(stateForScopeChange(state, commerce), { ...state, selectedScopeId: commerce, thesisSelection: 'undecided' });
});

test('required thesis has an 8-credit card, keeps unsupported guidance unknown, and does not double count professional categories', () => {
  const literature = catalog.programs.find(program => program.department === '日本文学科' && program.course === '文学コース').scopeId;
  const empty = calculateGraduationProgress([], catalog, literature);
  const thesisCard = empty.cards.find(row => row.label === '卒業論文');
  assert.equal(thesisCard.target, 8);
  assert.equal(thesisCard.status, 'unknown');
  assert.match(thesisCard.reason, /mapping/);
  const guidance = empty.requirements.find(row => row.label === '卒業論文第1次指導');
  assert.equal(guidance.status, 'unknown');
  assert.match(guidance.reason, /条件または例外/);

  const mapping = catalog.mappings.find(current => current.scopeId === literature && current.category === '専門教育' && current.requirementType === '必修');
  const offering = { ...catalog.offerings[0], id: 'required-thesis-fixture', name: '卒業論文', credits: 8, resolutionStatus: 'matched', mappingIds: [mapping.mappingId] };
  const fixture = { ...catalog, offerings: [...catalog.offerings, offering] };
  const progress = calculateGraduationProgress([item(offering.id, 'earned')], fixture, literature);
  assert.equal(progress.cards.find(row => row.label === '卒業論文').status, 'satisfied');
  assert.equal(progress.cards.find(row => row.label === '卒業論文').earned, 8);
  assert.equal(progress.cards.find(row => row.requirementId === 'professional-required').earned, 0);
  assert.equal(progress.graduationCheckComplete, false);
});

test('cleanup coverage and audit before/after counts reconcile independently', () => {
  const before = beforeCleanupCatalog.offerings;
  const after = cleanupCatalog.offerings;
  assert.equal(before.filter(o => o.resolutionStatus !== 'matched').length, 59);
  assert.equal(after.filter(o => o.resolutionStatus !== 'matched').length, 41);
  assert.equal(catalog.metadata.unresolvedOfferingCount, 38);
  assert.equal(after.filter(o => o.resolutionStatus === 'manual_review').length, 11);
  assert.equal(after.filter(o => o.resolutionStatus === 'matched').length, 645);
  assert.equal(after.reduce((n, o) => n + o.mappingIds.length, 0), 1227);
  assert.deepEqual(cleanupAudit.summary, {
    audited: 29, newlyResolved: 18, manualReviewBefore: 29, manualReviewAfter: 11, remainManualReview: 11,
    unresolvedBefore: 59, unresolvedAfter: 41, outsideMappingScopeBefore: 30, outsideMappingScopeAfter: 30,
    matchedBefore: 627, matchedAfter: 645, manualCuratedBefore: 34, manualCuratedAfter: 52,
    mappingEdgesBefore: 1161, mappingEdgesAfter: 1227,
  });
});


test('official political science mappings count only for law and preserve earned-only progress', () => {
  const ledger = officialMappingOverrideLedger;
  assert.equal(ledger.provenance, 'official_source_verified');
  assert.equal(ledger.officialVerified, true);
  assert.equal(ledger.overrides.flatMap(e => e.offeringIds).length, 2);
  assert.ok(ledger.overrides.every(e => e.evidence.length > 0));
  const lawScope = 'e31201f3-4f1d-432a-906e-6af94af294c9';
  const political = catalog.offerings.filter(o => ['33003', '43006'].includes(o.classCode));
  assert.equal(political.length, 2);
  for (const offering of political) {
    assert.equal(offering.resolutionStatus, 'matched');
    assert.equal(offering.credits, 2);
    assert.deepEqual(offering.mappingIds, ['f49de1e6-82ae-4b86-8c0a-453ef41995ce']);
    const { resolutionStatus, mappingIds, ...identity } = offering;
    assert.ok(resolutionStatus && mappingIds);
    const { resolutionStatus: rawStatus, mappingIds: rawIds, ...rawIdentity } = rawOfferingsById.get(offering.id);
    assert.ok(rawStatus && rawIds);
    assert.deepEqual(identity, rawIdentity);
    for (const program of selectablePrograms(catalog)) {
      const law = program.scopeId === lawScope;
      assert.equal(createCreditClassifier(catalog, program.scopeId)(offering), law ? '専門教育' : '選択した所属のカリキュラム対象外');
      const empty = calculateGraduationProgress([], catalog, program.scopeId);
      for (const status of ['earned', 'planned', 'in_progress']) {
        const progress = calculateGraduationProgress([item(offering.id, status)], catalog, program.scopeId);
        assert.equal(progress.graduationCheckComplete, false);
        if (!law) assert.deepEqual(progress, empty);
        else {
          const actual = progress.requirements.filter(r => r.label.startsWith('専門教育'));
          assert.ok(actual.length > 0);
          // The 8-course / 32-credit condition is now evaluated as a completed
          // curriculum-course count. Other law conditions remain deliberately held.
          assert.ok(actual.some(r => r.status === 'unsatisfied'));
          assert.ok(actual.some(r => r.status === 'unknown'));
          const summary = summarizeCategories([item(offering.id, status)], catalog, lawScope).find(r => r.category === '専門教育');
          assert.equal(summary.earned, status === 'earned' ? 2 : 0);
          // Isolate mapping eligibility from the intentionally unsupported law DSL conditions.
          const fixture = { ...catalog, requirements: [{ id: 'law-category', ruleId: 'law-category',
            scopeId: lawScope, sourcePage: 46, status: 'structured', ruleType: 'min_credits',
            target: { curriculum_category: '専門教育', requirement_type: '選択' }, value: 54, unit: 'credits', conditions: null }] };
          const row = calculateGraduationProgress([item(offering.id, status)], fixture, lawScope).requirements[0];
          assert.equal(row.earned, status === 'earned' ? 2 : 0);
          assert.equal(row.planned, status === 'planned' ? 2 : 0);
          assert.equal(row.inProgress, status === 'in_progress' ? 2 : 0);
          assert.equal(row.status, 'unsatisfied');
        }
      }
    }
  }
  assert.equal(catalog.metadata.catalogCoverage.manualReviewOfferingCount, 8);
  assert.deepEqual(catalog.offerings.filter(o => o.resolutionStatus === 'manual_review').map(o => o.classCode).sort(),
    ['15005', '25003', '25004', '35002', '35003', '35007', '35015', '45006']);
  assert.equal(catalog.metadata.catalogCoverage.outsideMappingScopeOfferingCount, 30);
  assert.equal(catalog.metadata.catalogCoverage.mappingEdgeCount, 1230);
  assert.equal(validateCatalog(catalog), true);
});

function professionalFixture(department, mappingRows, offeringRows) {
  const program = catalog.programs.find(p => p.department === department);
  const baseMap = catalog.mappings[0];
  const baseOffering = catalog.offerings[0];
  return {
    scope: program.scopeId,
    catalog: {
      ...catalog,
      mappings: mappingRows.map(row => {
        const [mappingId, requirementType, field = null, curriculumCredits] = row;
        const inferredCredits = Math.max(...offeringRows.filter(([, , mappingIds]) => mappingIds.includes(mappingId)).map(([, credits]) => credits));
        return {
          ...baseMap, mappingId, scopeId: program.scopeId, category: '専門教育', requirementType, field,
          curriculumCredits: row.length > 3 ? curriculumCredits : inferredCredits,
        };
      }),
      offerings: offeringRows.map(([id, credits, mappingIds, method = 'correspondence']) => ({
        ...baseOffering, id, name: id, credits, method, resolutionStatus: 'matched', mappingIds,
      })),
      // Professional cards read the official overflow definition rather than
      // copying a department threshold into the fixture.
      requirements: catalog.requirements.filter(requirement => requirement.status === 'structured'
        && requirement.scopeId === program.scopeId
        && (requirement.ruleType === 'overflow_credit_transfer'
          || (requirement.ruleType === 'min_credits'
            && requirement.target.curriculum_category === '専門教育'
            && requirement.target.requirement_type === '選択必修'))).map(requirement => ({
        ...requirement,
        conditions: structuredClone(requirement.conditions),
      })),
    },
  };
}

test('Japanese literature transfers only required-elective excess and ignores planned/in-progress for completion', () => {
  const fixture = professionalFixture('日本文学科', [
    ['required', '必修'], ['elective', '選択'], ...[1, 2, 3, 4, 5, 6, 7].map(n => [`re-${n}`, '選択必修']),
  ], [
    ['required-20', 20, ['required']], ...[1, 2, 3, 4, 5, 6, 7].map(n => [`re-${n}`, 4, [`re-${n}`]]),
  ]);
  const card = (items, id) => calculateGraduationProgress(items, fixture.catalog, fixture.scope).cards.find(row => row.requirementId === id);
  for (const [count, excess] of [[5, 0], [6, 4], [7, 8]]) {
    const items = [item('required-20', 'earned'), ...Array.from({ length: count }, (_, i) => item(`re-${i + 1}`, 'earned'))];
    assert.equal(card(items, 'professional-required-elective').status, 'satisfied');
    assert.equal(card(items, 'professional-elective').earned, excess);
  }
  const referenceOnly = [...Array.from({ length: 7 }, (_, i) => item(`re-${i + 1}`, i < 3 ? 'planned' : 'in_progress'))];
  assert.equal(card(referenceOnly, 'professional-required-elective').earned, 0);
  assert.equal(card(referenceOnly, 'professional-required-elective').status, 'unsatisfied');
});

test('history and geography grouped professional rules require their fields and avoid double counting', () => {
  const history = professionalFixture('史学科', [
    ['required', '必修'], ['schooling', 'スクーリング選択必修'],
    ['jp', '選択', '日本史の分野'], ['east', '選択', '東洋史の分野'], ['west', '選択', '西洋史の分野'],
  ], [
    ['required-16', 16, ['required']], ['schooling-8', 8, ['schooling'], 'schooling'], ['jp-50', 50, ['jp']],
    ['east-2', 2, ['east']], ['west-2', 2, ['west']],
  ]);
  const historyCard = (items, id) => calculateGraduationProgress(items, history.catalog, history.scope).cards.find(row => row.requirementId === id);
  const incomplete = [item('required-16', 'earned'), item('schooling-8', 'earned'), item('jp-50', 'earned')];
  assert.equal(historyCard(incomplete, 'professional-history-required').status, 'satisfied');
  assert.equal(historyCard(incomplete, 'professional-history-schooling-required-elective').status, 'satisfied');
  assert.equal(historyCard(incomplete, 'professional-history-elective').status, 'unsatisfied');
  assert.equal(historyCard([...incomplete, item('east-2', 'earned'), item('west-2', 'earned')], 'professional-history-elective').status, 'satisfied');

  const geography = professionalFixture('地理学科', [
    ['human-a', '選択必修', '人文地理の分野'], ['human-b', '選択必修', '人文地理の分野'],
    ['natural-a', '選択必修', '自然地理の分野'], ['natural-b', '選択必修', '自然地理の分野'],
    ['regional', '選択必修', '地誌・その他の分野'], ['duplicate-regional', '選択必修', '地誌・その他の分野'],
  ], [
    ['human-1', 4, ['human-a']], ['human-2', 4, ['human-b']], ['natural-1', 4, ['natural-a']], ['natural-2', 4, ['natural-b']],
    ['regional-16', 16, ['regional', 'duplicate-regional']],
  ]);
  const geoItems = geography.catalog.offerings.map(o => item(o.id, 'earned'));
  const geoCard = calculateGraduationProgress(geoItems, geography.catalog, geography.scope).cards.find(row => row.requirementId === 'professional-geography-required-elective');
  assert.equal(geoCard.earned, 32); // duplicate mapping edge is one 16-credit offering, never 32 credits.
  assert.equal(geoCard.status, 'unsatisfied');
});

test('law, economics and commerce use their official required-elective thresholds and overflow', () => {
  for (const [department, threshold, prefix] of [['法律学科', 32, 'law'], ['経済学科', 24, 'economics'], ['商業学科', 20, 'commerce']]) {
    const fixture = professionalFixture(department, [...Array.from({ length: threshold / 4 + 1 }, (_, i) => [`required-${i}`, '選択必修']), ['elective', '選択']], [
      ...Array.from({ length: threshold / 4 + 1 }, (_, i) => [`required-${i}`, 4, [`required-${i}`]]),
      ['outside', 8, []], ['manual', 8, []],
    ]);
    fixture.catalog.offerings.find(o => o.id === 'outside').resolutionStatus = 'outside_mapping_scope';
    fixture.catalog.offerings.find(o => o.id === 'manual').resolutionStatus = 'manual_review';
    const earned = fixture.catalog.offerings.filter(o => o.id.startsWith('required-')).map(o => item(o.id, 'earned'));
    const progress = calculateGraduationProgress(earned, fixture.catalog, fixture.scope);
    const required = progress.cards.find(row => row.requirementId === `professional-${prefix}-required-elective`);
    const elective = progress.cards.find(row => row.requirementId === `professional-${prefix}-elective`);
    assert.equal(required.status, 'satisfied');
    assert.equal(required.earned, threshold);
    assert.equal(elective.earned, 4);
    assert.equal(progress.graduationCheckComplete, false);
  }
  const law = professionalFixture('法律学科', Array.from({ length: 8 }, (_, i) => [`law-${i}`, '選択必修']), Array.from({ length: 8 }, (_, i) => [`law-${i}`, 4, [`law-${i}`]]));
  const required = calculateGraduationProgress(law.catalog.offerings.map(o => item(o.id, 'earned')), law.catalog, law.scope).cards.find(row => row.requirementId === 'professional-law-required-elective');
  assert.equal(required.details[0].earned, 8);
  assert.equal(required.status, 'satisfied');
});

test('professional overflow is driven by the structured official rule and never double counts its threshold', () => {
  const fixture = professionalFixture('商業学科', [
    ...Array.from({ length: 7 }, (_, index) => [`required-${index}`, '選択必修']), ['elective', '選択'],
  ], Array.from({ length: 7 }, (_, index) => [`required-${index}`, 4, [`required-${index}`]]));
  const rule = fixture.catalog.requirements.find(requirement => requirement.ruleType === 'overflow_credit_transfer');
  rule.conditions.threshold.credits = 24;
  const items = fixture.catalog.offerings.map(offering => item(offering.id, 'earned'));
  const progress = calculateGraduationProgress(items, fixture.catalog, fixture.scope);
  const required = progress.cards.find(row => row.requirementId === 'professional-commerce-required-elective');
  const elective = progress.cards.find(row => row.requirementId === 'professional-commerce-elective');
  assert.equal(required.earned, 20); // the 20-credit requirement remains capped at its own target
  assert.equal(elective.earned, 4); // 28 earned - catalog transfer threshold 24
  assert.equal(progress.graduationCheckComplete, false);
});

test('professional progress completes curriculum mappings before counting credits or courses', () => {
  const geography = professionalFixture('地理学科', [
    ['buddhism', '選択', null, 4],
    ['human', '選択必修', '人文地理の分野', 4], ['natural', '選択必修', '自然地理の分野', 4],
  ], [
    ['buddhism-summer', 2, ['buddhism']], ['buddhism-winter', 2, ['buddhism']],
    ['human-summer', 2, ['human']], ['human-winter', 2, ['human']],
    ['natural-summer', 2, ['natural']], ['natural-winter', 2, ['natural']],
  ]);
  const card = (items, id) => calculateGraduationProgress(items, geography.catalog, geography.scope).cards.find(row => row.requirementId === id);

  const partial = card([item('buddhism-summer', 'earned')], 'professional-geography-elective');
  assert.equal(partial.earned, 0);
  assert.deepEqual(partial.partialCourses, [{
    mappingId: 'buddhism', label: 'buddhism-summer', earned: 2, target: 4,
  }]);
  const completed = card([item('buddhism-summer', 'earned'), item('buddhism-winter', 'earned')], 'professional-geography-elective');
  assert.equal(completed.earned, 4);
  assert.equal(completed.details, undefined);
  assert.deepEqual(completed.partialCourses, []);
  const referenceOnly = card([item('buddhism-summer', 'planned'), item('buddhism-winter', 'in_progress')], 'professional-geography-elective');
  assert.equal(referenceOnly.earned, 0);
  assert.deepEqual(referenceOnly.partialCourses, []);
  for (const status of ['waiting', 'failed', 'dropped']) {
    const terminal = card([item('buddhism-summer', status)], 'professional-geography-elective');
    assert.equal(terminal.earned, 0);
    assert.deepEqual(terminal.partialCourses, []);
  }

  const geographyRequired = card([
    item('human-summer', 'earned'), item('human-winter', 'earned'),
    item('natural-summer', 'earned'), item('natural-winter', 'earned'),
  ], 'professional-geography-required-elective');
  assert.equal(geographyRequired.details[0].earned, 4);
  assert.equal(geographyRequired.details[0].unit, 'credits');
  assert.equal(geographyRequired.status, 'unsatisfied');
});

test('professional cards count only earned, in-progress, and planned statuses', () => {
  const fixture = professionalFixture('法律学科', [['required-elective', '選択必修']], [
    ['professional-course', 4, ['required-elective']],
  ]);
  const card = status => calculateGraduationProgress([item('professional-course', status)], fixture.catalog, fixture.scope).cards
    .find(row => row.requirementId === 'professional-law-required-elective');

  for (const [status, expected] of [
    ['earned', { earned: 4, inProgress: 0, planned: 0 }],
    ['in_progress', { earned: 0, inProgress: 4, planned: 0 }],
    ['planned', { earned: 0, inProgress: 0, planned: 4 }],
  ]) {
    const current = card(status);
    assert.deepEqual(
      { earned: current.earned, inProgress: current.inProgress, planned: current.planned },
      expected,
    );
  }
  for (const status of ['waiting', 'failed', 'dropped']) {
    const current = card(status);
    assert.deepEqual(
      { earned: current.earned, inProgress: current.inProgress, planned: current.planned, status: current.status },
      { earned: 0, inProgress: 0, planned: 0, status: 'unsatisfied' },
    );
  }
});

test('professional mapping aggregation counts duplicate edges once and safely holds incomplete metadata', () => {
  const law = professionalFixture('法律学科', [
    ['law-a', '選択必修', null, 4], ['law-b', '選択必修', null, 4], ['unknown', '選択', null, null],
  ], [
    ['law-a-1', 2, ['law-a']], ['law-a-2', 2, ['law-a']], ['law-b', 4, ['law-b']], ['unknown', 2, ['unknown']],
  ]);
  const lawCard = items => calculateGraduationProgress(items, law.catalog, law.scope).cards.find(row => row.requirementId === 'professional-law-required-elective');
  const partial = lawCard([item('law-a-1', 'earned'), item('law-a-2', 'earned'), item('law-b', 'earned')]);
  assert.equal(partial.details[0].earned, 2);
  assert.equal(partial.earned, 8);
  assert.equal(partial.status, 'unsatisfied');
  const held = lawCard([item('law-a-1', 'earned'), item('unknown', 'earned')]);
  assert.equal(held.status, 'unknown');
  assert.match(held.reason, /構成単位が未設定/);

  const duplicate = professionalFixture('地理学科', [['duplicate-a', '選択', null, 4], ['duplicate-b', '選択', null, 4]], [
    ['duplicate-offering-a', 2, ['duplicate-a', 'duplicate-b']], ['duplicate-offering-b', 2, ['duplicate-a', 'duplicate-b']],
  ]);
  const duplicateCard = calculateGraduationProgress(duplicate.catalog.offerings.map(o => item(o.id, 'earned')), duplicate.catalog, duplicate.scope)
    .cards.find(row => row.requirementId === 'professional-geography-elective');
  assert.equal(duplicateCard.earned, 4);
});

test('geography field course minimums and official repeatable professional limits apply', () => {
  const geography = professionalFixture('地理学科', [
    ['human', '選択必修', '人文地理の分野', 8], ['natural', '選択必修', '自然地理の分野', 8],
    ['regional', '選択必修', '地誌・その他の分野', 20],
  ], [
    ['human-1', 4, ['human']], ['human-2', 4, ['human']], ['natural-1', 4, ['natural']], ['natural-2', 4, ['natural']],
    ['regional', 20, ['regional']],
  ]);
  const geoCard = calculateGraduationProgress(geography.catalog.offerings.map(o => item(o.id, 'earned')), geography.catalog, geography.scope)
    .cards.find(row => row.requirementId === 'professional-geography-required-elective');
  assert.equal(geoCard.earned, 36);
  assert.equal(geoCard.status, 'unsatisfied'); // Each completed 8-credit mapping is one course, not two offerings.

  const repeatable = professionalFixture('経済学科', [['lecture', '選択必修', null, 4]], [['lecture', 4, ['lecture']]]);
  repeatable.catalog.offerings[0].name = '総合特講（経済学）';
  const counted = calculateGraduationProgress([item('lecture', 'earned')], repeatable.catalog, repeatable.scope)
    .cards.find(row => row.requirementId === 'professional-economics-required-elective');
  assert.equal(counted.status, 'unsatisfied');
  assert.equal(counted.earned, 4);
});

test('repeatable professional rules recognize only exact, parenthesized, and bracketed course names', () => {
  const offering = name => ({ ...first, name });
  assert.deepEqual(repeatableRule('経済学科', offering('経済学特講')), ['経済学科', '経済学特講', 8, 4]);
  assert.deepEqual(repeatableRule('経済学科', offering('経済学特講（前期週末スクーリング）')), ['経済学科', '経済学特講', 8, 4]);
  assert.deepEqual(repeatableRule('経済学科', offering('経済学特講［経済社会統計］（秋期スクーリング）')), ['経済学科', '経済学特講', 8, 4]);
  assert.deepEqual(repeatableRule('経済学科', offering('経営学特講［航空輸送概論］（秋期スクーリング）')), ['経済学科', '経営学特講', 8, 4]);
  assert.deepEqual(repeatableRule('経済学科', offering('演習［キャリアデザイン］（春期スクーリング）')), ['経済学科', '演習', 4, 2]);
  assert.deepEqual(repeatableRule('商業学科', offering('総合特講［東南アジア現代史］(後期メディア)')), ['商業学科', '総合特講', 16, 8]);
  assert.equal(repeatableRule('経済学科', offering('経済学特講演習（春期）')), undefined);
  assert.equal(repeatableRule('経済学科', offering('経済学特講【経済社会統計】')), undefined);
});

test('catalog audit: every bracketed repeatable offering is covered by its department rule', () => {
  const scopeByDepartment = new Map(rawCatalog.programs.map(program => [program.department, program.scopeId]));
  let audited = 0;
  for (const [department, name] of REPEATABLE_CREDIT_RULES) {
    const scopeId = scopeByDepartment.get(department);
    const mappingIds = new Set(rawCatalog.mappings.filter(mapping => mapping.scopeId === scopeId).map(mapping => mapping.mappingId));
    const bracketed = rawCatalog.offerings.filter(offering => offering.name.startsWith(`${name}［`)
      && offering.mappingIds.some(mappingId => mappingIds.has(mappingId)));
    if (bracketed.length === 0) continue; // 歴史資料学 has no 2026 ［…］ offering; exact/（…） is separately tested.
    for (const offering of bracketed) assert.ok(repeatableRule(department, offering), `${department}: ${offering.name}`);
    audited += bracketed.length;
  }
  assert.equal(audited, 39); // 21 unique offerings, applied across the departments where each is valid.
});

test('2026 common, history, geography, and law special credit transfers follow their source pages', () => {
  const commonScope = catalog.programs.find(program => program.isCommon).scopeId;
  const geoScope = catalog.programs.find(program => program.department === '地理学科').scopeId;
  const commonMap = { ...catalog.mappings[0], mappingId: 'basic', scopeId: commonScope, category: '一般教育', field: 'その他', requirementType: null };
  const common = { ...catalog, mappings: [commonMap], requirements: [], offerings: [1, 2, 3].map(n => ({
    ...catalog.offerings[0], id: `basic-${n}`, name: `基礎特講（${n}）`, credits: 2, resolutionStatus: 'matched', mappingIds: ['basic'],
  })) };
  const commonCard = calculateGraduationProgress(common.offerings.map(offering => item(offering.id, 'earned')), common, geoScope).cards.find(row => row.requirementId === 'group-general');
  assert.equal(commonCard.earned, 4);
  assert.match(commonCard.note, /2単位は修得済みだが卒業算入外/);

  const history = professionalFixture('史学科', [['any', '選択']], [
    ['jp-correspondence', 4, ['any']], ['jp-schooling', 2, ['any'], 'schooling'],
    ['east-correspondence', 4, ['any']], ['east-schooling', 2, ['any'], 'schooling'],
    ['west-correspondence', 4, ['any']], ['west-schooling', 2, ['any'], 'schooling'],
  ]);
  for (const offering of history.catalog.offerings) offering.name = offering.id.startsWith('jp') ? '日本史概説' : offering.id.startsWith('east') ? '東洋史概説' : '西洋史概説';
  const historyCards = calculateGraduationProgress(history.catalog.offerings.map(offering => item(offering.id, 'earned')), history.catalog, history.scope).cards;
  assert.equal(historyCards.find(row => row.requirementId === 'professional-history-required').earned, 12);
  assert.equal(historyCards.find(row => row.requirementId === 'professional-history-schooling-required-elective').earned, 6);

  const geography = professionalFixture('地理学科', [['any', '選択']], [
    ...[1, 2, 3, 4].map(n => [`field-${n}`, 1, ['any'], 'schooling']),
    ...[1, 2].map(n => [`chorography-${n}`, 2, ['any'], 'schooling']),
    ...[1, 2, 3].map(n => [`human-${n}`, 2, ['any'], 'schooling']),
    ...[1, 2, 3].map(n => [`natural-${n}`, 2, ['any'], 'schooling']),
    ...[1, 2, 3].map(n => [`lecture-${n}`, 2, ['any'], 'schooling']),
  ]);
  for (const offering of geography.catalog.offerings) offering.name = offering.id.startsWith('field') ? '現地研究'
    : offering.id.startsWith('chorography') ? '地誌学特講' : offering.id.startsWith('human') ? '人文地理学演習'
      : offering.id.startsWith('natural') ? '自然地理学演習' : '人文地理学特講';
  const geoCards = calculateGraduationProgress(geography.catalog.offerings.map(offering => item(offering.id, 'earned')), geography.catalog, geography.scope).cards;
  assert.equal(geoCards.find(row => row.requirementId === 'professional-geography-schooling-required').earned, 6);
  assert.equal(geoCards.find(row => row.requirementId === 'professional-geography-required-elective').earned, 6);
  assert.equal(geoCards.find(row => row.requirementId === 'professional-geography-elective').earned, 12);

  const law = professionalFixture('法律学科', [
    ...Array.from({ length: 8 }, (_, n) => [`complete-${n}`, '選択必修', null, 4]),
    ['partial', '選択', null, 4], ['lecture', '選択', null, 2],
  ], [
    ...Array.from({ length: 8 }, (_, n) => [`complete-${n}`, 4, [`complete-${n}`]]),
    ['partial', 2, ['partial'], 'schooling'], ...Array.from({ length: 5 }, (_, n) => [`lecture-${n}`, 2, ['lecture'], 'schooling']),
  ]);
  for (const offering of law.catalog.offerings) if (offering.id.startsWith('lecture-')) offering.name = '法律学特講（夏期スクーリング）';
  const lawCards = calculateGraduationProgress(law.catalog.offerings.map(offering => item(offering.id, 'earned')), law.catalog, law.scope).cards;
  assert.equal(lawCards.find(row => row.requirementId === 'professional-law-required-elective').earned, 32);
  assert.equal(lawCards.find(row => row.requirementId === 'professional-law-elective').earned, 10); // 8 capped 法律学特講 + 2 allowed partial.
});

test('special transfer cards use planned/in-progress only as reference and ignore terminal statuses', () => {
  const geography = professionalFixture('地理学科', [['any', '選択']], [['field', 1, ['any'], 'schooling']]);
  geography.catalog.offerings[0].name = '現地研究（夏期スクーリング）';
  const card = status => calculateGraduationProgress([item('field', status)], geography.catalog, geography.scope).cards
    .find(row => row.requirementId === 'professional-geography-schooling-required');
  assert.deepEqual([card('planned').earned, card('planned').planned], [0, 1]);
  assert.deepEqual([card('in_progress').earned, card('in_progress').inProgress], [0, 1]);
  for (const status of ['waiting', 'failed', 'dropped']) assert.deepEqual([card(status).earned, card(status).inProgress, card(status).planned], [0, 0, 0]);
});

test('unresolved planned and in-progress professional offerings do not hold current progress', () => {
  const cases = [
    {
      name: 'missing curriculum credits',
      fixture: () => professionalFixture('法律学科', [['known', '選択必修'], ['incomplete', '選択必修', null, null]], [
        ['known', 4, ['known']], ['incomplete', 4, ['incomplete']],
      ]),
      offeringId: 'incomplete',
      reason: /構成単位が未設定/,
    },
    {
      name: 'multiple professional mappings',
      fixture: () => professionalFixture('法律学科', [
        ['known', '選択必修'], ['ambiguous-required', '選択必修'], ['ambiguous-elective', '選択'],
      ], [
        ['known', 4, ['known']], ['ambiguous', 4, ['ambiguous-required', 'ambiguous-elective']],
      ]),
      offeringId: 'ambiguous',
      reason: /区分が複数/,
    },
  ];
  for (const { name, fixture: createFixture, offeringId, reason } of cases) {
    const fixture = createFixture();
    const card = items => calculateGraduationProgress(items, fixture.catalog, fixture.scope).cards
      .find(row => row.requirementId === 'professional-law-required-elective');
    for (const [status, key] of [['planned', 'planned'], ['in_progress', 'inProgress']]) {
      const current = card([item('known', 'earned'), item(offeringId, status)]);
      assert.equal(current.status, 'unsatisfied', `${name}: ${status} must not hold the card`);
      assert.equal(current.earned, 4);
      assert.equal(current[key], 0, `${name}: ${status} must not be guessed into a bucket`);
    }
    const held = card([item('known', 'earned'), item(offeringId, 'earned')]);
    assert.equal(held.status, 'unknown', `${name}: earned still holds the card`);
    assert.match(held.reason, reason);
  }
});

test('35009 needs its full geography curriculum mapping before entering professional elective', () => {
  const geography = '4d450b06-fb99-4bf2-a769-fe5f68dd337a';
  const buddhism = catalog.offerings.find(o => o.classCode === '35009');
  const geo = calculateGraduationProgress([item(buddhism.id, 'earned')], catalog, geography);
  const elective = geo.cards.find(row => row.requirementId === 'professional-geography-elective');
  assert.equal(elective.earned, 0);
  assert.deepEqual(elective.partialCourses, [{
    mappingId: '540bd399-8d5a-4133-adf7-2668b266b2e1', label: '日本史特講（日本仏教史）', earned: 2, target: 4,
  }]);
  const history = '118c5183-6aec-4fa1-905a-265f25d86db1';
  assert.equal(calculateGraduationProgress([item(buddhism.id, 'earned')], catalog, history).cards.find(row => row.requirementId === 'professional-history-elective').earned, 0);
});

test('correspondence progress separates report resubmission, eligibility, and earned condition', () => {
  const offering = catalog.offerings.find(current => current.name === '債権総論' && current.method === 'correspondence');
  const saved = progressForCorrespondence(offering, {});
  assert.equal(saved.requiredReports, 2);
  assert.equal(correspondenceCreditResult(saved).examEligible, false);
  const submitted = { ...saved, reports: saved.reports.map(report => ({ ...report, status: 'submitted' })) };
  assert.equal(correspondenceCreditResult(submitted).examEligible, true);
  assert.equal(correspondenceCreditResult(submitted).creditEarned, false);
  const resubmit = setReportStatus(submitted, 1, 'resubmit');
  assert.equal(resubmit.reports[0].grade, null);
  const passedReports = { ...saved, reports: saved.reports.map(report => ({ ...report, status: 'passed', grade: 'C-' })) };
  assert.equal(correspondenceCreditResult({ ...passedReports, examGrade: 'D' }).examPassed, false);
  assert.equal(correspondenceCreditResult({ ...passedReports, examGrade: 'C-' }).creditEarned, true);
});

test('unknown correspondence requirements never claim credit and v6 migration retains all prior fields', () => {
  const unknown = catalog.offerings.find(current => current.method === 'correspondence' && current.name === '社会経済思想史');
  const progress = progressForCorrespondence(unknown, {});
  assert.equal(progress.requiredReports, null);
  assert.equal(correspondenceCreditResult(progress).creditEarned, null);
  const legacy = { ...initialState(), schemaVersion: 6, correspondenceProgress: undefined };
  delete legacy.correspondenceProgress;
  const loaded = loadState(memoryStore(JSON.stringify(legacy)), catalog);
  assert.equal(loaded.state.schemaVersion, 7);
  assert.deepEqual(loaded.state.correspondenceProgress, {});
  assert.deepEqual(loaded.state.courseEvaluations, legacy.courseEvaluations);
  assert.deepEqual(loaded.state.mediaSchoolingProgress, legacy.mediaSchoolingProgress);
});
