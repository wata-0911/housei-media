import { createGradeImportBackupController, type RestoreIntent, type RestoreProposal } from '../../src/planner/attempts/gradeImportHost/portable/controller';
import { inspectBackupBytes } from '../../src/planner/attempts/gradeImportHost/portable/codec';
const c = createGradeImportBackupController(indexedDB, navigator.locks, location.origin, localStorage);
// @ts-expect-error plain JSON is not a live proposal
const proposal: RestoreProposal = { confirmationJson: '{}' };
// @ts-expect-error display targets are not a live intent
const intent: RestoreIntent = { targetsJson: '{}', targetSha256: '' };
void proposal; void intent;
async function readonlyInspection() {
  const r = await inspectBackupBytes(new Uint8Array());
  // @ts-expect-error inspection cannot mutate a reservation
  r.record.authority.reservedIds.push('x');
  // @ts-expect-error inspection is not a restore proposal
  await c.commitRestore(r);
}
void readonlyInspection;
