import type {PersistenceHandle} from '../controller';
import type {Attempt,AttemptOwnedRecord,AttemptRemoval,AttemptOperationId,OwnedRecordId,AttemptId} from '../../types';
import {makeAttempt,selectedReferences} from '../../workbench/catalogView';
import {makeSearchAttempt} from '../../workbench/searchBridge';
import type {Command} from '../../workbench/operations';
import type {InstitutionalSearchRow} from '../../../institutional/search';
import {sourceUuids,referencedUuids,idTail,checkFreshCommandIds} from '../identity';
import type {AuthorityRecord} from '../contracts';
import {ControllerWorkerError as Fault} from './contracts';
import type {EditIntent,RowToken} from './editTypes';
import type {Registry} from './registry';
export type EditRow={purpose:'attempt'|'record'|'removal'|'selection'|'assessment'|'owner';value:unknown;recordId?:string};
/** Private lifetime restriction, never an issuance credential. Every minted UUID
 * is burned immediately, including build/dispatch/encode/cancel failures. */
export class EditIds {
 private burned=new Set<string>();
 restrict(ids:readonly string[]){ids.forEach(id=>this.burned.add(idTail(id)));}
 reservations(){return [...this.burned];}
 prepare(handle:PersistenceHandle,expected:AuthorityRecord){return new Set([...this.burned,...sourceUuids(handle.source),...referencedUuids([handle.state,handle.workspace,expected.issuedIds])]);}
 mint(occupied:Set<string>,prefix=''){
  for(let n=0;n<128;n++){const uuid=crypto.randomUUID();if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(uuid))throw new Fault('internal');if(occupied.has(uuid)||this.burned.has(uuid))continue;this.burned.add(uuid);occupied.add(uuid);return prefix+uuid;}
  throw new Fault('resource_limit');
 }
}
export function buildEdits(handle:PersistenceHandle,expected:AuthorityRecord,intents:readonly EditIntent[],registry:Registry,ids:EditIds):readonly Command[]{
 const occupied=ids.prepare(handle,expected),before=new Set(occupied),commands:Command[]=[];
 const attempts=new Map(handle.workspace.graph.attempts.map(a=>[a.id,a])),records=new Map(handle.workspace.graph.ownedRecords.map(r=>[r.id,r]));
 function target<T>(token:RowToken,purpose:EditRow['purpose']):T{const r=registry.get<EditRow>(token,'row','prepareEdits');if(r.purpose!==purpose)throw new Fault('stale_view');return r.value as T;}
 const attempt=(token:RowToken)=>{const a=target<Attempt>(token,'attempt'),current=attempts.get(a.id);if(!current)throw new Fault('stale_view');return current;};
 const record=(token:RowToken)=>{const r=target<AttemptOwnedRecord>(token,'record'),current=records.get(r.id);if(!current)throw new Fault('stale_view');return current;};
 const owner=(token:RowToken|null):AttemptOwnedRecord['owner']=>{if(token===null)return null;const ref=registry.get<EditRow>(token,'row','prepareEdits');if(ref.purpose==='attempt')return {kind:'attempt',attemptId:attempt(token).id};if(ref.purpose==='owner'&&handle.workspace.graph.ownedRecords.some(r=>r.owner===ref.value))return ref.value as AttemptOwnedRecord['owner'];throw new Fault('stale_view');};
 for(const intent of intents){
  const operationId=ids.mint(occupied,'hosei:attempt-op:') as AttemptOperationId;let command:Command;
  switch(intent.kind){
   case 'add':{
    const input={title:intent.title,courseId:null,placementId:null,plan:intent.plan,method:intent.method,note:intent.note};
    const identity={id:ids.mint(occupied,'hosei:attempt:') as AttemptId,creationOperationId:operationId};
    const a=intent.selection===null?makeAttempt(handle.source.context.catalog,input,identity):makeSearchAttempt(handle.source.context.catalog,target<InstitutionalSearchRow>(intent.selection,'selection'),input,identity);
    command={kind:'add',operationId,attempt:a};break;
   }
   case 'edit':{
    const a=attempt(intent.attempt),c=intent.changes,changes:Extract<Command,{kind:'edit'}>['changes']={};
    if(Object.hasOwn(c,'title'))changes.originalTitle=c.title;
    if(c.plan){if(!a.plan)throw new Fault('unsupported_intent');changes.plan={...a.plan,...c.plan};}
    if(c.method)changes.method={value:c.method.value,source:'learner',evidence:{kind:'learner',note:c.method.note}};
    if(Object.hasOwn(c,'selection')){
     if(c.selection===null)Object.assign(changes,selectedReferences(handle.source.context.catalog,null,null));
     else {const choice=target<InstitutionalSearchRow>(c.selection!,'selection');
      // Revalidate the exact pinned search row. Only mutable identity/placement
      // fields cross into this Command; original legacy provenance stays intact.
      if(!a.plan)throw new Fault('unsupported_intent');const {importedSourceCourseId,...learnerPlan}=a.plan;void importedSourceCourseId;
      const rebuilt=makeSearchAttempt(handle.source.context.catalog,choice,{plan:learnerPlan,method:a.method.value,note:''},{id:a.id,creationOperationId:a.creationOperationId});
      changes.identity=rebuilt.identity;changes.placement=rebuilt.placement;
     }
    }
    command={kind:'edit',operationId,attemptId:a.id,changes};attempts.set(a.id,{...a,...changes});break;
   }
   case 'remove':command={kind:'remove',operationId,attemptId:attempt(intent.attempt).id};break;
   case 'undo':{const r=target<AttemptRemoval>(intent.removal,'removal');command={kind:'undo',operationId,attemptId:r.attemptSnapshot.id,removalOperationId:r.operationId};break;}
   case 'add_record':{
    const f=intent.fields,base={id:ids.mint(occupied,'hosei:owned:') as OwnedRecordId,owner:owner(intent.owner)};let r:AttemptOwnedRecord;
    if(f.kind==='todo')r={...base,kind:'todo',payload:{id:ids.mint(occupied),text:f.text,done:f.done}};
    else {if(base.owner===null)throw new Fault('invalid_input');const b={...base,owner:base.owner};
     if(f.kind==='media')r={...b,kind:'media',payload:{totalLessons:f.totalLessons,lessons:[],assessments:[]}};
     else if(f.kind==='correspondence'){const {kind,...payload}=f;void kind;r={...b,kind:'correspondence',payload:{...payload,reports:[]}};}
     else r={...b,kind:'evaluation',payload:{finalGrade:f.finalGrade,reportGrade:f.reportGrade,schoolingGrade:f.schoolingGrade}};
    }
    command={kind:'add_record',operationId,record:r};break;
   }
   case 'edit_payload':{
    const r=record(intent.record),c=intent.changes;if(r.kind!==c.kind)throw new Fault('invalid_input');
    const next=structuredClone(r);
    if(next.kind==='media'&&c.kind==='media'){
     if(Object.hasOwn(c,'totalLessons'))next.payload.totalLessons=c.totalLessons!;
     if(c.lesson){const i=next.payload.lessons.findIndex(l=>l.lesson===c.lesson!.lesson);if(i<0)next.payload.lessons.push(c.lesson);else next.payload.lessons[i]=c.lesson;}
     if(c.assessment){const ref=registry.get<EditRow>(c.assessment.row,'row','prepareEdits');if(ref.purpose!=='assessment'||ref.recordId!==r.id)throw new Fault('stale_view');const id=(ref.value as {id:string}).id,entry=next.payload.assessments.find(a=>a.id===id);if(!entry)throw new Fault('stale_view');Object.assign(entry,c.assessment.changes);}
     if(c.addAssessment)next.payload.assessments.push({id:ids.mint(occupied),...c.addAssessment});
    }else if(next.kind==='correspondence'&&c.kind==='correspondence'){
     const {kind,report,...patch}=c;void kind;Object.assign(next.payload,patch);
     if(report){const i=next.payload.reports.findIndex(p=>p.reportNumber===report.reportNumber);if(i<0)next.payload.reports.push(report);else next.payload.reports[i]=report;}
    }else {const {kind,...patch}=c;void kind;Object.assign(next.payload,patch);}
    command={kind:'edit_payload',operationId,recordId:r.id,payload:next.payload};records.set(r.id,next);break;
   }
   case 'assign_todo':command={kind:'assign_todo',operationId,recordId:record(intent.todo).id,owner:owner(intent.owner),expectedOwner:owner(intent.expectedOwner)};break;
   case 'delete_todo':command={kind:'delete_todo',operationId,recordId:record(intent.todo).id};break;
   default:throw new Fault('unsupported_intent');
  }
  // Also check every fresh Command ID against prior failed/cancelled batches;
  // the controller independently checks source/history/authority reservations.
  const fresh=checkFreshCommandIds(command,before);fresh.forEach(id=>before.add(idTail(id)));commands.push(command);
 }
 return commands;
}
