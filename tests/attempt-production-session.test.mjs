import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlannerAttemptSession,protectLegacyPlannerRaw} from '../src/planner/attempts/production/session.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {catalog} from '../src/planner/catalog/catalog.ts';
const placement='hosei:cp:13f6e301-6356-4670-a2cc-e285d49d343e';
const input=JSON.stringify({plannedYear:2033,method:'media',status:'in_progress'});
const locks={request:async(_n,_o,run)=>run()};
function memory(){let state=emptyAuthority(),failure=false;return{read:async()=>structuredClone(state),snapshot:()=>structuredClone(state),fail:v=>{failure=v;},commit:async(expected,next)=>{if(failure)throw Error('quota');assert.deepEqual(expected,state,'stale_commit');state=structuredClone(next);}};}
async function save(api){const p=await api.prepareSave();return api.save(p,true);}
test('Offering-free stable identity, complete reload, owner preservation and Undo',async()=>{
 const store=memory(),api=createPlannerAttemptSession(store,locks);await api.load();await save(api);
 assert.equal(catalog.offerings.some(o=>o.name.normalize('NFKC')==='ビジネス英語A'),false);
 const a=api.add(placement,input).attempts[0];assert.equal(a.identity.ref.institutionalCourseId,'curriculum:ddfc79b8-6c32-412d-963c-342ff62a01f9');assert.equal(a.plan.plannedYear,2033);assert.equal(a.applicability.status,'unknown');assert.equal(a.placement.status,'unknown');
 api.progress(a.id,'correspondence',JSON.stringify({requiredReports:0,reports:[],examGrade:null}));await save(api);
 const before=api.graph();const reopened=createPlannerAttemptSession(store,locks);assert.deepEqual(await reopened.load(),before);
 reopened.remove(a.id);await save(reopened);const deleted=createPlannerAttemptSession(store,locks);await deleted.load();assert.equal(deleted.graph().attempts[0].membership.kind,'detached');deleted.undo(a.id);await save(deleted);assert.deepEqual(deleted.graph(),before);
 const state=JSON.parse(store.snapshot().raw);assert.equal(state.schemaVersion,24);assert.equal(state.rule.version,1);assert.equal(state.retained.graduationCheckComplete,false);assert.equal(state.retained.graduationEvaluation,'not_evaluated');
});
test('primitive boundary rejects objects without getters; invalid edits, copied/stale preview, quota and competing session preserve saved authority',async()=>{
 const store=memory(),api=createPlannerAttemptSession(store,locks);await api.load();await save(api);const a=api.add(placement,input).attempts[0];await save(api);const original=store.snapshot();let getters=0;
 assert.throws(()=>api.update(a.id,{get plannedYear(){getters++;return 2034;}}),/input_limit/);assert.equal(getters,0);assert.throws(()=>api.remove({get id(){getters++;}}),/primitive_id/);assert.equal(getters,0);
 assert.throws(()=>api.update(a.id,'{"plannedYear":1,"plannedYear":2}'),/Duplicate/);
 assert.throws(()=>api.update(a.id,'{"plannedYear":2034,"method":"invalid","status":"planned"}'));assert.deepEqual(store.snapshot(),original);
 const p=await api.prepareSave();await assert.rejects(api.save({...p},true),/stale_preview/);
 api.update(a.id,input);await assert.rejects(api.save(p,true),/stale_preview/);
 const other=createPlannerAttemptSession(store,locks);await other.load();await save(other);await assert.rejects(save(api),/stale_commit/);
 await api.load();api.update(a.id,input);store.fail(true);await assert.rejects(save(api),/quota/);store.fail(false);const after=store.snapshot();await api.load();assert.deepEqual(store.snapshot(),after);
});
test('failed issued IDs stay permanently reserved on next successful save; arbitrary nested IDs are held',async()=>{
 const store=memory(),api=createPlannerAttemptSession(store,locks);await api.load();await save(api);
 const abandoned=api.add(placement,input).attempts[0];await api.load();const a=api.add(placement,input).attempts[0];
 assert.throws(()=>api.progress(a.id,'media',JSON.stringify({totalLessons:null,lessons:[],assessments:[{id:'00000000-0000-4000-8000-000000000001'}]})),/identity_contract/);
 await save(api);assert.ok(store.snapshot().issuedIds.includes(abandoned.id));assert.notEqual(a.id,abandoned.id);const loaded=createPlannerAttemptSession(store,locks);await loaded.load();await save(loaded);
});
test('v22 raw primary/recovery exact byte protection uses no decoder or writes',async()=>{
 const values=[' \n{"schemaVersion":22,"official":"原行"}\r\n','broken recovery \t'];let reads=0;
 const raw=await protectLegacyPlannerRaw({getItem:()=>values[reads++]});const result=JSON.parse(raw);assert.equal(result.primaryRaw,values[0]);assert.equal(result.recoveryRaw,values[1]);assert.equal(reads,2);assert.equal(result.primarySha256.length,64);
});
test('old rule1 nested assessment UUID without host reservation is held without a repair write',async()=>{
 const {createAttemptPersistence}=await import('../src/planner/attempts/persistence/controller.ts');
 const {newOperationId,newRecordId}=await import('../src/planner/attempts/workbench/operations.ts');
 const store=memory(),api=createPlannerAttemptSession(store,locks);await api.load();await save(api);const a=api.add(placement,input).attempts[0];await save(api);
 const old=createAttemptPersistence(store,locks),h=await old.load(),record={id:newRecordId(),kind:'media',owner:{kind:'attempt',attemptId:a.id},payload:{totalLessons:null,lessons:[],assessments:[{id:crypto.randomUUID(),type:'final',label:'old nested',scheduledDate:null,completed:false}]}};
 const p=await old.prepareEdits(h,[{kind:'add_record',operationId:newOperationId(),record}]);await old.commit(p,true,p.previousRaw,p.sourceRaw);
 const before=store.snapshot();await assert.rejects(createPlannerAttemptSession(store,locks).load(),/nested_identity_history/);assert.deepEqual(store.snapshot(),before);
});
