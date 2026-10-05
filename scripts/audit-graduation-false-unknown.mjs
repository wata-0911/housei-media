/** Read-only characterization of the d5c28e0 audit baseline, not desired behavior.
 * Run: node --import tsx --test scripts/audit-graduation-false-unknown.mjs
 * Synthetic inputs only; no saved learner state, catalog files or network writes.
 */
import { test } from 'node:test';
import { attachCurriculumCatalog } from '../src/planner/curriculumCatalog.ts';
import { validateCatalog } from '../src/planner/validation.ts';
import { createMappingResolver } from '../src/planner/plannerHelpers.ts';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog.ts';
import { initialState } from '../src/planner/storage.ts';
import { deriveOfficialGraduationFacts } from '../src/planner/officialGraduationFacts.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { exactImportedCurriculumId } from '../src/planner/officialCourseCredits.ts';
import { guidanceEligibilityCreditResult } from '../src/planner/thesisGuidance.ts';

function fixture() {
  const c = structuredClone(catalog);
  const scope = c.programs.find(p => p.department === '法律学科').scopeId;
  const mapping = { ...c.mappings[0], mappingId: 'audit-map', scopeId: scope, category: '専門教育', field: null,
    requirementType: '選択必修', curriculumCredits: 4, schoolingOnly: false, mediaOnly: false };
  const course = { id: 'audit-course', canonicalName: '監査科目', curriculumCredits: 4, mappingIds: [mapping.mappingId], scopeIds: [scope] };
  const offering = { ...c.offerings[0], id: 'audit-offering', name: course.canonicalName, courseId: 'audit-legacy', curriculumCourseId: course.id,
    method: 'correspondence', credits: 4, resolutionStatus: 'matched', mappingIds: [mapping.mappingId] };
  c.mappings = [mapping]; c.offerings = [offering]; c.curriculum.courses = [course];
  c.curriculum.offeringRelations = [{ offeringId: offering.id, curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id] }];
  const row = { id: 'audit-row', fingerprint: 'audit-source', source: 'hosei_import', rawName: course.canonicalName, categoryRaw: null,
    capturedAt: '2026-10-04T00:00:00Z', earnedCreditsTotal: 4, schoolingCreditsTotal: 2, compositionCredits: 4,
    recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source',
    curriculumCourseId: course.id, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [course.id], offeringMatch: 'unmatched',
    courseId: offering.courseId, selectedOfferingId: null, selectionSource: 'none', match: 'exact_unique', candidateOfferingIds: [] };
  const profile = { ...initialState().graduationProfile, admissionYear: 2026, admissionType: 'first_year', curriculumApplicability: 'current_2026' };
  return { c, scope, mapping, course, offering, row, profile, rows: [row], records: [] };
}
const facts = x => deriveOfficialGraduationFacts(x.rows, x.records, x.c, x.scope, x.profile);
const progress = (x, selection = 'not_selected') => calculateGraduationProgress([], x.c, x.scope, [], selection, x.records, x.rows, x.profile);
const ref = (p, axis) => p.referenceProgress.find(r => r.id === `${axis}-reference-progress`);
const card = (p, id) => p.cards.find(r => r.requirementId === id);
const media = x => ({ id: 'audit-media', fingerprint: 'audit-media', source: 'hosei_import', sourceCourseId: x.row.id,
  rawName: x.row.rawName, method: 'schooling', rawTerm: 'メ', credits: 2, grade: 'A', rawYear: '2026', date: null, term: null });

