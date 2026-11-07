import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerAttemptSession } from '../src/planner/attempts/production/session.ts';
import { isAuthorityJsonTree } from '../src/planner/attempts/persistence/authorityData.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { initialState, env, snapshot, originalRow } from './fixtures/migration-fixture.mjs';

const locks={request:async(_n,_o,fn)=>fn()};
function setup(primary=JSON.stringify(initialState())) {
 let record=emptyAuthority(),puts=0;const legacy={primaryRaw:primary,recoveryRaw:primary===null?null:'distinct short recovery'};
 const store={read:async()=>structuredClone(record),commit:async(e,n,beforePut)=>{assert.deepEqual(e,record);beforePut?.();record=structuredClone(n);puts++;}};
 const session=()=>createPlannerAttemptSession(store,locks,{readLegacy:()=>({...legacy}),migrationEnvironment:async()=>env});
 return{session,legacy,store,get:()=>structuredClone(record),puts:()=>puts};
}
for(const [label,size,pad] of [['8MiB',8388608,' '],['16MiB-1',16777215,' '],['16MiB',16777216,' '],['16MiB+1',16777217,' '],['tabs',11000000,'\t']])test(`R3 serialized loadability ${label} rejects before put`,async()=>{
 const x=setup(),s=x.session(),before=x.get(),legacy=structuredClone(x.legacy),raw=x.legacy.primaryRaw.padStart(size,pad);await s.load();let error;
 try{const p=await s.prepareMigration(raw);await s.save(p,true);}catch(e){error=String(e);}
 let freshLoad;try{await x.session().load();freshLoad='OK';}catch(e){freshLoad=String(e);}
 console.log(JSON.stringify({label,size,error,puts:x.puts(),recordBytes:Buffer.byteLength(JSON.stringify(x.get())),freshLoad,legacyUnchanged:JSON.stringify(x.legacy)===JSON.stringify(legacy)}));
 assert.equal(x.puts(),0);assert.match(error,/unreadable|input_limit|capacity_limit/);assert.deepEqual(x.get(),before);assert.deepEqual(x.legacy,legacy);assert.equal(freshLoad,'OK');
});
for(const kind of ['compact','japanese','standard-v2'])test(`R3 accepted ${kind} saves, new session loads, backs up and restores`,async()=>{
 const state=initialState();if(kind!=='compact')state.importedCourseAchievements=[4,0,null].map((credits,i)=>originalRow({id:'raw-'+i,fingerprint:'fp-'+i,earnedCreditsTotal:credits,categoryRaw:'日本語😀\uFFFD\uFEFF literal 4.0000000000000001'}));
 const primary=JSON.stringify(state),raw=kind==='standard-v2'?JSON.stringify({format:'hosei-planner-backup',backupVersion:2,createdAt:'2026-11-06T00:00:00.000Z',catalog:snapshot,state},null,2):primary;
 const x=setup(primary),s=x.session();await s.load();await s.save(await s.prepareMigration(raw),true);assert.equal(x.puts(),1);const committed=x.get();assert.equal(JSON.parse(committed.raw).source.raw,raw);
 const fresh=x.session();await fresh.load();const backup=await fresh.createBackup();assert.equal(JSON.parse(backup).state.source.raw,raw);await fresh.save(await fresh.prepareRestore(backup),true);assert.equal(x.puts(),2);assert.equal(JSON.parse(x.get().raw).source.raw,raw);assert.deepEqual(x.get().issuedIds,committed.issuedIds);assert.equal(x.legacy.primaryRaw,primary);assert.equal(x.legacy.recoveryRaw,'distinct short recovery');
});
test('R3 empty24 saves exact immutable candidate and new session loads/backs up',async()=>{
 const x=setup(null);let candidate;const commit=x.store.commit;x.store.commit=async(e,n,before)=>{candidate=n;assert.ok(Object.isFrozen(n));assert.ok(Object.isFrozen(n.issuedIds));assert.equal(Reflect.set(n,'raw','unverified mutation'),false);assert.throws(()=>n.issuedIds.push('late reservation'));return commit(e,n,before);};const s=x.session();await s.load();await s.save(await s.prepareSave(),true);assert.equal(candidate.raw,x.get().raw);const fresh=x.session();await fresh.load();assert.equal(JSON.parse(await fresh.createBackup()).state.schemaVersion,24);
});
for(const depth of [8,12,16])test(`R3 DAG ${depth+1} objects rejects with linear ownKeys`,()=>{
 let v={n:1};for(let i=0;i<depth;i++)v={l:v,r:v};let calls=0;const ownKeys=Reflect.ownKeys;Reflect.ownKeys=function(...a){calls++;return ownKeys(...a);};let result;try{result=isAuthorityJsonTree(v);}finally{Reflect.ownKeys=ownKeys;}
 console.log(JSON.stringify({objects:depth+1,ownKeys:calls,result}));assert.equal(result,false);assert.ok(calls<=4*(depth+1),String(calls));assert.equal(v.l,v.r);
});
let getterCalls=0;
for(const [name,make] of [
 ['getter',()=>{const v={};Object.defineProperty(v,'x',{enumerable:true,get(){getterCalls++;return 1;}});return v;}],
 ['cycle',()=>{const v={};v.x=v;return v;}],['map',()=>new Map()],['date',()=>new Date()],['nan',()=>({x:NaN})],['negative-zero',()=>({x:-0})],['undefined',()=>({x:undefined})],
 ['hidden',()=>Object.defineProperty({},'x',{value:1})],['symbol',()=>({[Symbol('x')]:1})],['sparse',()=>Array(1)],['array-attribute',()=>Object.assign([],{side:1})],['shared-array',()=>{const a=[];return{a,b:a};}],
])test(`R3 JSON diagnostics rejects ${name} without invoking accessors`,()=>{assert.equal(isAuthorityJsonTree(make()),false);if(name==='getter')assert.equal(getterCalls,0);});
test('R3 JSON tree valid plain data and historical top-level undefined remain valid',()=>{assert.equal(isAuthorityJsonTree({a:[null,4,'あ😀',false],b:{c:1}}),true);assert.equal(isAuthorityJsonTree(undefined),true);});
