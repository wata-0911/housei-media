import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { deriveImportedAchievements } from '../src/planner/importedAchievementCalculations.ts';
import { exactImportedCurriculumId, plannerItemsWithoutOfficialEarned } from '../src/planner/officialCourseCredits.ts';
import { importedEarnedCreditsTotal, importPreview } from '../src/planner/gradeImportApply.ts';
import { deriveOfficialGraduationFacts } from '../src/planner/officialGraduationFacts.ts';
import { initialState } from '../src/planner/storage.ts';
import { setThesisProgressForScope, thesisProgressForScope } from '../src/planner/thesisSelection.ts';
import { graduationProfileValidationError } from '../src/planner/graduationProfile.ts';
import { matchImportedCurriculumCourse } from '../src/planner/curriculumImportMatch.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GraduationProgressUI from '../src/components/planner/GraduationProgress.tsx';

// Original audit characterizations now assert the Course-centered official contract.
// Presentation compatibility assertions deliberately remain separate from graduation.
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

test('audit GAP: exact Course without Offering preserves official4 but graduation allocates4', () => {
  const x = fixture(); x.f.offerings = []; x.row.courseId = null;
  assert.equal(exactImportedCurriculumId(x.row, x.f), x.course.id);
  const snapshot = structuredClone(x.row);
  assert.equal(importedEarnedCreditsTotal([x.row]), 4);
  assert.equal(derive(x).classifiedCredits, 0);
  assert.equal(overall(run(x)), 4);
  assert.equal(run(x).importedWarnings.length, 0);
  assert.deepEqual(x.row, snapshot);
});

test('audit GAP: exact Course with Offering but no legacy courseId allocates4', () => {
  const x = fixture(); x.row.courseId = null;
  assert.equal(exactImportedCurriculumId(x.row, x.f), x.course.id);
  assert.equal(derive(x).items.length, 0);
  assert.equal(overall(run(x)), 4);
  x.offering.credits = null;
  assert.equal(overall(run(x)), 4, 'annual template credit metadata is not an official input');
});

