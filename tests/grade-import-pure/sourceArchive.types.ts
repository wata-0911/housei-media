import { createGradeSourceArchive, type SourceLimits, type DeepReadonly, type GradeSourceArchive } from '../../src/planner/attempts/gradeImport/sourceArchive.ts';
const tighter: Partial<SourceLimits> = { maxCourses: 1, maxRawBytes: 1024, maxArchiveBytes: 4096 };
void createGradeSourceArchive('{}', tighter);
function readonlyContract(a: DeepReadonly<GradeSourceArchive>) {
  // @ts-expect-error archives cannot be changed through the public type
  a.dto.courses[0].earnedCredits.value = 99;
  // @ts-expect-error raw is immutable
  a.raw = '';
  // @ts-expect-error this source contract has no authority capability
  return a.canCommit;
}
void readonlyContract;
