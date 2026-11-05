import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createPlannerAttemptSession } from '../src/planner/attempts/production/session.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
const locks={request:async(_n,_o,run)=>run()};
const placement='hosei:cp:13f6e301-6356-4670-a2cc-e285d49d343e';
const input=JSON.stringify({plannedYear:2033,method:'media',status:'planned'});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function memory(){let state=emptyAuthority();return {
 fail:false,readGate:null,commitGate:null,reads:0,writes:0,
 snapshot:()=>structuredClone(state),
 async read(){this.reads++;if(this.readGate){this.readGate.entered.resolve();await this.readGate.release.promise;}if(this.fail)throw Error('read_failure');return structuredClone(state);},
 async commit(expected,next){if(this.commitGate){this.commitGate.entered.resolve();await this.commitGate.release.promise;}assert.deepEqual(state,expected,'CAS');state=structuredClone(next);this.writes++;},
};}
const gate=()=>({entered:deferred(),release:deferred()});
const save=async api=>api.save(await api.prepareSave(),true);
async function setup(){const store=memory(),api=createPlannerAttemptSession(store,locks);await api.load();await save(api);return {api,store};}
const summary=s=>({revision:s.revision,rawSha256:createHash('sha256').update(s.raw??'').digest('hex'),issuedIds:s.issuedIds,committed:s.committed});
const evidence=[];
process.on('exit',()=>{if(process.env.P2_EVIDENCE){mkdirSync(process.env.P2_EVIDENCE,{recursive:true});writeFileSync(process.env.P2_EVIDENCE+'/authority-comparisons.json',JSON.stringify(evidence,null,2));}});
test('P2 audit reproduction: failed load revokes old preview and all new editing/save preparation',async()=>{
 const {api,store}=await setup();api.add(placement,input);const p=await api.prepareSave(),before=store.snapshot();assert.equal(before.revision,1);
 store.fail=true;await assert.rejects(api.load(),/read_failure/);store.fail=false;
 await assert.rejects(api.save(p,true),/stale_preview|requires_reload/);
 assert.throws(()=>api.add(placement,input),/session_not_editable/);
 const reads=store.reads;await assert.rejects(api.prepareSave(),/requires_reload/);await assert.rejects(api.prepareMigration('{}'),/requires_reload/);assert.equal(store.reads,reads);
 assert.deepEqual(store.snapshot(),before);evidence.push({case:'audit-reproduction',before:summary(before),after:summary(store.snapshot()),writes:store.writes});
});
test('P2 recovery: only successful reload reissues authority; prior preview never revives and burned IDs survive',async()=>{
 const {api,store}=await setup();const a=api.add(placement,input).attempts[0],old=await api.prepareSave();store.fail=true;await assert.rejects(api.load());store.fail=false;
 await api.load();await assert.rejects(api.save(old,true),/stale_preview/);const next=await api.prepareSave();assert.ok(next.generation>old.generation);await api.save(next,true);
 await assert.rejects(api.save(old,true),/stale_preview/);assert.ok(store.snapshot().issuedIds.includes(a.id));assert.ok(store.snapshot().issuedIds.includes(a.creationOperationId));assert.deepEqual(api.graph().attempts,[]);
 evidence.push({case:'recovery',after:summary(store.snapshot()),oldGeneration:old.generation,newGeneration:next.generation});
});
test('P2 successful load: old preview revoked, only newly prepared preview commits',async()=>{
 const {api,store}=await setup();api.add(placement,input);const old=await api.prepareSave(),before=store.snapshot();await api.load();await assert.rejects(api.save(old,true),/stale_preview/);assert.deepEqual(store.snapshot(),before);await save(api);assert.equal(store.snapshot().revision,2);
});
test('P2 ordering: accepted load blocks preview/commit; already accepted commit precedes rejected load; accepted preparation precedes rejected load',async()=>{
 const {api,store}=await setup();api.add(placement,input);const old=await api.prepareSave(),before=store.snapshot();store.readGate=gate();store.fail=true;
 const loading=api.load();await store.readGate.entered.promise;
 await assert.rejects(api.prepareSave(),/operation_pending/);await assert.rejects(api.save(old,true),/operation_pending/);assert.throws(()=>api.add(placement,input),/session_not_editable/);
 store.readGate.release.resolve();await assert.rejects(loading,/read_failure/);store.readGate=null;store.fail=false;await assert.rejects(api.save(old,true),/stale_preview/);assert.deepEqual(store.snapshot(),before);
 await api.load();const fresh=await api.prepareSave();store.commitGate=gate();const saving=api.save(fresh,true);await store.commitGate.entered.promise;
 await assert.rejects(api.load(),/operation_pending/);await assert.rejects(api.prepareSave(),/operation_pending/);store.commitGate.release.resolve();await saving;store.commitGate=null;assert.equal(store.snapshot().revision,2);
 const blank=memory(),other=createPlannerAttemptSession(blank,locks);blank.readGate=gate();const preparing=other.prepareSave();await blank.readGate.entered.promise;
 await assert.rejects(other.load(),/operation_pending/);await assert.rejects(other.save(old,true),/operation_pending/);blank.readGate.release.resolve();const prepared=await preparing;blank.readGate=null;await other.save(prepared,true);assert.equal(blank.snapshot().revision,1);
 evidence.push({case:'ordering',acceptedSaveRevision:store.snapshot().revision,acceptedPreparationRevision:blank.snapshot().revision});
});
