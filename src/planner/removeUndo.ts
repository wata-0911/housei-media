import type { PlannerItem, PublicCourse } from './plannerCatalog';

export type RemovedPlannerItem = { item: PlannerItem; index: number };
export type RemovedPublicCourse = { course: PublicCourse; index: number };
export type RemovedPlanEntry = { kind: 'item'; removed: RemovedPlannerItem } | { kind: 'publicCourse'; removed: RemovedPublicCourse };

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

export function removePublicCourse(courses: PublicCourse[], id: string): RemovedPublicCourse | null {
  const index = courses.findIndex(course => course.id === id);
  return index === -1 ? null : { course: courses[index], index };
}

export function restorePublicCourse(courses: PublicCourse[], removed: RemovedPublicCourse): PublicCourse[] | null {
  if (courses.some(course => course.id === removed.course.id)) return null;
  const index = Math.min(Math.max(removed.index, 0), courses.length);
  return [...courses.slice(0, index), removed.course, ...courses.slice(index)];
}