test('audit: official4 plus components2+2 remains4; fixed GAP mixed schooling evidence2 remains2', () => {
  const x = fixture();
  const records = ['correspondence', 'schooling'].map(method => ({ id: method, sourceCourseId: x.row.id, rawName: x.row.rawName,
    method, credits: 2, earnedCreditsTotal: 4, schoolingCreditsTotal: 2, offeringId: null, term: null }));
  const snapshot = structuredClone({ row: x.row, records });
  assert.equal(derive(x, [], records).classifiedCredits, 4);
  assert.equal(overall(run(x, [], records)), 4);
  assert.equal(run(x, [], records).referenceProgress.find(r => r.id === 'schooling-reference-progress').earned, 2);
  assert.equal(deriveOfficialGraduationFacts([x.row], records, x.f, x.scope).facts[0].schoolingEvidence.credits, 2);
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

test('audit: unresolved identity warns; fixed GAP categoryRaw cannot hide graduation warning', () => {
  const x = fixture(); x.f.offerings = []; x.row.courseId = null; x.row.curriculumCourseId = null;
  x.row.curriculumMatch = 'ambiguous'; x.row.candidateCurriculumCourseIds = [x.course.id];
  assert.equal(exactImportedCurriculumId(x.row, x.f), null);
  assert.ok(run(x).importedWarnings.length > 0);
  x.row.categoryRaw = '専門教育';
  assert.equal(derive(x).categoryOfferings[0].credits, 4);
  assert.equal(overall(run(x)), null);
  assert.equal(run(x).referenceProgress[0].status, 'unknown');
  assert.ok(run(x).importedWarnings.some(w => w.reason.includes('curriculum_identity_unresolved')));
});

test('audit: conflicting mappings on a visible Offering hold professional allocation unknown', () => {
  const x = fixture(); const other = { ...x.mapping, mappingId: 'conflict', requirementType: '選択' };
  x.f.mappings.push(other); x.course.mappingIds.push(other.mappingId); x.offering.mappingIds.push(other.mappingId);
  assert.equal(professional(run(x)).status, 'unknown');
  assert.match(professional(run(x)).reason, /mapping_conflict/);
});

test('audit GAP: conflicting Course mappings on separate Offerings stay unknown independent of templates', () => {
  const x = fixture(); const other = { ...x.mapping, mappingId: 'conflict', requirementType: '選択' };
  x.f.mappings.push(other); x.course.mappingIds.push(other.mappingId);
  const second = { ...x.offering, id: 'second', mappingIds: [other.mappingId] }; x.f.offerings.push(second);
  assert.equal(exactImportedCurriculumId(x.row, x.f), x.course.id);
  assert.equal(professional(run(x)).earned, 0);
  assert.equal(professional(run(x)).status, 'unknown');
  const before = run(x);
  x.f.offerings.reverse();
  assert.deepEqual(run(x), before, 'entire graduation result is independent of Offering order');
  assert.ok(run(x).importedWarnings.some(w => w.reason.includes('mapping_conflict')));
});

test('audit GAP: common plus department mappings hold allocation instead of double counting', () => {
  const x = fixture(); const common = { ...x.mapping, mappingId: 'common', scopeId: x.common, category: '一般教育', field: '人文' };
  const outside = { ...x.mapping, mappingId: 'outside', scopeId: 'another-program', requirementType: '選択' };
  x.f.mappings.push(common, outside); x.course.mappingIds.push(common.mappingId, outside.mappingId); x.offering.mappingIds.push(common.mappingId, outside.mappingId);
  assert.equal(derive(x).classifiedCredits, 4);
  assert.equal(run(x).cards.find(c => c.requirementId === 'group-general').earned, 0);
  assert.equal(professional(run(x)).earned, 0);
  assert.equal(overall(run(x)), null, 'conflicting allocation stays unknown instead of spending the source twice');
});

for (const department of ['法律学科', '日本文学科', '史学科', '地理学科', '経済学科', '商業学科']) {
  test(`audit ${department}: official4 allocated once with or without Offerings`, () => {
    const x = fixture(department);
    assert.equal(overall(run(x)), 4);
    assert.equal(overall(run(x, [item(x.offering, 'earned')])), 4);
    assert.equal(run(x).graduationCheckComplete, false);
    x.f.offerings = [];
    assert.equal(importedEarnedCreditsTotal([x.row]), 4);
    assert.equal(overall(run(x)), 4);
    assert.equal(initialState().schemaVersion, 22);
  });
}

test('audit GAP: all-schooling official4 is independent of the first legacy Offering method', () => {
  const x = fixture(); x.row.schoolingCreditsTotal = 4;
  x.f.offerings.push({ ...x.offering, id: 'school', method: 'schooling' });
  assert.equal(derive(x).offerings[0].method, 'correspondence');
  assert.equal(run(x).referenceProgress.find(r => r.id === 'schooling-reference-progress').earned, 4);
  const before = run(x);
  x.f.offerings.reverse();
  assert.equal(derive(x).offerings[0].method, 'schooling');
  assert.deepEqual(run(x), before);
  assert.equal(run(x).referenceProgress.find(r => r.id === 'schooling-reference-progress').earned, 4);
});

test('audit GAP: equivalent duplicate common mapping edges count one completed Course once', () => {
  const x = fixture(); x.mapping.scopeId = x.common; x.mapping.category = '一般教育'; x.mapping.field = '人文';
  const duplicate = { ...x.mapping, mappingId: 'same-allocation' };
  x.f.mappings.push(duplicate); x.course.mappingIds.push(duplicate.mappingId); x.offering.mappingIds.push(duplicate.mappingId);
  assert.equal(derive(x).classifiedCredits, 4);
  assert.equal(run(x).cards.find(c => c.requirementId === 'group-general').earned, 4);
  assert.equal(overall(run(x)), 4);
});

test('audit: null and zero official totals suppress earned duplicates without inventing credits', () => {
  const x = fixture();
  for (const credits of [null, 0]) {
    x.row.earnedCreditsTotal = credits;
    assert.deepEqual(derive(x, [item(x.offering, 'earned')]).plannerItems, []);
    assert.equal(overall(run(x, [item(x.offering, 'earned')])), credits === null ? null : 0);
    assert.equal(run(x).referenceProgress[0].status, credits === null ? 'unknown' : 'partial');
  }
});

test('audit GAP: ambiguous CurriculumCourse cannot count through legacy courseId and warns', () => {
  const x = fixture(); const other = { ...x.course, id: 'another-curriculum-course' };
  x.f.curriculum.courses.push(other);
  x.row.curriculumCourseId = null; x.row.curriculumMatch = 'ambiguous';
  x.row.candidateCurriculumCourseIds = [x.course.id, other.id];
  assert.equal(exactImportedCurriculumId(x.row, x.f), null);
  assert.equal(overall(run(x)), null);
  assert.ok(run(x).importedWarnings.some(w => w.reason.includes('curriculum_identity_unresolved')));
  assert.equal(overall(run(x, [item(x.offering, 'earned')])), 4, 'unresolved official identity does not own a Planner Course');
});

const facts = x => deriveOfficialGraduationFacts([x.row], [], x.f, x.scope, x.profile);

test('official facts: in-progress projection and source budget remain separate', () => {
  const x = fixture();
  const card = professional(run(x, [item(x.offering, 'in_progress')]));
  assert.equal(card.earned, 4); assert.equal(card.inProgress, 4); assert.equal(card.planned, 0);
  assert.equal(overall(run(x, [item(x.offering, 'in_progress')])), 4);
});

for (const [key, value] of [['category', '外国語'], ['field', 'another'], ['requirementType', '選択'], ['curriculumCredits', 2], ['schoolingOnly', true], ['mediaOnly', true]]) {
  test(`official facts: allocation signature rejects differing ${key}`, () => {
    const x = fixture();
    const other = { ...x.mapping, mappingId: 'other', [key]: value };
    x.f.mappings.push(other); x.course.mappingIds.push(other.mappingId);
    const before = facts(x);
    assert.deepEqual(before.facts[0].allocation, { kind: 'unknown', reason: 'mapping_conflict' });
    assert.equal(before.allocations.length, 0);
    x.course.mappingIds.reverse(); x.f.mappings.reverse();
    assert.deepEqual(facts(x), before);
  });
}

test('official facts: equivalent professional edges spend only one source budget', () => {
  const x = fixture(); const other = { ...x.mapping, mappingId: 'equivalent' };
  x.f.mappings.push(other); x.course.mappingIds.push(other.mappingId);
  const result = facts(x);
  assert.equal(result.facts[0].allocation.kind, 'equivalent');
  assert.deepEqual(result.facts[0].allocation.mappingIds, ['audit-map', 'equivalent']);
  assert.equal(result.allocations.length, 1); assert.equal(result.allocations[0].credits, 4);
  assert.equal(overall(run(x)), 4);
});

test('official facts: outside mappings are excluded and scopeIds never allocate', () => {
  const x = fixture();
  const outside = { ...x.mapping, mappingId: 'outside', scopeId: 'outside', requirementType: '選択' };
  x.f.mappings.push(outside); x.course.mappingIds.push(outside.mappingId);
  x.course.scopeIds = ['outside'];
  assert.equal(facts(x).facts[0].allocation.kind, 'unique');
  assert.equal(overall(run(x)), 4);
  x.course.mappingIds = ['outside']; x.course.scopeIds = [x.scope];
  assert.deepEqual(facts(x).facts[0].allocation, { kind: 'out_of_scope', reason: 'out_of_scope' });
  assert.equal(overall(run(x)), 0);
  assert.match(run(x).importedWarnings[0].reason, /out_of_scope/);
});

for (const ids of [[], ['missing'], ['audit-map', 'missing']]) {
  test(`official facts: missing Mapping ${JSON.stringify(ids)} remains unknown`, () => {
    const x = fixture(); x.course.mappingIds = ids;
    assert.deepEqual(facts(x).facts[0].allocation, { kind: 'unknown', reason: 'mapping_not_found' });
    assert.equal(overall(run(x)), null);
  });
}

test('official facts: conflicting official rows preserve every aggregate without sum/max/latest', () => {
  const x = fixture(); const second = { ...x.row, id: 'second-source', capturedAt: '2099-01-01', earnedCreditsTotal: 8 };
  const result = deriveOfficialGraduationFacts([x.row, second], [], x.f, x.scope);
  assert.equal(result.facts.length, 1); assert.equal(result.allocations.length, 0);
  const sameSnapshot = deriveOfficialGraduationFacts([x.row, { ...x.row, id: 'same-snapshot' }], [], x.f, x.scope);
  assert.equal(sameSnapshot.allocations.length, 0);
  assert.equal(sameSnapshot.facts[0].allocation.reason, 'duplicate_official_rows');
  assert.deepEqual(sameSnapshot.facts[0].sourceRows.map(r => r.earnedCreditsTotal), [4, 4]);
  assert.equal(sameSnapshot.facts[0].earnedCreditsTotal, null);
  assert.deepEqual(result.facts[0].sourceRowIds, [x.row.id, second.id]);
  assert.equal(result.facts[0].earnedCreditsTotal, null);
  assert.deepEqual(result.facts[0].sourceRows.map(r => r.earnedCreditsTotal), [4, 8]);
  assert.deepEqual(result.facts[0].allocation, { kind: 'unknown', reason: 'duplicate_official_rows' });
  assert.deepEqual(deriveOfficialGraduationFacts([second, x.row], [], x.f, x.scope), result);
  const progress = calculateGraduationProgress([item(x.offering, 'earned')], x.f, x.scope, [], 'not_selected', [], [x.row, second], x.profile);
  assert.equal(overall(progress), null); assert.match(progress.importedWarnings[0].reason, /duplicate_official_rows/);
  assert.deepEqual(deriveOfficialGraduationFacts([x.row, x.row], [], x.f, x.scope), deriveOfficialGraduationFacts([x.row], [], x.f, x.scope));
});

for (const change of ['null_total', 'composition_mismatch', 'course_mapping_mismatch']) {
  test(`official facts: ${change} is metadata_unknown with source aggregate retained`, () => {
    const x = fixture();
    if (change === 'null_total') x.row.earnedCreditsTotal = null;
    if (change === 'composition_mismatch') x.row.compositionCredits = 6;
    if (change === 'course_mapping_mismatch') x.mapping.curriculumCredits = 2;
    assert.deepEqual(facts(x).facts[0].allocation, { kind: 'unknown', reason: 'metadata_unknown' });
    assert.equal(facts(x).facts[0].earnedCreditsTotal, x.row.earnedCreditsTotal);
    assert.equal(overall(run(x)), null);
  });
}

test('official facts: confirmed zero differs from absent totals and never reconstructs from components', () => {
  const x = fixture(); x.row.earnedCreditsTotal = 0; x.row.schoolingCreditsTotal = 0;
  const records = [{ id: 'component', sourceCourseId: x.row.id, method: 'schooling', credits: 4 }];
  const result = deriveOfficialGraduationFacts([x.row], records, x.f, x.scope);
  assert.equal(result.facts[0].earnedCreditsTotal, 0); assert.equal(result.allocations[0].credits, 0);
  assert.equal(result.facts[0].schoolingEvidence.credits, 0);
  assert.equal(overall(run(x, [item(x.offering, 'earned')], records)), 0);
  assert.equal(run(x, [], records).referenceProgress[0].status, 'partial');
});

for (const schooling of [null, 6]) {
  test(`official facts: schooling ${schooling} is retained but not assumed countable`, () => {
    const x = fixture(); x.row.schoolingCreditsTotal = schooling;
    assert.equal(facts(x).facts[0].schoolingEvidence.credits, schooling);
    assert.equal(facts(x).allocations[0].schoolingCredits, null);
    assert.equal(overall(run(x)), 4);
    const reference = run(x).referenceProgress[1];
    assert.equal(reference.earned, null); assert.equal(reference.status, 'unknown');
  });
}

for (const [department, name] of [['法律学科', '法律学演習'], ['法律学科', '政治学'], ['史学科', '史学演習1'], ['史学科', '歴史資料学2'], ['史学科', '日本史概説'], ['地理学科', '現地研究'], ['地理学科', '地誌学特講'], ['地理学科', '人文地理学演習'], ['地理学科', '自然地理学演習'], ['日本文学科', '書道実技'], ['経済学科', '卒業論文'], ['法律学科', '基礎特講']]) {
  test(`official facts: ${name} retains evidence and requires a separate rule`, () => {
    const x = fixture(department); x.course.canonicalName = name;
    assert.deepEqual(facts(x).facts[0].allocation, { kind: 'unknown', reason: 'special_rule_evidence_required' });
    assert.equal(facts(x).facts[0].schoolingEvidence.credits, 2);
    assert.equal(overall(run(x)), null);
  });
}

test('H12 official facts: law partial2 retains evidence but cannot count ordinary without eight completions', () => {
  const x = fixture(); x.row.earnedCreditsTotal = 2;
  assert.equal(facts(x).allocations[0].credits, 2);
  assert.equal(facts(x).allocations[0].completedCredits, 0);
  assert.equal(facts(x).allocations[0].schoolingCredits, 2);
  assert.equal(overall(run(x)), 0);
});

test('official facts: legacy curriculum and recognized overlap are held separately', () => {
  const x = fixture(); x.profile.curriculumApplicability = 'legacy_or_transition';
  assert.equal(facts(x).facts[0].allocation.reason, 'special_rule_evidence_required');
  x.profile.curriculumApplicability = 'current_2026';
  x.profile.recognizedCredits.professionalCourses = [{ id: 'recognized', offeringId: x.offering.id, credits: 4 }];
  assert.ok(facts(x).facts[0].diagnostics.includes('recognized_overlap'));
  assert.equal(facts(x).allocations.length, 0);
});

test('official facts: known allocation survives alongside unresolved aggregate as a partial lower bound', () => {
  const x = fixture(); const unresolved = { ...x.row, id: 'unresolved', curriculumCourseId: null, curriculumMatch: 'unmatched', candidateCurriculumCourseIds: [] };
  const progress = calculateGraduationProgress([], x.f, x.scope, [], 'not_selected', [], [x.row, unresolved], x.profile);
  assert.equal(overall(progress), 4); assert.equal(progress.referenceProgress[0].status, 'unknown');
  assert.match(progress.referenceProgress[0].reason, /curriculum_identity_unresolved/);
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); }
  return value;
}
test('official facts: frozen achievements, components, Planner items, profile and Catalog are immutable', () => {
  const x = fixture(); const items = [item(x.offering, 'earned'), item(x.offering, 'planned')];
  const records = [{ id: 'school', method: 'schooling', credits: 2, sourceCourseId: x.row.id }];
  const snapshot = structuredClone({ x, items, records });
  deepFreeze(x); deepFreeze(items); deepFreeze(records);
  assert.equal(overall(run(x, items, records)), 4);
  deriveOfficialGraduationFacts([x.row], records, x.f, x.scope, x.profile);
  assert.deepEqual({ x, items, records }, snapshot);
  assert.equal(initialState().schemaVersion, 22);
  assert.equal('officialGraduationFacts' in initialState(), false);
  assert.equal(run(x).graduationCheckComplete, false);
  assert.equal(catalog.metadata.sourceLinksReverified, false);
});

for (const program of catalog.programs.filter(p => !p.isCommon)) {
  test(`official facts real catalog: ${program.department}/${program.course ?? ''} survives zero Offerings`, () => {
    const x = fixture(program.department); x.scope = program.scopeId; x.f = structuredClone(catalog);
    const candidates = catalog.curriculum.courses.filter(c => c.mappingIds.some(id => catalog.mappings.some(m => m.mappingId === id && m.scopeId === program.scopeId && m.category === '専門教育')));
    const normal = candidates.find(c => {
      const row = { ...x.row, curriculumCourseId: c.id, candidateCurriculumCourseIds: [c.id], rawName: c.canonicalName, compositionCredits: c.curriculumCredits, earnedCreditsTotal: c.curriculumCredits, schoolingCreditsTotal: 0, courseId: null };
      return deriveOfficialGraduationFacts([row], [], x.f, x.scope, x.profile).allocations.length === 1;
    });
    assert.ok(normal, 'each of the eight program scopes must have a real ordinary curriculum course');
    x.row = { ...x.row, curriculumCourseId: normal.id, candidateCurriculumCourseIds: [normal.id], rawName: normal.canonicalName, compositionCredits: normal.curriculumCredits, earnedCreditsTotal: normal.curriculumCredits, schoolingCreditsTotal: 0, courseId: null };
    const before = facts(x); const progress = run(x);
    assert.equal(before.allocations.length, 1); assert.equal(overall(progress), normal.curriculumCredits);
    x.f.offerings = []; x.f.courses = [];
    assert.deepEqual(facts(x), before);
    assert.equal(overall(run(x)), normal.curriculumCredits);
    assert.equal(run(x).graduationCheckComplete, false);
  });
}

for (const field of ['人文', '社会', '自然', 'その他']) {
  test(`official common ${field}: completion, scope and budget use Course metadata`, () => {
    const x = fixture(); x.mapping.scopeId = x.common; x.mapping.category = '一般教育'; x.mapping.field = field;
    x.f.offerings = []; x.row.courseId = null;
    assert.equal(overall(run(x)), 4);
    const card = run(x).cards.find(c => c.requirementId === 'group-general');
    assert.equal(card.earned, 4);
    if (field !== 'その他') assert.equal(card.details.find(d => d.label === field).earned, 4);
    x.row.earnedCreditsTotal = 2; x.row.schoolingCreditsTotal = 2;
    assert.equal(overall(run(x)), 0, 'partial general Course does not complete a curriculum row');
    assert.equal(run(x).referenceProgress[1].earned, 2, 'attendance evidence is a separate axis');
  });
}

test('official foreign language: official4/schooling2 completes the same-language rule without Offerings', () => {
  const x = fixture(); x.mapping.scopeId = x.common; x.mapping.category = '外国語'; x.mapping.field = '英語'; x.f.offerings = [];
  const card = run(x).cards.find(c => c.requirementId === 'group-foreign');
  assert.equal(card.earned, 4); assert.equal(card.status, 'satisfied');
  assert.equal(card.details.find(d => d.label === '英語').schooling, 2);
  assert.equal(overall(run(x)), 4); assert.equal(run(x).referenceProgress[1].earned, 2);
});

test('official physical education: completion counts once at the two-credit cap', () => {
  const x = fixture(); x.mapping.scopeId = x.common; x.mapping.category = '保健体育';
  x.mapping.curriculumCredits = x.course.curriculumCredits = x.row.compositionCredits = x.row.earnedCreditsTotal = 2;
  x.course.canonicalName = '健康・スポーツ科学概論'; x.f.offerings = [];
  assert.equal(run(x).cards.find(c => c.requirementId === 'group-physical').status, 'satisfied');
  assert.equal(overall(run(x)), 2);
});

test('official generic named full-course evaluator consumes facts directly with zero Offerings', () => {
  const x = fixture(); x.f.offerings = [];
  const source = catalog.requirements.find(r => r.status === 'structured' && r.ruleType === 'min_credits');
  x.f.requirements = [{ ...source, id: 'named-official', ruleId: 'named-official', scopeId: x.scope, value: 4,
    target: { course_name: x.course.canonicalName }, conditions: { full_course_credits_required: true, min_courses: 1 } }];
  const requirement = run(x).requirements.find(r => r.requirementId === 'named-official');
  assert.equal(requirement.earned, 4); assert.equal(requirement.status, 'satisfied');
});

test('official identity: exact flag with invalid candidates and selectedOffering never promotes a row', () => {
  const x = fixture(); x.row.candidateCurriculumCourseIds = [];
  x.row.selectedOfferingId = x.offering.id; x.row.offeringMatch = 'exact_unique';
  assert.equal(exactImportedCurriculumId(x.row, x.f), null);
  assert.equal(facts(x).facts[0].allocation.reason, 'curriculum_identity_unresolved');
  assert.equal(overall(run(x)), null);
});

test('official metadata: absent row composition uses agreeing Course and Mapping metadata only', () => {
  const x = fixture(); x.row.compositionCredits = null;
  assert.equal(facts(x).facts[0].sourceRows[0].compositionCredits, null);
  assert.equal(facts(x).facts[0].compositionCredits, 4);
  assert.equal(overall(run(x)), 4);
});

test('official schooling: exclusion and recognition overlap keep evidence but hold reference allocation', () => {
  const x = fixture(); x.course.canonicalName = '情報学入門';
  assert.equal(facts(x).facts[0].schoolingEvidence.credits, 2);
  assert.equal(facts(x).allocations[0].schoolingCredits, null);
  assert.equal(run(x).referenceProgress[1].status, 'unknown');
  x.course.canonicalName = '監査科目';
  x.profile.admissionType = 'transfer_third_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = 15;
  assert.equal(facts(x).allocations[0].schoolingCredits, null);
});

test('official thesis: manual ThesisProgress stays authoritative and official thesis adds no credit', () => {
  const x = fixture('経済学科'); x.course.canonicalName = '卒業論文';
  x.row.earnedCreditsTotal = x.row.compositionCredits = x.course.curriculumCredits = x.mapping.curriculumCredits = 6;
  const progress = calculateGraduationProgress([], x.f, x.scope, [], 'selected', [], [x.row], x.profile, { selection: 'selected', status: 'earned' });
  assert.equal(overall(progress), 6);
  assert.equal(progress.cards.find(c => c.ruleType === 'thesis_progress').earned, 6);
  assert.equal(progress.referenceProgress[0].status, 'unknown');
  assert.match(progress.importedWarnings[0].reason, /special_rule_evidence_required/);
});

for (const reason of ['unresolved', 'out_of_scope', 'schooling_unknown', 'mapping_conflict', 'method_required']) {
  test(`import UX: zero official credit suppresses graduation notices (${reason}) without deleting facts`, () => {
    const x = fixture(); x.row.earnedCreditsTotal = 0;
    if (reason === 'unresolved') { x.row.curriculumCourseId = null; x.row.curriculumMatch = 'unmatched'; }
    if (reason === 'out_of_scope') x.mapping.scopeId = 'outside';
    if (reason === 'schooling_unknown') x.row.schoolingCreditsTotal = null;
    if (reason === 'mapping_conflict') { x.f.mappings.push({ ...x.mapping, mappingId: 'conflict', requirementType: '選択' }); x.course.mappingIds.push('conflict'); }
    if (reason === 'method_required') x.mapping.mediaOnly = true;
    const snapshot = structuredClone(x);
    assert.deepEqual(run(x).importedWarnings, []);
    assert.equal(facts(x).facts[0].sourceRows[0].earnedCreditsTotal, 0);
    assert.deepEqual(x, snapshot);
  });
}
test('import UX: null official credit is unknown, never treated as explicit zero', () => {
  const x = fixture(); x.row.earnedCreditsTotal = null;
  const notices = run(x).importedWarnings;
  assert.equal(notices.length, 1); assert.equal(notices[0].kind, 'credits_unknown');
  assert.match(notices[0].reason, /metadata_unknown/);
  assert.equal(facts(x).facts[0].earnedCreditsTotal, null);
  assert.equal(overall(run(x)), null);
});
test('import UX: schooling-only confirmation retains official allocation and ordinary credit', () => {
  const x = fixture(); x.row.schoolingCreditsTotal = null;
  const snapshot = structuredClone(x.row);
  assert.equal(facts(x).allocations[0].credits, 4);
  assert.equal(overall(run(x)), 4);
  assert.deepEqual(run(x).importedWarnings.map(n => n.kind), ['schooling_confirmation']);
  assert.match(run(x).importedWarnings[0].reason, /通常の卒業単位は算入済み/);
  assert.deepEqual(x.row, snapshot);
});
test('import UX: positive unresolved allocation is held; null remains a separate confirmation', () => {
  const x = fixture(); x.row.curriculumCourseId = null; x.row.curriculumMatch = 'ambiguous';
  assert.deepEqual(run(x).importedWarnings.map(n => n.kind), ['allocation_held']);
  x.row.earnedCreditsTotal = null;
  assert.deepEqual(run(x).importedWarnings.map(n => n.kind), ['credits_unknown']);
});
test('import UX: safely confirmed out-of-scope positive credit is informational and does not hold totals', () => {
  const x = fixture(); x.mapping.scopeId = 'outside';
  assert.equal(facts(x).facts[0].allocation.kind, 'out_of_scope');
  assert.equal(overall(run(x)), 0);
  assert.deepEqual(run(x).importedWarnings.map(n => n.kind), ['out_of_scope']);
  x.row.earnedCreditsTotal = 0; assert.deepEqual(run(x).importedWarnings, []);
  x.row.earnedCreditsTotal = null; assert.deepEqual(run(x).importedWarnings.map(n => n.kind), ['credits_unknown']);
});
test('import UX: duplicate positive source rows stay held without inventing an aggregate; all-zero duplicates stay silent', () => {
  const x = fixture();
  const rows = [x.row, { ...x.row, id: 'other-source', earnedCreditsTotal: 2 }];
  const calc = () => calculateGraduationProgress([], x.f, x.scope, [], 'not_selected', [], rows, x.profile);
  assert.equal(deriveOfficialGraduationFacts(rows, [], x.f, x.scope).facts[0].earnedCreditsTotal, null);
  assert.deepEqual(calc().importedWarnings.map(n => n.kind), ['allocation_held']);
  rows.forEach(row => { row.earnedCreditsTotal = 0; }); assert.deepEqual(calc().importedWarnings, []);
  rows[0].earnedCreditsTotal = null; assert.deepEqual(calc().importedWarnings.map(n => n.kind), ['credits_unknown']);
});

const freezeCreditInputs = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeCreditInputs); Object.freeze(value); }
  return value;
};
const creditReference = (progress, id) => progress.referenceProgress.find(row => row.id === id);
const calculateCreditRows = (x, rows, records = []) => calculateGraduationProgress([], x.f, x.scope, [], 'not_selected', records, rows, x.profile);

