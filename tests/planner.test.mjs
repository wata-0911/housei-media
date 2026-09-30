import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { catalog, offeringsById } from '../src/planner/catalog.ts';
import { manualMappingOverrideLedger, officialMappingOverrideLedger } from '../src/planner/manualMappingOverrides.ts';
import { validateCatalog, validateState } from '../src/planner/validation.ts';
import { summarizeCredits, searchOfferings } from '../src/planner/calculations.ts';
import { STORAGE_KEY, BACKUP_KEY, initialState, loadState, saveState, recoverState } from '../src/planner/storage.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { THESIS_CREDIT_METADATA_2026, sourcesForGraduationCard, thesisCreditsForDepartment } from '../src/planner/graduationSources.ts';
import { REPEATABLE_CREDIT_RULES, repeatableRule } from '../src/planner/repeatableRules.ts';
import { allocateGeographyTransfers } from '../src/planner/geographyTransferRules.ts';
import { removePlannerItem, removePublicCourse, restorePlannerItem, restorePublicCourse } from '../src/planner/removeUndo.ts';
import { evaluatePublicCourseLimit, publicCourseLimitFor } from '../src/planner/publicCourseRules.ts';
import { createPublicCourse, isValidPublicCourseTitle, matchesPublicCourseSearch, normalizePublicCourseTitle, PUBLIC_COURSE_TITLE } from '../src/planner/publicCourses.ts';
import { eligibilityYearsLabel, filterOfferingsByYear, showSyntheticPublicCourse, yearEligibility } from '../src/planner/yearEligibility.ts';
import { stateForScopeChange, supportsThesisSelection, thesisPolicyForScope } from '../src/planner/thesisSelection.ts';
import { addAssessment, completedMediaLessons, isMediaSchooling, mediaPlanItems, mediaProgressSummary, mediaShareIntentUrl, mediaSharePost, mediaSharePresentation, mediaShareViewModel, progressFor, removeAssessment, setTotalLessons, toggleLesson, updateAssessment } from '../src/planner/mediaSchooling.ts';
import { COURSE_GRADES, evaluationFor, evaluationIsUnrated, evaluationItems, evaluationSummary, usesLegacyReportEvaluation } from '../src/planner/courseEvaluations.ts';
import { correspondenceCreditResult, progressForCorrespondence, setReportStatus } from '../src/planner/correspondenceProgress.ts';
import { correspondenceRequirementFor, structuredRequirementCount } from '../src/planner/correspondenceRequirements.ts';
import { correspondenceProgressSummary, isStandardTerm, mediaProgressText, offeringFormLabel, progressSummaryForOffering } from '../src/planner/planTable.ts';
import { plannerExportCsv, plannerExportFileName, plannerExportPresentation } from '../src/planner/plannerExport.ts';
import { isHoseiGradeImportV1 } from '../src/planner/gradeImportContract.ts';
import { academicYearFromDate, applyImport, groupImportedAchievements, hasCorrespondenceEvidence, importedEarnedCreditsTotal, importPreview, inferredCorrespondenceYear, schoolingAcademicYear } from '../src/planner/gradeImportApply.ts';
import { gradeHandoffToken, isGradeHandoffResponse, previewDirectGradeHandoff } from '../src/planner/directGradeHandoff.ts';
import { deriveImportedAchievements, managedImportedMedia } from '../src/planner/importedAchievementCalculations.ts';
import { matchedNameOfferings, normalizeImportBaseName, repairImportedAchievements } from '../src/planner/importedAchievementRepair.ts';
import { createUnifiedCourseRows, importedAchievementStatusLabel } from '../src/planner/unifiedCourseView.ts';
import { initialGraduationProfile, missingGraduationProfilePrerequisites, normalizeAdmissionYear, normalizeNonnegativeNumber } from '../src/planner/graduationProfile.ts';

function memoryStore(raw = null) {
  const values = new Map(raw === null ? [] : [[STORAGE_KEY, raw]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const item = (offeringId, status = 'planned') => ({ offeringId, status, plannedYear: 2026, plannedTerm: null, studyYear: null, earnedOrder: null });
const publicCourse = (id, status = 'planned', title = `公開科目 ${id}`) => ({ id, title, status, plannedYear: 2026, plannedTerm: null, studyYear: null, finalGrade: null, credits: 2 });
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
  const removedItem = { offeringId: 'second', status: 'earned', plannedYear: 2028, plannedTerm: '秋期', studyYear: 2, earnedOrder: 3 };
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
  assert.deepEqual(firstPublic, { id: firstPublic.id, title: '公開科目', status: 'planned', plannedYear: 2026, plannedTerm: null, studyYear: null, finalGrade: null, credits: 2 });
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

test('graduation coverage keeps calculations intact and exposes official sources', () => {
  const scope = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const progress = calculateGraduationProgress([], catalog, scope);
  const general = progress.cards.find(row => row.requirementId === 'group-general');
  const law = progress.cards.find(row => row.requirementId === 'professional-law-required-elective');
  assert.equal(general.coverageStatus, 'supported');
  assert.deepEqual(general.sourceRefs, [{ title: '2026年度 学習のしおり（教育課程表）', year: 2026, page: 'p.46' }]);
  assert.equal(law.coverageStatus, 'partial');
  assert.ok(law.sourceRefs.some(source => source.page === 'p.47'));
  assert.equal(progress.graduationCheckComplete, false);
  assert.equal(progress.coverageSummary.supported + progress.coverageSummary.partial + progress.coverageSummary.unknown, progress.cards.length);
});

test('unselected graduation scope returns every coverage and imported-progress default', () => {
  const progress = calculateGraduationProgress([], catalog, null);
  assert.equal(progress.graduationCheckComplete, false);
  assert.deepEqual(progress.coverageSummary, { supported: 0, partial: 0, unknown: 0 });
  assert.deepEqual(progress.importedWarnings, []);
  assert.equal(progress.importedContributionCount, 0);
});

test('graduation coverage classifies incomplete evidence without promoting unknown rules', () => {
  const law = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const history = catalog.programs.find(program => program.department === '史学科').scopeId;
  const thesisUnknown = calculateGraduationProgress([], catalog, law).requirements.find(row => row.reason?.includes('卒論有無が未定'));
  assert.equal(thesisUnknown.coverageStatus, 'unknown');
  assert.equal(thesisUnknown.unknownReasonCategory, 'personal_information');

  const seminar = catalog.offerings.find(offering => offering.name.startsWith('史学演習'));
  const historyUnknown = calculateGraduationProgress([{ ...item(seminar.id, 'earned'), earnedOrder: null }], catalog, history)
    .cards.find(row => row.requirementId === 'history-seminar-required-elective');
  assert.equal(historyUnknown.coverageStatus, 'unknown');
  assert.equal(historyUnknown.unknownReasonCategory, 'completion_order');

  const manual = catalog.offerings.find(offering => offering.resolutionStatus === 'manual_review');
  const manualUnknown = calculateGraduationProgress([item(manual.id, 'earned')], catalog, law).requirements.find(row => row.reason?.includes('対応関係'));
  assert.equal(manualUnknown.coverageStatus, 'unknown');
  assert.equal(manualUnknown.unknownReasonCategory, 'course_matching');

  const unsupported = calculateGraduationProgress([], catalog, law).requirements.find(row => row.ruleType === 'unsupported');
  assert.equal(unsupported.status, 'unknown');
  assert.equal(unsupported.coverageStatus, 'unknown');
  assert.equal(unsupported.unknownReasonCategory, 'rule_unimplemented');
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
    '{broken', JSON.stringify({ ...valid, schemaVersion: 18 }),
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

test('history sequence recognizes the catalog [S] overview offerings, moves seminar 2 once, and counts historical sources once up to six completions', () => {
  const scope = '118c5183-6aec-4fa1-905a-265f25d86db1';
  const seminars = catalog.offerings.filter(o => /^史学演習（(日本|西洋|東洋)）/.test(o.name));
  const sources = catalog.offerings.filter(o => /^歴史資料学（/.test(o.name));
  const beforeFive = calculateGraduationProgress(seminars.slice(0, 4).map((offering, index) => ({ ...item(offering.id, 'earned'), earnedOrder: index + 1 })), catalog, scope)
    .cards.find(row => row.requirementId === 'professional-history-schooling-required-elective');
  assert.match(beforeFive.note, /5科目修得前/);
  const overview = [
    catalog.offerings.find(o => o.id === '830688aa-ff84-43e4-9a86-348871f382d1'),
    catalog.offerings.find(o => o.id === 'c7ce6809-c7a8-4541-b01b-1023dc2fc25f'),
    catalog.offerings.find(o => o.id === '13b84a06-03b7-4226-8451-1ea65e460951'),
  ];
  assert.ok(overview.every(Boolean));
  const progress = calculateGraduationProgress([
    ...overview.map(offering => item(offering.id, 'earned')),
    { ...item(seminars[0].id, 'earned'), earnedOrder: 1 },
    { ...item(seminars[1].id, 'earned'), earnedOrder: 2 },
    { ...item(seminars[2].id, 'earned'), earnedOrder: 3 },
    { ...item(seminars[3].id, 'earned'), earnedOrder: 4 },
    ...Array.from({ length: 7 }, (_, index) => ({ ...item(sources[index % sources.length].id, 'earned'), offeringId: `${sources[index % sources.length].id}-copy-${index}`, earnedOrder: index + 1 })),
  ], { ...catalog, offerings: [...catalog.offerings, ...Array.from({ length: 7 }, (_, index) => ({ ...sources[index % sources.length], id: `${sources[index % sources.length].id}-copy-${index}` }))] }, scope);
  const school = progress.cards.find(row => row.requirementId === 'professional-history-schooling-required-elective');
  const elective = progress.cards.find(row => row.requirementId === 'professional-history-elective');
  const sequenceSchool = progress.cards.find(row => row.requirementId === 'history-seminar-required-elective');
  const sequenceElective = progress.cards.find(row => row.requirementId === 'history-seminar-elective');
  assert.equal(school.earned, 8, '史学演習2 is moved out after all five schooling courses are complete');
  assert.equal(elective.earned, 18, '史学演習2〜4 plus at most six historical-source completions count once');
  assert.match(school.note, /5科目すべてを修得済み/);
  assert.match(elective.note, /歴史資料学/);
  assert.deepEqual([sequenceSchool.label, sequenceSchool.earned, sequenceSchool.target], ['史学演習1（スクーリング選択必修）', 2, 2]);
  assert.deepEqual([sequenceElective.label, sequenceElective.earned, sequenceElective.target], ['史学演習2〜4（選択）', 6, 6]);
});

test('history fifth-course exception uses canonical mappings and excludes media offerings', () => {
  const scope = '118c5183-6aec-4fa1-905a-265f25d86db1';
  const seminars = catalog.offerings.filter(o => /^史学演習（(日本|西洋|東洋)）/.test(o.name)).slice(0, 4);
  const overview = [
    '830688aa-ff84-43e4-9a86-348871f382d1', // 日本史概説[S]（冬期スクーリング）【オンライン】
    'c7ce6809-c7a8-4541-b01b-1023dc2fc25f', // 東洋史概説[S]（冬期スクーリング）
    '13b84a06-03b7-4226-8451-1ea65e460951', // 西洋史概説[S]（冬期スクーリング）
  ].map(id => catalog.offerings.find(o => o.id === id));
  assert.ok(overview.every(Boolean));
  const items = [
    ...overview.map(offering => item(offering.id, 'earned')),
    ...seminars.map((offering, index) => ({ ...item(offering.id, 'earned'), earnedOrder: index + 1 })),
  ];
  const card = (progress, id) => progress.cards.find(row => row.requirementId === id);
  const mappingOnlyCatalog = {
    ...catalog,
    offerings: catalog.offerings.map(offering => overview.some(candidate => candidate.id === offering.id)
      ? { ...offering, name: `catalog-identity-${offering.id}` }
      : offering),
  };
  const progress = calculateGraduationProgress(items, mappingOnlyCatalog, scope);
  const school = card(progress, 'professional-history-schooling-required-elective');
  const elective = card(progress, 'professional-history-elective');
  assert.equal(school.earned, 8);
  assert.equal(elective.earned, 6, '史学演習2 is counted only in 選択');
  assert.match(school.note, /5科目すべてを修得済み/);
  assert.deepEqual([card(progress, 'history-seminar-required-elective').label, card(progress, 'history-seminar-required-elective').earned], ['史学演習1（スクーリング選択必修）', 2]);
  assert.deepEqual([card(progress, 'history-seminar-elective').label, card(progress, 'history-seminar-elective').earned], ['史学演習2〜4（選択）', 6]);

  const missingEastern = calculateGraduationProgress(items.filter(entry => entry.offeringId !== overview[1].id), mappingOnlyCatalog, scope);
  assert.equal(card(missingEastern, 'professional-history-elective').earned, 4);
  assert.match(card(missingEastern, 'professional-history-schooling-required-elective').note, /5科目修得前/);

  const mediaJapanese = catalog.offerings.find(o => o.id === '91524802-f639-4be6-9d3e-3a55ca166b6b');
  assert.ok(mediaJapanese);
  const mediaInstead = calculateGraduationProgress([
    ...items.filter(entry => entry.offeringId !== overview[0].id),
    item(mediaJapanese.id, 'earned'),
  ], catalog, scope);
  assert.equal(card(mediaInstead, 'professional-history-elective').earned, 4, 'メディアはスクーリング選択必修の5科目に含めない');
});

test('historical-source cap is shared across earned, in-progress, and planned credits', () => {
  const scope = '118c5183-6aec-4fa1-905a-265f25d86db1';
  const source = catalog.offerings.find(o => /^歴史資料学（/.test(o.name));
  assert.ok(source);
  const copies = Array.from({ length: 7 }, (_, index) => ({ ...source, id: `history-source-cap-${index}` }));
  const progress = (statuses) => calculateGraduationProgress(copies.map((offering, index) => item(offering.id, statuses[index])), { ...catalog, offerings: [...catalog.offerings, ...copies] }, scope)
    .cards.find(row => row.requirementId === 'professional-history-elective');

  const earnedThenPlanned = progress(['earned', 'earned', 'earned', 'earned', 'earned', 'earned', 'planned']);
  assert.deepEqual([earnedThenPlanned.earned, earnedThenPlanned.inProgress, earnedThenPlanned.planned], [12, 0, 0]);
  const earnedThenInProgressThenPlanned = progress(['earned', 'earned', 'earned', 'earned', 'earned', 'in_progress', 'planned']);
  assert.deepEqual([earnedThenInProgressThenPlanned.earned, earnedThenInProgressThenPlanned.inProgress, earnedThenInProgressThenPlanned.planned], [10, 2, 0]);
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
  const persistedStore = memoryStore();
  saveState(persistedStore, state, null, catalog);
  assert.deepEqual(loadState(persistedStore, catalog).state.items.map(item => item.earnedOrder), [1, 2], 'manual completion order survives reload');
  const v1 = { schemaVersion: 1, selectedScopeId: null, items: [{ offeringId: seminars[0].id, status: 'earned', plannedYear: 2026, plannedTerm: null }], todos: [] };
  const store = memoryStore(JSON.stringify(v1));
  const loaded = loadState(store, catalog);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.schemaVersion, 17);
  assert.equal(loaded.state.items[0].earnedOrder, null);
  assert.deepEqual(loaded.state.publicCourses, []);
  assert.equal(store.getItem(STORAGE_KEY), JSON.stringify(v1));
  const v2 = { ...loaded.state, schemaVersion: 2 };
  delete v2.publicCourses;
  const v2Loaded = loadState(memoryStore(JSON.stringify(v2)), catalog);
  assert.equal(v2Loaded.error, null);
  assert.equal(v2Loaded.state.schemaVersion, 17);
  assert.deepEqual(v2Loaded.state.publicCourses, []);
});

test('v3 state migrates through v6 without losing saved planner data, and validation permits only thesis choices', () => {
  const current = { ...initialState(), selectedScopeId: catalog.programs[0].scopeId, items: [item(first.id)], publicCourses: [publicCourse('11111111-1111-4111-8111-111111111111')], todos: [{ id: first.id, offeringId: null, text: '保持', done: false }] };
  const v3 = { ...current, schemaVersion: 3 };
  delete v3.thesisSelection;
  const loaded = loadState(memoryStore(JSON.stringify(v3)), catalog);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.schemaVersion, 17);
  assert.equal(loaded.state.thesisSelection, 'undecided');
  assert.deepEqual({ items: loaded.state.items, publicCourses: loaded.state.publicCourses, todos: loaded.state.todos, selectedScopeId: loaded.state.selectedScopeId }, { items: current.items, publicCourses: current.publicCourses, todos: current.todos, selectedScopeId: current.selectedScopeId });
  assert.equal(validateState({ ...current, thesisSelection: 'selected' }, catalog), true);
  assert.equal(validateState({ ...current, thesisSelection: 'not_selected' }, catalog), true);
  assert.equal(validateState({ ...current, thesisSelection: 'maybe' }, catalog), false);
});

test('media schooling uses structured method and delivery category, not course names', () => {
  const media = catalog.offerings.find(offering => isMediaSchooling(offering) && offering.courseId);
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
  let course = { offeringId: media.id, totalLessons: null, lessons: [], assessments: [] };
  course = addAssessment(course, { id: 'midterm', type: 'midterm', label: '中間試験', scheduledDate: '2026-07-20', completed: false });
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
  const removed = { ...state, items: [] };
  const readded = { ...removed, items: [item(media.id)] };
  assert.deepEqual(readded.mediaSchoolingProgress[media.id].assessments, [{ id: 'midterm', type: 'midterm', label: '中間試験', scheduledDate: '2026-07-20', completed: false }]);
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
    orphan: { offeringId: 'orphan', totalLessons: 99, lessons: [], assessments: [{ id: 'orphan-final', type: 'final', label: '期末試験', scheduledDate: '2026-12-20', completed: false }] },
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
  assert.doesNotMatch(post, /orphan|#法政通信|2026\/12\/20/);
  assert.equal(mediaShareIntentUrl(post), `https://x.com/intent/post?text=${encodeURIComponent(post)}`);
});

test('media share includes imported current Media, deduplicates its offering, and preserves progress', () => {
  const media = catalog.offerings.filter(isMediaSchooling);
  const firstTerm = media.find(offering => offering.deliveryCategory === '前期メディア');
  const secondTerm = media.find(offering => offering.deliveryCategory === '後期メディア');
  const progress = {
    [firstTerm.id]: { offeringId: firstTerm.id, totalLessons: 2, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }] },
    [secondTerm.id]: { offeringId: secondTerm.id, totalLessons: 3, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: true }] },
  };
  const importedOnly = mediaShareViewModel([], offeringsById, progress, [{ offering: firstTerm, name: '成績表由来の前期メディア' }]);
  assert.deepEqual(importedOnly.map(group => group.courses.map(course => course.name)), [['成績表由来の前期メディア']]);
  assert.deepEqual(importedOnly[0].courses[0], { name: '成績表由来の前期メディア', videoCompletedCount: 1, testCompletedCount: 0, totalLessons: 2, videoDone: false, testDone: false, assessments: [] });

  const combined = mediaShareViewModel([item(firstTerm.id)], offeringsById, progress, [{ offering: firstTerm, name: '重複する取込名' }, { offering: secondTerm, name: '成績表由来の後期メディア' }]);
  assert.deepEqual(combined.map(group => group.courses.map(course => course.name)), [[firstTerm.name], ['成績表由来の後期メディア']]);
  assert.match(mediaSharePost(combined), /成績表由来の後期メディア  動画 1\/3・テスト 1\/3/);
});