test('H19: law excluded name holds global S allocation too', () => {
  const x = fixture(); x.course.canonicalName = 'データサイエンス入門A';
  x.course.curriculumCredits = 2; x.mapping.curriculumCredits = 2;
  x.row.compositionCredits = 2; x.row.earnedCreditsTotal = 2;
  assert.equal(facts(x).allocations[0].credits, 2);
  assert.equal(facts(x).allocations[0].schoolingCredits, null);
  assert.equal(ref(progress(x), 'schooling').earned, null);
});
test('H20: unrelated transfer S recognition holds even explicit zero S', () => {
  const x = fixture(); x.profile.admissionType = 'transfer_second_year';
  for (const recognition of [null, 7]) {
    x.profile.recognizedCredits.schoolingEquivalentCredits = recognition;
    for (const s of [0, 2]) {
      x.row.schoolingCreditsTotal = s;
      assert.equal(facts(x).allocations[0].schoolingCredits, null);
      assert.equal(facts(x).allocations[0].credits, 4);
    }
  }
});
test('H14: unrelated recognized course holds all professional facts', () => {
  const x = fixture();
  x.profile.recognizedCredits.professionalCourses = [{ id: 'recognized-row', name: '別の認定科目',
    courseId: 'different-legacy', offeringId: null, mappingId: null, credits: 4 }];
  assert.equal(facts(x).facts[0].allocation.kind, 'unknown');
  assert.ok(facts(x).facts[0].diagnostics.includes('recognized_overlap'));
});
test('H41/H42: local professional S uncertainty reaches foreign language', () => {
  const x = fixture(); x.row.schoolingCreditsTotal = null;
  assert.equal(card(progress(x), 'group-foreign').status, 'unknown');
  assert.equal(card(progress(x), 'group-general').status, 'unsatisfied');
  assert.equal(ref(progress(x), 'overall').earned, 4);
});
test('H40: orphan with zero components makes unrelated common cards unknown', () => {
  const x = fixture(); x.records = [{ ...media(x), sourceCourseId: 'absent-row', credits: 0, earnedCreditsTotal: 0 }];
  assert.equal(card(progress(x), 'group-general').status, 'unknown');
  assert.ok(progress(x).importedWarnings.some(w => w.kind === 'credits_unknown'));
  assert.equal(ref(progress(x), 'overall').earned, 4);
});
// H38 is resolved; the full regression matrix lives in tests/graduation-audit.test.mjs.
test('H38 resolved: recognized foreign4/Snull retains ordinary4 with schooling unknown', () => {
  const x = fixture(); x.rows = []; x.profile.admissionType = 'transfer_second_year';
  x.profile.recognizedCredits.foreignLanguage = { mode: 'recognized', credits: 4, language: 'english', schoolingEquivalentCredits: null };
  const p = progress(x);
  assert.equal(card(p, 'group-foreign').earned, 4);
  assert.equal(card(p, 'group-foreign').status, 'unknown');
  assert.match(card(p, 'group-foreign').reason, /スクーリング相当認定単位が未確認/);
  assert.equal(ref(p, 'overall').earned, 4);
  assert.equal(ref(p, 'schooling').earned, null);
  assert.equal(ref(p, 'schooling').status, 'unknown');
});
test('H36 resolved: undecided law thesis retains known quantities and independent global S target', () => {
  const x = fixture();
  assert.equal(ref(progress(x), 'schooling').earned, 2);
  const p = progress(x, 'undecided');
  assert.deepEqual([ref(p, 'overall').earned, ref(p, 'overall').target, ref(p, 'overall').status], [4, null, 'unknown']);
  assert.match(ref(p, 'overall').reason, /卒業論文の選択が未定/);
  assert.deepEqual([ref(p, 'schooling').earned, ref(p, 'schooling').target, ref(p, 'schooling').status, ref(p, 'schooling').reason], [2, 30, 'partial', null]);
  assert.equal(p.graduationCheckComplete, false);
});
test('H02 resolved: annual removal preserves independent exact Course and official contribution', () => {
  const x = fixture(); x.row.offeringMatch = 'exact_unique'; x.row.selectedOfferingId = x.offering.id;
  assert.equal(exactImportedCurriculumId(x.row, x.c), x.course.id);
  x.c.offerings = [];
  assert.equal(exactImportedCurriculumId(x.row, x.c), x.course.id);
  assert.equal(facts(x).allocations[0].credits, 4);
  assert.equal(facts(x).allocations[0].completedCredits, 4);
  assert.equal(facts(x).allocations[0].schoolingCredits, 2);
  assert.equal(ref(progress(x), 'overall').earned, 4);
});
test('H12 resolved: eight full law Courses admit official partial schooling2 without completing its Course', () => {
  const x = fixture();
  x.rows = Array.from({ length: 9 }, (_, n) => {
    const m = { ...x.mapping, mappingId: `map-${n}` };
    const c = { ...x.course, id: `course-${n}`, mappingIds: [m.mappingId] };
    x.c.mappings.push(m); x.c.curriculum.courses.push(c);
    return { ...x.row, id: `row-${n}`, curriculumCourseId: c.id, candidateCurriculumCourseIds: [c.id], earnedCreditsTotal: n === 8 ? 2 : 4, schoolingCreditsTotal: n === 8 ? 2 : 0 };
  });
  const result = facts(x);
  assert.equal(result.allocations.length, 9);
  const partial = result.allocations.find(a => a.fact.sourceRowIds.includes('row-8'));
  assert.equal(partial.credits, 2); assert.equal(partial.completedCredits, 0); assert.equal(partial.schoolingCredits, 2);
  assert.equal(card(progress(x), 'professional-law-required-elective').earned, 32);
  assert.equal(card(progress(x), 'professional-law-elective').earned, 2);
  assert.equal(card(progress(x), 'professional-law-total').earned, 34);
  assert.equal(ref(progress(x), 'overall').earned, 34);
});
test('H03: distinct duplicate ids remain unresolved; all-zero duplicate warnings are suppressed', () => {
  const x = fixture(); x.rows.push({ ...x.row, id: 'duplicate' });
  assert.equal(facts(x).allocations.length, 0);
  assert.equal(facts(x).facts[0].earnedCreditsTotal, null);
  assert.ok(progress(x).importedWarnings.some(w => w.kind === 'allocation_held'));
  x.rows.forEach(row => { row.earnedCreditsTotal = 0; row.schoolingCreditsTotal = 0; });
  assert.equal(progress(x).importedWarnings.length, 0);
});
test('H16/H17: invalid S never falls back; null and zero remain distinct', () => {
  const x = fixture(); x.records = [media(x)];
  for (const s of [-1, NaN, Infinity, -Infinity, 5, 0]) {
    x.row.schoolingCreditsTotal = s;
    assert.equal(facts(x).allocations[0].schoolingCredits, null);
  }
  x.row.schoolingCreditsTotal = null;
  assert.equal(facts(x).allocations[0].schoolingCredits, 4);
});
test('H15: mixed or wrong-link method evidence cannot authorize a media-only mapping', () => {
  const x = fixture(); x.mapping.mediaOnly = true;
  x.records = [{ ...media(x), sourceCourseId: 'wrong' }];
  assert.ok(facts(x).facts[0].diagnostics.includes('method_evidence_required'));
  x.records = [media(x), { ...media(x), id: 'other', rawTerm: '夏' }];
  assert.ok(facts(x).facts[0].diagnostics.includes('method_evidence_conflict'));
});
test('H45: scoped unsupported rows leak into another department unknown list', () => {
  const x = fixture(); const p = progress(x);
  assert.ok(p.requirements.some(r => r.status === 'unknown' && x.c.requirements.some(q => q.id === r.requirementId && q.ruleId === 'geography_legacy_fieldwork')));
});
test('H51: guidance still needs annual identity where official graduation does not', () => {
  const x = fixture(); x.c.offerings = []; x.row.courseId = null;
  assert.equal(facts(x).allocations[0].credits, 4);
  assert.equal(guidanceEligibilityCreditResult({ ...initialState(), importedCourseAchievements: x.rows, selectedScopeId: x.scope, graduationProfile: x.profile }, x.c).status, 'unknown');
});
for (const [name, department, schooling] of [['書道実技', '日本文学科', 1], ['史学概論', '史学科', 0]]) {
  test(name === '史学概論' ? 'H60 resolved: real catalog history introduction C4/O4/S0 allocates ordinary4'
    : 'H57 resolved: real catalog calligraphy C2/O2/S1 allocates ordinary2', () => {
    const x = fixture(); x.c = structuredClone(catalog);
    x.scope = x.c.programs.find(p => p.department === department).scopeId;
    const course = x.c.curriculum.courses.find(c => c.canonicalName === name);
    Object.assign(x.row, { rawName: name, curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id],
      compositionCredits: course.curriculumCredits, earnedCreditsTotal: course.curriculumCredits, schoolingCreditsTotal: schooling,
      courseId: null });
    assert.equal(exactImportedCurriculumId(x.row, x.c), course.id);
    if (name === '史学概論') {
      const result = facts(x);
      assert.equal(result.allocations.length, 1);
      assert.equal(result.allocations[0].credits, 4);
      assert.equal(result.allocations[0].completedCredits, 4);
      assert.equal(result.allocations[0].schoolingCredits, 0);
      assert.ok(!result.facts[0].diagnostics.includes('special_rule_evidence_required'));
      assert.equal(card(progress(x), 'professional-history-required').earned, 4);
      assert.equal(ref(progress(x), 'overall').earned, 4);
    } else {
      const result = facts(x);
      assert.equal(result.allocations.length, 1);
      assert.equal(result.allocations[0].credits, 2);
      assert.equal(result.allocations[0].completedCredits, 2);
      assert.equal(result.allocations[0].schoolingCredits, 1);
      assert.ok(!result.facts[0].diagnostics.includes('special_rule_evidence_required'));
      assert.equal(card(progress(x), 'professional-elective').earned, 2);
      assert.equal(ref(progress(x), 'overall').earned, 2);
      assert.equal(ref(progress(x), 'schooling').earned, 1);
    }
  });
}
test('source facts and invariant flags are unchanged by all calculations', () => {
  const x = fixture(); x.records = [media(x)];
  const before = structuredClone(x);
  facts(x); progress(x);
  assert.deepEqual(x, before);
  assert.equal(catalog.metadata.graduationCheckComplete, false);
  assert.equal(catalog.metadata.sourceLinksReverified, false);
  assert.equal(initialState().schemaVersion, 22);
});