for (const mode of ['single_unresolved', 'duplicate', 'allocated_schooling_null', 'mapping_conflict']) {
  test(`credit semantics: all-zero ${mode} preserves baseline requirements/cards/references and retained facts`, () => {
    const x = fixture(); x.row.earnedCreditsTotal = 0; x.row.schoolingCreditsTotal = null;
    if (mode === 'single_unresolved') { x.row.curriculumCourseId = null; x.row.curriculumMatch = 'unmatched'; x.row.candidateCurriculumCourseIds = []; }
    if (mode === 'mapping_conflict') { x.f.mappings.push({ ...x.mapping, mappingId: 'credit-conflict', requirementType: '選択' }); x.course.mappingIds.push('credit-conflict'); }
    const rows = mode === 'duplicate' ? [x.row, { ...x.row, id: 'zero-second' }] : [x.row];
    const baseline = calculateCreditRows(x, []);
    const snapshot = structuredClone({ x, rows }); freezeCreditInputs({ x, rows });
    const progress = calculateCreditRows(x, rows);
    const result = deriveOfficialGraduationFacts(rows, [], x.f, x.scope, x.profile);
    assert.deepEqual(progress.importedWarnings, []);
    assert.deepEqual(progress.requirements, baseline.requirements, 'no officialUnknown contamination of requirements');
    assert.deepEqual(progress.cards, baseline.cards, 'no officialUnknown or schoolingUnknown contamination of cards');
    assert.deepEqual(progress.referenceProgress, baseline.referenceProgress, 'ordinary and schooling reference remain baseline');
    assert.equal(overall(progress), 0);
    assert.equal(creditReference(progress, 'schooling-reference-progress').earned, 0);
    assert.notEqual(professional(progress).status, 'unknown');
    assert.equal(result.facts[0].sourceRows.length, rows.length);
    assert.ok(result.facts[0].sourceRows.every(row => row.earnedCreditsTotal === 0));
    if (mode === 'duplicate') {
      assert.equal(result.facts[0].earnedCreditsTotal, null);
      assert.equal(result.facts[0].allocation.reason, 'duplicate_official_rows');
      assert.ok(result.facts[0].diagnostics.includes('conflicting_source_rows'));
      assert.equal(result.allocations.length, 0);
    }
    assert.deepEqual({ x, rows }, snapshot);
  });
}
for (const values of [[null], [0, null], [null, null], [4], [0, 4], [4, 4], [4, null]]) {
  test(`credit semantics: unresolved ${JSON.stringify(values)} retains uncertainty without synthesizing duplicate aggregates`, () => {
    const x = fixture();
    const rows = values.map((earnedCreditsTotal, index) => ({ ...x.row, id: `credit-${index}`, earnedCreditsTotal, schoolingCreditsTotal: null }));
    if (rows.length === 1 && values[0] === 4) { rows[0].curriculumCourseId = null; rows[0].curriculumMatch = 'unmatched'; rows[0].candidateCurriculumCourseIds = []; }
    const snapshot = structuredClone({ x, rows }); freezeCreditInputs({ x, rows });
    const result = deriveOfficialGraduationFacts(rows, [], x.f, x.scope, x.profile);
    const progress = calculateCreditRows(x, rows);
    assert.deepEqual(progress.importedWarnings.map(notice => notice.kind), [values.some(value => value !== null && value > 0) ? 'allocation_held' : 'credits_unknown']);
    assert.equal(overall(progress), null);
    assert.equal(professional(progress).status, 'unknown');
    assert.ok(progress.requirements.filter(row => row.ruleType !== 'thesis_progress').every(row => row.status === 'unknown'));
    assert.equal(creditReference(progress, 'overall-reference-progress').status, 'unknown');
    assert.equal(creditReference(progress, 'schooling-reference-progress').status, 'unknown');
    assert.equal(creditReference(progress, 'schooling-reference-progress').earned, null);
    assert.equal(result.allocations.length, 0);
    assert.deepEqual(result.facts[0].sourceRows.map(row => row.earnedCreditsTotal), values);
    if (rows.length > 1) assert.equal(result.facts[0].earnedCreditsTotal, null, 'neither sum/max/latest nor matching fingerprint resolves distinct official rows');
    assert.deepEqual({ x, rows }, snapshot);
  });
}
test('credit semantics: positive allocated credit with null schooling holds only schooling, preserving ordinary credit and facts', () => {
  const x = fixture(); x.row.schoolingCreditsTotal = null;
  const baseline = run(fixture()); const snapshot = structuredClone(x); freezeCreditInputs(x);
  const result = facts(x), progress = run(x);
  assert.equal(result.allocations.length, 1); assert.equal(result.allocations[0].credits, 4); assert.equal(result.allocations[0].schoolingCredits, null);
  assert.deepEqual(progress.importedWarnings.map(notice => notice.kind), ['schooling_confirmation']);
  assert.equal(overall(progress), 4); assert.equal(professional(progress).status, professional(baseline).status);
  assert.deepEqual(progress.requirements.filter(row => row.ruleType !== 'min_schooling_credits'), baseline.requirements.filter(row => row.ruleType !== 'min_schooling_credits'));
  assert.equal(creditReference(progress, 'overall-reference-progress').status, creditReference(baseline, 'overall-reference-progress').status);
  assert.equal(creditReference(progress, 'schooling-reference-progress').status, 'unknown');
  assert.equal(progress.cards.find(row => row.requirementId === 'professional-law-schooling').status, 'unknown');
  assert.deepEqual(x, snapshot);
});
test('credit semantics: all-zero facts cannot mask genuinely unresolved orphan legacy evidence', () => {
  const x = fixture(); const rows = [{ ...x.row, earnedCreditsTotal: 0 }, { ...x.row, id: 'other-zero', earnedCreditsTotal: 0 }];
  const records = [{ id: 'legacy-orphan', rawName: '親行不明', sourceCourseId: 'missing', method: 'schooling', credits: 2, schoolingCreditsTotal: null }];
  const progress = calculateCreditRows(x, rows, records);
  assert.deepEqual(progress.importedWarnings.map(notice => notice.kind), ['credits_unknown']);
  assert.equal(overall(progress), null); assert.equal(professional(progress).status, 'unknown');
  assert.equal(creditReference(progress, 'schooling-reference-progress').status, 'unknown');
});
test('credit semantics: matched schooling requirement ignores zero-credit null evidence but holds positive-credit null evidence', () => {
  for (const earnedCreditsTotal of [0, 4]) {
    const x = fixture(); x.row.earnedCreditsTotal = earnedCreditsTotal; x.row.schoolingCreditsTotal = null;
    const template = x.f.requirements.find(row => row.status === 'structured' && row.ruleType === 'min_schooling_credits');
    assert.ok(template);
    x.f.requirements = [...x.f.requirements, { ...template, id: 'credit-schooling', ruleId: 'credit_schooling_test', scopeId: x.scope,
      conditions: null, target: { curriculum_category: '専門教育', requirement_type: '選択必修' }, value: 2, unit: 'credits' }];
    const requirement = run(x).requirements.find(row => row.requirementId === 'credit-schooling');
    assert.ok(requirement);
    assert.equal(requirement.status, earnedCreditsTotal === 0 ? 'unsatisfied' : 'unknown');
    if (earnedCreditsTotal === 0) assert.equal(requirement.earned, 0);
    else assert.match(requirement.reason, /スクーリング算入条件が未確認/);
  }
});

// Media method evidence uses the official row budget, independently of annual openings.
function mediaFixture(credits = 2) {
  const x = fixture();
  x.mapping.mediaOnly = true;
  x.mapping.curriculumCredits = x.course.curriculumCredits = x.row.compositionCredits = x.row.earnedCreditsTotal = credits;
  x.row.schoolingCreditsTotal = null;
  return x;
}
const mediaRecord = (x, patch = {}) => ({
  id: 'media-source', fingerprint: 'media-source', source: 'hosei_import', sourceCourseId: x.row.id,
  rawName: x.row.rawName, method: 'schooling', rawTerm: 'メ', term: '編集後の学期', rawYear: '20',
  academicYear: 2020, yearSource: 'source', date: null, credits: null, grade: null,
  offeringId: null, match: 'unmatched', ...patch,
});
const mediaFacts = (x, records = [mediaRecord(x)], rows = [x.row]) => deriveOfficialGraduationFacts(rows, records, x.f, x.scope, x.profile);
const schoolingReference = progress => creditReference(progress, 'schooling-reference-progress').earned;

for (const schooling of [2, null]) test(`media evidence: official earned2 / schooling ${schooling} allocates ordinary2 and schooling2 immutably`, () => {
  const x = mediaFixture(); x.row.schoolingCreditsTotal = schooling;
  const records = [mediaRecord(x)]; const rows = [x.row];
  const before = structuredClone({ x, rows, records }); deepFreeze({ x, rows, records });
  const result = mediaFacts(x, records, rows), progress = run(x, [], records);
  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].schoolingCredits, 2);
  assert.equal(result.facts[0].methodEvidence.media, 'confirmed');
  assert.equal(result.facts[0].methodEvidence.allEarnedCreditsAreMedia, true);
  assert.equal(result.facts[0].schoolingEvidence.source, schooling === null ? 'media_earned' : 'official_row');
  assert.equal(result.facts[0].sourceRows[0].schoolingCreditsTotal, schooling);
  assert.equal(overall(progress), 2); assert.equal(schoolingReference(progress), 2);
  assert.deepEqual(progress.importedWarnings, []);
  assert.equal(progress.graduationCheckComplete, false);
  assert.deepEqual({ x, rows, records }, before);
});

test('media evidence: earned0 remains zero without hold or warning despite positive component credits', () => {
  const x = mediaFixture(); x.row.earnedCreditsTotal = 0;
  const records = [mediaRecord(x, { credits: 2 })];
  const result = mediaFacts(x, records), progress = run(x, [], records);
  assert.equal(result.allocations[0].credits, 0); assert.equal(result.allocations[0].schoolingCredits, 0);
  assert.equal(result.facts[0].methodEvidence.media, 'confirmed');
  assert.equal(result.facts[0].methodEvidence.allEarnedCreditsAreMedia, false);
  assert.deepEqual(result.facts[0].diagnostics, []);
  assert.equal(overall(progress), 0); assert.equal(schoolingReference(progress), 0);
  assert.deepEqual(progress.importedWarnings, []);
});

test('media evidence: earned null cannot become credits from marker or component', () => {
  const x = mediaFixture(); x.row.earnedCreditsTotal = null;
  const records = [mediaRecord(x, { credits: 2 })];
  const result = mediaFacts(x, records), progress = run(x, [], records);
  assert.equal(result.allocations.length, 0); assert.equal(result.facts[0].schoolingEvidence.credits, null);
  assert.equal(result.facts[0].methodEvidence.allEarnedCreditsAreMedia, false);
  assert.equal(overall(progress), null); assert.equal(schoolingReference(progress), null);
  assert.deepEqual(progress.importedWarnings.map(n => n.kind), ['credits_unknown']);
});

for (const rawTerm of [null, '夏', 'メディア', 'MEDIA', 'media', '前期メディア', '後期メディア', 'メ 夏']) {
  test(`media evidence: editable term and unverified marker ${rawTerm} cannot resolve method`, () => {
    const x = mediaFixture(); x.row.selectedOfferingId = x.offering.id;
    x.offering.method = 'schooling'; x.offering.deliveryCategory = '前期メディア';
    const records = [mediaRecord(x, { rawTerm, term: 'メ', offeringId: x.offering.id })];
    const result = mediaFacts(x, records);
    assert.equal(result.allocations.length, 0);
    assert.ok(result.facts[0].diagnostics.includes('method_evidence_required'));
    assert.deepEqual(run(x, [], records).importedWarnings.map(n => n.kind), ['allocation_held']);
  });
}
for (const rawTerm of [' メ ', '　ﾒ　']) test(`media evidence: only trim and NFKC normalize ${rawTerm}`, () => {
  const x = mediaFixture(); const result = mediaFacts(x, [mediaRecord(x, { rawTerm })]);
  assert.equal(result.allocations[0].schoolingCredits, 2);
  assert.deepEqual(result.facts[0].methodEvidence.rawTerms, [rawTerm]);
});

for (const patch of [
  { rawTerm: '夏', credits: 2 },
  { rawTerm: null, credits: 2 },
  { method: 'correspondence', rawTerm: null, credits: 2, grade: 'A' },
  { method: 'correspondence', rawTerm: null, rawYear: null, reports: [{ raw: '＊', status: 'pending', date: null }] },
]) test(`media evidence: substantive mixed evidence holds method (${JSON.stringify(patch)})`, () => {
  const x = mediaFixture(4);
  const records = [mediaRecord(x, { credits: 2 }), mediaRecord(x, { ...patch, id: 'non-media' })];
  const result = mediaFacts(x, records);
  assert.equal(result.allocations.length, 0);
  assert.equal(result.facts[0].methodEvidence.media, 'conflict');
  assert.equal(result.facts[0].methodEvidence.allEarnedCreditsAreMedia, false);
  assert.ok(result.facts[0].diagnostics.includes('method_evidence_conflict'));
  assert.equal(result.facts[0].schoolingEvidence.credits, null);
  assert.equal(schoolingReference(run(x, [], records)), null);
  assert.deepEqual(run(x, [], records).importedWarnings.map(n => n.kind), ['allocation_held']);
  assert.deepEqual(mediaFacts(x, records.toReversed()), result);
});

test('media evidence: source-owned record and direct row link are required, without orphan/name leakage', () => {
  const x = mediaFixture();
  for (const patch of [{ sourceCourseId: 'wrong-row' }, { sourceCourseId: undefined }, { source: 'manual' }, { method: 'correspondence' }]) {
    const result = mediaFacts(x, [mediaRecord(x, patch)]);
    assert.equal(result.allocations.length, 0);
    assert.equal(result.facts[0].methodEvidence.media, 'unknown');
  }
  const other = { ...x.row, id: 'unrelated-row', curriculumCourseId: null, candidateCurriculumCourseIds: [], curriculumMatch: 'unmatched' };
  const result = mediaFacts(x, [mediaRecord(x, { sourceCourseId: other.id })], [x.row, other]);
  assert.ok(result.facts.every(f => f.allocation.kind === 'unknown'));
  assert.equal(result.allocations.length, 0);
});

