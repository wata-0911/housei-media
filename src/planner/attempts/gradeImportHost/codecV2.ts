import { createGradeSourceArchive } from '../gradeImport/sourceArchive';
import { verifyLedgerState } from '../gradeImport/ledger';
import { previewImport, verifyImportPreview } from '../gradeImport/preview';
import { prepareConfirmation, planAdoption, verifyAdoptionPlan } from '../gradeImport/adoption';
import type { Candidate } from '../gradeImport/preview';
import type { Decision } from '../gradeImport/adoption';
import type { DeepReadonly } from '../gradeImport/sourceArchive';
import { fail, LIMITS, type HostRecord } from './contracts';
import { POLICY, VERIFIER, type Environment, type Provenance, type UpgradeReceipt, type UpgradeTarget, type Grant, type Receipt, type RecordV2, type FrozenRecord, type Body, type Event } from './contractsV2';
import * as v1 from './codec';
export const { json, parse, equal, freeze, digest, rawDigest, uuidPattern } = v1;
export function environment(origin: string): Environment { return { ...v1.environment(origin), policy: POLICY }; }
export function checkEnvironment(e: Environment) { if (!e || typeof e.origin !== 'string' || !equal(e, environment(e.origin))) fail('unsupported_policy'); }
function keys(v: unknown, k: string[]): asserts v is Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== [...k].sort().join(',')) fail('shape'); }
export async function upgradeTarget(raw: string, provenance: Provenance):Promise<UpgradeTarget> {
 return upgradeTargetFromDecoded(raw,provenance,await v1.decodeHost(raw));
}
// Private, call-local reuse only: both callers pass the frozen result of the
// immediately preceding v1 decode of these exact raw bytes under the fixed
// verifier/policy. This result never grants native save authority.
async function upgradeTargetFromDecoded(raw:string,provenance:Provenance,b:Awaited<ReturnType<typeof v1.decodeHost>>):Promise<UpgradeTarget>{
 const c=await v1.ledgerContext(b);
 if (!['native-v1-upgrade','native-v2-empty'].includes(provenance)) fail('shape');
 if(provenance==='native-v2-empty'&&!equal(b,await v1.createHost(b.hostId,b.environment)))fail('invalid_host');
 return {baseRawSha256:await rawDigest(raw),baseTipSha256:b.authority.tipSha256,hostId:b.hostId,ledgerSha256:await rawDigest(b.ledgerRaw),floorSha256:await rawDigest(c.floorRaw),reservationsSha256:await digest(b.authority.reservedIds),policy:POLICY,verifier:VERIFIER,provenance};
}
async function genesis(raw:string,provenance:Provenance,receipt:UpgradeReceipt):Promise<RecordV2>{
 const b=await v1.decodeHost(raw),target=await upgradeTargetFromDecoded(raw,provenance,b);
 keys(receipt,[...Object.keys(target),'confirmed','reason']);
 const {confirmed,reason,...rest}=receipt;
 if(confirmed!==true||typeof reason!=='string'||!reason.trim()||!equal(rest,target))fail('unqualified');
 const anchorSha256=await digest({domain:'g03-explicit-policy-upgrade/v2',receipt});
 return {format:b.format,hostVersion:2,verifier:VERIFIER,environment:environment(b.environment.origin),hostId:b.hostId,baseProvenance:provenance,legacyBaseRaw:raw,migration:receipt,anchorSha256,events:[],ledgerRaw:b.ledgerRaw,receipts:parse(json(b.receipts)) as Receipt[],outcomes:parse(json(b.outcomes)) as RecordV2['outcomes'],authority:parse(json(b.authority)) as HostRecord['authority']};
}
export async function migrate(raw:string,provenance:Provenance,receipt:UpgradeReceipt){return decodeHostV2(json(await genesis(raw,provenance,receipt)));}
export async function createHost(hostId:string,env:Environment){const b=json(await v1.createHost(hostId,v1.environment(env.origin)));const target=await upgradeTarget(b,'native-v2-empty');return migrate(b,'native-v2-empty',{...target,confirmed:true,reason:'explicit native v2 initialization'});}
export async function ledgerContext(r:FrozenRecord){const ledger=await verifyLedgerState(r.ledgerRaw);return {ledger,ledgerRaw:r.ledgerRaw,floorRaw:json({issuedIds:ledger.issuedIds,reservedIds:ledger.reservedIds})};}
export async function sourceContext(raw:unknown,r:FrozenRecord){
 const archive=await createGradeSourceArchive(raw);if(archive.dto.courses.length!==1)fail('unsupported_policy');
 const c=await ledgerContext(r),archiveRaw=json(archive),preview=await previewImport(archiveRaw,c.ledgerRaw,c.floorRaw);
 if(preview.snapshotStatus==='same_snapshot')fail('unsupported_policy');
 return {...c,archive,archiveRaw,preview,previewRaw:json(preview)};
}
type Context=Awaited<ReturnType<typeof sourceContext>>;
export function select(c:Context,ref:unknown):DeepReadonly<Candidate>|null{
 if(c.ledger.view.achievements.length===0){if(ref!==null)fail('id_ticket');return null;}
 if(c.ledger.view.achievements.length!==1)fail('unsupported_policy');
 keys(ref,['achievementId','revisionId','observationId']);
 const found=c.preview.rows[0].candidates.find(x=>x.achievementId===ref.achievementId&&x.revisionId===ref.revisionId&&x.observationId===ref.observationId);
 if(!found||!found.isLatest)fail('id_ticket');
 if(found.sameRecord||c.preview.rows[0].conflicts.includes('year_context_differs'))fail('unsupported_policy');return found;
}
export function roles(active:boolean,existing:boolean){return ['operation','snapshot',...(existing?['observation','revision']:['achievement','observation','revision']),...Array.from({length:7},()=>existing?['detail-observation','detail-revision']:['detail','detail-observation','detail-revision']).flat(),...(active?['operation']:[])];}
export function allocationFor(ids:string[],active:boolean,candidate:DeepReadonly<Candidate>|null,r:FrozenRecord){
 const expected=roles(active,!!candidate);if(ids.length!==expected.length)fail('id_ticket');let i=2;
 const row={rowIndex:0,achievementId:candidate?null:ids[i++],observationId:ids[i++],revisionId:ids[i++],details:Array.from({length:7},()=>({detailId:candidate?null:ids[i++],observationId:ids[i++],revisionId:ids[i++]}))};
 const prior=candidate?JSON.parse(r.ledgerRaw).view.snapshots.find((s:{id:string})=>s.id===candidate.sourceRef.snapshotId)?.rows[candidate.sourceRef.rowIndex]:null;
 if(candidate&&!prior)fail('id_ticket');
 return {selection:{targetSnapshotId:ids[1],rows:[{rowIndex:0,action:candidate?'correction' as const:'new' as const,candidate:candidate?{achievementId:candidate.achievementId,revisionId:candidate.revisionId,observationId:candidate.observationId}:null,activate:active}]},allocation:{mode:'explicit-test-only-untrusted' as const,importOperationId:ids[0],rows:[row],activations:active?[{rowIndex:0,operationId:ids[i++]}]:[]},references:{candidate:candidate?{achievementId:candidate.achievementId,revisionId:candidate.revisionId,observationId:candidate.observationId}:null,sourceRef:candidate?parse(json(candidate.sourceRef)) as Candidate['sourceRef']:null,detailIds:prior?prior.details.map((d:{detailId:string})=>d.detailId) as string[]:[]}};
}
export async function grantFor(c:Context,m:ReturnType<typeof allocationFor>&{ids:string[]},env:Environment):Promise<Grant>{return {intentId:m.ids[0],ids:m.ids,selection:m.selection,allocation:m.allocation,references:m.references,archiveSha256:await rawDigest(c.archiveRaw),previewSha256:c.preview.previewSha256,ledgerSha256:await rawDigest(c.ledgerRaw),floorSha256:await rawDigest(c.floorRaw),environment:env};}
export async function confirmationTargets(c:Context,g:DeepReadonly<Grant>){return prepareConfirmation(c.previewRaw,c.archiveRaw,c.ledgerRaw,c.floorRaw,json(g.selection));}
export async function receiptFor(c:Context,g:DeepReadonly<Grant>,d:DeepReadonly<Decision>){
 if(!equal(d.selection,g.selection)||!equal(d.allocation,g.allocation))fail('id_ticket');
 await verifyImportPreview(c.previewRaw,c.archiveRaw,c.ledgerRaw,c.floorRaw);
 const p=await planAdoption(c.previewRaw,c.archiveRaw,c.ledgerRaw,c.floorRaw,json(d));const plan=await verifyAdoptionPlan(json(p),c.previewRaw,c.archiveRaw,c.ledgerRaw,c.floorRaw,json(d));
 const receipt:Receipt={grantId:g.intentId,decision:parse(json(d)) as Decision,archiveSha256:await rawDigest(c.archiveRaw),previewSha256:c.preview.previewSha256,binding:c.preview.binding,beforeLedgerEntries:c.ledger.journal.entries.length,beforeLedgerSha256:await rawDigest(c.ledgerRaw),floorSha256:await rawDigest(c.floorRaw),operations:await Promise.all(plan.operations.map(async o=>({operationId:o.operationId,payloadSha256:await digest(o)}))),afterLedgerSha256:await rawDigest(json(plan.resultLedger))};return {receipt,plan};
}
async function apply(r:RecordV2,e:Event,finalRaw:string){
 keys(e,['policy','sequence','previousSha256','body','eventSha256']);const {eventSha256,...body}=e;
 if(e.policy!==POLICY.host||e.sequence!==r.events.length+1||e.previousSha256!==(r.events.at(-1)?.eventSha256??r.anchorSha256)||eventSha256!==await digest(body))fail('invalid_host');
 if(e.body.kind==='reserve'){
  keys(e.body,['kind','grant']);const g=e.body.grant;keys(g,['intentId','ids','selection','allocation','references','archiveSha256','previewSha256','ledgerSha256','floorSha256','environment']);
  const l=await ledgerContext(r);if(!Array.isArray(g.ids)||!g.selection?.rows||g.selection.rows.length!==1||typeof g.selection.rows[0].activate!=='boolean')fail('id_ticket');
  // Validate references against the historical ledger, independently of later source.
  const ref=g.references?.candidate;let candidate:DeepReadonly<Candidate>|null=null;
  if(l.ledger.view.achievements.length){
   if(!ref||l.ledger.view.achievements.length!==1)fail('id_ticket');
   const rev=l.ledger.view.revisions.find(x=>x.id===ref.revisionId),ach=l.ledger.view.achievements[0];
   const obs=rev&&l.ledger.view.observations.find(x=>x.id===rev.observationId),snapshot=obs&&l.ledger.view.snapshots.find(x=>x.id===obs.snapshotId);
   if(!rev||!obs||!snapshot||ach.id!==ref.achievementId||ach.revisionIds.at(-1)!==rev.id||obs.id!==ref.observationId)fail('id_ticket');
   candidate={...ref,sourceRef:{snapshotId:snapshot.id,rowIndex:obs.rowIndex,archiveSha256:snapshot.archive.archiveSha256,rawSha256:snapshot.archive.rawSha256}} as Candidate;
  }else if(ref!==null)fail('id_ticket');
  const active=g.selection.rows[0].activate,expected=allocationFor(g.ids,active,candidate,r),slots=roles(active,!!candidate),tails=new Set(r.authority.reservedIds.map(x=>x.split(':').at(-1)));
  if(g.ids.length!==slots.length)fail('id_ticket');
  g.ids.forEach((id,i)=>{if(typeof id!=='string')fail('id_ticket');const tail=id.split(':').at(-1)!;if(!uuidPattern.test(tail)||id!==`hosei:g01b-${slots[i]}:${tail}`||tails.has(tail))fail('id_ticket');tails.add(tail);});
  if(!equal(expected.selection,g.selection)||!equal(expected.allocation,g.allocation)||!equal(expected.references,g.references)||g.intentId!==g.ids[0]||!equal(g.environment,r.environment)||g.ledgerSha256!==await rawDigest(r.ledgerRaw)||g.floorSha256!==await rawDigest(l.floorRaw)||![g.archiveSha256,g.previewSha256].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)))fail('id_ticket');
  r.authority.reservedIds.push(...g.ids);if(r.authority.reservedIds.length>LIMITS.ids)fail('resource_limit');
 }else if(e.body.kind==='adopt'){
  keys(e.body,['kind','receipt']);const rec=e.body.receipt;keys(rec,['grantId','decision','archiveSha256','previewSha256','binding','beforeLedgerEntries','beforeLedgerSha256','floorSha256','operations','afterLedgerSha256']);
  const prior=r.events.find(x=>x.body.kind==='reserve'&&x.body.grant.intentId===rec.grantId);
  if(!prior||prior.body.kind!=='reserve'||r.authority.consumedGrantIds.includes(rec.grantId))fail('id_ticket');
  const g=prior.body.grant,final=await verifyLedgerState(finalRaw),before=await ledgerContext(r),op=final.journal.entries[before.ledger.journal.entries.length]?.operation;
  if(!op||op.kind!=='import_snapshot')fail('invalid_host');
  const c=await sourceContext(op.archive.raw,r);select(c,g.references.candidate);
  if(g.archiveSha256!==await rawDigest(c.archiveRaw)||g.previewSha256!==c.preview.previewSha256||g.ledgerSha256!==await rawDigest(r.ledgerRaw))fail('invalid_host');
  const result=await receiptFor(c,g,rec.decision);if(!equal(result.receipt,rec))fail('invalid_host');
  const receiptSha256=await digest(rec);for(const o of rec.operations){if(r.authority.opReceipts.some(x=>x.operationId===o.operationId))fail('receipt_conflict');r.authority.opReceipts.push({operationId:o.operationId,receiptSha256});}
  r.ledgerRaw=json(result.plan.resultLedger);r.receipts.push(rec);r.authority.consumedGrantIds.push(g.intentId);r.outcomes.push({policy:POLICY.host,receiptSha256,operationIds:rec.operations.map(x=>x.operationId),ledgerEntries:result.plan.resultLedger.journal.entries.length,ledgerSha256:rec.afterLedgerSha256,sequence:e.sequence});
 }else fail('shape');
 r.events.push(e);r.authority.generation++;r.authority.tipSha256=eventSha256;
}
export async function decodeHostV2(raw:unknown):Promise<FrozenRecord>{
 const p=parse(raw);keys(p,['format','hostVersion','verifier','environment','hostId','baseProvenance','legacyBaseRaw','migration','anchorSha256','events','ledgerRaw','receipts','outcomes','authority']);
 if(p.format!=='hosei-grade-import-host'||p.hostVersion!==2||p.verifier!==VERIFIER||typeof p.legacyBaseRaw!=='string'||typeof p.ledgerRaw!=='string')fail('shape');
 const r=await genesis(p.legacyBaseRaw,p.baseProvenance as Provenance,p.migration as UpgradeReceipt);
 if(!Array.isArray(p.events)||p.events.length>128)fail('resource_limit');for(const e of p.events)await apply(r,e,p.ledgerRaw);
 if(!equal(r,p))fail('invalid_host');return freeze(r);
}
export async function appendHost(r:FrozenRecord,body:Body,ledgerRaw=r.ledgerRaw){const next=parse(json(r)) as RecordV2;const b={policy:POLICY.host,sequence:r.events.length+1,previousSha256:r.events.at(-1)?.eventSha256??r.anchorSha256,body};await apply(next,{...b,eventSha256:await digest(b)},ledgerRaw);return decodeHostV2(json(next));}
