import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, initialState, calculateState, officialRow } from './fixtures/yi07-graduation-legacy.mjs';
import { deriveOfficialGraduationFacts } from '../src/planner/graduation/officialGraduationFacts.ts';

// Old-schema22 portion of fixed dev tests/f02-geo-k4k5.test.mjs:24-35.
// The original callback's decode(s) assertion is a separate future-schema23 contract.
const scope = catalog.programs.find(p => p.department === '地理学科').scopeId;
const state = () => ({ ...initialState(), graduationProfile: {
  ...initialState().graduationProfile, admissionType: 'first_year', admissionYear: 2026,
  curriculumApplicability: 'current_2026',
} });
const earned = (progress, id) => progress.cards.find(c => c.requirementId === `professional-geography-${id}`).earned;
const humanRegionalT4 = catalog.curriculum.courses.find(c => c.id === 'curriculum:6c7dc42c-bd35-47df-9bc2-4b6f6da77e95');

test('R1 fixed human geography T4 old-schema22 portion: official four credits', () => {
  assert.equal(humanRegionalT4.canonicalName, '人文地理学特講（地域・産業・生活）');
  assert.equal(humanRegionalT4.curriculumCredits, 4);
  const s = state(); s.importedCourseAchievements = [officialRow(humanRegionalT4, 4)];
  const before = JSON.stringify(s);
  const facts = deriveOfficialGraduationFacts(s.importedCourseAchievements, [], catalog, scope, s.graduationProfile);
  assert.equal(facts.allocations.length, 1);
  assert.equal(earned(calculateState(s, scope), 'required-elective'), 4);
  assert.equal(earned(calculateState(s, scope), 'total'), 4);
  assert.equal(JSON.stringify(s), before);
});

test('R1 fixed human geography T4 negative control: three official credits cannot satisfy four', () => {
  const s = state(); s.importedCourseAchievements = [officialRow(humanRegionalT4, 3)];
  const before = JSON.stringify(s);
  const progress = calculateState(s, scope);
  assert.equal(earned(progress, 'required-elective'), 0);
  assert.equal(earned(progress, 'total'), 0);
  assert.equal(JSON.stringify(s), before);
});

test('R1 fixed human geography T4 negative control: input mutation fails the raw snapshot oracle', () => {
  const s = state(); s.importedCourseAchievements = [officialRow(humanRegionalT4, 4)];
  const before = JSON.stringify(s);
  s.importedCourseAchievements[0].earnedCreditsTotal = 5;
  assert.throws(() => assert.equal(JSON.stringify(s), before), assert.AssertionError);
});