test('media share keeps the established progress template and derives both text and PNG data from the selected presentation', () => {
  const media = catalog.offerings.filter(isMediaSchooling);
  const firstTerm = media.find(offering => offering.deliveryCategory === '前期メディア');
  const secondTerm = media.find(offering => offering.deliveryCategory === '後期メディア');
  const groups = mediaShareViewModel([item(firstTerm.id), item(secondTerm.id)], offeringsById, {
    [firstTerm.id]: {
      offeringId: firstTerm.id, totalLessons: 14,
      lessons: Array.from({ length: 14 }, (_, index) => ({ lesson: index + 1, videoCompleted: true, testCompleted: true })),
      assessments: [
        { id: 'midterm', type: 'midterm', label: 'unused', scheduledDate: '2026-06-10', completed: true },
        { id: 'final', type: 'final', label: 'unused', scheduledDate: null, completed: false },
        { id: 'other-1', type: 'other', label: 'レポート発表', scheduledDate: '2026-07-01', completed: true },
        { id: 'other-2', type: 'other', label: '長い名称でも折り返して表示する評価予定', scheduledDate: null, completed: false },
      ],
    },
    [secondTerm.id]: { offeringId: secondTerm.id, totalLessons: 15, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }], assessments: [] },
    orphan: { offeringId: 'orphan', totalLessons: 14, lessons: [], assessments: [{ id: 'hidden', type: 'midterm', label: '中間試験', scheduledDate: '2026-01-01', completed: true }] },
  });
  const existing = mediaSharePost(groups, 'あと少し');
  assert.equal(existing, `${firstTerm.deliveryCategory}進捗\n・${firstTerm.name}  動画 14/14 ✅・テスト 14/14 ✅\n動画トータル  14/14\nテストトータル  14/14\n\n${secondTerm.deliveryCategory}進捗\n・${secondTerm.name}  動画 1/15・テスト 0/15\n動画トータル  1/15\nテストトータル  0/15\n\nあと少し`);
  assert.deepEqual(mediaSharePresentation(groups, 'progress').flatMap(group => group.courses.map(course => course.assessmentLines)), [[], []]);

  const withAssessments = mediaSharePresentation(groups, 'progress_with_assessments');
  assert.deepEqual(withAssessments[0].courses[0].assessmentLines, [
    { label: '中間試験', date: '2026/06/10', completed: true },
    { label: '期末試験', date: '日程未設定', completed: false },
    { label: 'レポート発表', date: '2026/07/01', completed: true },
    { label: '長い名称でも折り返して表示する評価予定', date: '日程未設定', completed: false },
  ]);
  assert.deepEqual(withAssessments[1].courses[0].assessmentLines, []);
  const post = mediaSharePost(groups, 'あと少し', 'progress_with_assessments');
  assert.match(post, /中間試験  2026\/06\/10  実施済み ✅/);
  assert.match(post, /期末試験  日程未設定  未実施/);
  assert.match(post, /レポート発表  2026\/07\/01  実施済み ✅/);
  assert.match(post, /長い名称でも折り返して表示する評価予定  日程未設定  未実施/);
  assert.match(post, /動画 1\/15・テスト 0\/15/);
  assert.match(post, /\n\nあと少し$/);
  assert.doesNotMatch(post, /2026\/01\/01/);
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
  assert.equal(mediaSharePost(groups, '', 'progress_with_assessments'), post);
});

test('media share keeps video and test completion states independent in each course', () => {
  const media = catalog.offerings.filter(isMediaSchooling).find(offering => offering.deliveryCategory === '後期メディア');
  const groups = mediaShareViewModel([item(media.id)], offeringsById, {
    [media.id]: { offeringId: media.id, totalLessons: 2, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: true }, { lesson: 2, videoCompleted: false, testCompleted: true }] },
  });
  const [course] = groups[0].courses;
  assert.deepEqual(course, { name: media.name, videoCompletedCount: 1, testCompletedCount: 2, totalLessons: 2, videoDone: false, testDone: true, assessments: [] });
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
  assert.equal(loaded.state.schemaVersion, 17);
  assert.deepEqual(loaded.state.mediaSchoolingProgress, {});
  assert.deepEqual({ items: loaded.state.items, publicCourses: loaded.state.publicCourses, thesisSelection: loaded.state.thesisSelection, todos: loaded.state.todos, selectedScopeId: loaded.state.selectedScopeId }, { items: saved.items, publicCourses: saved.publicCourses, thesisSelection: saved.thesisSelection, todos: saved.todos, selectedScopeId: saved.selectedScopeId });
  assert.deepEqual(calculateGraduationProgress(loaded.state.items, catalog, loaded.state.selectedScopeId, loaded.state.publicCourses, loaded.state.thesisSelection), calculateGraduationProgress(saved.items, catalog, saved.selectedScopeId, saved.publicCourses, saved.thesisSelection));
});

test('course evaluations accept all eleven grades, null, and reject invalid values', () => {
  assert.deepEqual(COURSE_GRADES, ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D']);
  for (const grade of COURSE_GRADES) {
    const state = { ...initialState(), courseEvaluations: { [first.id]: { offeringId: first.id, finalGrade: grade, reportGrade: grade, schoolingGrade: null } } };
    assert.equal(validateState(state, catalog), true);
  }
  assert.equal(validateState({ ...initialState(), courseEvaluations: { [first.id]: { offeringId: first.id, finalGrade: 'F', reportGrade: null, schoolingGrade: null } } }, catalog), false);
  assert.equal(validateState({ ...initialState(), courseEvaluations: { [first.id]: { offeringId: first.id, finalGrade: null, reportGrade: null, schoolingGrade: null } } }, catalog), true);
});

test('v5 migration preserves planner and media data while adding empty evaluations', () => {
  const media = catalog.offerings.find(isMediaSchooling);
  const mediaSchoolingProgress = { [media.id]: { offeringId: media.id, totalLessons: 2, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: true }] } };
  const saved = { ...initialState(), schemaVersion: 5, selectedScopeId: catalog.programs[0].scopeId, thesisSelection: 'selected', items: [{ ...item(media.id, 'earned'), earnedOrder: null }], publicCourses: [publicCourse('33333333-3333-4333-8333-333333333333')], todos: [{ id: media.id, offeringId: media.id, text: '保持', done: false }], mediaSchoolingProgress };
  delete saved.courseEvaluations;
  const loaded = loadState(memoryStore(JSON.stringify(saved)), catalog);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.schemaVersion, 17);
  assert.deepEqual(loaded.state.courseEvaluations, {});
  assert.deepEqual(loaded.state.mediaSchoolingProgress, { [media.id]: { ...mediaSchoolingProgress[media.id], assessments: [] } });
  assert.deepEqual({ items: loaded.state.items, publicCourses: loaded.state.publicCourses, thesisSelection: loaded.state.thesisSelection, todos: loaded.state.todos, selectedScopeId: loaded.state.selectedScopeId }, { items: saved.items, publicCourses: saved.publicCourses, thesisSelection: saved.thesisSelection, todos: saved.todos, selectedScopeId: saved.selectedScopeId });
});

test('course evaluations follow current annual plan, preserve orphans for safe re-add, and never change status or graduation progress', () => {
  const media = catalog.offerings.find(isMediaSchooling);
  const nonMedia = catalog.offerings.find(offering => offering.method === 'correspondence');
  const evaluations = {
    [media.id]: { offeringId: media.id, finalGrade: null, reportGrade: 'A+', schoolingGrade: 'B-' },
    [nonMedia.id]: { offeringId: nonMedia.id, finalGrade: null, reportGrade: 'D', schoolingGrade: null },
  };
  const items = [{ ...item(media.id, 'planned'), plannedYear: 2027 }, item(nonMedia.id, 'earned')];
  assert.deepEqual(evaluationItems(items, offeringsById).map(entry => entry.offeringId), [media.id, nonMedia.id]);
  assert.deepEqual(evaluationSummary(items, evaluations, offeringsById), { reportsEntered: 1, reportEligibleTotal: 1, schoolingsEntered: 1 });
  assert.deepEqual(evaluationItems(items.filter(entry => entry.offeringId !== media.id), offeringsById).map(entry => entry.offeringId), [nonMedia.id]);
  assert.deepEqual(evaluationFor(media.id, evaluations), evaluations[media.id]);
  assert.equal(items[0].status, 'planned');
  assert.equal(items[1].status, 'earned');
  const before = calculateGraduationProgress(items, catalog, null, [], 'undecided');
  const after = calculateGraduationProgress(items, catalog, null, [], 'undecided');
  assert.deepEqual(after, before);
});

