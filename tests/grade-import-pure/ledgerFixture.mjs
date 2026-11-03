import { createHash } from 'node:crypto';
import { createGradeSourceArchive } from '../../src/planner/attempts/gradeImport/sourceArchive.ts';
import { appendOperation } from '../../src/planner/attempts/gradeImport/ledger.ts';
let next=1;
export const mint=r=>`hosei:g01b-${r}:${(next++).toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`;
export const attempt=()=>mint('operation').replace('g01b-operation','attempt');
const num=v=>({raw:v===null?'':String(v),value:v});
export function course(name='旧数学',quantity=4,year='2025') {
 const slot=(y,v)=>({rawYear:y,rawTerm:'',rawDate:'',rawCredits:v===null?'':String(v),rawGrade:'',year:y||null,term:null,date:null,credits:v,grade:null});
 return {rawName:name,categoryRaw:null,compositionCredits:num(4),additionalEnrollment:num(null),recognizedExemption:num(0),earnedCredits:num(quantity),schoolingCredits:num(2),
 reports:[0,1,2,3].map(i=>({raw:`提出${i}`,status:'unknown',date:null})),
 creditExam:{rawDate:'2012-01-01',rawCredits:'2',rawGrade:'A',date:'2012-01-01',credits:2,grade:'A',pendingMarker:false},schoolings:[slot(year,2),slot('',null)]};
}
export const input=(courses=[course()])=>({schemaVersion:1,source:'hosei_web_learning_grade_table',capturedAt:'2026-11-03T00:00:00.000Z',courses});
export const archive=async(courses=[course()],extra={})=>createGradeSourceArchive(JSON.stringify({...input(courses),...extra}));
export function assignment(p) {
 return {observationId:mint('observation'),achievementId:p?.achievementId??mint('achievement'),revisionId:mint('revision'),previousRevisionId:p?.revisionId??null,
 details:Array.from({length:7},(_,i)=>({observationId:mint('detail-observation'),detailId:p?.details[i].detailId??mint('detail'),revisionId:mint('detail-revision'),previousRevisionId:p?.details[i].revisionId??null}))};
}
export const importOp=(s,a,rows=a.dto.courses.map(()=>assignment()))=>({kind:'import_snapshot',operationId:mint('operation'),expectedTipSha256:s.tipSha256,snapshotId:mint('snapshot'),archive:a,rows});
export const activateOp=(s,r)=>({kind:'activate_revision',operationId:mint('operation'),expectedTipSha256:s.tipSha256,achievementId:r.achievementId,revisionId:r.revisionId,
 expectedActiveRevisionId:s.view.achievements.find(a=>a.id===r.achievementId)?.activeRevisionId??null,confirmation:{kind:'explicit-selection',reason:'確認した公式成績の訂正'}});
export const associateOp=(s,r,attemptId=attempt())=>({kind:'associate_unverified',operationId:mint('operation'),expectedTipSha256:s.tipSha256,associationId:mint('association'),achievementId:r.achievementId,revisionId:r.revisionId,attemptId});
export const append=(s,o,f)=>appendOperation(JSON.stringify(s),JSON.stringify(o),f&&JSON.stringify(f));
export const floor=s=>({issuedIds:s.issuedIds,reservedIds:s.reservedIds});
export const clone=structuredClone;
export const canonical=v=>JSON.stringify(v,(_k,x)=>x&&!Array.isArray(x)&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
export function rehash(j) {let prev=null;for(const e of j.entries){e.operation.expectedTipSha256=prev;e.previousSha256=prev;e.payloadSha256=digest(e.operation);e.eventSha256=digest({operation:e.operation,previousSha256:prev,payloadSha256:e.payloadSha256});prev=e.eventSha256;}return j;}
// Complete expected fixture view. Uses only source fixture values and Node crypto;
// never production apply/replay/hash/ID helpers.
export function oracle(ops,seed=[]) {
 const view={snapshots:[],observations:[],achievements:[],revisions:[],detailObservations:[],details:[],detailRevisions:[],associations:[]};
 const issued=[],entries=[];let tip=null;
 for(const op of ops){
  const b={operation:clone(op),previousSha256:tip,payloadSha256:digest(op)};tip=digest(b);entries.push({...b,eventSha256:tip});issued.push(op.operationId);
  if(op.kind==='activate_revision'){view.achievements.find(a=>a.id===op.achievementId).activeRevisionId=op.revisionId;continue;}
  if(view.snapshots.some(s=>s.id===op.snapshotId))continue;
  issued.push(op.snapshotId);view.snapshots.push({id:op.snapshotId,archive:clone(op.archive),rows:clone(op.rows)});
  op.rows.forEach((r,i)=>{
   let a=view.achievements.find(a=>a.id===r.achievementId);
   if(!a){a={id:r.achievementId,revisionIds:[],activeRevisionId:null};view.achievements.push(a);issued.push(a.id);}
   issued.push(r.observationId,r.revisionId);a.revisionIds.push(r.revisionId);
   const rec=clone(op.archive.dto.courses[i]);
   view.observations.push({id:r.observationId,snapshotId:op.snapshotId,rowIndex:i,detailObservationIds:r.details.map(d=>d.observationId)});
   view.revisions.push({id:r.revisionId,achievementId:r.achievementId,observationId:r.observationId,previousRevisionId:r.previousRevisionId,record:rec});
   const loc=[['report',0],['report',1],['report',2],['report',3],['credit_exam',0],['schooling',0],['schooling',1]];
   r.details.forEach((d,j)=>{
    const [kind,index]=loc[j];let det=view.details.find(x=>x.id===d.detailId);
    if(!det){det={id:d.detailId,achievementId:r.achievementId,kind,index,revisionIds:[]};view.details.push(det);issued.push(det.id);}
    issued.push(d.observationId,d.revisionId);det.revisionIds.push(d.revisionId);
    view.detailObservations.push({id:d.observationId,rowObservationId:r.observationId,kind,index});
    view.detailRevisions.push({id:d.revisionId,detailId:d.detailId,observationId:d.observationId,previousRevisionId:d.previousRevisionId,record:kind==='report'?rec.reports[index]:kind==='credit_exam'?rec.creditExam:rec.schoolings[index]});
   });
  });
 }
 return {format:'hosei-g01b-ledger-prototype',contractVersion:'0.1.0-prototype',journal:{format:'hosei-g01b-journal-prototype',contractVersion:'0.1.0-prototype',seedReservedIds:seed,entries},view,issuedIds:issued,reservedIds:[...seed,...issued],tipSha256:tip};
}
