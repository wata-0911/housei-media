import type { InstitutionalSearchRow } from '../../src/planner/institutional/search';

export type NameMatchMode = 'partial' | 'exact';
// #104 presentation comparison only; never an official identity decision.
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja').trim();
export function filterPlacementNames(rows: InstitutionalSearchRow[], query: string, mode: NameMatchMode) {
  const needle = normalize(query);
  if (!needle) return rows;
  const terms = needle.split(/\s+/);
  return rows.filter(({ placement }) => {
    const name = normalize(placement.officialName);
    return mode === 'exact' ? name === needle : terms.every(term => name.includes(term));
  });
}

export const compositionLabel = (credits: number | null) => credits === null ? '不明（null）' : `${credits}単位`;
