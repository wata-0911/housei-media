import type { AttemptId, AttemptOwnedRecord } from '../../src/planner/attempts/types';
import type { WorkbenchIdentities } from '../../src/planner/attempts/workbench/sessionIdentities';
type Progress = Exclude<AttemptOwnedRecord, { kind: 'todo' }>;
export function emptyProgress(kind: Progress['kind'], attemptId: AttemptId, identities: WorkbenchIdentities): Progress {
  const common = { id: identities.newRecordId(), owner: { kind: 'attempt' as const, attemptId } };
  if (kind === 'media') return { ...common, kind, payload: { totalLessons: null, lessons: [], assessments: [] } };
  if (kind === 'correspondence') return { ...common, kind, payload: { requiredReports: null, reports: [], examGrade: null } };
  return { ...common, kind, payload: { finalGrade: null, reportGrade: null, schoolingGrade: null } };
}
