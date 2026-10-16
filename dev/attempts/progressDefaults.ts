import type { AttemptId, AttemptOwnedRecord } from '../../src/planner/attempts/types';
import { newRecordId } from '../../src/planner/attempts/workbench/operations';
type Progress = Exclude<AttemptOwnedRecord, { kind: 'todo' }>;
export function emptyProgress(kind: Progress['kind'], attemptId: AttemptId): Progress {
  const common = { id: newRecordId(), owner: { kind: 'attempt' as const, attemptId } };
  if (kind === 'media') return { ...common, kind, payload: { totalLessons: null, lessons: [], assessments: [] } };
  if (kind === 'correspondence') return { ...common, kind, payload: { requiredReports: null, reports: [], examGrade: null } };
  return { ...common, kind, payload: { finalGrade: null, reportGrade: null, schoolingGrade: null } };
}
