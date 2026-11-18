import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { programs, item, result } from './fixtures/calligraphy-progress.mjs';

import { minimalCases, summer, gw } from './fixtures/calligraphy-partial-details.mjs';
const partial = x => x.graduation.cards.find(c => c.requirementId === 'professional-elective').partialCourses;
if (process.env.CALLIGRAPHY_PARTIAL_BEFORE) {
  writeFileSync(process.env.CALLIGRAPHY_PARTIAL_BEFORE, JSON.stringify(programs.flatMap(p => minimalCases.map(([label, items]) => {
    const x = result(items, {}, [], p.scopeId);
    return { course: p.course, label, offerings: items.map(i => i.offeringId), structure: x.progress.earnedCredits, graduation: x.credits, partialCourses: partial(x) };
  })), null, 2));
}
for (const program of programs) for (const [label, items] of minimalCases) test(`calligraphy partial minimum ${program.course}: ${label}`, () => {
  const x = result(items, {}, [], program.scopeId);
  assert.equal(x.progress.earnedCredits, 1); assert.equal(x.credits, 0);
  assert.equal(partial(x).length, 1);
  assert.deepEqual([partial(x)[0].label, partial(x)[0].earned, partial(x)[0].target, partial(x)[0].evidence], ['書道実技', 1, 2, 'learner']);
});

import { catalog } from '../src/planner/catalog/catalog.ts';
import { calculateGraduationProgress } from '../src/planner/graduation/graduationProgress.ts';
import { referenceCases } from './fixtures/calligraphy-state-references.mjs';
import { profile } from './fixtures/calligraphy-progress.mjs';
import GraduationProgressUI from '../src/components/planner/graduation/GraduationProgress.tsx';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
for (const program of programs) for (const scenario of referenceCases) test(`calligraphy partial contract ${program.course}: ${scenario.label}`, () => {
  const { items, saved, rows, expected: e } = scenario;
  const x = result(items, saved, rows, program.scopeId);
  const expected = rows.length === 0 && e.earned === 1
    ? [{ label: '書道実技', earned: 1, target: 2, evidence: 'learner' }] : [];
  assert.deepEqual((partial(x) ?? []).map(({ label, earned, target, evidence }) => ({ label, earned, target, evidence })), expected);
  assert.equal(x.credits, e.graduation);
  const reversed = result([...items].reverse(), saved, rows, program.scopeId);
  assert.deepEqual(reversed.graduation, x.graduation, 'full graduation output is independent of summer/GW iteration order');
  const html = renderToStaticMarkup(createElement(GraduationProgressUI, { progress: x.graduation }));
  if (expected.length) {
    assert.match(html, /書道実技 本人記録の構成進捗 1 \/ 2単位（未完成・卒業算入0）/);
    assert.doesNotMatch(html, /書道実技（ゴールデンウィークスクーリング） 1 \/ 2/);
  } else assert.doesNotMatch(html, /書道実技 本人記録の構成進捗/);
});
for (const program of programs) for (const curriculumApplicability of ['unknown', 'legacy_or_transition']) test(`calligraphy partial ${program.course}/${curriculumApplicability} cannot bypass shared completion through GW label`, () => {
  const items = [item(gw), item(summer)];
  const p = { ...profile, curriculumApplicability };
  const forward = calculateGraduationProgress(items, catalog, program.scopeId, [], 'not_selected', [], [], p);
  const reverse = calculateGraduationProgress([...items].reverse(), catalog, program.scopeId, [], 'not_selected', [], [], p);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.cards.find(c => c.requirementId === 'professional-elective').earned, 0);
  assert.deepEqual(forward.cards.find(c => c.requirementId === 'professional-elective').partialCourses, []);
});
test('calligraphy partial decision uses institutional identity even when annual labels change', () => {
  const f = structuredClone(catalog);
  for (const o of f.offerings.filter(o => o.curriculumCourseId === summer.curriculumCourseId)) o.name = '開講表示だけを変更';
  const run = items => calculateGraduationProgress(items, f, programs[0].scopeId, [], 'not_selected', [], [], profile);
  const row = run([item(gw), item(summer, 'planned')]).cards.find(c => c.requirementId === 'professional-elective');
  assert.deepEqual(row.partialCourses.map(({ label, earned, target, evidence }) => ({ label, earned, target, evidence })), [{ label: '書道実技', earned: 1, target: 2, evidence: 'learner' }]);
  assert.equal(row.earned, 0);
});
test('an ordinary4 opening named 書道実技 never acquires the special identity rule', () => {
  const f = structuredClone(catalog); const scope = programs[0].scopeId;
  const o = f.offerings.find(o => o.method === 'correspondence' && o.credits === 4 && o.curriculumCourseId
    && o.mappingIds.some(id => f.mappings.some(m => m.mappingId === id && m.scopeId === scope && m.category === '専門教育' && m.requirementType === '選択')));
  assert.ok(o); o.name = '書道実技';
  const p = calculateGraduationProgress([item(o)], f, scope, [], 'not_selected', [], [], profile);
  assert.equal(p.cards.find(c => c.requirementId === 'professional-elective').earned, 4);
});
