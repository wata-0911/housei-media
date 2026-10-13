import type { OfficialGraduationFact } from './officialGraduationFacts';

/** Existing allocator output, not a second allocation engine. */
export type LectureAllocation = {
  label: string; earned: number; counted: number; limit: number; courses: number; limitCourses: number;
};

/** Null means unconfirmed; counted is only the existing engine's known portion.
 * Official row quantities stay separate: neither duplicate snapshots nor held
 * aggregates are added to the Planner quantity or promoted into allocation.
 */
export type SpecialLectureProgress = LectureAllocation & {
  earnedTotal: number | null;
  earnedCourses: number | null;
  remaining: number | null;
  excess: number | null;
  reason: string | null;
  officialRows: Array<{ id: string; earned: number | null }>;
};

export function specialLectureProgress(
  allocation: LectureAllocation, reason: string | null = null, facts: OfficialGraduationFact[] = [],
): SpecialLectureProgress {
  // Credits and attempt count are separate dimensions. Do not infer attempts
  // by dividing an official aggregate by two, or change the allocator's cap.
  const countBoundaryUncertain = allocation.courses > allocation.limitCourses && allocation.counted < allocation.limit;
  const hold = reason ?? (countBoundaryUncertain ? '回数上限を超えた修得の算入内訳は未確認です。既存の算入値を表示しています。' : null);
  return {
    ...allocation,
    earnedTotal: hold ? null : allocation.earned,
    earnedCourses: hold ? null : allocation.courses,
    remaining: hold ? null : allocation.courses >= allocation.limitCourses ? 0 : Math.max(0, allocation.limit - allocation.counted),
    excess: hold ? null : Math.max(0, allocation.earned - allocation.counted),
    reason: hold,
    officialRows: facts.flatMap(fact => fact.sourceRows.map(row => ({ id: row.id, earned: row.earnedCreditsTotal }))),
  };
}
