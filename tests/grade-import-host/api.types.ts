import type { NativeHandle, PreparedIntent, Proposal, HostPreview } from '../../src/planner/attempts/gradeImportHost/controller.ts';
import type { AdoptionPlan } from '../../src/planner/attempts/gradeImport/adoption.ts';
function qualification(plan: AdoptionPlan) {
  // @ts-expect-error bare pure plan has no live host brand
  const p: Proposal = plan;
  // @ts-expect-error copied display JSON is not a native handle
  const h: NativeHandle = { snapshotJson: '{}' };
  // @ts-expect-error arbitrary IDs are not a live issued ticket
  const i: PreparedIntent = { targetsJson: '{}', issuedIds: [] };
  // @ts-expect-error display flag cannot create host qualification
  const v: HostPreview = { displayJson: '{}' };
  void [p,h,i,v];
}
void qualification;
