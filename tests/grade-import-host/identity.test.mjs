import test from 'node:test';import assert from 'node:assert/strict';
import { HostIdentityOwner } from '../../src/planner/attempts/gradeImportHost/identity.ts';
import { SessionIdentityAllocator } from '../../src/planner/attempts/persistence/sessionIds.ts';
import { reserved } from './fixture.mjs';
test('V07/V08: core fixed namespaces and synchronous burn; fresh owner restricts durable UUID tails',async()=>{
 const v=await reserved(),owner=new HostIdentityOwner(),a=new SessionIdentityAllocator();
 assert.throws(()=>a.mint(new Set(),'hosei:g01b-operation:'),/allocator_role/);
 const old=crypto.randomUUID;let calls=0;
 crypto.randomUUID=()=>{calls++;return v.grant.ids[0].split(':').at(-1);};
 try{assert.throws(()=>owner.mint(v.t1,false),/allocator_exhausted/);assert.equal(calls,128);}finally{crypto.randomUUID=old;}
 const m=owner.mint(v.t1,true);assert.equal(m.ids.length,27);assert.equal(new Set(m.ids.map(x=>x.split(':').at(-1))).size,27);
 assert.throws(()=>owner.verify({},m.ids),{code:'id_ticket'});assert.throws(()=>v.owner.verify(m.ticket,m.ids),{code:'id_ticket'});
 assert.throws(()=>owner.verify(m.ticket,[...m.ids].reverse()),{code:'id_ticket'});assert.throws(()=>owner.verify(m.ticket,[...m.ids,m.ids[0]]),{code:'id_ticket'});
 assert.deepEqual(owner.published(m.ticket,m.ids),m.ids);
});
