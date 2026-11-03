import type { DeepReadonly } from '../../src/planner/attempts/gradeImport/sourceArchive.ts';
import type { Ledger, Operation, Id } from '../../src/planner/attempts/gradeImport/ledger.ts';
function boundary(s: DeepReadonly<Ledger>, observation: Id<'observation'>) {
  // @ts-expect-error observation is not a logical achievement ID
  const wrong: Id<'achievement'> = observation;
  // @ts-expect-error official revision is readonly
  s.view.revisions[0].record.earnedCredits.value = 2;
  // @ts-expect-error no save capability
  s.canCommit;
  void wrong;
}
void boundary;
// @ts-expect-error deletion is not supported
const remove: Operation = { kind: 'delete_row' };
void remove;
