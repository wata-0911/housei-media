import type { Offering, PlannerItem } from './plannerCatalog';

/** Explicit enrollment contribution, with legacy Offering credits as the default.
 * Callers decide which statuses count. Official aggregates, graduation allocation
 * and schooling registration use their own credit policies. */
export function plannerItemCreditContribution(item: PlannerItem, offering: Offering): number | null {
  return item.courseCreditContribution ?? offering.credits;
}
