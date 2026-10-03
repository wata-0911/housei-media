import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { deriveImportedAchievements } from '../src/planner/importedAchievementCalculations.ts';
import { exactImportedCurriculumId, plannerItemsWithoutOfficialEarned } from '../src/planner/officialCourseCredits.ts';
import { importedEarnedCreditsTotal } from '../src/planner/gradeImportApply.ts';
import { deriveOfficialGraduationFacts } from '../src/planner/officialGraduationFacts.ts';
import { initialState } from '../src/planner/storage.ts';

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

test('official facts: law partial2 never activates the Planner partial exception', () => {
  const x = fixture(); x.row.earnedCreditsTotal = 2;
  assert.deepEqual(facts(x).facts[0].allocation, { kind: 'unknown', reason: 'special_rule_evidence_required' });
  assert.equal(overall(run(x)), null);
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
