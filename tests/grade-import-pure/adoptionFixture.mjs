import {prepareConfirmation,planAdoption,verifyAdoptionPlan} from '../../src/planner/attempts/gradeImport/adoption.ts';
import {previewImport} from '../../src/planner/attempts/gradeImport/preview.ts';
import {createLedger} from '../../src/planner/attempts/gradeImport/ledger.ts';
import {archive,course,assignment,mint,importOp,activateOp,associateOp,append,floor,clone,digest} from './ledgerFixture.mjs';
export {archive,course,assignment,mint,importOp,activateOp,associateOp,append,floor,clone,digest,createLedger};
export const json=JSON.stringify;
export async function context(a,s,f=floor(s)) {const args=[json(a),json(s),json(f)];const p=await previewImport(...args);return {a,s,f,p,args:[json(p),...args]};}
export async function baseline(rows=[course('旧数学',4,'2024')],active=true) {
 const empty=await createLedger(),op=importOp(empty,await archive(rows));let s=await append(empty,op);
 if(active)for(const r of op.rows)s=await append(s,activateOp(s,r));return {empty,op,s};
}
export function choose(c,action='new',activate=false,pick=0) {
 return {targetSnapshotId:c.p.snapshotStatus==='same_snapshot'?c.p.matchingSnapshotIds[0]:mint('snapshot'),rows:c.p.rows.map((r,rowIndex)=>({rowIndex,action,candidate:action==='new'?null:{achievementId:r.candidates[pick].achievementId,revisionId:r.candidates[pick].revisionId,observationId:r.candidates[pick].observationId},activate}))};
}
export async function decide(c,s=choose(c)) {
 const target=await prepareConfirmation(...c.args,json(s));
 const confirmation={selectionSha256:target.selectionSha256,confirmed:true,rows:target.rows.map(r=>({...r,confirmed:true,reason:'synthetic explicit row decision'}))};
 const same=c.p.snapshotStatus==='same_snapshot';
 const allocation={mode:'explicit-test-only-untrusted',importOperationId:mint('operation'),rows:same?[]:s.rows.map(r=>({rowIndex:r.rowIndex,achievementId:r.action==='new'?mint('achievement'):null,observationId:mint('observation'),revisionId:mint('revision'),
 details:Array.from({length:7},()=>({detailId:r.action==='new'?mint('detail'):null,observationId:mint('detail-observation'),revisionId:mint('detail-revision')}))})),activations:s.rows.filter(r=>r.activate).map(r=>({rowIndex:r.rowIndex,operationId:mint('operation')}))};
 return {selection:s,confirmation,allocation};
}
export const plan=(c,d)=>planAdoption(...c.args,json(d));
export const verify=(p,c,d)=>verifyAdoptionPlan(json(p),...c.args,json(d));
