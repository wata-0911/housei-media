import { course, input, oracle } from '../grade-import-pure/ledgerFixture.mjs';
import { createHost, environment, sourceContext, rawDigest, appendHost, receiptFor, confirmationTargets, json } from '../../src/planner/attempts/gradeImportHost/codec.ts';
import { HostIdentityOwner } from '../../src/planner/attempts/gradeImportHost/identity.ts';
export { course, input, oracle, json };
export const origin='http://127.0.0.1:4197';
export const hostId='12345678-0000-4000-8000-000000000000';
export const raw=(quantity=4, year='2024')=>JSON.stringify({...input([course('旧4単位・未照合',quantity,year)]),unknown:{original:['keep',0,null]},metadata:{manualCredits:2}});
export function confirm(targets,reason='合成fixture: この原行を新規採用') {return {selectionSha256:targets.selectionSha256,confirmed:true,rows:targets.rows.map(r=>({...r,confirmed:true,reason}))};}
export async function reserved(activate=false,source=raw()) {
 const r=await createHost(hostId,environment(origin)),c=await sourceContext(source,r),owner=new HostIdentityOwner(),m=owner.mint(r,activate);
 const grant={intentId:m.ids[0],ids:m.ids,selection:m.selection,allocation:m.allocation,archiveSha256:await rawDigest(c.archiveRaw),previewSha256:c.preview.previewSha256,ledgerSha256:await rawDigest(c.ledgerRaw),floorSha256:await rawDigest(c.floorRaw),environment:r.environment};
 const t=await confirmationTargets(c,grant),decision={selection:grant.selection,allocation:grant.allocation,confirmation:confirm(t)};
 const t1=await appendHost(r,{kind:'reserve',grant});
 return {r,c,owner,m,grant,t,decision,t1};
}
export async function adopted(activate=false,source=raw()) {
 const v=await reserved(activate,source),p=await receiptFor(v.c,v.grant,v.decision);
 const t2=await appendHost(v.t1,{kind:'adopt',receipt:p.receipt},json(p.plan.resultLedger));return {...v,...p,t2};
}
