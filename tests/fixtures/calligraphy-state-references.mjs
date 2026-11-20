import { corr, schools, item, batch, official } from './calligraphy-progress.mjs';

// Independent contract tuples: structure earned, projected, in-progress S1,
// planned S1, waiting S1 (excluded from both card labels), graduation counted.
const expected = ([earned, projected, inProgress, planned, waiting, graduation]) => ({ earned, projected, inProgress, planned, waiting, graduation });
const single = {
  planned: [0, 1, 0, 1, 0, 0], in_progress: [0, 1, 1, 0, 0, 0],
  waiting: [0, 1, 0, 0, 1, 0], earned: [1, 1, 0, 0, 0, 0],
};
const withBatch = {
  planned: [0, 2, 0, 1, 0, 0], in_progress: [0, 2, 1, 0, 0, 0],
  waiting: [0, 2, 0, 0, 1, 0], earned: [2, 2, 0, 0, 0, 2],
};
const pairs = [
  ['planned', 'planned', [0, 2, 0, 2, 0, 0]],
  ['planned', 'in_progress', [0, 2, 1, 1, 0, 0]],
  ['planned', 'waiting', [0, 2, 0, 1, 1, 0]],
  ['planned', 'earned', [1, 2, 0, 1, 0, 0]],
  ['in_progress', 'planned', [0, 2, 1, 1, 0, 0]],
  ['in_progress', 'in_progress', [0, 2, 2, 0, 0, 0]],
  ['in_progress', 'waiting', [0, 2, 1, 0, 1, 0]],
  ['in_progress', 'earned', [1, 2, 1, 0, 0, 0]],
  ['waiting', 'planned', [0, 2, 0, 1, 1, 0]],
  ['waiting', 'in_progress', [0, 2, 1, 0, 1, 0]],
  ['waiting', 'waiting', [0, 2, 0, 0, 2, 0]],
  ['waiting', 'earned', [1, 2, 0, 0, 1, 0]],
  ['earned', 'planned', [1, 2, 0, 1, 0, 0]],
  ['earned', 'in_progress', [1, 2, 1, 0, 0, 0]],
  ['earned', 'waiting', [1, 2, 0, 0, 1, 0]],
  ['earned', 'earned', [2, 2, 0, 0, 0, 2]],
];
const scenario = (label, items, tuple, saved = {}, rows = [], completion = tuple[0] === 2 ? 'complete' : 'incomplete') => ({ label, items, saved, rows, expected: expected(tuple), completion });
export const referenceCases = [
  ...Object.entries(single).map(([status, tuple]) => scenario(`S1 ${status}`, [item(schools[0], status)], tuple)),
  scenario('batch passed only', [item(corr, 'in_progress')], [0, 0, 0, 0, 0, 0], batch('passed')),
  ...Object.entries(withBatch).map(([status, tuple]) => scenario(`batch passed+S1 ${status}`, [item(corr, 'in_progress'), item(schools[0], status)], tuple, batch('passed'))),
  ...pairs.map(([left, right, tuple]) => scenario(`S1 ${left}+S1 ${right}`, [item(schools[0], left), item(schools[1], right)], tuple)),
  ...pairs.map(([left, right, tuple]) => scenario(`batch passed+S1 ${left}+S1 ${right}`, [item(corr, 'in_progress'), item(schools[0], left), item(schools[1], right)],
    left === 'earned' || right === 'earned' ? [2, 2, 0, 0, 0, 2] : tuple, batch('passed'))),
  ...Object.entries(single).map(([status, tuple]) => scenario(`legacy T2 earned+S1 ${status}`, [item(corr), item(schools[0], status)], tuple)),
];
for (const [label, row, tuple, completion] of [
  ['official2/S1', official(), [2, 2, 0, 0, 0, 2], 'complete'],
  ['official2/S2', official({ schoolingCreditsTotal: 2 }), [2, 2, 0, 0, 0, 2], 'complete'],
  ['official null', official({ earnedCreditsTotal: null, schoolingCreditsTotal: null }), [0, 0, 0, 0, 0, 0], 'unknown'],
  ['official explicit0', official({ earnedCreditsTotal: 0, schoolingCreditsTotal: 0 }), [0, 0, 0, 0, 0, 0], 'incomplete'],
  ['official partial1', official({ earnedCreditsTotal: 1 }), [1, 1, 0, 0, 0, 0], 'unknown'],
]) for (const [left, right] of [['in_progress', 'planned'], ['waiting', 'in_progress'], ['earned', 'planned']]) {
  referenceCases.push(scenario(`${label}+manual ${left}/${right}`, [item(corr), item(schools[0], left), item(schools[1], right)], tuple, batch('passed'), [row], completion));
}
export const persistenceCaseLabels = [
  'S1 in_progress', 'S1 waiting', 'S1 in_progress+S1 planned',
  'batch passed+S1 in_progress', 'batch passed+S1 earned+S1 planned',
  'legacy T2 earned+S1 waiting', 'official2/S1+manual in_progress/planned',
  'official null+manual in_progress/planned', 'official explicit0+manual in_progress/planned',
  'official partial1+manual in_progress/planned',
];