// H31/P2 fixtures follow production's validation/attach/reference checks.
function h31Fixture(withMapping = true) {
  const x = fixture(); x.c = structuredClone(catalog);
  const known = x.c.offerings.find(o => o.resolutionStatus === 'matched' && o.method === 'correspondence' && o.credits === 4
    && o.mappingIds.length === 1 && x.c.mappings.some(m => o.mappingIds.includes(m.mappingId) && m.scopeId === x.scope
      && m.category === '専門教育' && m.requirementType === '選択必修' && m.curriculumCredits === 4));
  assert.ok(known);
  const course = x.c.curriculum.courses.find(c => c.id === known.curriculumCourseId);
  Object.assign(x.row, { rawName: course.canonicalName, curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id], courseId: known.courseId });
  const candidate = x.c.offerings.find(o => o.resolutionStatus === 'manual_review');
  Object.assign(candidate, { mappingIds: withMapping ? known.mappingIds : [], method: 'correspondence', credits: 90 });
  assert.equal(validateCatalog(x.c), true);
  x.c = attachCurriculumCatalog(x.c, x.c.curriculum);
  assert.equal(validateCatalog(x.c), true);
  const resolve = createMappingResolver(x.c); x.c.offerings.forEach(resolve);
  x.candidate = x.c.offerings.find(o => o.id === candidate.id);
  assert.equal(x.candidate.curriculumCourseId, null);
  return x;
}
test('H31/P2 production-valid direct Mapping candidate holds dependencies only and retains official lower bound', () => {
  const x = h31Fixture();
  const p = calculateGraduationProgress([{ offeringId: x.candidate.id, status: 'earned', earnedOrder: null }], x.c, x.scope, [], 'not_selected', [], x.rows, x.profile);
  for (const id of ['professional-law-required-elective', 'professional-law-elective', 'professional-law-total']) {
    assert.equal(card(p, id).status, 'unknown'); assert.match(card(p, id).reason, /対応関係を確認中/);
  }
  assert.equal(card(p, 'professional-law-required-elective').earned, 4); assert.equal(card(p, 'professional-law-total').earned, 4);
  for (const id of ['group-general', 'group-foreign', 'group-physical']) assert.deepEqual(card(p, id), card(progress(x), id));
  assert.equal(ref(p, 'overall').earned, 4); assert.equal(ref(p, 'overall').status, 'unknown');
});
test('H31/P2 production-valid no candidate: conservative global hold retains known lower bound without counting unresolved budget', () => {
  const x = h31Fixture(false);
  const p = calculateGraduationProgress([{ offeringId: x.candidate.id, status: 'earned', earnedOrder: null }], x.c, x.scope, [], 'not_selected', [], x.rows, x.profile);
  for (const id of ['group-general', 'group-foreign', 'group-physical', 'professional-law-total']) assert.equal(card(p, id).status, 'unknown');
  assert.equal(card(p, 'professional-law-total').earned, 4); assert.equal(ref(p, 'overall').earned, 4);
});
test('H31/P2 real runtime history manual_review stays in its special routing without common pollution', () => {
  const x = fixture(); const scope = catalog.programs.find(p => p.department === '史学科').scopeId;
  const input = attachCurriculumCatalog(catalog); assert.equal(validateCatalog(input), true);
  const baseline = calculateGraduationProgress([], input, scope, [], 'selected', [], [], x.profile);
  for (const offering of input.offerings.filter(o => o.resolutionStatus === 'manual_review')) {
    const p = calculateGraduationProgress([{ offeringId: offering.id, status: 'earned', earnedOrder: null }], input, scope, [], 'selected', [], [], x.profile);
    for (const id of ['group-general', 'group-foreign', 'group-physical', 'professional-history-required']) assert.deepEqual(card(p, id), card(baseline, id));
    assert.match(card(p, 'professional-history-schooling-required-elective').reason, /修得順/);
    assert.equal(p.graduationCheckComplete, false);
  }
});
