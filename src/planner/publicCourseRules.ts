import type { PlannerCatalog, PublicCourse, StructuredRequirement } from './plannerCatalog';

export type PublicCourseLimit = {
  maxCredits: number;
  maxCourses: number;
  sourcePage: number | null;
};

export type PublicCourseProgress = {
  earnedCredits: number;
  countedCredits: number;
  earnedCourses: number;
  countedCourses: number;
  inProgressCredits: number;
  plannedCredits: number;
  limit: PublicCourseLimit;
  excludedCredits: number;
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

/** Public-course records are explicit user-owned data, not catalog offerings. */
export function evaluatePublicCourseLimit(publicCourses: PublicCourse[], limit: PublicCourseLimit): PublicCourseProgress {
  const earned = publicCourses.filter(course => course.status === 'earned');
  const countedCourses = Math.min(earned.length, limit.maxCourses);
  const earnedCredits = earned.length * 2;
  const countedCredits = countedCourses * 2;
  return {
    earnedCredits, countedCredits, earnedCourses: earned.length, countedCourses,
    inProgressCredits: publicCourses.filter(course => course.status === 'in_progress').length * 2,
    plannedCredits: publicCourses.filter(course => course.status === 'planned').length * 2,
    excludedCredits: earnedCredits - countedCredits, limit,
  };
}
