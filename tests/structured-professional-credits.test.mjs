import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog } from '../src/planner/catalog.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { deriveCurriculumCourseProgress } from '../src/planner/curriculumCourseProgress.ts';
import { initialState } from '../src/planner/storage.ts';
import { repeatableRule } from '../src/planner/repeatableRules.ts';
import { geographyTransferKind } from '../src/planner/geographyTransferRules.ts';
import { officialRow } from './fixtures/unresolved-condition-scenarios.mjs';

const programs = catalog.programs.filter(p => ['日本文学科', '地理学科'].includes(p.department));
const profile = { ...initialState().graduationProfile, admissionYear: 2026, admissionType: 'first_year', curriculumApplicability: 'current_2026' };
const item = (o, credits = o.credits, status = 'earned') => ({ offeringId: o.id, status, courseCreditContribution: credits,
  plannedYear: 2026, plannedTerm: null, studyYear: null, earnedOrder: null });
const maps = (o, p) => o.mappingIds.map(id => catalog.mappings.find(m => m.mappingId === id))
  .filter(m => m.scopeId === p.scopeId && m.category === '専門教育');
const ordinary = (p, type) => {
  const seen = new Set();
  return catalog.offerings.filter(o => o.resolutionStatus === 'matched' && o.method === 'correspondence' && o.credits === 4
    && o.curriculumCourseId && catalog.curriculum.courses.find(c => c.id === o.curriculumCourseId)?.curriculumCredits === 4
    && maps(o, p).some(m => m.requirementType === type) && !repeatableRule(p.department, o)
    && !(p.department === '地理学科' && geographyTransferKind(o, id => catalog.courses.find(c => c.id === id)?.canonicalName ?? null))
    && !seen.has(o.curriculumCourseId) && seen.add(o.curriculumCourseId));
};
const run = (p, items, rows = [], records = [], input = catalog, currentProfile = profile, thesis = null) =>
  calculateGraduationProgress(items, input, p.scopeId, [], 'not_selected', records, rows, currentProfile, thesis);
const card = (p, id) => p.cards.find(c => c.requirementId === id);
const overall = p => p.referenceProgress.find(r => r.id === 'overall-reference-progress').earned;
const ruleFor = (p, type) => catalog.requirements.find(r => r.scopeId === p.scopeId && r.status === 'structured'
  && r.ruleType === 'min_credits' && r.target.curriculum_category === '専門教育'
  && r.target.requirement_type === type && r.target.curriculum_field === undefined);
const rowFor = (p, rule) => p.requirements.find(r => r.requirementId === rule.id);
const target = p => p.department === '日本文学科' ? { type: '選択必修', full: 4, target: 20, id: 'professional-required-elective' }
  : { type: '選択', full: 2, target: 12, id: 'professional-geography-elective' };
const totalId = p => p.department === '日本文学科' ? 'professional-japanese-total' : 'professional-geography-total';

for (const p of programs) test(`P2 pre-fix actual catalog: ${p.displayName} incomplete credits cannot satisfy ordinary minimum`, () => {
  const t = target(p), offerings = ordinary(p, t.type);
  assert.ok(offerings.length >= t.full + 2);
  const items = offerings.slice(0, t.full + 2).map((o, n) => item(o, n < t.full ? 4 : 2));
  const progress = run(p, items), rule = ruleFor(p, t.type), row = rowFor(progress, rule), c = card(progress, t.id);
  assert.equal(rule.conditions, null, 'use the actual missing-full-course requirement, without modifying the catalog');
  assert.deepEqual({ requirement: row.earned, status: row.status, coverage: row.coverageStatus,
    card: c.earned, cardStatus: c.status, overall: overall(progress) },
  { requirement: t.full * 4, status: 'unsatisfied', coverage: 'supported', card: t.full * 4, cardStatus: 'unsatisfied', overall: t.full * 4 });
  assert.equal(deriveCurriculumCourseProgress(items, catalog, [], p.scopeId).courses.filter(c => c.completion === 'complete').length, t.full);
});

