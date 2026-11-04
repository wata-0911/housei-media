import assert from 'node:assert/strict';
import { scenarios, calculateScenario } from './unresolved-condition-scenarios.mjs';

export const displayScenarios = () => {
  const cases = scenarios();
  const unset = cases.find(s => s.name.endsWith('/A'));
  const held = cases.find(s => s.name.endsWith('/H'));
  const partial = cases.find(s => s.name.endsWith('/C'));
  // Display-only edge cases: never fed back into the calculator or saved state.
  const mixed = calculateScenario(partial);
  const candidate = mixed.cards.find(r => r.target !== null && r.unit !== null && r.ruleType !== 'public_course_limit');
  assert.ok(candidate);
  Object.assign(candidate, { status: 'satisfied', earned: candidate.target });
  const all = structuredClone(mixed);
  all.cards = all.cards.filter(r => r.target !== null && r.unit !== null && r.ruleType !== 'public_course_limit')
    .map(r => ({ ...r, status: 'satisfied', earned: r.target }));
  assert.ok(all.cards.length);
  return [
    { name: 'unset', progress: calculateScenario(unset), context: { catalog: unset.catalog, scopeId: unset.scopeId, profile: unset.profile, importedRows: unset.rows } },
    { name: 'held', progress: calculateScenario(held) },
    { name: 'mixed', progress: mixed },
    { name: 'all', progress: all },
  ];
};
