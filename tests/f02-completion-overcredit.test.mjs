import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewPlanSource } from '../src/planner/attempts/persistence/newPlan.ts';
import { calculateRecordedCredits } from '../src/planner/attempts/graduation/recordedCalculation.ts';
import { newAttempt, programs, catalog, initialState, calculateState, calculateCompletion } from './fixtures/yi07-graduation.mjs';
import { decode } from './fixtures/migration-fixture.mjs';
const native = await createNewPlanSource();
const decoded = await decode(initialState());
assert.equal(decoded.status, 'decoded');
const sources = [['schema24', native], ['schema23', decoded.source]];
const scope = d => programs.find(p => p.department === d).scopeId;
const card = (r,id) => r.progress.cards.find(c => c.requirementId === id);
const placement = (s,name,department=null) => s.context.catalog.placements.find(p => p.officialName === name && p.identityDecision.status === 'safe' && (!department || p.scopeId === scope(department)));
for (const [kind,s] of sources) {
 const run = async (name,parts,department='法律学科',orders=[]) => {
  const p=placement(s,name,department), m=s.context.catalog;
  assert.ok(p,name);
  const attempts=parts.map(([method,n],i)=>{const a=newAttempt(m,p,n,'earned',method);a.plan.earnedOrder=orders[i]??null;return a;});
  const graph={attempts,ownedRecords:[],removals:[]}, before=structuredClone(graph);
  const r=await calculateRecordedCredits(JSON.stringify(graph),s,scope(department));
  assert.equal(r.status,'calculated'); assert.deepEqual(graph,before);
  console.log(JSON.stringify({kind,name,parts,orders,courses:r.courses,holds:r.holds,cards:r.progress.cards.filter(c=>c.requirementId.startsWith('professional-')).map(({requirementId,earned,status})=>({requirementId,earned,status}))}));
  return r;
 };
 for (const orders of [[],[1,2],[2,1]]) test(`F02 ${kind} K1 mixed does not prove completion order ${orders}`,async()=>{
  const r=await run('民事訴訟法',[['correspondence',2],['schooling',2]],'法律学科',orders);
  assert.equal(card(r,'professional-law-required-elective').earned,0);
  assert.ok(r.holds.some(h=>h.reason==='mixed_completion_evidence_required'));
  assert.equal(r.informational.reduce((n,a)=>n+a.contribution,0),4);
  assert.equal(r.courses[0].completedCredits,0);
  assert.equal(card(r,'professional-law-schooling').earned,2);
 });
 for(const [label,parts,expected] of [['T1+T1',[['correspondence',1],['correspondence',1]],0],['T8',[['correspondence',8]],0],['S8',[['schooling',8]],0],['T2',[['correspondence',2]],2],['S2',[['schooling',2]],2]]) test(`F02 ${kind} K3 ${label}`,async()=>{
  const r=await run('金融論B',parts,'経済学科');
  assert.equal(card(r,'professional-economics-required-elective').earned,expected);
  assert.equal(r.courses.reduce((n,c)=>n+(c.completedCredits??0),0),expected);
  if(!expected) assert.ok(r.holds.length);
 });
 test(`F02 ${kind} T4 and T2+T2 boundaries`,async()=>{
  const r=await run('民事訴訟法',[['correspondence',4]]);
  assert.equal(card(r,'professional-law-required-elective').earned,4);
  const bad=await run('民事訴訟法',[['correspondence',2],['correspondence',2]]);
  assert.equal(card(bad,'professional-law-required-elective').earned,0); assert.ok(bad.holds.length);
 });
 for(const program of programs) test(`F02 ${kind} K2 incomplete humanities x4 ${program.displayName}`,async()=>{
  const attempts=['文学','論理学','西洋史','日本史'].map(name=>newAttempt(s.context.catalog,placement(s,name),2,'earned','correspondence'));
  const r=await calculateRecordedCredits(JSON.stringify({attempts,ownedRecords:[],removals:[]}),s,program.scopeId);
  const h=r.progress.requirements.find(r=>r.label==='一般教育：人文');
  console.log(JSON.stringify({kind,program:program.displayName,case:'K2',courses:r.courses,holds:r.holds,humanities:h,general:card(r,'group-general')}));
  assert.equal(card(r,'group-general').earned,0); assert.equal(h.earned,0); assert.notEqual(h.status,'satisfied');
  assert.equal(r.informational.reduce((n,a)=>n+a.contribution,0),8);
 });
 test(`F02 ${kind} foreign S1 survives invalid T1`,async()=>{
  const ps=[placement(s,'英語2'),placement(s,'英語SⓈ※')]; assert.ok(ps.every(Boolean));
  for(const count of [0,1,2]) {
   const attempts=[newAttempt(s.context.catalog,ps[1],1,'earned','schooling'),...Array.from({length:count},()=>newAttempt(s.context.catalog,ps[0],1,'earned','correspondence'))];
   const r=await calculateRecordedCredits(JSON.stringify({attempts,ownedRecords:[],removals:[]}),s,scope('法律学科'));
   assert.equal(card(r,'group-foreign').earned,1);
  }
 });
}
for(const [label,name,parts] of [['K2','文学',[['correspondence',2]]],['K1','民事訴訟法',[['correspondence',2],['schooling',2]]]]) test(`F02 schema22 ${label} raw records survive without completed allocation`,()=>{
 const state=initialState(); state.graduationProfile.admissionType='first_year';state.graduationProfile.curriculumApplicability='current_2026';
 state.items=parts.map(([method,n],i)=>{const o=catalog.offerings.find(o=>o.id === (method === 'schooling' ? 'a2caa2ab-135f-4ad8-8998-75e8fd88ca59' : '') || (o.name===name&&o.method===method));assert.ok(o);return {offeringId:o.id,status:'earned',plannedYear:2026,plannedTerm:null,studyYear:null,earnedOrder:i+1,courseCreditContribution:n};});
 const before=structuredClone(state),p=calculateState(state,scope('法律学科')),c=calculateCompletion(state,scope('法律学科')).courses[0];
 console.log(JSON.stringify({kind:'schema22',name,parts,completion:c,cards:p.cards}));
 assert.notEqual(c.completion,'complete'); assert.equal(c.earnedCredits,parts.reduce((n,a)=>n+a[1],0));
 assert.equal(p.cards.find(c=>c.requirementId===(label==='K2'?'group-general':'professional-law-required-elective')).earned,0);
 assert.deepEqual(state,before);
});