for (const p of programs) test(`P2 actual catalog: ${p.displayName} completed-only minimum remains satisfied`, () => {
  const t = target(p), items = ordinary(p, t.type).slice(0, t.target / 4).map(o => item(o));
  const progress = run(p, items), row = rowFor(progress, ruleFor(p, t.type));
  assert.deepEqual([row.earned, row.status, row.coverageStatus, card(progress, t.id).earned, overall(progress)],
    [t.target, 'satisfied', 'supported', t.target, t.target]);
});

for (const p of programs) test(`P2 actual catalog: ${p.displayName} T2 plus S2 completes the same Course`, () => {
  const t = target(p), offerings = ordinary(p, t.type);
  const correspondence = offerings.find(o => catalog.offerings.some(s => s.method === 'schooling' && s.credits === 2
    && s.resolutionStatus === 'matched' && s.curriculumCourseId === o.curriculumCourseId
    && maps(s, p).some(m => m.requirementType === t.type)));
  assert.ok(correspondence);
  const schooling = catalog.offerings.find(s => s.method === 'schooling' && s.credits === 2 && s.resolutionStatus === 'matched'
    && s.curriculumCourseId === correspondence.curriculumCourseId && maps(s, p).some(m => m.requirementType === t.type));
  const items = [...offerings.filter(o => o.id !== correspondence.id).slice(0, t.target / 4 - 1).map(o => item(o)),
    item(correspondence, 2), item(schooling)];
  const progress = run(p, items), row = rowFor(progress, ruleFor(p, t.type));
  assert.deepEqual([row.earned, row.status, card(progress, t.id).earned, overall(progress)], [t.target, 'satisfied', t.target, t.target]);
});

for (const p of programs.filter(p => p.department === '日本文学科')) {
  test(`P2 ${p.displayName} required and elective buckets use completed quantities`, () => {
    for (const [type, id] of [['必修', 'professional-required'], ['選択', 'professional-elective']]) {
      const offerings = ordinary(p, type), full = type === '必修' ? 3 : 5;
      const progress = run(p, offerings.slice(0, full + 2).map((o, n) => item(o, n < full ? 4 : 2)));
      assert.deepEqual([rowFor(progress, ruleFor(p, type)).earned, card(progress, id).normalEarned], [full * 4, full * 4]);
      assert.equal(rowFor(progress, ruleFor(p, type)).status, 'unsatisfied');
    }
  });
  test(`P2 ${p.displayName} lawful elective overflow is shared once`, () => {
    const items = [...ordinary(p, '選択必修').slice(0, 6).map(o => item(o)), ...ordinary(p, '選択').slice(0, 5).map(o => item(o))];
    const progress = run(p, items);
    assert.deepEqual([rowFor(progress, ruleFor(p, '選択必修')).earned, card(progress, 'professional-required-elective').earned], [24, 20]);
    assert.deepEqual([rowFor(progress, ruleFor(p, '選択')).earned, rowFor(progress, ruleFor(p, '選択')).status,
      card(progress, 'professional-elective').earned, overall(progress)], [24, 'satisfied', 24, 44]);
  });
}

