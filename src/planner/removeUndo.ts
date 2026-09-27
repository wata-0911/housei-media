import type { PlannerItem } from './plannerCatalog';

export type RemovedPlannerItem = { item: PlannerItem; index: number };

/** Removes one offering without mutating the saved plan. */
export function removePlannerItem(items: PlannerItem[], offeringId: string): RemovedPlannerItem | null {
  const index = items.findIndex(item => item.offeringId === offeringId);
  if (index === -1) return null;
  return { item: items[index], index };
}

/** Restores a removed item at its original position unless it has since been re-added. */
export function restorePlannerItem(items: PlannerItem[], removed: RemovedPlannerItem): PlannerItem[] | null {
  if (items.some(item => item.offeringId === removed.item.offeringId)) return null;
  const index = Math.min(Math.max(removed.index, 0), items.length);
  return [...items.slice(0, index), removed.item, ...items.slice(index)];
}