test('correspondence offerings use per-report progress, not the legacy report evaluation controls or summary', () => {
  const correspondence = catalog.offerings.find(offering => offering.name === '債権総論' && offering.method === 'correspondence');
  const schooling = catalog.offerings.find(offering => offering.method === 'schooling');
  const evaluations = {
    [correspondence.id]: { offeringId: correspondence.id, finalGrade: null, reportGrade: 'D', schoolingGrade: null },
    [schooling.id]: { offeringId: schooling.id, finalGrade: null, reportGrade: 'A+', schoolingGrade: 'B-' },
  };
  const items = [item(correspondence.id), item(schooling.id)];
  assert.equal(usesLegacyReportEvaluation(correspondence), false);
  assert.equal(usesLegacyReportEvaluation(schooling), true);
  assert.equal(evaluationIsUnrated(correspondence, evaluationFor(correspondence.id, evaluations)), false);
  assert.equal(evaluationIsUnrated(schooling, evaluationFor(schooling.id, evaluations)), false);
  assert.deepEqual(evaluationSummary(items, evaluations, offeringsById), { reportsEntered: 1, reportEligibleTotal: 1, schoolingsEntered: 1 });
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

test('2026 thesis credit metadata is department-specific and economics/commerce use their professional total', () => {
  assert.equal(thesisCreditsForDepartment('経済学科'), 6);
  assert.equal(thesisCreditsForDepartment('商業学科'), 6);
  assert.equal(thesisCreditsForDepartment('法律学科'), 4);
  assert.equal(thesisCreditsForDepartment('日本文学科'), 8);
  assert.equal(thesisCreditsForDepartment('史学科'), 8);
  assert.equal(thesisCreditsForDepartment('地理学科'), 8);
  assert.equal(thesisCreditsForDepartment(null), null);
  assert.deepEqual(THESIS_CREDIT_METADATA_2026['経済学科'], { credits: 6, sourcePages: [57] });
  assert.deepEqual(THESIS_CREDIT_METADATA_2026['商業学科'], { credits: 6, sourcePages: [59] });

  const economics = catalog.programs.find(program => program.department === '経済学科').scopeId;
  const commerce = catalog.programs.find(program => program.department === '商業学科').scopeId;
  for (const [scope, department] of [[economics, 'economics'], [commerce, 'commerce']]) {
    const total = calculateGraduationProgress([], catalog, scope).cards.find(card => card.requirementId === `professional-${department}-total`);
    assert.equal(total.status, 'unsatisfied');
    assert.equal(total.target, 82);
    assert.equal(total.reason, null);
    assert.equal(total.coverageStatus, 'partial');
    assert.equal(total.sourceRefs[0].page, department === 'economics' ? 'p.57' : 'p.59');
    assert.equal(calculateGraduationProgress([], catalog, scope).cards.some(card => card.requirementId === `professional-${department}-elective`), false);
  }

  const literatureThesisSources = sourcesForGraduationCard('japanese_literature_thesis_required_course', 49, '卒業論文');
  assert.equal(literatureThesisSources[0].page, 'p.49');
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
            && (requirement.target.requirement_type === '選択必修'
              || requirement.target.requirement_type === undefined)))).map(requirement => ({
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

test('law, economics and commerce use their official required-elective thresholds', () => {
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
    assert.equal(required.status, 'satisfied');
    assert.equal(required.earned, threshold);
    if (prefix !== 'law') {
      const total = progress.cards.find(row => row.requirementId === `professional-${prefix}-total`);
      assert.equal(total.earned, threshold + 4);
      assert.equal(total.target, 82);
      assert.equal(progress.cards.some(row => row.requirementId === `professional-${prefix}-elective`), false);
    }
    assert.equal(progress.graduationCheckComplete, false);
  }
  const law = professionalFixture('法律学科', Array.from({ length: 8 }, (_, i) => [`law-${i}`, '選択必修']), Array.from({ length: 8 }, (_, i) => [`law-${i}`, 4, [`law-${i}`]]));
  const required = calculateGraduationProgress(law.catalog.offerings.map(o => item(o.id, 'earned')), law.catalog, law.scope).cards.find(row => row.requirementId === 'professional-law-required-elective');
  assert.equal(required.details[0].earned, 8);
  assert.equal(required.status, 'satisfied');
});

test('commerce professional total counts required-elective overflow once without an elective target', () => {
  const fixture = professionalFixture('商業学科', [
    ...Array.from({ length: 7 }, (_, index) => [`required-${index}`, '選択必修']), ['elective', '選択'],
  ], Array.from({ length: 7 }, (_, index) => [`required-${index}`, 4, [`required-${index}`]]));
  const items = fixture.catalog.offerings.map(offering => item(offering.id, 'earned'));
  const progress = calculateGraduationProgress(items, fixture.catalog, fixture.scope);
  const required = progress.cards.find(row => row.requirementId === 'professional-commerce-required-elective');
  const total = progress.cards.find(row => row.requirementId === 'professional-commerce-total');
  assert.equal(required.earned, 20); // the 20-credit requirement remains capped at its own target
  assert.equal(total.earned, 28); // 28 earned credits, including the 8-credit required-elective excess once
  assert.equal(progress.graduationCheckComplete, false);
});

test('economics and commerce complete their independent required-elective and 82-credit professional checks', () => {
  for (const [department, threshold, prefix] of [['経済学科', 24, 'economics'], ['商業学科', 20, 'commerce']]) {
    const fixture = professionalFixture(department, [['required', '選択必修'], ['elective', '選択']], [
      ['required-short', threshold - 1, ['required']], ['required-full', threshold, ['required']],
      ['professional-81', 81 - threshold, ['elective']], ['professional-82', 82 - threshold, ['elective']],
    ]);
    const card = (items, suffix) => calculateGraduationProgress(items, fixture.catalog, fixture.scope).cards
      .find(row => row.requirementId === `professional-${prefix}-${suffix}`);
    assert.equal(card([item('required-short', 'earned')], 'required-elective').status, 'unsatisfied');
    assert.equal(card([item('required-full', 'earned')], 'required-elective').status, 'satisfied');
    assert.equal(card([item('required-full', 'earned'), item('professional-81', 'earned')], 'total').status, 'unsatisfied');
    assert.equal(card([item('required-full', 'earned'), item('professional-82', 'earned')], 'total').status, 'satisfied');
  }
});

test('economics professional total counts thesis, imports, and each completed identity once', () => {
  const fixture = professionalFixture('経済学科', [['required', '選択必修'], ['elective', '選択'], ['thesis', '選択']], [
    ['required-course', 24, ['required']], ['elective-course', 52, ['elective']], ['thesis-course', 6, ['thesis']],
  ]);
  for (const offering of fixture.catalog.offerings) offering.courseId = offering.id;
  fixture.catalog.offerings.find(offering => offering.id === 'thesis-course').name = '卒業論文';
  const total = (items, imported = []) => calculateGraduationProgress(items, fixture.catalog, fixture.scope, [], 'undecided', [], imported).cards
    .find(row => row.requirementId === 'professional-economics-total');
  assert.equal(total([item('required-course', 'earned'), item('elective-course', 'earned'), item('thesis-course', 'earned')]).earned, 82);
  assert.equal(total([item('required-course', 'earned'), { ...item('elective-course', 'earned'), offeringId: 'elective-course' }, item('thesis-course', 'earned')]).earned, 82);

  const imported = { id: 'economics-import', fingerprint: 'economics-import', source: 'hosei_import', rawName: 'elective-course', categoryRaw: null, capturedAt: '', earnedCreditsTotal: 52, schoolingCreditsTotal: 0, compositionCredits: 52, recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source', courseId: 'elective-course', selectedOfferingId: 'elective-course', selectionSource: 'auto', match: 'exact_unique', candidateOfferingIds: ['elective-course'] };
  const importedOnly = total([item('required-course', 'earned'), item('thesis-course', 'earned')], [imported]);
  const duplicatePlanner = total([item('required-course', 'earned'), item('elective-course', 'earned'), item('thesis-course', 'earned')], [imported]);
  assert.equal(importedOnly.earned, 82);
  assert.equal(duplicatePlanner.earned, 82);
  assert.equal(importedOnly.status, 'satisfied');
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

test('geography 2026 staged transfers allocate each completed identity once and cap only the official rules', () => {
  const allocate = (kind, credits) => allocateGeographyTransfers(kind, credits.map((value, index) => ({ id: `${kind}-${index}`, credits: value, status: 'earned' })));
  assert.deepEqual(allocate('fieldStudy', [1, 1]).allocations.map(row => [row.bucket, row.credits]), [['スクーリング必修', 1], ['スクーリング必修', 1]]);
  assert.deepEqual(allocate('fieldStudy', [1, 1, 1, 1, 1]).allocations.map(row => [row.bucket, row.credits]), [['スクーリング必修', 1], ['スクーリング必修', 1], ['選択', 1], ['選択', 1]]);
  assert.equal(allocate('fieldStudy', [1, 1, 1, 1, 1]).discarded, 1);
  assert.deepEqual(allocate('humanSeminar', [2, 2, 2]).allocations.map(row => [row.bucket, row.credits]), [['スクーリング必修', 2], ['選択必修:人文地理の分野', 2], ['選択', 2]]);
  assert.deepEqual(allocate('naturalSeminar', [2, 2, 2]).allocations.map(row => [row.bucket, row.credits]), [['スクーリング必修', 2], ['選択必修:自然地理の分野', 2], ['選択', 2]]);
  assert.deepEqual(allocate('chorography', [2, 2]).allocations.map(row => [row.bucket, row.credits]), [['選択必修:地誌・その他の分野', 2], ['選択', 2]]);
  const lectures = allocate('geographyLecture', [2, 2, 2]);
  assert.equal(lectures.allocations.reduce((sum, row) => sum + row.credits, 0), 4);
  assert.equal(lectures.discarded, 2);
  for (const kind of ['fieldStudy', 'chorography', 'humanSeminar', 'naturalSeminar', 'geographyLecture']) {
    const rows = allocate(kind, kind === 'fieldStudy' ? [1, 1, 1, 1] : [2, 2, 2]).allocations;
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length, `${kind} never assigns an identity to two buckets`);
  }
});

test('geography 2026 staged transfers share capacity across earned, in-progress, and planned rows', () => {
  const allocate = (kind, rows) => allocateGeographyTransfers(kind, rows.map(([credits, status], index) => ({
    id: `${kind}-${index}`, credits, status,
  })));
  const buckets = result => result.allocations.map(row => [row.status, row.bucket, row.credits]);

  assert.deepEqual(buckets(allocate('fieldStudy', [[1, 'earned'], [1, 'earned'], [1, 'in_progress']])), [
    ['earned', 'スクーリング必修', 1], ['earned', 'スクーリング必修', 1], ['in_progress', '選択', 1],
  ]);
  assert.deepEqual(buckets(allocate('fieldStudy', [[1, 'earned'], [1, 'earned'], [1, 'earned'], [1, 'earned'], [1, 'planned']])), [
    ['earned', 'スクーリング必修', 1], ['earned', 'スクーリング必修', 1], ['earned', '選択', 1], ['earned', '選択', 1],
  ]);
  assert.deepEqual(buckets(allocate('humanSeminar', [[2, 'earned'], [2, 'in_progress']])), [
    ['earned', 'スクーリング必修', 2], ['in_progress', '選択必修:人文地理の分野', 2],
  ]);
  assert.deepEqual(buckets(allocate('naturalSeminar', [[2, 'earned'], [2, 'planned']])), [
    ['earned', 'スクーリング必修', 2], ['planned', '選択必修:自然地理の分野', 2],
  ]);
  assert.deepEqual(buckets(allocate('chorography', [[2, 'earned'], [2, 'planned']])), [
    ['earned', '選択必修:地誌・その他の分野', 2], ['planned', '選択', 2],
  ]);
  assert.deepEqual(buckets(allocate('geographyLecture', [[2, 'earned'], [2, 'earned'], [2, 'planned']])), [
    ['earned', '選択', 2], ['earned', '選択', 2],
  ]);
});

test('geography transfer does not treat incomplete curriculum-credit metadata as completed', () => {
  const geography = professionalFixture('地理学科', [['field', 'スクーリング必修', null, null]], [['field', 1, ['field'], 'schooling']]);
  geography.catalog.offerings[0].name = '現地研究（夏期スクーリング）';
  const card = calculateGraduationProgress([item('field', 'earned')], geography.catalog, geography.scope).cards
    .find(row => row.requirementId === 'professional-geography-schooling-required');
  assert.equal(card.status, 'unknown');
  assert.equal(card.earned, null);
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

test('a passed report counts immediately even when its optional grade is not recorded', () => {
  const offering = catalog.offerings.find(current => current.name === '債権総論' && current.method === 'correspondence');
  const saved = progressForCorrespondence(offering, {});
  const onePassed = setReportStatus(saved, 1, 'passed');
  const allPassed = setReportStatus(onePassed, 2, 'passed');
  assert.equal(onePassed.reports[0].grade, null, 'selecting passed does not invent a report grade');
  assert.equal(correspondenceProgressSummary(onePassed), 'リポート 1/2・試験 未受験');
  assert.equal(correspondenceCreditResult(allPassed).reportsPassed, true);
  assert.equal(correspondenceCreditResult({ ...allPassed, examGrade: 'C-' }).creditEarned, true);
  assert.equal(validateState({ ...initialState(), items: [item(offering.id)], correspondenceProgress: { [offering.id]: allPassed } }, catalog), true);
});

test('structured correspondence requirements are keyed by offering ID only', () => {
  const mapped = catalog.offerings.find(current => current.id === '04050f27-c605-44c1-ae02-785c42114cd3');
  assert.equal(structuredRequirementCount, 10);
  assert.deepEqual(correspondenceRequirementFor(mapped), { requiredReports: 2, sourcePage: 39, sourceLabel: '法律-1' });
  assert.equal(correspondenceRequirementFor({ ...mapped, id: 'same-name-different-offering' }), null);
  assert.equal(correspondenceRequirementFor({ ...mapped, method: 'schooling' }), null);
  assert.equal(correspondenceRequirementFor(catalog.offerings.find(current => current.id === '0266ca03-b3ac-4e19-813a-2abfa866a551')), null);
  assert.equal(correspondenceRequirementFor(catalog.offerings.find(current => current.id === '4ab48e97-5f24-4017-b9b5-6d64dc38ccd6')), null);
});

test('unknown correspondence requirements never claim credit and v6 migration retains all prior fields', () => {
  const unknown = catalog.offerings.find(current => current.method === 'correspondence' && current.name === '社会経済思想史');
  const progress = progressForCorrespondence(unknown, {});
  assert.equal(progress.requiredReports, null);
  assert.equal(correspondenceCreditResult(progress).creditEarned, null);
  const legacy = { ...initialState(), schemaVersion: 6, correspondenceProgress: undefined };
  delete legacy.correspondenceProgress;
  const loaded = loadState(memoryStore(JSON.stringify(legacy)), catalog);
  assert.equal(loaded.state.schemaVersion, 17);
  assert.deepEqual(loaded.state.correspondenceProgress, {});
  assert.deepEqual(loaded.state.courseEvaluations, legacy.courseEvaluations);
  assert.deepEqual(loaded.state.mediaSchoolingProgress, legacy.mediaSchoolingProgress);
});

test('v7 migration preserves legacy values while adding study year and null final grades', () => {
  const legacy = { ...initialState(), schemaVersion: 7, items: [{ offeringId: first.id, status: 'in_progress', plannedYear: 2026, plannedTerm: '春休み', earnedOrder: null }], publicCourses: [{ id: '44444444-4444-4444-8444-444444444444', title: '公開科目', status: 'planned', plannedYear: 2027, plannedTerm: '夏期', credits: 2 }], courseEvaluations: { [first.id]: { offeringId: first.id, reportGrade: 'A', schoolingGrade: 'B' } } };
  const loaded = loadState(memoryStore(JSON.stringify(legacy)), catalog);
  assert.equal(loaded.error, null); assert.equal(loaded.state.schemaVersion, 17);
  assert.deepEqual(loaded.state.items[0], { ...legacy.items[0], studyYear: null });
  assert.equal(loaded.state.publicCourses[0].studyYear, null); assert.equal(loaded.state.publicCourses[0].finalGrade, null);
  assert.deepEqual(loaded.state.courseEvaluations[first.id], { ...legacy.courseEvaluations[first.id], finalGrade: null });
});

test('plan-table helpers distinguish form, preserve unknown denominators, and do not infer earned status', () => {
  const correspondence = catalog.offerings.find(offering => offering.method === 'correspondence');
  const media = catalog.offerings.find(isMediaSchooling); const schooling = catalog.offerings.find(offering => offering.method === 'schooling' && !isMediaSchooling(offering));
  const correspondenceProgress = { [correspondence.id]: { ...progressForCorrespondence(correspondence, {}), requiredReports: null, examGrade: 'A' } };
  const mediaProgress = { [media.id]: { offeringId: media.id, totalLessons: null, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }] } };
  assert.equal(offeringFormLabel(correspondence), '通信'); assert.equal(offeringFormLabel(media), 'メディア'); assert.equal(offeringFormLabel(schooling), 'スクーリング');
  assert.equal(correspondenceProgressSummary(correspondenceProgress[correspondence.id]), 'リポート要件 未確認・試験 A');
  assert.equal(mediaProgressText(mediaProgress[media.id]), '動画 1・テスト 0');
  assert.equal(progressSummaryForOffering(item(correspondence.id, 'planned'), correspondence, correspondenceProgress, mediaProgress), 'リポート要件 未確認・試験 A');
  assert.equal(progressSummaryForOffering(item(schooling.id, 'planned'), schooling, correspondenceProgress, mediaProgress), '計画中');
  assert.equal(isStandardTerm('前期'), true); assert.equal(isStandardTerm('春休み'), false);
});

test('media assessments are optional, preserve all supported types, and survive v8 migration', () => {
  const media = catalog.offerings.find(isMediaSchooling);
  const base = progressFor(media.id, {});
  const midterm = { id: 'midterm', type: 'midterm', label: '中間試験', scheduledDate: null, completed: false };
  const final = { id: 'final', type: 'final', label: '期末試験', scheduledDate: '2026-08-01', completed: true };
  const other = { id: 'other', type: 'other', label: 'レポート', scheduledDate: null, completed: false };
  const withAll = addAssessment(addAssessment(addAssessment(base, midterm), final), other);
  assert.equal(withAll.assessments.length, 3); assert.equal(withAll.totalLessons, null);
  assert.deepEqual(updateAssessment(withAll, 'midterm', { completed: true }).assessments[0], { ...midterm, completed: true });
  assert.deepEqual(removeAssessment(withAll, 'final').assessments.map(entry => entry.id), ['midterm', 'other']);
  assert.equal(setTotalLessons(base, 14)?.totalLessons, 14); assert.equal(setTotalLessons(base, 15)?.totalLessons, 15);
  const v8 = { ...initialState(), schemaVersion: 8, mediaSchoolingProgress: { [media.id]: { offeringId: media.id, totalLessons: 15, lessons: [] } } };
  const loaded = loadState(memoryStore(JSON.stringify(v8)), catalog);
  assert.equal(loaded.state.schemaVersion, 17); assert.deepEqual(loaded.state.mediaSchoolingProgress[media.id].assessments, []);
  const state = { ...initialState(), items: [item(media.id)], mediaSchoolingProgress: { [media.id]: withAll } };
  const raw = JSON.stringify(state); assert.deepEqual(loadState(memoryStore(raw), catalog).state.mediaSchoolingProgress[media.id].assessments, withAll.assessments);
});

test('planner export presentation includes current catalog and public rows in study-year order without exporting orphans', () => {
  const correspondence = catalog.offerings.find(offering => offering.name === '債権総論' && offering.method === 'correspondence');
  const unknownCorrespondence = catalog.offerings.find(offering => offering.method === 'correspondence' && offering.name === '社会経済思想史');
  const schooling = catalog.offerings.find(offering => offering.method === 'schooling' && !isMediaSchooling(offering));
  const media = catalog.offerings.filter(isMediaSchooling).slice(0, 3);
  const state = {
    ...initialState(), selectedScopeId: catalog.programs.find(program => program.department === '法律学科').scopeId,
    items: [
      { ...item(correspondence.id, 'failed'), studyYear: 1, plannedYear: 2026, plannedTerm: '前期' },
      { ...item(media[0].id, 'in_progress'), studyYear: 2, plannedYear: 2027, plannedTerm: '後期' },
      { ...item(media[1].id, 'waiting'), studyYear: 3, plannedYear: 2028, plannedTerm: null },
      { ...item(media[2].id, 'dropped'), studyYear: 4, plannedYear: null, plannedTerm: '夏期' },
      { ...item(unknownCorrespondence.id, 'earned'), studyYear: null, plannedYear: 2029, plannedTerm: '保存済みの時期' },
      { ...item(schooling.id, 'planned'), studyYear: null, plannedYear: null, plannedTerm: null },
    ],
    publicCourses: [{ ...publicCourse('export-public', 'earned', '公開,\"科目\"'), studyYear: 2, plannedYear: 2030, plannedTerm: '通年', finalGrade: 'A+' }],
    correspondenceProgress: {
      [correspondence.id]: { ...progressForCorrespondence(correspondence, {}), reports: [{ reportNumber: 1, status: 'passed', grade: 'A' }, { reportNumber: 2, status: 'passed', grade: 'B' }], examGrade: 'A' },
      [unknownCorrespondence.id]: { offeringId: unknownCorrespondence.id, requiredReports: null, reports: [], examGrade: 'C' },
      orphan: { offeringId: 'orphan', requiredReports: 2, reports: [], examGrade: 'A' },
    },
    mediaSchoolingProgress: {
      [media[0].id]: { offeringId: media[0].id, totalLessons: 14, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: true }], assessments: [{ id: 'mid', type: 'midterm', label: '中間試験', scheduledDate: '2026-06-10', completed: true }] },
      [media[1].id]: { offeringId: media[1].id, totalLessons: 15, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }], assessments: [] },
      [media[2].id]: { offeringId: media[2].id, totalLessons: null, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }], assessments: [{ id: 'other', type: 'other', label: '口頭試問', scheduledDate: null, completed: false }] },
      orphan: { offeringId: 'orphan', totalLessons: 14, lessons: [], assessments: [{ id: 'hidden', type: 'final', label: '期末試験', scheduledDate: '2026-12-20', completed: false }] },
    },
    courseEvaluations: { [correspondence.id]: { offeringId: correspondence.id, finalGrade: 'S', reportGrade: null, schoolingGrade: null } },
  };
  const before = JSON.stringify(state);
  const presentation = plannerExportPresentation(state, catalog);
  assert.equal(JSON.stringify(state), before);
  assert.equal(catalog.offerings.length, 686);
  assert.deepEqual(presentation.rows.map(row => row.studyYear), [1, 2, 2, 3, 4, null, null]);
  const correspondenceRow = presentation.rows.find(row => row.title === correspondence.name);
  assert.deepEqual({ year: correspondenceRow.plannedYear, term: correspondenceRow.plannedTerm, final: correspondenceRow.finalGrade, reports: correspondenceRow.passedReports, exam: correspondenceRow.examGrade, result: correspondenceRow.correspondenceResult }, { year: 2026, term: '前期', final: 'S', reports: 2, exam: 'A', result: '単位修得条件達成' });
  const unknownRow = presentation.rows.find(row => row.title === unknownCorrespondence.name);
  assert.deepEqual({ required: unknownRow.requiredReports, passed: unknownRow.passedReports, result: unknownRow.correspondenceResult, progress: unknownRow.progressSummary }, { required: null, passed: null, result: '判定不可', progress: 'リポート要件 未確認・試験 C' });
  assert.deepEqual(presentation.rows.filter(row => row.formLabel === 'メディア').map(row => [row.totalLessons, row.completedVideos, row.completedTests, row.assessmentSummary]), [[14, 1, 1, '中間試験 2026/06/10 実施済み'], [15, 1, 0, null], [null, 1, 0, '口頭試問 日程未設定 未実施']]);
  assert.equal(presentation.rows.find(row => row.sourceType === 'public').classificationLabel, '専門教育');
  assert.equal(presentation.rows.some(row => row.assessmentSummary?.includes('2026/12/20')), false);
});

