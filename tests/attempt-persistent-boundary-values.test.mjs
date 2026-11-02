import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentAttemptSession } from '../src/planner/attempts/persistence/persistentSession.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
const locks={request:async(name,options,fn)=>fn()};
const cases=[
 ['root undefined',r=>{r.extra=undefined;}],
 ['nested undefined',r=>{r.extra={child:undefined};}],
 ['non-enumerable',r=>{Object.defineProperty(r,'extra',{value:1});}],
 ['symbol key',r=>{r[Symbol('extra')]=1;}],
 ['accessor',r=>{Object.defineProperty(r,'extra',{enumerable:true,get(){throw Error('getter invoked');}});}],
 ['custom prototype',r=>Object.setPrototypeOf(r,{})],
 ['NaN',r=>{r.revision=NaN;}],
 ['Infinity',r=>{r.revision=Infinity;}],
 ['invalid Date',r=>{r.extra=new Date(NaN);}],
 ['boxed String',r=>{r.raw=new String('');}],
 ['sparse array',r=>{r.committed=new Array(1);}],
 ['array extra undefined',r=>{r.issuedIds.extra=undefined;}],
 ['nested accessor',r=>{r.extra={get value(){throw Error('getter invoked');}};}],
 ['toJSON function',r=>{r.toJSON=()=>emptyAuthority();}],
];
for(const [name,mutate] of cases)test(`host values: ${name} rejected before clone or serialization`,async()=>{
 const record=emptyAuthority();mutate(record);let writes=0,clones=0;const clone=globalThis.structuredClone;globalThis.structuredClone=(...args)=>{clones++;return clone(...args);};
 try{const api=createPersistentAttemptSession({read:async()=>record,commit:async()=>{writes++;}},locks);await assert.rejects(api.load(),/authority_record_invalid/);await assert.rejects(api.prepareNewPlan(),/authority_record_invalid/);assert.equal(clones,0);assert.equal(writes,0);}finally{globalThis.structuredClone=clone;}
});
test('host values: normal old four-field empty authority remains readable',async()=>{
 const api=createPersistentAttemptSession({read:async()=>emptyAuthority(),commit:async()=>{throw Error('write forbidden');}},locks);assert.equal(await api.load(),null);assert.equal((await api.prepareNewPlan()).handle.state.rule.version,2);
});
for(const nested of [false,true])test(`host closed shape before clone: ${nested?'coverage':'root'} extra null`,async()=>{
 const record=emptyAuthority();if(nested)Object.assign(record,{format:'hosei-attempt-authority',authorityVersion:2,reservationCoverage:{policyVersion:2,kind:'native-v2',baselineStateSha256:null,extra:null}});else record.extra=null;
 let clones=0;const clone=globalThis.structuredClone;globalThis.structuredClone=(...args)=>{clones++;return clone(...args);};
 try{const api=createPersistentAttemptSession({read:async()=>record,commit:async()=>{throw Error('write forbidden');}},locks);await assert.rejects(api.load(),{message:nested?'reservation_coverage_shape':'authority_shape'});assert.equal(clones,0);}finally{globalThis.structuredClone=clone;}
});
