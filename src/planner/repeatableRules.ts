import type { Offering } from './plannerCatalog';

/** Official 2026 limits. Exact canonical names avoid broad fuzzy matching. */
export const REPEATABLE_CREDIT_RULES = [
  ['日本文学科', '総合特講', 16, 8], ['地理学科', '総合特講', 16, 8],
  ['史学科', '総合特講', 16, 8], ['史学科', '歴史資料学', 12, 6],
  ['法律学科', '法律学特講', 8, 4], ['法律学科', '総合特講', 16, 8],
  ['経済学科', '経済学特講', 8, 4], ['経済学科', '経営学特講', 8, 4], ['経済学科', '総合特講', 16, 8], ['経済学科', '演習', 4, 2],
  ['商業学科', '経済学特講', 8, 4], ['商業学科', '経営学特講', 16, 8], ['商業学科', '総合特講', 16, 8], ['商業学科', '演習', 4, 2],
] as const;
export function repeatableRule(department: string, offering: Offering) {
  return REPEATABLE_CREDIT_RULES.find(([d, name]) => d === department && (
    offering.name === name
    || offering.name.startsWith(`${name}（`)
    || offering.name.startsWith(`${name}［`)
  ));
}
