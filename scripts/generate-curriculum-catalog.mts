import fs from 'node:fs';
import { generateCurriculumCatalog } from '../src/planner/curriculumGeneration';
import { applyManualMappingOverrides } from '../src/planner/manualMappingOverrides';
import type { PlannerCatalog } from '../src/planner/plannerCatalog';
const read = (path: string) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const catalog = applyManualMappingOverrides(read('../src/data/planner_catalog_2026.json') as PlannerCatalog);
const data = generateCurriculumCatalog(catalog, read('./inputs/curriculum-rows-2026.json').rows, read('./inputs/curriculum-equivalences-2026.json').groups);
const path = new URL('../src/data/planner_curriculum_2026.json', import.meta.url);
// One record per line keeps the complete source/relation data reviewable.
const fields = Object.entries(data).map(([key, value]) => {
  const json = Array.isArray(value) ? `[\n${value.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]` : JSON.stringify(value);
  return `  ${JSON.stringify(key)}: ${json}`;
});
const output = `{\n${fields.join(',\n')}\n}\n`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync(path, 'utf8') !== output) throw new Error('Curriculum catalog is stale; run npm run catalog:generate');
} else fs.writeFileSync(path, output);
console.log(`Curriculum catalog: ${data.courses.length} courses / ${data.offeringRelations.length} annual offerings`);