test('media evidence: ambiguous identity and duplicate rows remain unresolved with null duplicate aggregate', () => {
  const x = mediaFixture();
  x.row.curriculumMatch = 'ambiguous';
  assert.equal(mediaFacts(x).facts[0].allocation.reason, 'curriculum_identity_unresolved');
  x.row.curriculumMatch = 'exact_unique';
  const second = { ...x.row, id: 'duplicate', capturedAt: '2099-01-01' };
  const records = [mediaRecord(x), mediaRecord(x, { id: 'second-media', sourceCourseId: second.id })];
  const result = mediaFacts(x, records, [x.row, second]);
  assert.equal(result.allocations.length, 0);
  assert.equal(result.facts[0].allocation.reason, 'duplicate_official_rows');
  assert.equal(result.facts[0].earnedCreditsTotal, null);
  assert.equal(result.facts[0].schoolingEvidence.credits, null);
  assert.equal(result.facts[0].methodEvidence.allEarnedCreditsAreMedia, false);
});

for (const schooling of [0, 1, 3, -1]) test(`media evidence: explicit schooling ${schooling} follows official priority and validation`, () => {
  const x = mediaFixture(); x.row.schoolingCreditsTotal = schooling;
  const records = [mediaRecord(x)], result = mediaFacts(x, records), progress = run(x, [], records);
  const expectedSchooling = schooling === 1 ? 1 : null;
  assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].schoolingCredits, expectedSchooling);
  assert.equal(result.facts[0].schoolingEvidence.credits, schooling);
  assert.equal(result.facts[0].schoolingEvidence.source, 'official_row');
  assert.equal(x.row.schoolingCreditsTotal, schooling);
  assert.equal(result.facts[0].diagnostics.includes('media_schooling_credits_conflict'), schooling === 0);
  assert.equal(result.facts[0].diagnostics.includes('schooling_evidence_requires_confirmation'), expectedSchooling === null);
  assert.equal(overall(progress), 2); assert.equal(schoolingReference(progress), expectedSchooling);
  assert.deepEqual(progress.importedWarnings.map(n => n.kind), expectedSchooling === null ? ['schooling_confirmation'] : []);
});

for (const components of [[null], [2, 2], [4, 4]]) test(`media evidence: pure media official4 uses one budget, never component sum (${components})`, () => {
  const x = mediaFixture(4);
  const records = components.map((credits, index) => mediaRecord(x, { id: `media-${index}`, credits }));
  const result = mediaFacts(x, records);
  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0].credits, 4); assert.equal(result.allocations[0].schoolingCredits, 4);
  assert.equal(overall(run(x, [], records)), 4); assert.equal(schoolingReference(run(x, [], records)), 4);
});

test('media evidence: ordinary mapping uses the same schooling projection without requiring media method', () => {
  const x = mediaFixture(); x.mapping.mediaOnly = false;
  const media = [mediaRecord(x)];
  assert.equal(mediaFacts(x, media).allocations[0].schoolingCredits, 2);
  const ordinary = [mediaRecord(x, { rawTerm: '夏' })];
  assert.equal(mediaFacts(x, ordinary).allocations[0].credits, 2);
  assert.equal(mediaFacts(x, ordinary).allocations[0].schoolingCredits, null);
  assert.deepEqual(run(x, [], ordinary).importedWarnings.map(n => n.kind), ['schooling_confirmation']);
  x.row.schoolingCreditsTotal = 1;
  assert.equal(mediaFacts(x, ordinary).allocations[0].schoolingCredits, 1);
});

test('media evidence: equivalent mappings count once and conflicting mappings never resolve', () => {
  const x = mediaFixture(); x.f.mappings.push({ ...x.mapping, mappingId: 'media-equivalent' });
  x.course.mappingIds.push('media-equivalent');
  assert.equal(mediaFacts(x).facts[0].allocation.kind, 'equivalent');
  assert.equal(mediaFacts(x).allocations.length, 1);
  x.f.mappings[1].mediaOnly = false;
  assert.equal(mediaFacts(x).facts[0].allocation.reason, 'mapping_conflict');
  assert.equal(mediaFacts(x).allocations.length, 0);
});

test('media evidence: annual Offering order/removal and editable term cannot affect historical method', () => {
  const x = mediaFixture();
  x.f.offerings.push({ ...x.offering, id: 'annual-media', method: 'schooling', deliveryCategory: '前期メディア' });
  const records = [mediaRecord(x)], result = mediaFacts(x, records), progress = run(x, [], records);
  x.f.offerings.reverse();
  assert.deepEqual(mediaFacts(x, records), result); assert.deepEqual(run(x, [], records), progress);
  x.f.offerings = []; records[0].term = '夏';
  assert.deepEqual(mediaFacts(x, records), result); assert.deepEqual(run(x, [], records), progress);
});

for (const guard of ['legacy', 'special', 'repeatable', 'recognition', 'additional', 'recognized_overlap', 'out_of_scope', 'schooling_exclusion', 'schooling_recognition']) {
  test(`media evidence: existing ${guard} policy remains authoritative`, () => {
    const x = mediaFixture();
    if (guard === 'legacy') x.profile.curriculumApplicability = 'legacy_or_transition';
    if (guard === 'special') x.course.canonicalName = '卒業論文';
    if (guard === 'repeatable') x.course.canonicalName = '総合特講';
    if (guard === 'recognition') x.row.recognizedExemption = 2;
    if (guard === 'additional') x.row.additionalEnrollment = 2;
    if (guard === 'recognized_overlap') x.profile.recognizedCredits.professionalCourses = [{ id: 'r', offeringId: x.offering.id, credits: 2 }];
    if (guard === 'out_of_scope') x.mapping.scopeId = 'other-scope';
    if (guard === 'schooling_exclusion') x.course.canonicalName = '情報学入門';
    if (guard === 'schooling_recognition') { x.profile.admissionType = 'transfer_third_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = 15; }
    const result = mediaFacts(x);
    if (guard.startsWith('schooling_')) {
      assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].schoolingCredits, null);
      assert.ok(result.facts[0].diagnostics.includes('schooling_evidence_requires_confirmation'));
    } else assert.equal(result.allocations.length, 0);
  });
}

for (const name of ['データサイエンス入門A', 'データサイエンス応用基礎B', '生物学2']) {
  test(`media evidence real catalog: ${name} resolves method while retaining existing schooling exclusions`, () => {
    const x = mediaFixture(); x.f = structuredClone(catalog);
    const course = x.f.curriculum.courses.find(c => c.canonicalName === name);
    assert.ok(course); assert.equal(course.curriculumCredits, 2);
    const mappings = x.f.mappings.filter(m => course.mappingIds.includes(m.mappingId));
    assert.ok(mappings.every(m => m.mediaOnly && !m.schoolingOnly && m.curriculumCredits === 2));
    assert.ok(mappings.every(m => m.category === (name === '生物学2' ? '一般教育' : '専門教育')));
    assert.ok(mappings.every(m => m.field === (name === '生物学2' ? '自然' : null)));
    assert.ok(mappings.every(m => m.requirementType === (name === '生物学2' ? '選択必修' : '選択')));
    x.row = { ...x.row, rawName: name, curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id], courseId: null };
    for (const program of x.f.programs.filter(p => !p.isCommon)) {
      x.scope = program.scopeId;
      assert.equal(mediaFacts(x, []).allocations.length, 0);
      assert.equal(overall(run(x)), null); assert.equal(schoolingReference(run(x)), null);
      const records = [mediaRecord(x)], result = mediaFacts(x, records), progress = run(x, [], records);
      assert.equal(result.allocations.length, 1); assert.equal(result.allocations[0].credits, 2);
      const lawExclusion = program.department === '法律学科' && name !== '生物学2';
      assert.equal(result.allocations[0].schoolingCredits, lawExclusion ? null : 2);
      assert.equal(overall(progress), 2); assert.equal(schoolingReference(progress), lawExclusion ? null : 2);
      assert.deepEqual(progress.importedWarnings.map(n => n.kind), lawExclusion ? ['schooling_confirmation'] : []);
    }
  });
}

test('media evidence: actual import course-only fallback is not correspondence evidence; substantive imports are', () => {
  const x = mediaFixture();
  const emptySlot = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null };
  const course = { rawName: x.row.rawName, categoryRaw: null, compositionCredits: { raw: '2', value: 2 },
    additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null },
    earnedCredits: { raw: '2', value: 2 }, schoolingCredits: { raw: '', value: null },
    reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
    creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false },
    schoolings: [emptySlot, emptySlot] };
  const preview = () => importPreview({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-04T00:00:00Z', courses: [course] }, [], [], [], { curriculum: x.f.curriculum, mappings: x.f.mappings });
  const fallback = preview()[0];
  assert.equal(fallback.courseOnly, true); assert.equal(fallback.method, 'correspondence');
  x.row = { ...x.row, id: fallback.sourceCourse.id, fingerprint: fallback.sourceCourse.fingerprint };
  // A source refresh can retain the older compatibility record alongside a new detail.
  const records = [{ ...fallback, term: 'メ', academicYear: 2026 }, mediaRecord(x)];
  x.row.fingerprint = 'refreshed-source-payload';
  assert.equal(mediaFacts(x, records).allocations[0].schoolingCredits, 2);
  assert.deepEqual(mediaFacts(x, records).facts[0].methodEvidence.recordIds, ['media-source']);
  // The same-looking fallback is not ignored once substantive source details exist.
  records[0].credits = 2;
  assert.equal(mediaFacts(x, records).facts[0].methodEvidence.media, 'conflict');
  // A pending exam alone triggers hasCorrespondenceEvidence in the real pipeline.
  course.creditExam.pendingMarker = true;
  const pending = preview()[0];
  assert.equal(pending.courseOnly, undefined);
  assert.equal(mediaFacts(x, [mediaRecord(x), { ...pending, sourceCourseId: x.row.id }]).facts[0].methodEvidence.media, 'conflict');
  // The source schooling marker survives import even with no annual opening.
  course.creditExam.pendingMarker = false;
  course.schoolings = [{ ...emptySlot, rawTerm: 'メ', term: 'メ' }, emptySlot];
  const media = preview()[0];
  const result = mediaFacts(x, [{ ...media, sourceCourseId: x.row.id }]);
  assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].schoolingCredits, 2);
});

test('media evidence: schooling-only mapping accepts proven media but explicit zero still holds schooling', () => {
  const x = mediaFixture(); x.mapping.schoolingOnly = true;
  assert.equal(mediaFacts(x).allocations[0].schoolingCredits, 2);
  x.row.schoolingCreditsTotal = 0;
  assert.equal(mediaFacts(x).allocations[0].credits, 2);
  assert.equal(mediaFacts(x).allocations[0].schoolingCredits, null);
});

// Follow-up: authoritative positive schooling aggregates outrank media inference.
for (const [label, earned, schooling, expected, warnings, evidenceSource] of [
  ['A', 2, 2, 2, [], 'official_row'],
  ['B', 2, null, 2, [], 'media_earned'],
  ['C', 2, 0, null, ['schooling_confirmation'], 'official_row'],
  ['D', 2, 1, 1, [], 'official_row'],
  ['E', 4, 2, 2, [], 'official_row'],
  ['F', 2, 3, null, ['schooling_confirmation'], 'official_row'],
  ['G', 0, 0, 0, [], 'official_row'],
  ['H', null, null, null, ['credits_unknown'], 'unknown'],
]) test(`official schooling priority ${label}: earned ${earned}, source schooling ${schooling}`, () => {
  const x = mediaFixture(earned === 4 ? 4 : 2);
  x.row.earnedCreditsTotal = earned; x.row.schoolingCreditsTotal = schooling;
  const records = [mediaRecord(x, { credits: 4 })], rows = [x.row];
  const snapshot = structuredClone({ x, records, rows }); deepFreeze({ x, records, rows });
  const result = mediaFacts(x, records, rows), progress = run(x, [], records);
  assert.equal(result.allocations.length, earned === null ? 0 : 1);
  if (earned !== null) {
    assert.equal(result.allocations[0].credits, earned);
    assert.equal(result.allocations[0].schoolingCredits, expected);
  }
  const fact = result.facts[0];
  assert.equal(fact.schoolingEvidence.source, evidenceSource);
  assert.equal(fact.schoolingEvidence.credits, evidenceSource === 'media_earned' ? earned : schooling);
  assert.equal(fact.sourceRows[0].schoolingCreditsTotal, schooling);
  assert.equal(fact.diagnostics.includes('media_schooling_credits_conflict'), label === 'C');
  assert.equal(fact.diagnostics.includes('schooling_evidence_requires_confirmation'), ['C', 'F'].includes(label));
  assert.deepEqual(progress.importedWarnings.map(n => n.kind), warnings);
  assert.equal(overall(progress), earned); assert.equal(schoolingReference(progress), expected);
  assert.deepEqual({ x, records, rows }, snapshot);
});

for (const schooling of [-1, NaN, Infinity, -Infinity]) test(`official schooling priority: invalid ${schooling} never falls back to media-derived value`, () => {
  const x = mediaFixture(); x.row.schoolingCreditsTotal = schooling;
  const records = [mediaRecord(x)], snapshot = structuredClone({ x, records }); deepFreeze({ x, records });
  const result = mediaFacts(x, records), progress = run(x, [], records);
  assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].schoolingCredits, null);
  assert.equal(result.facts[0].schoolingEvidence.source, 'official_row');
  assert.equal(result.facts[0].schoolingEvidence.credits, schooling);
  assert.ok(result.facts[0].diagnostics.includes('schooling_evidence_requires_confirmation'));
  assert.equal(result.facts[0].diagnostics.includes('media_schooling_credits_conflict'), false);
  assert.equal(overall(progress), 2); assert.equal(schoolingReference(progress), null);
  assert.deepEqual(progress.importedWarnings.map(n => n.kind), ['schooling_confirmation']);
  assert.deepEqual({ x, records }, snapshot);
});

for (const rawTerm of ['夏', 'メ']) test(`official schooling priority: ordinary mapping retains official1 with marker ${rawTerm}`, () => {
  const x = mediaFixture(); x.mapping.mediaOnly = false; x.row.schoolingCreditsTotal = 1;
  const records = [mediaRecord(x, { rawTerm })];
  const result = mediaFacts(x, records), progress = run(x, [], records);
  assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].schoolingCredits, 1);
  assert.equal(result.facts[0].schoolingEvidence.source, 'official_row');
  assert.equal(result.facts[0].schoolingEvidence.credits, 1);
  assert.deepEqual(result.facts[0].diagnostics, []);
  assert.equal(overall(progress), 2); assert.equal(schoolingReference(progress), 1);
  assert.deepEqual(progress.importedWarnings, []);
});

test('official schooling priority: positive official value still obeys law and recognition guards', () => {
  for (const guard of ['law', 'recognition']) {
    const x = mediaFixture(); x.row.schoolingCreditsTotal = 1;
    if (guard === 'law') x.course.canonicalName = '情報学入門';
    else { x.profile.admissionType = 'transfer_third_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = 15; }
    const records = [mediaRecord(x)], result = mediaFacts(x, records);
    assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].schoolingCredits, null);
    assert.equal(result.facts[0].schoolingEvidence.credits, 1);
    assert.equal(result.facts[0].schoolingEvidence.source, 'official_row');
    assert.equal(result.facts[0].diagnostics.includes('media_schooling_credits_conflict'), false);
    assert.deepEqual(run(x, [], records).importedWarnings.map(n => n.kind), ['schooling_confirmation']);
  }
});

