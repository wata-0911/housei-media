import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { validateCatalog } from '../src/planner/validation.ts';
import { attachCurriculumCatalog } from '../src/planner/curriculumCatalog.ts';
import { isHistorySeminar, historySeminarField } from '../src/planner/historySeminar.ts';
import { createMappingResolver } from '../src/planner/plannerHelpers.ts';
import { generateCurriculumCatalog } from '../src/planner/curriculumGeneration.ts';
import { applyManualMappingOverrides, manualMappingOverrideLedger, officialMappingOverrideLedger } from '../src/planner/manualMappingOverrides.ts';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { deriveImportedAchievements } from '../src/planner/importedAchievementCalculations.ts';
import { exactImportedCurriculumId, plannerItemsWithoutOfficialEarned } from '../src/planner/officialCourseCredits.ts';
import { importedEarnedCreditsTotal, importPreview, applyImport } from '../src/planner/gradeImportApply.ts';
import { parseHoseiGradeImportV1 } from '../src/planner/gradeImportContract.ts';
import { extractRows } from '../shared/grade-import/extractor.js';
import { deriveOfficialGraduationFacts } from '../src/planner/officialGraduationFacts.ts';
import { resolveRecognizedProfessionalCurriculumIdentity } from '../src/planner/recognizedProfessionalIdentity.ts';
import { unresolvedOfficialImpact, officialImpactsRequirement } from '../src/planner/unresolvedOfficialImpact.ts';
import { unresolvedSchoolingImpact } from '../src/planner/unresolvedSchoolingImpact.ts';
import { heldOfficialSchoolingContributions } from '../src/planner/heldOfficialSchooling.ts';
import { lawExcludedOfficialSchoolingContributions } from '../src/planner/lawExcludedOfficialSchooling.ts';
import { LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026 } from '../src/planner/graduationSources.ts';
import { initialState } from '../src/planner/storage.ts';
import { setThesisProgressForScope, thesisProgressForScope } from '../src/planner/thesisSelection.ts';
import { graduationProfileValidationError } from '../src/planner/graduationProfile.ts';
import { matchImportedCurriculumCourse } from '../src/planner/curriculumImportMatch.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GraduationProgressUI from '../src/components/planner/GraduationProgress.tsx';

// H20 production-level reproductions intentionally precede the production fix.
function h20Profile(x, recognizedS) {
  x.profile.admissionType = 'other_transfer';
  x.profile.recognizedCredits.totalCredits = 8;
  x.profile.recognizedCredits.schoolingEquivalentCredits = recognizedS;
  assert.equal(graduationProfileValidationError(x.profile), null);
  return x;
}
function h20Normal(recognizedS, officialS = 2) {
  const x = h20Profile(h41Fixture(), recognizedS);
  x.rows = [x.official(x, 4, officialS)];
  return x;
}
for (const [label, recognizedS, officialS, expected, status] of [
  ['positive recognition plus normal S2', 2, 2, 4, 'partial'],
  ['unknown recognition plus normal S2', null, 2, 2, 'unknown'],
  ['zero recognition plus normal S2', 0, 2, 2, 'partial'],
  ['positive recognition plus normal S0', 2, 0, 2, 'partial'],
]) test(`H20 reproduction: ${label}`, () => {
  const x = h20Normal(recognizedS, officialS), input = x.build();
  const facts = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile);
  assert.deepEqual(facts.allocations.map(a => [a.credits, a.completedCredits, a.schoolingCredits]), [[4, 4, officialS]]);
  assert.deepEqual(facts.facts[0].diagnostics, []);
  const p = x.progress(input), s = h42S(p);
  assert.deepEqual([s.earned, s.status, s.recognizedCredits, s.target], [expected, status, recognizedS, 30]);
  assert.equal(professional(p).earned, 4);
  assert.equal(h31Card(p, 'professional-law-schooling').earned, officialS);
  if (recognizedS === null) assert.match(s.reason, /認定スクーリング相当単位が未入力/);
  else assert.equal(s.reason, null);
});
test('H20 reproduction: synthetic recognition owns ordinary4 but never Offering schooling4', () => {
  const x = h20Profile(h14Fixture(), 2); x.rows = []; x.b.offering.method = 'schooling';
  const rule = x.requirement('h20-synthetic-S', { course_name: x.b.course.canonicalName }, null, 'min_schooling_credits'); rule.value = 2;
  const input = x.build(), p = x.progress(input);
  assert.equal(professional(p).earned, 4);
  assert.deepEqual([h42S(p).earned, h42S(p).status], [2, 'partial']);
  assert.equal(h31Card(p, 'professional-law-schooling').earned, 0);
  const s = p.requirements.find(r => r.requirementId === rule.id);
  assert.deepEqual([s.earned, s.status], [0, 'unsatisfied']);
});
for (const source of ['H19', 'H43']) for (const recognizedS of [null, 0, 2]) {
  test(`H20 reproduction: ${source} normal S2 coexists with recognized S${recognizedS}`, () => {
    const x = h20Profile(source === 'H19' ? h19Fixture() : h43Fixture(), recognizedS);
    const p = x.progress(), evidence = source === 'H19' ? h19Evidence(x) : h43Evidence(x);
    assert.equal(evidence.contributions.length, 1);
    assert.equal(evidence.contributions[0].schoolingCredits, 2);
    assert.equal(evidence.impact.globalReferenceUnknown, false);
    assert.deepEqual([h42S(p).earned, h42S(p).status, h42S(p).recognizedCredits],
      [2 + (recognizedS ?? 0), recognizedS === null ? 'unknown' : 'partial', recognizedS]);
    if (source === 'H19') assert.equal(h31Card(p, 'professional-law-schooling').earned, 0);
    else {
      assert.equal(evidence.official.allocations.length, 0);
      assert.equal(p.importedContributionCount, 0);
      assert.equal(h31Card(p, 'professional-required-elective').earned, 0);
    }
  });
}

test('H14 pre-fix reproduction: disjoint exact recognition counts official A and recognized B once', () => {
  const x = h14Fixture();
  const f = x.build();
  const facts = deriveOfficialGraduationFacts(x.rows, [], f, x.scope, x.profile);
  const p = x.progress(f);
  assert.deepEqual({ allocations: facts.allocations.length, diagnostics: facts.facts[0].diagnostics,
    professional: professional(p).earned, overall: overall(p) },
  { allocations: 1, diagnostics: [], professional: 8, overall: 8 });
  assert.equal(p.importedContributionCount, 1);
  assert.equal(professional(p).details[0].earned, 2);
});

function h14Fixture() {
  const x = h41Fixture();
  x.a = { course: x.course, mapping: x.mapping, offering: x.offering };
  x.b = x.add('recognition-B', '専門教育', null, '選択必修', 4, 'correspondence', '別制度科目B', x.scope);
  x.c = x.add('recognition-C', '専門教育', null, '選択必修', 4, 'correspondence', '別制度科目C', x.scope);
  for (const entry of [x.a, x.b, x.c]) x.f.curriculum.legacyCourseRelations.push({
    legacyCourseId: entry.offering.courseId, curriculumCourseId: entry.course.id,
    candidateCurriculumCourseIds: [entry.course.id],
  });
  x.recognize = entry => ({ id: `recognition-${entry.course.id}`, offeringId: entry.offering.id,
    courseId: entry.offering.courseId, mappingId: entry.mapping.mappingId, name: entry.offering.name, credits: 4 });
  x.profile.recognizedCredits.professionalCourses = [x.recognize(x.b)];
  x.rows = [x.official(x.a, 4, 2)];
  return x;
}

test('H19 pre-fix reproduction: exact Law marker retains global S2 without Law S8 or ordinary changes', () => {
  const x = fixture();
  x.course.canonicalName = 'データサイエンス入門A';
  x.row.rawName = x.course.canonicalName;
  const facts = deriveOfficialGraduationFacts([x.row], [], x.f, x.scope, x.profile);
  assert.equal(facts.allocations.length, 1);
  assert.deepEqual([facts.allocations[0].credits, facts.allocations[0].completedCredits, facts.allocations[0].schoolingCredits], [4, 4, null]);
  const positive = run(x);
  x.row.schoolingCreditsTotal = null;
  const unknown = run(x);
  assert.deepEqual(positive.cards, unknown.cards);
  assert.deepEqual(positive.requirements, unknown.requirements);
  assert.deepEqual(positive.referenceProgress[0], unknown.referenceProgress[0]);
  assert.equal(overall(positive), 4);
  assert.equal(positive.cards.find(c => c.requirementId === 'professional-law-schooling').earned, 0);
  const global = positive.referenceProgress.find(r => r.id === 'schooling-reference-progress');
  assert.deepEqual([global.earned, global.status], [2, 'partial']);
});

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
    assert.equal(overall(run(x, [item(x.offering, 'earned')])), 0, 'H41 retains the resolved lower bound, not a zero official aggregate');
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
  assert.equal(overall(progress), 0); assert.equal(progress.referenceProgress[0].status, 'unknown'); assert.match(progress.importedWarnings[0].reason, /duplicate_official_rows/);
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
    assert.equal(overall(run(x)), change === 'course_mapping_mismatch' ? null : 0);
    assert.equal(run(x).referenceProgress[0].status, 'unknown');
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
    const safeClosure = ['日本史概説', '現地研究', '地誌学特講', '人文地理学演習', '自然地理学演習'].includes(name);
    assert.equal(overall(run(x)), safeClosure ? 0 : null);
    assert.equal(run(x).referenceProgress[0].status, 'unknown');
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

