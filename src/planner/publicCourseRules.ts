import type { Mapping, Offering, PlannerCatalog, PlannerItem, StructuredRequirement } from './plannerCatalog';

/**
 * The curriculum tables name a single "other faculty / other department public
 * course" row, but the 2026 snapshot does not retain an ID for that row.  Do
 * not infer it from an offering's faculty or department: that would include
 * ordinary cross-department mappings and teacher-training offerings.
 *
 * Add only mapping IDs verified against the official public-course notice here.
 * Keeping this empty is deliberate until that source-to-mapping bridge exists.
 */
export const OFFICIAL_PUBLIC_COURSE_MAPPING_IDS_2026: Readonly<Record<string, readonly string[]>> = {};

export type PublicCourseLimit = {
  maxCredits: number;
  maxCourses: number;
  sourcePage: number | null;
};

export type PublicCourseProgress = {
  status: 'satisfied' | 'unsatisfied' | 'unknown';
  earnedCredits: number | null;
  countedCredits: number | null;
  earnedCourses: number | null;
  countedCourses: number | null;
  inProgressCredits: number | null;
  plannedCredits: number | null;
  limit: PublicCourseLimit;
  excludedCredits: number | null;
  reason: string | null;
};

export function isPublicCourseLimitRequirement(requirement: StructuredRequirement) {
  return requirement.ruleType === 'max_credits'
    && requirement.ruleId.endsWith('_open_courses_max_credits')
    && requirement.target.course_name === '（他学部・他学科公開科目）'
    && requirement.value !== null
    && typeof requirement.conditions?.max_enrollments === 'number';
}

export function publicCourseLimitFor(catalog: PlannerCatalog, scopeId: string): PublicCourseLimit | null {
  const requirement = catalog.requirements.find((candidate): candidate is StructuredRequirement =>
    candidate.status === 'structured' && candidate.scopeId === scopeId && isPublicCourseLimitRequirement(candidate));
  if (!requirement || requirement.value === null || !requirement.conditions?.max_enrollments) return null;
  return {
    maxCredits: requirement.value,
    maxCourses: requirement.conditions.max_enrollments,
    sourcePage: requirement.sourcePage,
  };
}

function totals(entries: Array<{ item: PlannerItem; offering: Offering }>, status: PlannerItem['status']) {
  return entries.filter(entry => entry.item.status === status)
    .reduce((sum, entry) => sum + entry.offering.credits!, 0);
}

/** Apply both official caps, one completed offering at a time in plan order. */
export function evaluatePublicCourseLimit(
  items: PlannerItem[], offerings: Map<string, Offering>, mappingIds: ReadonlySet<string>, limit: PublicCourseLimit,
): PublicCourseProgress {
  if (mappingIds.size === 0) {
    return {
      status: 'unknown', earnedCredits: null, countedCredits: null, earnedCourses: null, countedCourses: null,
      inProgressCredits: null, plannedCredits: null, excludedCredits: null, limit,
      reason: '公開科目を表す公式mapping IDが2026カタログにないため、所属情報だけでは安全に識別できません。',
    };
  }
  const entries = items.flatMap(item => {
    const offering = offerings.get(item.offeringId);
    if (!offering || offering.resolutionStatus !== 'matched' || offering.credits === null) return [];
    // PlannerState prohibits duplicate offering IDs. One matching edge is enough:
    // duplicate mapping edges must never create a second counted course.
    return offering.mappingIds.some(id => mappingIds.has(id)) ? [{ item, offering }] : [];
  });
  const earned = entries.filter(entry => entry.item.status === 'earned');
  let countedCredits = 0;
  let countedCourses = 0;
  for (const entry of earned) {
    if (countedCourses >= limit.maxCourses || countedCredits + entry.offering.credits! > limit.maxCredits) continue;
    countedCourses += 1;
    countedCredits += entry.offering.credits!;
  }
  const earnedCredits = totals(entries, 'earned');
  return {
    status: earnedCredits <= limit.maxCredits && earned.length <= limit.maxCourses ? 'satisfied' : 'unsatisfied',
    earnedCredits, countedCredits, earnedCourses: earned.length, countedCourses,
    inProgressCredits: totals(entries, 'in_progress'), plannedCredits: totals(entries, 'planned'),
    excludedCredits: earnedCredits - countedCredits, limit, reason: null,
  };
}

export function publicCourseMappingIdsFor(scopeId: string) {
  return new Set(OFFICIAL_PUBLIC_COURSE_MAPPING_IDS_2026[scopeId] ?? []);
}

export function isExplicitPublicCourseMapping(mapping: Mapping, scopeId: string) {
  return publicCourseMappingIdsFor(scopeId).has(mapping.mappingId);
}