// H38 changes only known foreign ordinary recognition with unknown schooling.
function foreignRecognitionFixture(language = 'english', schooling = null) {
  const x = fixture();
  x.profile.admissionType = 'transfer_second_year';
  x.profile.recognizedCredits.foreignLanguage = {
    mode: 'recognized', credits: 4, language, schoolingEquivalentCredits: schooling,
  };
  return x;
}
const foreignRecognitionRun = (x, rows = [], selection = 'not_selected') =>
  calculateGraduationProgress([], x.f, x.scope, [], selection, [], rows, x.profile);
const foreignRecognitionCard = p => p.cards.find(c => c.requirementId === 'group-foreign');
const h38SchoolingReference = p => p.referenceProgress.find(r => r.id === 'schooling-reference-progress');

for (const language of ['english', 'german', 'french']) {
  for (const [schooling, status] of [[null, 'unknown'], [0, 'unsatisfied'], [1, 'unsatisfied'], [2, 'satisfied']]) {
    test(`H38 foreign recognition: ${language}4 / S${schooling} retains ordinary4 / ${status}`, () => {
      const x = foreignRecognitionFixture(language, schooling);
      assert.equal(graduationProfileValidationError(x.profile), null);
      const p = foreignRecognitionRun(x);
      const foreign = foreignRecognitionCard(p);
      assert.deepEqual([foreign.earned, foreign.status], [4, status]);
      if (schooling === null) assert.match(foreign.reason, /スクーリング相当認定単位が未確認.*0単位とは扱いません/);
      if (schooling === 0 || schooling === 1) assert.match(foreign.reason, /2単位未満/);
      const reference = p.referenceProgress.find(r => r.id === 'overall-reference-progress');
      assert.deepEqual([reference.earned, reference.status, reference.target, reference.recognizedCredits], [4, 'partial', 128, 4]);
      // The global recognition breakdown is independently unknown; foreign4 never supplies S4/S2.
      assert.deepEqual([h38SchoolingReference(p).earned, h38SchoolingReference(p).status, h38SchoolingReference(p).target,
        h38SchoolingReference(p).recognizedCredits], [null, 'unknown', 30, null]);
      assert.equal(p.graduationCheckComplete, false);
    });
  }
}

for (const credits of [0, 2, 4]) {
  for (const total of [null, 4]) {
    test(`H38 coexistence: official foreign${credits} plus recognized4 / aggregate${total} stays capped at4`, () => {
      const x = foreignRecognitionFixture();
      x.mapping.scopeId = x.common; x.mapping.category = '外国語'; x.mapping.field = '英語';
      x.course.scopeIds = [x.common];
      x.row.earnedCreditsTotal = credits; x.row.schoolingCreditsTotal = 0;
      x.profile.recognizedCredits.totalCredits = total;
      assert.equal(graduationProfileValidationError(x.profile), null);
      const baseline = structuredClone(x);
      baseline.profile.recognizedCredits.foreignLanguage = {
        mode: 'none', credits: null, language: 'unknown', schoolingEquivalentCredits: null,
      };
      baseline.profile.recognizedCredits.totalCredits = null;
      assert.equal(foreignRecognitionCard(foreignRecognitionRun(baseline, [baseline.row])).earned, credits);
      const snapshot = structuredClone(x);
      const p = foreignRecognitionRun(x, [x.row]);
      assert.deepEqual([foreignRecognitionCard(p).earned, foreignRecognitionCard(p).status], [4, 'unknown']);
      assert.equal(overall(p), 4, 'recognition total/detail and official foreign credits are not summed again');
      assert.equal(h38SchoolingReference(p).earned, null);
      assert.equal(h38SchoolingReference(p).status, 'unknown');
      assert.deepEqual(p.importedWarnings, foreignRecognitionRun(baseline, [baseline.row]).importedWarnings,
        'official schooling warnings are unchanged');
      assert.deepEqual(x, snapshot);
    });
  }
}

for (const schooling of [null, 0, 2]) {
  test(`H39 unchanged: unknown recognized language / S${schooling} remains held`, () => {
    const x = foreignRecognitionFixture('unknown', schooling);
    const foreign = foreignRecognitionCard(foreignRecognitionRun(x));
    assert.deepEqual([foreign.earned, foreign.status], [null, 'unknown']);
    assert.match(foreign.reason, /同一言語要件未確認/);
  });
}

for (const [mode, earned, status] of [['exempt', 0, 'satisfied'], ['unknown', null, 'unknown']]) {
  test(`H38 boundary: foreign mode=${mode} retains its existing behavior`, () => {
    const x = foreignRecognitionFixture();
    x.profile.recognizedCredits.totalCredits = 0;
    x.profile.recognizedCredits.foreignLanguage = {
      mode, credits: null, language: 'unknown', schoolingEquivalentCredits: null,
    };
    assert.equal(graduationProfileValidationError(x.profile), null);
    const p = foreignRecognitionRun(x);
    assert.deepEqual([foreignRecognitionCard(p).earned, foreignRecognitionCard(p).status], [earned, status]);
    assert.equal(overall(p), 0);
    assert.equal(h38SchoolingReference(p).earned, null);
  });
}

test('H38 boundary: invalid foreign schooling recognition remains rejected by validation', () => {
  for (const schooling of [-1, NaN, Infinity, -Infinity, 3]) {
    const x = foreignRecognitionFixture('english', schooling);
    assert.match(graduationProfileValidationError(x.profile), /外国語のスクーリング相当/);
    const p = foreignRecognitionRun(x);
    assert.equal(p.referenceProgress[0].earned, null);
    assert.equal(p.referenceProgress[0].status, 'unknown');
    assert.equal(h38SchoolingReference(p).earned, null);
    assert.equal(h38SchoolingReference(p).status, 'unknown');
  }
});

test('H38 retains ordinary4 with H36 target hold and H37 general recognition unresolved', () => {
  const x = foreignRecognitionFixture();
  const p = foreignRecognitionRun(x, [], 'undecided');
  assert.deepEqual([foreignRecognitionCard(p).earned, foreignRecognitionCard(p).status], [4, 'unknown']);
  assert.deepEqual([p.referenceProgress[0].earned, p.referenceProgress[0].target, p.referenceProgress[0].status], [4, null, 'unknown']);
  assert.match(p.referenceProgress[0].reason, /卒業論文の選択が未定/);
  assert.deepEqual([h38SchoolingReference(p).earned, h38SchoolingReference(p).target, h38SchoolingReference(p).status], [null, 30, 'unknown']);
  assert.match(h38SchoolingReference(p).reason, /認定スクーリング相当単位が未入力/);
  const general = p.cards.find(c => c.requirementId === 'group-general');
  assert.deepEqual([general.earned, general.status], [null, 'unknown']);
  assert.match(general.reason, /一般教育の認定情報が未確認/);
});

test('H38 calculation keeps frozen profile, official source, catalog and earlier cards immutable', () => {
  const x = structuredClone(foreignRecognitionFixture());
  x.mapping.scopeId = x.common; x.mapping.category = '外国語'; x.mapping.field = '英語';
  x.course.scopeIds = [x.common];
  const rows = [x.row];
  const previous = foreignRecognitionRun(x, rows);
  const inputSnapshot = structuredClone({ x, rows });
  const cardSnapshot = structuredClone(previous);
  deepFreeze(x); deepFreeze(rows); deepFreeze(previous);
  const p = foreignRecognitionRun(x, rows);
  assert.deepEqual({ x, rows }, inputSnapshot);
  assert.deepEqual(previous, cardSnapshot);
  assert.deepEqual([foreignRecognitionCard(p).earned, foreignRecognitionCard(p).status], [4, 'unknown']);
  assert.equal(p.graduationCheckComplete, false);
  assert.equal(catalog.metadata.sourceLinksReverified, false);
  assert.equal(initialState().schemaVersion, 22);
});

test('H38 UI displays ordinary4 alongside held foreign completion', () => {
  const p = foreignRecognitionRun(foreignRecognitionFixture());
  const html = renderToStaticMarkup(createElement(GraduationProgressUI, { progress: p }));
  const foreign = html.match(/<article[^>]*><h3[^>]*>外国語<\/h3>[\s\S]*?<\/article>/)?.[0];
  assert.ok(foreign, 'the existing foreign card renders');
  assert.match(foreign, />4<\/span> \/ 4単位/);
  assert.match(foreign, /判定保留/);
  assert.match(foreign, /スクーリング相当認定単位が未確認/);
  assert.doesNotMatch(foreign, />達成</);
});

function h60Fixture() {
  const x = fixture('史学科');
  x.f = structuredClone(catalog);
  x.course = x.f.curriculum.courses.find(c => c.canonicalName === '史学概論');
  x.mapping = x.f.mappings.find(m => x.course.mappingIds.includes(m.mappingId) && m.scopeId === x.scope);
  Object.assign(x.row, { rawName: x.course.canonicalName, curriculumCourseId: x.course.id,
    candidateCurriculumCourseIds: [x.course.id], compositionCredits: 4, earnedCreditsTotal: 4,
    schoolingCreditsTotal: 0, courseId: null });
  return x;
}
const h60Required = p => p.cards.find(c => c.requirementId === 'professional-history-required');
const h60Held = x => {
  const result = facts(x);
  assert.equal(result.allocations.length, 0);
  assert.equal(result.facts[0].allocation.reason, 'special_rule_evidence_required');
  return result;
};

test('H60 real 2026 catalog exact history introduction C4/O4/S0 allocates ordinary4', () => {
  const x = h60Fixture();
  assert.equal(x.course.id, 'curriculum:0203762e-4a77-4eca-b1e0-e361cb4b780a');
  assert.equal(x.course.curriculumCredits, 4);
  assert.equal(x.mapping.requirementType, '必修');
  assert.equal(x.mapping.field, null);
  assert.equal(x.mapping.schoolingOnly, false);
  assert.equal(x.mapping.mediaOnly, false);
  assert.equal(exactImportedCurriculumId(x.row, x.f), x.course.id);
  const result = facts(x);
  assert.deepEqual(result.facts[0].allocation, { kind: 'unique', mappingIds: [x.mapping.mappingId] });
  assert.equal(result.allocations[0].credits, 4);
  assert.equal(result.allocations[0].completedCredits, 4);
  assert.equal(result.allocations[0].schoolingCredits, 0);
  assert.equal(result.allocations[0].mapping.scopeId, x.scope);
  assert.ok(!result.facts[0].diagnostics.includes('special_rule_evidence_required'));
  const p = run(x);
  assert.equal(h60Required(p).earned, 4);
  assert.equal(h60Required(p).status, 'unsatisfied', '4 does not satisfy the required16 bucket');
  assert.equal(p.cards.find(c => c.requirementId === 'professional-history-elective').earned, 0);
  assert.equal(overall(p), 4);
  assert.equal(p.referenceProgress.find(r => r.id === 'schooling-reference-progress').earned, 0);
  assert.equal(p.importedContributionCount, 1);
  assert.equal(p.importedWarnings.length, 0);
  assert.equal(p.graduationCheckComplete, false);
});

for (const [label, change] of [
  ['partial O2', x => { x.row.earnedCreditsTotal = 2; }],
  ['O greater than C', x => { x.row.earnedCreditsTotal = 6; }],
  ['O0', x => { x.row.earnedCreditsTotal = 0; }],
  ['recognition positive', x => { x.row.recognizedExemption = 1; }],
  ['additional enrollment positive', x => { x.row.additionalEnrollment = 1; }],
  ['legacy curriculum', x => { x.profile.curriculumApplicability = 'legacy_or_transition'; }],
  ['unknown curriculum', x => { x.profile.curriculumApplicability = 'unknown'; }],
  ['future catalog source', x => { x.f.curriculum.source = 'official_curriculum_mappings_2027'; }],
  ['decorated canonical name', x => { x.course.canonicalName = '史学概論（旧課程）'; }],
  ['prefix name', x => { x.course.canonicalName = '史学概論2'; }],
  ['public mapping', x => { x.mapping.requirementType = '公開科目'; }],
  ['elective mapping', x => { x.mapping.requirementType = '選択'; }],
  ['schooling-only mapping', x => { x.mapping.schoolingOnly = true; }],
  ['media-only mapping', x => { x.mapping.mediaOnly = true; }],
  ['unknown official composition', x => { x.row.compositionCredits = null; }],
  ['recognized professional overlap', x => { x.profile.recognizedCredits.professionalCourses = [{ id: 'recognized', offeringId: 'unrelated', credits: 4 }]; }],
]) {
  test(`H60 excludes ${label} from the safe exception`, () => { const x = h60Fixture(); change(x); h60Held(x); });
}

for (const schooling of [null, 1, 2, 4, -1, NaN, Infinity, -Infinity]) {
  test(`H60 keeps schooling ${schooling} held without inferring zero or positive credits`, () => {
    const x = h60Fixture(); x.row.schoolingCreditsTotal = schooling;
    const result = h60Held(x);
    assert.equal(result.facts[0].schoolingEvidence.credits, schooling);
    assert.equal(run(x).importedContributionCount, 0);
  });
}

test('H60 requires current profile and accepts only zero/null recognition fields', () => {
  const x = h60Fixture();
  assert.equal(deriveOfficialGraduationFacts([x.row], [], x.f, x.scope).allocations.length, 0);
  for (const recognition of [0, null]) for (const additional of [0, null]) {
    x.row.recognizedExemption = recognition; x.row.additionalEnrollment = additional;
    assert.equal(facts(x).allocations[0].credits, 4);
  }
});

test('H60 duplicate different official ids stay unresolved without sum/max/dedupe', () => {
  const x = h60Fixture(); const rows = [x.row, { ...x.row, id: 'h60-second-row' }];
  const result = deriveOfficialGraduationFacts(rows, [], x.f, x.scope, x.profile);
  assert.equal(result.facts[0].allocation.reason, 'duplicate_official_rows');
  assert.equal(result.facts[0].earnedCreditsTotal, null);
  assert.equal(result.facts[0].schoolingEvidence.credits, null);
  assert.equal(result.facts[0].sourceRows.length, 2);
  assert.equal(result.allocations.length, 0);
  const p = calculateGraduationProgress([], x.f, x.scope, [], 'not_selected', [], rows, x.profile);
  assert.equal(p.importedContributionCount, 0);
  assert.ok(p.importedWarnings.some(w => w.reason.includes('duplicate_official_rows')));
});

