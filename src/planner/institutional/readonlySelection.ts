import type { InstitutionalSearchRow } from './search';

/** Preview admission only. A null result grants no applicability or save authority. */
export function readonlySelectionHold(row: InstitutionalSearchRow): string | null {
  if (row.placement.kind !== 'course_placement') return '非科目枠のため入力候補にできません。';
  if (row.placement.identityDecision.status !== 'safe' || !row.institutionalCourse
    || row.institutionalCourse.id !== row.placement.institutionalCourseId) {
    return '科目の同一性が未確定のため入力候補にできません。';
  }
  return null;
}
