import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlannerAttemptSession} from '../src/planner/attempts/production/session.ts';
import {createAcController,admissionProblem} from '../src/planner/attempts/production/acController.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {loadCurrentCurriculumSearchAdapter} from '../src/planner/institutional/currentSearch.ts';
const locks={request:async(_n,_o,fn)=>fn()},placement='hosei:cp:b99c65d5-5917-422d-bda4-75a4f99ad8b7';
const input=JSON.stringify({plannedYear:2033,method:'correspondence',status:'planned'});
function memory(){let state=emptyAuthority(),failure='';return{read:async()=>{if(failure==='read')throw Error('read_failed');return structuredClone(state);},snapshot:()=>structuredClone(state),fail:v=>failure=v,commit:async(expected,next)=>{assert.deepEqual(expected,state,'stale_commit');if(failure==='quota')throw Error('quota');state=structuredClone(next);if(failure==='unknown')throw Error('response_unknown');}};}
const save=async api=>api.save(await api.prepareSave(),true);
for(const failure of ['quota','unknown'])test(`save ${failure}: consumes all proposals, blocks retries, reload reconciles without duplicate add`,async()=>{
 const store=memory(),api=createPlannerAttemptSession(store,locks);await api.load();await save(api);api.add(placement,input);
 const before=store.snapshot(),p=await api.prepareSave(),sibling=await api.prepareSave();store.fail(failure);await assert.rejects(api.save(p,true),new RegExp(failure==='quota'?'quota':'response_unknown'));
 const after=store.snapshot();if(failure==='quota')assert.deepEqual(after,before);else assert.equal(after.revision,before.revision+1);
 store.fail('');await assert.rejects(api.save(p,true),/stale_preview/);await assert.rejects(api.save(sibling,true),/stale_preview/);assert.throws(()=>api.add(placement,input),/not_editable/);await assert.rejects(api.prepareSave(),/requires_reload/);
 const graph=await api.load();assert.equal(graph.attempts.length,failure==='quota'?0:1);await assert.rejects(api.save(p,true),/stale_preview/);assert.deepEqual(store.snapshot(),after);
});
test('controller failure state, no false saved UI, failed load keeps display but blocks edits',async()=>{
 const store=memory(),session=createPlannerAttemptSession(store,locks),c=createAcController(session);await c.load();await c.prepare();await c.save(c.getSnapshot().proposal,true);
 assert.equal(c.add(placement,input),true);const draft=c.getSnapshot().graph;await c.prepare();const p=c.getSnapshot().proposal;store.fail('unknown');assert.equal(await c.save(p,true),false);assert.equal(c.getSnapshot().ready,false);assert.equal(c.getSnapshot().proposal,null);assert.doesNotMatch(c.getSnapshot().notice,/保存済み/);assert.equal(c.add(placement,input),false);
 store.fail('read');await c.load();assert.equal(c.getSnapshot().graph,draft);assert.equal(c.getSnapshot().ready,false);store.fail('');await c.load();assert.equal(c.getSnapshot().graph.attempts.length,1);assert.equal(c.getSnapshot().dirty,false);
});
test('admission evaluates all 502 placements, unresolved and non-course stay unavailable; required methods enforced',()=>{
 const rows=loadCurrentCurriculumSearchAdapter().search({scope:{kind:'all'}}).rows;assert.equal(rows.length,502);let blocked=0,constrained=0;
 for(const row of rows){const p=row.placement,problem=admissionProblem(row);if(p.kind!=='course_placement'||p.identityDecision.status!=='safe')assert.ok(problem,p.id);if(problem)blocked++;
 if(!problem&&p.methodConstraint.requiredMethod){constrained++;assert.equal(admissionProblem(row,p.methodConstraint.requiredMethod),'');assert.ok(admissionProblem(row,'incompatible'));}}
 assert.ok(blocked>=229);assert.ok(constrained>0);
});
test('controller re-reads selection; forged/non-course/unresolved/mismatched method cannot append an attempt',async()=>{
 const store=memory(),session=createPlannerAttemptSession(store,locks),c=createAcController(session);await c.load();await c.prepare();await c.save(c.getSnapshot().proposal,true);
 const rows=loadCurrentCurriculumSearchAdapter().search({scope:{kind:'all'}}).rows;
 for(const row of rows.filter(r=>r.placement.kind!=='course_placement'||r.placement.identityDecision.status!=='safe').slice(0,10))assert.equal(c.add(row.placement.id,input),false);
 const constrained=rows.find(r=>!admissionProblem(r)&&r.placement.methodConstraint.requiredMethod);assert.equal(c.add(constrained.placement.id,JSON.stringify({plannedYear:null,method:'unknown',status:'planned'})),false);
 assert.equal(c.add('forged-placement',input),false);assert.equal(c.getSnapshot().graph.attempts.length,0);
});

