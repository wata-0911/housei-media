import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalog, law, state, item, starred, summer, teacher, winter, media,
  card, calculateState, legalOffering, englishState,
} from './fixtures/f02-r4-scenarios-legacy.mjs';
import { validateState } from '../src/planner/validation.ts';
import { loadState, STORAGE_KEY } from '../src/planner/backup/storage.ts';
import { deriveOfficialGraduationFacts } from '../src/planner/graduation/officialGraduationFacts.ts';
import { initialState, officialRow } from './fixtures/yi07-graduation-legacy.mjs';

// Old-schema22 assertions split from original mixed callbacks. The original
// schema23/24 migration and recorded-credit assertions remain unaccepted.
function saved(s) {
  assert.equal(validateState(s, catalog), true);
  const r = loadState({ getItem: k => k === STORAGE_KEY ? JSON.stringify(s) : null }, catalog);
  assert.equal(r.error, null);
  return r.state;
}
function lawAmounts(p, n) {
  assert.equal(card(p, 'professional-law-total').earned, n);
  assert.equal(card(p, 'professional-law-elective').earned, n);
  for (const id of ['5e64c026-b4b7-4546-a1fc-5e9340e3b976', 'ef19cce0-2441-42dc-aedd-9c8e91c2bd9e']) {
    const rows = p.requirements.filter(r => r.requirementId === id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].earned, n);
  }
}

// Original tests/f02-r4-remediation.test.mjs:7, old calculateState branch.
for (const ids of starred.map(id => [id]).concat([starred])) test(`R4 A old22 star exclusion ${ids}`, () => {
  const s = state(ids.map(id => item(id, 2))), raw = JSON.stringify(s), p = calculateState(s, law);
  assert.equal(card(p, 'professional-law-total').earned, ids.length * 2);
  assert.equal(card(p, 'professional-law-elective').earned, ids.length * 2);
  assert.equal(card(p, 'professional-law-schooling').earned, 0);
  assert.notEqual(card(p, 'professional-law-schooling').status, 'satisfied');
  const requirement = p.requirements.find(r => r.requirementId === 'd0197015-22a5-4fcc-ba1e-1eca087cef61');
  assert.equal(requirement.earned, null);
  assert.equal(requirement.status, 'unknown');
  assert.equal(JSON.stringify(s), raw);
});

// Original tests/f02-r4-remediation.test.mjs:11, old calculateState branch.
for (const [extra, n] of [[null, 6], [starred[0], 6], [legalOffering('国際法各論'), 8]]) test(`R4 A old22 law S threshold ${extra}`, () => {
  const ids = ['行政法', '刑法総論', '民事訴訟法'].map(legalOffering);
  if (extra) ids.push(extra);
  const s = state(ids.map(id => item(id, 2)));
  for (const rows of [s.items, [...s.items].reverse()]) {
    const p = calculateState({ ...s, items: rows }, law);
    assert.equal(card(p, 'professional-law-schooling').earned, n);
    assert.equal(card(p, 'professional-law-schooling').status, n === 8 ? 'satisfied' : 'unsatisfied');
  }
});

// Original tests/f02-r3-remediation.test.mjs:40, old raw and old calculation.
for (const [ids, n] of [
  [[summer, teacher], 2], [[winter, '4bf76def-db1f-46c8-a3bc-df3f8cac1164'], 2],
  [[summer, winter], 4], [[media, summer], 4],
  [[teacher, '4bf76def-db1f-46c8-a3bc-df3f8cac1164'], 4],
]) for (const reverse of [false, true]) test(`R3 C old22 repeat slots ${ids} reverse${reverse}`, () => {
  const rows = (reverse ? [...ids].reverse() : ids).map(id => item(id, 2));
  const s = saved(state(rows)), raw = JSON.stringify(s), old = calculateState(s, law);
  lawAmounts(old, n);
  assert.equal(card(old, 'professional-law-schooling').earned, n);
  const repeat = card(old, 'professional-law-elective').repeatableCourses.find(d => d.label === '政治学');
  assert.equal(repeat.courses, n / 2);
  assert.equal(JSON.stringify(s), raw);
});

// Original tests/f02-r3-remediation.test.mjs:44, old calculateState branch.
test('R3 C old22 same-slot politics cannot complete law S8', () => {
  const other = ['行政法', '民事訴訟法'].map(legalOffering);
  const s = state([item(summer, 2), item(teacher, 2), ...other.map(id => item(id, 2))]);
  const old = calculateState(saved(s), law);
  assert.equal(card(old, 'professional-law-schooling').earned, 6);
  assert.notEqual(card(old, 'professional-law-schooling').status, 'satisfied');
});

// Original tests/f02-r2-remediation.test.mjs:96, old branch only.
test('R2 old22 duplicate regular S2 has one partial award', () => {
  const full = ['行政法', '刑事訴訟法', '債権総論', '刑法各論', '国際法各論', '物権法', '国際法総論', '刑法総論'];
  const correspondence = name => catalog.offerings.find(o => o.method === 'correspondence' &&
    catalog.curriculum.courses.some(c => c.id === o.curriculumCourseId && c.canonicalName === name));
  const s = saved(state([...full.map(name => item(correspondence(name).id, 4)),
    item('3c96e34f-9433-446f-a909-5389ca6fce08', 2),
    item('54d68d8f-0fa1-4ebf-b701-0e671443d4fb', 2)]));
  const p = calculateState(s, law);
  assert.equal(card(p, 'professional-law-total').earned, 34);
  assert.equal(card(p, 'professional-law-elective').earned, 2);
});

