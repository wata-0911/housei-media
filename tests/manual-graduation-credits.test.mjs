import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { calculateGraduationProgress } from '../src/planner/graduation/graduationProgress.ts';
import { deriveCurriculumCourseProgress } from '../src/planner/progress/curriculumCourseProgress.ts';
import { initialState, loadState, saveState } from '../src/planner/backup/storage.ts';
import { validateState } from '../src/planner/validation.ts';
import { createPlannerBackup, parsePlannerBackup } from '../src/planner/backup/plannerBackup.ts';

// Synthetic quantities/identities, but real department requirements and engine.
function fixture(program = catalog.programs.find(p => p.department === '法律学科')) {
  const scope = program.scopeId;
  const mapping = { ...catalog.mappings[0], mappingId: 'manual-map', scopeId: scope, category: '専門教育',
    field: null, requirementType: '選択必修', curriculumCredits: 4, schoolingOnly: false, mediaOnly: false };
  const course = { id: 'manual-course', canonicalName: '債権総論', curriculumCredits: 4, mappingIds: [mapping.mappingId], scopeIds: [scope] };
  const offering = { ...catalog.offerings[0], id: 'manual-T', name: course.canonicalName, courseId: 'manual-legacy',
    curriculumCourseId: course.id, credits: 4, method: 'correspondence', mappingIds: [mapping.mappingId], resolutionStatus: 'matched' };
  const f = { ...catalog, courses: [{ id: offering.courseId, canonicalName: course.canonicalName, identityStatus: 'provisional' }],
    offerings: [offering], mappings: [mapping], curriculum: { ...catalog.curriculum, courses: [course], offeringRelations: [] } };
  const profile = { ...initialState().graduationProfile, admissionYear: 2026, admissionType: 'first_year', curriculumApplicability: 'current_2026' };
  const x = { f, scope, profile, course, mapping, offering };
  x.addAttempt = (id, method = 'schooling', credits = 2, courseId = course.id, mappingIds = [mapping.mappingId]) => {
    const o = { ...offering, id, method, credits, curriculumCourseId: courseId, mappingIds };
    f.offerings.push(o); return o;
  };
  x.addCourse = (id, type = '選択必修', credits = 4) => {
    const m = { ...mapping, mappingId: `${id}-map`, requirementType: type, curriculumCredits: credits };
    const c = { ...course, id, canonicalName: id, curriculumCredits: credits, mappingIds: [m.mappingId] };
    const o = { ...offering, id: `${id}-T`, name: id, courseId: `${id}-legacy`, curriculumCourseId: id, credits, mappingIds: [m.mappingId] };
    f.mappings.push(m); f.curriculum.courses.push(c); f.offerings.push(o);
    f.courses.push({ id: o.courseId, canonicalName: id, identityStatus: 'provisional' }); return { course: c, mapping: m, offering: o };
  };
  x.run = (items, rows = []) => calculateGraduationProgress(items, f, scope, [], 'not_selected', [], rows, profile);
  return x;
}
const item = (o, contribution = 2, status = 'earned') => ({ offeringId: o.id, status, plannedYear: 2026, plannedTerm: null,
  studyYear: null, earnedOrder: null, ...(contribution === undefined ? {} : { courseCreditContribution: contribution }) });
const card = (p, id) => p.cards.find(c => c.requirementId === id);
const overall = p => p.referenceProgress.find(r => r.id === 'overall-reference-progress').earned;
const lawCount = p => card(p, 'professional-law-required-elective').details[0].earned;
const lawRule = (x, p) => p.requirements.find(r => x.f.requirements.some(rule => rule.id === r.requirementId
  && rule.scopeId === x.scope && rule.ruleType === 'min_credits' && rule.target.requirement_type === '選択必修'));