for (const p of programs) {
  test(`P2 ${p.displayName} dedicated total includes completed thesis`, () => {
    const o = ordinary(p, target(p).type)[0];
    const progress = run(p, [item(o)], [], [], catalog, profile, { selection: 'selected', status: 'earned' });
    assert.equal(rowFor(progress, ruleFor(p, undefined)).earned, 12, 'completed Course4 plus separately managed thesis8');
    assert.equal(card(progress, totalId(p)).normalEarned, 12);
  });
  test(`P2 ${p.displayName} total80 plus incomplete2 cannot satisfy82; completed84 retains its quantity`, () => {
    const offerings = [...new Map(['必修', '選択必修', '選択'].flatMap(type => ordinary(p, type))
      .map(o => [o.curriculumCourseId, o])).values()].slice(0, 21);
    assert.equal(offerings.length, 21);
    const items = offerings.map((o, n) => item(o, n === 20 ? 2 : 4));
    const incomplete = run(p, items), rule = ruleFor(p, undefined);
    assert.deepEqual([rowFor(incomplete, rule).earned, rowFor(incomplete, rule).status, overall(incomplete)], [80, 'unsatisfied', 80]);
    items[20].courseCreditContribution = 4;
    const complete = run(p, items);
    assert.deepEqual([rowFor(complete, rule).earned, rowFor(complete, rule).status,
      card(complete, totalId(p)).earned, card(complete, totalId(p)).normalEarned], [84, 'satisfied', 82, 84]);
  });
  test(`P2 ${p.displayName} planned/in-progress/waiting stay outside earned allocation`, () => {
    const t = target(p), o = ordinary(p, t.type)[0];
    for (const status of ['planned', 'in_progress', 'waiting']) {
      const progress = run(p, [item(o, 2, status)]), row = rowFor(progress, ruleFor(p, t.type)), c = card(progress, t.id);
      assert.deepEqual([row.earned, c.earned, overall(progress)], [0, 0, 0]);
      assert.deepEqual([row.planned, row.inProgress], [c.planned, c.inProgress]);
    }
  });
  test(`P2 ${p.displayName} uncertain identity retains unknown coverage and safe lower bound`, () => {
    const t = target(p), offerings = ordinary(p, t.type), unknown = offerings[t.full];
    const input = { ...catalog, offerings: catalog.offerings.map(o => o.id === unknown.id ? { ...o, resolutionStatus: 'manual_review' } : o) };
    const progress = run(p, [...offerings.slice(0, t.full).map(o => item(o)), item(unknown)], [], [], input);
    const row = rowFor(progress, ruleFor(p, t.type));
    assert.deepEqual([row.earned, row.status, row.coverageStatus], [t.full * 4, 'unknown', 'unknown']);
    assert.equal(card(progress, t.id).status, 'unknown');
  });
  test(`P2 ${p.displayName} unknown composition never becomes satisfied/supported`, () => {
    const t = target(p), o = ordinary(p, t.type)[0], ids = new Set(maps(o, p).map(m => m.mappingId));
    const input = { ...catalog, mappings: catalog.mappings.map(m => ids.has(m.mappingId) ? { ...m, curriculumCredits: null } : m) };
    const progress = run(p, [item(o)], [], [], input), row = rowFor(progress, ruleFor(p, t.type));
    assert.deepEqual([row.earned, row.status, row.coverageStatus], [null, 'unknown', 'unknown']);
    assert.equal(card(progress, t.id).status, 'unknown');
  });
  test(`P2 ${p.displayName} unfamiliar condition/target stays held`, () => {
    const t = target(p), rule = ruleFor(p, t.type), items = ordinary(p, t.type).slice(0, t.target / 4).map(o => item(o));
    for (const patch of [{ conditions: { future_unconfirmed_rule: true } }, { target: { ...rule.target, future_unconfirmed_target: true } }]) {
      const input = { ...catalog, requirements: catalog.requirements.map(r => r.id === rule.id ? { ...r, ...patch } : r) };
      const row = rowFor(run(p, items, [], [], input), rule);
      assert.deepEqual([row.earned, row.status, row.coverageStatus], [null, 'unknown', 'unknown']);
    }
  });
  for (const earned of [null, 0, 2, 4]) test(`P2 ${p.displayName} official aggregate ${earned} remains authoritative`, () => {
    const t = target(p), offerings = ordinary(p, t.type), o = offerings[t.target / 4 - 1];
    const course = catalog.curriculum.courses.find(c => c.id === o.curriculumCourseId), official = officialRow(course, earned);
    const full = offerings.slice(0, t.target / 4 - 1).map(o => item(o)), before = structuredClone(official);
    const only = run(p, full, [official]), withManual = run(p, [...full, item(o)], [official]);
    assert.deepEqual(withManual, only, 'same-Course manual earned neither fills held official nor doubles official4');
    const row = rowFor(withManual, ruleFor(p, t.type));
    assert.equal(row.earned, (t.target / 4 - 1) * 4 + (earned === 4 ? 4 : 0));
    assert.equal(row.status, earned === null || earned === 2 ? 'unknown' : earned === 4 ? 'satisfied' : 'unsatisfied');
    assert.equal(row.coverageStatus, row.status === 'unknown' ? 'unknown' : 'supported');
    assert.deepEqual(official, before);
  });
  test(`P2 ${p.displayName} confirmed separate recognition is not discarded as a partial`, () => {
    const t = target(p), o = ordinary(p, t.type)[0];
    const recognized = { ...profile, admissionType: 'other_transfer', recognizedCredits: { ...profile.recognizedCredits,
      totalCredits: 4, schoolingEquivalentCredits: 0, professionalCourses: [{ id: 'p2-recognition', offeringId: o.id,
        courseId: o.courseId, mappingId: maps(o, p)[0].mappingId, name: o.name, credits: 4 }] } };
    const progress = run(p, [], [], [], catalog, recognized), row = rowFor(progress, ruleFor(p, t.type));
    assert.equal(row.earned, 4); assert.equal(card(progress, t.id).normalEarned, 4);
  });
}