test('H60 mapping conflict and unresolved institutional identity still precede the exception', () => {
  const x = h60Fixture(); const other = { ...x.mapping, mappingId: 'h60-conflict', requirementType: '選択' };
  x.f.mappings.push(other); x.course.mappingIds.push(other.mappingId);
  assert.equal(facts(x).facts[0].allocation.reason, 'mapping_conflict');
  assert.equal(facts(x).allocations.length, 0);
  x.row.curriculumMatch = 'ambiguous';
  assert.equal(facts(x).facts[0].allocation.reason, 'curriculum_identity_unresolved');
  assert.equal(facts(x).allocations.length, 0);
});

for (const name of ['史学演習1', '歴史資料学2', '日本史概説', '東洋史概説', '西洋史概説', '考古学']) {
  test(`H60 does not release neighboring history family ${name}`, () => {
    const x = fixture('史学科'); x.course.canonicalName = name; x.row.schoolingCreditsTotal = 0;
    h60Held(x);
  });
}

test('H60 Offering removal/order/metadata and Planner earned cannot change or double official4', () => {
  const x = h60Fixture();
  const offering = { ...x.offering, id: 'h60-presentation', name: '史学概論', curriculumCourseId: x.course.id,
    mappingIds: [x.mapping.mappingId], credits: 4 };
  x.f.offerings.push(offering);
  assert.equal(h60Required(run(x, [item(offering, 'earned')])).earned, 4);
  assert.equal(overall(run(x, [item(offering, 'earned')])), 4);
  x.f.offerings.reverse(); offering.credits = 99; offering.method = 'schooling'; offering.mappingIds = [];
  assert.equal(overall(run(x, [item(offering, 'earned')])), 4);
  assert.equal(facts(x).allocations[0].schoolingCredits, 0);
  x.f.offerings = [];
  assert.equal(overall(run(x)), 4);
  assert.equal(facts(x).allocations[0].credits, 4);
  x.course.mappingIds = [];
  assert.equal(facts(x).facts[0].allocation.reason, 'mapping_not_found', 'Course.mappingIds remains authority');
});

test('H60 frozen source/profile/catalog/components retain aggregates and invariant flags', () => {
  const x = h60Fixture();
  const records = [{ id: 'h60-component', fingerprint: 'h60-component-source', source: 'hosei_import', sourceCourseId: x.row.id,
    method: 'correspondence', rawTerm: '通', credits: 40 }];
  const before = structuredClone({ x, records }); deepFreeze(x); deepFreeze(records);
  assert.equal(deriveOfficialGraduationFacts([x.row], records, x.f, x.scope, x.profile).allocations[0].credits, 4);
  assert.equal(overall(run(x, [], records)), 4);
  assert.deepEqual({ x, records }, before);
  assert.equal(catalog.metadata.graduationCheckComplete, false);
  assert.equal(catalog.metadata.sourceLinksReverified, false);
  assert.equal(initialState().schemaVersion, 22);
});

const h57CourseId = 'curriculum:5e8b0825-7ba9-4a53-847c-7e56283718e5';
const h57Programs = catalog.programs.filter(p => catalog.curriculum.courses.find(c => c.id === h57CourseId).scopeIds.includes(p.scopeId));
function h57Fixture(scope = h57Programs[0].scopeId, schooling = 1) {
  const x = fixture('日本文学科'); x.f = structuredClone(catalog); x.scope = scope;
  x.course = x.f.curriculum.courses.find(c => c.id === h57CourseId);
  x.mapping = x.f.mappings.find(m => x.course.mappingIds.includes(m.mappingId) && m.scopeId === scope);
  Object.assign(x.row, { rawName: '書道実技', curriculumCourseId: x.course.id, candidateCurriculumCourseIds: [x.course.id],
    compositionCredits: 2, earnedCreditsTotal: 2, schoolingCreditsTotal: schooling, courseId: null });
  return x;
}
const h57Elective = p => p.cards.find(c => c.requirementId === 'professional-elective');
const h57Held = x => {
  const result = facts(x);
  assert.equal(result.allocations.length, 0);
  assert.equal(result.facts[0].allocation.reason, 'special_rule_evidence_required');
  assert.equal(run(x).importedContributionCount, 0);
  assert.equal(run(x).importedWarnings.some(w => w.kind === 'allocation_held'), x.row.earnedCreditsTotal > 0,
    'zero earned keeps the existing non-actionable warning contract');
  return result;
};

for (const program of h57Programs) for (const schooling of [1, 2]) {
  test(`H57 real ${program.course} C2/O2/S${schooling} completes and allocates2 only in selected scope`, () => {
    const x = h57Fixture(program.scopeId, schooling);
    assert.equal(x.course.canonicalName, '書道実技'); assert.equal(x.course.curriculumCredits, 2);
    assert.equal(x.course.mappingIds.length, 3); assert.equal(h57Programs.length, 3);
    assert.equal(x.mapping.category, '専門教育'); assert.equal(x.mapping.requirementType, '選択');
    assert.equal(x.mapping.field, null); assert.equal(x.mapping.schoolingOnly, false); assert.equal(x.mapping.mediaOnly, false);
    assert.equal(exactImportedCurriculumId(x.row, x.f), x.course.id);
    const result = facts(x);
    assert.equal(result.allocations.length, 1);
    assert.deepEqual(result.facts[0].allocation, { kind: 'unique', mappingIds: [x.mapping.mappingId] });
    assert.equal(result.allocations[0].mapping.scopeId, program.scopeId);
    assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].completedCredits, 2);
    assert.equal(result.allocations[0].schoolingCredits, schooling);
    assert.ok(!result.facts[0].diagnostics.includes('special_rule_evidence_required'));
    const p = run(x);
    assert.equal(h57Elective(p).earned, 2); assert.equal(h57Elective(p).status, 'unsatisfied');
    assert.equal(p.cards.find(c => c.requirementId === 'professional-required').earned, 0);
    assert.equal(p.cards.find(c => c.requirementId === 'professional-required-elective').earned, 0);
    assert.equal(p.cards.find(c => c.requirementId === 'professional-japanese-total').earned, 2);
    assert.equal(overall(p), 2);
    assert.equal(p.referenceProgress.find(r => r.id === 'schooling-reference-progress').earned, schooling);
    assert.equal(p.importedContributionCount, 1); assert.equal(p.importedWarnings.length, 0);
    assert.equal(p.graduationCheckComplete, false);
  });
}

for (const schooling of [0, null, -1, NaN, Infinity, -Infinity, 3, 0.5]) {
  test(`H57 S${schooling} cannot prove completed2 or infer valid schooling`, () => {
    const x = h57Fixture(); x.row.schoolingCreditsTotal = schooling;
    assert.equal(h57Held(x).facts[0].schoolingEvidence.credits, schooling);
  });
}
for (const schooling of [0, 1, null]) {
  test(`H57 partial C2/O1/S${schooling} never becomes completed2`, () => {
    const x = h57Fixture(); x.row.earnedCreditsTotal = 1; x.row.schoolingCreditsTotal = schooling; h57Held(x);
  });
}
for (const [label, change] of [
  ['earned greater than composition', x => { x.row.earnedCreditsTotal = 3; }],
  ['earned zero', x => { x.row.earnedCreditsTotal = 0; }],
  ['unknown row composition', x => { x.row.compositionCredits = null; }],
  ['recognized exemption positive', x => { x.row.recognizedExemption = 1; }],
  ['additional enrollment positive', x => { x.row.additionalEnrollment = 1; }],
  ['legacy curriculum', x => { x.profile.curriculumApplicability = 'legacy_or_transition'; }],
  ['unknown curriculum', x => { x.profile.curriculumApplicability = 'unknown'; }],
  ['future catalog source', x => { x.f.curriculum.source = 'official_curriculum_mappings_2027'; }],
  ['decorated canonical identity', x => { x.course.canonicalName = '書道実技（旧課程）'; }],
  ['media-only constraint', x => { x.mapping.mediaOnly = true; }],
  ['schooling-only constraint', x => { x.mapping.schoolingOnly = true; }],
  ['public mapping', x => { x.mapping.requirementType = '公開科目'; }],
  ['nonprofessional mapping', x => { x.mapping.category = '一般教育'; }],
]) {
  test(`H57 excludes ${label} from the safe exception`, () => { const x = h57Fixture(); change(x); h57Held(x); });
}

test('H57 zero/null recognition fields are safe only with complete current official evidence', () => {
  const x = h57Fixture();
  for (const recognized of [0, null]) for (const additional of [0, null]) {
    x.row.recognizedExemption = recognized; x.row.additionalEnrollment = additional;
    assert.equal(facts(x).allocations[0].credits, 2);
  }
  assert.equal(deriveOfficialGraduationFacts([x.row], [], x.f, x.scope).allocations.length, 0);
});

test('H57 professional recognition overlap remains a separate later hold', () => {
  const x = h57Fixture();
  x.profile.recognizedCredits.professionalCourses = [{ id: 'recognized-unrelated', offeringId: 'unrelated', credits: 2 }];
  assert.ok(h57Held(x).facts[0].diagnostics.includes('recognized_overlap'));
});

test('H57 existing transfer schooling confirmation guard remains after the exception', () => {
  const x = h57Fixture(); x.profile.admissionType = 'transfer_second_year';
  for (const equivalent of [null, 7]) {
    x.profile.recognizedCredits.schoolingEquivalentCredits = equivalent;
    const result = facts(x);
    assert.equal(result.allocations[0].credits, 2);
    assert.equal(result.allocations[0].schoolingCredits, null);
    assert.ok(result.facts[0].diagnostics.includes('schooling_evidence_requires_confirmation'));
    assert.ok(run(x).importedWarnings.some(w => w.kind === 'schooling_confirmation'));
  }
});

test('H57 duplicate different row ids retain unresolved aggregates without sum/max/dedupe', () => {
  const x = h57Fixture(); const rows = [x.row, { ...x.row, id: 'h57-other-row', schoolingCreditsTotal: 2 }];
  const result = deriveOfficialGraduationFacts(rows, [], x.f, x.scope, x.profile);
  assert.equal(result.facts[0].allocation.reason, 'duplicate_official_rows');
  assert.equal(result.facts[0].earnedCreditsTotal, null); assert.equal(result.facts[0].schoolingEvidence.credits, null);
  assert.equal(result.facts[0].sourceRows.length, 2); assert.equal(result.allocations.length, 0);
});

test('H57 conflicting mapping signatures hold before the exception', () => {
  const x = h57Fixture(); const conflicting = { ...x.mapping, mappingId: 'h57-conflict', requirementType: '選択必修' };
  x.f.mappings.push(conflicting); x.course.mappingIds.push(conflicting.mappingId);
  assert.equal(facts(x).facts[0].allocation.reason, 'mapping_conflict'); assert.equal(facts(x).allocations.length, 0);
});

test('H57 equivalent eligible mappings count one institutional completion after signature proof', () => {
  const x = h57Fixture(); const equivalent = { ...x.mapping, mappingId: 'h57-equivalent' };
  x.f.mappings.push(equivalent); x.course.mappingIds.push(equivalent.mappingId);
  assert.equal(facts(x).facts[0].allocation.kind, 'equivalent'); assert.equal(facts(x).allocations.length, 1);
  assert.equal(overall(run(x)), 2); assert.equal(h57Elective(run(x)).earned, 2);
});

test('H57 unresolved institutional identity is never repaired by its canonical name', () => {
  const x = h57Fixture(); x.row.curriculumCourseId = null; x.row.curriculumMatch = 'ambiguous';
  assert.equal(facts(x).facts[0].allocation.reason, 'curriculum_identity_unresolved');
  assert.equal(facts(x).allocations.length, 0);
});
for (const name of ['書道実技2', '書道実技（旧課程）']) {
  test(`H57 import ${name} does not fuzzy-resolve to exact current calligraphy`, () => {
    const x = h57Fixture();
    const match = matchImportedCurriculumCourse({ rawName: name, categoryRaw: '専門教育', compositionCredits: { raw: '2', value: 2 } },
      [], x.f.curriculum, x.f.mappings);
    assert.equal(match.curriculumMatch, 'unmatched');
    Object.assign(x.row, match, { rawName: name });
    assert.equal(facts(x).facts[0].allocation.reason, 'curriculum_identity_unresolved');
    assert.equal(facts(x).allocations.length, 0);
  });
}

for (const name of ['基礎特講', '卒業論文', '公開科目', '総合特講']) {
  test(`H57 does not release neighboring special ${name} even with C2/O2/S1`, () => {
    const x = h57Fixture(); x.course.canonicalName = name; h57Held(x);
  });
}

test('H57 selected scope outside all Course.mappingIds is out of scope, not inferred', () => {
  const x = h57Fixture(); x.scope = catalog.programs.find(p => p.department === '史学科').scopeId;
  assert.equal(facts(x).facts[0].allocation.reason, 'out_of_scope'); assert.equal(facts(x).allocations.length, 0);
});

for (const program of h57Programs) {
  test(`H57 ${program.course} official budget2 survives Planner overlap and Offering metadata/removal/order`, () => {
    const x = h57Fixture(program.scopeId);
    const offering = { ...x.offering, id: 'h57-presentation', name: '書道実技', curriculumCourseId: x.course.id,
      mappingIds: [x.mapping.mappingId], credits: 2 };
    x.f.offerings.push(offering);
    assert.equal(overall(run(x, [item(offering, 'earned')])), 2);
    assert.equal(h57Elective(run(x, [item(offering, 'earned')])).earned, 2);
    x.f.offerings.reverse(); offering.credits = 99; offering.method = 'schooling'; offering.mappingIds = [];
    assert.equal(overall(run(x, [item(offering, 'earned')])), 2);
    assert.equal(facts(x).allocations[0].schoolingCredits, 1);
    x.f.offerings = [];
    assert.equal(overall(run(x)), 2);
    x.course.mappingIds = [];
    assert.equal(facts(x).facts[0].allocation.reason, 'mapping_not_found'); assert.equal(facts(x).allocations.length, 0);
  });
}

test('H57 existing completedCurriculumCredits S0=0 and S1/S2=2 stays intact in Planner path', () => {
  const x = h57Fixture();
  const correspondence = { ...x.offering, id: 'h57-correspondence', name: '書道実技', curriculumCourseId: x.course.id,
    mappingIds: [x.mapping.mappingId], credits: 2, method: 'correspondence' };
  const schooling = { ...correspondence, id: 'h57-schooling', method: 'schooling', credits: 1 };
  const another = { ...schooling, id: 'h57-schooling-2' };
  x.f.offerings = [correspondence, schooling, another];
  const manual = items => calculateGraduationProgress(items, x.f, x.scope, [], 'not_selected', [], [], x.profile);
  assert.equal(h57Elective(manual([item(correspondence, 'earned')])).earned, 0);
  correspondence.credits = 1;
  assert.equal(h57Elective(manual([item(correspondence, 'earned'), item(schooling, 'earned')])).earned, 2);
  assert.equal(h57Elective(manual([item(schooling, 'earned'), item(another, 'earned')])).earned, 2);
});