test('planner export CSV writes UTF-8 BOM, headers, RFC4180 escaping, and leaves unknown fields empty', () => {
  const presentation = {
    affiliation: '法学部 / 法律学科',
    rows: [{ sourceType: 'public', plannedYear: null, studyYear: null, plannedTerm: null, title: '科目,\"引用\"\n改行', credits: null, formLabel: '公開科目', statusLabel: '取りやめ', progressSummary: '—', finalGrade: null, classificationLabel: null, requiredReports: null, passedReports: null, examGrade: null, correspondenceResult: null, totalLessons: null, completedVideos: null, completedTests: null, assessmentSummary: null }],
  };
  const csv = plannerExportCsv(presentation);
  assert.ok(csv.startsWith('\uFEFF所属,計画年度,履修学年,履修時期,科目名,'));
  assert.match(csv, /"科目,""引用""\n改行"/);
  assert.match(csv, /法学部 \/ 法律学科,,,,"科目,/);
  assert.ok(csv.includes('\r\n'));
  assert.equal(plannerExportFileName(new Date(2026, 8, 29)), 'hosei-planner-2026-09-29');
});

test('grade import contract accepts only complete v1 extension JSON and has no final grade field', () => {
  const schooling = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null };
  const value = {
    schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-09-29T00:00:00.000Z', courses: [{
      rawName: '論理学', categoryRaw: '***一般教育人文分野',
      compositionCredits: { raw: '4', value: 4 }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '4', value: 4 }, schoolingCredits: { raw: '', value: null },
      reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
      creditExam: { rawDate: '2026/07/01', rawCredits: '*4', rawGrade: 'D', date: '2026-07-01', credits: null, grade: 'D', pendingMarker: true }, schoolings: [schooling, schooling],
    }],
  };
  assert.equal(isHoseiGradeImportV1(value), true);
  assert.equal('finalGrade' in value.courses[0], false);
  assert.equal(isHoseiGradeImportV1({ ...value, schemaVersion: 2 }), false);
  assert.equal(isHoseiGradeImportV1({ ...value, courses: [{ ...value.courses[0], reports: [] }] }), false);
  assert.equal(isHoseiGradeImportV1({ ...value, capturedAt: 'not-a-date' }), false);
  assert.equal(isHoseiGradeImportV1({ ...value, courses: [{ ...value.courses[0], rawName: ' ' }] }), false);
  assert.equal(isHoseiGradeImportV1({ ...value, courses: [{ ...value.courses[0], earnedCredits: { raw: '-1', value: -1 } }] }), false);
  assert.equal(isHoseiGradeImportV1({ ...value, courses: [{ ...value.courses[0], creditExam: { ...value.courses[0].creditExam, date: '2026-02-30' } }] }), false);
});

test('grade import skips empty correspondence and infers schooling years without replacing source years', () => {
  const course = { rawName: '共通名', categoryRaw: null, compositionCredits: { raw: '4', value: 4 }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '4', value: 4 }, schoolingCredits: { raw: '2', value: 2 }, reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })), creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false }, schoolings: [{ rawYear: '25', rawTerm: '冬', rawDate: '26/01/26', rawCredits: '2', rawGrade: 'A', year: '25', term: '冬', date: '2026-01-26', credits: 2, grade: 'A' }, { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null }] };
  const data = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-09-29T00:00:00.000Z', courses: [course] };
  const offerings = [{ ...catalog.offerings[0], id: 'correspondence-id', name: '共通名', method: 'correspondence' }, { ...catalog.offerings[0], id: 'schooling-id', name: '共通名', method: 'schooling' }];
  const preview = importPreview(data, offerings);
  assert.equal(preview.length, 1); assert.equal(preview[0].method, 'schooling'); assert.equal(preview[0].academicYear, 2025); assert.equal(preview[0].yearSource, 'source'); assert.equal(schoolingAcademicYear('25'), 2025);
  const next = applyImport(initialState(), preview); assert.equal(next.importedStudyRecords.length, 1); assert.equal(next.items.length, 0); assert.equal(next.courseEvaluations && Object.keys(next.courseEvaluations).length, 0);
  assert.equal(importPreview(data, offerings, next.importedStudyRecords).every(row => row.duplicate), true);
});

test('grade import keeps pending correspondence and uses date or capture date for schooling inference', () => {
  const emptyReports = Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null }));
  const course = { rawName: '年度推定', categoryRaw: null, compositionCredits: { raw: '', value: null }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '', value: null }, schoolingCredits: { raw: '', value: null }, reports: emptyReports, creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: true }, schoolings: [{ rawYear: '', rawTerm: '冬', rawDate: '26/01/26', rawCredits: '2', rawGrade: 'A', year: null, term: '冬', date: '2026-01-26', credits: 2, grade: 'A' }, { rawYear: '', rawTerm: '夏', rawDate: '', rawCredits: '2', rawGrade: 'A', year: null, term: '夏', date: null, credits: 2, grade: 'A' }] };
  const data = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-07-01T00:00:00.000Z', courses: [course] };
  const preview = importPreview(data, []);
  assert.equal(hasCorrespondenceEvidence(course), true);
  assert.deepEqual(preview.map(unit => [unit.method, unit.academicYear, unit.yearSource]), [['correspondence', 2026, 'inferred'], ['schooling', 2025, 'inferred'], ['schooling', 2026, 'inferred']]);
  const explicit = { ...course, schoolings: [{ ...course.schoolings[0], rawYear: '25', year: '25', date: '2026-07-01' }] };
  const explicitPreview = importPreview({ ...data, courses: [explicit] }, []);
  assert.deepEqual(explicitPreview.find(unit => unit.method === 'schooling') && [explicitPreview.find(unit => unit.method === 'schooling').academicYear, explicitPreview.find(unit => unit.method === 'schooling').yearSource], [2025, 'source']);
});