function official(x, earned = 4, schooling = 0) {
  return { id: 'manual-official', fingerprint: 'synthetic', source: 'hosei_import', rawName: x.course.canonicalName, categoryRaw: null,
    capturedAt: '2026-10-13T00:00:00Z', earnedCreditsTotal: earned, schoolingCreditsTotal: schooling, compositionCredits: 4,
    recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source',
    curriculumCourseId: x.course.id, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [x.course.id],
    offeringMatch: 'unmatched', courseId: x.offering.courseId, selectedOfferingId: null, selectionSource: 'none',
    match: 'exact_unique', candidateOfferingIds: [] };
}

test('P1 pre-fix reproduction: 債権総論 T2 is incomplete and earns no completed graduation credits', () => {
  const x = fixture(), items = [item(x.offering)], p = x.run(items);
  const c = deriveCurriculumCourseProgress(items, x.f).courses[0];
  // Report all required dimensions in a single diff on the unmodified engine.
  assert.deepEqual({ contribution: c.attempts[0].earnedContribution, earned: c.earnedCredits, completion: c.completion,
    elective: card(p, 'professional-law-required-elective').earned, courses: lawCount(p),
    structured: lawRule(x, p).earned, professional: card(p, 'professional-law-total').earned, overall: overall(p) },
  { contribution: 2, earned: 2, completion: 'incomplete', elective: 0, courses: 0, structured: 0, professional: 0, overall: 0 });
});

for (const mode of ['T4', 'T2+S2', 'T2+T2', 'excess', 'legacy-default']) test(`P1 safe completion ${mode} counts exactly one Course`, () => {
  const x = fixture();
  const items = [item(x.offering, mode === 'T4' || mode === 'excess' ? 4 : mode === 'legacy-default' ? undefined : 2)];
  if (mode === 'legacy-default') delete items[0].courseCreditContribution;
  if (mode.includes('+') || mode === 'excess') items.push(item(x.addAttempt('second', mode === 'T2+S2' ? 'schooling' : 'correspondence')));
  const p = x.run(items), c = deriveCurriculumCourseProgress(items, x.f).courses[0];
  assert.equal(c.completion, 'complete');
  assert.deepEqual([card(p, 'professional-law-required-elective').earned, lawCount(p), lawRule(x, p).earned,
    card(p, 'professional-law-total').earned, overall(p)], [4, 1, 4, 4, 4]);
});

test('P1 Course identity wins over shared names and mapping edges', () => {
  const x = fixture(), other = x.addCourse('other');
  other.course.canonicalName = x.course.canonicalName;
  other.offering.name = x.offering.name;
  other.offering.mappingIds = [x.mapping.mappingId]; // Shared edge must not merge distinct institutional Courses.
  const p = x.run([item(x.offering), item(other.offering)]);
  assert.deepEqual([card(p, 'professional-law-required-elective').earned, lawCount(p), lawRule(x, p).earned, overall(p)], [0, 0, 0, 0]);
});

test('P1 equivalent mapping edges and separate annual openings complete one institutional Course', () => {
  const x = fixture(), alias = { ...x.mapping, mappingId: 'equivalent-map' };
  x.f.mappings.push(alias); x.course.mappingIds.push(alias.mappingId);
  const second = x.addAttempt('S', 'schooling', 2, x.course.id, [alias.mappingId]);
  const p = x.run([item(x.offering), item(second)]);
  assert.deepEqual([card(p, 'professional-law-required-elective').earned, lawCount(p), lawRule(x, p).earned, overall(p)], [4, 1, 4, 4]);
  x.offering.mappingIds.push(alias.mappingId);
  assert.equal(lawRule(x, x.run([item(x.offering, 4)])).earned, 4, 'equivalent edges do not double-count an attempt');
});

test('P1 Law requires eight completed Courses AND 32 credits', () => {
  const x = fixture(), items = [item(x.offering)];
  for (let n = 0; n < 7; n++) items.push(item(x.addCourse(`full-${n}`).offering, 4));
  let p = x.run(items);
  assert.deepEqual([card(p, 'professional-law-required-elective').earned, lawCount(p), lawRule(x, p).status], [28, 7, 'unsatisfied']);
  items[0].courseCreditContribution = 4; p = x.run(items);
  assert.deepEqual([card(p, 'professional-law-required-elective').earned, lawCount(p), lawRule(x, p).status], [32, 8, 'satisfied']);
});