test('H57 removes only its allocation warning while another unresolved official row stays visible', () => {
  const x = h57Fixture(); const other = { ...x.row, id: 'h57-unresolved', curriculumCourseId: null,
    curriculumMatch: 'unmatched', candidateCurriculumCourseIds: [] };
  const p = calculateGraduationProgress([], x.f, x.scope, [], 'not_selected', [], [x.row, other], x.profile);
  assert.equal(p.importedContributionCount, 1);
  assert.ok(p.importedWarnings.some(w => w.reason.includes('curriculum_identity_unresolved')));
  assert.ok(!p.importedWarnings.some(w => w.reason.includes('special_rule_evidence_required')));
  assert.equal(p.graduationCheckComplete, false);
});

test('H57 frozen inputs and large components cannot mutate or add to official2/S1', () => {
  const x = h57Fixture();
  const records = [{ id: 'h57-component', fingerprint: 'h57-component-source', source: 'hosei_import', sourceCourseId: x.row.id,
    rawName: '書道実技', method: 'correspondence', rawTerm: '通', credits: 40 }];
  const before = structuredClone({ x, records }); deepFreeze(x); deepFreeze(records);
  const result = deriveOfficialGraduationFacts([x.row], records, x.f, x.scope, x.profile);
  assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].completedCredits, 2);
  assert.equal(result.allocations[0].schoolingCredits, 1); assert.equal(overall(run(x, [], records)), 2);
  assert.deepEqual({ x, records }, before);
  assert.equal(catalog.metadata.graduationCheckComplete, false); assert.equal(catalog.metadata.sourceLinksReverified, false);
  assert.equal(initialState().schemaVersion, 22);
});

function h12Fixture(fullCount = 8, type = '選択必修') {
  const x = fixture(); x.f = structuredClone(catalog);
  const pairs = x.f.curriculum.courses.flatMap(course => course.mappingIds.flatMap(id => {
    const mapping = x.f.mappings.find(m => m.mappingId === id);
    return mapping?.scopeId === x.scope && mapping.category === '専門教育' && mapping.curriculumCredits === 4
      && !mapping.schoolingOnly && !mapping.mediaOnly && !/特講|演習|政治学|卒業論文|公開/.test(course.canonicalName)
      ? [{ course, mapping }] : [];
  }));
  const full = pairs.filter(p => p.mapping.requirementType === '選択必修').slice(0, fullCount);
  const partial = pairs.find(p => p.mapping.requirementType === type && !full.includes(p));
  assert.equal(full.length, fullCount); assert.ok(partial);
  const rowFor = (p, id, earned, schooling) => ({ ...x.row, id, rawName: p.course.canonicalName,
    curriculumCourseId: p.course.id, candidateCurriculumCourseIds: [p.course.id], compositionCredits: 4,
    earnedCreditsTotal: earned, schoolingCreditsTotal: schooling, courseId: null });
  x.full = full; x.fullRows = full.map((p, i) => rowFor(p, `h12-full-${i}`, 4, 0));
  x.course = partial.course; x.mapping = partial.mapping; x.row = rowFor(partial, 'h12-partial', 2, 2);
  return x;
}
const h12Rows = x => [...x.fullRows, x.row];
const h12Facts = (x, records = []) => deriveOfficialGraduationFacts(h12Rows(x), records, x.f, x.scope, x.profile);
const h12Progress = (x, selection = 'not_selected', items = [], records = []) =>
  calculateGraduationProgress(items, x.f, x.scope, [], selection, records, h12Rows(x), x.profile);
const h12Card = (p, suffix) => p.cards.find(c => c.requirementId === `professional-law-${suffix}`);
const h12Allocation = result => result.allocations.find(a => a.fact.sourceRowIds.includes('h12-partial'));
const h12Fact = result => result.facts.find(f => f.sourceRowIds.includes('h12-partial'));
const h12Count = p => h12Card(p, 'required-elective').details.find(d => d.unit === 'courses').earned;
const h12OrdinaryRequirements = (x, p, total, elective) => {
  for (const row of p.requirements) {
    const rule = x.f.requirements.find(r => r.id === row.requirementId);
    if (row.status === 'unknown') continue;
    if (/^law_total_/.test(rule.ruleId)) assert.equal(row.earned, total, rule.ruleId);
    if (/^law_elective_/.test(rule.ruleId)) assert.equal(row.earned, elective, rule.ruleId);
  }
};

for (const type of ['選択必修', '選択']) for (const n of [0, 7, 8, 9]) {
  test(`H12 ${n} distinct real full Courses plus ${type} C4/O2/S2 counts partial only after 8/32`, () => {
    const x = h12Fixture(n, type); const result = h12Facts(x); const a = h12Allocation(result);
    assert.equal(a.credits, 2); assert.equal(a.completedCredits, 0); assert.equal(a.schoolingCredits, 2);
    assert.equal(result.allocations.filter(a => a.completedCredits > 0).length, n);
    const p = h12Progress(x); const permitted = n >= 8 ? 2 : 0;
    const elective = Math.max(0, n * 4 - 32) + permitted;
    assert.equal(h12Count(p), n);
    assert.equal(h12Card(p, 'required-elective').earned, Math.min(32, n * 4));
    assert.equal(h12Card(p, 'elective').earned, elective);
    assert.match(h12Card(p, 'elective').note, new RegExp(`部分修得 ${permitted}単位`));
    assert.equal(h12Card(p, 'total').earned, n * 4 + permitted);
    assert.equal(overall(p), n * 4 + permitted);
    assert.equal(h12Card(p, 'schooling').earned, 2);
    assert.equal(p.referenceProgress.find(r => r.id === 'schooling-reference-progress').earned, 2);
    assert.equal(p.importedWarnings.length, 0);
    h12OrdinaryRequirements(x, p, n * 4 + permitted, elective);
    assert.equal(p.graduationCheckComplete, false);
  });
}

for (const [label, n, credits] of [['seven Courses / 32 credits', 7, [8,4,4,4,4,4,4]], ['eight Courses / 28 credits', 8, [2,2,4,4,4,4,4,4]]]) {
  test(`H12 AND threshold rejects ${label}`, () => {
    const x = h12Fixture(n);
    x.full.forEach((pair, i) => {
      pair.course.curriculumCredits = credits[i];
      // Other departments' edges do not affect the selected law Mapping.
      pair.mapping.curriculumCredits = credits[i];
      x.fullRows[i].compositionCredits = credits[i]; x.fullRows[i].earnedCreditsTotal = credits[i];
    });
    const p = h12Progress(x); const fullCredits = credits.reduce((a,b) => a+b,0);
    assert.equal(h12Count(p), n); assert.equal(h12Card(p, 'elective').earned, 0);
    assert.equal(h12Card(p, 'total').earned, fullCredits); assert.equal(overall(p), fullCredits);
    assert.match(h12Card(p, 'elective').note, /部分修得 0単位/);
    h12OrdinaryRequirements(x,p,fullCredits,0);
  });
}

for (const s of [0, 1, null, 3, -1, NaN, Infinity, -Infinity]) {
  test(`H12 S${s} cannot authorize ordinary partial credits`, () => {
    const x=h12Fixture(); x.row.schoolingCreditsTotal=s;
    assert.equal(h12Fact(h12Facts(x)).allocation.reason,'special_rule_evidence_required');
    assert.equal(h12Allocation(h12Facts(x)),undefined);
    assert.equal(h12Card(h12Progress(x),'elective').earned,0);
  });
}
for (const [o, expectedCompletion, held] of [[0,0,false],[1,0,true],[3,0,true],[4,4,false],[5,0,true]]) {
  test(`H12 O${o} preserves zero/full/invalid contracts without the partial exception`, () => {
    const x=h12Fixture(0); x.row.earnedCreditsTotal=o; const result=h12Facts(x);
    if (held) assert.equal(h12Allocation(result),undefined);
    else {
      assert.equal(h12Allocation(result).credits,o);
      assert.equal(h12Allocation(result).completedCredits,expectedCompletion);
      assert.equal(h12Count(h12Progress(x)),o===4?1:0);
    }
    assert.match(h12Card(h12Progress(x),'elective').note,/部分修得 0単位/);
  });
}

for (const [label, change, reason] of [
  ['required type',x=>{x.mapping.requirementType='必修';},'special_rule_evidence_required'],
  ['public type',x=>{x.mapping.requirementType='公開科目';},'special_rule_evidence_required'],
  ['unsupported type',x=>{x.mapping.requirementType='スクーリング選択必修';},'special_rule_evidence_required'],
  ['Course composition',x=>{x.course.curriculumCredits=2;},'metadata_unknown'],
  ['Mapping composition',x=>{x.mapping.curriculumCredits=2;},'metadata_unknown'],
  ['row composition',x=>{x.row.compositionCredits=2;},'metadata_unknown'],
  ['null composition',x=>{x.row.compositionCredits=null;},'special_rule_evidence_required'],
  ['recognized exemption',x=>{x.row.recognizedExemption=2;},'special_rule_evidence_required'],
  ['additional enrollment',x=>{x.row.additionalEnrollment=2;},'special_rule_evidence_required'],
  ['legacy',x=>{x.profile.curriculumApplicability='legacy_or_transition';},'special_rule_evidence_required'],
  ['unknown curriculum',x=>{x.profile.curriculumApplicability='unknown';},'special_rule_evidence_required'],
  ['future catalog',x=>{x.f.curriculum.source='official_curriculum_mappings_2027';},'special_rule_evidence_required'],
  ['media-only',x=>{x.mapping.mediaOnly=true;},'special_rule_evidence_required'],
  ['schooling-only',x=>{x.mapping.schoolingOnly=true;},'special_rule_evidence_required'],
  ['unresolved identity',x=>{x.row.curriculumCourseId=null;x.row.curriculumMatch='ambiguous';},'curriculum_identity_unresolved'],
  ['missing Mapping',x=>{x.course.mappingIds=[];},'mapping_not_found'],
  ['out of scope',x=>{x.scope=x.f.programs.find(p=>p.department==='史学科').scopeId;},'out_of_scope'],
]) {
  test(`H12 ${label} retains its guard`,()=>{
    const x=h12Fixture(0);change(x); const r=h12Facts(x);
    assert.equal(h12Fact(r).allocation.reason,reason); assert.equal(r.allocations.length,0);
  });
}
test('H12 profile is required and zero/null recognition fields do not fabricate completion',()=>{
  const x=h12Fixture(0);
  assert.equal(deriveOfficialGraduationFacts(h12Rows(x),[],x.f,x.scope).allocations.length,0);
  for(const recognized of [0,null]) for(const additional of [0,null]) {
    x.row.recognizedExemption=recognized;x.row.additionalEnrollment=additional;
    assert.equal(h12Allocation(h12Facts(x)).completedCredits,0);
  }
});
test('H12 professional recognition and H20 schooling guards still apply after entry',()=>{
  const x=h12Fixture(0);
  x.profile.recognizedCredits.professionalCourses=[{id:'recognition',offeringId:'other',credits:4}];
  assert.ok(h12Fact(h12Facts(x)).diagnostics.includes('recognized_overlap'));
  assert.equal(h12Facts(x).allocations.length,0);
  x.profile.recognizedCredits.professionalCourses=[];x.profile.admissionType='transfer_second_year';
  x.profile.recognizedCredits.schoolingEquivalentCredits=null;
  assert.equal(h12Allocation(h12Facts(x)).schoolingCredits,null);
  assert.match(h12Card(h12Progress(x),'elective').note,/部分修得 0単位/);
});
test('H12 different eligible Mapping signatures remain conflicting',()=>{
  const x=h12Fixture(0); const other={...x.mapping,mappingId:'h12-conflict',requirementType:'選択'};
  x.f.mappings.push(other);x.course.mappingIds.push(other.mappingId);
  assert.equal(h12Fact(h12Facts(x)).allocation.reason,'mapping_conflict');assert.equal(h12Facts(x).allocations.length,0);
});
for (const kind of ['partial duplicate','full duplicate','full/partial same Course']) {
  test(`H12 ${kind} cannot inflate distinct completions or permit extra2`,()=>{
    const x=h12Fixture();
    if(kind==='partial duplicate') x.fullRows.push({...x.row,id:'h12-copy'});
    else if(kind==='full duplicate') x.fullRows.push({...x.fullRows[0],id:'h12-copy'});
    else {x.row.curriculumCourseId=x.fullRows[0].curriculumCourseId;x.row.candidateCurriculumCourseIds=x.fullRows[0].candidateCurriculumCourseIds.slice();}
    const r=h12Facts(x); const duplicate=r.facts.find(f=>f.allocation.reason==='duplicate_official_rows');
    assert.ok(duplicate);assert.equal(duplicate.earnedCreditsTotal,null);assert.equal(duplicate.sourceRows.length,2);
    const p=h12Progress(x);assert.equal(h12Count(p),kind==='partial duplicate'?8:7);
    assert.equal(h12Card(p,'elective').earned,0);assert.match(h12Card(p,'elective').note,/部分修得 0単位/);
  });
}
for (const name of ['卒業論文','公開科目','法律学演習','法律学特講','政治学','総合特講','基礎特講']) {
  test(`H12 does not bypass special family ${name}`,()=>{
    const x=h12Fixture(0);x.course.canonicalName=name;
    assert.equal(h12Fact(h12Facts(x)).allocation.reason,'special_rule_evidence_required');
  });
}
for (const department of ['日本文学科','史学科','地理学科']) {
  test(`H12 does not release ${department} partials`,()=>{
    const x=fixture(department);x.row.earnedCreditsTotal=2;
    assert.equal(facts(x).facts[0].allocation.reason,'special_rule_evidence_required');
  });
}
test('H12 H19 excluded canonical name still nulls S and cannot feed permittedPartial',()=>{
  const x=h12Fixture();x.course.canonicalName='情報学入門';
  const a=h12Allocation(h12Facts(x));assert.equal(a.credits,2);assert.equal(a.completedCredits,0);assert.equal(a.schoolingCredits,null);
  assert.ok(a.fact.diagnostics.includes('schooling_evidence_requires_confirmation'));
  const p=h12Progress(x);assert.equal(h12Card(p,'elective').earned,0);assert.equal(h12Card(p,'total').earned,32);
  assert.equal(h12Card(p,'schooling').earned,0);assert.equal(h12Card(p,'schooling').status,'unknown');
  assert.equal(p.referenceProgress.find(r=>r.id==='schooling-reference-progress').earned,null);
});
for (const selection of ['selected','not_selected','undecided']) {
  test(`H12 thesis ${selection} leaves partial qualification independent with H36 quantity retention`,()=>{
    const x=h12Fixture();const p=h12Progress(x,selection);
    assert.equal(h12Card(p,'required-elective').earned,32);assert.equal(h12Count(p),8);
    assert.equal(h12Card(p,'elective').earned,2);assert.equal(h12Card(p,'total').earned,34);
    assert.equal(overall(p),34);
    assert.equal(p.referenceProgress[0].target,selection==='undecided'?null:selection==='selected'?124:128);
    assert.equal(p.referenceProgress[0].status,selection==='undecided'?'unknown':'partial');
    assert.deepEqual(h36ReferenceValues(p, 'schooling'), [2,30,'partial','partial',null]);
    assert.equal(h12Card(p,'total').target,selection==='undecided'?null:selection==='selected'?82:86);
    h12OrdinaryRequirements(x,p,34,2);
    if(selection==='undecided') assert.equal(h12Card(p,'total').status,'unknown');
  });
}
for (const count of [7,8]) {
  test(`H12 ${count} completions plus Planner duplicates cannot fake or double the threshold`,()=>{
    const x=h12Fixture(count);
    const offerings=h12Rows(x).map((row,i)=>({...x.offering,id:`h12-planner-${i}`,name:row.rawName,
      curriculumCourseId:row.curriculumCourseId,mappingIds:x.f.curriculum.courses.find(c=>c.id===row.curriculumCourseId).mappingIds,credits:4}));
    x.f.offerings.push(...offerings);const items=offerings.map(o=>item(o,'earned'));
    const assertBudget=()=>{const p=h12Progress(x,'not_selected',items);assert.equal(h12Count(p),count);assert.equal(overall(p),count*4+(count===8?2:0));};
    assertBudget(); x.f.offerings.reverse();offerings.forEach(o=>{o.credits=99;o.method='schooling';o.mappingIds=[];});assertBudget();
    x.f.offerings=[]; assert.equal(overall(h12Progress(x)),count*4+(count===8?2:0));
  });
}
test('H12 equivalent Mapping edges count one completed institutional Course, not two',()=>{
  const x=h12Fixture(7);const pair=x.full[0];const same={...pair.mapping,mappingId:'h12-equivalent'};
  x.f.mappings.push(same);pair.course.mappingIds.push(same.mappingId);
  assert.equal(h12Count(h12Progress(x)),7);assert.equal(h12Card(h12Progress(x),'elective').earned,0);
});
test('H12 frozen rows/records/catalog/profile preserve source2 and completed0 despite components40',()=>{
  const x=h12Fixture();const records=[{id:'h12-component',fingerprint:'h12-component',source:'hosei_import',sourceCourseId:x.row.id,
    rawName:x.row.rawName,method:'correspondence',rawTerm:'通',credits:40}];
  const before=structuredClone({x,records});deepFreeze(x);deepFreeze(records);
  const a=h12Allocation(h12Facts(x,records));assert.equal(a.credits,2);assert.equal(a.completedCredits,0);assert.equal(a.schoolingCredits,2);
  assert.equal(overall(h12Progress(x,'not_selected',[],records)),34);assert.deepEqual({x,records},before);
  assert.equal(catalog.metadata.graduationCheckComplete,false);assert.equal(catalog.metadata.sourceLinksReverified,false);
  assert.equal(initialState().schemaVersion,22);
});


