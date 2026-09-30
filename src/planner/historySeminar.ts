import type { Offering, PlannerItem } from './plannerCatalog';

export const HISTORY_SCOPE_ID = '118c5183-6aec-4fa1-905a-265f25d86db1';

export function isHistorySeminar(offering: Offering | undefined) {
  return offering?.name.startsWith('史学演習（') ?? false;
}

export function isHistoricalSources(offering: Offering | undefined) {
  return offering?.name.startsWith('歴史資料学（') ?? false;
}

export function isHistoryCompletionOrderCourse(offering: Offering | undefined) {
  return isHistorySeminar(offering) || isHistoricalSources(offering);
}

export function historySeminarField(offering: Offering) {
  const match = offering.name.match(/^史学演習（(日本|東洋|西洋)）/);
  return match?.[1] ?? null;
}

/** A selected number is a personal completion record, never inferred from a plan's schedule. */
export function validHistoryCompletionOrders(items: PlannerItem[], offerings: Map<string, Offering>, predicate: (offering: Offering | undefined) => boolean) {
  const orders = items
    .filter(item => item.status === 'earned' && item.earnedOrder !== null && predicate(offerings.get(item.offeringId)))
    .map(item => item.earnedOrder!)
    .sort((a, b) => a - b);
  return new Set(orders).size === orders.length && orders.every((order, index) => order === index + 1);
}

export function validHistorySeminarOrders(items: PlannerItem[], offerings: Map<string, Offering>) {
  return validHistoryCompletionOrders(items, offerings, isHistorySeminar);
}

export function validHistoricalSourceOrders(items: PlannerItem[], offerings: Map<string, Offering>) {
  return validHistoryCompletionOrders(items, offerings, isHistoricalSources);
}
