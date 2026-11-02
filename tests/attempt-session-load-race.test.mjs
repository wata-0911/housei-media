import test from 'node:test';
import assert from 'node:assert/strict';
import { createSynchronousAttemptSession } from '../src/planner/attempts/persistence/syncSession.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { backupDigest } from '../src/planner/backup/plannerBackupCompatibility.ts';
import { replayState } from '../src/planner/attempts/persistence/codec.ts';
const uuid = n => `b7110000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const seed = (await createSynchronousAttemptSession({read:async()=>emptyAuthority(),commit:async()=>{throw Error('write');}},undefined).prepareNewPlan()).handle;
const base = {raw:JSON.stringify(seed.state),revision:1,committed:[await backupDigest(seed.state)],issuedIds:(await replayState(seed.state)).requiredReservations};
const host = n => ({...base,revision:n,issuedIds:[...base.issuedIds,'hosei:owned:'+uuid(n)]});
function session(read) { return createSynchronousAttemptSession({read,commit:async()=>{throw Error('write');}},undefined); }
async function skips(api,h,blocked) {
  const original=crypto.randomUUID; let fresh=100;
  try {
    const ids=api.identities(h);
    for(const mint of [ids.newAssessmentId,ids.newTodoId,ids.newOperationId,ids.newRecordId,()=>ids.newAttemptIds().id]) {
      const tape=[...blocked,uuid(++fresh)]; crypto.randomUUID=()=>tape.shift()??uuid(++fresh);
      const id=mint(); assert.ok(!blocked.includes(id.split(':').at(-1)),id);
    }
  } finally {crypto.randomUUID=original;}
}
for(const order of [[0,1],[1,0]]) test(`load read completion ${order.join('→')}: both host sets retained across namespaces`,async()=>{
  const gates=[deferred(),deferred()];let n=0;const api=session(()=>gates[n++].promise);
  const pending=[api.load(),api.load()];
  for(const i of order) gates[i].resolve(host(i+2));
  const handles=await Promise.all(pending);
  for(const h of handles) await skips(api,h,[uuid(2),uuid(3)]);
  const ids=api.identities(handles[0]),op=ids.newOperationId();
  assert.throws(()=>api.dispatch(handles[1],handles[1].workspace,{kind:'delete_todo',operationId:op,recordId:'absent'}));
});
test('read A precedes B, digest/replay B completes first; mint while A pending retains B reservations',async()=>{
  const gates=[deferred(),deferred()],entered=deferred(),digestGate=deferred();let reads=0,first=true;
  const api=session(()=>gates[reads++].promise),digest=crypto.subtle.digest.bind(crypto.subtle),trace=[];
  crypto.subtle.digest=async(...args)=>{if(first){first=false;entered.resolve();await digestGate.promise;}return digest(...args);};
  try {
    const a=api.load();gates[0].resolve(host(2));await entered.promise;
    const b=api.load();gates[1].resolve(host(3));const bh=await b;trace.push('B');
    const burned=api.identities(bh).newAssessmentId();await skips(api,bh,[uuid(3)]);
    digestGate.resolve();const ah=await a;trace.push('A');assert.deepEqual(trace,['B','A']);
    await skips(api,ah,[uuid(2),uuid(3),burned]);await skips(api,bh,[uuid(2),uuid(3)]);
  } finally {digestGate.resolve();crypto.subtle.digest=digest;}
});
test('failed host read cannot lose successful reservations or qualify an invalid handle',async()=>{
  const gates=[deferred(),deferred()];let n=0;const api=session(()=>gates[n++].promise);
  const a=api.load(),b=api.load();const rejected=assert.rejects(a);gates[0].resolve({...host(2),committed:['0'.repeat(64)]});gates[1].resolve(host(3));
  const h=await b;await rejected;await skips(api,h,[uuid(3)]);
  assert.throws(()=>api.identities(structuredClone(h)),/unverified_identity_handle/);
});
test('load interleaves with backup inspection and preserves host union; recovery has no editing qualification',async()=>{
  const body={format:'hosei-attempt-backup',backupVersion:3,createdAt:'2026-11-02T00:00:00.000Z',state:seed.state,reservedIds:base.issuedIds};
  const raw=JSON.stringify({...body,sha256:await backupDigest(body)});
  const gates=[deferred(),deferred()];let n=0;const api=session(()=>gates[n++].promise);
  const loaded=api.load(),inspected=api.inspectBackup(raw);gates[0].resolve(host(2));
  const h=await loaded;gates[1].resolve(base);const p=await inspected;
  await skips(api,h,[uuid(2)]);await skips(api,p.handle,[uuid(2)]);
  assert.throws(()=>api.dispatch(p.handle,p.handle.workspace,{kind:'delete_todo',operationId:api.identities(p.handle).newOperationId(),recordId:'absent'}),/unconfirmed_recovery/);
});