test('official schooling: H20 Law exclusion keeps consumer allocation null while normal S coexists with recognition', () => {
  const x = fixture(); x.course.canonicalName = '情報学入門';
  assert.equal(facts(x).facts[0].schoolingEvidence.credits, 2);
  assert.equal(facts(x).allocations[0].schoolingCredits, null);
  assert.deepEqual([run(x).referenceProgress[1].earned, run(x).referenceProgress[1].status], [2, 'partial']);
  x.course.canonicalName = '監査科目';
  x.profile.admissionType = 'transfer_third_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = 15;
  assert.equal(facts(x).allocations[0].schoolingCredits, 2);
  assert.deepEqual([run(x).referenceProgress[1].earned, run(x).referenceProgress[1].status], [17, 'partial']);
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
  assert.equal(overall(run(x)), 0); assert.equal(run(x).referenceProgress[0].status, 'unknown');
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
    assert.equal(overall(progress), values.length === 1 && values[0] === 4 ? null : 0);
    assert.equal(professional(progress).status, 'unknown');
    assert.equal(progress.cards.find(c => c.requirementId === 'group-general').status, values.length === 1 && values[0] === 4 ? 'unknown' : 'unsatisfied');
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
  assert.equal(overall(progress), 0); assert.equal(progress.referenceProgress[0].status, 'unknown'); assert.equal(schoolingReference(progress), null);
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
    if (guard === 'schooling_recognition') {
      assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].schoolingCredits, 2);
      assert.deepEqual(result.facts[0].diagnostics, []);
    } else if (guard.startsWith('schooling_')) {
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
      assert.equal(overall(run(x)), 0); assert.equal(run(x).referenceProgress[0].status, 'unknown'); assert.equal(schoolingReference(run(x)), null);
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
  assert.equal(overall(progress), earned ?? 0); assert.equal(schoolingReference(progress), expected);
  if (earned === null) assert.equal(progress.referenceProgress[0].status, 'unknown');
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

test('official schooling priority: H20 positive official value retains law exclusion and independent recognition budget', () => {
  for (const guard of ['law', 'recognition']) {
    const x = mediaFixture(); x.row.schoolingCreditsTotal = 1;
    if (guard === 'law') x.course.canonicalName = '情報学入門';
    else { x.profile.admissionType = 'transfer_third_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = 15; }
    const records = [mediaRecord(x)], result = mediaFacts(x, records);
    assert.equal(result.allocations[0].credits, 2); assert.equal(result.allocations[0].schoolingCredits, guard === 'law' ? null : 1);
    assert.equal(result.facts[0].schoolingEvidence.credits, 1);
    assert.equal(result.facts[0].schoolingEvidence.source, 'official_row');
    assert.equal(result.facts[0].diagnostics.includes('media_schooling_credits_conflict'), false);
    assert.deepEqual(run(x, [], records).importedWarnings.map(n => n.kind), guard === 'law' ? ['schooling_confirmation'] : []);
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
      assert.deepEqual([reference.earned, reference.status, reference.target, reference.recognizedCredits], [4, 'unknown', 128, 4]);
      assert.match(reference.reason, /一般教育の認定情報が未確認/); // H37, independent of foreign S.
      // The global recognition breakdown is independently unknown; foreign4 never supplies S4/S2.
      assert.deepEqual([h38SchoolingReference(p).earned, h38SchoolingReference(p).status, h38SchoolingReference(p).target,
        h38SchoolingReference(p).recognizedCredits], [0, 'unknown', 30, null]);
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
      assert.equal(h38SchoolingReference(p).earned, 0);
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
    assert.equal(h38SchoolingReference(p).earned, 0);
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
  assert.deepEqual([h38SchoolingReference(p).earned, h38SchoolingReference(p).target, h38SchoolingReference(p).status], [0, 30, 'unknown']);
  assert.match(h38SchoolingReference(p).reason, /認定スクーリング相当単位が未入力/);
  const general = p.cards.find(c => c.requirementId === 'group-general');
  assert.deepEqual([general.earned, general.status], [0, 'unknown']);
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

test('H57 H20 safe completed official schooling survives independent transfer recognition', () => {
  const x = h57Fixture(); x.profile.admissionType = 'transfer_second_year';
  for (const equivalent of [null, 7]) {
    x.profile.recognizedCredits.schoolingEquivalentCredits = equivalent;
    const result = facts(x);
    assert.equal(result.allocations[0].credits, 2);
    assert.equal(result.allocations[0].schoolingCredits, x.row.schoolingCreditsTotal);
    assert.equal(result.facts[0].diagnostics.includes('schooling_evidence_requires_confirmation'), false);
    assert.equal(run(x).importedWarnings.some(w => w.kind === 'schooling_confirmation'), false);
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
test('H12 professional overlap remains held while H20 preserves normal schooling after entry',()=>{
  const x=h12Fixture(0);
  x.profile.recognizedCredits.professionalCourses=[{id:'recognition',offeringId:'other',credits:4}];
  assert.ok(h12Fact(h12Facts(x)).diagnostics.includes('recognized_overlap'));
  assert.equal(h12Facts(x).allocations.length,0);
  x.profile.recognizedCredits.professionalCourses=[];x.profile.admissionType='transfer_second_year';
  x.profile.recognizedCredits.schoolingEquivalentCredits=null;
  assert.equal(h12Allocation(h12Facts(x)).schoolingCredits,2);
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
  assert.equal(h12Card(p,'schooling').earned,0);assert.equal(h12Card(p,'schooling').status,'unsatisfied');
  assert.equal(p.referenceProgress.find(r=>r.id==='schooling-reference-progress').earned,2); // H19 global only.
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
    assert.deepEqual(s.slice(0, 4), [2, 30, 'unknown', 'unknown']);
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

test('H31 replaces H36 characterization: explicit law candidates hold professional dependencies only', () => {
  const x = h31Fixture(); x.items = []; x.set({ course: x.course });
  const p = x.calc();
  for (const id of ['professional-law-required-elective', 'professional-law-elective', 'professional-law-total']) {
    const c = p.cards.find(c => c.requirementId === id);
    assert.equal(c.status, 'unknown'); assert.equal(c.earned, 0);
    assert.match(c.reason, /対応関係を確認中/);
  }
  for (const id of ['group-general', 'group-foreign', 'group-physical', 'professional-law-schooling']) {
    assert.equal(p.cards.find(c => c.requirementId === id).status, 'unsatisfied');
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

// H31/P2: localization fixtures use production-valid direct Offering Mapping
// edges. Unsupported post-attach identities are malformed safety tests only.
function h31Fixture(department = '法律学科') {
  const x = fixture(department);
  const mappingTemplate = x.mapping, offeringTemplate = x.offering;
  x.f = structuredClone(catalog);
  let serial = 0, slot = 0;
  const uuid = () => `00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, '0')}`;
  const replaceOffering = offering => {
    const old = x.f.offerings[slot]; x.f.offerings[slot++] = offering;
    x.f.curriculum.offeringRelations = x.f.curriculum.offeringRelations.filter(r => r.offeringId !== old.id);
  };
  const add = (id, category, field, type, credits = 4, method = 'correspondence', name = id, scope = x.common) => {
    const mapping = { ...mappingTemplate, mappingId: uuid(), scopeId: scope, category, field, requirementType: type, curriculumCredits: credits };
    const course = { id: `curriculum:${mapping.mappingId}`, canonicalName: name, curriculumCredits: credits, scopeIds: [scope], mappingIds: [mapping.mappingId] };
    const offering = { ...offeringTemplate, id: uuid(), courseId: uuid(), curriculumCourseId: course.id, name, method, credits, mappingIds: [mapping.mappingId] };
    x.f.mappings.push(mapping); x.f.curriculum.courses.push(course); replaceOffering(offering);
    x.f.courses.push({ id: offering.courseId, canonicalName: name, identityStatus: 'provisional' });
    x.f.curriculum.offeringRelations.push({ offeringId: offering.id, curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id] });
    return { mapping, course, offering };
  };
  x.add = add;
  Object.assign(x, add('professional', '専門教育', null, department === '史学科' ? '必修' : '選択必修', 4, 'correspondence', '監査科目', x.scope));
  Object.assign(x.row, { curriculumCourseId: x.course.id, candidateCurriculumCourseIds: [x.course.id], courseId: x.offering.courseId });
  const general = [add('general1', '一般教育', '人文', '選択必修'), add('general2', '一般教育', '人文', '選択必修')];
  const foreign = add('foreign', '外国語', '英語', '選択必修', 4, 'schooling');
  const physical = add('physical', '保健体育', null, '選択必修', 2, 'correspondence', '健康・スポーツ科学概論');
  x.items = [x.offering, ...general.map(g => g.offering), foreign.offering, physical.offering].map(o => item(o, 'earned'));
  x.candidate = { ...x.offering, id: uuid(), courseId: null, curriculumCourseId: null,
    name: '表示名から候補を推測しない', resolutionStatus: 'manual_review', mappingIds: [], credits: 90 };
  replaceOffering(x.candidate);
  x.relation = { offeringId: x.candidate.id, curriculumCourseId: null, candidateCurriculumCourseIds: [] };
  x.f.curriculum.offeringRelations.push(x.relation);
  // A: explicit Offering Mapping edges are allowed on manual_review.
  // B/C: institutional identity and relation candidates remain matched-only.
  x.set = (...rows) => { x.candidate.mappingIds = [...new Set(rows.flatMap(r => r.course.mappingIds))]; };
  x.build = () => {
    // Keep complete annual coverage and the schema-valid UUID identities used
    // by production. Every localization assertion goes through both gates.
    assert.equal(x.f.offerings.length, 686);
    assert.equal(validateCatalog(x.f), true, JSON.stringify(validateCatalog.errors));
    const attached = attachCurriculumCatalog(x.f, x.f.curriculum);
    assert.equal(validateCatalog(attached), true, JSON.stringify(validateCatalog.errors));
    const resolve = createMappingResolver(attached);
    for (const offering of attached.offerings) resolve(offering);
    return attached;
  };
  const calculate = (input, status, rows) => calculateGraduationProgress([...x.items, ...(status ? [item(x.candidate, status)] : [])], input, x.scope, [], 'not_selected', [], rows, x.profile);
  x.calc = (candidateStatus = 'earned', rows = []) => calculate(x.build(), candidateStatus, rows);
  // Direct mutation is reserved for explicitly malformed safety assertions.
  x.calcMalformed = (candidateStatus = 'earned', rows = []) => calculate(x.f, candidateStatus, rows);
  x.baseline = () => x.calc(null);
  return x;
}
const h31Card = (p, id) => p.cards.find(c => c.requirementId === id);
function h31Compare(x, affected, result = x.calc(), baseline = x.baseline()) {
  for (const before of baseline.cards.filter(c => c.ruleType === 'group' || c.ruleType === 'professional_group')) {
    const after = h31Card(result, before.requirementId);
    if (affected.includes(before.requirementId)) {
      assert.equal(after.status, 'unknown', before.requirementId);
      assert.equal(after.earned, before.earned, before.requirementId);
      assert.match(after.reason, /対応関係を確認中/, before.requirementId);
    } else assert.deepEqual(after, before, before.requirementId);
  }
  assert.equal(overall(result), overall(baseline));
  assert.equal(result.graduationCheckComplete, false);
  assert.equal(x.candidate.resolutionStatus, 'manual_review');
}
for (const [category, field, id] of [['一般教育', '人文', 'general'], ['一般教育', '社会', 'general'], ['一般教育', '自然', 'general'], ['外国語', '英語', 'foreign'], ['保健体育', null, 'physical'], ['一般教育', null, 'general']]) {
  test(`H31 common only ${category}/${field}: safe baseline amounts and unrelated cards`, () => {
    const x = h31Fixture(); const row = x.add('candidate-target', category, field, '選択必修', 4, 'correspondence', field === null && category === '一般教育' ? '基礎特講' : '候補制度科目');
    x.set(row); h31Compare(x, [`group-${id}`]);
    assert.equal(h31Card(x.calc(), 'group-general').earned, 8);
    assert.equal(h31Card(x.calc(), 'group-foreign').earned, 4);
    assert.equal(h31Card(x.calc(), 'group-physical').earned, 2);
    assert.equal(x.calc().referenceProgress[0].status, 'unknown');
    assert.equal(x.calc().referenceProgress[0].target, x.baseline().referenceProgress[0].target);
  });
}
for (const [dept, prefix, types] of [['法律学科', 'law-', ['選択必修', '選択']], ['日本文学科', '', ['必修', '選択必修', '選択']], ['史学科', 'history-', ['必修', 'スクーリング選択必修', '選択']], ['地理学科', 'geography-', ['必修', 'スクーリング必修', '選択必修', '選択']], ['経済学科', 'economics-', ['選択必修', '選択']], ['商業学科', 'commerce-', ['選択必修', '選択']]]) {
  for (const type of types) test(`H31 ${dept}/${type}: bucket/dependency closure with all common cards unchanged`, () => {
    const x = h31Fixture(dept); const row = x.add('professional-target', '専門教育', dept === '地理学科' ? '人文地理の分野' : dept === '史学科' ? '日本史の分野' : null, type, 4, 'correspondence', '独立制度科目', x.scope);
    x.set(row);
    const suffix = { 必修: 'required', 選択必修: 'required-elective', 選択: 'elective', スクーリング必修: 'schooling-required', スクーリング選択必修: 'schooling-required-elective' }[type];
    const affected = [`professional-${prefix}${suffix}`];
    if (type === '選択必修' && ['法律学科', '日本文学科', '地理学科'].includes(dept) || dept === '史学科' && type === 'スクーリング選択必修') affected.push(`professional-${prefix}elective`);
    if (dept !== '史学科') affected.push(`professional-${dept === '日本文学科' ? 'japanese-' : prefix}total`);
    h31Compare(x, affected);
    assert.equal(overall(x.calc()), 18); // 8+4+2+4, never candidate90.
  });
}
test('H31 production-valid common + professional union uses only direct Offering Mapping edges', () => {
  const x = h31Fixture(); const common = x.add('common-target', '一般教育', '自然', '選択必修');
  const pro = x.add('pro-target', '専門教育', null, '選択', 4, 'correspondence', '専門候補', x.scope);
  x.set(common, pro); h31Compare(x, ['group-general', 'professional-law-elective', 'professional-law-total']);
  assert.deepEqual(x.relation.candidateCurriculumCourseIds, []); assert.equal(x.candidate.curriculumCourseId, null);
});
test('H31 outside current/common scopes affects no current requirement or ordinary card', () => {
  const x = h31Fixture(); const other = catalog.programs.find(p => p.department === '経済学科').scopeId;
  x.set(x.add('outside', '専門教育', null, '選択', 4, 'correspondence', '対象外制度科目', other));
  const p = x.calc(); assert.deepEqual(p.cards, x.baseline().cards); assert.deepEqual(p.requirements, x.baseline().requirements);
  assert.deepEqual(p.referenceProgress[0], x.baseline().referenceProgress[0]);
  // H42/H43: even correspondence unresolved retains existing global S uncertainty.
  assert.equal(p.referenceProgress[1].status, 'unknown');
});
for (const mode of ['absent', 'bad-mapping', 'bad-course', 'bad-scope', 'bad-category', 'bad-field', 'bad-type', 'partial-bad-candidate', 'wrong-department-type']) {
  test(`H31 malformed/inconsistent ${mode}: conservative global fallback, known lower bounds retained`, () => {
    const x = h31Fixture(); const baseline = x.baseline(); const row = x.add('unsafe', '一般教育', '自然', '選択必修');
    if (mode !== 'absent') x.set(row);
    if (mode === 'bad-mapping') x.candidate.mappingIds = ['missing'];
    if (mode === 'bad-course') x.relation.candidateCurriculumCourseIds = ['missing'];
    if (mode === 'bad-scope') row.mapping.scopeId = 'missing';
    if (mode === 'bad-category') row.mapping.category = '不明';
    if (mode === 'bad-field') row.mapping.field = 123;
    if (mode === 'bad-type') { row.mapping.category = '専門教育'; row.mapping.requirementType = null; }
    if (mode === 'wrong-department-type') { row.mapping.category = '専門教育'; row.mapping.scopeId = x.scope; row.mapping.requirementType = '必修'; }
    if (mode === 'partial-bad-candidate') x.relation.candidateCurriculumCourseIds.push('missing');
    h31Compare(x, baseline.cards.filter(c => ['group', 'professional_group'].includes(c.ruleType)).map(c => c.requirementId), x.calcMalformed(), baseline);
  });
}
test('H31 non-earned manual_review and outside_mapping_scope preserve ordinary/projection semantics; matched resumes normal allocation', () => {
  const x = h31Fixture(); const row = x.add('future', '一般教育', '自然', '選択必修'); x.set(row);
  for (const status of ['in_progress', 'planned']) {
    assert.deepEqual(x.calc(status).cards, x.baseline().cards);
    assert.deepEqual(x.calc(status).requirements, x.baseline().requirements);
    assert.deepEqual(x.calc(status).referenceProgress, x.baseline().referenceProgress);
  }
  x.candidate.resolutionStatus = 'outside_mapping_scope'; assert.deepEqual(x.calc().cards, x.baseline().cards);
  x.candidate.resolutionStatus = 'matched'; x.candidate.mappingIds = row.course.mappingIds; x.candidate.credits = 4;
  Object.assign(x.relation, { curriculumCourseId: row.course.id, candidateCurriculumCourseIds: [row.course.id] });
  assert.equal(h31Card(x.calc(), 'group-general').earned, 12);
});
test('H31/H32: matched credits-null guard remains; manual-review null credits never become earned', () => {
  const x = h31Fixture(); const row = x.add('null', '一般教育', '自然', '選択必修'); x.set(row); x.candidate.credits = null;
  h31Compare(x, ['group-general']);
  x.candidate.resolutionStatus = 'matched'; x.candidate.mappingIds = row.course.mappingIds;
  Object.assign(x.relation, { curriculumCourseId: row.course.id, candidateCurriculumCourseIds: [row.course.id] });
  x.f.requirements.push({ ...catalog.requirements.find(r => r.status === 'structured' && r.ruleType === 'min_credits'), id: '11111111-1111-4111-8111-000000000001', scopeId: x.scope, value: 8, target: { curriculum_category: '一般教育' }, conditions: null });
  const r = x.calc().requirements.find(r => r.requirementId === '11111111-1111-4111-8111-000000000001');
  assert.equal(r.status, 'unknown'); assert.equal(r.earned, null); assert.match(r.reason, /単位数不明/);
});
for (const [label, target] of [
  ['course_name', { course_name: '監査科目' }], ['course_names', { course_names: ['監査科目', '別科目'] }],
  ['curriculum_category', { curriculum_category: '専門教育' }], ['curriculum_field', { curriculum_category: '専門教育', curriculum_field: '確認分野' }],
  ['requirement_type', { curriculum_category: '専門教育', requirement_type: '選択必修' }],
]) test(`H31 structured ${label}: intersecting unknown keeps resolved/official lower bound and target; nonintersection equals baseline`, () => {
  const x = h31Fixture(); x.mapping.field = '確認分野';
  x.f.requirements.push({ ...catalog.requirements.find(r => r.status === 'structured' && r.ruleType === 'min_credits'), id: '11111111-1111-4111-8111-000000000002', scopeId: x.scope, value: 12, target, conditions: null });
  const row = p => p.requirements.find(r => r.requirementId === '11111111-1111-4111-8111-000000000002');
  x.set({ course: x.course });
  for (const rows of [[], [x.row]]) {
    const p = x.calc('earned', rows); const baseline = x.calc(null, rows);
    assert.equal(row(p).status, 'unknown'); assert.equal(row(p).earned, 4); assert.equal(row(p).target, 12);
    assert.equal(row(p).inProgress, row(baseline).inProgress); assert.equal(row(p).planned, row(baseline).planned);
    assert.equal(overall(p), overall(baseline)); // official priority, no duplicate4 or candidate90.
  }
  const other = x.add('nonintersection', label === 'curriculum_category' ? '一般教育' : '専門教育', label === 'curriculum_field' ? '別分野' : '自然', '選択', 4, 'correspondence', '別制度科目', label === 'curriculum_category' ? x.common : x.scope);
  x.set(other); assert.deepEqual(row(x.calc()), row(x.baseline()));
});
test('H31 named candidate without resolved annual match retains known zero + target; full-course lower bound is completion-only', () => {
  const x = h31Fixture(); const target = x.add('named', '一般教育', '自然', '選択必修', 4, 'correspondence', '制度名');
  target.offering.resolutionStatus = 'outside_mapping_scope';
  target.offering.curriculumCourseId = null;
  Object.assign(x.f.curriculum.offeringRelations.find(r => r.offeringId === target.offering.id), { curriculumCourseId: null, candidateCurriculumCourseIds: [] }); x.set(target);
  x.f.requirements.push({ ...catalog.requirements.find(r => r.status === 'structured' && r.ruleType === 'min_credits'), id: '11111111-1111-4111-8111-000000000003', scopeId: x.scope, value: 4, target: { course_name: '制度名' }, conditions: { full_course_credits_required: true } });
  const r = x.calc().requirements.find(r => r.requirementId === '11111111-1111-4111-8111-000000000003');
  assert.equal(r.status, 'unknown'); assert.equal(r.earned, 0); assert.equal(r.target, 4);
  x.set({ course: x.course }); x.f.requirements.at(-1).target = { course_name: x.course.canonicalName }; x.offering.credits = 2;
  assert.equal(x.calc().requirements.find(r => r.requirementId === '11111111-1111-4111-8111-000000000003').earned, 0);
});
test('H31 method intersection matches existing method gate, while unsupported condition guard stays unchanged', async () => {
  const { unresolvedEarnedImpact, impactsRequirement } = await import('../src/planner/unresolvedEarnedImpact.ts');
  const x = h31Fixture(); x.set({ course: x.course });
  const requirement = { ...catalog.requirements.find(r => r.status === 'structured' && r.ruleType === 'min_credits'), id: '11111111-1111-4111-8111-000000000004', scopeId: x.scope, value: 4, target: { curriculum_category: '専門教育' }, conditions: { method: 'schooling' } };
  const matching = (m, r) => m.category === r.target.curriculum_category;
  assert.equal(impactsRequirement(unresolvedEarnedImpact([item(x.candidate, 'earned')], x.build(), x.scope), requirement, matching, null), false);
  x.candidate.method = 'schooling';
  assert.equal(impactsRequirement(unresolvedEarnedImpact([item(x.candidate, 'earned')], x.build(), x.scope), requirement, matching, null), true);
  x.f.requirements.push(requirement);
  const r = x.calc().requirements.find(r => r.requirementId === '11111111-1111-4111-8111-000000000004');
  assert.match(r.reason, /条件または例外/); assert.equal(r.earned, null);
  assert.equal(h31Card(x.calc(), 'professional-law-schooling').status, 'unknown');
  assert.equal(h31Card(x.calc(), 'group-foreign').status, h31Card(x.baseline(), 'group-foreign').status);
});
test('H31/H38 recognition overlay retains recognized foreign4/Snull and never counts candidate credits', () => {
  const x = h31Fixture(); x.profile.admissionType = 'transfer_second_year';
  x.profile.recognizedCredits.foreignLanguage = { mode: 'recognized', credits: 4, language: 'english', schoolingEquivalentCredits: null };
  const row = x.add('recognized-target', '外国語', '英語', '選択必修'); x.set(row);
  let p = x.calc(); assert.equal(h31Card(p, 'group-foreign').earned, 4); assert.equal(h31Card(p, 'group-foreign').status, 'unknown');
  assert.match(h31Card(p, 'group-foreign').reason, /スクーリング相当認定単位が未確認/);
  assert.equal(p.referenceProgress[1].earned, 4);
  assert.equal(p.referenceProgress[1].recognizedCredits, null);
  assert.equal(p.referenceProgress[1].status, 'unknown');
  x.profile.recognizedCredits.foreignLanguage.schoolingEquivalentCredits = 2;
  p = x.calc(); assert.equal(h31Card(p, 'group-foreign').earned, 4); assert.equal(h31Card(p, 'group-foreign').status, 'unknown');
  assert.match(h31Card(p, 'group-foreign').reason, /対応関係を確認中/);
});
test('H31 recognition overlay cannot promote general/physical candidate holds; H37 reason priority is unchanged', () => {
  const x = h31Fixture(); x.profile.admissionType = 'transfer_second_year';
  for (const key of ['humanities', 'social', 'natural']) x.profile.recognizedCredits.general[key] = { mode: 'recognized', credits: 12 };
  x.profile.recognizedCredits.physicalEducation = { mode: 'recognized', credits: 2 };
  x.set(x.add('recognized-general', '一般教育', '自然', '選択必修'), x.add('recognized-physical', '保健体育', null, '選択必修'));
  const p = x.calc(); assert.equal(h31Card(p, 'group-general').status, 'unknown'); assert.equal(h31Card(p, 'group-general').earned, 36);
  assert.equal(h31Card(p, 'group-physical').status, 'unknown'); assert.equal(h31Card(p, 'group-physical').earned, 2);
  x.profile.recognizedCredits.general.natural = { mode: 'unknown', credits: null };
  const held = x.calc();
  assert.equal(h31Card(held, 'group-general').earned, 32); assert.match(h31Card(held, 'group-general').reason, /認定情報が未確認/);
  assert.equal(h31Card(held, 'group-general').status, 'unknown');
  assert.equal(h31Card(held, 'group-general').details[2].earned, 0, 'candidate90 is never earned');
  assert.equal(overall(held), 42); // general32 + foreign4 + physical2 + professional4.
  assert.match(held.referenceProgress[0].reason, /対応関係を確認中/, 'existing H31 reference reason has priority');
});
test('H31 geography transfer candidate uses institutional identity and holds destination closure, keeps resolved transfers unchanged', () => {
  const x = h31Fixture('地理学科');
  const transfer = x.add('human-seminar', '専門教育', '人文地理の分野', 'スクーリング必修', 2, 'schooling', '人文地理学演習', x.scope);
  x.set(transfer); x.items.push(item(transfer.offering, 'earned'));
  h31Compare(x, ['professional-geography-schooling-required', 'professional-geography-required-elective', 'professional-geography-elective', 'professional-geography-total']);
  assert.equal(h31Card(x.calc(), 'professional-geography-schooling-required').earned, 2);
  assert.equal(h31Card(x.calc(), 'professional-geography-required').status, h31Card(x.baseline(), 'professional-geography-required').status);
});
test('H31 law overflow keeps allocated lower bounds and known partials once; elective-only leaves required-elective evaluable', () => {
  const x = h31Fixture();
  for (let n = 0; n < 8; n++) x.items.push(item(x.add(`overflow-${n}`, '専門教育', null, '選択必修', 4, 'correspondence', `選択必修${n}`, x.scope).offering, 'earned'));
  x.set({ course: x.course }); let p = x.calc(); h31Compare(x, ['professional-law-required-elective', 'professional-law-elective', 'professional-law-total'], p);
  assert.equal(h31Card(p, 'professional-law-required-elective').earned, 32);
  assert.equal(h31Card(p, 'professional-law-elective').earned, 4); assert.equal(h31Card(p, 'professional-law-total').earned, 36);
  x.set(x.add('elective-target', '専門教育', null, '選択', 4, 'correspondence', '選択候補', x.scope));
  p = x.calc(); h31Compare(x, ['professional-law-elective', 'professional-law-total'], p);
  assert.equal(h31Card(p, 'professional-law-required-elective').status, 'satisfied');
});
test('H31 runtime catalog inventory and history special routing stay unchanged', () => {
  const held = catalog.offerings.filter(o => o.resolutionStatus === 'manual_review');
  assert.equal(held.length, 8);
  assert.equal(validateCatalog(catalog), true);
  assert.deepEqual(held.reduce((counts, o) => { const field = historySeminarField(o); counts[field] = (counts[field] ?? 0) + 1; return counts; }, {}), { 日本: 4, 西洋: 2, 東洋: 2 });
  assert.ok(held.every(isHistorySeminar));
  const scope = catalog.programs.find(p => p.department === '史学科').scopeId;
  const profile = fixture().profile;
  const baseline = calculateGraduationProgress([], catalog, scope, [], 'selected', [], [], profile);
  for (const offering of held) {
    assert.equal(offering.method, 'schooling'); assert.equal(offering.credits, 2); assert.deepEqual(offering.mappingIds, []);
    assert.equal(offering.courseId, null); assert.equal(offering.curriculumCourseId, null);
    assert.equal(catalog.curriculum.offeringRelations.find(r => r.offeringId === offering.id).curriculumCourseId, null);
    assert.deepEqual(catalog.curriculum.offeringRelations.find(r => r.offeringId === offering.id).candidateCurriculumCourseIds, []);
    const p = calculateGraduationProgress([item(offering, 'earned')], catalog, scope, [], 'selected', [], [], profile);
    for (const id of ['group-general', 'group-foreign', 'group-physical', 'professional-history-required']) assert.deepEqual(h31Card(p, id), h31Card(baseline, id));
    assert.match(h31Card(p, 'professional-history-schooling-required-elective').reason, /修得順/);
    assert.equal(p.referenceProgress[1].status, 'unknown');
  }
  const snapshot = JSON.stringify(catalog); calculateGraduationProgress([], catalog, scope);
  assert.equal(JSON.stringify(catalog), snapshot);
  assert.equal(catalog.metadata.graduationCheckComplete, false); assert.equal(catalog.metadata.sourceLinksReverified, false); assert.equal(initialState().schemaVersion, 22);
});
test('H31 general detail marks only the candidate field, preserves quantities; basic lecture affects total only', () => {
  const x = h31Fixture(); const row = x.add('natural-detail', '一般教育', '自然', '選択必修'); x.set(row);
  const before = h31Card(x.baseline(), 'group-general'); const after = h31Card(x.calc(), 'group-general');
  for (const detail of after.details) {
    const baseline = before.details.find(d => d.label === detail.label);
    if (detail.label === '自然') { assert.equal(detail.earned, baseline.earned); assert.match(detail.reason, /対応関係を確認中/); }
    else assert.deepEqual(detail, baseline);
  }
  row.mapping.field = null; row.course.canonicalName = '基礎特講';
  assert.deepEqual(h31Card(x.calc(), 'group-general').details, before.details);
});
test('H31 affected UI displays known lower bounds beside hold status without candidate credits', () => {
  const x = h31Fixture(); x.set({ course: x.course });
  const p = x.calc(); const html = renderToStaticMarkup(createElement(GraduationProgressUI, { progress: p }));
  assert.match(html, /判定保留/); assert.match(html, /対応関係を確認中/); assert.match(html, /修得済み 18/);
  assert.doesNotMatch(html, /修得済み 108/);
  assert.equal(h31Card(p, 'professional-law-required-elective').earned, 4);
});
test('H31 matched official duplicate authority remains independent of unresolved Mapping candidates', () => {
  const x = h31Fixture(); x.set({ course: x.course });
  x.candidate.resolutionStatus = 'matched'; x.candidate.credits = 4;
  Object.assign(x.relation, { curriculumCourseId: x.course.id, candidateCurriculumCourseIds: [x.course.id] });
  const p = x.calc('earned', [x.row]); const baseline = x.calc(null, [x.row]);
  assert.deepEqual(p.cards, baseline.cards); assert.deepEqual(p.requirements, baseline.requirements); assert.deepEqual(p.referenceProgress, baseline.referenceProgress);
  assert.equal(overall(p), 18);
});
for (const mode of ['ambiguous', 'incompleteMetadata', 'legacyRepeatable']) test(`H31 coexistence preserves H34 ${mode} reason and null quantity`, () => {
  const x = h31Fixture(); x.set({ course: x.course });
  if (mode === 'ambiguous') {
    const conflict = x.add('conflict', '専門教育', null, '選択', 4, 'correspondence', '別専門', x.scope);
    x.offering.mappingIds.push(conflict.mapping.mappingId); x.offering.curriculumCourseId = null;
    Object.assign(x.f.curriculum.offeringRelations.find(r => r.offeringId === x.offering.id), { curriculumCourseId: null, candidateCurriculumCourseIds: [x.course.id, conflict.course.id].sort() });
  }
  if (mode === 'incompleteMetadata') { x.mapping.curriculumCredits = null; x.course.curriculumCredits = null; }
  if (mode === 'legacyRepeatable') x.offering.name = '歴史資料学'; // No repeatable rule for this department: exercise the legacy guard.
  const before = h31Card(x.baseline(), 'professional-law-required-elective'); const after = h31Card(x.calc(), 'professional-law-required-elective');
  assert.equal(before.status, 'unknown'); assert.equal(before.earned, null); assert.deepEqual(after, before);
  assert.doesNotMatch(after.reason, /対応関係を確認中/);
});
for (const [name, type, field, affected] of [
  ['現地研究', 'スクーリング必修', null, ['schooling-required', 'elective']],
  ['地誌学特講', '選択必修', '地誌・その他の分野', ['required-elective', 'elective']],
  ['自然地理学演習', 'スクーリング必修', '自然地理の分野', ['schooling-required', 'required-elective', 'elective']],
  ['人文地理学特講', '選択', '人文地理の分野', ['elective']],
]) test(`H31 geography ${name} staged transfer regression`, () => {
  const x = h31Fixture('地理学科'); const row = x.add('geo-transfer', '専門教育', field, type, name === '現地研究' ? 1 : 2, 'schooling', name, x.scope);
  x.set(row); x.items.push(item(row.offering, 'earned'));
  h31Compare(x, [...affected, 'total'].map(id => `professional-geography-${id}`));
});
for (const family of ['歴史資料学', '日本史概説', '東洋史概説', '西洋史概説']) test(`H31 real history ${family} dedicated routing remains outside generic unresolved allocation`, () => {
  const scope = catalog.programs.find(p => p.department === '史学科').scopeId;
  const os = catalog.offerings.filter(o => o.name.startsWith(family)); assert.ok(os.length > 0);
  const profile = fixture().profile;
  const baseline = calculateGraduationProgress([], catalog, scope, [], 'selected', [], [], profile);
  for (const o of os) {
    const p = calculateGraduationProgress([item(o, 'earned')], catalog, scope, [], 'selected', [], [], profile);
    for (const id of ['group-general', 'group-foreign', 'group-physical']) assert.deepEqual(h31Card(p, id), h31Card(baseline, id));
    for (const c of p.cards) assert.doesNotMatch(c.reason ?? '', /修得済みに対応関係を確認中/);
  }
});
test('H31/H12 affected law structured totals use the existing safe partial allocator, including official-only authority', () => {
  const x = h31Fixture(); x.row.earnedCreditsTotal = 2; x.row.schoolingCreditsTotal = 2; x.set({ course: x.course });
  const p = x.calc('earned', [x.row]);
  assert.equal(h31Card(p, 'professional-law-total').earned, 0);
  const total = p.requirements.find(r => x.f.requirements.some(rule => rule.id === r.requirementId && rule.ruleId === 'law_total_without_thesis_min_credits'));
  assert.equal(total.status, 'unknown'); assert.equal(total.earned, 0); assert.match(total.reason, /対応関係を確認中/);
  assert.equal(overall(p), 14);
  x.items = x.items.filter(i => i.offeringId !== x.offering.id);
  const absent = { ...x.offering, id: '22222222-2222-4222-8222-222222222222', name: '制度外の開講', courseId: null, resolutionStatus: 'outside_mapping_scope', curriculumCourseId: null, mappingIds: [] };
  x.f.offerings[x.f.offerings.indexOf(x.offering)] = absent;
  Object.assign(x.f.curriculum.offeringRelations.find(r => r.offeringId === x.offering.id), { offeringId: absent.id, curriculumCourseId: null, candidateCurriculumCourseIds: [] });
  assert.equal(overall(x.calc('earned', [x.row])), 14); // H02 annual removal cannot alter independent Course authority.
});

test('H31/P2 reachability A: direct manual_review Mapping edges pass schema, generator and attach without acquiring Course identity', () => {
  const raw = JSON.parse(readFileSync(new URL('../src/data/planner_catalog_2026.json', import.meta.url)));
  const offering = raw.offerings.find(o => o.id === catalog.offerings.find(o => o.resolutionStatus === 'manual_review').id);
  const mapping = raw.mappings.find(m => m.category === '一般教育');
  offering.mappingIds = [mapping.mappingId];
  assert.equal(validateCatalog(raw), true);
  const input = applyManualMappingOverrides(raw);
  assert.equal(validateCatalog(input), true);
  assert.equal(input.offerings.find(o => o.id === offering.id).resolutionStatus, 'manual_review');
  const rows = JSON.parse(readFileSync(new URL('../scripts/inputs/curriculum-rows-2026.json', import.meta.url))).rows;
  const groups = JSON.parse(readFileSync(new URL('../scripts/inputs/curriculum-equivalences-2026.json', import.meta.url))).groups;
  const generated = generateCurriculumCatalog(input, rows, groups);
  assert.deepEqual(generated, catalog.curriculum); // Direct unresolved edges do not manufacture institutional relations.
  const relation = generated.offeringRelations.find(r => r.offeringId === offering.id);
  assert.deepEqual(relation, { offeringId: offering.id, curriculumCourseId: null, candidateCurriculumCourseIds: [] });
  const attached = attachCurriculumCatalog(input, generated);
  assert.equal(validateCatalog(attached), true);
  const output = attached.offerings.find(o => o.id === offering.id);
  assert.equal(output.resolutionStatus, 'manual_review'); assert.equal(output.curriculumCourseId, null);
  assert.deepEqual(createMappingResolver(attached)(output), [mapping]);
});
for (const source of ['relation.curriculumCourseId', 'relation.candidateCurriculumCourseIds']) test(`H31/P2 reachability C: ${source} on manual_review is schema-valid but attach rejects; malformed runtime falls back globally`, () => {
  const x = h31Fixture(); const baseline = x.baseline(); x.set({ course: x.course });
  if (source === 'relation.curriculumCourseId') x.relation.curriculumCourseId = x.course.id;
  else x.relation.candidateCurriculumCourseIds = [x.course.id];
  assert.equal(validateCatalog(x.f), true); // Schema is structural; attach enforces the status/edge relationship.
  assert.throws(() => attachCurriculumCatalog(x.f, x.f.curriculum), /Stale annual curriculum relation/);
  h31Compare(x, baseline.cards.filter(c => ['group', 'professional_group'].includes(c.ruleType)).map(c => c.requirementId), x.calcMalformed(), baseline);
});
test('H31/P2 reachability C: Offering.curriculumCourseId is overwritten by attach, never an unresolved candidate authority', () => {
  const x = h31Fixture(); x.candidate.curriculumCourseId = x.course.id;
  assert.equal(validateCatalog(x.f), true);
  const attached = x.build(); assert.equal(attached.offerings.find(o => o.id === x.candidate.id).curriculumCourseId, null);
  // No direct Mapping edges: a raw input identity cannot make this professional-only.
  const p = x.calc(); for (const c of p.cards.filter(c => ['group', 'professional_group'].includes(c.ruleType))) assert.equal(c.status, 'unknown');
  assert.equal(overall(p), 18);
  const baseline = x.calc(null);
  h31Compare(x, baseline.cards.filter(c => ['group', 'professional_group'].includes(c.ruleType)).map(c => c.requirementId), x.calcMalformed(), baseline);
});
test('H31/P2 reachability B: nonempty institutional relation is supported only after matched resolution', () => {
  const x = h31Fixture(); x.set({ course: x.course });
  x.candidate.resolutionStatus = 'matched';
  assert.throws(() => attachCurriculumCatalog(x.f, x.f.curriculum), /Stale annual curriculum relation/);
  Object.assign(x.relation, { curriculumCourseId: x.course.id, candidateCurriculumCourseIds: [x.course.id] });
  const attached = x.build(); assert.equal(attached.offerings.find(o => o.id === x.candidate.id).curriculumCourseId, x.course.id);
});
test('H31/P2 reachability D: nonexistent direct Mapping is rejected by production resolver and cannot localize malformed input', () => {
  const x = h31Fixture(); x.candidate.mappingIds = ['ffffffff-ffff-4fff-8fff-ffffffffffff'];
  assert.equal(validateCatalog(x.f), true); // A well-formed UUID still needs catalog referential validation.
  assert.throws(() => x.build(), /Unknown mappingId/);
  const p = x.calcMalformed(); for (const c of p.cards.filter(c => ['group', 'professional_group'].includes(c.ruleType))) assert.equal(c.status, 'unknown');
  assert.equal(overall(p), 18);
});
test('H31/P2 production-valid no-candidate generic manual_review is globally held with known lower bounds', () => {
  const x = h31Fixture(); assert.deepEqual(x.candidate.mappingIds, []); assert.equal(x.build().offerings.find(o => o.id === x.candidate.id).curriculumCourseId, null);
  h31Compare(x, x.baseline().cards.filter(c => ['group', 'professional_group'].includes(c.ruleType)).map(c => c.requirementId));
  assert.equal(overall(x.calc()), 18); assert.equal(x.calc().referenceProgress[0].status, 'unknown');
});
test('H31/P2 raw63 -> explicit override55 matched -> runtime8 unresolved preserves override boundary and flags', () => {
  const raw = JSON.parse(readFileSync(new URL('../src/data/planner_catalog_2026.json', import.meta.url)));
  const snapshot = structuredClone(raw); assert.equal(validateCatalog(raw), true);
  assert.equal(raw.offerings.filter(o => o.resolutionStatus === 'manual_review').length, 63);
  const overrides = [...manualMappingOverrideLedger.overrides, ...officialMappingOverrideLedger.overrides];
  assert.equal(overrides.reduce((sum, o) => sum + o.offeringIds.length, 0), 55);
  const patched = applyManualMappingOverrides(raw); assert.equal(validateCatalog(patched), true);
  for (const override of overrides) for (const id of override.offeringIds) {
    const original = raw.offerings.find(o => o.id === id), output = patched.offerings.find(o => o.id === id);
    assert.equal(original.resolutionStatus, 'manual_review'); assert.deepEqual(original.mappingIds, []);
    assert.equal(output.resolutionStatus, 'matched'); assert.deepEqual(output.mappingIds, override.mappingIds);
  }
  const attached = attachCurriculumCatalog(patched); assert.equal(validateCatalog(attached), true);
  assert.equal(attached.offerings.filter(o => o.resolutionStatus === 'manual_review').length, 8);
  assert.deepEqual(attached, catalog); assert.deepEqual(raw, snapshot);
  assert.equal(attached.metadata.graduationCheckComplete, false); assert.equal(attached.metadata.sourceLinksReverified, false);
});

// H37: unknown recognition increments hold evaluation, never erase safe quantities.
// Reuse the schema/attach-validated H31 builder, with no unresolved candidate item.
const h37Fields = [['humanities', '人文'], ['social', '社会'], ['natural', '自然']];
function h37Fixture(department = '経済学科') {
  const x = h31Fixture(department);
  x.items = []; x.rows = [];
  x.profile.admissionType = 'other_transfer';
  x.profile.recognizedCredits.schoolingEquivalentCredits = 0;
  for (const [key] of h37Fields) x.profile.recognizedCredits.general[key] = { mode: 'none', credits: null };
  x.profile.recognizedCredits.foreignLanguage = { mode: 'none', credits: null, language: 'unknown', schoolingEquivalentCredits: null };
  x.profile.recognizedCredits.physicalEducation = { mode: 'none', credits: null };
  let serial = 0;
  x.general = (field, credits, source = 'official') => {
    const row = x.add(`h37-general-${++serial}`, '一般教育', field, '選択必修', credits);
    if (source === 'planner') x.items.push(item(row.offering, 'earned'));
    else x.rows.push({ ...x.row, id: `h37-official-${serial}`, fingerprint: `h37-source-${serial}`, rawName: row.course.canonicalName,
      curriculumCourseId: row.course.id, candidateCurriculumCourseIds: [row.course.id], courseId: row.offering.courseId,
      compositionCredits: credits, earnedCreditsTotal: credits, schoolingCreditsTotal: 0 });
    return row;
  };
  x.progress = (selection = 'not_selected', records = [], input = x.build()) =>
    calculateGraduationProgress(x.items, input, x.scope, [], selection, records, x.rows, x.profile);
  return x;
}
const h37General = p => h31Card(p, 'group-general');
function assertH37(p, earned) {
  const general = h37General(p), reference = creditReference(p, 'overall-reference-progress');
  assert.deepEqual([general.earned, general.status, general.coverageStatus], [earned, 'unknown', 'unknown']);
  assert.match(general.reason, /一般教育の認定情報が未確認.*0単位認定とは扱いません/);
  assert.equal(reference.status, 'unknown'); assert.equal(reference.coverageStatus, 'unknown');
  assert.equal(p.graduationCheckComplete, false);
}
for (const [key, field] of h37Fields) for (const source of ['official', 'planner', 'mixed']) {
  test(`H37 ${field}/${source}: known4 survives unknown recognition below minimum8`, () => {
    const x = h37Fixture();
    if (source === 'mixed') { x.general(field, 2); x.general(field, 2, 'planner'); }
    else x.general(field, 4, source);
    x.profile.recognizedCredits.general[key] = { mode: 'unknown', credits: null };
    assert.equal(graduationProfileValidationError(x.profile), null);
    const p = x.progress(); assertH37(p, 4);
    const detail = h37General(p).details.find(d => d.label === field);
    assert.deepEqual([detail.earned, detail.target, detail.reason], [4, 8, '認定情報未確認']);
    assert.equal(overall(p), 4); assert.equal(p.referenceProgress[0].target, 124);
    assert.match(p.referenceProgress[0].reason, /一般教育の認定情報が未確認/);
  });
}
for (const total of [null, 16]) test(`H37 known recognition8+8 and unknown natural coexist once / aggregate${total}`, () => {
  const x = h37Fixture(); x.general('自然', 4);
  x.profile.recognizedCredits.general = { humanities: { mode: 'recognized', credits: 8 }, social: { mode: 'recognized', credits: 8 }, natural: { mode: 'unknown', credits: null } };
  x.profile.recognizedCredits.totalCredits = total;
  assert.equal(graduationProfileValidationError(x.profile), null);
  const p = x.progress(); assertH37(p, 20);
  assert.deepEqual(h37General(p).details.map(d => d.earned), [8, 8, 4]);
  assert.equal(overall(p), 20); assert.equal(p.referenceProgress[0].recognizedCredits, 16);
});
test('H37 capped total36 does not satisfy unknown field minimum4/8', () => {
  const x = h37Fixture(); x.general('人文', 16); x.general('社会', 16); x.general('自然', 4);
  x.profile.recognizedCredits.general.natural = { mode: 'unknown', credits: null };
  const p = x.progress(); assertH37(p, 36);
  assert.deepEqual(h37General(p).details.map(d => d.earned), [16, 16, 4]); assert.equal(overall(p), 36);
});
for (const credits of [12, 16]) test(`H37 known field${credits} x3 meets all conditions despite unknown recognition`, () => {
  const x = h37Fixture();
  for (const [key, field] of h37Fields) { x.general(field, credits); x.profile.recognizedCredits.general[key] = { mode: 'unknown', credits: null }; }
  const p = x.progress(), general = h37General(p);
  assert.deepEqual([general.earned, general.status, general.reason], [36, 'satisfied', null]);
  assert.ok(general.details.every(d => d.earned === credits && !d.reason));
  assert.deepEqual([overall(p), p.referenceProgress[0].target, p.referenceProgress[0].status, p.referenceProgress[0].reason], [36, 124, 'partial', null]);
});
for (const total of [null, 18]) test(`H37 Open University10 goes only to total, once / aggregate${total}`, () => {
  const x = h37Fixture(); x.general('人文', 4);
  x.profile.recognizedCredits.general.social = { mode: 'recognized', credits: 8 };
  x.profile.recognizedCredits.general.natural = { mode: 'unknown', credits: null };
  x.profile.recognizedCredits.openUniversityCredits = 10; x.profile.recognizedCredits.totalCredits = total;
  assert.equal(graduationProfileValidationError(x.profile), null);
  const p = x.progress(); assertH37(p, 22);
  assert.deepEqual(h37General(p).details.map(d => d.earned), [4, 8, 0]);
  assert.equal(overall(p), 22); assert.equal(p.referenceProgress[0].recognizedCredits, 18);
});
test('H37 Open University retains cap36 while an unknown field minimum stays held', () => {
  const x = h37Fixture(); x.general('人文', 16); x.general('社会', 12);
  x.profile.recognizedCredits.general.natural = { mode: 'unknown', credits: null };
  x.profile.recognizedCredits.openUniversityCredits = 10;
  const p = x.progress(); assertH37(p, 36); assert.equal(overall(p), 36);
  assert.equal(h37General(p).details[2].earned, 0);
});
test('H37 individual field exemption relieves minimum without supplying8 earned', () => {
  const x = h37Fixture(); x.general('社会', 4);
  x.profile.recognizedCredits.general.humanities = { mode: 'exempt', credits: null };
  x.profile.recognizedCredits.general.natural = { mode: 'unknown', credits: null };
  const p = x.progress(); assertH37(p, 4);
  assert.equal(h37General(p).details[0].earned, 8, 'existing detail expresses requirement relief');
  assert.equal(overall(p), 4, 'exempt detail8 is never added to the graduation total');
});
test('H37 all-exempt behavior keeps earned0 and ignores Open University overlay', () => {
  const x = h37Fixture(); x.profile.admissionType = 'bachelor_admission'; x.general('社会', 4);
  for (const [key] of h37Fields) x.profile.recognizedCredits.general[key] = { mode: 'exempt', credits: null };
  x.profile.recognizedCredits.openUniversityCredits = 10;
  const p = x.progress();
  assert.deepEqual([h37General(p).earned, h37General(p).status], [0, 'satisfied']);
  assert.equal(overall(p), 0); assert.equal(p.referenceProgress[0].target, 82); assert.equal(p.referenceProgress[0].exemptionCredits, 42);
});
for (const selection of ['selected', 'not_selected', 'undecided']) test(`H37 overall keeps general4 + professional4 with law thesis ${selection}`, () => {
  const x = h37Fixture('法律学科'); x.general('人文', 4);
  x.profile.recognizedCredits.general.humanities = { mode: 'unknown', credits: null };
  x.items.push(item(x.offering, 'earned'));
  const p = x.progress(selection); assertH37(p, 4);
  assert.deepEqual([overall(p), p.referenceProgress[0].target], [8, selection === 'undecided' ? null : selection === 'selected' ? 124 : 128]);
  assert.match(p.referenceProgress[0].reason, selection === 'undecided' ? /卒業論文の選択が未定/ : /一般教育の認定情報が未確認/);
});
for (const [label, setup, reason] of [
  ['curriculum unknown', x => { x.profile.curriculumApplicability = 'unknown'; }, /適用課程が未確認/],
  ['legacy curriculum', x => { x.profile.curriculumApplicability = 'legacy_or_transition'; }, /旧課程・経過措置/],
  ['invalid recognition', x => { x.profile.recognizedCredits.openUniversityCredits = 11; }, /認定単位の入力/],
  ['missing transfer recognition', x => { x.profile.recognizedCredits.schoolingEquivalentCredits = null; }, /認定単位合計または公式/],
]) test(`H37 preserves independent reference-wide ${label} hold and priority`, () => {
  const x = h37Fixture(); x.general('人文', 4); x.profile.recognizedCredits.general.humanities = { mode: 'unknown', credits: null }; setup(x);
  const p = x.progress(); assertH37(p, label === 'legacy curriculum' ? 0 : label === 'invalid recognition' ? 15 : 4);
  assert.deepEqual([overall(p), p.referenceProgress[0].target], [null, null]); assert.match(p.referenceProgress[0].reason, reason);
});
test('H37 known zero is a lower bound with unknown increment, not confirmed zero recognition', () => {
  const x = h37Fixture(); x.profile.recognizedCredits.general.humanities = { mode: 'unknown', credits: null };
  const p = x.progress(); assertH37(p, 0); assert.equal(overall(p), 0); assert.equal(p.referenceProgress[0].target, 124);
  x.profile.recognizedCredits.general.humanities = { mode: 'none', credits: null };
  const none = x.progress(); assert.deepEqual([h37General(none).earned, h37General(none).status], [0, 'unsatisfied']);
  assert.equal(none.referenceProgress[0].status, 'partial');
});
test('H37 first-year unknown recognition retains ordinary calculation without new holds', () => {
  const x = h37Fixture(); x.profile.admissionType = 'first_year'; x.general('人文', 4);
  x.profile.recognizedCredits.general.humanities = { mode: 'unknown', credits: null };
  const p = x.progress(); assert.deepEqual([h37General(p).earned, h37General(p).status, h37General(p).reason], [4, 'unsatisfied', null]);
  assert.equal(p.referenceProgress[0].status, 'partial');
});
test('H37 official authority survives annual Offering removal and ignores component40', () => {
  const x = h37Fixture(); x.general('人文', 4); x.profile.recognizedCredits.general.humanities = { mode: 'unknown', credits: null };
  const row = x.rows[0], input = x.build(); input.offerings = []; input.curriculum.offeringRelations = [];
  const records = [{ id: 'h37-component', fingerprint: 'h37-component', source: 'hosei_import', sourceCourseId: row.id,
    rawName: row.rawName, method: 'correspondence', rawTerm: 'T', credits: 40, grade: 'A', rawYear: '2026', date: null, term: null }];
  const snapshot = structuredClone({ profile: x.profile, rows: x.rows, records, input });
  const p = x.progress('not_selected', records, input); assertH37(p, 4); assert.equal(overall(p), 4);
  assert.equal(p.importedContributionCount, 1); assert.deepEqual({ profile: x.profile, rows: x.rows, records, input }, snapshot);
  assert.equal(initialState().schemaVersion, 22); assert.equal(input.metadata.sourceLinksReverified, false);
});
test('H37 official/Planner duplicate contributes once and H38 foreign4/Snull stays held', () => {
  const x = h37Fixture(); const row = x.general('人文', 4); x.items.push(item(row.offering, 'earned'));
  x.profile.recognizedCredits.general.humanities = { mode: 'unknown', credits: null };
  x.profile.recognizedCredits.foreignLanguage = { mode: 'recognized', credits: 4, language: 'english', schoolingEquivalentCredits: null };
  const p = x.progress(); assertH37(p, 4); assert.equal(overall(p), 8);
  assert.deepEqual([h31Card(p, 'group-foreign').earned, h31Card(p, 'group-foreign').status], [4, 'unknown']);
  assert.match(h31Card(p, 'group-foreign').reason, /スクーリング相当認定単位が未確認/);
});
test('H37 H41/H42/H43 official holds and schooling quantities retain their existing boundary', () => {
  const x = h37Fixture(); x.general('人文', 4); x.general('社会', 4);
  x.rows[1].earnedCreditsTotal = null; x.rows[1].schoolingCreditsTotal = 2;
  x.profile.recognizedCredits.general.humanities = { mode: 'unknown', credits: null };
  const p = x.progress(); assertH37(p, 4); assert.equal(overall(p), 4);
  assert.equal(h31Card(p, 'group-foreign').status, 'unsatisfied'); assert.equal(h31Card(p, 'group-physical').status, 'unsatisfied');
  assert.doesNotMatch(h31Card(p, 'group-physical').reason ?? '', /公式実績の算入を保留/);
  assert.match(p.referenceProgress[0].reason, /一般教育の認定情報が未確認.*公式実績の算入を保留/);
  assert.deepEqual([p.referenceProgress[1].earned, p.referenceProgress[1].target, p.referenceProgress[1].status], [null, 30, 'unknown']);
  assert.match(p.referenceProgress[1].reason, /公式実績のスクーリング証拠/);
});

// H37 review follow-up: meeting all field minima does not settle total36.
for (const values of [[8, 8, 8], [12, 8, 8]]) for (const [unknownKey] of h37Fields) for (const source of ['official', 'planner']) {
  const earned = values.reduce((sum, credits) => sum + credits, 0);
  test(`H37 total-only uncertainty ${values.join('/')} / ${unknownKey} / ${source} keeps lower bound${earned}`, () => {
    const x = h37Fixture();
    h37Fields.forEach(([, field], index) => x.general(field, values[index], source));
    x.profile.recognizedCredits.general[unknownKey] = { mode: 'unknown', credits: null };
    assert.equal(graduationProfileValidationError(x.profile), null);
    const p = x.progress(); assertH37(p, earned);
    assert.deepEqual(h37General(p).details.map(d => d.earned), values);
    assert.ok(h37General(p).details.every(d => !d.reason), 'met field minima need no recognition hold');
    assert.deepEqual([overall(p), p.referenceProgress[0].target, p.referenceProgress[0].recognizedCredits], [earned, 124, 0]);
    assert.match(p.referenceProgress[0].reason, /一般教育の認定情報が未確認/);
    assert.equal(initialState().schemaVersion, 22); assert.equal(x.f.metadata.sourceLinksReverified, false);
  });
}
for (const credits of [0, 4, 12]) test(`H37 total-only hold uses known recognition${credits} once and releases at36`, () => {
  const x = h37Fixture(); h37Fields.forEach(([, field]) => x.general(field, 8));
  x.profile.recognizedCredits.general.humanities = { mode: 'unknown', credits: null };
  x.profile.recognizedCredits.general.social = { mode: 'recognized', credits };
  x.profile.recognizedCredits.totalCredits = credits;
  const p = x.progress(), earned = 24 + credits;
  assert.deepEqual(h37General(p).details.map(d => d.earned), [8, 8 + credits, 8]);
  assert.ok(h37General(p).details.every(d => !d.reason));
  if (earned < 36) assertH37(p, earned);
  else assert.deepEqual([h37General(p).earned, h37General(p).status, h37General(p).reason], [36, 'satisfied', null]);
  assert.deepEqual([overall(p), p.referenceProgress[0].target, p.referenceProgress[0].status], [earned, 124, earned < 36 ? 'unknown' : 'partial']);
});
for (const openUniversity of [0, 8]) test(`H37 total-only hold uses safe Open University${openUniversity} before deciding completion`, () => {
  const x = h37Fixture(); [12, 8, 8].forEach((credits, index) => x.general(h37Fields[index][1], credits));
  x.profile.recognizedCredits.general.natural = { mode: 'unknown', credits: null };
  x.profile.recognizedCredits.openUniversityCredits = openUniversity;
  const p = x.progress(), earned = 28 + openUniversity;
  assert.deepEqual(h37General(p).details.map(d => d.earned), [12, 8, 8]);
  if (earned < 36) assertH37(p, earned);
  else assert.deepEqual([h37General(p).earned, h37General(p).status, h37General(p).reason], [36, 'satisfied', null]);
  assert.deepEqual([overall(p), p.referenceProgress[0].status], [earned, earned < 36 ? 'unknown' : 'partial']);
});
for (const admission of ['other_transfer', 'first_year']) test(`H37 total24 with confirmed none stays unsatisfied for ${admission}`, () => {
  const x = h37Fixture(); x.profile.admissionType = admission; h37Fields.forEach(([, field]) => x.general(field, 8));
  if (admission === 'first_year') x.profile.recognizedCredits.general.humanities = { mode: 'unknown', credits: null };
  const p = x.progress();
  assert.deepEqual([h37General(p).earned, h37General(p).status, h37General(p).reason], [24, 'unsatisfied', null]);
  assert.deepEqual([overall(p), p.referenceProgress[0].status], [24, 'partial']);
});

// H41: official candidate edges describe uncertainty, never earned allocations.
function h41Fixture(department = '法律学科') {
  const x = h31Fixture(department); x.items = [];
  x.rows = []; x.records = [];
  x.official = (entry, earned = null, schooling = 0) => ({ ...x.row,
    id: `h41-${entry.course.id}`, fingerprint: `h41-${entry.course.id}`, rawName: entry.course.canonicalName,
    curriculumCourseId: entry.course.id, candidateCurriculumCourseIds: [entry.course.id], courseId: null,
    earnedCreditsTotal: earned, compositionCredits: entry.course.curriculumCredits, schoolingCreditsTotal: schooling });
  x.progress = (input = x.build(), rows = x.rows, items = x.items) => calculateGraduationProgress(items, input, x.scope, [], 'not_selected', x.records, rows, x.profile);
  x.requirement = (id, target, conditions = null, ruleType = 'min_credits') => {
    const rule = { ...catalog.requirements.find(r => r.status === 'structured' && r.ruleType === 'min_credits'),
      id: `41414141-4141-4141-8141-${x.f.requirements.length.toString(16).padStart(12, '0')}`, ruleId: id, scopeId: x.scope, value: 12, target, conditions, ruleType };
    x.f.requirements.push(rule); return rule;
  };
  return x;
}
const h41Reason = /公式実績の算入を保留/;
const h41Affected = p => p.cards.filter(c => h41Reason.test(c.reason ?? '')).map(c => c.requirementId).sort();
function h41Assert(x, affected, p = x.progress(), baseline = x.progress(undefined, [])) {
  affected = affected.filter(id => baseline.cards.some(c => c.requirementId === id));
  assert.deepEqual(h41Affected(p), [...affected].sort());
  for (const id of affected) {
    const before = h31Card(baseline, id), after = h31Card(p, id);
    assert.equal(after.status, 'unknown', id); assert.equal(after.earned, before.earned, id);
    assert.equal(after.target, before.target, id);
  }
  assert.equal(overall(p), overall(baseline));
  assert.equal(p.referenceProgress[0].status, 'unknown');
  assert.equal(p.referenceProgress[0].target, baseline.referenceProgress[0].target);
  assert.match(p.referenceProgress[0].reason, h41Reason);
}
for (const [category, field, name, id] of [
  ['一般教育', '人文', '制度人文', 'group-general'], ['一般教育', '社会', '制度社会', 'group-general'],
  ['一般教育', '自然', '制度自然', 'group-general'], ['外国語', '英語', '英語１', 'group-foreign'],
  ['保健体育', null, '健康・スポーツ科学概論', 'group-physical'],
]) test(`H41 common ${category}/${field}: only intersecting ordinary bucket gets official reason`, () => {
  const x = h41Fixture(); const held = x.add('h41-common', category, field, '選択必修', 4, 'correspondence', name);
  x.rows = [x.official(held)]; h41Assert(x, [id]);
  const p = x.progress();
  assert.equal(h31Card(p, 'group-foreign').status, category === '外国語' ? 'unknown' : 'unsatisfied');
  assert.equal(h31Card(p, 'professional-law-schooling').status, 'unsatisfied');
  assert.deepEqual([p.referenceProgress[1].earned, p.referenceProgress[1].status], [0, 'partial']);
});
for (const [dept, prefix, types] of [
  ['法律学科', 'law-', ['選択必修', '選択']], ['日本文学科', '', ['必修', '選択必修', '選択']],
  ['史学科', 'history-', ['必修', 'スクーリング選択必修', '選択']],
  ['地理学科', 'geography-', ['必修', 'スクーリング必修', '選択必修', '選択']],
  ['経済学科', 'economics-', ['選択必修', '選択']], ['商業学科', 'commerce-', ['選択必修', '選択']],
]) for (const type of types) test(`H41 professional ${dept}/${type}: bucket and total/overflow closure`, () => {
  const x = h41Fixture(dept), held = x.add('h41-pro', '専門教育', null, type, 4, 'correspondence', '保留制度科目', x.scope);
  x.rows = [x.official(held)];
  const suffix = { 必修: 'required', 選択必修: 'required-elective', 選択: 'elective', スクーリング必修: 'schooling-required', スクーリング選択必修: 'schooling-required-elective' }[type];
  const affected = [`professional-${prefix}${suffix}`];
  if (type === '選択必修' && ['法律学科', '日本文学科', '地理学科'].includes(dept)) affected.push(`professional-${prefix}elective`);
  if (dept !== '史学科') affected.push(`professional-${dept === '日本文学科' ? 'japanese-' : prefix}total`);
  if (dept === '史学科' && type === 'スクーリング選択必修') affected.push('professional-history-elective', 'history-seminar-required-elective', 'history-seminar-elective');
  h41Assert(x, affected);
});
test('H41 structured category/field/type/names and dependent totals intersect only institutional destinations', () => {
  const x = h41Fixture(), held = x.add('h41-named', '専門教育', null, '選択必修', 4, 'correspondence', '制度上の保留科目', x.scope);
  x.rows = [x.official(held), x.official(x, 4)];
  const targets = [
    ['h41-category', { curriculum_category: '専門教育' }, true],
    ['h41-type', { curriculum_category: '専門教育', requirement_type: '選択必修' }, true],
    ['h41-overflow', { curriculum_category: '専門教育', requirement_type: '選択' }, true],
    ['h41-name', { course_name: held.course.canonicalName }, true],
    ['h41-names', { course_names: ['別科目', held.course.canonicalName] }, true],
    ['h41-other', { curriculum_category: '保健体育' }, false],
    ['h41-field', { curriculum_category: '一般教育', curriculum_field: '自然' }, false],
    ['h41-other-name', { course_name: x.course.canonicalName }, false],
  ];
  for (const row of targets) { const rule = x.requirement(row[0], row[1]); row.push(rule.id); }
  const input = x.build(); input.offerings = []; input.curriculum.offeringRelations = [];
  const p = x.progress(input), baseline = x.progress(input, [x.rows[1]]);
  for (const [id, , affected, ruleId] of targets) {
    const row = p.requirements.find(r => r.requirementId === ruleId), before = baseline.requirements.find(r => r.requirementId === ruleId);
    assert.equal(h41Reason.test(row.reason ?? ''), affected, id);
    if (!affected) assert.deepEqual(row, before, id);
    else { assert.equal(row.status, 'unknown'); assert.equal(row.target, 12); assert.equal(row.earned, id.includes('name') ? 0 : before.earned); }
  }
  assert.equal(overall(p), 4);
});
test('H41 multiple safe Mapping candidates hold their union without allocating either budget', () => {
  const x = h41Fixture(), general = x.add('h41-union', '一般教育', '自然', '選択必修');
  const edge = { ...x.mapping, mappingId: '41414141-4141-4141-8141-000000000001' };
  x.f.mappings.push(edge); general.course.mappingIds.push(edge.mappingId); general.course.scopeIds.push(x.scope);
  x.rows = [x.official(general, 4)];
  h41Assert(x, ['group-general', 'professional-law-required-elective', 'professional-law-elective', 'professional-law-total']);
  const facts = deriveOfficialGraduationFacts(x.rows, [], x.f, x.scope, x.profile);
  assert.equal(facts.facts[0].allocation.reason, 'mapping_conflict'); assert.equal(facts.allocations.length, 0);
  x.f.mappings.reverse(); general.course.mappingIds.reverse(); x.f.curriculum.courses.reverse();
  assert.equal(overall(x.progress()), 0);
});
for (const mode of ['missing-edge', 'missing-all', 'bad-scope', 'bad-category', 'bad-type', 'bad-field', 'bad-flag', 'bad-credit', 'credit-mismatch', 'duplicate-owner', 'duplicate-map', 'stale-source', 'legacy-profile', 'unresolved-identity']) {
  test(`H41 unsafe ${mode}: global fallback and known4 survive`, () => {
    const x = h41Fixture(), held = x.add('h41-unsafe', '専門教育', null, '選択', 4, 'correspondence', '保留科目', x.scope);
    x.rows = [x.official(x, 4), x.official(held)]; const input = x.build();
    const m = input.mappings.find(m => m.mappingId === held.mapping.mappingId), c = input.curriculum.courses.find(c => c.id === held.course.id);
    if (mode === 'missing-edge') c.mappingIds.push('missing');
    if (mode === 'missing-all') c.mappingIds = ['missing'];
    if (mode === 'bad-scope') { m.scopeId = 'invalid'; x.rows.push({ ...x.rows[1], id: 'duplicate' }); }
    if (mode === 'bad-category') m.category = '不明';
    if (mode === 'bad-type') m.requirementType = '必修';
    if (mode === 'bad-field') m.field = 123;
    if (mode === 'bad-flag') m.schoolingOnly = 'unknown';
    if (mode === 'bad-credit') m.curriculumCredits = -1;
    if (mode === 'credit-mismatch') m.curriculumCredits = null;
    if (mode === 'duplicate-owner') input.curriculum.courses.push({ ...c, id: 'another-owner' });
    if (mode === 'duplicate-map') input.mappings.push({ ...m });
    if (mode === 'stale-source') input.curriculum.source = 'official_curriculum_mappings_2027';
    if (mode === 'legacy-profile') x.profile.curriculumApplicability = 'legacy_or_transition';
    if (mode === 'unresolved-identity') { x.rows[1].curriculumCourseId = null; x.rows[1].curriculumMatch = 'unmatched'; }
    input.offerings = []; input.curriculum.offeringRelations = [];
    const p = x.progress(input);
    for (const c of p.cards.filter(c => c.ruleType !== 'thesis_progress' && c.requirementId !== 'professional-law-schooling')) assert.match(c.reason, h41Reason, c.requirementId);
    // H42 handles S separately: explicit S0 is unaffected, duplicate unresolved S is held.
    const lawS = h31Card(p, 'professional-law-schooling');
    assert.equal(lawS.status, mode === 'bad-scope' ? 'unknown' : 'unsatisfied');
    assert.doesNotMatch(lawS.reason ?? '', h41Reason);
    // Legacy profile has its independent reference-wide guard and allocation hold.
    assert.equal(overall(p), mode === 'legacy-profile' ? null : 4);
    assert.equal(p.referenceProgress[0].status, 'unknown');
  });
}
for (const values of [[4, 4], [4, 8], [null, 4], [null, null]]) test(`H41 duplicate ${values}: exact destination survives unresolved amount`, () => {
  const x = h41Fixture(), held = x.add('h41-duplicate', '専門教育', null, '選択', 4, 'correspondence', '重複科目', x.scope);
  x.rows = values.map((value, i) => ({ ...x.official(held, value), id: `h41-duplicate-${i}` }));
  const f = deriveOfficialGraduationFacts(x.rows, [], x.f, x.scope, x.profile);
  assert.equal(f.facts[0].earnedCreditsTotal, null); assert.equal(f.allocations.length, 0);
  h41Assert(x, ['professional-law-elective', 'professional-law-total']);
});
for (const mode of ['amount-null', 'institutional-credits-null', 'row-composition-mismatch']) test(`H41 metadata ${mode}: unknown amount does not erase safe destination`, () => {
  const x = h41Fixture(); x.rows = [x.official(x, mode === 'amount-null' ? null : 4)];
  if (mode === 'institutional-credits-null') { x.course.curriculumCredits = null; x.mapping.curriculumCredits = null; }
  if (mode === 'row-composition-mismatch') x.rows[0].compositionCredits = 9;
  h41Assert(x, ['professional-law-required-elective', 'professional-law-elective', 'professional-law-total']);
});
test('H41 orphan: raw name, annual exact match and component40 cannot restore official authority', () => {
  const x = h41Fixture(); x.rows = [x.official(x, 4)];
  x.records = [{ id: 'orphan', sourceCourseId: 'missing', source: 'hosei_import', rawName: x.course.canonicalName,
    method: 'schooling', credits: 40, offeringId: x.offering.id, earnedCreditsTotal: 40, schoolingCreditsTotal: 40 }];
  const p = x.progress(); assert.equal(overall(p), 4);
  for (const c of p.cards.filter(c => c.ruleType !== 'thesis_progress' && c.requirementId !== 'professional-law-schooling')) assert.match(c.reason, h41Reason);
  assert.match(h31Card(p, 'professional-law-schooling').reason, /公式実績のスクーリング/);
  x.rows = []; assert.equal(overall(x.progress()), null, 'H40 quantity uncertainty remains');
});
for (const mode of ['zero', 'zero-duplicate', 'zero-conflict', 'outside']) test(`H41 ${mode}: no new current hold`, () => {
  const x = h41Fixture(); x.rows = [x.official(x, 0)];
  if (mode === 'zero-duplicate') x.rows.push({ ...x.rows[0], id: 'other-zero' });
  if (mode === 'zero-conflict') x.course.mappingIds.push('missing');
  if (mode === 'outside') {
    x.mapping.scopeId = catalog.programs.find(p => p.department === '経済学科').scopeId;
    x.course.scopeIds = [x.mapping.scopeId]; x.rows[0].earnedCreditsTotal = 4;
  }
  const input = x.f; input.offerings = []; input.curriculum.offeringRelations = [];
  const p = x.progress(input), baseline = x.progress(input, []);
  assert.deepEqual(p.cards, baseline.cards); assert.deepEqual(p.requirements, baseline.requirements);
  assert.deepEqual(p.referenceProgress, baseline.referenceProgress);
});
test('H41 known elective12 stays12, overall12/target128 unknown, held budgets excluded', () => {
  const x = h41Fixture();
  for (let i = 0; i < 4; i++) {
    const entry = x.add(`elective${i}`, '専門教育', null, '選択', 4, 'correspondence', `制度選択${i}`, x.scope);
    x.rows.push(x.official(entry, i === 3 ? null : 4));
  }
  const p = x.progress(), c = h31Card(p, 'professional-law-elective');
  assert.equal(c.earned, 12); assert.equal(c.status, 'unknown');
  assert.deepEqual([overall(p), p.referenceProgress[0].target, p.referenceProgress[0].status], [12, 128, 'unknown']);
  assert.equal(p.importedContributionCount, 3);
});
test('H41/H42/H43: ordinary and schooling holds localize while held S2 remains unallocated', () => {
  const x = h41Fixture(); x.rows = [x.official(x, null, 2)];
  const p = x.progress();
  assert.equal(h31Card(p, 'group-general').status, 'unsatisfied');
  assert.equal(h31Card(p, 'group-physical').status, 'unsatisfied');
  assert.equal(h31Card(p, 'group-foreign').status, 'unsatisfied');
  for (const id of ['professional-law-schooling']) {
    const c = h31Card(p, id); assert.equal(c.status, 'unknown');
    assert.match(c.reason, /公式実績のスクーリング算入条件/); assert.doesNotMatch(c.reason, h41Reason);
  }
  const f = deriveOfficialGraduationFacts(x.rows, [], x.f, x.scope, x.profile);
  assert.equal(f.facts[0].schoolingEvidence.credits, 2); assert.equal(f.allocations.length, 0);
  assert.equal(p.referenceProgress[1].earned, null); assert.equal(p.referenceProgress[1].status, 'unknown');
  assert.equal(overall(p), 0); assert.equal(p.referenceProgress[0].status, 'unknown');
});
test('H41/H31 coexist independently with existing reason priority and no candidate90 or held credits', () => {
  const x = h41Fixture(), common = x.add('h41-h31', '一般教育', '自然', '選択必修');
  x.set(common, x); x.items = [item(x.candidate, 'earned')]; x.rows = [x.official(x)];
  const p = x.progress();
  assert.match(h31Card(p, 'group-general').reason, /対応関係を確認中/);
  assert.doesNotMatch(h31Card(p, 'group-general').reason, h41Reason);
  assert.match(h31Card(p, 'professional-law-total').reason, /対応関係を確認中.*公式実績の算入を保留/);
  assert.match(p.referenceProgress[0].reason, /対応関係を確認中.*公式実績の算入を保留/);
  assert.equal(overall(p), 0);
});
for (const [dept, name] of [['日本文学科', '書道実技'], ['史学科', '歴史資料学'], ['法律学科', '法律学演習'], ['地理学科', '現地研究（不明）'], ['法律学科', '公開科目'], ['法律学科', '旧課程科目']]) {
  test(`H41 special ${name}: unknown dependency stays globally held without changing family allocation`, () => {
    const x = h41Fixture(dept), held = x.add('special', '専門教育', null, '選択', 4, 'correspondence', name, x.scope);
    x.rows = [x.official(held, 4)]; const p = x.progress();
    assert.match(h31Card(p, 'group-general').reason, h41Reason); assert.equal(overall(p), null);
    assert.equal(deriveOfficialGraduationFacts(x.rows, [], x.f, x.scope, x.profile).allocations.length, 0);
  });
}
for (const [name, types, field] of [
  ['現地研究', ['schooling-required', 'elective'], null],
  ['地誌学特講', ['required-elective', 'elective'], '地誌・その他の分野'],
  ['人文地理学演習', ['schooling-required', 'required-elective', 'elective'], '人文地理の分野'],
  ['自然地理学演習', ['schooling-required', 'required-elective', 'elective'], '自然地理の分野'],
  ['人文地理学特講', ['elective'], null],
]) test(`H41 geography ${name}: existing staged destinations hold without new special allocation`, () => {
  const x = h41Fixture('地理学科'), held = x.add('transfer', '専門教育', field, '選択', 4, 'schooling', name, x.scope);
  x.rows = [x.official(held, 4)];
  h41Assert(x, [...types.map(type => `professional-geography-${type}`), 'professional-geography-total']);
  assert.equal(deriveOfficialGraduationFacts(x.rows, [], x.f, x.scope, x.profile).allocations.length, 0);
});
test('H41 history overview holds required, schooling-required-elective, elective and seminar transfer dependencies', () => {
  const x = h41Fixture('史学科'), held = x.add('overview', '専門教育', '日本史の分野', '必修', 4, 'schooling', '日本史概説', x.scope);
  x.rows = [x.official(held, 4)];
  h41Assert(x, ['professional-history-required', 'professional-history-schooling-required-elective', 'professional-history-elective', 'history-seminar-required-elective', 'history-seminar-elective']);
});
test('H41 official authority and immutable inputs survive removed Offerings, forged display names and component40', () => {
  const x = h41Fixture(), common = x.add('general', '一般教育', '自然', '選択必修');
  x.rows = [x.official(x, 4), x.official(common)];
  x.records = [{ id: 'component', sourceCourseId: x.rows[1].id, source: 'hosei_import', method: 'schooling', credits: 40, rawName: '専門教育へ偽装' }];
  const input = x.build(); input.offerings = []; input.curriculum.offeringRelations = [];
  const previous = x.progress(input), snapshot = structuredClone({ input, rows: x.rows, records: x.records, profile: x.profile, previous });
  deepFreeze(input); deepFreeze(x.rows); deepFreeze(x.records); deepFreeze(x.profile); deepFreeze(previous);
  const next = x.progress(input);
  assert.deepEqual({ input, rows: x.rows, records: x.records, profile: x.profile, previous }, snapshot);
  assert.deepEqual(next, previous); assert.equal(overall(next), 4);
  assert.deepEqual(h41Affected(next), ['group-general']);
  assert.equal(initialState().schemaVersion, 22); assert.equal(next.graduationCheckComplete, false);
  assert.equal(input.metadata.graduationCheckComplete, false); assert.equal(input.metadata.sourceLinksReverified, false);
});

test('H41 structured field intersection distinguishes natural from humanities while holding the category total', () => {
  const x = h41Fixture(), held = x.add('natural-target', '一般教育', '自然', '選択必修');
  x.rows = [x.official(held)];
  const natural = x.requirement('natural', { curriculum_category: '一般教育', curriculum_field: '自然' });
  const humanities = x.requirement('humanities', { curriculum_category: '一般教育', curriculum_field: '人文' });
  const total = x.requirement('general-total', { curriculum_category: '一般教育' });
  const p = x.progress(), baseline = x.progress(undefined, []);
  for (const rule of [natural, total]) assert.match(p.requirements.find(r => r.requirementId === rule.id).reason, h41Reason);
  assert.deepEqual(p.requirements.find(r => r.requirementId === humanities.id), baseline.requirements.find(r => r.requirementId === humanities.id));
});
test('H41 method uncertainty uses no annual method; unsupported condition reason keeps priority and H42 structured S localizes', () => {
  const x = h41Fixture(); x.rows = [x.official(x)];
  const methodRules = ['schooling', 'correspondence'].map(method => x.requirement(`method-${method}`, { curriculum_category: '専門教育' }, { method }));
  const unrelated = x.requirement('unrelated-method', { curriculum_category: '一般教育' }, { method: 'schooling' });
  const schooling = x.requirement('unrelated-schooling', { curriculum_category: '保健体育' }, null, 'min_schooling_credits');
  const input = x.build(), p = x.progress(input);
  const facts = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile).facts;
  const impact = unresolvedOfficialImpact(facts, false, input, x.scope, x.profile);
  for (const rule of methodRules) {
    assert.equal(officialImpactsRequirement(impact, rule), true);
    assert.match(p.requirements.find(r => r.requirementId === rule.id).reason, /条件または例外.*公式実績の算入を保留/);
  }
  assert.equal(officialImpactsRequirement(impact, unrelated), false);
  const schoolRow = p.requirements.find(r => r.requirementId === schooling.id);
  assert.deepEqual([schoolRow.status, schoolRow.earned, schoolRow.reason], ['unsatisfied', 0, null]);
  input.offerings.forEach(o => { o.name = '偽の科目'; o.method = o.method === 'schooling' ? 'correspondence' : 'schooling'; o.credits = 99; });
  assert.deepEqual(x.progress(input), p);
});
for (const mode of ['missing-candidate', 'extra-candidate', 'duplicate-candidate', 'stale-name', 'stale-course', 'stale-schema']) test(`H41 retained fact ${mode}: malformed metadata forces global fallback`, () => {
  const x = h41Fixture(); x.rows = [x.official(x)];
  const input = x.build(), facts = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile).facts;
  if (mode === 'missing-candidate') facts[0].candidateMappingIds = [];
  if (mode === 'extra-candidate') facts[0].candidateMappingIds.push('missing');
  if (mode === 'duplicate-candidate') facts[0].candidateMappingIds.push(x.mapping.mappingId);
  if (mode === 'stale-name') facts[0].canonicalName = '年次名から推定不可';
  if (mode === 'stale-course') facts[0].curriculumCourseId = 'missing';
  if (mode === 'stale-schema') input.curriculum.schemaVersion = 2;
  const snapshot = structuredClone({ input, facts }); deepFreeze(input); deepFreeze(facts);
  assert.equal(unresolvedOfficialImpact(facts, false, input, x.scope, x.profile).globalUnknown, true);
  assert.deepEqual({ input, facts }, snapshot);
});
test('H41 valid outside edges and diagnostic scopeIds do not expand a current elective hold', () => {
  const x = h41Fixture(), held = x.add('selected', '専門教育', null, '選択', 4, 'correspondence', '複数学科科目', x.scope);
  const other = { ...held.mapping, mappingId: '41414141-4141-4141-8141-000000000099', scopeId: catalog.programs.find(p => p.department === '経済学科').scopeId };
  x.f.mappings.push(other); held.course.mappingIds.push(other.mappingId); held.course.scopeIds.push(other.scopeId);
  x.rows = [x.official(held)]; const input = x.build();
  input.curriculum.courses.find(c => c.id === held.course.id).scopeIds = ['diagnostic-only'];
  h41Assert(x, ['professional-law-elective', 'professional-law-total'], x.progress(input), x.progress(input, []));
});
for (const selection of ['selected', 'not_selected', 'undecided']) test(`H41/H36 law thesis ${selection}: known4, independent target and reason priority retained`, () => {
  const x = h41Fixture(), held = x.add('held', '専門教育', null, '選択', 4, 'correspondence', '保留科目', x.scope);
  x.rows = [x.official(x, 4), x.official(held)];
  const p = calculateGraduationProgress([], x.build(), x.scope, [], selection, [], x.rows, x.profile);
  assert.equal(overall(p), 4); assert.equal(p.referenceProgress[0].status, 'unknown');
  assert.equal(p.referenceProgress[0].target, selection === 'undecided' ? null : selection === 'selected' ? 124 : 128);
  if (selection === 'undecided') assert.match(p.referenceProgress[0].reason, /卒業論文の選択が未定.*公式実績の算入を保留/);
});
test('H41 geography and history structured dependencies include transferred fields and existing seminar identities', () => {
  for (const dept of ['地理学科', '史学科']) {
    const x = h41Fixture(dept), history = dept === '史学科';
    const held = x.add('stage', '専門教育', null, history ? '必修' : '選択', 4, 'schooling', history ? '日本史概説' : '人文地理学演習', x.scope);
    const rule = x.requirement('transferred', { curriculum_category: '専門教育', requirement_type: history ? '選択' : '選択必修',
      curriculum_field: history ? '東洋史の分野' : '人文地理の分野', ...(history ? { course_name: '史学演習（東洋）2' } : {}) });
    x.rows = [x.official(held, 4)]; const p = x.progress();
    assert.match(p.requirements.find(r => r.requirementId === rule.id).reason, h41Reason);
    assert.equal(overall(p), 0);
  }
});

test('H41/H14 recognition overlap retains global fallback because cross-Course deduplication is unresolved', () => {
  const x = h41Fixture(); x.rows = [x.official(x, 4)];
  x.profile.recognizedCredits.professionalCourses = [{ id: 'recognized', offeringId: null, credits: 4 }];
  const input = x.build(), facts = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile).facts;
  assert.ok(facts[0].diagnostics.includes('recognized_overlap'));
  assert.equal(unresolvedOfficialImpact(facts, false, input, x.scope, x.profile).globalUnknown, true);
  assert.match(h31Card(x.progress(input), 'group-general').reason, h41Reason);
});

// H41 review: possible destination does not imply a still-uncertain evaluation.
function h41SaturatedGeneral(credits = [12, 12, 12]) {
  const x = h41Fixture();
  for (const [index, field] of ['人文', '社会', '自然'].entries()) {
    for (let i = 0; i < credits[index] / 4; i++) {
      const entry = x.add(`known-${field}-${i}`, '一般教育', field, '選択必修', 4, 'correspondence', `制度${field}${i}`);
      x.rows.push(x.official(entry, 4));
    }
  }
  x.held = x.add('held-general', '一般教育', '自然', '選択必修', 4, 'correspondence', '制度保留自然');
  return x;
}
test('H41 saturation general36 plus all field minima remains satisfied without official reason', () => {
  const x = h41SaturatedGeneral(), baseline = x.progress();
  x.rows.push(x.official(x.held));
  const p = x.progress();
  assert.equal(h31Card(baseline, 'group-general').status, 'satisfied');
  assert.deepEqual(h31Card(p, 'group-general'), h31Card(baseline, 'group-general'));
  assert.equal(h31Card(p, 'group-general').earned, 36);
  assert.deepEqual([overall(p), p.referenceProgress[0].status, p.referenceProgress[0].target], [36, 'unknown', baseline.referenceProgress[0].target]);
  assert.match(p.referenceProgress[0].reason, h41Reason);
  assert.equal(p.importedContributionCount, 9);
});
test('H41 saturation physical2 stays satisfied without allocating the held physical budget', () => {
  const x = h41Fixture(), known = x.add('known-physical', '保健体育', null, '選択必修', 2, 'correspondence', '健康・スポーツ科学概論');
  const held = x.add('held-physical', '保健体育', null, '選択必修', 2, 'correspondence', 'スポーツ総合演習');
  x.rows = [x.official(known, 2)]; const baseline = x.progress();
  x.rows.push(x.official(held)); const p = x.progress();
  assert.equal(h31Card(baseline, 'group-physical').status, 'satisfied');
  assert.deepEqual(h31Card(p, 'group-physical'), h31Card(baseline, 'group-physical'));
  assert.deepEqual([overall(p), p.referenceProgress[0].status], [2, 'unknown']);
});
for (const completeDependents of [false, true]) test(`H41 saturation law32/8 courses keeps minimum satisfied; dependent saturation=${completeDependents}`, () => {
  const x = h41Fixture();
  for (let i = 0; i < (completeDependents ? 22 : 8); i++) {
    const entry = x.add(`known-law-${i}`, '専門教育', null, i < 8 ? '選択必修' : '選択', 4, 'correspondence', `制度法学${i}`, x.scope);
    x.rows.push(x.official(entry, 4));
  }
  const baseline = x.progress(); x.rows.push(x.official(x)); const p = x.progress();
  assert.equal(h31Card(baseline, 'professional-law-required-elective').status, 'satisfied');
  assert.deepEqual(h31Card(p, 'professional-law-required-elective'), h31Card(baseline, 'professional-law-required-elective'));
  for (const id of ['professional-law-elective', 'professional-law-total']) {
    if (completeDependents) {
      assert.equal(h31Card(baseline, id).status, 'satisfied'); assert.deepEqual(h31Card(p, id), h31Card(baseline, id));
    } else {
      assert.equal(h31Card(p, id).status, 'unknown'); assert.match(h31Card(p, id).reason, h41Reason);
      assert.equal(h31Card(p, id).earned, h31Card(baseline, id).earned);
    }
  }
  assert.equal(overall(p), overall(baseline)); assert.equal(p.referenceProgress[0].status, 'unknown');
});
test('H41 saturation general total36 alone cannot bypass a missing field minimum', () => {
  const x = h41SaturatedGeneral([20, 12, 4]);
  assert.equal(h31Card(x.progress(), 'group-general').status, 'unsatisfied');
  x.rows.push(x.official(x.held)); const p = x.progress();
  assert.deepEqual([h31Card(p, 'group-general').earned, h31Card(p, 'group-general').status], [36, 'unknown']);
  assert.match(h31Card(p, 'group-general').reason, h41Reason);
});
test('H41 saturation law32 with only four completed Courses still holds the course-count condition', () => {
  const x = h41Fixture();
  for (let i = 0; i < 4; i++) {
    const entry = x.add(`large-law-${i}`, '専門教育', null, '選択必修', 8, 'correspondence', `制度大型法学${i}`, x.scope);
    x.rows.push(x.official(entry, 8));
  }
  assert.equal(h31Card(x.progress(), 'professional-law-required-elective').status, 'unsatisfied');
  x.rows.push(x.official(x)); const c = h31Card(x.progress(), 'professional-law-required-elective');
  assert.equal(c.earned, 32); assert.equal(c.status, 'unknown'); assert.match(c.reason, h41Reason);
});
for (const [ruleType, conditions, preserve] of [
  ['min_credits', null, true], ['min_credits', { min_courses: 2 }, true],
  ['min_credits', { full_course_credits_required: true }, true],
  ['min_credits', { full_course_credits_required: true, min_courses: 2 }, true],
  ['min_courses', null, true], ['required_course', null, true],
  ['required_course', { full_course_credits_required: true }, true],
  ['max_credits', null, false], ['max_credits', { max_enrollments: 2 }, false],
  ['exact_credits', null, false], ['choose_one', { choose_count: 1, options: ['制度確定', '監査科目'] }, false],
]) test(`H41 saturation structured ${ruleType}/${JSON.stringify(conditions)} preserves only proven monotone success`, () => {
  const x = h41Fixture(), known = x.add('known-structured', '専門教育', null, '選択必修', 4, 'correspondence', '制度確定', x.scope);
  const second = x.add('known-second', '専門教育', null, '選択必修', 4, 'correspondence', '制度確定2', x.scope);
  const rule = x.requirement('saturated-rule', { course_names: [known.course.canonicalName, second.course.canonicalName, x.course.canonicalName] }, conditions, ruleType);
  rule.value = ruleType === 'min_courses' ? 2 : 8; rule.unit = ruleType === 'min_courses' ? 'courses' : 'credits';
  x.rows = [x.official(known, 4), x.official(second, 4)]; const baseline = x.progress();
  const before = baseline.requirements.find(r => r.requirementId === rule.id); assert.equal(before.status, 'satisfied');
  x.rows.push(x.official(x)); const p = x.progress(), after = p.requirements.find(r => r.requirementId === rule.id);
  assert.equal(after.earned, before.earned); assert.equal(after.target, before.target);
  if (preserve) assert.deepEqual(after, before);
  else { assert.equal(after.status, 'unknown'); assert.match(after.reason, h41Reason); }
  assert.equal(overall(p), 8); assert.equal(p.referenceProgress[0].status, 'unknown');
});
test('H41 saturation cannot release an unsafe global fallback even with known general36', () => {
  const x = h41SaturatedGeneral();
  x.rows.push({ ...x.official(x.held), curriculumCourseId: null, curriculumMatch: 'unmatched', candidateCurriculumCourseIds: [] });
  const c = h31Card(x.progress(), 'group-general');
  assert.equal(c.earned, 36); assert.equal(c.status, 'unknown'); assert.match(c.reason, h41Reason);
});
test('H41 saturation preserves H31 hold and its reason priority even when known general36 meets all minima', () => {
  const x = h41SaturatedGeneral(); x.rows.push(x.official(x.held));
  x.set(x.held); x.items = [item(x.candidate, 'earned')];
  const c = h31Card(x.progress(), 'group-general');
  assert.equal(c.earned, 36); assert.equal(c.status, 'unknown');
  assert.match(c.reason, /対応関係を確認中.*公式実績の算入を保留/);
});
test('H41 saturation foreign completion survives H42 without new H43 allocation', () => {
  const x = h41Fixture(), known = x.add('known-foreign', '外国語', '英語', '選択必修', 4, 'schooling', '英語1');
  const held = x.add('held-foreign', '外国語', '英語', '選択必修', 4, 'schooling', '英語2');
  x.rows = [x.official(known, 4, 2)]; assert.equal(h31Card(x.progress(), 'group-foreign').status, 'satisfied');
  x.rows.push(x.official(held, null, 2)); const p = x.progress(), c = h31Card(p, 'group-foreign');
  assert.equal(c.earned, 4); assert.equal(c.status, 'satisfied');
  assert.equal(c.reason, null);
  assert.equal(p.referenceProgress[1].earned, 2); assert.equal(p.referenceProgress[1].status, 'unknown');
});
test('H41 saturation frozen official rows/catalog/previous result retain known36 and invariants', () => {
  const x = h41SaturatedGeneral(), input = x.build(), previous = x.progress(input);
  x.rows.push(x.official(x.held));
  const snapshot = structuredClone({ input, rows: x.rows, records: x.records, profile: x.profile, previous });
  deepFreeze(input); deepFreeze(x.rows); deepFreeze(x.records); deepFreeze(x.profile); deepFreeze(previous);
  const p = x.progress(input);
  assert.equal(h31Card(p, 'group-general').status, 'satisfied');
  assert.deepEqual({ input, rows: x.rows, records: x.records, profile: x.profile, previous }, snapshot);
  assert.equal(initialState().schemaVersion, 22); assert.equal(p.graduationCheckComplete, false); assert.equal(input.metadata.sourceLinksReverified, false);
});
test('H41 saturation history seminar redistribution keeps a satisfied named source minimum held', () => {
  const x = h41Fixture('史学科');
  const seminar = x.add('known-seminar', '専門教育', '東洋史の分野', 'スクーリング選択必修', 2, 'schooling', '史学演習（東洋）2', x.scope);
  const overview = x.add('held-overview', '専門教育', '日本史の分野', '必修', 4, 'schooling', '日本史概説', x.scope);
  const rule = x.requirement('seminar-source', { course_name: seminar.course.canonicalName, requirement_type: 'スクーリング選択必修' }); rule.value = 2;
  const total = x.requirement('history-ordinary-total', { curriculum_category: '専門教育' }); total.value = 2;
  x.items = [item(seminar.offering, 'earned')];
  const baseline = x.progress().requirements.find(r => r.requirementId === rule.id); assert.equal(baseline.status, 'satisfied');
  x.rows = [x.official(overview, 4)]; const after = x.progress().requirements.find(r => r.requirementId === rule.id);
  assert.equal(after.earned, baseline.earned); assert.equal(after.status, 'unknown'); assert.match(after.reason, h41Reason);
  const totalAfter = x.progress().requirements.find(r => r.requirementId === total.id);
  assert.equal(totalAfter.earned, 2); assert.equal(totalAfter.status, 'satisfied'); assert.doesNotMatch(totalAfter.reason ?? '', h41Reason);
});

// H41 review 2: use the evaluator's branch normalization, including catalog annotations.
function h41LawBranchFixture(electiveCredits) {
  const x = h41Fixture();
  for (let i = 0; i < 8; i++) {
    const entry = x.add(`normalization-required-${i}`, '専門教育', null, '選択必修', 4, 'correspondence', `制度必修正規化${i}`, x.scope);
    x.rows.push(x.official(entry, 4));
  }
  for (let remaining = electiveCredits, i = 0; remaining > 0; i++) {
    const credits = Math.min(4, remaining);
    const entry = x.add(`normalization-elective-${i}`, '専門教育', null, '選択', credits, 'correspondence', `制度選択正規化${i}`, x.scope);
    x.rows.push(x.official(entry, credits)); remaining -= credits;
  }
  x.held = x.add('normalization-held', '専門教育', null, '選択', 4, 'correspondence', '制度選択保留正規化', x.scope);
  x.branchProgress = (selection, input = x.build(), rows = x.rows) => calculateGraduationProgress([], input, x.scope, [], selection, [], rows, x.profile);
  x.rule = ruleId => x.f.requirements.find(r => r.ruleId === ruleId && r.scopeId === x.scope);
  return x;
}
for (const [selection, electiveCredits] of [
  ['selected', 48], ['selected', 50], ['selected', 52],
  ['not_selected', 52], ['not_selected', 54], ['not_selected', 56],
]) test(`H41 normalization actual law catalog ${selection}/elective${electiveCredits}: branch minimum and total retain evaluator semantics`, () => {
  const x = h41LawBranchFixture(electiveCredits), selected = selection === 'selected';
  const suffix = selected ? 'with_thesis' : 'without_thesis';
  const elective = x.rule(`law_elective_${suffix}_min_credits`), total = x.rule(`law_total_${suffix}_min_credits`);
  assert.deepEqual(elective.conditions, selected ? { includes_thesis: true, when: { thesis_selected: true } } : { when: { thesis_selected: false } });
  assert.deepEqual(total.conditions, { when: { thesis_selected: selected } });
  const baseline = x.branchProgress(selection); x.rows.push(x.official(x.held));
  const p = x.branchProgress(selection);
  for (const [rule, known] of [[elective, electiveCredits], [total, electiveCredits + 32]]) {
    const before = baseline.requirements.find(r => r.requirementId === rule.id), after = p.requirements.find(r => r.requirementId === rule.id);
    assert.equal(before.earned, known); assert.equal(after.earned, before.earned); assert.equal(after.target, before.target);
    if (known >= rule.value) {
      assert.equal(before.status, 'satisfied'); assert.deepEqual(after, before); assert.doesNotMatch(after.reason ?? '', h41Reason);
    } else {
      assert.equal(before.status, 'unsatisfied'); assert.equal(after.status, 'unknown'); assert.match(after.reason, h41Reason);
    }
  }
  const card = h31Card(p, 'professional-law-elective'), beforeCard = h31Card(baseline, 'professional-law-elective');
  assert.equal(card.earned, beforeCard.earned); assert.equal(card.target, beforeCard.target);
  if (electiveCredits >= elective.value) assert.deepEqual(card, beforeCard);
  else { assert.equal(card.status, 'unknown'); assert.match(card.reason, h41Reason); }
  const inactive = x.rule(`law_elective_${selected ? 'without_thesis' : 'with_thesis'}_min_credits`);
  assert.ok(!p.requirements.some(r => r.requirementId === inactive.id));
  assert.equal(overall(p), overall(baseline)); assert.equal(p.referenceProgress[0].target, baseline.referenceProgress[0].target);
  assert.equal(p.referenceProgress[0].status, 'unknown'); assert.match(p.referenceProgress[0].reason, h41Reason);
  assert.equal(p.importedContributionCount, x.rows.length - 1, 'held official aggregate never contributes');
});
for (const ruleType of ['max_credits', 'exact_credits', 'choose_one']) test(`H41 normalization annotated ${ruleType} remains conservatively held`, () => {
  const x = h41LawBranchFixture(52);
  const rule = x.requirement(`normalization-${ruleType}`, { curriculum_category: '専門教育', requirement_type: '選択' },
    { includes_thesis: true, when: { thesis_selected: true }, ...(ruleType === 'choose_one' ? { choose_count: 1, options: ['選択'] } : {}) }, ruleType);
  rule.value = 52;
  const before = x.branchProgress('selected').requirements.find(r => r.requirementId === rule.id);
  assert.equal(before.status, 'satisfied'); x.rows.push(x.official(x.held));
  const after = x.branchProgress('selected').requirements.find(r => r.requirementId === rule.id);
  assert.equal(after.status, 'unknown'); assert.equal(after.earned, before.earned); assert.equal(after.target, before.target);
  assert.match(after.reason, h41Reason);
});
test('H41 normalization undecided law thesis preserves H36 quantities, unknown requirements and reference target', () => {
  const x = h41LawBranchFixture(52), baseline = x.branchProgress('undecided');
  x.rows.push(x.official(x.held)); const p = x.branchProgress('undecided');
  for (const branch of ['with_thesis', 'without_thesis']) for (const kind of ['elective', 'total']) {
    const rule = x.rule(`law_${kind}_${branch}_min_credits`);
    const before = baseline.requirements.find(r => r.requirementId === rule.id), after = p.requirements.find(r => r.requirementId === rule.id);
    assert.equal(before.status, 'unknown'); assert.equal(after.status, 'unknown');
    assert.equal(after.earned, before.earned); assert.equal(after.target, before.target);
    assert.match(after.reason, /卒論有無が未定.*公式実績の算入を保留/);
  }
  assert.equal(p.referenceProgress[0].target, null); assert.equal(p.referenceProgress[0].status, 'unknown');
  assert.equal(overall(p), overall(baseline));
  assert.match(p.referenceProgress[0].reason, /卒業論文の選択が未定.*公式実績の算入を保留/);
});
test('H41 normalization leaves frozen original catalog annotations and previous result unchanged', () => {
  const x = h41LawBranchFixture(50), input = x.build(), previous = x.branchProgress('selected', input);
  x.rows.push(x.official(x.held));
  const snapshot = structuredClone({ input, rows: x.rows, profile: x.profile, previous });
  deepFreeze(input); deepFreeze(x.rows); deepFreeze(x.profile); deepFreeze(previous);
  const p = x.branchProgress('selected', input), rule = x.rule('law_elective_with_thesis_min_credits');
  assert.equal(p.requirements.find(r => r.requirementId === rule.id).status, 'satisfied');
  assert.deepEqual({ input, rows: x.rows, profile: x.profile, previous }, snapshot);
  assert.equal(initialState().schemaVersion, 22); assert.equal(p.graduationCheckComplete, false); assert.equal(input.metadata.sourceLinksReverified, false);
});

// H42: consumer-specific schooling dependencies remain independent of H43.
const h42Reason = /公式実績のスクーリング/;
const h42S = p => p.referenceProgress.find(r => r.id === 'schooling-reference-progress');
const h42Language = (p, name) => h31Card(p, 'group-foreign').details.find(d => d.label === name);
for (const category of ['一般教育', '専門教育', '外国語']) test(`H42 allocated ${category} Snull localizes foreign and law consumers`, () => {
  const x = h41Fixture(), row = category === '専門教育' ? x : x.add('h42-local', category, category === '外国語' ? '英語' : '人文', '選択必修');
  const baseline = x.progress(); x.rows = [x.official(row, 4, null)]; const p = x.progress();
  if (category !== '外国語') assert.deepEqual(h31Card(p, 'group-foreign'), h31Card(baseline, 'group-foreign'));
  else {
    assert.deepEqual([h31Card(p, 'group-foreign').earned, h31Card(p, 'group-foreign').status], [4, 'unknown']);
    assert.deepEqual([h42Language(p, '英語').earned, h42Language(p, '英語').schooling], [4, 0]);
    assert.match(h42Language(p, '英語').reason, h42Reason);
    assert.equal(h42Language(p, '独語').reason ?? null, null);
  }
  if (category !== '専門教育') assert.deepEqual(h31Card(p, 'professional-law-schooling'), h31Card(baseline, 'professional-law-schooling'));
  assert.equal(h42S(p).status, 'unknown');
});
for (const language of ['英語', '独語']) test(`H42 foreign known English4/S2 survives extra ${language} Snull`, () => {
  const x = h41Fixture(), known = x.add('known', '外国語', '英語', '選択必修'), extra = x.add('extra', '外国語', language, '選択必修');
  x.rows = [x.official(known, 4, 2), x.official(extra, 4, null)];
  const p = x.progress(), c = h31Card(p, 'group-foreign');
  assert.deepEqual([c.earned, c.status, c.reason], [4, 'satisfied', null]);
  assert.equal(h42Language(p, '英語').reason ?? null, null);
  assert.equal(h42S(p).earned, 2);
});
test('H42 safe English/German candidate union affects no French or law S; H43 counts global S2 only', () => {
  const x = h41Fixture(), entry = x.add('union', '外国語', '英語', '選択必修');
  const edge = { ...entry.mapping, mappingId: '42424242-4242-4242-8242-000000000001', field: '独語' };
  x.f.mappings.push(edge); entry.course.mappingIds.push(edge.mappingId);
  x.rows = [x.official(entry, 4, 2)]; const p = x.progress();
  for (const lang of ['英語', '独語']) assert.match(h42Language(p, lang).reason, h42Reason);
  assert.equal(h42Language(p, '仏語').reason ?? null, null);
  assert.equal(h31Card(p, 'professional-law-schooling').status, 'unsatisfied');
  assert.deepEqual([h31Card(p, 'group-foreign').earned, h42S(p).earned, h42S(p).status], [0, 2, 'partial']);
});
for (const known of [2, 8]) test(`H42 law S minimum preserves known${known} and saturation`, () => {
  const x = h41Fixture();
  for (let i = 0; i < known / 2; i++) {
    const entry = x.add(`known-${i}`, '専門教育', null, '選択', 4, 'correspondence', `制度科目${i}`, x.scope);
    x.rows.push(x.official(entry, 4, 2));
  }
  x.rows.push(x.official(x, 4, null)); const c = h31Card(x.progress(), 'professional-law-schooling');
  assert.deepEqual([c.earned, c.status], [known, known >= 8 ? 'satisfied' : 'unknown']);
  if (known >= 8) assert.equal(c.reason, null); else assert.match(c.reason, h42Reason);
});
for (const name of LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026) test(`H42 exact excluded ${name} cannot hold law S8; H19 counts global only`, () => {
  const x = h41Fixture(), entry = x.add('excluded', '専門教育', null, '選択', 2, 'correspondence', name, x.scope);
  x.rows = [x.official(entry, 2, 2)]; const p = x.progress();
  const facts = deriveOfficialGraduationFacts(x.rows, [], x.f, x.scope, x.profile);
  assert.equal(facts.allocations.reduce((sum, a) => sum + (a.schoolingCredits ?? 0), 0), 0);
  assert.deepEqual([h31Card(p, 'professional-law-schooling').earned, h31Card(p, 'professional-law-schooling').status], [0, 'unsatisfied']);
  assert.deepEqual([h42S(p).earned, h42S(p).status], [2, 'partial']);
});
for (const targetKind of ['course_name', 'course_names', 'curriculum_category', 'curriculum_field', 'requirement_type']) {
  for (const held of [false, true]) test(`H42 structured ${targetKind} held=${held} matches institutional target and retains lower bounds`, () => {
    const x = h41Fixture(), known = x.add('known', '一般教育', '人文', '選択必修', 4, 'correspondence', '既知科目');
    const extra = x.add('extra', '一般教育', '人文', '選択必修', 4, 'correspondence', '追加科目');
    const targets = {
      course_name: [{ course_name: '追加科目' }, { course_name: '既知科目' }],
      course_names: [{ course_names: ['既知科目', '追加科目'] }, { course_names: ['既知科目'] }],
      curriculum_category: [{ curriculum_category: '一般教育' }, { curriculum_category: '外国語' }],
      curriculum_field: [{ curriculum_category: '一般教育', curriculum_field: '人文' }, { curriculum_category: '一般教育', curriculum_field: '自然' }],
      requirement_type: [{ curriculum_category: '一般教育', requirement_type: '選択必修' }, { curriculum_category: '一般教育', requirement_type: '選択' }],
    };
    const [target, outside] = targets[targetKind];
    const rule = x.requirement('h42-target', target, null, 'min_schooling_credits'); rule.value = 4;
    const other = x.requirement('h42-outside', outside, null, 'min_schooling_credits'); other.value = 4;
    x.rows = [x.official(known, 4, 2)]; const input = x.build(), base = x.progress(input);
    x.rows.push(x.official(extra, held ? null : 4, null)); const p = x.progress(input), row = p.requirements.find(r => r.requirementId === rule.id);
    assert.deepEqual([row.earned, row.status], [targetKind === 'course_name' ? 0 : 2, 'unknown']);
    assert.match(row.reason, h42Reason);
    assert.deepEqual(p.requirements.find(r => r.requirementId === other.id), base.requirements.find(r => r.requirementId === other.id));
  });
}
for (const held of [false, true]) test(`H42 structured minimum already met survives Snull held=${held}`, () => {
  const x = h41Fixture(), extra = x.add('extra', '専門教育', null, '選択必修', 4, 'correspondence', '追加科目', x.scope);
  const rule = x.requirement('h42-saturated', { curriculum_category: '専門教育' }, null, 'min_schooling_credits'); rule.value = 2;
  x.rows = [x.official(x, 4, 2), x.official(extra, held ? null : 4, null)];
  const row = x.progress().requirements.find(r => r.requirementId === rule.id);
  assert.deepEqual([row.earned, row.status, row.reason], [2, 'satisfied', null]);
});
for (const s of [0, null, 2]) test(`H42 held official S=${s} has independent global reference; H43 no addition`, () => {
  const x = h41Fixture(); x.rows = [x.official(x, null, s)]; const p = x.progress();
  assert.deepEqual([h42S(p).earned, h42S(p).status], s === 0 ? [0, 'partial'] : [null, 'unknown']);
  assert.deepEqual([overall(p), p.referenceProgress[0].status], [0, 'unknown']);
  assert.equal(h31Card(p, 'professional-law-schooling').status, s === 0 ? 'unsatisfied' : 'unknown');
});
for (const mode of ['allZero', 'out_of_scope', 'unsafe', 'orphan', 'unresolved-identity', 'media-conflict']) test(`H42 global ${mode} uses evidence and conservative fallback`, () => {
  const x = h41Fixture(); x.rows = [x.official(x, mode === 'allZero' ? 0 : mode === 'media-conflict' ? 4 : null, mode === 'allZero' || mode === 'media-conflict' ? 0 : null)]; const input = x.build();
  if (mode === 'out_of_scope') input.mappings.find(m => m.mappingId === x.mapping.mappingId).scopeId = input.programs.find(p => p.department === '経済学科').scopeId;
  if (mode === 'unsafe') input.mappings.find(m => m.mappingId === x.mapping.mappingId).field = 123;
  if (mode === 'unresolved-identity') { x.rows[0].curriculumCourseId = null; x.rows[0].curriculumMatch = 'unmatched'; }
  if (mode === 'orphan') { x.rows = []; x.records = [{ id: 'orphan', sourceCourseId: 'missing', method: 'schooling', credits: 40 }]; }
  if (mode === 'media-conflict') x.records = [mediaRecord(x, { sourceCourseId: x.rows[0].id, credits: 4, grade: 'A' })];
  const p = x.progress(input), safe = ['allZero', 'out_of_scope'].includes(mode);
  assert.equal(h42S(p).status, safe ? 'partial' : 'unknown');
  assert.equal(h31Card(p, 'professional-law-schooling').status, safe ? 'unsatisfied' : 'unknown');
});
for (const department of ['日本文学科', '史学科', '地理学科', '法律学科', '経済学科', '商業学科']) test(`H42 ${department} current/common scope S stays outside unrelated consumers`, () => {
  const x = h41Fixture(department), common = x.add('common', '一般教育', '自然', '選択必修');
  x.rows = [x.official(x, 4, null), x.official(common, 4, null)]; const p = x.progress();
  assert.equal(h31Card(p, 'group-foreign').status, 'unsatisfied'); assert.equal(h42S(p).status, 'unknown');
});
test('H42 other department professional Snull does not hold selected law S8', () => {
  const x = h41Fixture(), otherScope = x.f.programs.find(p => p.department === '経済学科').scopeId;
  const outside = x.add('outside', '専門教育', null, '選択', 4, 'correspondence', '他学科科目', otherScope);
  x.rows = [x.official(outside, 4, null)];
  assert.deepEqual(x.progress().cards, x.progress(undefined, []).cards); assert.equal(h42S(x.progress()).status, 'partial');
});
test('H42 frozen authority ignores Offering deletion/reorder/metadata and component40, preserves all invariants', () => {
  const x = h41Fixture(), foreign = x.add('foreign', '外国語', '英語', '選択必修');
  x.rows = [x.official(x, 4, 2), x.official(foreign, 4, null)];
  x.records = [{ id: 'component', sourceCourseId: x.rows[1].id, source: 'hosei_import', method: 'schooling', credits: 40, rawName: '偽表示' }];
  const input = x.build(), previous = x.progress(input);
  input.offerings.reverse(); input.offerings.forEach(o => { o.name = '偽表示'; o.method = 'schooling'; o.credits = 99; });
  assert.deepEqual(x.progress(input), previous);
  input.offerings = []; input.curriculum.offeringRelations = [];
  assert.deepEqual(x.progress(input), previous);
  const snapshot = structuredClone({ input, rows: x.rows, records: x.records, profile: x.profile, previous });
  [input, x.rows, x.records, x.profile, previous, x.items].forEach(deepFreeze);
  assert.deepEqual(x.progress(input), previous);
  assert.deepEqual({ input, rows: x.rows, records: x.records, profile: x.profile, previous }, snapshot);
  assert.equal(overall(previous), 8); assert.equal(h42S(previous).earned, 2);
  assert.equal(initialState().schemaVersion, 22); assert.equal(previous.graduationCheckComplete, false);
  assert.equal(input.metadata.graduationCheckComplete, false); assert.equal(input.metadata.sourceLinksReverified, false);
});
for (const mode of ['field', 'type', 'flag']) test(`H42 allocated malformed ${mode} cannot localize an unsafe Mapping`, () => {
  const x = h41Fixture(); x.rows = [x.official(x, 4, null)]; const input = x.build();
  const mapping = input.mappings.find(m => m.mappingId === x.mapping.mappingId);
  if (mode === 'field') mapping.field = '不明';
  if (mode === 'type') mapping.requirementType = '必修';
  if (mode === 'flag') mapping.schoolingOnly = 'unknown';
  const p = x.progress(input);
  assert.equal(h31Card(p, 'group-foreign').status, 'unknown');
  assert.equal(h31Card(p, 'professional-law-schooling').status, 'unknown');
  assert.equal(h42S(p).status, 'unknown');
});
test('H42 structured named held Course needs no annual Offering to retain known zero', () => {
  const x = h41Fixture(), rule = x.requirement('h42-name', { course_name: x.course.canonicalName }, null, 'min_schooling_credits');
  x.rows = [x.official(x, null, 2)]; const input = x.build(); input.offerings = []; input.curriculum.offeringRelations = [];
  const row = x.progress(input).requirements.find(r => r.requirementId === rule.id);
  assert.deepEqual([row.earned, row.target, row.status], [0, 12, 'unknown']); assert.match(row.reason, h42Reason);
});
for (const minimumCourses of [1, 2]) test(`H42 structured S saturation respects min_courses=${minimumCourses}`, () => {
  const x = h41Fixture(), extra = x.add('extra', '専門教育', null, '選択必修', 4, 'correspondence', '追加科目', x.scope);
  const rule = x.requirement('h42-courses', { curriculum_category: '専門教育' }, { min_courses: minimumCourses }, 'min_schooling_credits'); rule.value = 2;
  x.rows = [x.official(x, 4, 2), x.official(extra, null, null)];
  const row = x.progress().requirements.find(r => r.requirementId === rule.id);
  assert.deepEqual([row.earned, row.status], [2, minimumCourses === 1 ? 'satisfied' : 'unknown']);
});
test('H42 H38 recognition Snull keeps its reason and ordinary4 with unrelated official Snull', () => {
  const x = h41Fixture(); x.profile.admissionType = 'transfer_second_year';
  x.profile.recognizedCredits.foreignLanguage = { mode: 'recognized', credits: 4, language: 'english', schoolingEquivalentCredits: null };
  const baseline = h31Card(x.progress(), 'group-foreign'); x.rows = [x.official(x, 4, null)];
  const p = x.progress(); assert.deepEqual(h31Card(p, 'group-foreign'), baseline);
  assert.deepEqual([baseline.earned, baseline.status], [4, 'unknown']); assert.match(baseline.reason, /スクーリング相当認定単位が未確認/);
});
test('H42 H31 reason priority survives concurrent official Snull with known S2', () => {
  const x = h41Fixture(); x.candidate.method = 'schooling'; x.items = [item(x.candidate, 'earned')]; x.set(x);
  const extra = x.add('extra', '専門教育', null, '選択', 4, 'correspondence', '追加科目', x.scope);
  const rule = x.requirement('h42-h31', { curriculum_category: '専門教育' }, null, 'min_schooling_credits'); rule.value = 4;
  x.rows = [x.official(x, 4, 2), x.official(extra, 4, null)]; const p = x.progress();
  const row = p.requirements.find(r => r.requirementId === rule.id);
  assert.deepEqual([row.earned, row.status], [2, 'unknown']); assert.match(row.reason, /^修得済み/);
  const c = h31Card(p, 'professional-law-schooling'); assert.equal(c.earned, 2); assert.match(c.reason, /対応関係を確認中.*公式実績のスクーリング/);
});
for (const selection of ['selected', 'not_selected', 'undecided']) test(`H42 H36 ${selection} keeps thesis targets with local official Snull`, () => {
  const x = h41Fixture(); x.rows = [x.official(x, 4, null)];
  const p = calculateGraduationProgress([], x.build(), x.scope, [], selection, [], x.rows, x.profile);
  assert.deepEqual([overall(p), p.referenceProgress[0].target], [4, selection === 'undecided' ? null : selection === 'selected' ? 124 : 128]);
  assert.equal(h31Card(p, 'group-foreign').status, 'unsatisfied'); assert.equal(h31Card(p, 'professional-law-schooling').status, 'unknown');
});
test('H42 exact exclusion is not a name prefix; held exclusion still does not rescue positive S', () => {
  const x = h41Fixture(), excluded = x.add('excluded', '専門教育', null, '選択', 2, 'correspondence', '情報学入門', x.scope);
  x.rows = [x.official(excluded, null, 2)]; const p = x.progress();
  assert.equal(h31Card(p, 'professional-law-schooling').status, 'unsatisfied'); assert.equal(h42S(p).earned, null);
  excluded.course.canonicalName += '追加'; x.rows = [x.official(excluded, null, 2)];
  assert.equal(h31Card(x.progress(), 'professional-law-schooling').status, 'unknown');
});

// H42 review: destination uncertainty and completion uncertainty are independent.
for (const other of ['none', 'English2', 'German4']) test(`H42 review P2-1 English O2/Snull plus ${other} checks same-language ordinary minimum`, () => {
  const x = h41Fixture(), english = x.add('english-partial', '外国語', '英語', '選択必修');
  x.rows = [x.official(english, 2, null)];
  if (other !== 'none') {
    const known = x.add('known', '外国語', other === 'English2' ? '英語' : '独語', '選択必修');
    x.rows.push(x.official(known, other === 'English2' ? 2 : 4, 0));
  }
  const p = x.progress(), c = h31Card(p, 'group-foreign');
  assert.deepEqual([c.earned, c.status], [other === 'none' ? 2 : 4, other === 'English2' ? 'unknown' : 'unsatisfied']);
  assert.equal(h42Language(p, '英語').schooling, 0);
  if (other === 'English2') assert.match(c.reason, h42Reason); else assert.equal(c.reason, null);
  assert.equal(h42S(p).status, 'unknown');
});
for (const language of ['英語', '独語']) test(`H42 review P2-1 English O4/S2 remains satisfied with ${language} O2/Snull`, () => {
  const x = h41Fixture(), english = x.add('english', '外国語', '英語', '選択必修');
  const extra = x.add('extra', '外国語', language, '選択必修');
  x.rows = [x.official(english, 4, 2), x.official(extra, 2, null)];
  const c = h31Card(x.progress(), 'group-foreign'); assert.deepEqual([c.earned, c.status, c.reason], [4, 'satisfied', null]);
});
for (const [department, category, field, name, lawHeld] of [
  ['法律学科', '一般教育', '人文', '基礎特講', false],
  ['日本文学科', '専門教育', null, '総合特講', false],
  ['史学科', '専門教育', '日本史の分野', '歴史資料学', false],
  ['経済学科', '専門教育', null, '経済学特講', false],
  ['法律学科', '専門教育', null, '法律学演習', true],
  ['法律学科', '専門教育', null, '総合特講', false],
]) for (const s of [null, 2]) test(`H42 review P2-2 ${department}/${name}/S${s} localizes schooling independently of H41 special routing`, () => {
  const x = h41Fixture(department), entry = x.add('special', category, field, '選択', 4, 'correspondence', name, category === '一般教育' ? x.common : x.scope);
  const same = x.requirement('special-s', { curriculum_category: category }, null, 'min_schooling_credits');
  const foreign = x.requirement('foreign-s', { curriculum_category: '外国語' }, null, 'min_schooling_credits');
  x.rows = [x.official(entry, 4, s)]; const input = x.build();
  const facts = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile);
  assert.equal(facts.allocations.length, 0);
  const ordinary = unresolvedOfficialImpact(facts.facts, false, input, x.scope, x.profile);
  assert.equal(ordinary.globalUnknown, true, 'H41 special ordinary fallback stays unchanged');
  const schooling = unresolvedSchoolingImpact(facts, false, input, x.scope, x.profile);
  assert.equal(schooling.globalUnknown, false); assert.equal(schooling.foreignLanguages.size, 0);
  assert.equal(schooling.lawProfessionalUnknown, lawHeld);
  const p = x.progress(input);
  const s0 = x.progress(input, [x.official(entry, 4, 0)]);
  // H41's independent ordinary reason/status remains; H42 adds no foreign hold.
  assert.deepEqual(h31Card(p, 'group-foreign'), h31Card(s0, 'group-foreign'));
  if (department === '法律学科') {
    const law = h31Card(p, 'professional-law-schooling');
    assert.deepEqual([law.earned, law.status], [0, lawHeld ? 'unknown' : 'unsatisfied']);
  }
  assert.deepEqual([h42S(p).earned, h42S(p).status], department === '法律学科' && name === '総合特講' && s === 2 ? [2, 'partial'] : [null, 'unknown']);
  assert.equal(overall(p), null); // Existing H41 global quantity boundary, no held4 or S2.
  assert.equal(p.requirements.find(r => r.requirementId === same.id).status, 'unknown');
  assert.equal(p.requirements.find(r => r.requirementId === foreign.id).status, 'unsatisfied');
});
for (const mode of ['missing-edge', 'duplicate-owner', 'bad-field', 'orphan']) test(`H42 review P2-2 ${mode} retains truly global schooling fallback`, () => {
  const x = h41Fixture(), entry = x.add('special', '一般教育', '人文', '選択', 4, 'correspondence', '基礎特講');
  x.rows = [x.official(entry, 4, null)]; const input = x.build();
  const course = input.curriculum.courses.find(c => c.id === entry.course.id);
  if (mode === 'missing-edge') course.mappingIds.push('missing');
  if (mode === 'duplicate-owner') input.curriculum.courses.push({ ...course, id: 'another-owner' });
  if (mode === 'bad-field') input.mappings.find(m => m.mappingId === entry.mapping.mappingId).field = 'unsafe';
  if (mode === 'orphan') x.records = [{ id: 'orphan', sourceCourseId: 'missing', method: 'schooling', credits: 0 }];
  const p = x.progress(input);
  assert.match(h31Card(p, 'group-foreign').reason, h42Reason);
  assert.equal(h31Card(p, 'professional-law-schooling').status, 'unknown'); assert.equal(h42S(p).status, 'unknown');
});
test('H42 review frozen special union never selects just one destination or adds held S2', () => {
  const x = h41Fixture(), entry = x.add('special-union', '一般教育', '人文', '選択', 4, 'correspondence', '基礎特講');
  const edge = { ...x.mapping, mappingId: '42424242-4242-4242-8242-000000000002' };
  x.f.mappings.push(edge); entry.course.mappingIds.push(edge.mappingId); entry.course.scopeIds.push(x.scope);
  x.rows = [x.official(entry, 4, 2)]; const input = x.build(); input.offerings = []; input.curriculum.offeringRelations = [];
  const previous = x.progress(input), snapshot = structuredClone({ input, rows: x.rows, profile: x.profile, previous });
  [input, x.rows, x.profile, previous].forEach(deepFreeze);
  assert.deepEqual(x.progress(input), previous); assert.deepEqual({ input, rows: x.rows, profile: x.profile, previous }, snapshot);
  const facts = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile);
  const impact = unresolvedSchoolingImpact(facts, false, input, x.scope, x.profile);
  assert.equal(impact.globalUnknown, false); assert.equal(impact.foreignLanguages.size, 0); assert.equal(impact.lawProfessionalUnknown, true);
  assert.deepEqual(new Set(impact.candidates.map(c => c.mapping.category)), new Set(['一般教育', '専門教育']));
  assert.equal(h42S(previous).earned, null); assert.equal(h42S(previous).status, 'unknown');
});
test('H42 review mixed special union retains safe H41 transfer destinations beside fallback Mapping', () => {
  const x = h41Fixture('史学科'), entry = x.add('mixed-overview', '一般教育', '人文', '選択', 4, 'correspondence', '日本史概説');
  const edge = { ...x.mapping, mappingId: '42424242-4242-4242-8242-000000000003', field: '日本史の分野' };
  x.f.mappings.push(edge); entry.course.mappingIds.push(edge.mappingId); entry.course.scopeIds.push(x.scope);
  const rule = x.requirement('transferred-s', { curriculum_category: '専門教育', requirement_type: '選択', curriculum_field: '西洋史の分野' }, null, 'min_schooling_credits');
  x.rows = [x.official(entry, 4, null)]; const input = x.build();
  const facts = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile);
  const ordinary = unresolvedOfficialImpact(facts.facts, false, input, x.scope, x.profile);
  assert.equal(ordinary.globalUnknown, true); assert.equal(ordinary.candidates.length, 1);
  const school = unresolvedSchoolingImpact(facts, false, input, x.scope, x.profile);
  assert.equal(school.globalUnknown, false); assert.equal(school.candidates.length, 2);
  assert.deepEqual(school.candidates.find(c => c.mapping.mappingId === edge.mappingId), ordinary.candidates[0]);
  assert.equal(x.progress(input).requirements.find(r => r.requirementId === rule.id).status, 'unknown');
});

// H43: preserve only independently proven global S; ordinary remains held.
test('H43 pre-fix reproduction: literature partial official O2/S2 preserves global S only', () => {
  const x = h41Fixture('日本文学科');
  const ordinary = x.requirement('h43-ordinary', { curriculum_category: '専門教育' });
  ordinary.value = 2;
  const schooling = x.requirement('h43-schooling', { curriculum_category: '専門教育' }, null, 'min_schooling_credits');
  schooling.value = 2;
  x.rows = [x.official(x, 2, 2)]; const input = x.build();
  const facts = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile);
  assert.equal(facts.facts[0].earnedCreditsTotal, 2);
  assert.equal(facts.facts[0].allocation.kind, 'unknown');
  assert.equal(facts.allocations.length, 0);
  const p = x.progress(input);
  assert.deepEqual([h42S(p).earned, h42S(p).status], [2, 'partial']);
  assert.equal(p.importedContributionCount, 0);
  assert.deepEqual([overall(p), p.referenceProgress[0].status], [0, 'unknown']);
  assert.match(p.referenceProgress[0].reason, h41Reason);
  for (const rule of [ordinary, schooling]) {
    const result = p.requirements.find(r => r.requirementId === rule.id);
    assert.deepEqual([result.earned, result.status], [0, 'unknown']);
  }
  assert.deepEqual([h31Card(p, 'professional-required-elective').earned, h31Card(p, 'professional-required-elective').status], [0, 'unknown']);
});

function h43Fixture() {
  const x = h41Fixture('日本文学科'); x.rows = [x.official(x, 2, 2)];
  return x;
}
function h43Evidence(x, input = x.build()) {
  const official = deriveOfficialGraduationFacts(x.rows, x.records, input, x.scope, x.profile);
  const contributions = heldOfficialSchoolingContributions(official, x.rows, x.records, input, x.scope, x.profile);
  return { official, contributions, impact: unresolvedSchoolingImpact(official,
    x.records.some(record => !x.rows.some(row => row.id === record.sourceCourseId)), input, x.scope, x.profile, contributions) };
}
for (const department of ['日本文学科', '史学科', '地理学科']) test(`H43 ${department} partial keeps S and identical ordinary consumers`, () => {
  const x = h41Fixture(department); x.rows = [x.official(x, 2, 2)]; const input = x.build();
  const p = x.progress(input), before = x.progress(input, [{ ...x.rows[0], schoolingCreditsTotal: null }]);
  const { contributions, impact, official } = h43Evidence(x, input);
  assert.equal(official.allocations.length, 0); assert.equal(contributions.length, 1);
  assert.equal(impact.globalReferenceUnknown, false);
  assert.equal(h42S(p).earned, 2);
  assert.deepEqual(p.cards, before.cards); assert.deepEqual(p.requirements, before.requirements);
  assert.deepEqual(p.referenceProgress[0], before.referenceProgress[0]);
});
test('H43 allocated and held quantities coexist once, including official-priority Planner dedupe', () => {
  const x = h43Fixture(), known = x.add('h43-known', '一般教育', '人文', '選択必修');
  x.rows.push(x.official(known, 4, 2));
  x.items = [item(x.offering, 'earned'), item(known.offering, 'earned')];
  x.offering.method = 'schooling'; known.offering.method = 'schooling';
  const input = x.build(), { official, contributions } = h43Evidence(x, input);
  assert.equal(official.allocations.length, 1); assert.equal(contributions.length, 1);
  assert.equal(h42S(x.progress(input)).earned, 4); assert.equal(overall(x.progress(input)), 4);
  x.rows.push(x.rows[0]); // Same source ID is idempotent, not a second snapshot.
  assert.equal(h42S(x.progress(input)).earned, 4);
});
test('H43 normal allocated S never produces a second contribution', () => {
  const x = h43Fixture(); x.rows[0].earnedCreditsTotal = 4;
  const { official, contributions } = h43Evidence(x);
  assert.equal(official.allocations[0].schoolingCredits, 2); assert.equal(contributions.length, 0);
  assert.equal(h42S(x.progress()).earned, 2);
});
for (const s of [0, null]) test(`H43 held S=${s} retains zero versus unknown semantics`, () => {
  const x = h43Fixture(); x.rows[0].schoolingCreditsTotal = s;
  assert.equal(h43Evidence(x).contributions.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], s === 0 ? [0, 'partial'] : [null, 'unknown']);
});
for (const [label, mutate] of [
  ['negative S', x => { x.rows[0].schoolingCreditsTotal = -1; }],
  ['NaN S', x => { x.rows[0].schoolingCreditsTotal = NaN; }],
  ['infinite S', x => { x.rows[0].schoolingCreditsTotal = Infinity; }],
  ['S above earned', x => { x.rows[0].schoolingCreditsTotal = 3; }],
  ['S above composition', x => { x.rows[0].schoolingCreditsTotal = 5; }],
  ['null earned', x => { x.rows[0].earnedCreditsTotal = null; }],
  ['negative earned', x => { x.rows[0].earnedCreditsTotal = -1; }],
  ['NaN earned', x => { x.rows[0].earnedCreditsTotal = NaN; }],
  ['infinite earned', x => { x.rows[0].earnedCreditsTotal = Infinity; }],
  ['earned above composition', x => { x.rows[0].earnedCreditsTotal = 5; }],
  ['missing source composition', x => { x.rows[0].compositionCredits = null; }],
  ['composition mismatch', x => { x.rows[0].compositionCredits = 2; }],
  ['unresolved identity', x => { x.rows[0].curriculumCourseId = null; x.rows[0].curriculumMatch = 'unmatched'; }],
  ['duplicate snapshots', x => { x.rows.push({ ...x.rows[0], id: 'duplicate' }); }],
  ['duplicate null snapshot', x => { x.rows.push({ ...x.rows[0], id: 'duplicate', earnedCreditsTotal: null, schoolingCreditsTotal: null }); }],
  ['recognized exemption', x => { x.rows[0].recognizedExemption = 2; }],
  ['additional enrollment', x => { x.rows[0].additionalEnrollment = 1; }],
  ['negative exemption', x => { x.rows[0].recognizedExemption = -1; }],
  ['legacy curriculum', x => { x.profile.curriculumApplicability = 'legacy_or_transition'; }],
  ['unknown curriculum', x => { x.profile.curriculumApplicability = 'unknown'; }],
  ['professional recognition', x => { x.profile.recognizedCredits.professionalCourses = [{ id: 'h43-recognition', offeringId: x.offering.id, courseId: x.offering.courseId, mappingId: x.mapping.mappingId, name: x.course.canonicalName, credits: 2 }]; }],
  ['transfer recognized S', x => { x.profile.admissionType = 'transfer_second_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = 2; }],
  ['transfer unknown S', x => { x.profile.admissionType = 'transfer_second_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = null; }],
]) test(`H43 ${label.startsWith('transfer ') ? 'H20 coexistence' : 'excludes'} ${label}`, () => {
  const x = h43Fixture(), input = x.build(); mutate(x);
  const { contributions, impact } = h43Evidence(x, input);
  if (label.startsWith('transfer ')) {
    assert.equal(contributions.length, 1); assert.equal(impact.globalReferenceUnknown, false);
    const s = h42S(x.progress(input));
    assert.deepEqual([s.earned, s.status], label === 'transfer recognized S' ? [4, 'partial'] : [null, 'unknown']);
    return; // Missing all recognition inputs still holds the reference prerequisite.
  }
  assert.equal(contributions.length, 0); assert.equal(impact.globalReferenceUnknown, true);
  // Recognition may independently contribute; H43 must not release its hold.
  assert.equal(h42S(x.progress(input)).status, 'unknown');
});
for (const mode of ['missing-edge', 'duplicate-edge', 'duplicate-owner', 'bad-field', 'null-credits', 'mismatched-credits', 'bad-source', 'schooling-only', 'media-only', 'out-of-scope']) test(`H43 excludes unsafe Mapping ${mode}`, () => {
  const x = h43Fixture(), input = x.build();
  const course = input.curriculum.courses.find(c => c.id === x.course.id);
  const mapping = input.mappings.find(m => m.mappingId === x.mapping.mappingId);
  if (mode === 'missing-edge') course.mappingIds.push('missing');
  if (mode === 'duplicate-edge') input.mappings.push({ ...mapping });
  if (mode === 'duplicate-owner') input.curriculum.courses.push({ ...course, id: 'other-owner' });
  if (mode === 'bad-field') mapping.field = 'unproven';
  if (mode === 'null-credits') { course.curriculumCredits = null; mapping.curriculumCredits = null; }
  if (mode === 'mismatched-credits') mapping.curriculumCredits = 2;
  if (mode === 'bad-source') input.curriculum.source = 'unknown';
  if (mode === 'schooling-only') mapping.schoolingOnly = true;
  if (mode === 'media-only') mapping.mediaOnly = true;
  if (mode === 'out-of-scope') mapping.scopeId = input.programs.find(p => p.department === '経済学科').scopeId;
  const { contributions } = h43Evidence(x, input); assert.equal(contributions.length, 0);
  const p = x.progress(input);
  assert.deepEqual([h42S(p).earned, h42S(p).status], mode === 'out-of-scope' ? [0, 'partial'] : [null, 'unknown']);
});
test('H43 orphan cannot supply quantity, safe other fact remains a known lower bound', () => {
  const x = h43Fixture(); x.records = [{ id: 'orphan', method: 'schooling', sourceCourseId: 'missing', credits: 40 }];
  const input = x.build(), p = x.progress(input);
  assert.deepEqual([h42S(p).earned, h42S(p).status], [2, 'unknown']);
  assert.equal(h43Evidence(x, input).contributions.length, 1);
  x.rows = [];
  assert.equal(h43Evidence(x, input).contributions.length, 0);
  assert.deepEqual([h42S(x.progress(input)).earned, h42S(x.progress(input)).status], [null, 'unknown']);
});
test('H43 source media conflict is checked even before ordinary hold derived method evidence', () => {
  const x = h43Fixture(); x.records = [mediaRecord(x, { sourceCourseId: x.rows[0].id }),
    { ...mediaRecord(x, { sourceCourseId: x.rows[0].id }), id: 'nonmedia', method: 'correspondence', rawTerm: null }];
  assert.equal(h43Evidence(x).contributions.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
});
for (const name of LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026) test(`H43 H19 boundary excludes ${name} while H19 alone counts global S`, () => {
  const x = h41Fixture(); x.course.canonicalName = name; x.offering.name = name;
  x.rows = [x.official(x, 1, 1)]; const input = x.build();
  const { official, contributions } = h43Evidence(x, input);
  assert.equal(official.allocations.length, 0); assert.equal(contributions.length, 0);
  assert.deepEqual([h42S(x.progress(input)).earned, h42S(x.progress(input)).status], [1, 'partial']);
});
for (const [department, name] of [['日本文学科', '総合特講'], ['史学科', '歴史資料学'], ['地理学科', '現地研究'], ['経済学科', '経済学特講'], ['日本文学科', '書道実技'], ['日本文学科', '基礎特講']]) test(`H43 excludes separate special policy ${department}/${name}`, () => {
  const x = h41Fixture(department); x.course.canonicalName = name; x.offering.name = name;
  x.rows = [x.official(x, 2, 2)];
  assert.equal(h43Evidence(x).contributions.length, 0);
  assert.equal(h42S(x.progress()).status, 'unknown');
});
for (const category of ['外国語', '専門教育']) test(`H43 H42 ${category} union counts global once without releasing local consumers`, () => {
  const x = h41Fixture(), entry = category === '外国語' ? x.add('union-h43', category, '英語', '選択必修') : x;
  const edge = { ...entry.mapping, mappingId: '43434343-4343-4343-8343-000000000001',
    ...(category === '外国語' ? { field: '独語' } : { requirementType: '選択' }) };
  x.f.mappings.push(edge); entry.course.mappingIds.push(edge.mappingId);
  const rule = x.requirement('h43-local-S', { curriculum_category: category }, null, 'min_schooling_credits'); rule.value = 2;
  x.rows = [x.official(entry, 4, 2)]; const input = x.build(), p = x.progress(input);
  const { official, contributions, impact } = h43Evidence(x, input);
  const before = unresolvedSchoolingImpact(official, false, input, x.scope, x.profile);
  assert.equal(contributions.length, 1); assert.equal(impact.globalReferenceUnknown, false);
  assert.deepEqual({ ...impact, globalReferenceUnknown: true }, before);
  assert.deepEqual([h42S(p).earned, h42S(p).status], [2, 'partial']);
  const local = p.requirements.find(r => r.requirementId === rule.id);
  assert.deepEqual([local.earned, local.status], [0, 'unknown']);
  const card = h31Card(p, category === '外国語' ? 'group-foreign' : 'professional-law-schooling');
  assert.deepEqual([card.earned, card.status], [0, 'unknown']);
  if (category === '外国語') assert.equal(h31Card(p, 'professional-law-schooling').status, 'unsatisfied');
  else assert.equal(h31Card(p, 'group-foreign').status, 'unsatisfied');
});
test('H43 known S2 survives a second unresolved quantity without removing ordinary reasons', () => {
  const x = h43Fixture(), other = x.add('unknown-h43', '一般教育', '人文', '選択必修');
  x.rows.push(x.official(other, null, null)); const p = x.progress();
  assert.deepEqual([h42S(p).earned, h42S(p).status], [2, 'unknown']);
  assert.match(p.referenceProgress[0].reason, h41Reason); assert.equal(overall(p), 0);
});
test('H43 frozen authority preserves official aggregate despite component40 and annual credits99', () => {
  const x = h43Fixture(), input = x.build();
  x.records = [mediaRecord(x, { sourceCourseId: x.rows[0].id, credits: 40 })];
  const offering = input.offerings.find(o => o.id === x.offering.id); offering.credits = 99; offering.method = 'schooling';
  x.items = [item(offering, 'earned')];
  const previous = x.progress(input), original = structuredClone({ input, rows: x.rows, records: x.records, profile: x.profile, items: x.items, previous });
  [input, x.rows, x.records, x.profile, x.items, previous].forEach(deepFreeze);
  const { official, contributions } = h43Evidence(x, input);
  assert.equal(official.facts[0].earnedCreditsTotal, 2); assert.equal(contributions[0].schoolingCredits, 2);
  assert.deepEqual(x.progress(input), previous); assert.equal(h42S(previous).earned, 2); assert.equal(overall(previous), 0);
  assert.deepEqual({ input, rows: x.rows, records: x.records, profile: x.profile, items: x.items, previous }, original);
  const noOffering = structuredClone(input); noOffering.offerings = [];
  assert.equal(h42S(x.progress(noOffering, x.rows, [])).earned, 2);
  assert.equal(initialState().schemaVersion, 22);
  assert.equal(input.metadata.graduationCheckComplete, false); assert.equal(input.metadata.sourceLinksReverified, false);
});

test('H43 recognized_overlap remains held and recognition schooling is never added twice', () => {
  const x = h43Fixture(); x.rows[0].earnedCreditsTotal = 4; x.offering.method = 'schooling';
  x.profile.recognizedCredits.professionalCourses = [{ id: 'h43-recognition', offeringId: x.offering.id, courseId: x.offering.courseId, mappingId: x.mapping.mappingId, name: x.course.canonicalName, credits: 4 }];
  const input = x.build(), { official, contributions } = h43Evidence(x, input);
  assert.ok(official.facts[0].diagnostics.includes('recognized_overlap'));
  assert.equal(official.allocations.length, 0); assert.equal(contributions.length, 0);
  assert.deepEqual([h42S(x.progress(input)).earned, h42S(x.progress(input)).status], [null, 'unknown']);
});
test('H43 null source S is not inferred from even all-media components', () => {
  const x = h43Fixture(); x.rows[0].schoolingCreditsTotal = null;
  x.records = [mediaRecord(x, { sourceCourseId: x.rows[0].id, credits: 40 })];
  assert.equal(h43Evidence(x).contributions.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
});
test('H43 zero earned budget cannot acquire positive schooling from records', () => {
  const x = h43Fixture(); x.rows[0].earnedCreditsTotal = 0;
  x.records = [mediaRecord(x, { sourceCourseId: x.rows[0].id, credits: 40 })];
  assert.equal(h43Evidence(x).contributions.length, 0);
  assert.equal(h42S(x.progress()).earned, 0);
});
test('H43 safe quantity can coexist with other profile prerequisites remaining unknown', () => {
  const x = h43Fixture(); x.profile.admissionType = 'unknown'; x.profile.recognizedCredits.schoolingEquivalentCredits = 0;
  assert.equal(h43Evidence(x).contributions.length, 1);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
});
test('H43 unsafe candidate in otherwise safe union excludes the entire contribution', () => {
  const x = h43Fixture();
  const edge = { ...x.mapping, mappingId: '43434343-4343-4343-8343-000000000002', requirementType: '選択', mediaOnly: true };
  x.f.mappings.push(edge); x.course.mappingIds.push(edge.mappingId);
  const input = x.build();
  assert.equal(h43Evidence(x, input).contributions.length, 0);
  assert.deepEqual([h42S(x.progress(input)).earned, h42S(x.progress(input)).status], [null, 'unknown']);
});

// H19 uses a separate global-only contribution; ordinary allocation is unchanged.
function h19Fixture(name = 'データサイエンス入門A') {
  const x = fixture();
  x.course.canonicalName = x.row.rawName = x.offering.name = name;
  x.f.courses[0].canonicalName = name;
  x.mapping.requirementType = '選択';
  x.rows = [x.row]; x.records = []; x.items = [];
  x.progress = () => calculateGraduationProgress(x.items, x.f, x.scope, [], 'not_selected', x.records, x.rows, x.profile);
  return x;
}
function h19Evidence(x) {
  const official = deriveOfficialGraduationFacts(x.rows, x.records, x.f, x.scope, x.profile);
  const held = heldOfficialSchoolingContributions(official, x.rows, x.records, x.f, x.scope, x.profile);
  const contributions = lawExcludedOfficialSchoolingContributions(official, x.rows, x.records, x.f, x.scope, x.profile, held);
  return { official, held, contributions,
    impact: unresolvedSchoolingImpact(official, false, x.f, x.scope, x.profile, [...held, ...contributions]) };
}
const h19Ordinary = p => ({ cards: p.cards.filter(c => c.requirementId !== 'professional-law-schooling' && c.ruleType !== 'min_schooling_credits'),
  requirements: p.requirements.filter(r => r.ruleType !== 'min_schooling_credits'), overall: p.referenceProgress[0], count: p.importedContributionCount });

for (const name of LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026) test(`H19 exact ${name}: S2 once, Law S8 zero, ordinary unchanged for null/0/positive`, () => {
  const x = h19Fixture(name), p = x.progress(), { official, held, contributions, impact } = h19Evidence(x);
  assert.equal(contributions.length, 1); assert.equal(contributions[0].schoolingCredits, 2);
  assert.equal(held.length, 0); assert.equal(impact.globalReferenceUnknown, false); assert.equal(impact.lawProfessionalUnknown, false);
  assert.equal(official.allocations.reduce((sum, a) => sum + (a.schoolingCredits ?? 0), 0), 0);
  assert.deepEqual([h42S(p).earned, h42S(p).status], [2, 'partial']);
  assert.deepEqual([h31Card(p, 'professional-law-schooling').earned, h31Card(p, 'professional-law-schooling').status], [0, 'unsatisfied']);
  const ordinary = h19Ordinary(p);
  for (const s of [null, 0]) {
    x.row.schoolingCreditsTotal = s;
    const other = x.progress();
    assert.deepEqual(h19Ordinary(other), ordinary);
    assert.deepEqual([h42S(other).earned, h42S(other).status], s === null ? [null, 'unknown'] : [0, 'partial']);
    assert.deepEqual(h31Card(other, 'professional-law-schooling'), h31Card(p, 'professional-law-schooling'));
    assert.equal(h19Evidence(x).contributions.length, 0);
  }
});
for (const name of LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026) test(`H19 real catalog ${name}: authoritative Mapping and required method proof`, () => {
  const x = h19Fixture(name); x.f = structuredClone(catalog);
  x.course = x.f.curriculum.courses.find(c => c.canonicalName === name);
  assert.ok(x.course);
  Object.assign(x.row, { curriculumCourseId: x.course.id, candidateCurriculumCourseIds: [x.course.id], courseId: null,
    compositionCredits: x.course.curriculumCredits, earnedCreditsTotal: x.course.curriculumCredits, schoolingCreditsTotal: 2 });
  x.records = [mediaRecord(x, { credits: 40 })];
  const evidence = h19Evidence(x), p = x.progress();
  assert.equal(evidence.contributions.length, 1, JSON.stringify(evidence.official));
  assert.deepEqual([h42S(p).earned, h42S(p).status], [2, 'partial']);
  assert.equal(h31Card(p, 'professional-law-schooling').earned, 0);
  assert.equal(evidence.held.length, 0);
  x.rows.push(structuredClone(x.row));
  assert.equal(h42S(x.progress()).earned, 2, 'one source ID counts once');
});
for (const name of ['情報学入門追加', '追加情報学入門', '情報学入門（追加）', ' 情報学入門', 'データサイエンス入門Ａ', '通常法律科目']) {
  test(`H19 exact boundary ${name} preserves normal global/Law allocation`, () => {
    const x = h19Fixture(name), evidence = h19Evidence(x), p = x.progress();
    assert.equal(evidence.contributions.length, 0);
    assert.equal(evidence.official.allocations[0].schoolingCredits, 2);
    assert.equal(h42S(p).earned, 2); assert.equal(h31Card(p, 'professional-law-schooling').earned, 2);
  });
}
for (const [label, mutate] of [
  ['negative S', x => { x.row.schoolingCreditsTotal = -1; }],
  ['NaN S', x => { x.row.schoolingCreditsTotal = NaN; }],
  ['infinite S', x => { x.row.schoolingCreditsTotal = Infinity; }],
  ['S above earned', x => { x.row.earnedCreditsTotal = 2; x.row.schoolingCreditsTotal = 3; }],
  ['S above composition', x => { x.row.schoolingCreditsTotal = 5; }],
  ['null earned', x => { x.row.earnedCreditsTotal = null; }],
  ['negative earned', x => { x.row.earnedCreditsTotal = -1; }],
  ['NaN earned', x => { x.row.earnedCreditsTotal = NaN; }],
  ['infinite earned', x => { x.row.earnedCreditsTotal = Infinity; }],
  ['earned above composition', x => { x.row.earnedCreditsTotal = 5; }],
  ['missing composition', x => { x.row.compositionCredits = null; }],
  ['composition mismatch', x => { x.row.compositionCredits = 2; }],
  ['invalid composition', x => { x.row.compositionCredits = NaN; }],
  ['unresolved identity', x => { x.row.curriculumCourseId = null; x.row.curriculumMatch = 'unmatched'; x.row.candidateCurriculumCourseIds = []; }],
  ['inconsistent identity', x => { x.row.candidateCurriculumCourseIds = []; }],
  ['duplicate snapshot', x => { x.rows.push({ ...x.row, id: 'duplicate' }); }],
  ['duplicate unknown snapshot', x => { x.rows.push({ ...x.row, id: 'duplicate', earnedCreditsTotal: null, schoolingCreditsTotal: null }); }],
  ['same ID conflicting snapshot', x => { x.rows.push({ ...x.row, schoolingCreditsTotal: 1 }); }],
  ['nonofficial source', x => { x.row.source = 'manual'; }],
  ['legacy curriculum', x => { x.profile.curriculumApplicability = 'legacy_or_transition'; }],
  ['unknown curriculum', x => { x.profile.curriculumApplicability = 'unknown'; }],
  ['recognized exemption', x => { x.row.recognizedExemption = 1; }],
  ['additional enrollment', x => { x.row.additionalEnrollment = 1; }],
  ['invalid exemption', x => { x.row.recognizedExemption = -1; }],
  ['invalid additional enrollment', x => { x.row.additionalEnrollment = NaN; }],
  ['professional recognition overlap', x => { x.profile.recognizedCredits.professionalCourses = [{ id: 'recognition', offeringId: x.offering.id, credits: 4 }]; }],
  ['identity unknown recognition', x => { x.profile.recognizedCredits.professionalCourses = [{ id: 'recognition', offeringId: null, credits: 4 }]; }],
  ['transfer equivalent positive', x => { x.profile.admissionType = 'transfer_second_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = 2; }],
  ['transfer equivalent unknown', x => { x.profile.admissionType = 'transfer_second_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = null; }],
  ['unknown admission equivalent', x => { x.profile.admissionType = 'unknown'; }],
]) test(`H19 ${label.startsWith('transfer equivalent') ? 'H20 coexistence' : 'rejects'} ${label}`, () => {
  const x = h19Fixture(); mutate(x);
  if (label.startsWith('transfer equivalent')) {
    assert.equal(h19Evidence(x).contributions.length, 1);
    const s = h42S(x.progress());
    assert.deepEqual([s.earned, s.status], label.endsWith('positive') ? [4, 'partial'] : [null, 'unknown']);
    return;
  }
  assert.equal(h19Evidence(x).contributions.length, 0);
  assert.equal(h42S(x.progress()).status, 'unknown');
});
for (const [label, mutate] of [
  ['missing Mapping edge', x => { x.course.mappingIds.push('missing'); }],
  ['duplicate Mapping record', x => { x.f.mappings.push({ ...x.mapping }); }],
  ['duplicate Mapping edge', x => { x.course.mappingIds.push(x.mapping.mappingId); }],
  ['duplicate Mapping owner', x => { x.f.curriculum.courses.push({ ...x.course, id: 'other-owner' }); }],
  ['duplicate Course identity', x => { x.f.curriculum.courses.push({ ...x.course }); }],
  ['malformed field', x => { x.mapping.field = 'unknown'; }],
  ['malformed type', x => { x.mapping.requirementType = 'unknown'; }],
  ['malformed method flag', x => { x.mapping.schoolingOnly = null; }],
  ['mapping credits mismatch', x => { x.mapping.curriculumCredits = 2; }],
  ['mapping credits null', x => { x.mapping.curriculumCredits = null; }],
  ['Course credits null', x => { x.course.curriculumCredits = null; }],
  ['Course credits invalid', x => { x.course.curriculumCredits = Infinity; x.mapping.curriculumCredits = Infinity; }],
  ['curriculum source unknown', x => { x.f.curriculum.source = 'unknown'; }],
  ['curriculum schema unknown', x => { x.f.curriculum.schemaVersion = 2; }],
  ['candidate contradiction', x => { const edge = { ...x.mapping, mappingId: 'conflict', requirementType: '選択必修' }; x.f.mappings.push(edge); x.course.mappingIds.push(edge.mappingId); }],
  ['common candidate conflict', x => { const edge = { ...x.mapping, mappingId: 'common', scopeId: x.common, category: '外国語', field: '英語' }; x.f.mappings.push(edge); x.course.mappingIds.push(edge.mappingId); }],
]) test(`H19 rejects unsafe ${label}`, () => {
  const x = h19Fixture(); mutate(x);
  assert.equal(h19Evidence(x).contributions.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
});

test('H19 equivalent safe Mapping descriptors count once without choosing a conflicting candidate', () => {
  const x = h19Fixture(), edge = { ...x.mapping, mappingId: 'equivalent' };
  x.f.mappings.push(edge); x.course.mappingIds.push(edge.mappingId);
  assert.equal(h19Evidence(x).official.facts[0].allocation.kind, 'equivalent');
  assert.equal(h19Evidence(x).contributions.length, 1); assert.equal(h42S(x.progress()).earned, 2);
  x.f.mappings.reverse(); x.course.mappingIds.reverse();
  assert.equal(h42S(x.progress()).earned, 2);
});
test('H19 out_of_scope has no contribution or new global hold', () => {
  const x = h19Fixture(); x.mapping.scopeId = catalog.programs.find(p => p.department === '経済学科').scopeId;
  assert.equal(h19Evidence(x).contributions.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [0, 'partial']);
});
test('H19 other selected department cannot use the Law-only contribution', () => {
  const x = h19Fixture(); x.scope = catalog.programs.find(p => p.department === '経済学科').scopeId;
  x.mapping.scopeId = x.scope;
  assert.equal(h19Evidence(x).contributions.length, 0);
  assert.equal(h19Evidence(x).official.allocations[0].schoolingCredits, 2);
});
for (const mode of ['media-unproven', 'media-proven', 'media-conflict', 'schooling-partial', 'schooling-complete']) test(`H19 method ${mode} requires source proof`, () => {
  const x = h19Fixture();
  if (mode.startsWith('media')) x.mapping.mediaOnly = true;
  if (mode === 'media-proven' || mode === 'media-conflict') x.records = [mediaRecord(x, { credits: 40 })];
  if (mode === 'media-conflict') x.records.push(mediaRecord(x, { id: 'nonmedia', method: 'correspondence', rawTerm: null }));
  if (mode.startsWith('schooling')) x.mapping.schoolingOnly = true;
  if (mode === 'schooling-complete') x.row.schoolingCreditsTotal = 4;
  const safe = ['media-proven', 'schooling-complete'].includes(mode);
  assert.equal(h19Evidence(x).contributions.length, safe ? 1 : 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], safe ? [x.row.schoolingCreditsTotal, 'partial'] : [null, 'unknown']);
  assert.equal(h31Card(x.progress(), 'professional-law-schooling').earned, 0);
});
for (const name of ['データサイエンス入門A', '総合特講']) test(`H19 ${name} never infers null S from media/components/Offering`, () => {
  const x = h19Fixture(name); x.row.schoolingCreditsTotal = null; x.mapping.mediaOnly = true;
  x.records = [mediaRecord(x, { credits: 40 })]; x.offering.method = 'schooling'; x.offering.credits = 99;
  x.items = [item(x.offering, 'earned')];
  assert.equal(h19Evidence(x).contributions.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
});
test('H19 explicit zero versus conflicting media zero remains distinct', () => {
  const x = h19Fixture(); x.row.schoolingCreditsTotal = 0;
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [0, 'partial']);
  x.records = [mediaRecord(x)];
  assert.equal(h19Evidence(x).contributions.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
});
test('H19 zero earned budget cannot obtain positive S', () => {
  const x = h19Fixture(); x.row.earnedCreditsTotal = 0;
  assert.equal(h19Evidence(x).contributions.length, 0); assert.equal(h42S(x.progress()).earned, 0);
});
for (const name of ['他学部・他学科公開科目', '基礎特講', '卒業論文', '法律学演習', '総合特講（追加）']) test(`H19 unrelated special ${name} stays held`, () => {
  const x = h19Fixture(name);
  assert.equal(h19Evidence(x).contributions.length, 0);
  assert.equal(h19Evidence(x).official.allocations.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
  assert.equal(h31Card(x.progress(), 'professional-law-schooling').earned, 0);
});
for (const name of ['他学部公開', '情報学入門']) test(`H19 public Mapping ${name} opens neither global S nor Law S8`, () => {
  const x = h19Fixture(name); x.mapping.requirementType = '公開科目';
  assert.equal(h19Evidence(x).contributions.length, 0);
  assert.equal(h19Evidence(x).official.allocations.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
  assert.equal(h31Card(x.progress(), 'professional-law-schooling').earned, 0);
});
test('H19 source row missing/orphan contributes nothing; separate safe S coexists with unknown', () => {
  const x = h19Fixture(); x.records = [mediaRecord(x, { sourceCourseId: 'missing', credits: 40 })];
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [2, 'unknown']);
  const official = h19Evidence(x).official;
  assert.equal(lawExcludedOfficialSchoolingContributions(official, [], x.records, x.f, x.scope, x.profile).length, 0);
  x.rows = [];
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
});
test('H19 normal allocated S plus H43 plus H19 is exclusive despite source and Planner repetition', () => {
  const x = h41Fixture(); x.course.canonicalName = '情報学入門';
  const normal = x.add('h19-normal', '専門教育', null, '選択', 4, 'schooling', '通常専門科目', x.scope);
  const held = x.add('h19-held', '外国語', '英語', '選択必修');
  const edge = { ...held.mapping, mappingId: '19191919-1919-4191-8191-000000000001', field: '独語' };
  x.f.mappings.push(edge); held.course.mappingIds.push(edge.mappingId);
  x.rows = [x.official(x, 4, 2), x.official(normal, 4, 2), x.official(held, 4, 2)];
  x.rows.push(structuredClone(x.rows[0]));
  x.items = [item(x.offering, 'earned'), item(normal.offering, 'earned'), item(held.offering, 'earned')];
  const input = x.build(), official = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile);
  const h43 = heldOfficialSchoolingContributions(official, x.rows, [], input, x.scope, x.profile);
  const h19 = lawExcludedOfficialSchoolingContributions(official, x.rows, [], input, x.scope, x.profile, h43);
  assert.deepEqual([h43.length, h19.length], [1, 1]);
  assert.equal(new Set([...h43, ...h19].flatMap(c => c.fact.sourceRowIds)).size, 2);
  const p = x.progress(input);
  assert.equal(h42S(p).earned, 6); assert.equal(h31Card(p, 'professional-law-schooling').earned, 2);
  assert.equal(overall(p), 8);
  assert.equal(lawExcludedOfficialSchoolingContributions(official, x.rows, [], input, x.scope, x.profile, [...h43, ...h19]).length, 0);
  // Even if a future allocator supplies S, the extra path cannot spend it again.
  official.allocations.find(a => a.fact === h19[0].fact).schoolingCredits = 2;
  assert.equal(lawExcludedOfficialSchoolingContributions(official, x.rows, [], input, x.scope, x.profile, h43).length, 0);
});
test('H19 H20 synthetic recognition cannot supply S while official overlap is held', () => {
  const x = h19Fixture(); x.offering.method = 'schooling';
  x.profile.recognizedCredits.professionalCourses = [{ id: 'recognition', offeringId: x.offering.id, courseId: x.offering.courseId,
    mappingId: x.mapping.mappingId, name: x.course.canonicalName, credits: 4 }];
  assert.equal(h19Evidence(x).contributions.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
  assert.equal(h31Card(x.progress(), 'professional-law-schooling').earned, 0);
});
test('H19 transfer explicit equivalent zero permits safe official S without adding recognition', () => {
  const x = h19Fixture(); x.profile.admissionType = 'transfer_second_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = 0;
  assert.equal(h19Evidence(x).contributions.length, 1); assert.equal(h42S(x.progress()).earned, 2);
});
test('H19 H42 only global reference is discharged; structured/foreign/ordinary consumers stay identical', () => {
  const x = h41Fixture(); x.course.canonicalName = '総合特講';
  const rule = x.requirement('h19-structured-s', { curriculum_category: '専門教育' }, null, 'min_schooling_credits'); rule.value = 2;
  x.rows = [x.official(x, 4, 2)]; const input = x.build();
  const official = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile);
  const contributions = lawExcludedOfficialSchoolingContributions(official, x.rows, [], input, x.scope, x.profile);
  const before = unresolvedSchoolingImpact(official, false, input, x.scope, x.profile);
  const after = unresolvedSchoolingImpact(official, false, input, x.scope, x.profile, contributions);
  assert.deepEqual({ ...after, globalReferenceUnknown: true }, before);
  const p = x.progress(input), unknown = x.progress(input, [{ ...x.rows[0], schoolingCreditsTotal: null }]);
  assert.deepEqual(p.cards, unknown.cards); assert.deepEqual(p.requirements, unknown.requirements);
  assert.deepEqual(p.referenceProgress[0], unknown.referenceProgress[0]);
  assert.deepEqual([h42S(p).earned, h42S(p).status], [2, 'partial']);
  const local = p.requirements.find(r => r.requirementId === rule.id);
  assert.deepEqual([local.earned, local.status], [0, 'unknown']);
  assert.equal(h31Card(p, 'professional-law-schooling').status, 'unsatisfied');
});
test('H19 frozen authority uses source aggregate only despite components40/Offering99', () => {
  const x = h19Fixture(); x.records = [mediaRecord(x, { credits: 40 })];
  x.offering.method = 'schooling'; x.offering.credits = 99; x.items = [item(x.offering, 'earned')];
  const before = structuredClone({ rows: x.rows, records: x.records, input: x.f, profile: x.profile, items: x.items });
  [x.rows, x.records, x.f, x.profile, x.items].forEach(deepFreeze);
  const p = x.progress(); deepFreeze(p);
  assert.equal(h19Evidence(x).official.facts[0].earnedCreditsTotal, 4);
  assert.equal(h19Evidence(x).contributions[0].schoolingCredits, 2);
  assert.equal(h42S(p).earned, 2); assert.equal(overall(p), 4);
  assert.deepEqual(x.progress(), p);
  assert.deepEqual({ rows: x.rows, records: x.records, input: x.f, profile: x.profile, items: x.items }, before);
  const withoutOffering = structuredClone(x.f); withoutOffering.offerings = [];
  assert.deepEqual(calculateGraduationProgress([], withoutOffering, x.scope, [], 'not_selected', x.records, x.rows, x.profile), p);
  assert.equal(initialState().schemaVersion, 22); assert.equal(p.graduationCheckComplete, false);
  assert.equal(x.f.metadata.sourceLinksReverified, false);
});
for (const name of ['データサイエンス入門A', '総合特講']) test(`H19 ${name} rejects source method conflict even without mediaOnly`, () => {
  const x = h19Fixture(name);
  x.records = [mediaRecord(x), mediaRecord(x, { id: 'other-method', method: 'correspondence', rawTerm: null })];
  assert.equal(h19Evidence(x).contributions.length, 0);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
});
test('H19 transfer equivalent is retained once without official or Planner duplicate', () => {
  const x = h19Fixture(); x.profile.admissionType = 'transfer_second_year'; x.profile.recognizedCredits.schoolingEquivalentCredits = 2;
  x.offering.method = 'schooling'; x.items = [item(x.offering, 'earned')];
  assert.equal(h19Evidence(x).contributions.length, 1);
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [4, 'partial']);
  assert.equal(h31Card(x.progress(), 'professional-law-schooling').earned, 0);
});
test('H19 explicit exemption/additional zero preserves positive S without treating null S as zero', () => {
  const x = h19Fixture(); x.row.recognizedExemption = 0; x.row.additionalEnrollment = 0;
  assert.equal(h42S(x.progress()).earned, 2);
  x.row.schoolingCreditsTotal = null;
  assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [null, 'unknown']);
});

// H14: catalog-valid positive fixtures; malformed relation cases mutate only after attach.
const h14Facts = (x, f = x.build()) => deriveOfficialGraduationFacts(x.rows, x.records, f, x.scope, x.profile);
const h14Recognition = x => x.profile.recognizedCredits.professionalCourses;
const h14Held = (x, f = x.build()) => {
  const result = h14Facts(x, f);
  assert.equal(result.allocations.length, 0);
  assert.ok(result.facts[0].diagnostics.includes('recognized_overlap'));
  return result;
};
for (const mode of ['offering', 'legacy', 'all']) test(`H14 exact ${mode} identity projects through explicit relations`, () => {
  const x = h14Fixture(), row = h14Recognition(x)[0];
  if (mode === 'offering') { row.courseId = null; row.mappingId = null; }
  if (mode === 'legacy') { row.offeringId = null; row.mappingId = null; }
  const f = x.build();
  assert.deepEqual(resolveRecognizedProfessionalCurriculumIdentity(row, f), { kind: 'resolved', curriculumCourseId: x.b.course.id });
  assert.equal(h14Facts(x, f).allocations.length, 1);
});
for (const mode of ['offering', 'legacy', 'all']) test(`H14 same Course ${mode} stays held and contributes at most once`, () => {
  const x = h14Fixture(), row = x.recognize(x.a);
  if (mode === 'offering') { row.courseId = null; row.mappingId = null; }
  if (mode === 'legacy') { row.offeringId = null; row.mappingId = null; }
  x.profile.recognizedCredits.professionalCourses = [row];
  h14Held(x);
  const p = x.progress();
  assert.equal(p.importedContributionCount, 0);
  assert.equal(professional(p).earned, mode === 'legacy' ? 0 : 4);
  assert.equal(overall(p), mode === 'legacy' ? null : 4);
});
for (const [mode, allocated, total] of [['B/C', 1, 12], ['B/A', 0, 8], ['B/unknown', 0, 4]]) test(`H14 all recognized comparable ${mode}`, () => {
  const x = h14Fixture();
  h14Recognition(x).push(mode === 'B/C' ? x.recognize(x.c) : mode === 'B/A' ? x.recognize(x.a)
    : { id: 'unknown', offeringId: null, courseId: null, mappingId: null, name: '別名', credits: 4 });
  assert.equal(h14Facts(x).allocations.length, allocated);
  assert.equal(overall(x.progress()), total);
  if (!allocated) h14Held(x);
  const before = x.progress(); h14Recognition(x).reverse();
  assert.deepEqual(x.progress(), before);
});
for (const name of ['監査科目', '全く異なる科目名']) test(`H14 name-only ${name} is never identity proof`, () => {
  const x = h14Fixture();
  x.profile.recognizedCredits.professionalCourses = [{ id: 'name-only', offeringId: null, courseId: null, mappingId: null, name, credits: 4 }];
  h14Held(x);
});
test('H14 misleading recognition name cannot override exact disjoint or same identity', () => {
  const x = h14Fixture(); h14Recognition(x)[0].name = x.a.course.canonicalName;
  assert.equal(h14Facts(x).allocations.length, 1); assert.equal(overall(x.progress()), 8);
  x.profile.recognizedCredits.professionalCourses = [{ ...x.recognize(x.a), name: '明確に異なる表示名' }];
  h14Held(x); assert.equal(overall(x.progress()), 4);
});
const h14BrokenRelations = [
  ['missing offering', (x, f, r) => { r.offeringId = 'missing'; }],
  ['unknown legacy', (x, f, r) => { r.courseId = 'missing'; }],
  ['mapping alone', (x, f, r) => { r.offeringId = null; r.courseId = null; }],
  ['missing annual relation', (x, f) => { f.curriculum.offeringRelations = f.curriculum.offeringRelations.filter(r => r.offeringId !== x.b.offering.id); }],
  ['ambiguous annual relation', (x, f) => { const r = f.curriculum.offeringRelations.find(r => r.offeringId === x.b.offering.id); r.curriculumCourseId = null; r.candidateCurriculumCourseIds.push(x.a.course.id); }],
  ['duplicate annual relation', (x, f) => { f.curriculum.offeringRelations.push({ ...f.curriculum.offeringRelations.find(r => r.offeringId === x.b.offering.id) }); }],
  ['stale joined id', (x, f) => { f.offerings.find(o => o.id === x.b.offering.id).curriculumCourseId = x.a.course.id; }],
  ['stale annual mapping', (x, f) => { f.offerings.find(o => o.id === x.b.offering.id).mappingIds = [x.a.mapping.mappingId]; }],
  ['duplicate offering', (x, f) => { f.offerings.push({ ...f.offerings.find(o => o.id === x.b.offering.id) }); }],
  ['unmatched offering', (x, f) => { f.offerings.find(o => o.id === x.b.offering.id).resolutionStatus = 'manual_review'; }],
  ['missing legacy relation', (x, f) => { f.curriculum.legacyCourseRelations = f.curriculum.legacyCourseRelations.filter(r => r.legacyCourseId !== x.b.offering.courseId); }],
  ['ambiguous legacy relation', (x, f) => { const r = f.curriculum.legacyCourseRelations.find(r => r.legacyCourseId === x.b.offering.courseId); r.curriculumCourseId = null; r.candidateCurriculumCourseIds.push(x.a.course.id); }],
  ['duplicate legacy relation', (x, f) => { f.curriculum.legacyCourseRelations.push({ ...f.curriculum.legacyCourseRelations.find(r => r.legacyCourseId === x.b.offering.courseId) }); }],
  ['unknown Mapping', (x, f, r) => { r.mappingId = 'missing'; }],
  ['conflicting courseId', (x, f, r) => { r.courseId = x.a.offering.courseId; }],
  ['conflicting mappingId', (x, f, r) => { r.mappingId = x.a.mapping.mappingId; }],
  ['duplicate Mapping', (x, f) => { f.mappings.push({ ...x.b.mapping }); }],
  ['duplicate owner', (x, f) => { f.curriculum.courses.push({ ...x.b.course, id: 'duplicate-owner' }); }],
  ['duplicate Course ID', (x, f) => { f.curriculum.courses.push({ ...x.b.course, mappingIds: [x.c.mapping.mappingId] }); }],
  ['missing Course', (x, f) => { f.curriculum.courses = f.curriculum.courses.filter(c => c.id !== x.b.course.id); }],
  ['missing Course edge', (x, f) => { f.curriculum.courses.find(c => c.id === x.b.course.id).mappingIds.push('missing'); }],
  ['duplicate Course edge', (x, f) => { f.curriculum.courses.find(c => c.id === x.b.course.id).mappingIds.push(x.b.mapping.mappingId); }],
  ['empty candidates', (x, f) => { f.curriculum.offeringRelations.find(r => r.offeringId === x.b.offering.id).candidateCurriculumCourseIds = []; }],
  ['duplicate candidates', (x, f) => { f.curriculum.offeringRelations.find(r => r.offeringId === x.b.offering.id).candidateCurriculumCourseIds.push(x.b.course.id); }],
  ['inconsistent candidates', (x, f) => { f.curriculum.offeringRelations.find(r => r.offeringId === x.b.offering.id).candidateCurriculumCourseIds = [x.a.course.id]; }],
  ['legacy member conflict', (x, f) => { f.offerings.find(o => o.id === x.c.offering.id).courseId = x.b.offering.courseId; }],
  ['future source', (x, f) => { f.curriculum.source = 'future'; }],
  ['future schema', (x, f) => { f.curriculum.schemaVersion = 2; }],
];
for (const [label, change] of h14BrokenRelations) test(`H14 unsafe recognition ${label} holds every professional fact`, () => {
  const x = h14Fixture(), f = x.build(), row = h14Recognition(x)[0]; change(x, f, row);
  assert.equal(resolveRecognizedProfessionalCurriculumIdentity(row, f).kind, 'unresolved');
  x.rows.push(x.official(x.c, 4, 0));
  const result = h14Held(x, f);
  assert.ok(result.facts.every(fact => fact.diagnostics.includes('recognized_overlap')));
});
for (const same of [false, true]) test(`H14 per-fact localization with two official Courses same=${same}`, () => {
  const x = h14Fixture(); x.rows.push(x.official(x.c, 4, 0));
  if (same) x.profile.recognizedCredits.professionalCourses = [x.recognize(x.a)];
  const result = h14Facts(x);
  assert.deepEqual(result.allocations.map(a => a.fact.curriculumCourseId).sort(), (same ? [x.c.course.id] : [x.a.course.id, x.c.course.id]).sort());
  assert.equal(overall(x.progress()), same ? 8 : 12);
  assert.equal(professional(x.progress()).details[0].earned, same ? 2 : 3);
});
test('H14 released allocation reaches structured ordinary/completion/S, cards and reference once', () => {
  const x = h14Fixture();
  const ordinary = x.requirement('h14-ordinary', { curriculum_category: '専門教育' });
  const full = x.requirement('h14-full', { curriculum_category: '専門教育' }, { full_course_credits_required: true, min_courses: 2 });
  const count = x.requirement('h14-count', { curriculum_category: '専門教育' }, null, 'min_courses');
  const s = x.requirement('h14-s', { course_name: x.a.course.canonicalName }, null, 'min_schooling_credits');
  const p = x.progress();
  for (const [rule, expected] of [[ordinary, 8], [full, 8], [count, 2], [s, 2]]) assert.equal(p.requirements.find(r => r.requirementId === rule.id).earned, expected);
  assert.equal(h31Card(p, 'professional-law-total').earned, 8);
  assert.equal(h31Card(p, 'professional-law-schooling').earned, 2);
  assert.equal(p.referenceProgress[1].earned, 2);
  assert.equal(h31Card(p, 'group-foreign').status, 'unsatisfied');
  assert.equal(p.graduationCheckComplete, false);
});
test('H14 Law overflow counts released A and recognition B in exclusive buckets', () => {
  const x = h14Fixture();
  for (let i = 0; i < 7; i++) {
    const entry = x.add(`h14-full-${i}`, '専門教育', null, '選択必修', 4, 'correspondence', `完成${i}`, x.scope);
    x.rows.push(x.official(entry, 4, 0));
  }
  const p = x.progress();
  assert.equal(professional(p).earned, 32);
  assert.equal(professional(p).details[0].earned, 9);
  assert.equal(h31Card(p, 'professional-law-elective').earned, 4);
  assert.equal(h31Card(p, 'professional-law-total').earned, 36);
  assert.equal(overall(p), 36);
});

const h14OfficialGuards = [
  ['special', x => { x.a.course.canonicalName = '基礎特講'; }],
  ['repeatable', x => { x.a.course.canonicalName = '法律学演習'; }],
  ['public', x => { x.a.mapping.requirementType = '公開科目'; }],
  ['partial outside H12', x => { x.rows[0].earnedCreditsTotal = 1; }],
  ['H12 S0', x => { x.rows[0].earnedCreditsTotal = 2; x.rows[0].schoolingCreditsTotal = 0; }],
  ['duplicate official', x => { x.rows.push({ ...x.rows[0], id: 'another-source' }); }],
  ['mapping conflict', x => { const m = { ...x.a.mapping, mappingId: 'conflict', requirementType: '選択' }; x.f.mappings.push(m); x.a.course.mappingIds.push(m.mappingId); }],
  ['legacy curriculum', x => { x.profile.curriculumApplicability = 'legacy_or_transition'; }],
  ['unknown curriculum', x => { x.profile.curriculumApplicability = 'unknown'; }],
  ['unsafe composition', x => { x.rows[0].compositionCredits = 8; }],
  ['unsafe Mapping field', x => { x.a.mapping.field = 'unsafe'; }],
  ['exemption', x => { x.rows[0].recognizedExemption = 1; }],
  ['additional', x => { x.rows[0].additionalEnrollment = 1; }],
  ['media evidence', x => { x.a.mapping.mediaOnly = true; }],
  ['schooling evidence', x => { x.a.mapping.schoolingOnly = true; }],
  ['official duplicate owner', x => { x.f.curriculum.courses.push({ ...x.a.course, id: 'other-owner' }); }],
];
for (const [label, change] of h14OfficialGuards) test(`H14 disjoint recognition cannot bypass ${label}`, () => {
  const x = h14Fixture(); x.build(); change(x);
  assert.equal(resolveRecognizedProfessionalCurriculumIdentity(h14Recognition(x)[0], x.f).kind, 'resolved');
  assert.equal(h14Facts(x, x.f).allocations.length, 0);
});
test('H14 H12 safe partial remains completed0 and cannot spend recognition as a completion', () => {
  const x = h14Fixture(); x.rows[0].earnedCreditsTotal = 2;
  const result = h14Facts(x), p = x.progress();
  assert.deepEqual(result.allocations.map(a => [a.credits, a.completedCredits, a.schoolingCredits]), [[2, 0, 2]]);
  assert.equal(professional(p).details[0].earned, 1);
  assert.equal(overall(p), 4);
  assert.equal(h31Card(p, 'professional-law-schooling').earned, 2);
});
test('H14 official aggregate alone owns quantity despite components40 annual99 recognition7', () => {
  const x = h14Fixture(); x.a.offering.credits = 99; h14Recognition(x)[0].credits = 7;
  x.records = [{ id: 'component40', source: 'hosei_import', sourceCourseId: x.rows[0].id, method: 'schooling', rawTerm: '夏', credits: 40 }];
  const f = x.build(), inputs = { f, rows: x.rows, records: x.records, profile: x.profile, items: x.items };
  const snapshot = structuredClone(inputs); deepFreeze(inputs);
  assert.equal(graduationProfileValidationError(x.profile), null);
  const result = h14Facts(x, f), p = x.progress(f);
  assert.deepEqual(result.allocations.map(a => [a.credits, a.completedCredits, a.schoolingCredits]), [[4, 4, 2]]);
  assert.equal(overall(p), 8);
  assert.deepEqual(inputs, snapshot);
  assert.equal(initialState().schemaVersion, 22);
});
for (const status of ['earned', 'planned', 'in_progress', 'waiting']) test(`H14 existing recognition Planner item ${status} keeps synthetic dedupe semantics`, () => {
  const x = h14Fixture(); x.items = [item(x.b.offering, status)];
  const snapshot = structuredClone(x.items), p = x.progress();
  assert.equal(overall(p), status === 'earned' ? 8 : 4);
  assert.equal(professional(p).planned, status === 'planned' ? 4 : 0);
  assert.equal(professional(p).inProgress, status === 'in_progress' ? 4 : 0);
  assert.deepEqual(x.items, snapshot);
});
test('H14 earned official duplicate and separate recognition do not duplicate either Course', () => {
  const x = h14Fixture(); x.items = [item(x.a.offering, 'earned'), item(x.b.offering, 'earned')];
  assert.equal(overall(x.progress()), 8);
  assert.equal(professional(x.progress()).details[0].earned, 2);
  assert.equal(x.items.length, 2);
});
test('H14 same official/recognition with existing earned item preserves conservative existing loss boundary', () => {
  const x = h14Fixture(); x.profile.recognizedCredits.professionalCourses = [x.recognize(x.a)];
  x.items = [item(x.a.offering, 'earned')];
  h14Held(x);
  // Existing official-priority removal happens before recognition synthesis,
  // whose original-items dedupe still suppresses the same earned item.
  assert.equal(professional(x.progress()).earned, 0);
  assert.equal(x.items[0].status, 'earned');
});
test('H14 H19 guard stays closed even after ordinary disjoint release', () => {
  const x = h14Fixture(); x.a.course.canonicalName = 'データサイエンス入門A';
  const f = x.build(), result = h14Facts(x, f), p = x.progress(f);
  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0].schoolingCredits, null);
  assert.deepEqual(lawExcludedOfficialSchoolingContributions(result, x.rows, [], f, x.scope, x.profile), []);
  assert.equal(h31Card(p, 'professional-law-schooling').earned, 0);
  assert.deepEqual([p.referenceProgress[1].earned, p.referenceProgress[1].status], [null, 'unknown']);
});
test('H14 H43 guard stays closed for held partial with safe disjoint recognition', () => {
  const x = h14Fixture(); x.rows[0].earnedCreditsTotal = 1;
  x.rows[0].schoolingCreditsTotal = 1;
  const f = x.build(), result = h14Facts(x, f);
  assert.equal(result.allocations.length, 0);
  assert.deepEqual(heldOfficialSchoolingContributions(result, x.rows, [], f, x.scope, x.profile), []);
  assert.equal(x.progress(f).referenceProgress[1].earned, null);
});
for (const s of [null, 2]) test(`H14 H20 transfer S equivalent ${s} retains normal S independently`, () => {
  const x = h14Fixture(); x.profile.admissionType = 'other_transfer'; x.profile.recognizedCredits.schoolingEquivalentCredits = s;
  const result = h14Facts(x), p = x.progress();
  assert.equal(result.allocations[0].credits, 4);
  assert.equal(result.allocations[0].schoolingCredits, 2);
  assert.equal(p.referenceProgress[1].earned, 2 + (s ?? 0));
  assert.equal(p.referenceProgress[1].status, s === null ? 'unknown' : 'partial');
});
test('H14 recognition S and normal official S use existing separate consumers once', () => {
  const x = h14Fixture(); x.b.offering.method = 'schooling';
  const p = x.progress();
  assert.equal(overall(p), 8);
  assert.equal(p.referenceProgress[1].earned, 2);
  assert.equal(h31Card(p, 'professional-law-schooling').earned, 2);
});
test('H14 official annual Offering may disappear without becoming historical authority', () => {
  const x = h14Fixture(), f = x.build(), before = h14Facts(x, f);
  f.offerings = f.offerings.filter(o => o.id !== x.a.offering.id);
  assert.deepEqual(h14Facts(x, f), before);
  assert.equal(overall(x.progress(f)), 8);
});
test('H14 legacy-only exact crosswalk survives absent annual members without synthesizing recognition', () => {
  const x = h14Fixture(), f = x.build(), r = h14Recognition(x)[0];
  r.offeringId = null; r.mappingId = null;
  f.offerings = f.offerings.filter(o => o.courseId !== r.courseId);
  assert.deepEqual(resolveRecognizedProfessionalCurriculumIdentity(r, f), { kind: 'resolved', curriculumCourseId: x.b.course.id });
  assert.equal(overall(x.progress(f)), 4);
});

test('H14 equivalent Mapping edges share one identity without choosing a candidate', () => {
  const x = h14Fixture();
  const m = { ...x.b.mapping, mappingId: '14141414-1414-4141-8141-000000000001' };
  x.f.mappings.push(m); x.b.course.mappingIds.push(m.mappingId); x.b.offering.mappingIds.push(m.mappingId);
  h14Recognition(x)[0].mappingId = m.mappingId;
  assert.deepEqual(resolveRecognizedProfessionalCurriculumIdentity(h14Recognition(x)[0], x.build()), { kind: 'resolved', curriculumCourseId: x.b.course.id });
  assert.equal(overall(x.progress()), 8);
});
test('H14 same identity has no duplicate structured credit or completion', () => {
  const x = h14Fixture(); x.profile.recognizedCredits.professionalCourses = [x.recognize(x.a)];
  const credit = x.requirement('h14-same-credit', { curriculum_category: '専門教育' }, { full_course_credits_required: true });
  const count = x.requirement('h14-same-count', { curriculum_category: '専門教育' }, null, 'min_courses');
  const p = x.progress();
  assert.equal(p.requirements.find(r => r.requirementId === credit.id).earned, 4);
  assert.equal(p.requirements.find(r => r.requirementId === count.id).earned, 1);
  assert.equal(professional(p).details[0].earned, 1);
  assert.equal(overall(p), 4);
});
for (const department of ['法律学科', '日本文学科', '史学科', '地理学科', '経済学科', '商業学科']) test(`H14 real catalog UI-produced recognition ${department} compares institutional Courses`, () => {
  const x = fixture(department); x.f = catalog;
  const eligible = catalog.offerings.flatMap(offering => {
    const mappings = offering.mappingIds.flatMap(id => catalog.mappings.find(m => m.mappingId === id) ?? [])
      .filter(m => m.scopeId === x.scope && m.category === '専門教育');
    if (offering.resolutionStatus !== 'matched' || offering.credits === null || mappings.length !== 1
      || mappings[0].curriculumCredits === null || mappings[0].curriculumCredits > offering.credits
      || offering.name === '卒業論文' || /史学演習|史特講|歴史資料学/.test(offering.name)) return [];
    const r = { id: offering.id, offeringId: offering.id, courseId: offering.courseId, mappingId: mappings[0].mappingId, name: offering.name, credits: offering.credits };
    const resolved = resolveRecognizedProfessionalCurriculumIdentity(r, catalog);
    if (resolved.kind !== 'resolved') return [];
    const course = catalog.curriculum.courses.find(c => c.id === resolved.curriculumCourseId);
    const row = { ...x.row, curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id], rawName: course.canonicalName,
      compositionCredits: course.curriculumCredits, earnedCreditsTotal: course.curriculumCredits, schoolingCreditsTotal: 0 };
    return deriveOfficialGraduationFacts([row], [], catalog, x.scope, x.profile).allocations.length ? [{ r, row }] : [];
  });
  assert.ok(eligible.length >= 2);
  const a = eligible[0], b = eligible.find(e => e.row.curriculumCourseId !== a.row.curriculumCourseId);
  assert.ok(b);
  x.profile.recognizedCredits.professionalCourses = [b.r];
  assert.equal(deriveOfficialGraduationFacts([a.row], [], catalog, x.scope, x.profile).allocations.length, 1);
  x.profile.recognizedCredits.professionalCourses = [a.r];
  assert.equal(deriveOfficialGraduationFacts([a.row], [], catalog, x.scope, x.profile).allocations.length, 0);
});

// H20 source / consumer matrix. Aggregate recognition is global-only.
for (const recognizedS of [null, 0, 2]) for (const officialS of [null, 0, 2]) {
  test(`H20 global official S${officialS} and recognition S${recognizedS} keep independent axes`, () => {
    const x = h20Normal(recognizedS, officialS), p = x.progress(), s = h42S(p);
    const known = (officialS ?? 0) + (recognizedS ?? 0);
    assert.deepEqual([s.earned, s.status, s.recognizedCredits],
      [officialS === null && known === 0 ? null : known, officialS === null || recognizedS === null ? 'unknown' : 'partial', recognizedS]);
    assert.equal(professional(p).earned, 4);
    assert.equal(h31Card(p, 'professional-law-schooling').earned, officialS ?? 0);
  });
}
for (const recognizedS of [null, 0, 2]) for (const method of ['correspondence', 'schooling']) {
  test(`H20 synthetic professional ${method} recognition S${recognizedS} cannot enter any S consumer`, () => {
    const x = h20Profile(h14Fixture(), recognizedS); x.b.offering.method = method;
    const ordinary = x.requirement('h20-ordinary', { course_name: x.b.course.canonicalName }); ordinary.value = 4;
    const recognized = x.requirement('h20-recognized-S', { course_name: x.b.course.canonicalName }, null, 'min_schooling_credits'); recognized.value = 2;
    const normal = x.requirement('h20-normal-S', { course_name: x.a.course.canonicalName }, null, 'min_schooling_credits'); normal.value = 2;
    const p = x.progress(), get = r => p.requirements.find(c => c.requirementId === r.id);
    assert.deepEqual([get(ordinary).earned, get(ordinary).status], [4, 'satisfied']);
    assert.deepEqual([get(recognized).earned, get(recognized).status], [0, 'unsatisfied']);
    assert.deepEqual([get(normal).earned, get(normal).status], [2, 'satisfied']);
    assert.equal(professional(p).earned, 8); assert.equal(overall(p), 12); // profile's unallocated4 remains ordinary-only
    assert.equal(h31Card(p, 'professional-law-schooling').earned, 2);
    assert.deepEqual([h42S(p).earned, h42S(p).status], [2 + (recognizedS ?? 0), recognizedS === null ? 'unknown' : 'partial']);
  });
}
for (const recognizedS of [null, 0, 2]) for (const learnerStatus of ['earned', 'planned', 'in_progress', 'waiting']) {
  test(`H20 learner ${learnerStatus} schooling remains distinct from synthetic recognition S${recognizedS}`, () => {
    const x = h20Profile(h14Fixture(), recognizedS); x.b.offering.method = 'schooling';
    x.items = [item(x.b.offering, learnerStatus)];
    const p = x.progress();
    assert.equal(professional(p).earned, learnerStatus === 'earned' ? 8 : 4);
    assert.equal(h31Card(p, 'professional-law-schooling').earned, 2 + (learnerStatus === 'earned' ? 4 : 0));
    assert.equal(h42S(p).earned, 2 + (learnerStatus === 'earned' ? 4 : 0) + (recognizedS ?? 0));
    assert.equal(h42S(p).recognizedCredits, recognizedS);
  });
}
for (const recognizedS of [null, 0, 2]) test(`H20 normal Planner plus official plus recognition S${recognizedS} owns each source once`, () => {
  const x = h20Normal(recognizedS), learner = x.add('h20-learner', '専門教育', null, '選択', 4, 'schooling', '独立履修', x.scope);
  x.offering.method = 'schooling';
  x.items = [item(learner.offering, 'earned'), item(x.offering, 'earned')];
  x.rows.push(structuredClone(x.rows[0]));
  const p = x.progress();
  assert.equal(h42S(p).earned, 6 + (recognizedS ?? 0));
  assert.equal(h31Card(p, 'professional-law-schooling').earned, 6);
  assert.equal(p.importedContributionCount, 1);
  assert.equal(h42S(p).status, recognizedS === null ? 'unknown' : 'partial');
});
for (const recognizedS of [null, 0, 2]) test(`H20 H19 H43 allocation accounted sets with recognition S${recognizedS} are disjoint`, () => {
  const x = h20Normal(recognizedS);
  const excluded = x.add('h20-law13', '専門教育', null, '選択', 4, 'schooling', '情報学入門', x.scope);
  const held = x.add('h20-held', '外国語', '英語', '選択必修');
  const edge = { ...held.mapping, mappingId: '20202020-2020-4020-8020-000000000001', field: '独語' };
  x.f.mappings.push(edge); held.course.mappingIds.push(edge.mappingId);
  x.rows.push(x.official(excluded, 4, 2), x.official(held, 4, 2));
  x.rows.push(...structuredClone(x.rows));
  x.items = [x.offering, excluded.offering, held.offering].map(o => item(o, 'earned'));
  const input = x.build(), facts = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile);
  const h43 = heldOfficialSchoolingContributions(facts, x.rows, [], input, x.scope, x.profile);
  const h19 = lawExcludedOfficialSchoolingContributions(facts, x.rows, [], input, x.scope, x.profile, h43);
  const ids = [...facts.allocations.filter(a => a.schoolingCredits !== null), ...h43, ...h19].flatMap(a => a.fact.sourceRowIds);
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3);
  assert.deepEqual([h43.length, h19.length], [1, 1]);
  assert.equal(lawExcludedOfficialSchoolingContributions(facts, x.rows, [], input, x.scope, x.profile, [...h43, ...h19]).length, 0);
  const p = x.progress(input);
  assert.equal(h42S(p).earned, 6 + (recognizedS ?? 0));
  assert.equal(h31Card(p, 'professional-law-schooling').earned, 2);
  assert.equal(h42Language(p, '英語').schooling, 0); assert.equal(h42Language(p, '独語').schooling, 0);
  assert.equal(h42S(p).status, recognizedS === null ? 'unknown' : 'partial');
});
for (const recognizedS of [null, 0, 2]) for (const officialS of [null, 2]) {
  test(`H20 foreign ordinary O4/S${officialS} cannot borrow global recognized S${recognizedS}`, () => {
    const x = h20Profile(h41Fixture(), recognizedS), foreign = x.add('h20-language', '外国語', '英語', '選択必修');
    x.rows = [x.official(foreign, 4, officialS)];
    const p = x.progress(), c = h31Card(p, 'group-foreign');
    assert.deepEqual([c.earned, c.status], [4, officialS === null ? 'unknown' : 'satisfied']);
    assert.equal(h42Language(p, '英語').schooling, officialS ?? 0);
    assert.equal(h31Card(p, 'professional-law-schooling').earned, 0);
  });
}
for (const recognizedS of [null, 0, 2]) for (const foreignS of [null, 0, 1, 2]) {
  test(`H20 H38 language-specific S${foreignS} is independent from global recognition S${recognizedS}`, () => {
    const x = h20Normal(recognizedS);
    x.profile.recognizedCredits.foreignLanguage = { mode: 'recognized', credits: 4, language: 'english', schoolingEquivalentCredits: foreignS };
    const p = x.progress(), c = h31Card(p, 'group-foreign');
    assert.deepEqual([c.earned, c.status], [4, foreignS === null ? 'unknown' : foreignS < 2 ? 'unsatisfied' : 'satisfied']);
    assert.equal(h42S(p).earned, 2 + (recognizedS ?? 0));
    assert.equal(h31Card(p, 'professional-law-schooling').earned, 2);
    if (foreignS === null) assert.match(c.reason, /スクーリング相当認定単位が未確認/);
  });
}
for (const recognizedS of [null, 0, 2]) for (const target of [2, 4]) {
  test(`H20 structured S${target} with genuine target uncertainty retains lower bound and recognition S${recognizedS}`, () => {
    const x = h20Normal(recognizedS), extra = x.add('h20-unknown', '専門教育', null, '選択必修', 4, 'correspondence', '不明S科目', x.scope);
    const rule = x.requirement('h20-structured', { curriculum_category: '専門教育' }, null, 'min_schooling_credits'); rule.value = target;
    const named = x.requirement('h20-named', { course_name: x.course.canonicalName }, null, 'min_schooling_credits'); named.value = 4;
    x.rows.push(x.official(extra, 4, null));
    const p = x.progress(), r = p.requirements.find(c => c.requirementId === rule.id), n = p.requirements.find(c => c.requirementId === named.id);
    assert.deepEqual([r.earned, r.status], [2, target === 2 ? 'satisfied' : 'unknown']);
    assert.deepEqual([n.earned, n.status], [2, 'unsatisfied']);
    assert.equal(h42S(p).earned, 2 + (recognizedS ?? 0)); assert.equal(h42S(p).status, 'unknown');
  });
}
for (const source of ['H19', 'H43']) for (const recognizedS of [null, 2]) {
  test(`H20 ${source} never feeds structured or foreign S with recognition S${recognizedS}`, () => {
    const x = h20Profile(h41Fixture(source === 'H19' ? '法律学科' : '日本文学科'), recognizedS);
    if (source === 'H19') x.course.canonicalName = '情報学入門';
    x.rows = [x.official(x, source === 'H19' ? 4 : 2, 2)];
    const rule = x.requirement('h20-global-only', { course_name: x.course.canonicalName }, null, 'min_schooling_credits'); rule.value = 2;
    const p = x.progress(), r = p.requirements.find(c => c.requirementId === rule.id);
    assert.deepEqual([r.earned, r.status], [0, 'unknown']);
    assert.equal(h42S(p).earned, 2 + (recognizedS ?? 0));
    assert.equal(h42Language(p, '英語').schooling, 0);
    if (source === 'H19') assert.equal(h31Card(p, 'professional-law-schooling').earned, 0);
    else assert.equal(p.importedContributionCount, 0);
  });
}
for (const recognizedS of [null, 2]) for (const guard of ['negative S', 'S above earned', 'S above composition', 'media conflict', 'recognizedExemption', 'additionalEnrollment', 'duplicate', 'identity', 'method evidence']) {
  test(`H20 unsafe official ${guard} remains conservative with recognition S${recognizedS}`, () => {
    const x = h20Normal(recognizedS), row = x.rows[0];
    if (guard === 'negative S') row.schoolingCreditsTotal = -1;
    if (guard === 'S above earned') row.schoolingCreditsTotal = 3, row.earnedCreditsTotal = 2;
    if (guard === 'S above composition') row.schoolingCreditsTotal = 5;
    if (guard === 'media conflict') { row.schoolingCreditsTotal = 0; x.records = [mediaRecord(x, { sourceCourseId: row.id })]; }
    if (guard === 'recognizedExemption') row.recognizedExemption = 2;
    if (guard === 'additionalEnrollment') row.additionalEnrollment = 2;
    if (guard === 'duplicate') x.rows.push({ ...row, id: 'h20-other-source' });
    if (guard === 'identity') row.curriculumMatch = 'unmatched', row.curriculumCourseId = null;
    if (guard === 'method evidence') x.mapping.mediaOnly = true;
    const input = x.build(), facts = deriveOfficialGraduationFacts(x.rows, x.records, input, x.scope, x.profile);
    assert.equal(facts.allocations.reduce((sum, a) => sum + (a.schoolingCredits ?? 0), 0), 0);
    assert.deepEqual(heldOfficialSchoolingContributions(facts, x.rows, x.records, input, x.scope, x.profile), []);
    const p = x.progress(input);
    assert.deepEqual([h42S(p).earned, h42S(p).status], [recognizedS === null ? null : recognizedS, 'unknown']);
    if (['recognizedExemption', 'additionalEnrollment'].includes(guard)) assert.equal(facts.allocations.length, 0);
  });
}
for (const mode of ['none', 'disjoint', 'same', 'unresolved', 'inconsistent']) {
  test(`H20 H14 ${mode} preserves ordinary identity boundary with positive recognition S`, () => {
    const x = h20Profile(h14Fixture(), 2);
    if (mode === 'none') x.profile.recognizedCredits.professionalCourses = [];
    if (mode === 'same') x.profile.recognizedCredits.professionalCourses = [x.recognize(x.a)];
    if (mode === 'unresolved') x.profile.recognizedCredits.professionalCourses[0].offeringId = 'missing';
    if (mode === 'inconsistent') x.profile.recognizedCredits.professionalCourses[0].courseId = x.a.offering.courseId;
    const input = x.build(), facts = h14Facts(x, input), p = x.progress(input);
    const safe = ['none', 'disjoint'].includes(mode);
    assert.equal(facts.allocations.length, safe ? 1 : 0);
    assert.equal(facts.facts[0].diagnostics.includes('recognized_overlap'), !safe);
    assert.equal(professional(p).earned, mode === 'disjoint' ? 8 : mode === 'unresolved' ? 0 : 4);
    assert.equal(h42S(p).earned, safe ? 4 : 2);
    assert.equal(h31Card(p, 'professional-law-schooling').earned, safe ? 2 : 0);
  });
}
test('H20 frozen inputs keep source authority and no persisted bookkeeping', () => {
  const x = h20Profile(h14Fixture(), null); x.b.offering.method = 'schooling';
  const input = x.build(); input.offerings.find(o => o.id === x.offering.id).credits = 99;
  x.items = [item(x.offering, 'earned')];
  x.records = [mediaRecord(x, { sourceCourseId: x.rows[0].id, credits: 40, rawTerm: '夏' })];
  const args = [x.items, input, x.scope, [], 'not_selected', x.records, x.rows, x.profile];
  const before = structuredClone(args), previous = calculateGraduationProgress(...args), saved = structuredClone(previous);
  deepFreeze(args); deepFreeze(previous);
  const p = calculateGraduationProgress(...args);
  assert.deepEqual(args, before); assert.deepEqual(previous, saved); assert.deepEqual(p, previous);
  assert.equal(h42S(p).earned, 2); assert.equal(h42S(p).recognizedCredits, null); assert.equal(h42S(p).status, 'unknown');
  assert.equal(professional(p).earned, 8);
  assert.equal(initialState().schemaVersion, 22); assert.equal(p.graduationCheckComplete, false);
  assert.equal(input.metadata.sourceLinksReverified, false);
});
for (const name of LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026) for (const recognizedS of [null, 2]) {
  test(`H20 H19 exact ${name} plus recognition S${recognizedS} never enters Law S8`, () => {
    const x = h20Profile(h19Fixture(name), recognizedS); x.rows.push(structuredClone(x.row));
    const e = h19Evidence(x), p = x.progress();
    assert.deepEqual([e.held.length, e.contributions.length], [0, 1]);
    assert.equal(h42S(p).earned, 2 + (recognizedS ?? 0));
    assert.equal(h31Card(p, 'professional-law-schooling').earned, 0);
  });
}
for (const source of ['H19', 'H43']) test(`H20 ${source} conflicting repeated source ID never chooses another S snapshot`, () => {
  const x = h20Profile(source === 'H19' ? h19Fixture() : h43Fixture(), 2);
  x.rows.push({ ...x.rows[0], schoolingCreditsTotal: 1 });
  for (const rows of [x.rows, x.rows.slice().reverse()]) {
    x.rows = rows;
    const e = source === 'H19' ? h19Evidence(x) : h43Evidence(x);
    assert.equal(e.contributions.length, 0);
    assert.deepEqual([h42S(x.progress()).earned, h42S(x.progress()).status], [2, 'unknown']);
  }
});
for (const route of ['first_year', 'transfer_second_year', 'transfer_third_year', 'bachelor_admission', 'other_transfer', 'hosei_internal_transfer']) {
  for (const recognizedS of [null, 0, 2]) test(`H20 no schooling evidence route ${route} recognition S${recognizedS} fabricates no normal S`, () => {
    const x = h20Profile(h14Fixture(), recognizedS); x.profile.admissionType = route; x.rows = [];
    // An annual schooling method on a synthetic item is still no attendance evidence.
    x.b.offering.method = 'schooling';
    const p = x.progress(), s = h42S(p);
    assert.equal(professional(p).earned, 4);
    assert.equal(s.earned, route === 'first_year' ? 0 : recognizedS ?? 0);
    assert.equal(s.recognizedCredits, route === 'first_year' ? 0 : recognizedS);
    assert.equal(s.status, route !== 'first_year' && recognizedS === null ? 'unknown' : 'partial');
    assert.equal(h31Card(p, 'professional-law-schooling').earned, 0);
  });
}
test('H20 synthetic History recognition cannot prove actual overview schooling attendance', () => {
  const program = catalog.programs.find(p => p.department === '史学科');
  const offerings = ['日本史概説', '東洋史概説', '西洋史概説'].map(name => catalog.offerings.find(o => o.name.startsWith(name)
    && o.method === 'schooling' && !o.name.includes('メディア') && o.resolutionStatus === 'matched'));
  assert.ok(offerings.every(Boolean));
  const profile = structuredClone(fixture('史学科').profile);
  profile.recognizedCredits.professionalCourses = offerings.map((o, i) => ({ id: `h20-history-${i}`, offeringId: o.id,
    courseId: o.courseId, mappingId: o.mappingIds[0], name: o.name, credits: o.credits }));
  const recognized = calculateGraduationProgress([], catalog, program.scopeId, [], 'not_selected', [], [], profile);
  const learner = calculateGraduationProgress(offerings.map(o => item(o, 'earned')), catalog, program.scopeId, [], 'not_selected', [], [], profile);
  assert.equal(recognized.historySchoolingDiagnostic.overviewSchoolingCompletions, 0);
  assert.equal(recognized.historySchoolingDiagnostic.hasAllFiveSchoolingRequiredCourses, false);
  assert.equal(learner.historySchoolingDiagnostic.overviewSchoolingCompletions, 3);
  assert.equal(h42S(recognized).earned, 0);
});
for (const curriculum of ['unknown', 'legacy_or_transition']) for (const recognizedS of [null, 2]) {
  test(`H20 curriculum ${curriculum} preserves prior reference and ordinary holds S${recognizedS}`, () => {
    const x = h20Normal(recognizedS); x.profile.curriculumApplicability = curriculum;
    const input = x.build(), facts = h14Facts(x, input), p = x.progress(input);
    assert.deepEqual([h42S(p).earned, h42S(p).target, h42S(p).status], [null, null, 'unknown']);
    if (curriculum === 'unknown') {
      assert.deepEqual(facts.allocations.map(a => [a.credits, a.schoolingCredits]), [[4, null]]);
      assert.ok(facts.facts[0].diagnostics.includes('schooling_evidence_requires_confirmation'));
    } else assert.equal(facts.allocations.length, 0);
  });
}

// H21 research-only characterizations. Synthetic states are NOT assertions that
// the university permits these combinations. See the dated evidence matrix.
const h21Quantities = [
  ['case1', 2, 2, 0], ['case2', 2, 2, 2],
  ['case3', 4, 0, 0], ['case4', 2, 4, 2],
];
for (const [label, recognition, earned, schooling] of h21Quantities) {
  test(`H21 ${label}: DOM through apply preserves separate quantities and holds graduation`, () => {
    const x = fixture();
    const cells = Array(24).fill('');
    Object.assign(cells, { 1: x.course.canonicalName, 2: '4', 3: '0',
      4: String(recognition), 5: String(earned), 6: String(schooling),
      11: '2026/07/01', 12: '40', 13: 'A' });
    const dom = { querySelectorAll: () => cells.map(textContent => ({ textContent, classList: { contains: () => false } })) };
    const payload = { schemaVersion: 1, source: 'hosei_web_learning_grade_table',
      capturedAt: '2026-10-08T00:00:00Z', courses: extractRows([dom]) };
    const before = structuredClone(payload); deepFreeze(payload);
    const parsed = parseHoseiGradeImportV1(payload);
    assert.deepEqual(parsed, payload);
    const units = importPreview(parsed, x.f.offerings, [], [], { curriculum: x.f.curriculum, mappings: x.f.mappings });
    const state = applyImport(initialState(), units, x.f.offerings);
    assert.equal(state.importedCourseAchievements.length, 1);
    const row = state.importedCourseAchievements[0];
    const values = r => [r.compositionCredits, r.recognizedExemption, r.earnedCreditsTotal, r.schoolingCreditsTotal, r.additionalEnrollment];
    assert.deepEqual(values(units[0].sourceCourse), [4, recognition, earned, schooling, 0]);
    assert.deepEqual(values(row), [4, recognition, earned, schooling, 0]);
    assert.equal(importedEarnedCreditsTotal([row]), earned, 'component40 and recognition never reconstruct earned');
    const f = deriveOfficialGraduationFacts([row], state.importedStudyRecords, x.f, x.scope, x.profile);
    assert.equal(f.allocations.length, 0);
    assert.equal(f.facts[0].allocation.kind, 'unknown');
    assert.equal(f.facts[0].earnedCreditsTotal, earned);
    const p = calculateGraduationProgress(state.items, x.f, x.scope, [], 'not_selected', state.importedStudyRecords, [row], x.profile);
    assert.equal(p.importedContributionCount, 0);
    assert.equal(overall(p), 0, 'auto-created earned Planner item cannot bypass official hold');
    // H41's all-zero fact does not imply a missing positive ordinary increment.
    // The fact itself is still held; recognition is never used as completion.
    assert.equal(p.referenceProgress[0].status, earned === 0 ? 'partial' : 'unknown');
    assert.deepEqual(payload, before);
  });
}
for (const mode of ['total', 'individual', 'same', 'disjoint', 'unresolved', 'none']) {
  for (const recognizedS of [null, 0, 2]) test(`H21 cases5-8 profile=${mode} S=${recognizedS}: no second budget`, () => {
    const x = h14Fixture(); x.rows[0].recognizedExemption = 2;
    x.profile.admissionType = 'other_transfer';
    x.profile.recognizedCredits.schoolingEquivalentCredits = recognizedS;
    x.profile.recognizedCredits.professionalCourses = mode === 'same' ? [x.recognize(x.a)]
      : mode === 'disjoint' ? [x.recognize(x.b)] : mode === 'unresolved'
        ? [{ id: 'h21-unresolved', name: x.a.course.canonicalName, offeringId: null, courseId: null, mappingId: null, credits: 4 }] : [];
    x.profile.recognizedCredits.totalCredits = mode === 'none' ? null : 4;
    if (mode === 'individual') x.profile.recognizedCredits.general.humanities = { mode: 'recognized', credits: 4 };
    if (mode === 'none') x.profile.admissionType = 'first_year';
    assert.equal(graduationProfileValidationError(x.profile), null);
    const input = x.build(), snapshot = structuredClone({ input, rows: x.rows, profile: x.profile });
    deepFreeze(input); deepFreeze(x.rows); deepFreeze(x.profile);
    const f = deriveOfficialGraduationFacts(x.rows, [], input, x.scope, x.profile);
    assert.equal(f.allocations.length, 0);
    assert.equal(f.facts[0].earnedCreditsTotal, 4);
    assert.equal(heldOfficialSchoolingContributions(f, x.rows, [], input, x.scope, x.profile).length, 0);
    const p = x.progress(input), without = x.progress(input, []);
    assert.equal(p.importedContributionCount, 0);
    assert.equal(overall(p), overall(without));
    assert.equal(professional(p).earned, professional(without).earned);
    assert.equal(p.referenceProgress[0].status, 'unknown');
    assert.deepEqual({ input, rows: x.rows, profile: x.profile }, snapshot);
  });
}
for (const department of ['法律学科', '日本文学科', '史学科', '地理学科', '経済学科', '商業学科']) {
  for (const curriculum of ['current_2026', 'unknown', 'legacy_or_transition']) {
    for (const [recognition, additional] of [[null, null], [0, 0], [0, 2], [2, null]]) {
      test(`H21 controls ${department}/${curriculum} R${recognition}/additional${additional}`, () => {
        const x = fixture(department); x.profile.curriculumApplicability = curriculum;
        x.row.recognizedExemption = recognition; x.row.additionalEnrollment = additional;
        const snapshot = structuredClone(x); deepFreeze(x);
        const f = deriveOfficialGraduationFacts([x.row], [], x.f, x.scope, x.profile);
        const held = curriculum === 'legacy_or_transition' || recognition > 0 || additional > 0;
        assert.equal(f.allocations.length, held ? 0 : 1);
        if (!held) assert.deepEqual(f.allocations.map(a => [a.credits, a.completedCredits, a.schoolingCredits]), [[4, 4, 2]]);
        assert.equal(f.facts[0].earnedCreditsTotal, 4);
        const p = run(x);
        assert.equal(p.importedContributionCount, held ? 0 : 1);
        assert.deepEqual(x, snapshot);
      });
    }
  }
}
for (const source of ['H19', 'H43']) test(`H21 positive recognition closes ${source} global-only S`, () => {
  const x = source === 'H19' ? h19Fixture() : h43Fixture();
  x.rows[0].recognizedExemption = 2;
  const e = source === 'H19' ? h19Evidence(x) : h43Evidence(x);
  assert.equal(e.contributions.length, 0);
  assert.equal(e.official.allocations.length, 0);
  assert.equal(x.progress().importedContributionCount, 0);
});
for (const route of ['first_year', 'transfer_second_year', 'transfer_third_year', 'other_transfer', 'hosei_internal_transfer', 'bachelor_admission']) {
  test(`H21 route ${route}: positive recognized row remains held without guessing provenance`, () => {
    const x = fixture(); x.profile.admissionType = route; x.row.recognizedExemption = 2;
    const f = deriveOfficialGraduationFacts([x.row], [], x.f, x.scope, x.profile);
    assert.equal(f.allocations.length, 0);
    assert.equal(run(x).referenceProgress[0].status, 'unknown');
  });
}
test('H21 duplicate positive recognized rows are not summed or chosen', () => {
  const x = fixture(); x.row.recognizedExemption = 2;
  const rows = [x.row, { ...x.row, id: 'h21-other', earnedCreditsTotal: 2 }];
  const f = deriveOfficialGraduationFacts(rows, [], x.f, x.scope, x.profile);
  assert.equal(f.allocations.length, 0);
  assert.equal(f.facts[0].earnedCreditsTotal, null);
  assert.ok(f.facts[0].diagnostics.includes('duplicate_official_rows'));
});
for (const [label, composition, recognition, earned, schooling] of [
  ['public aggregate example', '', '12', '12', ''],
  ['public physical example', '2', '2', '2', ''],
  ['public foreign example', '1', '2', '2', '2'],
  ['public transfer S-only example', '', '', '', '13'],
]) test(`H21 ${label}: public printed p133 quantities are retained without an additive rule`, () => {
  const cells = Array(24).fill('');
  Object.assign(cells, { 1: '匿名の公式見本行', 2: composition, 4: recognition, 5: earned, 6: schooling });
  const payload = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-08T00:00:00Z', courses: extractRows([cells]) };
  const row = importPreview(payload, [])[0].sourceCourse;
  const number = raw => raw === '' ? null : Number(raw);
  assert.deepEqual([row.compositionCredits, row.recognizedExemption, row.earnedCreditsTotal, row.schoolingCreditsTotal],
    [composition, recognition, earned, schooling].map(number));
});
for (const field of ['recognizedExemption', 'additionalEnrollment', 'earnedCredits', 'schoolingCredits']) {
  for (const value of [-1, Infinity, NaN, '2']) test(`H21 invalid contract ${field} ${String(value)} is rejected before preview`, () => {
    const cells = Array(24).fill(''); cells[1] = '合成検証科目'; cells[2] = '4';
    const payload = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-08T00:00:00Z', courses: extractRows([cells]) };
    payload.courses[0][field].value = value; deepFreeze(payload);
    assert.equal(parseHoseiGradeImportV1(payload), null);
    assert.throws(() => importPreview(payload, []), /contract v1/);
  });
}
