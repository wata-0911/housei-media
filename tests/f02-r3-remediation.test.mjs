import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,programs,initialState,newAttempt,officialRow,calculateState,legacyCases} from './fixtures/yi07-graduation.mjs';
import {env,decode} from './fixtures/migration-fixture.mjs';
import {validateState} from '../src/planner/validation.ts';
import {loadState,STORAGE_KEY} from '../src/planner/backup/storage.ts';
import {setThesisProgressForScope} from '../src/planner/graduation/thesisSelection.ts';
import {createNewPlanSource} from '../src/planner/attempts/persistence/newPlan.ts';
import {calculateRecordedCredits} from '../src/planner/attempts/graduation/recordedCalculation.ts';
import {createAttemptPersistence} from '../src/planner/attempts/persistence/controller.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {newAttemptIds} from '../src/planner/attempts/workbench/operations.ts';
import {assertLawDenseRequirements} from './fixtures/f02-law-requirements.mjs';
const law=programs.find(p=>p.department==='法律学科').scopeId;
const item=(offeringId,n)=>({offeringId,status:'earned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null,...(n===undefined?{}:{courseCreditContribution:n})});
function state(items=[]){let s=initialState();s.selectedScopeId=law;s.items=items;Object.assign(s.graduationProfile,{admissionYear:2026,admissionType:'first_year',curriculumApplicability:'current_2026'});return setThesisProgressForScope(s,catalog,law,{selection:'not_selected'});}
function saved(s){assert.ok(validateState(s,catalog));const r=loadState({getItem:k=>k===STORAGE_KEY?JSON.stringify(s):null},catalog);assert.equal(r.error,null);return r.state;}
async function migrate(s){s=saved(s);let record=emptyAuthority();const store={read:async()=>structuredClone(record),commit:async(e,n)=>{assert.deepEqual(e,record);record=structuredClone(n);}},locks={request:async(_n,_o,f)=>f()};let api=createAttemptPersistence(store,locks,env);const p=await api.prepareMigration(await api.inspectLegacy(JSON.stringify(s)));await api.commit(p,true,p.previousRaw,p.sourceRaw);api=createAttemptPersistence(store,locks,env);const loaded=await api.load();assert.equal(loaded.state.schemaVersion,23);assert.deepEqual(loaded.source.state,s);assert.equal(loaded.source.raw,JSON.stringify(s));return {loaded,api,record:()=>structuredClone(record)};}
const d=await decode(state());assert.equal(d.status,'decoded');const sources=[['23',d.source],['24',await createNewPlanSource()]];
const place=(s,name,scope)=>{const p=s.context.catalog.placements.find(p=>p.identityDecision.status==='safe'&&(p.officialName===name||p.auditRecord.canonicalName===name)&&(!scope||p.scopeId===scope));assert.ok(p,name);return p;};
const make=(s,name,n,method='schooling',scope)=>newAttempt(s.context.catalog,place(s,name,scope),n,'earned',method);
const card=(p,id)=>{const c=p.cards.find(c=>c.requirementId===id);assert.ok(c,id);return c;};
async function calc(s,attempts,scope=law){const g={attempts,ownedRecords:[],removals:[]},raw=JSON.stringify(g),old=JSON.stringify(s),r=await calculateRecordedCredits(raw,s,scope);assert.equal(r.status,'calculated');assert.equal(JSON.stringify(g),raw);assert.equal(JSON.stringify(s),old);assert.deepEqual(r.informational.map(a=>[a.attemptId,a.method,a.contribution]),attempts.map(a=>[a.id,a.method.value,a.plan.contribution?.value]));return r;}
function lawAmounts(p,n){assert.equal(card(p,'professional-law-total').earned,n);assert.equal(card(p,'professional-law-elective').earned,n);const ids=['5e64c026-b4b7-4546-a1fc-5e9340e3b976','ef19cce0-2441-42dc-aedd-9c8e91c2bd9e'];for(const id of ids){const rows=p.requirements.filter(r=>r.requirementId===id);assert.equal(rows.length,1);assert.equal(rows[0].earned,n);}}
for(const [kind,s]of sources)for(const method of ['schooling','media','unknown'])for(const n of [2,null])for(const base of [true,false])test(`F02-R3 A ${kind} ${method}${n} Tbase${base}`,async()=>{
 const bad=make(s,'英語2',n,method),a=[...(base?[make(s,'英語2',2,'correspondence')]:[]),make(s,'英語3',2,'correspondence'),bad];
 for(const rows of [a,[...a].reverse()]){const r=await calc(s,rows);assert.equal(card(r.progress,'group-foreign').earned,base?4:2);assert.notEqual(card(r.progress,'group-foreign').status,'satisfied');assert.equal(r.courses.reduce((n,c)=>n+(c.schoolingCredits??0),0),0);assert.deepEqual(r.holds.map(h=>h.attemptId),[bad.id]);}
});
for(const [kind,s]of sources)test(`F02-R3 A ${kind} real foreign S1x2 supplies the missing evidence`,async()=>{
 const a=[make(s,'英語2',2,'correspondence'),make(s,'英語3',2,'correspondence')];for(let i=0;i<=2;i++){const r=await calc(s,a);assert.equal(card(r.progress,'group-foreign').earned,4);assert.equal(card(r.progress,'group-foreign').status,i===2?'satisfied':'unsatisfied');if(i<2)a.push(make(s,'英語S',1));}
});
for(const [kind,s]of sources)for(const count of [2,3,5])for(const t4 of [true,false])test(`F02-R3 B ${kind} ${count} S2 withT4${t4} preserve S lower bound`,async()=>{
 const a=[...(t4?[make(s,'行政法',4,'correspondence')]:[]),...Array.from({length:count},()=>make(s,'行政法',2))];for(const rows of [a,[...a].reverse()]){const r=await calc(s,rows),c=r.courses[0];assert.deepEqual([c.recordedEarned,c.completedCredits,c.increment,c.schoolingCredits],[(t4?4:0)+count*2,t4?4:0, t4?4:0,2]);assert.equal(card(r.progress,'professional-law-schooling').earned,2);assert.deepEqual(new Set(r.holds.map(h=>h.attemptId)),new Set(a.filter(x=>x.method.value==='schooling').map(x=>x.id)));}
});
for(const [kind,s]of sources)test(`F02-R3 B ${kind} four S awards stay8 through add delete Undo`,async()=>{
 const names=['行政法','刑事訴訟法','債権総論','刑法各論'],base=names.flatMap(n=>[make(s,n,4,'correspondence'),make(s,n,2)]),extra=make(s,names[0],2);
 for(const a of [base,[...base,extra],base,[...base,extra]]){const r=await calc(s,a);assert.equal(card(r.progress,'professional-law-total').earned,16);assert.equal(card(r.progress,'professional-law-schooling').earned,8);assert.equal(card(r.progress,'professional-law-schooling').status,'satisfied');assert.ok(r.courses.every(c=>c.schoolingCredits===2&&c.completedCredits===4&&c.increment===4));}
});
const summer='e0c4749c-d0ac-40af-8bd0-2952f7da9a88',summerTeacher='81911901-205b-49ff-8efc-a0440bf15309',winter='f0ec8fff-cf06-4a95-a0b4-266670a07b8f',winterTeacher='4bf76def-db1f-46c8-a3bc-df3f8cac1164',media='5c3198fc-10c5-4806-bb2f-bd477670fbf3';
for(const [ids,n]of [[[summer,summerTeacher],2],[[winter,winterTeacher],2],[[summer,winter],4],[[media,summer],4],[[summerTeacher,winterTeacher],4]])for(const reverse of [false,true])test(`F02-R3 C 22 and formal23 session ${ids} reverse${reverse}`,async()=>{
 const rows=(reverse?[...ids].reverse():ids).map(id=>item(id,2)),s=saved(state(rows)),raw=JSON.stringify(s),old=calculateState(s,law);lawAmounts(old,n);assert.equal(card(old,'professional-law-schooling').earned,n);const repeat=card(old,'professional-law-elective').repeatableCourses.find(d=>d.label==='政治学');assert.equal(repeat.courses,n/2);assert.equal(JSON.stringify(s),raw);
 const m=await migrate(s),before=m.record(),r=await calc(m.loaded.source,m.loaded.workspace.graph.attempts);lawAmounts(r.progress,n);assert.equal(r.courses[0].schoolingCredits,n);assert.equal(r.holds.length,2-n/2);assert.deepEqual(m.record(),before);
});
test('F02-R3 C same-slot politics cannot complete law S8 in22 or23',async()=>{
 const other=['行政法','民事訴訟法'].map(name=>catalog.offerings.find(o=>o.method==='schooling'&&o.deliveryCategory!=='media'&&catalog.curriculum.courses.some(c=>c.id===o.curriculumCourseId&&c.canonicalName===name)));assert.ok(other.every(Boolean));const s=state([item(summer,2),item(summerTeacher,2),...other.map(o=>item(o.id,2))]);const old=calculateState(saved(s),law),m=await migrate(s),r=await calc(m.loaded.source,m.loaded.workspace.graph.attempts);for(const p of [old,r.progress]){assert.equal(card(p,'professional-law-schooling').earned,6);assert.notEqual(card(p,'professional-law-schooling').status,'satisfied');}
});
const frenchId=catalog.curriculum.courses.find(c=>c.canonicalName==='仏語S').id,french=catalog.offerings.filter(o=>o.curriculumCourseId===frenchId&&o.method==='schooling'&&o.credits===1);
for(const claims of [1,2,4])test(`F02-R3 D one real omitted legacy S1 row ${claims} calculation claims`,async()=>{
 const m=await migrate(state([item(french[0].id)])),a=m.loaded.workspace.graph.attempts[0],all=[a,...Array.from({length:claims-1},()=>({...structuredClone(a),...newAttemptIds()}))],before=m.record();
 for(const rows of [all,[...all].reverse()]){const r=await calc(m.loaded.source,rows);assert.equal(r.courses[0].increment,1);assert.equal(r.courses[0].completedCredits,1);assert.equal(r.courses[0].schoolingCredits,1);assert.equal(card(r.progress,'group-foreign').earned,1);assert.notEqual(card(r.progress,'group-foreign').status,'satisfied');assert.equal(r.holds.length,claims-1);assert.equal(new Set(r.holds.map(h=>h.attemptId)).size,claims-1);assert.ok(r.holds.every(h=>rows.slice(1).some(a=>a.id===h.attemptId)));assert.ok(r.informational.every(a=>a.contribution===undefined));}
 assert.deepEqual(m.record(),before);if(claims>1){await assert.rejects(()=>m.api.prepareEdits(m.loaded,[{kind:'add',operationId:all[1].creationOperationId,attempt:all[1]}]),/new_attempt_learner_only/);assert.deepEqual(m.record(),before);assert.equal((await m.api.load()).workspace.graph.attempts.length,1);}
});
test('F02-R3 D four distinct old S1 source rows still yield4',async()=>{assert.ok(french.length>=4);const m=await migrate(state(french.slice(0,4).map(o=>item(o.id)))),r=await calc(m.loaded.source,m.loaded.workspace.graph.attempts);assert.equal(card(r.progress,'group-foreign').earned,4);assert.equal(card(r.progress,'group-foreign').status,'satisfied');assert.equal(r.holds.length,0);assert.ok(r.informational.every(a=>a.contribution===undefined));});
const dense=legacyCases().filter(c=>c.scopeId===law&&c.name.includes('/dense-'));
const mixed=dense.find(c=>c.name.endsWith('/dense-mixed'));const isolated=structuredClone(mixed);isolated.name='law/dense-mixed-no-politics';for(const i of isolated.state.items)if(catalog.offerings.find(o=>o.id===i.offeringId)?.curriculumCourseId==='curriculum:f49de1e6-82ae-4b86-8c0a-453ef41995ce')i.status='planned';dense.push(isolated);
const expected={'dense-earned':[128,96],'dense-in_progress':[2,2],'dense-planned':[2,2],'dense-mixed':[42,30],'dense-mixed-no-politics':[40,28]};
const ids=['5755e04d-5c56-4a34-a2b4-afca335676e2','8e08d5c3-a3ab-47e9-81c8-c9a3f8426a67'];
for(const c of dense){const mode=c.name.split('/').at(-1),[total,elective]=expected[mode];test(`F02-R3 E actual ${mode} fixed baseline`,()=>assertLawDenseRequirements(calculateState(c.state,c.scopeId),total,elective,mode));
 const mutants={empty:rs=>rs.filter(r=>!ids.includes(r.requirementId)),missing:rs=>rs.filter(r=>r.requirementId!==ids[0]),duplicate:rs=>[...rs,rs.find(r=>r.requirementId===ids[0])],label:rs=>rs.map(r=>r.requirementId===ids[0]?{...r,label:'専門教育：選択'}:r),swapped:rs=>rs.map(r=>ids.includes(r.requirementId)?{...r,label:r.requirementId===ids[0]?'専門教育：選択':'専門教育'}:r),status:rs=>rs.map(r=>ids.includes(r.requirementId)?{...r,status:r.status==='satisfied'?'unsatisfied':'satisfied',reason:null,unknownReasonCategory:null}:r),reason:rs=>rs.map(r=>ids.includes(r.requirementId)?{...r,reason:'別の理由'}:r),classification:rs=>rs.map(r=>ids.includes(r.requirementId)?{...r,unknownReasonCategory:'identity_unresolved'}:r),quantity999:rs=>rs.map(r=>ids.includes(r.requirementId)?{...r,earned:999}:r)};
 for(const [name,mutate]of Object.entries(mutants))test(`F02-R3 E actual ${mode} rejects ${name}`,()=>{const actual=calculateState(c.state,c.scopeId),changed=structuredClone(actual);changed.requirements=mutate(changed.requirements);assert.throws(()=>assertLawDenseRequirements(changed,total,elective,mode));});
}
// Official aggregate S and recognition are separate from native method labels and annual openings.
test('F02-R3 A other-year official foreign S remains authoritative',async()=>{const s=state();s.importedCourseAchievements=['英語2','英語3'].map(name=>({...officialRow(catalog.curriculum.courses.find(c=>c.canonicalName===name),2),academicYear:2023,schoolingCreditsTotal:name==='英語2'?2:0}));const m=await migrate(s),r=await calc(m.loaded.source,[]);assert.equal(card(r.progress,'group-foreign').earned,4);assert.equal(card(r.progress,'group-foreign').status,'satisfied');});