// H36 changes only the law optional-thesis target prerequisite.
const h36Reason = '法学部の卒業論文の選択が未定のため、124/128単位を確定できません。';
const h36ReferenceValues = (p, axis) => {
  const r = p.referenceProgress.find(r => r.id === `${axis}-reference-progress`);
  return [r.earned, r.target, r.status, r.coverageStatus, r.reason];
};
const h36Progress = (x, { selection = 'undecided', items = [], rows = [x.row], records = [], thesis = null } = {}) =>
  calculateGraduationProgress(items, x.f, x.scope, [], selection, records, rows, x.profile, thesis);
const h36Assert = (p, ordinary, schooling) => {
  assert.deepEqual(h36ReferenceValues(p, 'overall'), [ordinary, null, 'unknown', 'unknown', h36Reason]);
  assert.deepEqual(h36ReferenceValues(p, 'schooling'), [schooling, 30, 'partial', 'partial', null]);
  assert.equal(p.graduationCheckComplete, false);
};
function h36PlannerFixture() {
  const x = fixture();
  x.offering.credits = 2;
  const schooling = { ...x.offering, id: 'h36-schooling', method: 'schooling' };
  x.f.offerings.push(schooling);
  x.f.curriculum.offeringRelations.push({ offeringId: schooling.id, curriculumCourseId: x.course.id, candidateCurriculumCourseIds: [x.course.id] });
  x.items = [item(x.offering, 'earned'), item(schooling, 'earned')];
  return x;
}

test('H36 official-only O4/S2 keeps known quantities with undecided target/evaluation', () => {
  const x = fixture(); const p = h36Progress(x);
  h36Assert(p, 4, 2);
  for (const id of ['professional-law-total', 'professional-law-elective']) {
    const c = p.cards.find(c => c.requirementId === id);
    assert.equal(c.status, 'unknown'); assert.equal(c.target, null);
  }
  const thesis = p.cards.find(c => c.ruleType === 'thesis_progress');
  assert.equal(thesis.status, 'unknown'); assert.equal(thesis.earned, 0);
  const dependent = p.requirements.filter(r => /卒論有無が未定/.test(r.reason ?? ''));
  assert.ok(dependent.length >= 4);
  for (const r of dependent) assert.equal(r.status, 'unknown');
});

test('H36 Planner-only completed correspondence2 + schooling2 retains O4/S2', () => {
  const x = h36PlannerFixture(); h36Assert(h36Progress(x, { items: x.items, rows: [] }), 4, 2);
});

test('H36 official priority suppresses same-Course Planner quantities once', () => {
  const x = h36PlannerFixture(); const official = h36Progress(x);
  const combined = h36Progress(x, { items: x.items });
  h36Assert(combined, 4, 2);
  assert.deepEqual(combined.referenceProgress, official.referenceProgress);
  assert.equal(combined.importedContributionCount, 1);
});

for (const source of ['empty', 'official']) test(`H36 ${source} known zero remains zero, not unknown quantity`, () => {
  const x = fixture(); x.row.earnedCreditsTotal = 0; x.row.schoolingCreditsTotal = 0;
  h36Assert(h36Progress(x, { rows: source === 'empty' ? [] : [x.row] }), 0, 0);
});

test('H36 multiple distinct official Courses retain sum O12/S6 without annual Offerings', () => {
  const x = h12Fixture(3);
  for (const row of x.fullRows) row.schoolingCreditsTotal = 2;
  x.f.offerings = []; x.f.curriculum.offeringRelations = [];
  h36Assert(h36Progress(x, { rows: x.fullRows }), 12, 6);
});

for (const [selection, target, professionalTarget] of [['selected', 124, 82], ['not_selected', 128, 86]]) {
  test(`H36 ${selection} retains existing reference and professional targets`, () => {
    const x = fixture(); const p = h36Progress(x, { selection });
    assert.deepEqual(h36ReferenceValues(p, 'overall'), [4, target, 'partial', 'partial', null]);
    assert.deepEqual(h36ReferenceValues(p, 'schooling'), [2, 30, 'partial', 'partial', null]);
    const c = p.cards.find(c => c.requirementId === 'professional-law-total');
    assert.equal(c.earned, 4); assert.equal(c.target, professionalTarget); assert.equal(c.status, 'unsatisfied');
    assert.equal(p.graduationCheckComplete, false);
  });
}

for (const status of ['not_started', 'planned', 'in_progress', 'earned']) {
  test(`H36 persisted undecided thesis normalizes ${status} without selecting thesis`, () => {
    const x = fixture();
    const state = setThesisProgressForScope(initialState(), x.f, x.scope, { selection: 'undecided', status });
    const thesis = thesisProgressForScope(state, x.f, x.scope);
    assert.deepEqual(thesis, { selection: 'undecided', status: 'not_started' });
    const p = h36Progress(x, { thesis }); h36Assert(p, 4, 2);
    assert.equal(p.cards.find(c => c.ruleType === 'thesis_progress').status, 'unknown');
  });
}

const h36Guards = [
  ['curriculum unknown', x => { x.profile.curriculumApplicability = 'unknown'; }, /適用課程が未確認/],
  ['legacy', x => { x.profile.curriculumApplicability = 'legacy_or_transition'; }, /旧課程・経過措置/],
  ['admission unknown', x => { x.profile.admissionType = 'unknown'; }, /入学区分が未入力/],
  ['transfer recognition missing', x => { x.profile.admissionType = 'transfer_second_year'; }, /編入学の認定単位/],
  ['invalid recognition', x => { x.profile.recognizedCredits.totalCredits = -1; }, /認定単位の入力/],
];
for (const [label, setup, reason] of h36Guards) test(`H36 preserves reference-wide ${label} guard`, () => {
  const x = fixture(); setup(x);
  const p = h36Progress(x); const baseline = h36Progress(x, { selection: 'not_selected' });
  assert.deepEqual(p.referenceProgress, baseline.referenceProgress);
  for (const axis of ['overall', 'schooling']) {
    const values = h36ReferenceValues(p, axis);
    assert.deepEqual(values.slice(0, 4), [null, null, 'unknown', 'unknown']);
    assert.match(values[4], reason);
  }
});

for (const admission of ['transfer_second_year', 'bachelor_admission']) {
  test(`H36 ${admission} missing global recognized S remains unknown`, () => {
    const x = fixture(); x.profile.admissionType = admission;
    if (admission === 'transfer_second_year') x.profile.recognizedCredits.totalCredits = 0;
    const p = h36Progress(x);
    assert.deepEqual(h36ReferenceValues(p, 'overall'), [4, null, 'unknown', 'unknown', h36Reason]);
    const s = h36ReferenceValues(p, 'schooling');
    assert.deepEqual(s.slice(0, 4), [null, 30, 'unknown', 'unknown']);
    assert.match(s[4], /認定スクーリング相当単位が未入力/);
    assert.equal(p.referenceProgress[0].exemptionCredits, null);
    assert.equal(p.graduationCheckComplete, false);
  });
}

test('H36 official S null retains existing schooling uncertainty', () => {
  const x = fixture(); x.row.schoolingCreditsTotal = null;
  const p = h36Progress(x);
  assert.equal(overall(p), 4); assert.equal(p.referenceProgress[0].target, null);
  assert.deepEqual(h36ReferenceValues(p, 'schooling').slice(0, 4), [null, 30, 'unknown', 'unknown']);
  assert.match(h36ReferenceValues(p, 'schooling')[4], /スクーリング証拠に未確認/);
});

test('H36 Planner schooling allocation ambiguity retains its independent unknown', () => {
  const x = h36PlannerFixture();
  const other = { ...x.mapping, mappingId: 'h36-other-map', requirementType: '選択' };
  x.f.mappings.push(other); x.course.mappingIds.push(other.mappingId);
  for (const o of x.f.offerings) o.mappingIds.push(other.mappingId);
  const p = h36Progress(x, { items: x.items, rows: [] });
  const s = h36ReferenceValues(p, 'schooling');
  assert.deepEqual(s.slice(1, 4), [30, 'unknown', 'unknown']);
  assert.match(s[4], /算入先を一意に確認できない/);
});

for (const program of catalog.programs.filter(p => !p.isCommon && p.department !== '法律学科')) {
  test(`H36 leaves ${program.department}/${program.course ?? program.scopeId} reference behavior independent of optional law thesis`, () => {
    const profile = fixture().profile;
    for (const selection of ['undecided', 'selected', 'not_selected']) {
      const p = calculateGraduationProgress([], catalog, program.scopeId, [], selection, [], [], profile);
      assert.deepEqual(h36ReferenceValues(p, 'overall'), [0, 124, 'partial', 'partial', null]);
      assert.deepEqual(h36ReferenceValues(p, 'schooling'), [0, 30, 'partial', 'partial', null]);
      assert.equal(p.graduationCheckComplete, false);
    }
  });
}

test('H36 frozen official aggregates own O4/S2 despite components40 and Planner duplicates', () => {
  const x = h36PlannerFixture();
  const records = [{ id: 'h36-component', fingerprint: 'h36-source', source: 'hosei_import', sourceCourseId: x.row.id,
    rawName: x.row.rawName, method: 'schooling', rawTerm: 'S', credits: 40 }];
  const before = structuredClone({ x, records }); deepFreeze(x); deepFreeze(records);
  h36Assert(h36Progress(x, { items: x.items, records }), 4, 2);
  assert.deepEqual({ x, records }, before);
  assert.equal(initialState().schemaVersion, 22);
  assert.equal(catalog.metadata.graduationCheckComplete, false);
  assert.equal(catalog.metadata.sourceLinksReverified, false);
});

test('H36 existing UI displays known earned with unknown overall target/status', () => {
  const p = h36Progress(fixture());
  const html = renderToStaticMarkup(createElement(GraduationProgressUI, { progress: p }));
  assert.match(html, /修得済み 4/); assert.match(html, /修得済み 2/);
  assert.match(html, /30単位/); assert.match(html, /124\/128単位を確定できません/);
  assert.match(html, /この数値だけで卒業可否は判定しません/);
});

test('H36 scope boundary: H31 manual-review earned Offering still propagates unknown', () => {
  const x = fixture(); x.offering.resolutionStatus = 'manual_review';
  const p = h36Progress(x, { selection: 'not_selected', items: [item(x.offering, 'earned')], rows: [] });
  for (const id of ['group-general', 'group-foreign', 'group-physical', 'professional-law-total']) {
    const c = p.cards.find(c => c.requirementId === id);
    assert.equal(c.status, 'unknown');
    assert.equal(c.earned, id === 'professional-law-total' ? null : 0);
    assert.match(c.reason, /対応関係を確認中/);
  }
  assert.equal(p.graduationCheckComplete, false);
});

test('H36 scope boundary: H41 held official fact still propagates unknown to unrelated cards', () => {
  const x = fixture();
  const held = { ...x.row, id: 'h36-held', curriculumCourseId: null, curriculumMatch: 'unmatched', candidateCurriculumCourseIds: [] };
  const p = h36Progress(x, { selection: 'not_selected', rows: [x.row, held] });
  for (const id of ['group-general', 'group-foreign', 'group-physical', 'professional-law-total']) {
    assert.equal(p.cards.find(c => c.requirementId === id).status, 'unknown');
  }
  assert.equal(overall(p), 4); assert.equal(p.referenceProgress[0].status, 'unknown');
  assert.match(p.referenceProgress[0].reason, /公式実績の算入を保留/);
});

test('H36 scope boundary: H43 unknown ordinary still holds independently known official S2 allocation', () => {
  const x = fixture(); x.row.earnedCreditsTotal = null;
  const facts = deriveOfficialGraduationFacts([x.row], [], x.f, x.scope, x.profile);
  assert.equal(facts.facts[0].schoolingEvidence.credits, 2); assert.equal(facts.allocations.length, 0);
  const p = h36Progress(x, { selection: 'not_selected' });
  assert.deepEqual(h36ReferenceValues(p, 'schooling').slice(0, 4), [null, 30, 'unknown', 'unknown']);
});
