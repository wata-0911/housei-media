import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,initialState,calculateState,officialRow} from './fixtures/yi07-graduation-legacy.mjs';
import {deriveOfficialGraduationFacts} from '../src/planner/graduation/officialGraduationFacts.ts';
import {allocateGeographyTransfers} from '../src/planner/graduation/geographyTransferRules.ts';
const scope = catalog.programs.find(p => p.department === '地理学科').scopeId;
const state = () => ({ ...initialState(), graduationProfile: {
  ...initialState().graduationProfile, admissionType: 'first_year', admissionYear: 2026,
  curriculumApplicability: 'current_2026',
} });
const earned = (progress, id) => progress.cards.find(c => c.requirementId === `professional-geography-${id}`).earned;
const item = (offering, value) => ({ offeringId: offering.id, status: 'earned', plannedYear: 2026,
  plannedTerm: null, studyYear: null, earnedOrder: null, courseCreditContribution: value });
const destinations = ['地理特講（地誌学特講）', '地理特講（人文地理学演習）',
  '地理特講（自然地理学演習）', '地域特講（現地研究）'];
const humanRegionalT4 = catalog.curriculum.courses.find(c => c.id === 'curriculum:6c7dc42c-bd35-47df-9bc2-4b6f6da77e95');
for (const [origin, destination, amount] of [
  ['現地研究', '地域特講（現地研究）', 1],
  ['地誌学特講', '地理特講（地誌学特講）', 2],
  ['人文地理学演習', '地理特講（人文地理学演習）', 2],
  ['自然地理学演習', '地理特講（自然地理学演習）', 2],
]) test(`K4 shared official source ${destination}: order cannot select a second award`, () => {
  const source = catalog.curriculum.courses.find(c => c.canonicalName === origin && c.scopeIds.includes(scope));
  const target = catalog.curriculum.courses.find(c => c.canonicalName === destination && c.scopeIds.includes(scope));
  const a = officialRow(source, amount), b = { ...officialRow(target, amount), id: a.id };
  const outputs = [[a, b], [b, a]].map(rows => {
    const s = state(); s.importedCourseAchievements = rows;
    const before = structuredClone(s);
    const facts = deriveOfficialGraduationFacts(rows, [], catalog, scope, s.graduationProfile);
    const progress = calculateState(s, scope);
    assert.deepEqual(s, before);
    assert.equal(facts.allocations.length, 0);
    assert.equal(facts.facts.length, 2);
    assert.ok(facts.facts.every(f => f.diagnostics.includes('geography_source_claim_conflict')));
    return ['schooling-required', 'required-elective', 'elective', 'total'].map(id => ({
      earned: earned(progress, id), status: progress.cards.find(c => c.requirementId === `professional-geography-${id}`).status,
    }));
  });
  assert.deepEqual(outputs[0], outputs[1]);
});

test('K5 saved zero keeps legitimate S2 and holds unsupported seminar credits', () => {
  const field = catalog.offerings.filter(o => o.name.startsWith('現地研究'));
  const human = catalog.offerings.find(o => o.name.startsWith('人文地理学演習'));
  const natural = catalog.offerings.find(o => o.name.startsWith('自然地理学演習'));
  const rows = [field[0], field[1], human, natural];
  for (const values of [[0, 0, 0, 0], [1, 1, 0, 0], [1, 1, 2, 2]]) {
    const s = state(); s.items = rows.map((opening, i) => item(opening, values[i]));
    const before = structuredClone(s), result = calculateState(s, scope);
    assert.deepEqual(s, before);
    const expected = values[0] + values[1] + values[2] + values[3];
    assert.equal(earned(result, 'schooling-required'), expected);
    assert.equal(earned(result, 'total'), expected);
    if (values[2] === 0) assert.notEqual(result.cards.find(c => c.requirementId === 'professional-geography-schooling-required').status, 'satisfied');
  }
});

test('p.54–55 proven stage ledger remains intact', () => {
  const cases = [
    ['fieldStudy', 1, 4, [2, 2, 0]],
    ['chorography', 2, 3, [0, 4, 2]],
    ['humanSeminar', 2, 3, [2, 2, 2]],
    ['naturalSeminar', 2, 3, [2, 2, 2]],
    ['geographyLecture', 2, 3, [0, 4, 0]],
  ];
  for (const [kind, credits, count, expected] of cases) {
    const rows = Array.from({ length: count }, (_, i) => ({ id: `${kind}-${i}`, credits, status: 'earned' }));
    const allocations = allocateGeographyTransfers(kind, rows).allocations;
    const totals = allocations.reduce((acc, row) => {
      const key = row.bucket === 'スクーリング必修' ? 0 : row.bucket === '選択' ? 1 : 2;
      acc[key] += row.credits; return acc;
    }, [0, 0, 0]);
    assert.deepEqual(totals, expected, kind);
  }
});
