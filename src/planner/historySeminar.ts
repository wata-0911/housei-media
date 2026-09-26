import type { Offering, PlannerItem } from './plannerCatalog';

export const HISTORY_SCOPE_ID = '118c5183-6aec-4fa1-905a-265f25d86db1';

export function isHistorySeminar(offering: Offering | undefined) {
  return offering?.name.startsWith('史学演習（') ?? false;
}

export function historySeminarField(offering: Offering) {
  const match = offering.name.match(/^史学演習（(日本|東洋|西洋)）/);
  return match?.[1] ?? null;
}

/** A selected number is a personal completion record, never inferred from the item array or schedule. */
export function validHistorySeminarOrders(items: PlannerItem[], offerings: Map<string, Offering>) {
  const orders = items
    .filter(item => item.status === 'earned' && item.earnedOrder !== null && isHistorySeminar(offerings.get(item.offeringId)))
    .map(item => item.earnedOrder!)
    .sort((a, b) => a - b);
  return new Set(orders).size === orders.length && orders.every((order, index) => order === index + 1);
}
