import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlannerAttemptSession} from '../src/planner/attempts/production/session.ts';
import {createAcController} from '../src/planner/attempts/production/acController.ts';
import {createAttemptPersistence} from '../src/planner/attempts/persistence/controller.ts';
import {newOperationId} from '../src/planner/attempts/workbench/operations.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {createNewPlanSource} from '../src/planner/attempts/persistence/newPlan.ts';
import {calculateRecordedCredits} from '../src/planner/attempts/graduation/recordedCalculation.ts';
import rules from '../src/data/graduation_rules.json' with{type:'json'};
const locks={request:async(_n,_o,f)=>f()},source=await createNewPlanSource();
const common=rules.programs.find(p=>p.isCommon).scopeId,scope=rules.programs.find(p=>!p.isCommon).scopeId;
const placement=source.context.catalog.placements.find(p=>p.scopeId===common&&p.compositionCredits===4&&p.category==='一般教育'&&p.identityDecision.status==='safe'&&p.auditRecord.placementStatus==='safe'&&!p.methodConstraint.requiredMethod);
const input=JSON.stringify({plannedYear:2033,method:'correspondence',status:'earned'});
function memory(){let state=emptyAuthority(),fail='';return{read:async()=>{if(fail==='read')throw Error('read_failed');return structuredClone(state);},snapshot:()=>structuredClone(state),fail:x=>fail=x,commit:async(e,n)=>{assert.deepEqual(e,state,'stale_commit');if(fail==='quota')throw Error('quota');state=structuredClone(n);if(fail==='unknown')throw Error('unknown');}};}
const save=async s=>s.save(await s.prepareSave(),true);
async function start(){const store=memory(),s=createPlannerAttemptSession(store,locks);await s.load();await save(s);const a=s.add(placement.id,input).attempts[0];return{store,s,a};}
const general=r=>r.progress.cards.find(c=>c.requirementId==='group-general');
test('ABC fixed T4: primitive learner quantity → formal save → reload → audited engine, no calculation write',async()=>{
 const {store,s,a}=await start();s.recordContribution(a.id,'{"value":4}');await save(s);await s.load();const before=store.snapshot(),view=s.view();const r=await s.calculate(scope);
 assert.equal(r.status,'calculated');assert.equal(general(r).earned,4);assert.equal(r.courses[0].completedCredits,4);assert.equal(r.courses[0].schoolingCredits,0);assert.equal(r.personalApplicability.status,'unverified');assert.equal(r.graduationCheckComplete,false);assert.equal(r.releaseReady,false);
 assert.deepEqual(r,await calculateRecordedCredits(JSON.stringify(view.graph),view.source,scope));assert.deepEqual(store.snapshot(),before);assert.deepEqual(s.view(),view);
 assert.deepEqual(JSON.parse(before.raw).retained,{importedCourseAchievements:[],importedStudyRecords:[],applicability:'unknown',scopeId:null,graduationEvaluation:'not_evaluated',graduationCheckComplete:false,sourceLinksReverified:false});
});
test('ABC contribution null stays held, explicit 0 stays 0, edit/remove/Undo preserve source and restore exact calculation',async()=>{
 const {s,a}=await start();s.recordContribution(a.id,'{"value":null}');await save(s);await s.load();const held=await s.calculate(scope);assert.ok(held.holds.some(h=>h.reason==='explicit_quantity_and_compatible_method_required'));assert.equal(s.graph().attempts[0].plan.contribution.value,null);
 s.recordContribution(a.id,'{"value":0}');await save(s);await s.load();const zero=await s.calculate(scope);assert.equal(s.graph().attempts[0].plan.contribution.value,0);assert.equal(zero.informational[0].contribution,0);assert.equal(general(zero).earned,0);assert.ok(zero.holds.some(h=>h.reason==='course_components_incomplete'));
 // T0 is stored as an explicit zero. The engine reports known zero as incomplete, independently of unknown/null.
 s.recordContribution(a.id,'{"value":4}');await save(s);await s.load();const original=await s.calculate(scope),src=s.source();s.remove(a.id);await save(s);await s.load();assert.equal(general(await s.calculate(scope)).earned,0);s.undo(a.id);await save(s);await s.load();assert.deepEqual(await s.calculate(scope),original);assert.deepEqual(s.source(),src);
});
test('ABC rejects contribution abuse before UUID issuance, no source/graph/authority/reservation changes',async()=>{
 const {s,a,store}=await start();await save(s);const before=s.view(),authority=store.snapshot();let calls=0;const uuid=crypto.randomUUID;crypto.randomUUID=()=>{calls++;return uuid.call(crypto);};
 try{for(const raw of ['{}','{"value":"4"}','{"value":true}','{"value":[]}','{"value":{}}','{"value":-1}','{"value":-0}','{"value":1e309}','{"value":9007199254740992}','{"value":4,"value":2}','{"value":4,"source":"official"}','{"value":4,"identity":{}}']){assert.throws(()=>s.recordContribution(a.id,raw));assert.deepEqual(s.view(),before);assert.deepEqual(store.snapshot(),authority);}assert.throws(()=>s.recordContribution('forged','{"value":4}'));assert.equal(calls,0);}finally{crypto.randomUUID=uuid;}
 await save(s);assert.deepEqual(store.snapshot().issuedIds,authority.issuedIds);s.remove(a.id);const removed=s.view();assert.throws(()=>s.recordContribution(a.id,'{"value":4}'));assert.deepEqual(s.view(),removed);
});
test('ABC controller hides stale calculation on edit/failure/failed reload; reconciliation recalculates committed result',async()=>{
 for(const failure of ['quota','unknown']){const store=memory(),s=createPlannerAttemptSession(store,locks),c=createAcController(s);await c.load();await c.prepare();await c.save(c.getSnapshot().proposal,true);c.add(placement.id,input);const id=c.getSnapshot().graph.attempts[0].id;c.recordContribution(id,'{"value":4}');assert.equal(await c.calculate(scope),false);assert.equal(c.getSnapshot().calculation,null);await c.prepare();await c.save(c.getSnapshot().proposal,true);await c.load();assert.equal(await c.calculate(scope),true);assert.equal(general(c.getSnapshot().calculation.result).earned,4);
 c.recordContribution(id,'{"value":2}');assert.equal(c.getSnapshot().calculation,null);await c.prepare();store.fail(failure);assert.equal(await c.save(c.getSnapshot().proposal,true),false);assert.equal(c.getSnapshot().calculation,null);assert.equal(await c.calculate(scope),false);store.fail('read');await c.load();assert.equal(c.getSnapshot().calculation,null);assert.equal(c.getSnapshot().ready,false);store.fail('');await c.load();assert.equal(await c.calculate(scope),true);const r=c.getSnapshot().calculation.result;assert.equal(general(r).earned,failure==='quota'?4:0);assert.equal(r.courses[0].recordedEarned,failure==='quota'?4:2);}
});
test('ABC refuses dirty or revoked session calculation and unknown scope',async()=>{
 const {s,a,store}=await start();await assert.rejects(s.calculate(scope),/saved_snapshot_required/);await save(s);await assert.rejects(s.calculate('forged'),/unknown_scope/);s.recordContribution(a.id,'{"value":4}');await save(s);store.fail('read');await assert.rejects(s.load());await assert.rejects(s.calculate(scope),/not_editable/);
});
test('ABC calculation controller clears previous result on rejected calculation and concurrent operations',async()=>{
 const {s}=await start();await save(s);const c=createAcController(s);await c.load();await c.calculate(scope);assert.ok(c.getSnapshot().calculation);assert.equal(await c.calculate('forged'),false);assert.equal(c.getSnapshot().calculation,null);
});

