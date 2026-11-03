import type { AdoptionPlan, Targets } from '../../src/planner/attempts/gradeImport/adoption.ts';
import type { DeepReadonly } from '../../src/planner/attempts/gradeImport/sourceArchive.ts';
function readonly(p: DeepReadonly<AdoptionPlan>, t: DeepReadonly<Targets>) {
  // @ts-expect-error immutable old official quantities
  p.resultLedger.view.revisions[0].record.earnedCredits.value = 2;
  // @ts-expect-error target descriptor is not a confirmation
  t.confirmed;
  const unavailable: false = p.authorization.canCommit;
  const untrusted: 'not-certified' = p.authorization.idIssuance;
  void unavailable; void untrusted;
}
void readonly;
