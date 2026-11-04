import type {NativeHandle,PreparedIntent,Proposal} from '../../src/planner/attempts/gradeImportHost/controllerV2.ts';
import type {AdoptionPlan} from '../../src/planner/attempts/gradeImport/adoption.ts';
function types(p:AdoptionPlan){
 // @ts-expect-error pure plans are not live proposals
 const q:Proposal=p;
 // @ts-expect-error source JSON is not a native handle
 const h:NativeHandle={snapshotJson:'{}'};
 // @ts-expect-error arbitrary ID arrays are not durable tickets
 const i:PreparedIntent={issuedIds:[],targetsJson:'{}'};
 void [q,h,i];
}
void types;

import type {createGradeImportHostV2} from '../../src/planner/attempts/gradeImportHost/controllerV2.ts';
type Host=ReturnType<typeof createGradeImportHostV2>;
function upgradeTypes(h:Host){
 // @ts-expect-error confirmation JSON is not a private upgrade proposal
 void h.commitUpgrade({receiptJson:'{}'});
}
void upgradeTypes;
