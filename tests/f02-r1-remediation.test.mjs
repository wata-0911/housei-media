import {assertLawDenseRequirements} from './fixtures/f02-law-requirements.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,programs,initialState,calculateState,calculateCompletion,newAttempt,officialRow} from './fixtures/yi07-graduation.mjs';
import {decode} from './fixtures/migration-fixture.mjs';
import {validateState} from '../src/planner/validation.ts';
import {loadState,STORAGE_KEY} from '../src/planner/backup/storage.ts';
import {createNewPlanSource} from '../src/planner/attempts/persistence/newPlan.ts';
import {calculateRecordedCredits} from '../src/planner/attempts/graduation/recordedCalculation.ts';
import {setThesisProgressForScope} from '../src/planner/graduation/thesisSelection.ts';
import {createPlannerAttemptSession} from '../src/planner/attempts/production/session.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {foreignLedger,lawLedger} from './fixtures/f02-r1-independent-ledger.mjs';
import {legacyCases} from './fixtures/yi07-graduation.mjs';
import {importRepeated,repeatedPayload} from './fixtures/official-repeatable.mjs';

// Expectations below are fixed from shiori2026 pp.31,45,47(b,d), not engine snapshots.
const law=programs.find(p=>p.department==='法律学科').scopeId;
const item=(o,n)=>({offeringId:typeof o==='string'?o:o.id,status:'earned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null,...(n===undefined?{}:{courseCreditContribution:n})});
function stateFor(items=[],scope=law,selection='not_selected') {
 let s=initialState();Object.assign(s.graduationProfile,{admissionYear:2026,admissionType:'first_year',curriculumApplicability:'current_2026'});
 s.selectedScopeId=scope;s.items=items;s=setThesisProgressForScope(s,catalog,scope,{selection});return s;
}
function saved22(s) {
 assert.equal(validateState(s,catalog),true,'counterexample must be saveable schema22');
 const raw=JSON.stringify(s),r=loadState({getItem:k=>k===STORAGE_KEY?raw:null},catalog);
 assert.equal(r.error,null);assert.deepEqual(r.state.items,s.items);return r.state;
}
const card=(r,id)=>{const c=r.cards.find(c=>c.requirementId===id);assert.ok(c,id);return c;};
const req=(r,label)=>{const a=r.requirements.filter(c=>c.label===label&&c.ruleType==='min_credits');assert.equal(a.length,1,label);return a[0];};
const scopeOffering=(name,method,scope=law)=>catalog.offerings.find(o=>catalog.curriculum.courses.some(c=>c.id===o.curriculumCourseId&&c.canonicalName===name)&&o.method===method&&o.mappingIds.some(id=>catalog.mappings.some(m=>m.mappingId===id&&(m.scopeId===scope||catalog.programs.some(p=>p.isCommon&&p.scopeId===m.scopeId)))));
const source24=await createNewPlanSource(),d=await decode(stateFor());assert.equal(d.status,'decoded');
const sources=[['schema23',d.source],['schema24',source24]];
const place=(s,name,scope=null)=>{const p=s.context.catalog.placements.find(p=>(p.officialName===name||p.auditRecord.canonicalName===name)&&(!scope||p.scopeId===scope)&&p.identityDecision.status==='safe');assert.ok(p,name);return p;};
async function abc(s,p,parts,scope=law) {
 const g={attempts:parts.map(([method,n])=>newAttempt(s.context.catalog,p,n,'earned',method)),ownedRecords:[],removals:[]},raw=JSON.stringify(g);
 const r=await calculateRecordedCredits(raw,s,scope);assert.equal(r.status,'calculated');assert.equal(JSON.stringify(g),raw);
 assert.equal(r.informational.length,parts.length);assert.deepEqual(r.informational.map(a=>a.contribution),parts.map(a=>a[1]));return r;
}
const cases=[
 ['T4',[['correspondence',4]],4,0,0],['T4+S0',[['correspondence',4],['schooling',0]],4,0,1],
 ['T4+S2',[['correspondence',4],['schooling',2]],4,2,1],['T4+T2',[['correspondence',4],['correspondence',2]],4,0,1],
 ['T4+T4',[['correspondence',4],['correspondence',4]],4,0,1],['T4+T2+S2',[['correspondence',4],['correspondence',2],['schooling',2]],4,2,2],
 ['T4+T8',[['correspondence',4],['correspondence',8]],4,0,1],['mixed',[['correspondence',2],['schooling',2]],0,2,2],
];
for(const [kind,s] of sources)for(const [label,parts,completed,schooling,holds] of cases)test(`F02-R1 A ${kind} ${label}`,async()=>{
 const r=await abc(s,place(s,'民事訴訟法',law),parts);assert.equal(r.courses.length,1);
 assert.deepEqual([r.courses[0].recordedEarned,r.courses[0].completedCredits,r.courses[0].increment,r.courses[0].schoolingCredits],[parts.reduce((n,a)=>n+a[1],0),completed,completed,schooling]);
 assert.equal(card(r.progress,'professional-law-required-elective').earned,completed);assert.equal(r.holds.length,holds);
 if(holds)assert.ok(r.holds.every(h=>h.reason===(completed?'additional_course_components_not_counted':'mixed_completion_evidence_required')));
});
for(const [kind,s] of sources)for(const method of ['correspondence','schooling'])test(`F02-R1 A ${kind} regular ${method}2 + malformed8`,async()=>{
 const r=await abc(s,place(s,'金融論B',programs.find(p=>p.department==='経済学科').scopeId),[[method,2],[method,8]],programs.find(p=>p.department==='経済学科').scopeId);
 assert.equal(r.courses.length,1);assert.deepEqual([r.courses[0].recordedEarned,r.courses[0].completedCredits,r.courses[0].increment,r.courses[0].schoolingCredits],[10,2,2,method==='schooling'?2:0]);assert.equal(r.holds.length,1);
});
const professionalNames={'法律学科':'行政救済法','日本文学科':'中国文芸史','史学科':'経済地理学','地理学科':'自然地理学（地形）','経済学科':'経済地理','商業学科':'経済地理'};
const abcProfessionalNames={'法律学科':'行政救済法','日本文学科':'中国文芸史','史学科':'日本古代史','地理学科':'自然地理学（地形）','経済学科':'社会経済思想史','商業学科':'監査論Ⅱ'};
for(const [kind,s] of sources)for(const p of programs)for(const name of ['文学',abcProfessionalNames[p.department]])test(`F02-R1 A ${kind} ${p.displayName} ${name} regular base+S0/S2`,async()=>{
 for(const n of [0,2]) {
  const placement=place(s,name,name==='文学'?null:p.scopeId),size=placement.compositionCredits,method=placement.methodConstraint.requiredMethod??'correspondence',r=await abc(s,placement,[[method,size],['schooling',n]],p.scopeId);
  assert.equal(r.courses.length,1);assert.deepEqual([r.courses[0].recordedEarned,r.courses[0].completedCredits,r.courses[0].increment,r.courses[0].schoolingCredits],[size+n,size,size,size===2&&method==='schooling'?2:n]);assert.equal(r.holds.length,1);
  if(name==='文学')assert.equal(card(r.progress,'group-general').earned,4);
 }
});
for(const p of programs)for(const name of ['文学',professionalNames[p.department]])test(`F02-R1 A schema22 ${p.displayName} ${name} T4+S0 retains one Course`,()=>{
 const t=scopeOffering(name,'correspondence',p.scopeId),s=scopeOffering(name,'schooling',p.scopeId);assert.ok(t&&s,name);
 const base=saved22(stateFor([item(t,4)],p.scopeId)),extra=saved22(stateFor([item(t,4),item(s,0)],p.scopeId));const before=JSON.stringify(extra);
 const r=calculateState(extra,p.scopeId),b=calculateState(base,p.scopeId),c=calculateCompletion(extra,p.scopeId);
 assert.equal(c.courses.length,1);assert.equal(c.courses[0].earnedCredits,4);assert.equal(c.courses[0].completion,'complete');assert.equal(c.courses[0].attempts.length,2);
 assert.equal(r.referenceProgress[0].earned,b.referenceProgress[0].earned);assert.equal(r.referenceProgress[0].earned,4);assert.equal(JSON.stringify(extra),before);
});
const foreignIds=['056ffe8f-4c4b-4cc8-825d-7919f470b7b6','066427dc-1df4-47bd-a6b1-538ab161e869','0c8b780c-2748-4c5c-96c0-43caa9102892','0f434746-a27e-4dfe-9707-95044945ef04'];
test('F02-R1 schema22 explicit null contribution is rejected, not a saveable A counterexample',()=>{
 const s=stateFor([item('35fb5bad-ec27-4c60-a16e-2271168170bb',4),item('a2caa2ab-135f-4ad8-8998-75e8fd88ca59',null)]),raw=JSON.stringify(s);
 assert.equal(validateState(s,catalog),false);const loaded=loadState({getItem:k=>k===STORAGE_KEY?raw:null},catalog);assert.notEqual(loaded.error,null);assert.equal(JSON.stringify(s),raw);
});
test('F02-R1 B schema22 persisted fractional English is raw2, completion0, graduation0',()=>{
 const s=saved22(stateFor(foreignIds.map(id=>item(id,.5)))),before=JSON.stringify(s),r=calculateState(s,law),c=calculateCompletion(s,law);
 assert.equal(s.items.length,4);assert.equal(c.courses.length,1);assert.equal(c.courses[0].earnedCredits,2);assert.notEqual(c.courses[0].completion,'complete');
 assert.equal(card(r,'group-foreign').earned,0);assert.notEqual(card(r,'group-foreign').status,'satisfied');assert.equal(r.referenceProgress[0].earned,0);assert.equal(JSON.stringify(s),before);
});
for(const [kind,s] of sources)for(const language of ['英語','独語','仏語'])for(const [parts,expected,held] of [[[.5,.5],0,2],[[1,1,1,1],4,0],[[1,1,1,1,1],4,1]])test(`F02-R1 B ${kind} ${language} S ${parts}`,async()=>{
 const r=await abc(s,place(s,language+'SⓈ※'),parts.map(n=>['schooling',n]));assert.equal(r.courses.length,1);
 assert.deepEqual([r.courses[0].recordedEarned,r.courses[0].completedCredits,r.courses[0].increment,r.courses[0].schoolingCredits],[parts.reduce((n,x)=>n+x,0),expected,expected,expected]);
 assert.equal(card(r.progress,'group-foreign').earned,expected);assert.equal(r.holds.length,held);assert.equal(card(r.progress,'group-foreign').status,expected===4?'satisfied':'unknown');
});
for(const [kind,s] of sources)test(`F02-R1 B ${kind} geography1 cannot be assembled from fractions`,async()=>{
 const scope=programs.find(p=>p.department==='地理学科').scopeId,r=await abc(s,place(s,'地域特講（現地研究）',scope),[['schooling',.5],['schooling',.5]],scope);
 assert.equal(r.courses.length,1);assert.equal(r.courses[0].completedCredits,0);assert.equal(r.courses[0].increment,0);assert.equal(r.holds.length,2);
 assert.equal(card(r.progress,'professional-geography-elective').earned,0);
});
for(const parts of [[.5,.5],[0,0],[1,1],[1,1,1,1]])test(`F02-R1 B schema22 geography field-study S1 per record ${parts}`,()=>{
 const scope=programs.find(p=>p.department==='地理学科').scopeId,offerings=catalog.offerings.filter(o=>o.curriculumCourseId==='curriculum:d6e410fe-0e26-45dd-9c5a-af44b85d9f98'&&o.method==='schooling');assert.equal(offerings.length,4);
 const s=saved22(stateFor(parts.map((n,i)=>item(offerings[i],n)),scope)),before=JSON.stringify(s),r=calculateState(s,scope),proper=parts.filter(n=>n===1).length;
 assert.equal(card(r,'professional-geography-schooling-required').earned,Math.min(2,proper));assert.equal(card(r,'professional-geography-elective').earned,Math.max(0,proper-2));assert.equal(card(r,'professional-geography-total').earned,proper);assert.equal(JSON.stringify(s),before);
});
const fullNames=['行政法','刑事訴訟法','債権総論','刑法各論','国際法各論','物権法','国際法総論','刑法総論','民事訴訟法'];
const partialIds=['3c96e34f-9433-446f-a909-5389ca6fce08','54d68d8f-0fa1-4ebf-b701-0e671443d4fb'];
for(const count of [7,8,9])test(`F02-R1 C schema23 official completed ${count} courses opens the same manual S2 destination`,async()=>{
 const state=stateFor();state.importedCourseAchievements=fullNames.slice(0,count).map(n=>officialRow(catalog.curriculum.courses.find(c=>c.id===scopeOffering(n,'correspondence').curriculumCourseId),4));
 const decoded=await decode(saved22(state));assert.equal(decoded.status,'decoded');const r=await abc(decoded.source,place(decoded.source,'保険法・海商法',law),[['schooling',2]]);
 assert.equal(r.courses.length,1);assert.equal(r.courses[0].completedCredits,0);assert.equal(r.courses[0].increment,count>=8?2:0);assert.equal(card(r.progress,'professional-law-total').earned,count*4+(count>=8?2:0));
});
for(const selection of ['selected','not_selected'])for(const omitted of [true,false])for(const [count,parts,expected] of [[7,[2],0],[8,[2],2],[9,[2],2],[8,[1,1],0],[8,[.5,1.5],0]])test(`F02-R1 C schema22 ${selection} omitted${omitted} ${count}+S${parts}`,()=>{
 const items=fullNames.slice(0,count).map(n=>item(scopeOffering(n,'correspondence'),omitted?undefined:4));items.push(...parts.map((n,i)=>item(partialIds[i],omitted&&parts.length===1?undefined:n)));
 const s=saved22(stateFor(items,law,selection)),before=JSON.stringify(s),r=calculateState(s,law),overflow=Math.max(0,count*4-32),total=count*4+expected;
 assert.equal(card(r,'professional-law-elective').earned,overflow+expected);assert.equal(card(r,'professional-law-total').earned,total);
 assert.equal(req(r,'専門教育：選択').earned,overflow+expected);assert.equal(req(r,'専門教育').earned,total);assert.equal(r.referenceProgress[0].earned,total);assert.equal(JSON.stringify(s),before);
});
for(const [kind,s]of sources)for(const [count,method,parts,expected]of [[7,'schooling',[2],0],[8,'schooling',[2],2],[9,'schooling',[2],2],[8,'correspondence',[2],0],[8,'media',[2],2],[8,'schooling',[1,1],0],[8,'schooling',[.5,1.5],0]])test(`F02-R1 C ${kind} ${count}+${method}${parts}`,async()=>{
 const attempts=fullNames.slice(0,count).map(n=>newAttempt(s.context.catalog,place(s,n,law),4,'earned','correspondence'));
 attempts.push(...parts.map(n=>newAttempt(s.context.catalog,place(s,'保険法・海商法',law),n,'earned',method)));
 const r=await calculateRecordedCredits(JSON.stringify({attempts,ownedRecords:[],removals:[]}),s,law);assert.equal(r.status,'calculated');assert.equal(r.courses.length,count+1);
 const partial=r.courses.find(c=>c.id===place(s,'保険法・海商法',law).institutionalCourseId);assert.equal(partial.completedCredits,0);assert.equal(partial.increment,expected);
 assert.equal(r.informational.length,count+parts.length);assert.deepEqual(r.informational.map(a=>[a.method,a.contribution]),attempts.map(a=>[a.method.value,a.plan.contribution.value]));assert.equal(r.holds.length,parts.length);assert.deepEqual(new Set(r.holds.map(h=>h.attemptId)),new Set(attempts.slice(count).map(a=>a.id)));
 assert.equal(card(r.progress,'professional-law-total').earned,count*4+expected);assert.equal(card(r.progress,'professional-law-elective').earned,Math.max(0,count*4-32)+expected);
});
const politicsId='curriculum:f49de1e6-82ae-4b86-8c0a-453ef41995ce';
const politics=catalog.offerings.filter(o=>o.curriculumCourseId===politicsId&&o.method==='schooling');
for(const [kind,s]of sources)for(const count of [1,2,3,5])test(`F02-R1 D ${kind} manual politics ${count} cannot bypass independent-repeat evidence`,async()=>{
 const r=await abc(s,place(s,'政治学',law),Array.from({length:count},()=>['schooling',2]));
 assert.equal(r.courses.length,1);assert.deepEqual([r.courses[0].recordedEarned,r.courses[0].completedCredits,r.courses[0].increment,r.courses[0].schoolingCredits],[count*2,2,2,2]);assert.equal(card(r.progress,'professional-law-total').earned,2);
 assert.equal(r.holds.length,count-1);if(count>1)assert.ok(r.holds.every(h=>h.reason==='repeatable_independence_unverified'));
});
for(const count of [1,2,3,5])test(`F02-R1 D schema23 native official politics ${count} + manual is capped4 without duplicate increment`,async()=>{
 const state=importRepeated(repeatedPayload('政治学',count)),decoded=await decode(state);assert.equal(decoded.status,'decoded');
 const r=await abc(decoded.source,place(decoded.source,'政治学',law),[['schooling',2]]);
 assert.equal(r.courses.length,1);assert.equal(r.courses[0].authority,'official');assert.equal(r.courses[0].increment,0);
 assert.equal(card(r.progress,'professional-law-total').earned,Math.min(4,count*2));assert.equal(r.holds.length,0);
});
for(const count of [1,2,3,5])for(const omitted of [true,false])test(`F02-R1 D schema22 politics ${count} omitted${omitted} exact identity cap4`,()=>{
 const normal=politics.filter(o=>!o.name.startsWith('【教職】')),teacher=politics.filter(o=>o.name.startsWith('【教職】'));assert.equal(normal.length,3);assert.equal(teacher.length,2);
 const s=saved22(stateFor([...normal,...teacher].slice(0,count).map(o=>item(o,omitted?undefined:2)))),before=JSON.stringify(s),r=calculateState(s,law),expected=Math.min(count*2,4);
 assert.equal(card(r,'professional-law-elective').earned,expected);assert.equal(card(r,'professional-law-total').earned,expected);assert.equal(req(r,'専門教育：選択').earned,expected);assert.equal(req(r,'専門教育').earned,expected);assert.equal(r.referenceProgress[0].earned,expected);assert.equal(JSON.stringify(s),before);
});
for(const amount of [4,0,null])test(`F02-R1 P2 official ${amount} + unverified manual mixed does not invent completion`,()=>{
 const t=scopeOffering('文学','correspondence'),s=scopeOffering('文学','schooling'),state=stateFor([item(t,2),item(s,2)]);state.importedCourseAchievements=[officialRow(catalog.curriculum.courses.find(c=>c.id===t.curriculumCourseId),amount)];
 const loaded=saved22(state),before=JSON.stringify(loaded),c=calculateCompletion(loaded,law).courses[0],r=calculateState(loaded,law);
 assert.equal(c.officialAchievements[0].earnedCreditsTotal,amount);assert.equal(c.attempts.length,2);assert.equal(c.completion,amount===4?'complete':amount===null?'unknown':'incomplete');assert.equal(card(r,'group-general').earned,amount??0);assert.equal(JSON.stringify(loaded),before);
});
test('F02-R1 A formal schema24 save/reload preserves T4 after S2 and isolates extra hold',async()=>{
 let authority=emptyAuthority();const store={read:async()=>structuredClone(authority),commit:async(e,n)=>{assert.deepEqual(e,authority);authority=structuredClone(n);}},locks={request:async(_n,_o,f)=>f()},session=createPlannerAttemptSession(store,locks),save=async()=>session.save(await session.prepareSave(),true);
 await session.load();await save();const p=place(source24,'文学');
 for(const [method,value]of [['correspondence',4],['schooling',2]]){const g=session.add(p.id,JSON.stringify({method,status:'earned',plannedYear:2033}));session.recordContribution(g.attempts.at(-1).id,JSON.stringify({value}));await save();await session.load();}
 const before=structuredClone(authority),r=await session.calculate(law);assert.equal(r.courses.length,1);assert.equal(r.courses[0].increment,4);assert.equal(card(r.progress,'group-general').earned,4);assert.equal(r.holds.length,1);assert.deepEqual(authority,before);assert.deepEqual(session.graph().attempts.map(a=>a.plan.contribution.value),[4,2]);
});
for(const [kind,s] of sources)test(`F02-R1 P2 ${kind} absent / known0 / null / unsupported quantity retain distinct evidence`,async()=>{
 const p=place(s,'金融論B',programs.find(p=>p.department==='経済学科').scopeId),scope=p.scopeId;
 const empty=await abc(s,p,[],scope);assert.equal(empty.courses.length,0);assert.equal(empty.holds.length,0);assert.equal(card(empty.progress,'professional-economics-required-elective').status,'unsatisfied');
 const zero=await abc(s,p,[['correspondence',0]],scope);assert.equal(zero.courses.length,1);assert.equal(zero.holds.length,1);assert.equal(zero.holds[0].reason,'course_components_incomplete');assert.equal(card(zero.progress,'professional-economics-required-elective').status,'unsatisfied');
 const unknown=await abc(s,p,[['correspondence',null]],scope);assert.equal(unknown.courses.length,0);assert.equal(unknown.holds.length,1);assert.equal(unknown.holds[0].reason,'explicit_quantity_and_compatible_method_required');assert.equal(card(unknown.progress,'professional-economics-required-elective').status,'unknown');
 const unsupported=await abc(s,p,[['correspondence',8]],scope);assert.equal(unsupported.courses.length,1);assert.equal(unsupported.courses[0].increment,0);assert.equal(unsupported.holds.length,1);assert.equal(unsupported.holds[0].reason,'unsupported_course_component_structure');assert.equal(card(unsupported.progress,'professional-economics-required-elective').status,'unknown');
 const known=await abc(s,place(s,'民事訴訟法',law),[['correspondence',4],['schooling',null]],law);assert.equal(known.courses.length,1);assert.equal(known.courses[0].recordedEarned,null);assert.equal(known.courses[0].increment,4);assert.equal(known.holds.length,1);
});
for(const c of legacyCases().filter(c=>c.name.includes('/dense-')))test(`F02-R1 absolute independent foreign/law input ledger ${c.name}`,()=>{
 const r=calculateState(c.state,c.scopeId),l=foreignLedger(c.state,catalog),english=card(r,'group-foreign').details.find(d=>d.label==='英語');
 assert.deepEqual([english.earned,english.schooling],[l.英語.earned,l.英語.schooling]);
 if(c.scopeId===law) {
  const a=lawLedger(c.state,catalog,law);assert.equal(card(r,'professional-law-total').normalEarned??card(r,'professional-law-total').earned,a.total);
  assert.equal(card(r,'professional-law-elective').normalEarned??card(r,'professional-law-elective').earned,a.elective);
  assertLawDenseRequirements(r,a.total,a.elective);
 }
});
