import data from '../data/planner_catalog_2026.json';
import { validateCatalog } from './validation';
import { createMappingResolver } from './plannerHelpers';
import { applyManualMappingOverrides } from './manualMappingOverrides';

function loadCatalog() {
  const input: unknown = data;
  if (!validateCatalog(input)) throw new Error('2026カタログの形式が不正です。');
  const catalog = applyManualMappingOverrides(input);
  if (!validateCatalog(catalog)) throw new Error('Manual mapping適用後のカタログ形式が不正です。');
  const offerings = new Set(catalog.offerings.map(o => o.id));
  const courses = new Set(catalog.courses.map(c => c.id));
  const resolveMappings = createMappingResolver(catalog);
  if (offerings.size !== 686 || catalog.offerings.length !== 686) {
    throw new Error('2026カタログの開講件数が一致しません。');
  }
  for (const offering of catalog.offerings) {
    resolveMappings(offering);
    if (offering.courseId !== null && !courses.has(offering.courseId)) {
      throw new Error('カタログの科目参照が不正です。');
    }
  }
  return catalog;
}

export const catalog = loadCatalog();
export const offeringsById = new Map(catalog.offerings.map(o => [o.id, o]));