// Original tests/f02-r4-remediation.test.mjs:29,32,39, old language and
// recognition branches only. The subsequent migration comparisons stay held.
for (const official of [false, true]) for (const schooling of [undefined, null, 0, 2])
  for (const reverse of [false, true]) test(`R4 D old22 English official${official} FrenchS${schooling} reverse${reverse}`, () => {
    const s = englishState(schooling, official);
    if (reverse) s.items.reverse();
    const raw = JSON.stringify(s), p = calculateState(s, law);
    assert.equal(card(p, 'group-foreign').earned, 4);
    assert.equal(card(p, 'group-foreign').status, 'satisfied');
    assert.equal(JSON.stringify(s), raw);
  });
for (const official of [false, true]) for (const [schooling, status] of [[null, 'unknown'], [0, 'unsatisfied'], [2, 'satisfied']])
  test(`R4 D old22 unmet English official${official} FrenchS${schooling}`, () => {
    const p = calculateState(englishState(schooling, official, false), law);
    assert.equal(card(p, 'group-foreign').status, status);
  });
for (const language of ['english', 'german']) test(`R4 D old22 ${language} recognition Snull`, () => {
  const status = language === 'english' ? 'unknown' : 'satisfied';
  const p = calculateState(englishState(null, true, true, language), law);
  assert.equal(card(p, 'group-foreign').status, status);
});

const geoScope = catalog.programs.find(p => p.department === '地理学科').scopeId;
const geoState = () => ({ ...initialState(), graduationProfile: {
  ...initialState().graduationProfile, admissionType: 'first_year', admissionYear: 2026,
  curriculumApplicability: 'current_2026',
} });
const geoEarned = p => p.cards.find(c => c.requirementId === 'professional-geography-total').earned;

// Original tests/f02-geo-k4k5.test.mjs:61, old official provenance branch.
test('geo old22 human S2 cannot invent official allocation', () => {
  const course = catalog.curriculum.courses.find(c => c.canonicalName === '人文地理学特講' && c.scopeIds.includes(geoScope));
  assert.equal(course.curriculumCredits, 2);
  const s = geoState(); s.importedCourseAchievements = [officialRow(course, 2)];
  assert.equal(deriveOfficialGraduationFacts(s.importedCourseAchievements, [], catalog, geoScope, s.graduationProfile).allocations.length, 0);
  assert.equal(geoEarned(calculateState(s, geoScope)), 0);
});

// Original tests/f02-geo-k4k5.test.mjs:75, old official/raw branch.
for (const name of ['地理特講（地誌学特講）', '地理特講（人文地理学演習）',
  '地理特講（自然地理学演習）', '地域特講（現地研究）']) test(`geo old22 no independent destination award ${name}`, () => {
  const course = catalog.curriculum.courses.find(c => c.canonicalName === name && c.scopeIds.includes(geoScope));
  const s = geoState(), row = { ...officialRow(course, course.curriculumCredits), schoolingCreditsTotal: course.curriculumCredits };
  s.importedCourseAchievements = [row];
  const before = structuredClone(s);
  const facts = deriveOfficialGraduationFacts(s.importedCourseAchievements, [], catalog, geoScope, s.graduationProfile);
  const official = calculateState(s, geoScope);
  assert.deepEqual(s, before);
  assert.equal(facts.allocations.length, 0);
  assert.equal(official.cards.find(c => c.requirementId === 'professional-geography-elective').earned, 0);
  assert.equal(geoEarned(official), 0);
});

// Original tests/work-b-official-repeat-boundaries.test.mjs:14 uses the
// old graduation allocator directly; only its future fixture import changes.
test('old22 recorded allocation rejects duplicates and non-finite quantities; official ownership wins', async () => {
  const { calculateGraduationProgress } = await import('../src/planner/graduation/graduationProgress.ts');
  const mapping = catalog.mappings.find(m => m.category === '一般教育' && m.curriculumCredits === 4);
  const course = catalog.curriculum.courses.find(c => c.mappingIds.includes(mapping.mappingId));
  const allocation = { mapping, credits: 4, completedCredits: 4, schoolingCredits: 0,
    fact: { curriculumCourseId: course.id, canonicalName: course.canonicalName } };
  const run = (allocations, rows = []) => calculateGraduationProgress([], catalog, law, [], undefined, [], rows,
    initialState().graduationProfile, null, {}, allocations);
  assert.throws(() => run([allocation, allocation]), /duplicate_recorded_course_allocation/);
  assert.throws(() => run([{ ...allocation, credits: Infinity }]), /invalid_recorded_allocation_quantity/);
  const official = run([], [officialRow(course, 4)]), mixed = run([allocation], [officialRow(course, 4)]);
  assert.deepEqual(mixed, official);
});
