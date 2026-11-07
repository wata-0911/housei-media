import test from 'node:test';
import assert from 'node:assert/strict';
import {requireReservations} from '../src/planner/attempts/persistence/identity.ts';
import {createAttemptPersistence} from '../src/planner/attempts/persistence/controller.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {backupDigest} from '../src/planner/digest.ts';
import {applyCommand,newOperationId} from '../src/planner/attempts/workbench/operations.ts';
import {makeAttempt} from '../src/planner/attempts/workbench/catalogView.ts';
import {env,mixed,media} from './fixtures/migration-fixture.mjs';
const uuid=n=>n.toString(16).padStart(8,'0')+'-aaab-4aaa-8aab-000000000000';
// Counts real native calls, delegates unchanged; candidate positions are not CPU instructions.
async function measure(run,minimum=1000){
 const includes=Array.prototype.includes,has=Set.prototype.has;let calls=0,positions=0,lookups=0;const maps=new WeakMap();
 Array.prototype.includes=function(value,...args){if(this.length>=minimum&&typeof value==='string'&&!args.length){let map=maps.get(this);if(!map){map=new Map(this.map((id,i)=>[id,i]));maps.set(this,map);}calls++;positions+=map.has(value)?map.get(value)+1:this.length;}return includes.call(this,value,...args);};
 Set.prototype.has=function(value){lookups++;return has.call(this,value);};
 try{await run();}finally{Array.prototype.includes=includes;Set.prototype.has=has;}
 return{calls,positions,lookups};
}
for(const n of [1000,2000,4000])test(`R6 real requireReservations linear membership ${n}`,async()=>{
 const ids=Array.from({length:n},(_,i)=>uuid(i+1)),before=structuredClone(ids);
 const counts=await measure(()=>requireReservations(ids,ids));console.log(JSON.stringify({kind:'r6-required',n,...counts}));
 assert.deepEqual(ids,before);assert.equal(counts.calls,0);assert.equal(counts.lookups,n);
});
for(const order of ['forward','reverse','partial'])test(`R6 exact membership preserves ${order} order`,()=>{
 const ids=Array.from({length:1000},(_,i)=>uuid(i+1)),required=order==='reverse'?[...ids].reverse():order==='partial'?ids.slice(200,600):[...ids];
 const before=JSON.stringify({ids,required});requireReservations(ids,required);assert.equal(JSON.stringify({ids,required}),before);
});
for(const bad of ['missing','alias','duplicate','invalid'])test(`R6 membership retains ${bad} rejection`,()=>{
 const ids=[uuid(1),uuid(2)];let required=[uuid(1)];
 if(bad==='missing')required=[uuid(3)];if(bad==='alias')required=['hosei:owned:'+uuid(1)];if(bad==='duplicate')ids.push(uuid(1));if(bad==='invalid')ids[0]='bad';
 const before=JSON.stringify({ids,required});assert.throws(()=>requireReservations(ids,required),bad==='missing'?/backup_reservations_missing/:/reservation_uuid_collision_or_shape/);assert.equal(JSON.stringify({ids,required}),before);
});
test('R6 same-host known checkpoint uses indexes and preserves permanent ordered reservations',async()=>{
 let record=emptyAuthority(),puts=0;const locks={request:async(_n,_o,fn)=>fn()},store={read:async()=>structuredClone(record),commit:async(expected,next)=>{assert.deepEqual(expected,record);record=structuredClone(next);puts++;}};
 const api=createAttemptPersistence(store,locks),first=await api.prepareNewPlan();await api.commit(first,true,first.previousRaw,first.sourceRaw);
 const body=JSON.parse(await api.createBackup(await api.load()));delete body.sha256;
 for(let i=1;body.reservedIds.length<4000;i++)body.reservedIds.push(uuid(i));
 let raw=JSON.stringify({...body,sha256:await backupDigest(body)}),preview=await api.inspectBackup(raw);
 await api.commit(preview,true,preview.previousRaw,preview.sourceRaw,{acceptedBackupRawSha256:preview.recovery.rawSha256,protectedBackupRaw:preview.recovery.raw});
 raw=await api.createBackup(await api.load());const before=structuredClone(record);puts=0;
 const counts=await measure(async()=>{preview=await api.inspectBackup(raw);});
 console.log(JSON.stringify({kind:'r6-controller',n:4000,...counts}));
 assert.equal(counts.calls,0);assert.equal(puts,0);assert.equal(preview.recovery.portable,false);assert.deepEqual(record,before);
 await api.commit(preview,true,preview.previousRaw,preview.sourceRaw);assert.equal(puts,1);assert.deepEqual(record.issuedIds,before.issuedIds);assert.equal(record.raw,before.raw);
 const fresh=createAttemptPersistence(store,locks);assert.deepEqual(JSON.parse(await fresh.createBackup(await fresh.load())).reservedIds,before.issuedIds);
});
async function countNestedSome(pattern,run){const some=Array.prototype.some;let calls=0;Array.prototype.some=function(fn,...args){if(pattern.test(fn.toString()))calls++;return some.call(this,fn,...args);};try{await run();}finally{Array.prototype.some=some;}return calls;}
test('R6 Undo cross-history membership keeps LIFO, snapshots and order',async()=>{
 const api=createAttemptPersistence({read:async()=>emptyAuthority()},undefined),p=await api.prepareNewPlan(),context=p.handle.source.context;
 let workspace=p.handle.workspace;const attempts=[];
 for(let i=0;i<3;i++){const attempt=makeAttempt(context.catalog,{title:'履歴'+i,courseId:null,placementId:null,plan:{plannedYear:null,plannedTerm:null,studyYear:null,status:'planned',earnedOrder:null},method:'unknown',note:''});attempts.push(attempt);workspace=applyCommand(workspace,{kind:'add',operationId:attempt.creationOperationId,attempt},context);}
 for(const attempt of attempts)workspace=applyCommand(workspace,{kind:'remove',operationId:newOperationId(),attemptId:attempt.id},context);
 const before=JSON.stringify(workspace),wrong=workspace.graph.removals[0];assert.throws(()=>applyCommand(workspace,{kind:'undo',operationId:newOperationId(),attemptId:wrong.attemptSnapshot.id,removalOperationId:wrong.operationId},context),/undo_order_conflict/);assert.equal(JSON.stringify(workspace),before);
 const calls=await countNestedSome(/t\.operationId\s*===\s*r\.operationId/,()=>{while(workspace.graph.removals.length){const ticket=workspace.graph.removals.at(-1);workspace=applyCommand(workspace,{kind:'undo',operationId:newOperationId(),attemptId:ticket.attemptSnapshot.id,removalOperationId:ticket.operationId},context);}});
 assert.deepEqual(workspace.graph.attempts,attempts);console.log(JSON.stringify({kind:'r6-undo',nestedMembershipCalls:calls}));assert.equal(calls,0);
});
test('R6 correction history membership preserves original tables and source',async()=>{
 const state=mixed();state.mediaSchoolingProgress[media.id].assessments[0].scheduledDate='2027-02-30';let record=emptyAuthority(),puts=0;
 const store={read:async()=>structuredClone(record),commit:async(expected,next)=>{assert.deepEqual(record,expected);record=structuredClone(next);puts++;}},locks={request:async(_n,_o,fn)=>fn()},api=createAttemptPersistence(store,locks,env),raw=JSON.stringify(state);
 const session=await api.inspectLegacy(raw);
 // The fixture's exact assessment ID is retained, including slash/tilde characters.
 const actualId=state.mediaSchoolingProgress[media.id].assessments[0].id,corrected=await api.confirmDate(session,await api.proposeDate(session,media.id,actualId,null),true),preview=await api.prepareMigration(corrected);
 await api.commit(preview,true,preview.previousRaw,preview.sourceRaw);puts=0;
 const calls=await countNestedSome(/nextTable\.reservedIds\.includes/,async()=>{const loaded=await api.load();assert.equal(loaded.state.corrections[0].originalRaw,raw);assert.deepEqual(loaded.state.corrections[0].originalAssignments,session.table);assert.ok(await api.createBackup(loaded));});
 assert.equal(puts,0);console.log(JSON.stringify({kind:'r6-correction',nestedMembershipCalls:calls}));assert.equal(calls,0);
});
