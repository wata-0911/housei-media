import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewSession} from '../src/planner/attempts/persistence/worker/session.ts';
import {createAttemptPersistence} from '../src/planner/attempts/persistence/controller.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {replayState} from '../src/planner/attempts/persistence/codec.ts';
import {backupDigest} from '../src/planner/backup/plannerBackupCompatibility.ts';
import {replayFixture} from './fixtures/replay-state-fixture.mjs';
import {env,mixed} from './fixtures/migration-fixture.mjs';
let fixtures;
async function inputs(){return fixtures??=(async()=>{
 const a=await replayFixture(24,'normal',1),b=await replayFixture(24,'normal',2);
 const authority=async f=>{const r=await replayState(f.state);return {raw:f.raw,revision:1,committed:[await backupDigest(f.state)],issuedIds:r.requiredReservations};};
 const A=await authority(a),replacement=await authority(b);replacement.revision=2;replacement.committed=[...new Set([...A.committed,...replacement.committed])];replacement.issuedIds=[...new Set([...A.issuedIds,...replacement.issuedIds])];
 const backupBody={format:'hosei-attempt-backup',backupVersion:3,createdAt:'2026-10-27T00:00:00.000Z',state:a.state,reservedIds:A.issuedIds};
 const backup=JSON.stringify({...backupBody,sha256:await backupDigest(backupBody)});
 const variants={replacement,committed:{...A,committed:[...A.committed,'f'.repeat(64)]},issuedContent:{...A,issuedIds:[...A.issuedIds,'hosei:attempt-op:'+crypto.randomUUID()]},issuedOrder:{...A,issuedIds:[...A.issuedIds].reverse()},erased:emptyAuthority(),raw:{...A,raw:' '+A.raw+'\n'},revision:{...A,revision:2}};
 for(const B of Object.values(variants))await createAttemptPersistence({read:async()=>structuredClone(B),commit:async()=>{throw Error('write forbidden');}},undefined,env).load();
 return {A,variants,backup,legacy:JSON.stringify(mixed())};
})();}
function session(read,boot=1){const s=createPreviewSession(read,async()=>env,boot);let id=0;return {s,call(op,g={},extra={},raw){return s.request({version:1,boot,requestId:++id,op,...g,...extra},raw);},request(c){return s.request(c);},get id(){return id;}};}
const view=(start,v=start)=>({session:start.session,expectedView:v.view});
const projected=p=>({total:p.total,rows:p.rows.map(({row,...data})=>data)});
async function candidate(x,kind,data){
 const start=await x.call('startSession');let v,save;
 if(kind==='loaded'){v=await x.call('openCommitted',view(start));save={draft:v.draft};}
 else if(kind==='migration'){const i=await x.call('inspectLegacyRaw',view(start),{},data.legacy);assert.equal(i.status,'ready');v=await x.call('prepareMigration',view(start,i),{migration:i.migration});save={draft:v.draft};}
 else {v=await x.call('inspectBackupRaw',view(start),{},data.backup);save={restorePreview:v.restorePreview};}
 const g=view(start,v),prepared=await x.call('prepareSave',g,save);
 const replayRequest={version:1,boot:1,requestId:x.id,op:'prepareSave',...g,...save};
 if(kind==='restore')save={restorePreview:prepared.preview.preview};
 return {start,g,save,prepared,replayRequest};
}
for(const kind of ['loaded','migration','restore'])for(const mutation of ['replacement','committed','issuedContent','issuedOrder','erased','raw','revision'])test(`R1 ABA ${kind}/${mutation}: old eligibility stays revoked; view survives; fresh session validates`,{timeout:60000},async()=>{
 const data=await inputs();let record=structuredClone(data.A);const x=session(async()=>structuredClone(record));let fresh;
 try{
  const c=await candidate(x,kind,data),before=await x.call('readPage',c.g,{kind:'attempts'});assert.ok(before.rows.length);
  record=structuredClone(data.variants[mutation]);await assert.rejects(x.call('prepareSave',c.g,c.save),{code:'stale_authority'});
  record=structuredClone(data.A);
  for(let i=0;i<2;i++)await assert.rejects(x.call('prepareSave',c.g,c.save),{code:'stale_authority'});
  await assert.rejects(x.request(c.replayRequest),{code:'stale_authority'},'settled success ledger cannot revive old token');
  await assert.rejects(x.call('openCommitted',c.g),{code:'stale_authority'});
  await assert.rejects(x.call(kind==='restore'?'inspectBackupRaw':'inspectLegacyRaw',c.g,{},kind==='restore'?data.backup:data.legacy),{code:'stale_authority'});
  const after=await x.call('readPage',c.g,{kind:'attempts'});assert.deepEqual(projected(after),projected(before));
  for(const row of [...before.rows,...after.rows])await x.call('release',c.g,{token:row.row});
  assert.deepEqual(record,data.A);assert.equal(data.legacy,JSON.stringify(mixed()));
  fresh=session(async()=>structuredClone(record),2);const renewed=await candidate(fresh,kind,data);assert.equal(renewed.prepared.preview.canCommit,false);assert.notEqual(renewed.start.session,c.start.session);
  await assert.rejects(fresh.call('prepareSave',c.g,c.save),{code:'stale_view'});
 }finally{x.s.close();fresh?.s.close();}
});
test('R1 live MigrationToken is revoked by inspect bridge mismatch before later ABA reuse',{timeout:60000},async()=>{
 const data=await inputs();let record=structuredClone(data.A);const x=session(async()=>structuredClone(record));
 try{const start=await x.call('startSession'),i=await x.call('inspectLegacyRaw',view(start),{},data.legacy),g=view(start,i);record=structuredClone(data.variants.committed);
  await assert.rejects(x.call('inspectLegacyRaw',g,{},data.legacy),{code:'stale_authority'});record=structuredClone(data.A);
  await assert.rejects(x.call('prepareMigration',g,{migration:i.migration}),{code:'stale_authority'});await assert.rejects(x.call('inspectLegacyRaw',g,{},data.legacy),{code:'stale_authority'});
  assert.equal((await x.call('readPage',g,{kind:'diagnostics'})).total,0);
 }finally{x.s.close();}
});
test('R1 erasure detected during explicit load latches before throw; old draft survives restore',{timeout:60000},async()=>{
 const data=await inputs();let record=structuredClone(data.A);const x=session(async()=>structuredClone(record));
 try{const c=await candidate(x,'loaded',data),before=await x.call('readPage',c.g,{kind:'attempts'});record=emptyAuthority();await assert.rejects(x.call('openCommitted',c.g),{code:'stale_authority'});record=structuredClone(data.A);await assert.rejects(x.call('prepareSave',c.g,c.save),{code:'stale_authority'});assert.deepEqual(projected(await x.call('readPage',c.g,{kind:'attempts'})),projected(before));}finally{x.s.close();}
});
test('R1 backup inspection bridge also irrevocably revokes an existing draft on authority mismatch',{timeout:60000},async()=>{
 const data=await inputs();let record=structuredClone(data.A);const x=session(async()=>structuredClone(record));try{const c=await candidate(x,'loaded',data),before=await x.call('readPage',c.g,{kind:'attempts'});record=structuredClone(data.variants.issuedOrder);await assert.rejects(x.call('inspectBackupRaw',c.g,{},data.backup),{code:'stale_authority'});record=structuredClone(data.A);await assert.rejects(x.call('prepareSave',c.g,c.save),{code:'stale_authority'});await assert.rejects(x.call('inspectBackupRaw',c.g,{},data.backup),{code:'stale_authority'});assert.deepEqual(projected(await x.call('readPage',c.g,{kind:'attempts'})),projected(before));}finally{x.s.close();}
});
