import { writeFileSync } from 'node:fs';
import { catalog } from '../../src/planner/catalog/catalog.ts';
const { offerings, courses, curriculum, ...rules } = catalog;
void offerings; void courses;
writeFileSync(new URL('../../src/data/graduation_rules.json', import.meta.url), JSON.stringify({ ...rules, offerings: [], courses: [], curriculum: { ...curriculum, offeringRelations: [] } }));
