// Focused, synthetic Node comparison. No DB, no network, no production hook.
// Run from repository root: node --import tsx tests/helpers/benchmark-persistent-authority.mjs
import assert from 'node:assert/strict';
import { createSynchronousAttemptSession } from '../../src/planner/attempts/persistence/syncSession.ts';
import { createPersistentAttemptSession } from '../../src/planner/attempts/persistence/persistentSession.ts';
import { emptyAuthority } from '../../src/planner/attempts/persistence/contracts.ts';
import { makeAttempt } from '../../src/planner/attempts/workbench/catalogView.ts';
const locks={request:async(n,o,fn)=>fn()},count=Number(process.env.PR4_PERF_RECEIPTS||8),rounds=3;
assert.ok(Number.isSafeInteger(count)&&count>=0&&count<=100);
function store(){let record=emptyAuthority();return {read:async()=>structuredClone(record),commit:async(e,n)=>{assert.deepEqual(e,record);record=structuredClone(n);}};}
async function build(modern){const db=store(),api=(modern?createPersistentAttemptSession:createSynchronousAttemptSession)(db,locks);
 const save=p=>modern?api.commit(p,{confirmed:true,protectedRaw:p.previousRaw,protectedSourceRaw:p.sourceRaw}):api.commit(p,true,p.previousRaw,p.sourceRaw);
 let h=await save(await api.prepareNewPlan());const identities=api.identities(h),commands=[];let id=0;const original=crypto.randomUUID;crypto.randomUUID=()=>`ed000000-0000-4000-8000-${String(++id).padStart(12,'0')}`;
 try{for(let n=0;n<count;n++){const attempt=makeAttempt(h.source.context.catalog,{title:'synthetic '+n,courseId:null,placementId:null,plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''},identities.newAttemptIds());commands.push({kind:'add',operationId:attempt.creationOperationId,attempt});}}finally{crypto.randomUUID=original;}
 h=await save(await api.prepareEdits(h,commands));return {db,h};
}
const old=await build(false),modern=await build(true),normalized=structuredClone(modern.h.state);normalized.rule.version=1;assert.deepEqual(normalized,old.h.state);
const samples=[];
for(let round=0;round<rounds;round++)for(const version of (round%2?['v2','rule1']:['rule1','v2'])){
 const input=version==='v2'?modern:old,api=(version==='v2'?createPersistentAttemptSession:createSynchronousAttemptSession)(input.db,locks),start=performance.now(),cpu=process.cpuUsage();
 const h=await api.load();assert.deepEqual(h.state,input.h.state);const used=process.cpuUsage(cpu),memory=process.memoryUsage();
 samples.push({round:round+1,version,wallMs:+(performance.now()-start).toFixed(2),cpuMs:+((used.user+used.system)/1000).toFixed(2),heapMiB:+(memory.heapUsed/1048576).toFixed(2),rssMiB:+(memory.rss/1048576).toFixed(2)});
}
console.log(JSON.stringify({node:process.version,platform:process.platform,receipts:count,rounds,samples,limitations:'Synthetic schema24 in-memory reads. CPU is process user+system, heap/RSS are checkpoints, not peaks or retained/leak measurements. Not native IDB or long-session/browser performance.'},null,2));
