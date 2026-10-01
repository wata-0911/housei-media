import type { PlannerItem } from './plannerCatalog';

/** The exact initial record persisted when Course Search adds an offering. */
export function plannerItemFromCourseSearch(offeringId: string): PlannerItem {
  return { offeringId, status: 'planned', plannedYear: 2026, plannedTerm: null, studyYear: null, earnedOrder: null };
}

/** Apply the same lifecycle rule used by the editable Planner row. */
export function updatePlannerItem<T extends PlannerItem>(items: T[], offeringId: string, patch: Partial<Omit<PlannerItem, 'offeringId'>>): T[] {
  return items.map(item => item.offeringId === offeringId
    ? { ...item, ...patch, ...(patch.status && patch.status !== 'earned' ? { earnedOrder: null } : {}) }
    : item);
}
