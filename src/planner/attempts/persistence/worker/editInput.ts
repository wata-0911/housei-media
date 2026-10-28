import {ControllerWorkerError as Fault} from './contracts';
import type {EditIntent} from './editTypes';
export const INTENT_BYTES=1024*1024,EDIT_CONTROL_LIMIT=INTENT_BYTES+32768;
const fail=():never=>{throw new Fault('invalid_input');};
function object(v:unknown):Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return fail();
 const ds=Object.getOwnPropertyDescriptors(v);for(const k of Reflect.ownKeys(ds))if(typeof k!=='string'||!('value'in ds[k])||!ds[k].enumerable)fail();return v as Record<string,unknown>;
}
function shape(v:unknown,required:string[],optional:string[]=[]){const r=object(v);if(required.some(k=>!Object.hasOwn(r,k))||Object.keys(r).some(k=>![...required,...optional].includes(k)))fail();return r;}
function text(v:unknown,max=4096){if(typeof v!=='string'||v.length>max)fail();const s=v as string;for(let i=0;i<s.length;i++){const n=s.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const next=s.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))fail();}else if(n>=0xdc00&&n<=0xdfff)fail();}}
function row(v:unknown,nullable=false){if(nullable&&v===null)return;if(typeof v!=='string'||!/^[a-f0-9]{48}$/.test(v))fail();}
function number(v:unknown){if(v!==null&&(typeof v!=='number'||!Number.isFinite(v)||Object.is(v,-0)))fail();}
function bool(v:unknown){if(typeof v!=='boolean')fail();}
function plan(v:unknown,partial=false){const names=['status','plannedYear','plannedTerm','studyYear','earnedOrder'],r=shape(v,partial?[]:names,partial?[...names,'contribution']:['contribution']);for(const [k,x]of Object.entries(r)){
 if(k==='status')text(x);else if(k==='plannedTerm'){if(x!==null)text(x);}else if(k==='contribution'){const c=shape(x,['value','source','note']);number(c.value);if(c.source!=='learner')fail();if(c.note!==null)text(c.note,8192);}else number(x);
 }}
function assessment(v:unknown,partial=false){const names=['type','label','scheduledDate','completed'],r=shape(v,partial?[]:names,partial?names:[]);for(const [k,x]of Object.entries(r)){if(k==='completed')bool(x);else if(k==='scheduledDate'){if(x!==null)text(x);}else text(x);}}
function fields(v:unknown,patch=false){const r=object(v);if(!['media','correspondence','evaluation','todo'].includes(r.kind as string))fail();
 const names=r.kind==='media'?['totalLessons']:r.kind==='correspondence'?['requiredReports','examGrade']:r.kind==='evaluation'?['finalGrade','reportGrade','schoolingGrade']:['text','done'];
 const extra=r.kind==='media'&&patch?['lesson','assessment','addAssessment']:r.kind==='correspondence'?['calligraphyBatchStatus',...(patch?['report']:[])]:[];
 shape(r,['kind',...(patch?[]:names)],[...(patch?names:[]),...extra]);
 for(const [k,x]of Object.entries(r)){
  if(k==='kind')continue;
  if(['totalLessons','requiredReports'].includes(k))number(x);
  else if(k==='done')bool(x);
  else if(k==='lesson'){const l=shape(x,['lesson','videoCompleted','testCompleted']);number(l.lesson);bool(l.videoCompleted);bool(l.testCompleted);}
  else if(k==='report'){const p=shape(x,['reportNumber','status','grade']);number(p.reportNumber);text(p.status);if(p.grade!==null)text(p.grade);}
  else if(k==='assessment'){const a=shape(x,['row','changes']);row(a.row);assessment(a.changes,true);}
  else if(k==='addAssessment')assessment(x);
  else if(x!==null)text(x);
 }
}
/** Structural admission only. Domain enums/ranges/transition/source rules remain
 * the existing Command validator's responsibility; nothing is coerced/dropped. */
export function validateIntents(v:unknown):asserts v is readonly EditIntent[]{
 if(!Array.isArray(v)||v.length<1||v.length>50)fail();
 const array=v as unknown[],ds=Object.getOwnPropertyDescriptors(array);if(Reflect.ownKeys(ds).length!==array.length+1)fail();for(let i=0;i<array.length;i++){const d=ds[String(i)];if(!d||!('value'in d)||!d.enumerable)fail();}
 for(const value of v as unknown[]){const r=object(value);switch(r.kind){
 case 'add':shape(r,['kind','selection','title','plan','method','note']);row(r.selection,true);text(r.title);plan(r.plan);text(r.method);text(r.note,8192);break;
 case 'edit':{shape(r,['kind','attempt','changes']);row(r.attempt);const c=shape(r.changes,[],['title','plan','method','selection']);if(Object.hasOwn(c,'title'))text(c.title);if(Object.hasOwn(c,'plan'))plan(c.plan,true);if(Object.hasOwn(c,'method')){const m=shape(c.method,['value','note']);text(m.value);text(m.note,8192);}if(Object.hasOwn(c,'selection'))row(c.selection,true);break;}
 case 'remove':shape(r,['kind','attempt']);row(r.attempt);break;
 case 'undo':shape(r,['kind','removal']);row(r.removal);break;
 case 'add_record':shape(r,['kind','owner','fields']);row(r.owner,true);fields(r.fields);if(r.owner===null&&object(r.fields).kind!=='todo')fail();break;
 case 'edit_payload':shape(r,['kind','record','changes']);row(r.record);fields(r.changes,true);break;
 case 'assign_todo':shape(r,['kind','todo','owner','expectedOwner']);row(r.todo);row(r.owner,true);row(r.expectedOwner,true);break;
 case 'delete_todo':shape(r,['kind','todo']);row(r.todo);break;
 default:throw new Fault('unsupported_intent');
 }}
 if(new TextEncoder().encode(JSON.stringify(v)).byteLength>INTENT_BYTES)throw new Fault('resource_limit');
}
