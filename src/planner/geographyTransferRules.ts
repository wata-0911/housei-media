import type { Offering } from './plannerCatalog';

/**
 * The 2026 Geography curriculum (shiori pp.54–55) names destination courses,
 * but they are credit-allocation rules, not extra completed offerings.  Keeping
 * this table separate makes the year-specific policy auditable and prevents a
 * future catalogue from inheriting it accidentally.
 */
export const GEOGRAPHY_TRANSFER_RULES_2026 = {
  fieldStudy: { canonicalName: '現地研究', stages: [['スクーリング必修', 2], ['選択', 2]] },
  chorography: { canonicalName: '地誌学特講', stages: [['選択必修:地誌・その他の分野', 2], ['選択', Infinity]] },
  humanSeminar: { canonicalName: '人文地理学演習', stages: [['スクーリング必修', 2], ['選択必修:人文地理の分野', 2], ['選択', Infinity]] },
  naturalSeminar: { canonicalName: '自然地理学演習', stages: [['スクーリング必修', 2], ['選択必修:自然地理の分野', 2], ['選択', Infinity]] },
  geographyLecture: { canonicalNames: ['人文地理学特講', '自然地理学特講'], stages: [['選択', 4]] },
} as const;

export type GeographyTransferKind = keyof typeof GEOGRAPHY_TRANSFER_RULES_2026;
export type GeographyTransferRow = { id: string; credits: number; status: 'earned' | 'in_progress' | 'planned' };
export type GeographyAllocation = { id: string; status: GeographyTransferRow['status']; bucket: string; credits: number };

const baseName = (name: string) => name.replace(/（.*$|\(.*$|［.*$|\[.*$/, '');

/** Course identity is preferred; the strict normalized offering title is only a
 * compatibility fallback for legacy/mapping-only snapshot rows. */
export function geographyTransferKind(
  offering: Offering, canonicalNameForCourse: (courseId: string | null) => string | null,
): GeographyTransferKind | null {
  const name = canonicalNameForCourse(offering.courseId) ?? baseName(offering.name);
  for (const [kind, rule] of Object.entries(GEOGRAPHY_TRANSFER_RULES_2026) as Array<[GeographyTransferKind, typeof GEOGRAPHY_TRANSFER_RULES_2026[GeographyTransferKind]]>) {
    const names = 'canonicalName' in rule ? [rule.canonicalName] : rule.canonicalNames;
    if (names.includes(name as never)) return kind;
  }
  return null;
}

/** Allocate each completed identity once, in source-defined stages.  A stage
 * with Infinity is deliberately unbounded; omitting later stages means excess
 * is not graduation-countable. */
export function allocateGeographyTransfers(kind: GeographyTransferKind, rows: GeographyTransferRow[]): {
  allocations: GeographyAllocation[]; discarded: number;
} {
  const rule = GEOGRAPHY_TRANSFER_RULES_2026[kind];
  const stages = rule.stages as ReadonlyArray<readonly [string, number]>;
  const allocations: GeographyAllocation[] = [];
  let discarded = 0;
  for (const status of ['earned', 'in_progress', 'planned'] as const) {
    const used = stages.map(() => 0);
    for (const row of rows.filter(candidate => candidate.status === status)) {
      let assigned = false;
      for (let index = 0; index < stages.length && !assigned; index += 1) {
        const [bucket, cap] = stages[index];
        const room = cap === Infinity ? row.credits : Math.max(0, cap - used[index]);
        // An offering is indivisible.  This is normally exact (1 credit for
        // 現地研究, 2 for the other rows); it also keeps malformed metadata
        // from silently splitting one identity across two graduation buckets.
        if (room < row.credits) continue;
        allocations.push({ id: row.id, status, bucket, credits: row.credits });
        used[index] += row.credits;
        assigned = true;
      }
      if (status === 'earned' && !assigned) discarded += row.credits;
    }
  }
  return { allocations, discarded };
}
