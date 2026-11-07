import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,programs,initialState,calculateState,calculateCompletion,newAttempt,officialRow} from './fixtures/yi07-graduation.mjs';
import {env,decode} from './fixtures/migration-fixture.mjs';
import {validateState} from '../src/planner/validation.ts';
import {loadState,STORAGE_KEY} from '../src/planner/backup/storage.ts';
import {setThesisProgressForScope} from '../src/planner/graduation/thesisSelection.ts';
import {createNewPlanSource} from '../src/planner/attempts/persistence/newPlan.ts';
import {createAttemptPersistence} from '../src/planner/attempts/persistence/controller.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {calculateRecordedCredits} from '../src/planner/attempts/graduation/recordedCalculation.ts';
const law=programs.find(p=>p.department==='法律学科').scopeId;
const full=['行政法','刑事訴訟法','債権総論','刑法各論','国際法各論','物権法','国際法総論','刑法総論'];
const item=(id,n,status='earned')=>({offeringId:typeof id==='string'?id:id.id,status,plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null,...(n===undefined?{}:{courseCreditContribution:n})});
const offering=(name,method)=>catalog.offerings.find(o=>o.method===method&&catalog.curriculum.courses.some(c=>c.id===o.curriculumCourseId&&c.canonicalName===name));
function state(items=[],selection='not_selected'){let s=initialState();Object.assign(s.graduationProfile,{admissionYear:2026,admissionType:'first_year',curriculumApplicability:'current_2026'});s.items=items;s.selectedScopeId=law;return setThesisProgressForScope(s,catalog,law,{selection});}
function saved22(s){assert.equal(validateState(s,catalog),true);const r=loadState({getItem:k=>k===STORAGE_KEY?JSON.stringify(s):null},catalog);assert.equal(r.error,null);return r.state;}
const d=await decode(state());assert.equal(d.status,'decoded');const sources=[['23',d.source],['24',await createNewPlanSource()]];
const place=(s,name,scope)=>{const p=s.context.catalog.placements.find(p=>(p.officialName===name||p.auditRecord.canonicalName===name)&&(!scope||p.scopeId===scope)&&p.identityDecision.status==='safe');assert.ok(p,name);return p;};
const make=(s,name,n,method='schooling',status='earned')=>newAttempt(s.context.catalog,place(s,name),n,status,method);
const card=(r,id)=>{const c=r.cards.find(c=>c.requirementId===id);assert.ok(c,id);return c;};
async function calc(s,attempts,scope=law){const g={attempts,ownedRecords:[],removals:[]},raw=JSON.stringify(g),sourceRaw=JSON.stringify(s);const r=await calculateRecordedCredits(raw,s,scope);assert.equal(r.status,'calculated');assert.equal(JSON.stringify(g),raw);assert.equal(JSON.stringify(s),sourceRaw);assert.equal(r.informational.length,attempts.length);assert.deepEqual(r.informational.map(a=>a.contribution),attempts.map(a=>a.plan.contribution?.value));assert.deepEqual(r.informational.map(a=>a.method),attempts.map(a=>a.method.value));return r;}
function lawAmounts(r,total,elective,selection='not_selected'){
 const ids=selection==='selected'?['5755e04d-5c56-4a34-a2b4-afca335676e2','8e08d5c3-a3ab-47e9-81c8-c9a3f8426a67']:['5e64c026-b4b7-4546-a1fc-5e9340e3b976','ef19cce0-2441-42dc-aedd-9c8e91c2bd9e'];
 const rows=r.requirements.filter(r=>r.ruleType==='min_credits'&&['専門教育','専門教育：選択'].includes(r.label));assert.deepEqual(rows.map(r=>r.requirementId).sort(),ids.sort());assert.equal(rows.length,2);
 for(const row of rows)assert.equal(row.earned,row.label==='専門教育'?total:elective);
 assert.equal(card(r,'professional-law-total').earned,total);assert.equal(card(r,'professional-law-elective').earned,elective);
}
const permutations=a=>a.length?a.flatMap((x,i)=>permutations(a.filter((_,j)=>j!==i)).map(rest=>[x,...rest])):[[]];
for(const [kind,s] of sources)for(const order of permutations([0,1,2]))test(`F02-R2 unknown foreign ${kind} order${order}`,async()=>{
 const all=[make(s,'英語2',2,'correspondence'),make(s,'英語3',2,'correspondence'),make(s,'英語2',2,'unknown')],r=await calc(s,order.map(i=>all[i]));
 assert.equal(r.courses.length,2);assert.equal(r.courses.reduce((n,c)=>n+c.increment,0),4);assert.equal(r.courses.reduce((n,c)=>n+c.schoolingCredits,0),0);assert.equal(r.courses.find(c=>c.id===place(s,'英語2').institutionalCourseId).recordedEarned,4);assert.equal(card(r.progress,'group-foreign').earned,4);assert.notEqual(card(r.progress,'group-foreign').status,'satisfied');assert.deepEqual(r.holds.map(h=>h.attemptId),[all[2].id]);
});
for(const [kind,s] of sources)test(`F02-R2 unknown professional S8 ${kind}`,async()=>{
 const a=full.slice(0,4).flatMap(n=>[make(s,n,4,'correspondence'),make(s,n,2,'unknown')]),r=await calc(s,a);assert.equal(r.courses.length,4);assert.equal(r.courses.reduce((n,c)=>n+c.increment,0),16);assert.equal(r.courses.reduce((n,c)=>n+c.schoolingCredits,0),0);assert.equal(r.holds.length,4);assert.equal(card(r.progress,'professional-law-schooling').earned,0);
});
for(const [kind,s] of sources)for(const order of permutations([0,1,2]))test(`F02-R2 known S survives unknown ${kind} order${order}`,async()=>{
 const all=[make(s,'行政法',4,'correspondence'),make(s,'行政法',2),make(s,'行政法',2,'unknown')],r=await calc(s,order.map(i=>all[i]));assert.equal(r.courses.length,1);assert.deepEqual([r.courses[0].recordedEarned,r.courses[0].completedCredits,r.courses[0].increment,r.courses[0].schoolingCredits],[8,4,4,2]);assert.equal(r.holds.length,2);
});
for(const [kind,s] of sources)for(const [parts,expected,sCount]of [[[['schooling',2]],2,2],[[['schooling',2],['correspondence',0]],2,2],[[['schooling',2],['schooling',0]],2,2],[[['schooling',1],['schooling',1]],0,0],[[['schooling',.5],['schooling',1.5]],0,0],[[['correspondence',2]],0,0],[[['schooling',2],['schooling',2]],2,2]])for(const gate of [7,8])test(`F02-R2 law S2 extras ${kind} gate${gate} ${JSON.stringify(parts)}`,async()=>{
 const attempts=full.slice(0,gate).map(n=>make(s,n,4,'correspondence'));attempts.push(...parts.map(([m,n])=>make(s,'保険法・海商法',n,m)));const r=await calc(s,attempts),partial=r.courses.find(c=>c.id===place(s,'保険法・海商法').institutionalCourseId);assert.equal(r.courses.length,gate+1);assert.equal(partial.completedCredits,0);assert.equal(partial.increment,gate===8?expected:0);assert.equal(partial.schoolingCredits,sCount);assert.equal(r.holds.length,parts.length);assert.deepEqual(new Set(r.holds.map(h=>h.attemptId)),new Set(attempts.slice(gate).map(a=>a.id)));if(kind==='23')lawAmounts(r.progress,gate*4+(gate===8?expected:0),gate===8?expected:0);else assert.equal(card(r.progress,'professional-law-total').earned,gate*4+(gate===8?expected:0));
});
for(const selection of ['selected','not_selected'])for(const extra of [null,'b6a158b9-465e-48fd-91b3-3c281cf17ea4','54d68d8f-0fa1-4ebf-b701-0e671443d4fb'])test(`F02-R2 legacy law S2 plus zero ${selection} ${extra}`,()=>{
 const s=saved22(state([...full.map(n=>item(offering(n,'correspondence'),4)),item('3c96e34f-9433-446f-a909-5389ca6fce08',2),...(extra?[item(extra,0)]:[])],selection)),raw=JSON.stringify(s);lawAmounts(calculateState(s,law),34,2,selection);assert.equal(JSON.stringify(s),raw);
});
async function migrated(s){s=saved22(s);let authority=emptyAuthority();const store={read:async()=>structuredClone(authority),commit:async(e,n)=>{assert.deepEqual(e,authority);authority=structuredClone(n);}};const locks={request:async(_n,_o,f)=>f()};let api=createAttemptPersistence(store,locks,env);const session=await api.inspectLegacy(JSON.stringify(s)),p=await api.prepareMigration(session);await api.commit(p,true,p.previousRaw,p.sourceRaw);api=createAttemptPersistence(store,locks,env);const loaded=await api.load();assert.equal(loaded.state.schemaVersion,23);assert.deepEqual(loaded.source.state,s);const before=structuredClone(authority);const r=await calc(loaded.source,loaded.workspace.graph.attempts);assert.deepEqual(authority,before);return {r,loaded,authority};}
for(const omitted of [true,false])for(const zero of [false,true])test(`F02-R2 formal migration T4 omitted${omitted} zero${zero}`,async()=>{
 const s=state([item('35fb5bad-ec27-4c60-a16e-2271168170bb',omitted?undefined:4),...(zero?[item('a2caa2ab-135f-4ad8-8998-75e8fd88ca59',0)]:[])]),{r,loaded}=await migrated(s);assert.equal(r.courses.length,1);assert.equal(r.courses[0].increment,4);assert.equal(r.courses[0].completedCredits,4);assert.equal(r.holds.length,zero?1:0);assert.equal(Object.hasOwn(loaded.workspace.graph.attempts[0].plan,'contribution'),!omitted);lawAmounts(r.progress,4,0);
});
for(const official of [false,true])test(`F02-R2 formal migration law omitted S2 officialGate${official}`,async()=>{
 const s=state([...(official?[]:full.map(n=>item(offering(n,'correspondence')))),item('3c96e34f-9433-446f-a909-5389ca6fce08')]);if(official)s.importedCourseAchievements=full.map(n=>officialRow(catalog.curriculum.courses.find(c=>c.id===offering(n,'correspondence').curriculumCourseId),4));const {r}=await migrated(s);lawAmounts(r.progress,34,2);assert.equal(r.courses.find(c=>c.id===place(d.source,'保険法・海商法').institutionalCourseId).increment,2);assert.equal(r.holds.length,1);
});
for(const omitted of [true,false])for(const ids of [['e0c4749c-d0ac-40af-8bd0-2952f7da9a88','f0ec8fff-cf06-4a95-a0b4-266670a07b8f'],['5c3198fc-10c5-4806-bb2f-bd477670fbf3','e0c4749c-d0ac-40af-8bd0-2952f7da9a88']])test(`F02-R2 formal migration politics independent old offerings omitted${omitted} ${ids[0]}`,async()=>{
 const {r}=await migrated(state(ids.map(id=>item(id,omitted?undefined:2))));assert.equal(r.courses.length,1);assert.deepEqual([r.courses[0].completedCredits,r.courses[0].increment,r.courses[0].schoolingCredits],[4,4,4]);assert.equal(r.holds.length,0);lawAmounts(r.progress,4,4);
});
for(const [kind,s]of sources)for(const value of [undefined,null,0])test(`F02-R2 native missing quantity stays distinct ${kind} ${value}`,async()=>{
 const a=make(s,'民事訴訟法',null,'correspondence');if(value===undefined)delete a.plan.contribution;else a.plan.contribution.value=value;const r=await calc(s,[a]);assert.equal(r.courses.reduce((n,c)=>n+c.increment,0),0);assert.equal(r.holds.length,1);
});
for(const amount of [4,0,null])for(const planned of [false,true])test(`F02-R2 P2 official ${amount} planned0${planned}`,()=>{
 const s=state([item('b6a158b9-465e-48fd-91b3-3c281cf17ea4',2),item('3c96e34f-9433-446f-a909-5389ca6fce08',2),...(planned?[item('54d68d8f-0fa1-4ebf-b701-0e671443d4fb',0,'planned')]:[])]);s.importedCourseAchievements=[officialRow(catalog.curriculum.courses.find(c=>c.id===offering('保険法・海商法','correspondence').curriculumCourseId),amount)];const raw=JSON.stringify(saved22(s)),c=calculateCompletion(s,law).courses[0];assert.equal(c.completion,amount===4?'complete':amount===null?'unknown':'incomplete');assert.equal(c.projectedCompletion,c.completion);assert.equal(c.earnedCredits,c.projectedCredits);assert.equal(JSON.stringify(s),raw);
});
const professional={'法律学科':'行政救済法','日本文学科':'中国文芸史','史学科':'日本古代史','地理学科':'自然地理学（地形）','経済学科':'社会経済思想史','商業学科':'監査論Ⅱ'};
for(const [kind,s]of sources)for(const program of programs)for(const name of ['文学',professional[program.department]])test(`F02-R2 ${kind} ${program.displayName} ${name} regular + unknown`,async()=>{
 const p=place(s,name,name==='文学'?null:program.scopeId),method=p.methodConstraint.requiredMethod??'correspondence',attempts=[newAttempt(s.context.catalog,p,p.compositionCredits,'earned',method),newAttempt(s.context.catalog,p,2,'earned','unknown')],r=await calc(s,attempts,program.scopeId);assert.equal(r.courses.length,1);assert.deepEqual([r.courses[0].increment,r.courses[0].completedCredits,r.courses[0].schoolingCredits,r.courses[0].recordedEarned],[p.compositionCredits,p.compositionCredits,method==='schooling'?p.compositionCredits:0,p.compositionCredits+2]);assert.equal(r.holds.length,1);assert.equal(r.holds[0].attemptId,attempts[1].id);
});
for(const [kind,s]of sources)test(`F02-R2 ${kind} unknown quantity differs from unknown method`,async()=>{
 const r=await calc(s,[make(s,'行政法',4,'correspondence'),make(s,'行政法',2),make(s,'行政法',null,'unknown')]);assert.equal(r.courses.length,1);assert.deepEqual([r.courses[0].increment,r.courses[0].schoolingCredits,r.courses[0].recordedEarned],[4,2,null]);assert.equal(r.holds.length,2);
});
test('F02-R2 decoded source alone cannot default a native Attempt, edited method or explicit null/0',async()=>{
 const {loaded}=await migrated(state([item('35fb5bad-ec27-4c60-a16e-2271168170bb')]));
 for(const variant of ['native','method','null','zero']){
  const a=variant==='native'?make(loaded.source,'民事訴訟法',null,'correspondence'):structuredClone(loaded.workspace.graph.attempts[0]);
  if(variant==='native')delete a.plan.contribution;
  if(variant==='method')a.method={value:'unknown',source:'unknown',evidence:null};
  if(variant==='null'||variant==='zero')a.plan.contribution={value:variant==='null'?null:0,source:'learner',note:null};
  const r=await calc(loaded.source,[a]);assert.equal(r.courses.reduce((n,c)=>n+c.increment,0),0);assert.equal(r.holds.length,1);
 }
});
for(const amount of [4,0,null])test(`F02-R2 formal migration official ${amount} owns omitted manual T4`,async()=>{
 const s=state([item('35fb5bad-ec27-4c60-a16e-2271168170bb')]);s.importedCourseAchievements=[officialRow(catalog.curriculum.courses.find(c=>c.id===catalog.offerings.find(o=>o.id===s.items[0].offeringId).curriculumCourseId),amount)];const {r}=await migrated(s);assert.equal(r.courses.length,1);assert.equal(r.courses[0].authority,'official');assert.equal(r.courses[0].increment,0);assert.equal(card(r.progress,'professional-law-total').earned,amount??0);
});
test('F02-R2 law assertion rejects missing, relabeled and duplicated requirements before comparing values',async()=>{
 const {assertLawDenseRequirements}=await import('./fixtures/f02-law-requirements.mjs'),r=calculateState(state([],'selected'),law);assertLawDenseRequirements(r,0,0);
 const ids=new Set(['5755e04d-5c56-4a34-a2b4-afca335676e2','8e08d5c3-a3ab-47e9-81c8-c9a3f8426a67']);
 for(const mutate of [rows=>rows.filter(r=>!ids.has(r.requirementId)),rows=>rows.filter(r=>r.requirementId!=='5755e04d-5c56-4a34-a2b4-afca335676e2'),rows=>rows.map(r=>ids.has(r.requirementId)?{...r,label:'removed law label'}:r),rows=>[...rows,rows.find(r=>ids.has(r.requirementId))]])assert.throws(()=>assertLawDenseRequirements({...r,requirements:mutate(r.requirements)},0,0));
});
test('F02-R2 projected official2 uses regular positive future2, never the unlinked earned subtotal',()=>{
 const s=state([item('b6a158b9-465e-48fd-91b3-3c281cf17ea4',2,'planned')]);s.importedCourseAchievements=[officialRow(catalog.curriculum.courses.find(c=>c.id===catalog.offerings.find(o=>o.id===s.items[0].offeringId).curriculumCourseId),2)];const c=calculateCompletion(saved22(s),law).courses[0];assert.equal(c.completion,'incomplete');assert.equal(c.projectedCompletion,'complete');
});
test('F02-R2 duplicate claim of an old politics opening does not prove a second enrollment',async()=>{
 const {loaded}=await migrated(state([item('e0c4749c-d0ac-40af-8bd0-2952f7da9a88',2)])),a=loaded.workspace.graph.attempts[0],copy=structuredClone(a),fresh=make(loaded.source,'政治学',2);copy.id=fresh.id;copy.creationOperationId=fresh.creationOperationId;const r=await calc(loaded.source,[a,copy]);assert.equal(r.courses.length,1);assert.equal(r.courses[0].increment,2);assert.equal(r.holds.length,1);assert.equal(r.holds[0].reason,'repeatable_independence_unverified');
});
for(const [kind,s]of sources)for(const extra of [0,2,null])test(`F02-R2 ${kind} lawful S2 survives unknown method with quantity${extra}`,async()=>{
 const r=await calc(s,[...full.map(n=>make(s,n,4,'correspondence')),make(s,'保険法・海商法',2),make(s,'保険法・海商法',extra,'unknown')]),partial=r.courses.find(c=>c.id===place(s,'保険法・海商法').institutionalCourseId);assert.equal(partial.completedCredits,0);assert.equal(partial.schoolingCredits,2);assert.equal(partial.increment,extra===0?2:0);assert.equal(r.holds.length,2);
});
test('F02-R2 duplicate regular S2 retains one legal partial award in legacy22 and formal23',async()=>{
 const s=saved22(state([...full.map(n=>item(offering(n,'correspondence'),4)),item('3c96e34f-9433-446f-a909-5389ca6fce08',2),item('54d68d8f-0fa1-4ebf-b701-0e671443d4fb',2)]));lawAmounts(calculateState(s,law),34,2);const {r}=await migrated(s),partial=r.courses.find(c=>c.id===place(d.source,'保険法・海商法').institutionalCourseId);assert.equal(partial.completedCredits,0);assert.equal(partial.increment,2);assert.equal(partial.schoolingCredits,2);assert.equal(r.holds.length,2);lawAmounts(r.progress,34,2);
});