test('ABC generation check rejects a calculation made stale by a direct session edit',async()=>{
 const {s,a}=await start();s.recordContribution(a.id,'{"value":4}');await save(s);const pending=s.calculate(scope);s.update(a.id,JSON.stringify({plannedYear:2038,method:'correspondence',status:'earned'}));await assert.rejects(pending,/stale_calculation/);
});
for(const parts of [[['correspondence',2],['schooling',2]],[['correspondence',4],['correspondence',4]],[['correspondence',2],['correspondence',2]]])test('ABC saved composition across all eight curricula '+JSON.stringify(parts),async()=>{
 const store=memory(),s=createPlannerAttemptSession(store,locks);await s.load();await save(s);
 for(const [method,value]of parts){const graph=s.add(placement.id,JSON.stringify({plannedYear:2033,method,status:'earned'}));s.recordContribution(graph.attempts.at(-1).id,JSON.stringify({value}));}
 await save(s);await s.load();const before=store.snapshot();
 for(const p of rules.programs.filter(p=>!p.isCommon)){const r=await s.calculate(p.scopeId);assert.equal(r.status,'calculated');if(parts[0][1]===2){assert.equal(general(r).earned,0);assert.equal(r.courses[0].completedCredits,0);assert.ok(r.holds.every(h=>h.reason===(parts[1][0]==='schooling'?'mixed_completion_evidence_required':'unsupported_course_component_structure')));}else{assert.equal(general(r).earned,4);assert.equal(r.courses[0].completedCredits,4);assert.equal(r.courses[0].schoolingCredits,parts[1][0]==='schooling'?2:0);}assert.equal(r.graduationCheckComplete,false);assert.equal(r.personalApplicability.status,'unverified');}assert.deepEqual(store.snapshot(),before);
});