const geography = programs.find(p => p.department === '地理学科');
for (const [kind, count, schooling, requiredElective, elective, total] of [
  ['fieldStudy', 2, 2, 0, 0, 2], ['chorography', 2, 0, 2, 2, 4],
  ['humanSeminar', 2, 2, 2, 0, 4], ['naturalSeminar', 2, 2, 2, 0, 4], ['geographyLecture', 1, 0, 0, 2, 2],
]) test(`P2 actual Geography ${kind} retains lawful staged/partial allocations`, () => {
  const offerings = catalog.offerings.filter(o => o.resolutionStatus === 'matched' && o.method === 'schooling' && maps(o, geography).length
    && geographyTransferKind(o, id => catalog.courses.find(c => c.id === id)?.canonicalName ?? null) === kind).slice(0, count);
  assert.equal(offerings.length, count);
  const progress = run(geography, offerings.map(o => item(o)));
  assert.deepEqual([rowFor(progress, ruleFor(geography, '選択必修')).earned, rowFor(progress, ruleFor(geography, '選択')).earned,
    rowFor(progress, ruleFor(geography, undefined)).earned, overall(progress)], [requiredElective, elective, total, total]);
  assert.equal(card(progress, 'professional-geography-schooling-required').normalEarned, schooling);
  if (kind === 'fieldStudy') {
    const rule = catalog.requirements.find(r => r.ruleId === 'geography_required_min_schooling_credits');
    assert.equal(rowFor(progress, rule).earned, 2, 'actual S quantity remains independent of ordinary full-Course completion');
  }
});

for (const p of programs) test(`P2 ${p.displayName} repeatable lecture2 remains countable`, () => {
  const lecture = catalog.offerings.find(o => o.resolutionStatus === 'matched' && o.credits === 2
    && repeatableRule(p.department, o)?.[1] === '総合特講' && maps(o, p).length);
  assert.ok(lecture);
  const progress = run(p, [item(lecture)]);
  assert.equal(rowFor(progress, ruleFor(p, undefined)).earned, 2);
  assert.equal(card(progress, totalId(p)).normalEarned, 2);
});

test('P2 Geography credit minimum does not acquire the card additional field AND condition', () => {
  const offerings = ordinary(geography, '選択必修').filter(o => !maps(o, geography).some(m => m.field === '地誌・その他の分野')).slice(0, 9);
  assert.equal(offerings.length, 9);
  const progress = run(geography, offerings.map(o => item(o))), row = rowFor(progress, ruleFor(geography, '選択必修'));
  assert.deepEqual([row.earned, row.status, row.coverageStatus], [36, 'satisfied', 'supported']);
  assert.equal(card(progress, 'professional-geography-required-elective').status, 'unsatisfied', 'regional-field minimum is an additional distinct requirement');
});
