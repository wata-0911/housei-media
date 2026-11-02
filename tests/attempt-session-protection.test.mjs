import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSynchronousAttemptSession } from '../src/planner/attempts/persistence/syncSession.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { backupDigest } from '../src/planner/backup/plannerBackupCompatibility.ts';
import { replayState } from '../src/planner/attempts/persistence/codec.ts';
const state=(await createSynchronousAttemptSession({read:async()=>emptyAuthority(),commit:async()=>{throw Error('write');}},undefined).prepareNewPlan()).handle.state;
const base={raw:JSON.stringify(state),revision:1,committed:[await backupDigest(state)],issuedIds:(await replayState(state)).requiredReservations};
const sha=raw=>raw===null?null:createHash('sha256').update(raw,'utf8').digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tail='f0310000-0000-4000-8000-000000000001';
for(const [label,raw] of [['normal',base.raw],['F03 broken JSON',' \n{ broken 原文 😀\r\n'],['unsupported schema','{"schemaVersion":999}'],['null',null]]) {
  test(`${label}: protection keeps exact raw and digest with no writes, IDs or qualifications`,async()=>{
    const record={...structuredClone(base),raw},before=structuredClone(record);let writes=0;
    const api=createSynchronousAttemptSession({read:async()=>record,commit:async()=>{writes++;}},undefined);
    const random=crypto.randomUUID;crypto.randomUUID=()=>{throw Error('unexpected ID issuance');};
    let protection;
    try {protection=JSON.parse(await api.protectCurrent());} finally {crypto.randomUUID=random;}
    assert.deepEqual(protection,{format:'hosei-yi06-protection',protectionVersion:1,currentRaw:raw,sha256:sha(raw)});
    assert.deepEqual(record,before);assert.equal(writes,0);
    assert.throws(()=>api.identities(protection),/unverified_identity_handle/);
    await assert.rejects(api.inspectBackup(JSON.stringify(protection)),/backup_shape/);
    if(label!=='normal') await assert.rejects(api.load());
    assert.deepEqual(record,before);assert.equal(writes,0);
  });
}
for(const raw of [123,{},undefined]) test(`nonstring raw ${String(raw)} is refused`,async()=>{
  const api=createSynchronousAttemptSession({read:async()=>({...base,raw}),commit:async()=>{throw Error('write');}},undefined);
  await assert.rejects(api.protectCurrent(),/unreadable_original/);
});
test('read failure propagates unchanged',async()=>{
  const failure=Error('storage unavailable');const api=createSynchronousAttemptSession({read:async()=>{throw failure;},commit:async()=>{throw Error('write');}},undefined);
  await assert.rejects(api.protectCurrent(),e=>e===failure);
});
test('protecting a false checkpoint confers no load, prepare or commit qualification',async()=>{
  const record={...base,committed:['0'.repeat(64)]},before=structuredClone(record);let writes=0;
  const api=createSynchronousAttemptSession({read:async()=>record,commit:async()=>{writes++;}},undefined);
  const raw=await api.protectCurrent();await assert.rejects(api.load());await assert.rejects(api.prepareNewPlan());
  await assert.rejects(api.commit(JSON.parse(raw),true,null,''),/explicit_confirmation_required/);
  assert.deepEqual(record,before);assert.equal(writes,0);
});
for(const order of [[0,1],[1,0]]) test(`protection/load completion ${order.join('→')} cannot change host union or strict validation`,async()=>{
  const gates=[deferred(),deferred()];let reads=0,writes=0;
  const host={...base,issuedIds:[...base.issuedIds,'hosei:owned:'+tail]};
  const api=createSynchronousAttemptSession({read:()=>gates[reads++].promise,commit:async()=>{writes++;}},undefined);
  const protection=api.protectCurrent(),load=api.load();
  for(const i of order)gates[i].resolve(i===0?{raw:'broken recovery bytes',issuedIds:[]}:host);
  assert.equal(JSON.parse(await protection).currentRaw,'broken recovery bytes');const h=await load;
  const random=crypto.randomUUID;let fresh=1;
  try {const ids=api.identities(h);for(const mint of [ids.newAssessmentId,ids.newTodoId,ids.newRecordId,ids.newOperationId,()=>ids.newAttemptIds().id]) {
    const next=()=>`f0310000-0000-4000-8000-${String(++fresh).padStart(12,'0')}`;const tape=[tail,next()];crypto.randomUUID=()=>tape.shift()??next();assert.notEqual(mint().split(':').at(-1),tail);
  }}finally{crypto.randomUUID=random;}
  assert.equal(writes,0);
});
test('protection during decoder await neither disables strict reads nor poisons a valid handle',async()=>{
  const gate=deferred(),entered=deferred();let reads=0,first=true,writes=0;
  const host={...base,issuedIds:[...base.issuedIds,'hosei:owned:'+tail]};
  const api=createSynchronousAttemptSession({read:async()=>++reads===1?host:{...base,raw:'{ invalid'},commit:async()=>{writes++;}},undefined);
  const digest=crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest=async(...args)=>{if(first){first=false;entered.resolve();await gate.promise;}return digest(...args);};
  let h;
  try {const loaded=api.load();await entered.promise;
    assert.equal(JSON.parse(await api.protectCurrent()).currentRaw,'{ invalid');await assert.rejects(api.load());gate.resolve();h=await loaded;
  }finally{gate.resolve();crypto.subtle.digest=digest;}
  // prepareEdits validates the original qualified handle; no new read/qualification.
  assert.deepEqual((await api.prepareEdits(h,[])).handle.state,state);
  const ids=api.identities(h);
  const next=api.dispatch(h,h.workspace,{kind:'add_record',operationId:ids.newOperationId(),record:{id:ids.newRecordId(),kind:'todo',owner:null,payload:{id:ids.newTodoId(),text:'continue',done:false}}});
  assert.equal(next.receipts.length,1);
  assert.throws(()=>api.identities(structuredClone(h)),/unverified_identity_handle/);assert.equal(writes,0);
});