// ABC-AUDIT-01: only the learner quantity may change on an existing contribution.
async function p2ContributionFixture(note) {
 const {store,s,a}=await start();await save(s);await s.load();
 if(note!==undefined){
  // Establish legal metadata through the unchanged persistence controller/history.
  const api=createAttemptPersistence(store,locks),handle=await api.load();
  const before=handle.workspace.graph.attempts.find(x=>x.id===a.id);
  const command={kind:'edit',operationId:newOperationId(),attemptId:a.id,
   changes:{plan:{...before.plan,contribution:{value:4,source:'learner',note}}}};
  const preview=await api.prepareEdits(handle,[command]);
  await api.commit(preview,true,preview.previousRaw,preview.sourceRaw);await s.load();
 }else assert.equal(s.graph().attempts[0].plan.contribution,undefined);
 return {store,s,id:a.id};
}
for(const [label,note]of [['nonempty','本人記録の根拠: 2033年の受験結果を確認。単位の変更時も保全する。'],['null',null],['unset',undefined]]){
 for(const value of [2,0,null])test(`ABC-AUDIT-01 P2 ${label} metadata: 4→${value}, save/load preserves every other field`,async()=>{
  const {store,s,id}=await p2ContributionFixture(note);
  const before=structuredClone(s.view()),authority=store.snapshot(),state=JSON.parse(authority.raw),a=before.graph.attempts[0];
  const expected=note===undefined?{value,source:'learner',note:'本人入力（公式成績ではありません）'}:{...a.plan.contribution,value};
  const graph=s.recordContribution(id,JSON.stringify({value}));
  const expectedAttempt={...a,plan:{...a.plan,contribution:expected}};
  assert.deepEqual(graph.attempts[0],expectedAttempt);assert.deepEqual(graph.ownedRecords,before.graph.ownedRecords);assert.deepEqual(graph.removals,before.graph.removals);
  assert.deepEqual(s.source(),before.source);assert.deepEqual(s.view().committedState,before.committedState);assert.deepEqual(store.snapshot(),authority,'draft must not write authority');
  await save(s);await s.load();const afterAuthority=store.snapshot(),after=JSON.parse(afterAuthority.raw);
  assert.equal(afterAuthority.revision,authority.revision+1);assert.deepEqual(s.graph().attempts[0],expectedAttempt);assert.deepEqual(s.source(),before.source);
  assert.deepEqual(after.source,state.source);assert.deepEqual(after.retained,state.retained);assert.equal(after.history.commands.length,state.history.commands.length+1);
  assert.deepEqual(after.history.commands.slice(0,state.history.commands.length),state.history.commands);assert.deepEqual(after.graph.ownedRecords,state.graph.ownedRecords);assert.deepEqual(after.graph.removals,state.graph.removals);
  assert.deepEqual(after.history.usedTodoIds,state.history.usedTodoIds);
 });
}
test('ABC-AUDIT-01 P2 invalid quantity cannot touch existing metadata, UUIDs, authority or durable reservations',async()=>{
 const {store,s,id}=await p2ContributionFixture('拒否された数量入力の後にも保持する根拠');
 const before=structuredClone(s.view()),authority=store.snapshot();let calls=0;const original=crypto.randomUUID;
 crypto.randomUUID=function(){calls++;return original.call(crypto);};
 try{
  for(const raw of ['{}','null','[]','{"value":"2"}','{"value":-1}','{"value":-0}','{"value":1e309}','{"value":9007199254740992}','{"value":2,"value":0}','{"value":2,"note":null}','{"value":2,"source":"learner"}']){
   assert.throws(()=>s.recordContribution(id,raw));assert.deepEqual(s.view(),before);assert.deepEqual(store.snapshot(),authority);
  }
  assert.throws(()=>s.recordContribution('forged','{"value":2}'));assert.equal(calls,0);
 }finally{crypto.randomUUID=original;}
 await save(s);await s.load();assert.deepEqual(store.snapshot().issuedIds,authority.issuedIds);assert.deepEqual(s.graph(),before.graph);assert.deepEqual(s.source(),before.source);
});
