import { catalog } from '../../src/planner/catalog/catalog.ts';
import { course, item } from './calligraphy-progress.mjs';
export const summer = catalog.offerings.find(o => o.curriculumCourseId === course.id && o.method === 'schooling' && o.name.includes('夏期'));
export const gw = catalog.offerings.find(o => o.curriculumCourseId === course.id && o.method === 'schooling' && o.name.includes('ゴールデンウィーク'));
if (!summer || !gw || summer.credits !== 1 || gw.credits !== 1) throw new Error('Real 2026 summer/GW S1 fixture is required');
export const minimalCases = [
  ['summer earned only', [item(summer)]],
  ['GW earned only', [item(gw)]],
  ['summer first: summer earned/GW planned', [item(summer), item(gw, 'planned')]],
  ['GW first: summer earned/GW planned', [item(gw, 'planned'), item(summer)]],
];