test('grade import infers academic years and selects every non-duplicate component', () => {
  const reports = Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null }));
  const makeCourse = (name, examDate, reportDates = []) => ({ rawName: name, categoryRaw: null, compositionCredits: { raw: '2', value: 2 }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '', value: null }, schoolingCredits: { raw: '', value: null }, reports: reports.map((report, index) => ({ ...report, date: reportDates[index] ?? null })), creditExam: { rawDate: examDate ?? '', rawCredits: '', rawGrade: '', date: examDate, credits: null, grade: null, pendingMarker: false }, schoolings: [{ rawYear: '', rawTerm: '夏', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: '夏', date: null, credits: null, grade: null }, { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null }] });
  const data = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-04-01T00:00:00.000Z', courses: [makeCourse('一致', '2026-07-19'), makeCourse('曖昧', '2026-01-26'), makeCourse('未一致', null, ['2025-04-02', '2026-03-31']), makeCourse('日時なし', null)] };
  const offerings = [{ ...catalog.offerings[0], id: 'exact', name: '一致', method: 'correspondence' }, { ...catalog.offerings[0], id: 'ambiguous-1', name: '曖昧', method: 'correspondence' }, { ...catalog.offerings[0], id: 'ambiguous-2', name: '曖昧', method: 'correspondence' }];
  const preview = importPreview(data, offerings);
  assert.deepEqual(preview.filter(unit => unit.method === 'correspondence').map(unit => [unit.rawName, unit.academicYear, unit.yearSource, unit.selected]), [['一致', 2026, 'inferred', true], ['曖昧', 2025, 'inferred', true], ['未一致', 2025, 'inferred', true]]);
  assert.equal(academicYearFromDate('2026-03-31'), 2025); assert.equal(academicYearFromDate('2026-04-01'), 2026);
  assert.deepEqual(inferredCorrespondenceYear(makeCourse('x', null, ['2026-01-01', '2026-04-01']), data.capturedAt), { academicYear: 2026, date: '2026-04-01' });
  const applied = applyImport(initialState(), preview); const duplicatePreview = importPreview(data, offerings, applied.importedStudyRecords, applied.importedCourseAchievements);
  assert.ok(duplicatePreview.every(unit => unit.duplicate && !unit.selected));
  assert.equal(applied.items.length, 0); assert.equal(Object.keys(applied.courseEvaluations).length, 0);
});

test('imported achievement grouping and manual edits preserve import identity', () => {
  const unit = importPreview({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-09-29T00:00:00.000Z', courses: [{ rawName: '古い実績', categoryRaw: null, compositionCredits: { raw: '2', value: 2 }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '', value: null }, schoolingCredits: { raw: '', value: null }, reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })), creditExam: { rawDate: '2025/03/31', rawCredits: '', rawGrade: '', date: '2025-03-31', credits: null, grade: null, pendingMarker: false }, schoolings: [] }] }, [], [])[0];
  const state = applyImport(initialState(), [unit]); const edited = { ...state.importedStudyRecords[0], academicYear: 2024, yearSource: 'manual', term: '冬' };
  assert.equal(edited.fingerprint, state.importedStudyRecords[0].fingerprint); assert.equal(edited.yearSource, 'manual'); assert.equal(edited.term, '冬');
  assert.deepEqual(groupImportedAchievements([edited, { ...edited, id: 'newer', academicYear: 2026 }, { ...edited, id: 'none', academicYear: null }]).map(([year]) => year), [2026, 2024, null]);
  assert.equal(state.items.length, 0); assert.equal(Object.keys(state.courseEvaluations).length, 0);
  const persisted = { ...state, importedStudyRecords: [edited] }; const store = memoryStore(); const raw = saveState(store, persisted, null, catalog);
  assert.deepEqual(loadState(store, catalog), { state: persisted, raw, error: null });
});

test('direct handoff accepts only contract JSON, makes a preview, and never applies it itself', () => {
  const emptySchooling = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null };
  const data = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-09-29T00:00:00.000Z', courses: [{ rawName: '確認用科目', categoryRaw: null, compositionCredits: { raw: '2', value: 2 }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '', value: null }, schoolingCredits: { raw: '', value: null }, reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })), creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false }, schoolings: [emptySchooling, emptySchooling] }] };
  const offerings = [{ ...catalog.offerings[0], id: 'direct-offering', name: '確認用科目', method: 'correspondence' }];
  const accepted = previewDirectGradeHandoff(data, offerings, []);
  assert.ok(accepted); assert.equal(accepted.units.length, 1); assert.equal(applyImport(initialState(), []).importedStudyRecords.length, 0);
  assert.equal(previewDirectGradeHandoff({ ...data, schemaVersion: 2 }, offerings, []), null);
  const handoffToken = '11111111-1111-4111-8111-111111111111';
  assert.equal(gradeHandoffToken(`#hosei-import=${handoffToken}`), handoffToken);
  assert.equal(gradeHandoffToken('#hosei-import=wrong'), null);
  assert.equal(isGradeHandoffResponse({ type: 'hosei-grade-handoff-response', ok: true, token: handoffToken, importData: data }, handoffToken), true);
  assert.equal(isGradeHandoffResponse({ type: 'hosei-grade-handoff-response', ok: true, token: 'wrong' }, handoffToken), false);
});

test('imported course aggregates count once, reject unsafe links, and expose media history without progress', () => {
  const media = catalog.offerings.find(offering => isMediaSchooling(offering) && offering.courseId !== null && offering.resolutionStatus === 'matched');
  const other = catalog.offerings.find(offering => offering.courseId !== null && offering.resolutionStatus === 'matched' && offering.id !== media.id);
  const make = (id, offeringId, patch = {}) => ({ id, fingerprint: id, source: 'hosei_import', rawName: offeringId ? offeringsById.get(offeringId).name : '未照合', offeringId, match: offeringId ? 'exact_unique' : 'unmatched', method: 'schooling', academicYear: 2025, yearSource: 'source', rawYear: '25', term: '夏', rawTerm: '夏', date: '2025-08-01', credits: 2, grade: 'S', sourceCourseId: `row-${id}`, earnedCreditsTotal: 4, schoolingCreditsTotal: 2, compositionCredits: 4, recognizedExemption: null, additionalEnrollment: null, capturedAt: '2026-09-29T00:00:00.000Z', ...patch });
  // Two components share one source row: 4 is the row aggregate, never 2 + 2 + 4.
  const pair = [make('s', media.id, { sourceCourseId: 'row-a' }), make('c', other.id, { sourceCourseId: 'row-a', method: 'correspondence', credits: 2, grade: 'A' })];
  const derived = deriveImportedAchievements(pair, offeringsById, []);
  assert.equal(derived.items.length, 0, 'different course identities are ambiguous and must not count');
  const exact = deriveImportedAchievements([make('exact', media.id)], offeringsById, []);
  assert.equal(exact.items.length, 1); assert.equal(exact.offerings[0].credits, 4); assert.equal(exact.media.length, 1);
  assert.equal(exact.media[0].records.length, 1, 'history has no lesson/video/test state');
  assert.equal(deriveImportedAchievements([make('zero', media.id, { earnedCreditsTotal: 0 })], offeringsById, []).items.length, 0);
  assert.equal(deriveImportedAchievements([make('unmatched', null)], offeringsById, []).items.length, 0);
  assert.equal(deriveImportedAchievements([make('legacy', media.id, { sourceCourseId: undefined, earnedCreditsTotal: undefined })], offeringsById, []).items.length, 0);
  assert.equal(deriveImportedAchievements([make('dedupe', media.id)], offeringsById, [item(media.id, 'earned')]).items.length, 0);
  assert.equal(deriveImportedAchievements([make('non-media', other.id)], offeringsById, []).media.length, 0);
});

test('safe imported achievements feed credit and category summaries without changing the plan', () => {
  const scope = selectablePrograms(catalog)[0].scopeId;
  const classify = createCreditClassifier(catalog, scope);
  const offering = catalog.offerings.find(value => value.courseId !== null && value.resolutionStatus === 'matched' && ['一般教育：人文', '一般教育：社会', '一般教育：自然', '一般教育：その他', '外国語', '保健体育', '専門教育'].includes(classify(value)));
  assert.ok(offering);
  const record = { id: 'safe-summary', fingerprint: 'safe-summary', source: 'hosei_import', rawName: offering.name, offeringId: offering.id, match: 'exact_unique', method: offering.method, academicYear: 2025, yearSource: 'source', rawYear: '25', term: null, rawTerm: null, date: null, credits: null, grade: 'S', sourceCourseId: 'safe-summary-row', earnedCreditsTotal: 4, schoolingCreditsTotal: null, compositionCredits: 4, recognizedExemption: null, additionalEnrollment: null, capturedAt: '2026-09-29T00:00:00.000Z' };
  const stateItems = [item(first.id, 'planned')];
  const before = structuredClone(stateItems);
  const derived = deriveImportedAchievements([record], offeringsById, stateItems);
  const mergedOfferings = new Map([...offeringsById, ...derived.offerings.map(value => [value.id, value])]);
  const summary = summarizeCredits([...stateItems, ...derived.items], mergedOfferings);
  assert.equal(summary.earned, 4);
  assert.equal(summary.in_progress, 0);
  assert.equal(summary.planned, first.credits ?? 0);
  assert.deepEqual(stateItems, before, 'calculation-only items never mutate state.items');
  const row = summarizeCategories(stateItems, catalog, scope, [], derived.items, derived.offerings).find(value => value.category === classify(offering));
  assert.equal(row.earned, 4);
  assert.equal(row.in_progress, 0);
  assert.equal(row.planned, 0);
  assert.equal(deriveImportedAchievements([{ ...record, id: 'unsafe', sourceCourseId: 'unsafe-row', offeringId: null, match: 'unmatched' }], offeringsById, []).items.length, 0);
  assert.equal(deriveImportedAchievements([record], offeringsById, [item(offering.id, 'earned')]).items.length, 0, 'planner-earned identity remains deduplicated');
  const graduation = calculateGraduationProgress(stateItems, catalog, scope, [], 'undecided', [record]);
  assert.equal(graduation.importedContributionCount, 1);
  assert.ok(graduation.cards.some(card => card.earned >= 4 && card.coverageStatus && card.sourceRefs?.length), 'the imported contribution remains visible in a covered, sourced graduation card');
  assert.equal(graduation.graduationCheckComplete, false);
});

test('imported media history requires an explicit link or unambiguous media term evidence', () => {
  const media = catalog.offerings.find(value => isMediaSchooling(value) && value.courseId !== null && value.resolutionStatus === 'matched');
  const normal = catalog.offerings.find(value => value.courseId === media.courseId && !isMediaSchooling(value) && value.resolutionStatus === 'matched');
  assert.ok(media); assert.ok(normal);
  const make = (id, patch = {}) => ({ id, fingerprint: id, source: 'hosei_import', rawName: normal.name, offeringId: normal.id, match: 'exact_unique', method: 'schooling', academicYear: 2025, yearSource: 'source', rawYear: '25', term: '夏', rawTerm: '夏', date: null, credits: 2, grade: 'S', sourceCourseId: id, earnedCreditsTotal: 2, schoolingCreditsTotal: 2, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, capturedAt: '2026-09-29T00:00:00.000Z', ...patch });
  assert.equal(deriveImportedAchievements([make('ordinary')], offeringsById, []).media.length, 0, 'ordinary schooling is not inferred as media');
  const termMatched = deriveImportedAchievements([make('term-matched', { rawTerm: media.deliveryCategory })], offeringsById, []);
  assert.equal(termMatched.media.length, 1); assert.equal(termMatched.media[0].offering.id, media.id);
  const explicit = deriveImportedAchievements([make('explicit', { offeringId: media.id, term: '夏', rawTerm: '夏' })], offeringsById, []);
  assert.equal(explicit.media.length, 1); assert.equal(explicit.media[0].offering.id, media.id);
  const duplicateMedia = { ...media, id: 'duplicate-media-candidate' };
  const ambiguousOfferings = new Map([...offeringsById, [duplicateMedia.id, duplicateMedia]]);
  assert.equal(deriveImportedAchievements([make('ambiguous', { rawTerm: media.deliveryCategory })], ambiguousOfferings, []).media.length, 0, 'ambiguous media candidates are not auto-selected');
});

test('source grade-table rows retain official earned credits without component details or a safe catalog match', () => {
  const course = name => ({ rawName: name, categoryRaw: null, compositionCredits: { raw: '2', value: 2 }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '2', value: 2 }, schoolingCredits: { raw: '', value: null }, reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })), creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false }, schoolings: [] });
  const data = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-09-29T00:00:00.000Z', courses: Array.from({ length: 20 }, (_, index) => course(`未照合${index}`)) };
  const preview = importPreview(data, []);
  const applied = applyImport(initialState(), preview);
  assert.equal(applied.importedStudyRecords.length, 0, 'no invented component is stored');
  assert.equal(applied.importedCourseAchievements.length, 20);
  assert.equal(importedEarnedCreditsTotal(applied.importedCourseAchievements), 40);
  const derived = deriveImportedAchievements(applied.importedStudyRecords, offeringsById, [], applied.importedCourseAchievements);
  assert.equal(derived.items.length, 0);
  assert.equal(derived.unclassified.length, 20);
});

test('reimport adds a missing source row even when its detail component already exists', () => {
  const course = { rawName: '再取込', categoryRaw: null, compositionCredits: { raw: '2', value: 2 }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '2', value: 2 }, schoolingCredits: { raw: '', value: null }, reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })), creditExam: { rawDate: '2026/07/01', rawCredits: '', rawGrade: '', date: '2026-07-01', credits: null, grade: null, pendingMarker: false }, schoolings: [] };
  const data = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-09-29T00:00:00.000Z', courses: [course] };
  const preview = importPreview(data, []);
  const legacyComponentOnly = { ...initialState(), importedStudyRecords: [preview[0]] };
  const reapplied = applyImport(legacyComponentOnly, importPreview(data, [], legacyComponentOnly.importedStudyRecords));
  assert.equal(reapplied.importedStudyRecords.length, 1);
  assert.equal(reapplied.importedCourseAchievements.length, 1);
  assert.equal(importedEarnedCreditsTotal(reapplied.importedCourseAchievements), 2);
});

