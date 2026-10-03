import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { deriveImportedAchievements } from '../src/planner/importedAchievementCalculations.ts';
import { exactImportedCurriculumId, plannerItemsWithoutOfficialEarned } from '../src/planner/officialCourseCredits.ts';
import { importedEarnedCreditsTotal } from '../src/planner/gradeImportApply.ts';
import { initialState } from '../src/planner/storage.ts';

// Characterization of the ca2aeea compatibility path. Tests naming GAP assert
// defects explicitly; replace their expectations when the documented slice fixes them.
function fixture(department = '法律学科') {
  const program = catalog.programs.find(p => p.department === department);
  const common = catalog.programs.find(p => p.isCommon).scopeId;
  const mapping = { ...catalog.mappings[0], mappingId: 'audit-map', scopeId: program.scopeId, category: '専門教育', field: null,
    requirementType: department === '史学科' ? '必修' : '選択必修', curriculumCredits: 4, schoolingOnly: false, mediaOnly: false };
  const course = { id: 'audit-course', canonicalName: '監査科目', curriculumCredits: 4, mappingIds: [mapping.mappingId], scopeIds: [program.scopeId] };
  const offering = { ...catalog.offerings[0], id: 'audit-offering', name: course.canonicalName, courseId: 'audit-legacy', curriculumCourseId: course.id,
    method: 'correspondence', credits: 4, resolutionStatus: 'matched', mappingIds: [mapping.mappingId] };
  const f = { ...catalog, courses: [{ id: 'audit-legacy', canonicalName: course.canonicalName, identityStatus: 'provisional' }], mappings: [mapping], offerings: [offering],
    curriculum: { ...catalog.curriculum, courses: [course], offeringRelations: [{ offeringId: offering.id, curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id] }] } };
  const row = { id: 'audit-official', fingerprint: 'audit-source', source: 'hosei_import', rawName: course.canonicalName, categoryRaw: null,
    capturedAt: '2026-10-03T00:00:00Z', earnedCreditsTotal: 4, schoolingCreditsTotal: 2, compositionCredits: 4,
    recognizedExemption: null, additionalEnrollment: null, academicYear: 2020, yearSource: 'source',
    curriculumCourseId: course.id, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [course.id], offeringMatch: 'unmatched',
    courseId: offering.courseId, selectedOfferingId: null, selectionSource: 'none', match: 'exact_unique', candidateOfferingIds: [] };
  const profile = { ...initialState().graduationProfile, admissionYear: 2020, admissionType: 'first_year', curriculumApplicability: 'current_2026' };
  return { f, row, offering, course, mapping, common, scope: program.scopeId, profile };
}
const item = (offering, status) => ({ offeringId: offering.id, status, plannedYear: 2027, plannedTerm: null, studyYear: null, earnedOrder: null });
const run = (x, items = [], records = []) => calculateGraduationProgress(items, x.f, x.scope, [], 'not_selected', records, [x.row], x.profile);
const derive = (x, items = [], records = []) => deriveImportedAchievements(records, new Map(x.f.offerings.map(o => [o.id, o])), items, [x.row], x.f, x.scope);
const overall = result => result.referenceProgress.find(r => r.id === 'overall-reference-progress').earned;
const professional = result => result.cards.find(c => c.requirementId === 'professional-law-required-elective');

test('audit GAP: exact Course without Offering preserves official4 but graduation loses allocation', () => {
  const x = fixture(); x.f.offerings = []; x.row.courseId = null;
  assert.equal(exactImportedCurriculumId(x.row, x.f), x.course.id);
  const snapshot = structuredClone(x.row);
  assert.equal(importedEarnedCreditsTotal([x.row]), 4);
  assert.equal(derive(x).classifiedCredits, 0);
  assert.equal(overall(run(x)), 0);
  assert.ok(run(x).importedWarnings.length > 0);
  assert.deepEqual(x.row, snapshot);
});

test('audit GAP: exact Course with Offering but no legacy courseId is still not allocated', () => {
  const x = fixture(); x.row.courseId = null;
  assert.equal(exactImportedCurriculumId(x.row, x.f), x.course.id);
  assert.equal(derive(x).items.length, 0);
  assert.equal(overall(run(x)), 0);
});

test('audit: official4 plus components2+2 remains4; GAP mixed schooling evidence2 becomes0', () => {
  const x = fixture();
  const records = ['correspondence', 'schooling'].map(method => ({ id: method, sourceCourseId: x.row.id, rawName: x.row.rawName,
    method, credits: 2, earnedCreditsTotal: 4, schoolingCreditsTotal: 2, offeringId: null, term: null }));
  const snapshot = structuredClone({ row: x.row, records });
  assert.equal(derive(x, [], records).classifiedCredits, 4);
  assert.equal(overall(run(x, [], records)), 4);
  assert.equal(run(x, [], records).referenceProgress.find(r => r.id === 'schooling-reference-progress').earned, 0);
  assert.deepEqual({ row: x.row, records }, snapshot);
});

test('audit: official4 owns same-Course Planner earned; planned projection remains separate', () => {
  const x = fixture();
  assert.equal(overall(run(x, [item(x.offering, 'earned')])), 4);
  const card = professional(run(x, [item(x.offering, 'planned')]));
  assert.equal(card.earned, 4); assert.equal(card.planned, 4);
  for (const status of ['planned', 'in_progress', 'waiting']) {
    const items = [item(x.offering, status)];
    assert.deepEqual(plannerItemsWithoutOfficialEarned(items, new Map([[x.offering.id, x.offering]]), [x.row], x.f), items);
  }
  assert.equal(professional(run(x, [item(x.offering, 'waiting')])).planned, 0, 'waiting is retained but not projected by current evaluator');
});