for (const [kind,s] of sources) {
 test(`F02 ${kind} malformed general T8 and T2+T2 cannot complete parent or child`,async()=>{
  const p=placement(s,'文学');
  for(const parts of [[8],[2,2]]) {
   const attempts=parts.map(n=>newAttempt(s.context.catalog,p,n,'earned','correspondence'));
   const r=await calculateRecordedCredits(JSON.stringify({attempts,ownedRecords:[],removals:[]}),s,scope('法律学科'));
   assert.equal(card(r,'group-general').earned,0);
   assert.equal(r.progress.requirements.find(r=>r.label==='一般教育：人文').earned,0);
   assert.ok(r.holds.length);
  }
 });
 test(`F02 ${kind} S2+S2 retains one known S2 while independent completion stays held`,async()=>{
  const p=placement(s,'民事訴訟法','法律学科');
  const attempts=[1,2].map(()=>newAttempt(s.context.catalog,p,2,'earned','schooling'));
  const r=await calculateRecordedCredits(JSON.stringify({attempts,ownedRecords:[],removals:[]}),s,scope('法律学科'));
  assert.equal(card(r,'professional-law-required-elective').earned,0);
  // R2: two regular S2 claims prove at least one S2, never independent completion4.
  assert.equal(card(r,'professional-law-schooling').earned,2);
  assert.notEqual(card(r,'professional-law-schooling').status,'satisfied');
  assert.equal(r.informational.length,2);
  assert.deepEqual(r.informational.map(a=>[a.method,a.contribution]),[['schooling',2],['schooling',2]]);
  assert.equal(r.courses.length,1);
  assert.deepEqual([r.courses[0].recordedEarned,r.courses[0].completedCredits,r.courses[0].increment,r.courses[0].schoolingCredits],[4,0,0,2]);
  assert.equal(r.holds.length,2);
  assert.ok(r.holds.every(h=>h.reason==='schooling_independence_evidence_required'));
 });
 test(`F02 ${kind} legitimate Law partial S2 requires eight full courses`,async()=>{
  const master=s.context.catalog;
  const pp=master.placements.filter(p=>p.scopeId===scope('法律学科')&&p.category==='専門教育'&&p.requirementType==='選択必修'&&p.compositionCredits===4&&p.identityDecision.status==='safe'&&!p.methodConstraint.requiredMethod);
  assert.ok(pp.length>=9);
  for(const count of [7,8]) {
   const attempts=pp.slice(0,count).map(p=>newAttempt(master,p,4,'earned','correspondence'));
   attempts.push(newAttempt(master,pp[8],2,'earned','schooling'));
   const r=await calculateRecordedCredits(JSON.stringify({attempts,ownedRecords:[],removals:[]}),s,scope('法律学科'));
   assert.equal(card(r,'professional-law-required-elective').earned,count*4);
   assert.equal(card(r,'professional-law-elective').earned,count===8?2:0);
   assert.equal(card(r,'professional-law-schooling').earned,2);
  }
 });
}

for(const [kind,s] of sources) test(`F02 ${kind} foreign S1 repeats meet only one-language 4/S2`,async()=>{
 const m=s.context.catalog,english=placement(s,'英語SⓈ※'),t=placement(s,'英語2'),german=placement(s,'独語SⓈ※');
 assert.ok(english&&t&&german);
 for(const [a,expected,status] of [
  [[newAttempt(m,t,2,'earned','correspondence'),...Array.from({length:2},()=>newAttempt(m,english,1,'earned','schooling'))],4,'satisfied'],
  [Array.from({length:4},()=>newAttempt(m,english,1,'earned','schooling')),4,'satisfied'],
  [[newAttempt(m,t,2,'earned','correspondence'),...Array.from({length:2},()=>newAttempt(m,german,1,'earned','schooling'))],2,'unsatisfied']
 ]) {
  const r=await calculateRecordedCredits(JSON.stringify({attempts:a,ownedRecords:[],removals:[]}),s,scope('法律学科'));
  assert.deepEqual(r.holds,[]); assert.equal(card(r,'group-foreign').earned,expected); assert.equal(card(r,'group-foreign').status,status);
 }
});