test('source row identity ignores capture time and categoryRaw overrides a safe catalog category', () => {
  const offering = catalog.offerings.find(value => value.courseId !== null && value.resolutionStatus === 'matched' && value.credits !== null);
  const row = { id: 'row-category', fingerprint: 'stable', source: 'hosei_import', rawName: offering.name, categoryRaw: '外国語', capturedAt: '2026-09-29T00:00:00.000Z', earnedCreditsTotal: 2, schoolingCreditsTotal: null, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source', courseId: offering.courseId, selectedOfferingId: offering.id, match: 'exact_unique', candidateOfferingIds: [offering.id] };
  const derived = deriveImportedAchievements([], offeringsById, [], [row]);
  assert.equal(derived.categoryOverrides.get(`imported-category:${row.id}`), '外国語');
  const course = { rawName: '同一行', categoryRaw: null, compositionCredits: { raw: '2', value: 2 }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '2', value: 2 }, schoolingCredits: { raw: '', value: null }, reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })), creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false }, schoolings: [] };
  const firstImport = applyImport(initialState(), importPreview({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-09-29T00:00:00.000Z', courses: [course] }, []));
  const laterPreview = importPreview({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-01T00:00:00.000Z', courses: [course] }, [], firstImport.importedStudyRecords, firstImport.importedCourseAchievements);
  assert.ok(laterPreview.every(unit => unit.sourceDuplicate && !unit.selected));
});

test('ambiguous imported schooling is held for manual media resolution', () => {
  const media = catalog.offerings.find(value => isMediaSchooling(value) && value.courseId !== null && value.resolutionStatus === 'matched');
  const normal = catalog.offerings.find(value => value.courseId === media.courseId && value.method === 'schooling' && !isMediaSchooling(value));
  const record = { id: 'media-component', fingerprint: 'media-component', source: 'hosei_import', rawName: normal.name, offeringId: normal.id, match: 'exact_unique', method: 'schooling', academicYear: 2025, yearSource: 'source', rawYear: '25', term: '夏', rawTerm: '夏', date: null, credits: 2, grade: 'A', sourceCourseId: 'media-row', earnedCreditsTotal: 2, schoolingCreditsTotal: 2, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, capturedAt: '2026-09-29T00:00:00.000Z' };
  const row = { id: 'media-row', fingerprint: 'media-row', source: 'hosei_import', rawName: normal.name, categoryRaw: null, capturedAt: '2026-09-29T00:00:00.000Z', earnedCreditsTotal: 2, schoolingCreditsTotal: 2, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source', courseId: media.courseId, selectedOfferingId: null, match: 'exact_unique', candidateOfferingIds: [normal.id, media.id] };
  const pending = deriveImportedAchievements([record], offeringsById, [], [row]);
  assert.equal(pending.media.length, 0); assert.equal(pending.mediaPending[0].sourceCourseId, row.id);
  const resolved = deriveImportedAchievements([record], offeringsById, [], [{ ...row, selectedOfferingId: media.id }]);
  assert.equal(resolved.media.length, 1); assert.equal(resolved.media[0].offering.id, media.id);
});

test('raw categories count unmatched source rows once while graduation remains unmapped', () => {
  const rows = [['自然', 12], ['社会', 8], ['外国語', 4], ['専門', 16]].map(([categoryRaw, earnedCreditsTotal], index) => ({ id: `raw-${index}`, fingerprint: `raw-${index}`, source: 'hosei_import', rawName: `未照合${categoryRaw}`, categoryRaw, capturedAt: '', earnedCreditsTotal, schoolingCreditsTotal: null, compositionCredits: earnedCreditsTotal, recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched', candidateOfferingIds: [] }));
  const derived = deriveImportedAchievements([], offeringsById, [], rows);
  assert.equal(derived.items.length, 0, 'raw categories never enter graduation mapping');
  const categories = summarizeCategories([], catalog, catalog.programs.find(program => !program.isCommon).scopeId, [], derived.categoryItems, derived.categoryOfferings, derived.categoryOverrides);
  assert.equal(categories.find(row => row.category === '一般教育：自然').earned, 12);
  assert.equal(categories.find(row => row.category === '一般教育：社会').earned, 8);
  assert.equal(categories.find(row => row.category === '外国語').earned, 4);
  assert.equal(categories.find(row => row.category === '専門教育').earned, 16);
});

test('source rows upsert changed earned credits and auto normal schooling stays pending for media review', () => {
  const course = earned => ({ rawName: '更新科目', categoryRaw: null, compositionCredits: { raw: String(earned), value: earned }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: String(earned), value: earned }, schoolingCredits: { raw: '', value: null }, reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })), creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false }, schoolings: [] });
  const firstImport = applyImport(initialState(), importPreview({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-01-01T00:00:00.000Z', courses: [course(2)] }, []));
  const update = importPreview({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-02-01T00:00:00.000Z', courses: [course(4)] }, [], firstImport.importedStudyRecords, firstImport.importedCourseAchievements);
  const updated = applyImport(firstImport, update);
  assert.equal(updated.importedCourseAchievements.length, 1); assert.equal(importedEarnedCreditsTotal(updated.importedCourseAchievements), 4);
  const media = catalog.offerings.find(value => isMediaSchooling(value) && value.courseId !== null && value.resolutionStatus === 'matched'); const normal = catalog.offerings.find(value => value.courseId === media.courseId && value.method === 'schooling' && !isMediaSchooling(value));
  const component = { id: 'auto-normal', fingerprint: 'auto-normal', source: 'hosei_import', rawName: normal.name, offeringId: normal.id, match: 'exact_unique', method: 'schooling', academicYear: 2025, yearSource: 'source', rawYear: '25', term: '夏', rawTerm: '夏', date: null, credits: 2, grade: null, sourceCourseId: 'auto-row', earnedCreditsTotal: 2, schoolingCreditsTotal: 2, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, capturedAt: '' };
  const row = { id: 'auto-row', fingerprint: 'auto-row', source: 'hosei_import', rawName: normal.name, categoryRaw: null, capturedAt: '', earnedCreditsTotal: 2, schoolingCreditsTotal: 2, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source', courseId: normal.courseId, selectedOfferingId: normal.id, selectionSource: 'auto', match: 'exact_unique', candidateOfferingIds: [normal.id, media.id] };
  assert.equal(deriveImportedAchievements([component], offeringsById, [], [row]).mediaPending.length, 1);
  const manuallyResolved = deriveImportedAchievements([component], offeringsById, [], [{ ...row, selectedOfferingId: media.id, selectionSource: 'manual', candidateOfferingIds: [] }]);
  assert.equal(manuallyResolved.media[0].offering.id, media.id, 'manual search selection may use any catalog offering');
});

test('v13 repair safely restores catalog identity, orphan components, and pending media without a reimport', () => {
  const scope = selectablePrograms(catalog)[0].scopeId;
  const classify = createCreditClassifier(catalog, scope);
  const matched = catalog.offerings.find(value => value.courseId !== null && value.resolutionStatus === 'matched' && value.credits !== null && ['一般教育：人文', '一般教育：社会', '一般教育：自然', '一般教育：その他', '外国語', '保健体育', '専門教育'].includes(classify(value)));
  assert.ok(matched);
  const row = { id: 'repair-row', fingerprint: 'legacy-row', source: 'hosei_import', rawName: matched.name, categoryRaw: null, capturedAt: '', earnedCreditsTotal: 2, schoolingCreditsTotal: 2, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched', candidateOfferingIds: [] };
  const component = { id: 'orphan', fingerprint: 'orphan', source: 'hosei_import', rawName: matched.name, offeringId: null, match: 'unmatched', method: 'schooling', academicYear: 2025, yearSource: 'source', rawYear: '25', term: '夏', rawTerm: '夏', date: null, credits: 2, grade: 'A', sourceCourseId: 'gone', earnedCreditsTotal: 2, schoolingCreditsTotal: 2, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, capturedAt: '' };
  const legacy = { ...initialState(), schemaVersion: 12, importedCourseAchievements: [row], importedStudyRecords: [component] };
  const loaded = loadState(memoryStore(JSON.stringify(legacy)), catalog);
  assert.equal(loaded.error, null); assert.equal(loaded.state.schemaVersion, 17);
  assert.equal(loaded.state.importedCourseAchievements[0].courseId, matched.courseId);
  assert.equal(loaded.state.importedStudyRecords[0].sourceCourseId, row.id);
  const derived = deriveImportedAchievements(loaded.state.importedStudyRecords, offeringsById, [], loaded.state.importedCourseAchievements);
  assert.equal(derived.items.length, 1);
  const categories = summarizeCategories([], catalog, scope, [], derived.categoryItems, derived.categoryOfferings, derived.categoryOverrides);
  assert.equal(categories.find(value => value.category === classify(matched)).earned, 2, 'repaired catalog identity feeds the selected-scope category summary');
  // A row with schooling credits but no recoverable component is surfaced for
  // media review whenever its safely-repaired identity has a media option.
  const media = catalog.offerings.find(value => isMediaSchooling(value) && value.courseId !== null && value.resolutionStatus === 'matched');
  const mediaRow = { ...row, id: 'missing-schooling', rawName: media.name, courseId: null, selectedOfferingId: null, candidateOfferingIds: [] };
  const repaired = repairImportedAchievements({ ...initialState(), importedCourseAchievements: [mediaRow] }, catalog).state;
  const pending = deriveImportedAchievements([], offeringsById, [], repaired.importedCourseAchievements);
  assert.ok(pending.mediaPending.some(value => value.sourceCourseId === mediaRow.id));
});

test('v13 repair leaves manual and ambiguous data untouched, and import identity separates same-name attempts', () => {
  const matched = catalog.offerings.find(value => value.courseId !== null && value.resolutionStatus === 'matched');
  assert.ok(matched);
  const manual = { id: 'manual', fingerprint: 'manual', source: 'hosei_import', rawName: matched.name, categoryRaw: null, capturedAt: '', earnedCreditsTotal: 2, schoolingCreditsTotal: null, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: null, yearSource: 'unknown', courseId: 'manual-course', selectedOfferingId: 'manual-offering', selectionSource: 'manual', match: 'ambiguous', candidateOfferingIds: [] };
  const ambiguousCatalog = { ...catalog, offerings: [...catalog.offerings, { ...matched, id: 'duplicate-name', courseId: 'different-course' }] };
  const ambiguous = { ...manual, id: 'ambiguous', rawName: matched.name, courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched' };
  const repaired = repairImportedAchievements({ ...initialState(), importedCourseAchievements: [manual, ambiguous] }, ambiguousCatalog).state;
  assert.deepEqual(repaired.importedCourseAchievements, [manual, ambiguous]);
  const orphan = { id: 'ambiguous-orphan', fingerprint: 'ambiguous-orphan', source: 'hosei_import', rawName: matched.name, offeringId: null, match: 'unmatched', method: 'schooling', academicYear: null, yearSource: 'unknown', rawYear: null, term: null, rawTerm: null, date: null, credits: null, grade: null, sourceCourseId: 'gone', earnedCreditsTotal: 2, schoolingCreditsTotal: null, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, capturedAt: '' };
  const duplicateRows = [{ ...ambiguous, id: 'same-a', rawName: matched.name }, { ...ambiguous, id: 'same-b', rawName: matched.name }];
  assert.equal(repairImportedAchievements({ ...initialState(), importedCourseAchievements: duplicateRows, importedStudyRecords: [orphan] }, catalog).state.importedStudyRecords[0].sourceCourseId, 'gone', 'ambiguous orphan links are never guessed');
  const course = (term) => ({ rawName: '英語Ｓ', categoryRaw: null, compositionCredits: { raw: '2', value: 2 }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '2', value: 2 }, schoolingCredits: { raw: '2', value: 2 }, reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })), creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false }, schoolings: [{ rawYear: '25', rawTerm: term, rawDate: '', rawCredits: '2', rawGrade: 'A', year: '25', term, date: null, credits: 2, grade: 'A' }, { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null }] });
  const first = applyImport(initialState(), importPreview({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-09-29T00:00:00.000Z', courses: [course('夏'), course('冬')] }, []));
  assert.equal(first.importedCourseAchievements.length, 2);
  const update = applyImport(first, importPreview({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-01T00:00:00.000Z', courses: [course('夏'), course('冬')] }, [], first.importedStudyRecords, first.importedCourseAchievements));
  assert.equal(update.importedCourseAchievements.length, 2, 'capture time does not duplicate distinct same-name rows');
});

test('v14 base-name repair keeps Roman numerals, safely classifies null-identity candidates, and surfaces media review', () => {
  assert.equal(normalizeImportBaseName('データサイエンス入門Ａ'), normalizeImportBaseName('データサイエンス入門A(前期メディア)'));
  assert.equal(normalizeImportBaseName('数学３'), normalizeImportBaseName('数学３（冬期スクーリング）【オンライン】'));
  assert.notEqual(normalizeImportBaseName('簿記Ⅰ'), normalizeImportBaseName('簿記I'));
  assert.ok(matchedNameOfferings('生物学２', catalog).some(isMediaSchooling));
  const bookkeeping = matchedNameOfferings('簿記Ⅰ', catalog);
  const mapping = catalog.mappings.find(value => bookkeeping.some(offering => offering.mappingIds.includes(value.mappingId)) && value.category === '専門教育' && catalog.programs.some(program => !program.isCommon && program.scopeId === value.scopeId));
  assert.ok(mapping);
  const scope = mapping.scopeId;
  const row = { id: 'category-only', fingerprint: 'category-only', source: 'hosei_import', rawName: '簿記Ⅰ', categoryRaw: null, capturedAt: '', earnedCreditsTotal: 2, schoolingCreditsTotal: 2, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched', candidateOfferingIds: [] };
  const derived = deriveImportedAchievements([], offeringsById, [], [row], catalog, scope);
  assert.equal(derived.items.length, 0, 'category-only repair never invents a graduation identity');
  assert.equal(derived.categoryOverrides.get('imported-category:category-only'), '専門教育');
  const mediaRow = { ...row, id: 'base-media', rawName: '生物学２' };
  const mediaDerived = deriveImportedAchievements([], offeringsById, [], [mediaRow], catalog, scope);
  assert.equal(mediaDerived.mediaPending.length, 1, 'base-name media candidates remain available for confirmation');
  const v13 = { ...initialState(), schemaVersion: 13, selectedScopeId: scope, importedCourseAchievements: [row], items: [item(first.id, 'earned')] };
  const migrated = loadState(memoryStore(JSON.stringify(v13)), catalog);
  assert.equal(migrated.error, null); assert.equal(migrated.state.schemaVersion, 17);
  assert.deepEqual(migrated.state.items, v13.items, 'migration does not mutate plan items');
});

test('unified course view coalesces safely repaired official achievements without mutating source facts', () => {
  const offering = catalog.offerings.find(value => value.resolutionStatus === 'matched' && value.courseId !== null);
  assert.ok(offering);
  const planned = item(offering.id, 'planned');
  const exact = { id: 'official-exact', fingerprint: 'official-exact', source: 'hosei_import', rawName: offering.name, categoryRaw: null, capturedAt: '', earnedCreditsTotal: 2, schoolingCreditsTotal: null, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source', courseId: offering.courseId, selectedOfferingId: null, selectionSource: 'auto', match: 'exact_unique', candidateOfferingIds: [offering.id] };
  const nameOnly = { ...exact, id: 'official-name-only', fingerprint: 'official-name-only', courseId: null, match: 'ambiguous', selectionSource: 'none', selectedOfferingId: null };
  const originalExact = structuredClone(exact);
  const originalPlanned = structuredClone(planned);
  const rows = createUnifiedCourseRows([planned], [exact, nameOnly], offeringsById);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'planner_imported');
  assert.deepEqual(rows[0].importedAchievements, [exact, nameOnly]);
  assert.equal(rows[0].plannerItem.status, 'planned');
  assert.deepEqual(exact, originalExact, 'the display view never rewrites the imported achievement');
  assert.deepEqual(planned, originalPlanned, 'the display view never rewrites the planner item');
});

test('unified course view coalesces every safely identified imported lifecycle without changing source state', () => {
  const offering = catalog.offerings.find(value => value.resolutionStatus === 'matched' && value.courseId !== null);
  assert.ok(offering);
  const planned = { ...item(offering.id, 'in_progress'), studyYear: 2 };
  const imported = (id, earnedCreditsTotal = 0) => ({ id, fingerprint: id, source: 'hosei_import', rawName: offering.name, categoryRaw: null, capturedAt: '', earnedCreditsTotal, schoolingCreditsTotal: null, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source', courseId: offering.courseId, selectedOfferingId: null, selectionSource: 'auto', match: 'exact_unique', candidateOfferingIds: [offering.id] });
  const inProgress = imported('safe-in-progress'); const waiting = imported('safe-waiting'); const pending = imported('safe-pending'); const earned = imported('safe-earned', 2);
  const userMeta = { [inProgress.id]: { lifecycleStatus: 'in_progress', plannedYear: 2026, plannedTerm: '前期', studyYear: 2 }, [waiting.id]: { lifecycleStatus: 'waiting', plannedYear: 2026, plannedTerm: '後期', studyYear: 2 }, [pending.id]: { lifecycleStatus: null, plannedYear: null, plannedTerm: null, studyYear: null }, [earned.id]: { lifecycleStatus: 'waiting', plannedYear: 2026, plannedTerm: '後期', studyYear: 2 } };
  const originalPlanner = structuredClone(planned); const originalImported = structuredClone([inProgress, waiting, pending, earned]); const originalMeta = structuredClone(userMeta);
  const rows = createUnifiedCourseRows([planned], [inProgress, waiting, pending, earned], offeringsById, userMeta);
  assert.equal(rows.length, 1); assert.equal(rows[0].source, 'planner_imported'); assert.deepEqual(rows[0].importedAchievements, [inProgress, waiting, pending, earned]);
  assert.deepEqual([inProgress, waiting, pending, earned].map(achievement => importedAchievementStatusLabel(achievement, userMeta[achievement.id])), ['成績表取込: 履修中', '成績表取込: 結果待ち', '成績表取込: 判定保留', '修得済み（成績表）']);
  assert.deepEqual(planned, originalPlanner, 'the view never changes PlannerItem status'); assert.deepEqual([inProgress, waiting, pending, earned], originalImported, 'the view never changes imported source facts'); assert.deepEqual(userMeta, originalMeta, 'the view never changes imported user metadata');
});

test('unified course view coalesces a display-time repaired Media identity for every imported lifecycle', () => {
  const base = catalog.offerings.find(value => isMediaSchooling(value) && value.resolutionStatus === 'matched' && value.courseId !== null);
  assert.ok(base && base.courseId);
  const media = { ...base, id: 'development-economics-media', courseId: 'development-economics', name: '開発経済入門B(前期メディア)' };
  const planner = { ...media, id: 'development-economics-planner', name: '開発経済入門B' };
  const offerings = new Map([[media.id, media], [planner.id, planner]]);
  const planned = item(planner.id, 'in_progress');
  const imported = id => ({ id, fingerprint: id, source: 'hosei_import', rawName: '開発経済入門Ｂ', categoryRaw: null, capturedAt: '', earnedCreditsTotal: 0, schoolingCreditsTotal: 0, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'ambiguous', candidateOfferingIds: [] });
  const inProgress = imported('development-economics-progress'); const waiting = imported('development-economics-waiting'); const pending = imported('development-economics-pending');
  const meta = { [inProgress.id]: { lifecycleStatus: 'in_progress', plannedYear: 2026, plannedTerm: '前期', studyYear: 2 }, [waiting.id]: { lifecycleStatus: 'waiting', plannedYear: 2026, plannedTerm: '後期', studyYear: 2 }, [pending.id]: { lifecycleStatus: null, plannedYear: null, plannedTerm: null, studyYear: null } };
  const sourceFacts = structuredClone([inProgress, waiting, pending]);
  const rows = createUnifiedCourseRows([planned], [inProgress, waiting, pending], offerings, meta);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].importedAchievements, [inProgress, waiting, pending]);
  assert.deepEqual([inProgress, waiting, pending].map(row => importedAchievementStatusLabel(row, meta[row.id])), ['成績表取込: 履修中', '成績表取込: 結果待ち', '成績表取込: 判定保留']);
  assert.deepEqual([inProgress, waiting, pending], sourceFacts, 'display-time repair must not change import source facts');
  assert.equal(managedImportedMedia([inProgress], [], { [inProgress.id]: meta[inProgress.id] }, new Map([[media.id, media]])).media[0].offering.id, media.id, 'Media uses the same repaired identity');
});

test('unified course view does not derive an ambiguous name identity and preserves manual priority', () => {
  const base = catalog.offerings.find(value => value.resolutionStatus === 'matched' && value.courseId !== null);
  assert.ok(base && base.courseId);
  const first = { ...base, id: 'same-name-first', courseId: 'same-name-first-course', name: 'English S' };
  const second = { ...base, id: 'same-name-second', courseId: 'same-name-second-course', name: 'English S' };
  const manual = { ...base, id: 'manual-choice', courseId: 'manual-course', name: 'Manual course' };
  const offerings = new Map([[first.id, first], [second.id, second], [manual.id, manual]]);
  const imported = { id: 'unsafe-name', fingerprint: 'unsafe-name', source: 'hosei_import', rawName: 'English S', categoryRaw: null, capturedAt: '', earnedCreditsTotal: 0, schoolingCreditsTotal: null, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'ambiguous', candidateOfferingIds: [] };
  assert.equal(createUnifiedCourseRows([item(first.id)], [imported], offerings).length, 2, 'multiple name identities remain separate');
  const manualRow = { ...imported, id: 'manual-priority', rawName: 'English S', courseId: manual.courseId, selectedOfferingId: manual.id, selectionSource: 'manual' };
  const rows = createUnifiedCourseRows([item(manual.id)], [manualRow], offerings);
  assert.equal(rows.length, 1, 'a matched manual selection wins over ambiguous names');
  const candidateOnly = { ...imported, id: 'candidate-only', rawName: 'candidate-only', candidateOfferingIds: [manual.id] };
  assert.equal(createUnifiedCourseRows([item(manual.id)], [candidateOnly], offerings).length, 1, 'one matched candidate course identity is safe without rewriting the source row');
  const unmatchedCandidate = { ...candidateOnly, id: 'unmatched-candidate', candidateOfferingIds: ['missing-offering'] };
  assert.equal(createUnifiedCourseRows([item(manual.id)], [unmatchedCandidate], offerings).length, 2, 'unmatched candidates cannot create an identity');
  assert.equal(createUnifiedCourseRows([item(manual.id), { ...item(manual.id), offeringId: 'manual-copy' }], [manualRow], new Map([...offerings, ['manual-copy', { ...manual, id: 'manual-copy' }]])).length, 3, 'multiple planner rows remain uncoalesced');
});

test('unified course view preserves an official row when multiple planner offerings share its course identity', () => {
  const offering = catalog.offerings.find(value => value.resolutionStatus === 'matched' && value.courseId !== null);
  assert.ok(offering);
  const alternate = { ...offering, id: 'same-course-different-offering' };
  const offerings = new Map([...offeringsById, [alternate.id, alternate]]);
  const exact = { id: 'official-duplicate-safe', fingerprint: 'official-duplicate-safe', source: 'hosei_import', rawName: offering.name, categoryRaw: null, capturedAt: '', earnedCreditsTotal: 2, schoolingCreditsTotal: null, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source', courseId: offering.courseId, selectedOfferingId: null, selectionSource: 'auto', match: 'exact_unique', candidateOfferingIds: [offering.id] };
  const rows = createUnifiedCourseRows([item(offering.id), item(alternate.id)], [exact], offerings);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.slice(0, 2).map(row => row.source), ['planner', 'planner']);
  assert.equal(rows[2].source, 'imported');
  assert.equal(rows[2].importedAchievements[0], exact);
});

test('imported user metadata persists separately and only changes unresolved unified display', () => {
  const unresolved = { id: 'unresolved-meta', fingerprint: 'unresolved-meta', source: 'hosei_import', rawName: '未確定科目', categoryRaw: null, capturedAt: '', earnedCreditsTotal: 0, schoolingCreditsTotal: null, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched', candidateOfferingIds: [] };
  const meta = { lifecycleStatus: 'in_progress', plannedYear: 2026, plannedTerm: '前期', studyYear: 2 };
  const state = { ...initialState(), importedCourseAchievements: [unresolved], importedCourseUserMeta: { [unresolved.id]: meta } };
  const store = memoryStore();
  const raw = saveState(store, state, null, catalog);
  const loaded = loadState(store, catalog);
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.state.importedCourseUserMeta, state.importedCourseUserMeta);
  assert.equal(createUnifiedCourseRows([], [unresolved], offeringsById, loaded.state.importedCourseUserMeta)[0].displayStatus, 'in_progress_imported');
  assert.equal(raw, store.getItem(STORAGE_KEY));
  const waiting = { ...meta, lifecycleStatus: 'waiting' };
  assert.equal(createUnifiedCourseRows([], [unresolved], offeringsById, { [unresolved.id]: waiting })[0].displayStatus, 'waiting_imported');
});

test('official earned imported achievement overrides retained user metadata without changing planner or aggregate credits', () => {
  const earned = { id: 'earned-meta', fingerprint: 'earned-meta', source: 'hosei_import', rawName: '公式修得', categoryRaw: null, capturedAt: '', earnedCreditsTotal: 2, schoolingCreditsTotal: null, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched', candidateOfferingIds: [] };
  const before = summarizeCredits([], offeringsById);
  const rows = createUnifiedCourseRows([], [earned], offeringsById, { [earned.id]: { lifecycleStatus: 'waiting', plannedYear: 2026, plannedTerm: '後期', studyYear: 2 } });
  assert.equal(rows[0].displayStatus, 'earned_imported');
  assert.deepEqual(summarizeCredits([], offeringsById), before, 'metadata and imported display rows do not enter planner aggregates');
});

test('only safely resolved in-progress imported Media connects to offering-keyed progress', () => {
  const media = catalog.offerings.find(offering => isMediaSchooling(offering) && offering.courseId && offering.resolutionStatus === 'matched');
  assert.ok(media && media.courseId);
  const safe = { id: 'safe-imported-media', fingerprint: 'safe-imported-media', source: 'hosei_import', rawName: media.name, categoryRaw: null, capturedAt: '', earnedCreditsTotal: 0, schoolingCreditsTotal: 0, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source', courseId: media.courseId, selectedOfferingId: media.id, selectionSource: 'manual', match: 'exact_unique', candidateOfferingIds: [media.id] };
  const meta = { [safe.id]: { lifecycleStatus: 'in_progress', plannedYear: 2026, plannedTerm: '前期', studyYear: 1 } };
  const connected = managedImportedMedia([safe], [], meta, offeringsById);
  assert.equal(connected.media.length, 1);
  assert.equal(connected.media[0].offering.id, media.id);
  const progress = toggleLesson(progressFor(media.id, {}), 1, 'videoCompleted');
  assert.equal(progress.offeringId, media.id, 'the existing offering-keyed media progress is reused');
  const ambiguous = { ...safe, id: 'ambiguous-imported-media', selectedOfferingId: null, selectionSource: 'none', match: 'ambiguous' };
  assert.equal(managedImportedMedia([ambiguous], [], { [ambiguous.id]: meta[safe.id] }, offeringsById).media.length, 0, 'a candidate remains pending when its course identity has normal-schooling competition');
});

test('in-progress imported Media auto-matches only when its safe identity proves one Media offering', () => {
  const base = catalog.offerings.find(offering => offering.courseId && offering.resolutionStatus === 'matched' && offering.method === 'schooling');
  assert.ok(base && base.courseId);
  const source = (id, patch = {}) => ({ id, fingerprint: id, source: 'hosei_import', rawName: '自動照合科目', categoryRaw: null, capturedAt: '', earnedCreditsTotal: 0, schoolingCreditsTotal: 0, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source', courseId: 'safe-auto-course', selectedOfferingId: null, selectionSource: 'none', match: 'exact_unique', candidateOfferingIds: [], ...patch });
  const record = (sourceCourseId, term = null) => ({ id: `${sourceCourseId}-component`, fingerprint: `${sourceCourseId}-component`, source: 'hosei_import', rawName: '自動照合科目', offeringId: null, match: 'ambiguous', method: 'schooling', academicYear: 2026, yearSource: 'source', rawYear: '26', term, rawTerm: term, date: null, credits: null, grade: null, sourceCourseId, earnedCreditsTotal: 0, schoolingCreditsTotal: 0, compositionCredits: 2, recognizedExemption: null, additionalEnrollment: null, capturedAt: '' });
  const mediaFirst = { ...base, id: 'safe-auto-media-first', courseId: 'safe-auto-course', name: '自動照合科目(前期メディア)', deliveryCategory: '前期メディア' };
  const mediaSecond = { ...base, id: 'safe-auto-media-second', courseId: 'safe-auto-course', name: '自動照合科目(後期メディア)', deliveryCategory: '後期メディア' };
  const normal = { ...base, id: 'safe-auto-normal', courseId: 'safe-auto-course', name: '自動照合科目(夏期スクーリング)', deliveryCategory: '夏期スクーリング' };
  const active = row => ({ [row.id]: { lifecycleStatus: 'in_progress', plannedYear: 2026, plannedTerm: '前期', studyYear: 1 } });

  const termMatched = source('term-matched');
  assert.equal(managedImportedMedia([termMatched], [record(termMatched.id, ' 前期メディア ')], active(termMatched), new Map([[mediaFirst.id, mediaFirst], [mediaSecond.id, mediaSecond], [normal.id, normal]])).media[0].offering.id, mediaFirst.id, 'NFKC-normalized term evidence resolves one Media offering without a manual selection');

  const onlyMedia = source('only-media');
  assert.equal(managedImportedMedia([onlyMedia], [], active(onlyMedia), new Map([[mediaFirst.id, mediaFirst]])).media[0].offering.id, mediaFirst.id, 'one Media candidate without normal-schooling competition is safe');

  const multipleMedia = source('multiple-media');
  const multiResult = managedImportedMedia([multipleMedia], [], active(multipleMedia), new Map([[mediaFirst.id, mediaFirst], [mediaSecond.id, mediaSecond]]));
  assert.equal(multiResult.media.length, 0);
  assert.equal(multiResult.pending[0].sourceCourseId, multipleMedia.id, 'multiple Media candidates require confirmation');

  const normalConflict = source('normal-conflict');
  const conflictResult = managedImportedMedia([normalConflict], [], active(normalConflict), new Map([[mediaFirst.id, mediaFirst], [normal.id, normal]]));
  assert.equal(conflictResult.media.length, 0);
  assert.equal(conflictResult.pending[0].sourceCourseId, normalConflict.id, 'a normal-schooling conflict requires confirmation');

  const waiting = source('waiting');
  assert.equal(managedImportedMedia([waiting], [], { [waiting.id]: { ...active(waiting)[waiting.id], lifecycleStatus: 'waiting' } }, new Map([[mediaFirst.id, mediaFirst]])).media.length, 0, 'waiting rows do not create progress');
  const earned = source('earned', { earnedCreditsTotal: 2 });
  assert.equal(managedImportedMedia([earned], [], active(earned), new Map([[mediaFirst.id, mediaFirst]])).media.length, 0, 'officially earned rows do not create progress');

  const manual = source('manual', { selectedOfferingId: mediaSecond.id, selectionSource: 'manual' });
  assert.equal(managedImportedMedia([manual], [], active(manual), new Map([[mediaFirst.id, mediaFirst], [mediaSecond.id, mediaSecond]])).media[0].offering.id, mediaSecond.id, 'manual Media selection remains the highest priority');

  const repaired = source('repaired-name', { rawName: '自動照合科目', courseId: null, match: 'ambiguous', candidateOfferingIds: [] });
  assert.equal(managedImportedMedia([repaired], [], active(repaired), new Map([[mediaFirst.id, mediaFirst]])).media[0].offering.id, mediaFirst.id, 'a safe NFKC/delivery-suffix base-name identity is derived without writing source facts');

  const nfkcMedia = { ...mediaFirst, id: 'nfkc-media', courseId: 'nfkc-course', name: 'データサイエンス入門A(前期メディア)' };
  const nfkcRepaired = source('nfkc-repaired-name', { rawName: 'データサイエンス入門Ａ', courseId: null, match: 'ambiguous', candidateOfferingIds: [] });
  assert.equal(managedImportedMedia([nfkcRepaired], [], active(nfkcRepaired), new Map([[nfkcMedia.id, nfkcMedia]])).media[0].offering.id, nfkcMedia.id, 'NFKC repair matches full-width A to a safely unique Media identity');

  const candidateOnly = source('candidate-only', { rawName: '未照合候補', courseId: null, match: 'ambiguous', candidateOfferingIds: [mediaFirst.id] });
  assert.equal(managedImportedMedia([candidateOnly], [], active(candidateOnly), new Map([[mediaFirst.id, mediaFirst]])).media[0].offering.id, mediaFirst.id, 'one safe Media candidate is derived without a row identity');
});

test('v14 state migrates to v16 without dropping imports, selections, or saved progress', () => {
  const media = catalog.offerings.find(isMediaSchooling);
  assert.ok(media);
  const legacy = { ...initialState(), schemaVersion: 14, mediaSchoolingProgress: { [media.id]: progressFor(media.id, {}) }, importedCourseAchievements: [{ id: 'legacy-row', fingerprint: 'legacy-row', source: 'hosei_import', rawName: '保存済み', categoryRaw: null, capturedAt: '', earnedCreditsTotal: 0, schoolingCreditsTotal: null, compositionCredits: null, recognizedExemption: null, additionalEnrollment: null, academicYear: null, yearSource: 'unknown', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched', candidateOfferingIds: [] }] };
  const loaded = loadState(memoryStore(JSON.stringify(legacy)), catalog);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.schemaVersion, 17);
  assert.deepEqual(loaded.state.importedCourseAchievements, legacy.importedCourseAchievements);
  assert.deepEqual(loaded.state.mediaSchoolingProgress, legacy.mediaSchoolingProgress);
  assert.deepEqual(loaded.state.importedCourseUserMeta, {});
  assert.deepEqual(loaded.state.graduationProfile, initialGraduationProfile());
});

test('v15 graduation profile migration preserves planner, imported, and media data while adding unknown/null prerequisites', () => {
  const media = catalog.offerings.find(isMediaSchooling);
  const legacy = { ...initialState(), schemaVersion: 15, items: [item(first.id, 'earned')], mediaSchoolingProgress: { [media.id]: progressFor(media.id, {}) }, importedCourseAchievements: [{ id: 'profile-row', fingerprint: 'profile-row', source: 'hosei_import', rawName: '保存済み', categoryRaw: null, capturedAt: '', earnedCreditsTotal: 0, schoolingCreditsTotal: null, compositionCredits: null, recognizedExemption: null, additionalEnrollment: null, academicYear: null, yearSource: 'unknown', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched', candidateOfferingIds: [] }] };
  delete legacy.graduationProfile;
  const loaded = loadState(memoryStore(JSON.stringify(legacy)), catalog);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.schemaVersion, 17);
  assert.deepEqual(loaded.state.items, legacy.items);
  assert.deepEqual(loaded.state.mediaSchoolingProgress, legacy.mediaSchoolingProgress);
  assert.deepEqual(loaded.state.importedCourseAchievements, legacy.importedCourseAchievements);
  assert.deepEqual(loaded.state.graduationProfile, initialGraduationProfile());
});

test('graduation profile saves only internally consistent prerequisites and rejects invalid numeric input', () => {
  const state = { ...initialState(), graduationProfile: { admissionYear: 2025, admissionType: 'transfer', recognizedCredits: { totalCredits: 10, schoolingEquivalentCredits: 4 }, curriculumApplicability: 'legacy_or_transition' } };
  const store = memoryStore();
  const raw = saveState(store, state, null, catalog);
  const loaded = loadState(memoryStore(raw), catalog);
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.state.graduationProfile, state.graduationProfile);
  assert.equal(normalizeNonnegativeNumber('0'), 0);
  assert.equal(normalizeNonnegativeNumber('1.'), 1, 'a decimal draft can be committed once complete');
  assert.equal(normalizeNonnegativeNumber(''), null);
  assert.equal(normalizeNonnegativeNumber('-1'), null);
  assert.equal(normalizeNonnegativeNumber('NaN'), null);
  assert.equal(normalizeAdmissionYear('25'), null);
  assert.equal(normalizeAdmissionYear('2'), null);
  assert.equal(normalizeAdmissionYear('10000'), null);
  assert.equal(normalizeAdmissionYear('-1'), null);
  assert.equal(normalizeAdmissionYear('2025.5'), null);
  assert.equal(normalizeAdmissionYear('2025'), 2025);
  assert.equal(validateState({ ...state, graduationProfile: { ...state.graduationProfile, admissionYear: 25 } }, catalog), false);
  assert.equal(validateState({ ...state, graduationProfile: { ...state.graduationProfile, recognizedCredits: { totalCredits: -1, schoolingEquivalentCredits: null } } }, catalog), false);
  assert.equal(validateState({ ...state, graduationProfile: { ...state.graduationProfile, recognizedCredits: { totalCredits: 10, schoolingEquivalentCredits: 12 } } }, catalog), false);
  assert.equal(validateState({ ...state, graduationProfile: { ...state.graduationProfile, recognizedCredits: { totalCredits: null, schoolingEquivalentCredits: 1 } } }, catalog), false);
  assert.equal(validateState({ ...state, graduationProfile: { ...state.graduationProfile, recognizedCredits: { totalCredits: 0, schoolingEquivalentCredits: 0 } } }, catalog), true);
});

test('recognized-credit controls keep editable drafts and commit both values together', () => {
  const source = readFileSync(new URL('../src/components/planner/GraduationProfileSettings.tsx', import.meta.url), 'utf8');
  assert.match(source, /useState\(profile\.recognizedCredits\.totalCredits\?\.toString\(\) \?\? ''\)/);
  assert.match(source, /useState\(profile\.recognizedCredits\.schoolingEquivalentCredits\?\.toString\(\) \?\? ''\)/);
  assert.match(source, /const commitRecognizedCredits = \(\) =>/);
  assert.match(source, /recognizedCredits: \{ totalCredits, schoolingEquivalentCredits \}/);
  assert.match(source, /value=\{totalCreditsDraft\}[\s\S]*onBlur=\{commitRecognizedCredits\}/);
  assert.match(source, /value=\{schoolingEquivalentCreditsDraft\}[\s\S]*onBlur=\{commitRecognizedCredits\}/);
  assert.match(source, /type="text" inputMode="decimal" value=\{totalCreditsDraft\}/);
  assert.doesNotMatch(source, /updateRecognizedCredits/);
});

test('missing graduation profile prerequisites never completes graduation evaluation or breaks coverage', () => {
  const profile = initialGraduationProfile();
  assert.deepEqual(missingGraduationProfilePrerequisites(profile), ['admission_year', 'admission_type', 'curriculum_applicability']);
  const transfer = { ...profile, admissionType: 'transfer' };
  assert.ok(missingGraduationProfilePrerequisites(transfer).includes('recognized_credits'));
  const progress = calculateGraduationProgress([], catalog, catalog.programs[0].scopeId);
  assert.equal(catalog.metadata.graduationCheckComplete, false);
  assert.ok(progress.coverageSummary.unknown >= 0);
});

test('reference totals apply only explicit current-2026 profiles and keep the law thesis branch distinct', () => {
  const law = catalog.programs.find(program => program.department === '法律学科').scopeId;
  const economics = catalog.programs.find(program => program.department === '経済学科').scopeId;
  const current = { admissionYear: 2026, admissionType: 'first_year', recognizedCredits: { totalCredits: null, schoolingEquivalentCredits: null }, curriculumApplicability: 'current_2026' };
  const refs = (scope, profile, thesis = 'undecided') => calculateGraduationProgress([], catalog, scope, [], thesis, [], [], profile).referenceProgress;
  assert.equal(refs(economics, current)[0].target, 124);
  assert.equal(refs(law, current, 'selected')[0].target, 124);
  assert.equal(refs(law, current, 'not_selected')[0].target, 128);
  assert.equal(refs(law, current)[0].target, null);
  assert.equal(refs(economics, { ...current, curriculumApplicability: 'unknown' })[0].target, null);
  assert.equal(refs(economics, { ...current, curriculumApplicability: 'legacy_or_transition' })[0].target, null);
  assert.equal(refs(economics, { ...current, admissionType: 'transfer' })[0].target, null);
  assert.equal(refs(economics, current)[1].target, 30);
  assert.equal(refs(economics, current)[1].recognizedCredits, 0);
});

test('reference totals accept official transfer recognition including zero, never infer a missing schooling equivalent, and do not duplicate an imported identity', () => {
  const scope = catalog.programs.find(program => program.department === '経済学科').scopeId;
  const profile = { admissionYear: 2026, admissionType: 'transfer', recognizedCredits: { totalCredits: 0, schoolingEquivalentCredits: 0 }, curriculumApplicability: 'current_2026' };
  const base = calculateGraduationProgress([], catalog, scope, [], 'undecided', [], [], profile).referenceProgress;
  assert.equal(base[0].earned, 0);
  assert.equal(base[1].earned, 0);
  const imported = { id: 'reference-import', fingerprint: 'reference-import', source: 'hosei_import', rawName: first.name, categoryRaw: null, capturedAt: '', earnedCreditsTotal: first.credits, schoolingCreditsTotal: first.credits === null ? null : Math.max(0, first.credits - 1), compositionCredits: first.credits, recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source', courseId: first.courseId, selectedOfferingId: first.id, selectionSource: 'auto', match: 'exact_unique', candidateOfferingIds: [first.id] };
  const importedOnly = calculateGraduationProgress([], catalog, scope, [], 'undecided', [], [imported], profile).referenceProgress;
  const duplicated = calculateGraduationProgress([item(first.id, 'earned')], catalog, scope, [], 'undecided', [], [imported], profile).referenceProgress;
  const plannerOnly = calculateGraduationProgress([item(first.id, 'earned')], catalog, scope, [], 'undecided', [], [], profile).referenceProgress;
  assert.ok(importedOnly[0].earned >= 0);
  assert.equal(duplicated[0].earned, plannerOnly[0].earned);
  assert.equal(importedOnly[1].earned, 0, 'a mixed imported aggregate must not become wholly schooling credit');
  const missingSchooling = calculateGraduationProgress([], catalog, scope, [], 'undecided', [], [], { ...profile, recognizedCredits: { totalCredits: 10, schoolingEquivalentCredits: null } }).referenceProgress[1];
  assert.equal(missingSchooling.earned, null);
  assert.match(missingSchooling.reason, /認定スクーリング相当/);
});
