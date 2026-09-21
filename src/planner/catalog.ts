import data from '../data/planner_catalog_2026.json';
import { validateCatalog } from './validation';
import { createMappingResolver } from './plannerHelpers';

function loadCatalog() {
  const input: unknown = data;
  if (!validateCatalog(input)) throw new Error('2026カタログの形式が不正です。');
  const offerings = new Set(input.offerings.map(o => o.id));
  const courses = new Set(input.courses.map(c => c.id));
  const resolveMappings = createMappingResolver(input);
  if (offerings.size !== 686 || input.offerings.length !== 686) {
    throw new Error('2026カタログの開講件数が一致しません。');
  }
  for (const offering of input.offerings) {
    resolveMappings(offering);
    if (offering.courseId !== null && !courses.has(offering.courseId)) {
      throw new Error('カタログの科目参照が不正です。');
    }
  }
  return input;
}

export const catalog = loadCatalog();
export const offeringsById = new Map(catalog.offerings.map(o => [o.id, o]));