for (const qualifies of [false, true]) test(`P1 Law S2 exception remains schooling-only; prerequisites=${qualifies}`, () => {
  const x = fixture(), full = [];
  for (let n = 0; n < (qualifies ? 8 : 7); n++) full.push(item(x.addCourse(`full-${n}`).offering, 4));
  const s = x.addAttempt('S');
  const t = x.addCourse('partial-T');
  const p = x.run([...full, item(s), item(t.offering)]);
  assert.deepEqual([card(p, 'professional-law-required-elective').earned, lawCount(p),
    card(p, 'professional-law-elective').earned, card(p, 'professional-law-total').earned, overall(p)],
  qualifies ? [32, 8, 2, 34, 34] : [28, 7, 0, 28, 28]);
  assert.equal(card(p, 'professional-law-schooling').earned, 2);
});

for (const program of catalog.programs.filter(p => ['日本文学科', '地理学科', '経済学科', '商業学科'].includes(p.department))) {
  test(`P1 ${program.displayName} manual T2 cannot become completed4`, () => {
    const x = fixture(program), p = x.run([item(x.offering)]);
    assert.equal(overall(p), 0);
    assert.ok(p.cards.filter(c => c.ruleType === 'professional_group').every(c => c.earned === 0));
    // Source-specific rules retain their own quantities; the P2-aligned Japanese
    // and Geography bucket minima now reuse completed graduation allocations.
    assert.ok(p.requirements.filter(r => r.unit === 'credits' && r.label.startsWith('専門教育') && r.earned !== null).every(r => r.earned <= 2));
  });
}

for (const status of ['planned', 'in_progress', 'waiting', 'earned', 'dropped']) for (const credits of [0, 2]) {
  test(`P1 lifecycle ${status}/${credits} never completes a four-credit Course`, () => {
    const x = fixture(), items = [item(x.offering, credits, status)], p = x.run(items);
    assert.deepEqual([card(p, 'professional-law-required-elective').earned, lawCount(p), overall(p)], [0, 0, 0]);
    assert.equal(deriveCurriculumCourseProgress(items, x.f).courses[0].earnedCredits, status === 'earned' ? credits : 0);
    assert.equal(card(p, 'professional-law-required-elective').inProgress, status === 'in_progress' ? credits : 0);
    assert.equal(card(p, 'professional-law-required-elective').planned, status === 'planned' ? credits : 0);
  });
}

for (const earned of [null, 0, 2, 4]) for (const linked of [false, true]) test(`P1 official aggregate ${earned} owns earned Course; source link=${linked}`, () => {
  const x = fixture(), row = official(x, earned), s = x.addAttempt('S'), t = item(x.offering, 4);
  if (linked) t.importedSourceCourseId = row.id;
  const inputs = [t, item(s)], snapshot = structuredClone({ inputs, row });
  const only = x.run([], [row]), withManual = x.run(inputs, [row]);
  assert.deepEqual(withManual, only, 'manual earned cannot complete held/partial official or double count official4');
  assert.deepEqual({ inputs, row }, snapshot);
  assert.equal(card(withManual, 'professional-law-required-elective').earned, earned === 4 ? 4 : 0);
  assert.equal(lawCount(withManual), earned === 4 ? 1 : 0);
  assert.equal(card(withManual, 'professional-law-required-elective').status, earned === null || earned === 2 ? 'unknown' : 'unsatisfied');
});

test('P1 explicit S0 cannot make a T2 partial eligible for the Law S2 exception', () => {
  const x = fixture(), full = Array.from({ length: 8 }, (_, n) => item(x.addCourse(`full-${n}`).offering, 4));
  const p = x.run([...full, item(x.offering), item(x.addAttempt('S'), 0)]);
  assert.deepEqual([card(p, 'professional-law-elective').earned, overall(p)], [0, 32]);
  assert.equal(card(p, 'professional-law-schooling').earned, 2, 'independent schooling attendance policy stays unchanged');
});