test('multiple same-kind progress records are held without choosing or changing an owner',async()=>{
 const id='existing-attempt';let calls=0;
 const graph={attempts:[],removals:[],ownedRecords:[1,2].map(n=>({id:String(n),kind:'correspondence',owner:{kind:'attempt',attemptId:id},payload:{requiredReports:n,reports:[],examGrade:null}}))};
 const before=structuredClone(graph),c=createAcController({load:async()=>graph,progress(){calls++;throw Error('must not dispatch');},protectCurrent:async()=>''});
 await c.load();assert.equal(c.progress(id,'{}'),false);assert.equal(calls,0);assert.deepEqual(graph,before);assert.match(c.getSnapshot().error,/同種進捗/);
});

for (const mode of ['read_failure', 'intervening_commit']) test(`newdev pinned controller: post-commit ${mode} holds the session and preserves durable burns`,async()=>{
 let state=emptyAuthority(),afterCommit=false,fault=false;
 const store={read:async()=>{if(afterCommit&&fault){afterCommit=false;if(mode==='read_failure')throw Error('post_commit_read_failure');const other=createPlannerAttemptSession({read:async()=>structuredClone(state),commit:async(expected,next)=>{assert.deepEqual(expected,state);state=structuredClone(next);}},locks);await other.load();other.add(placement,input);await save(other);}return structuredClone(state);},commit:async(expected,next)=>{assert.deepEqual(expected,state);state=structuredClone(next);afterCommit=true;}};
 const api=createPlannerAttemptSession(store,locks);await api.load();await save(api);api.add(placement,input);const proposal=await api.prepareSave();fault=true;
 await assert.rejects(api.save(proposal,true),new RegExp(mode==='read_failure'?'post_commit_read_failure':'save_readback_conflict'));
 const durable=structuredClone(state);assert.ok(durable.revision>=2);assert.equal(JSON.parse(durable.raw).graph.attempts.length,mode==='read_failure'?1:2);
 assert.throws(()=>api.add(placement,input),/not_editable/);await assert.rejects(api.prepareSave(),/requires_reload/);await assert.rejects(api.save(proposal,true),/stale_preview/);
 fault=false;await api.load();assert.deepEqual(state,durable);assert.equal(api.graph().attempts.length,mode==='read_failure'?1:2);
});

test('AC-AUDIT-01 verifier snapshot is the sole readback; concurrent protection cannot substitute a read',async()=>{
 let state=emptyAuthority(),armed=false,after=false,reads=0,release,entered;
 const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const store={read:async()=>{const value=structuredClone(state);if(armed&&after){reads++;entered();await gate;}return value;},commit:async(e,n)=>{assert.deepEqual(e,state);state=structuredClone(n);after=true;}};
 const api=createPlannerAttemptSession(store,locks);await api.load();await save(api);api.add(placement,input);const p=await api.prepareSave();armed=true;
 const saving=api.save(p,true);await started;await assert.rejects(api.protectCurrent(),/operation_pending/);release();await saving;assert.equal(reads,1);assert.equal(api.graph().attempts.length,1);
});