test('audit: unresolved identity warns; GAP categoryRaw fallback hides graduation warning', () => {
  const x = fixture(); x.f.offerings = []; x.row.courseId = null; x.row.curriculumCourseId = null;
  x.row.curriculumMatch = 'ambiguous'; x.row.candidateCurriculumCourseIds = [x.course.id];
  assert.equal(exactImportedCurriculumId(x.row, x.f), null);
  assert.ok(run(x).importedWarnings.length > 0);
  x.row.categoryRaw = '専門教育';
  assert.equal(derive(x).categoryOfferings[0].credits, 4);
  assert.equal(overall(run(x)), 0);
  assert.equal(run(x).importedWarnings.length, 0);
});

test('audit: conflicting mappings on a visible Offering hold professional allocation unknown', () => {
  const x = fixture(); const other = { ...x.mapping, mappingId: 'conflict', requirementType: '選択' };
  x.f.mappings.push(other); x.course.mappingIds.push(other.mappingId); x.offering.mappingIds.push(other.mappingId);
  assert.equal(professional(run(x)).status, 'unknown');
  assert.match(professional(run(x)).reason, /区分が複数/);
});

test('audit GAP: conflicting Course mappings on separate Offerings are hidden by first template', () => {
  const x = fixture(); const other = { ...x.mapping, mappingId: 'conflict', requirementType: '選択' };
  x.f.mappings.push(other); x.course.mappingIds.push(other.mappingId);
  const second = { ...x.offering, id: 'second', mappingIds: [other.mappingId] }; x.f.offerings.push(second);
  assert.equal(exactImportedCurriculumId(x.row, x.f), x.course.id);
  assert.equal(professional(run(x)).earned, 4);
  assert.notEqual(professional(run(x)).status, 'unknown');
  x.f.offerings.reverse();
  assert.equal(professional(run(x)).earned, 0, 'allocation changes merely by array order');
  assert.equal(run(x).importedWarnings.length, 0);
});

test('audit GAP: common plus department mappings can double count one aggregate across buckets', () => {
  const x = fixture(); const common = { ...x.mapping, mappingId: 'common', scopeId: x.common, category: '一般教育', field: '人文' };
  const outside = { ...x.mapping, mappingId: 'outside', scopeId: 'another-program', requirementType: '選択' };
  x.f.mappings.push(common, outside); x.course.mappingIds.push(common.mappingId, outside.mappingId); x.offering.mappingIds.push(common.mappingId, outside.mappingId);
  assert.equal(derive(x).classifiedCredits, 4);
  assert.equal(run(x).cards.find(c => c.requirementId === 'group-general').earned, 4);
  assert.equal(professional(run(x)).earned, 4);
  assert.equal(overall(run(x)), 8, 'known cross-card double allocation; outside scope is excluded');
});

for (const department of ['法律学科', '日本文学科', '史学科', '地理学科', '経済学科', '商業学科']) {
  test(`audit ${department}: legacy-compatible official4 allocated once, no-Offering gap characterized`, () => {
    const x = fixture(department);
    assert.equal(overall(run(x)), 4);
    assert.equal(overall(run(x, [item(x.offering, 'earned')])), 4);
    assert.equal(run(x).graduationCheckComplete, false);
    x.f.offerings = [];
    assert.equal(importedEarnedCreditsTotal([x.row]), 4);
    assert.equal(overall(run(x)), 0);
    assert.equal(initialState().schemaVersion, 22);
  });
}

test('audit GAP: all-schooling official4 depends on the first legacy Offering method', () => {
  const x = fixture(); x.row.schoolingCreditsTotal = 4;
  x.f.offerings.push({ ...x.offering, id: 'school', method: 'schooling' });
  assert.equal(derive(x).offerings[0].method, 'correspondence');
  assert.equal(run(x).referenceProgress.find(r => r.id === 'schooling-reference-progress').earned, 0);
  x.f.offerings.reverse();
  assert.equal(derive(x).offerings[0].method, 'schooling');
  assert.equal(run(x).referenceProgress.find(r => r.id === 'schooling-reference-progress').earned, 4);
});

test('audit GAP: equivalent duplicate common mapping edges multiply one completed Course', () => {
  const x = fixture(); x.mapping.scopeId = x.common; x.mapping.category = '一般教育'; x.mapping.field = '人文';
  const duplicate = { ...x.mapping, mappingId: 'same-allocation' };
  x.f.mappings.push(duplicate); x.course.mappingIds.push(duplicate.mappingId); x.offering.mappingIds.push(duplicate.mappingId);
  assert.equal(derive(x).classifiedCredits, 4);
  assert.equal(run(x).cards.find(c => c.requirementId === 'group-general').earned, 8);
});

test('audit: null and zero official totals suppress earned duplicates without inventing credits', () => {
  const x = fixture();
  for (const credits of [null, 0]) {
    x.row.earnedCreditsTotal = credits;
    assert.deepEqual(derive(x, [item(x.offering, 'earned')]).plannerItems, []);
    assert.equal(overall(run(x, [item(x.offering, 'earned')])), 0);
  }
});

test('audit GAP: ambiguous CurriculumCourse can still count through a legacy courseId without warning', () => {
  const x = fixture(); const other = { ...x.course, id: 'another-curriculum-course' };
  x.f.curriculum.courses.push(other);
  x.row.curriculumCourseId = null; x.row.curriculumMatch = 'ambiguous';
  x.row.candidateCurriculumCourseIds = [x.course.id, other.id];
  assert.equal(exactImportedCurriculumId(x.row, x.f), null);
  assert.equal(overall(run(x)), 4);
  assert.equal(run(x).importedWarnings.length, 0, 'legacy identity bypasses unresolved institutional identity');
});