test('P1 official ownership excludes only same-Course earned records; future attempts stay informational', () => {
  const x = fixture(), row = official(x), other = x.addCourse('independent'), future = x.addAttempt('future', 'correspondence', 4);
  for (const status of ['planned', 'in_progress', 'waiting']) {
    const p = x.run([item(x.offering), item(other.offering, 4), item(future, 2, status)], [row]);
    assert.deepEqual([card(p, 'professional-law-required-elective').earned, lawCount(p), overall(p)], [8, 2, 8]);
    assert.equal(card(p, 'professional-law-required-elective').planned, status === 'planned' ? 2 : 0);
    assert.equal(card(p, 'professional-law-required-elective').inProgress, status === 'in_progress' ? 2 : 0);
  }
});

test('P1 unknown opening credits remain unknown while explicit zero stays zero', () => {
  const x = fixture(); x.offering.credits = null;
  const i = item(x.offering); delete i.courseCreditContribution;
  const c = deriveCurriculumCourseProgress([i], x.f).courses[0], p = x.run([i]);
  assert.equal(c.completion, 'unknown'); assert.equal(c.earnedCredits, 0);
  assert.equal(lawCount(p), 0); assert.equal(lawRule(x, p).status, 'unknown');
});

test('P1 schema22 reload and backup preserve contribution, official sources and user meta', async () => {
  const x = fixture();
  x.f = catalog;
  x.offering = catalog.offerings.find(o => o.name === '債権総論' && o.method === 'correspondence' && o.credits === 4);
  x.course = catalog.curriculum.courses.find(c => c.id === x.offering.curriculumCourseId);
  const state = { ...initialState(), selectedScopeId: x.scope, graduationProfile: x.profile, items: [item(x.offering)] };
  const values = new Map(), store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  assert.equal(validateState(state, x.f), true);
  saveState(store, state, null, x.f);
  const loaded = loadState(store, x.f);
  assert.equal(loaded.error, null); assert.deepEqual(loaded.state, state); assert.equal(loaded.state.schemaVersion, 22);
  const run = state => calculateGraduationProgress(state.items, catalog, x.scope, [], 'not_selected', state.importedStudyRecords,
    state.importedCourseAchievements, state.graduationProfile);
  assert.equal(overall(run(loaded.state)), 0);
  const backup = await createPlannerBackup(JSON.stringify(state), catalog);
  const restored = await parsePlannerBackup(JSON.stringify(backup), catalog);
  assert.deepEqual(restored.state, state); assert.equal(overall(run(restored.state)), 0);
  const row = official(x, 4, 0);
  state.importedCourseAchievements = [row];
  state.importedStudyRecords = [{ id: 'original-component', fingerprint: 'component-source', source: 'hosei_import',
    rawName: row.rawName, offeringId: x.offering.id, sourceCourseId: row.id, match: 'exact_unique', method: 'correspondence',
    academicYear: 2026, yearSource: 'source', rawYear: '2026', term: null, rawTerm: null, date: null,
    credits: 2, grade: 'A', reports: [], examGrade: 'A' }];
  state.importedCourseUserMeta = { [row.id]: { lifecycleStatus: 'waiting', plannedYear: 2027, plannedTerm: '後期', studyYear: 3 } };
  const officialBackup = await createPlannerBackup(JSON.stringify(state), catalog);
  const officialRestore = await parsePlannerBackup(JSON.stringify(officialBackup), catalog);
  assert.deepEqual(officialRestore.state, state); assert.equal(overall(run(officialRestore.state)), 4);
  const legacy = structuredClone(state); delete legacy.items[0].courseCreditContribution;
  legacy.importedCourseAchievements = []; legacy.importedStudyRecords = []; legacy.importedCourseUserMeta = {};
  assert.equal(validateState(legacy, x.f), true); assert.equal(overall(run(legacy)), 4);
  assert.equal(validateState({ ...legacy, items: [legacy.items[0], legacy.items[0]] }, x.f), false,
    'schema22 rejects duplicate annual attempt identities before persistence');
});
