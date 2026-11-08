import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlannerAttemptSession} from '../src/planner/attempts/production/session.ts';
import {createAcController} from '../src/planner/attempts/production/acController.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {requireAttemptAuthority} from '../src/planner/attempts/persistence/authorityFormat.ts';
import {env,mixed} from './fixtures/migration-fixture.mjs';
const locks={request:async(_n,_o,fn)=>fn()},none={primaryRaw:null,recoveryRaw:null};
const placement='hosei:cp:b99c65d5-5917-422d-bda4-75a4f99ad8b7',input=JSON.stringify({plannedYear:2044,method:'correspondence',status:'planned'});
function setup(){let value=emptyAuthority(),armed=false,after=0;
 const store={writes:0,async read(){if(armed)after++;return structuredClone(value);},async commit(e,n,f){assert.deepEqual(e,value);f?.();value=structuredClone(n);store.writes++;}};
 const session=(fault=false)=>createPlannerAttemptSession(store,locks,{migrationEnvironment:async()=>env,readLegacy:()=>{if(fault&&armed&&after){armed=false;throw Error('legacy-read-after-verified-readback');}return none;}});
 return {store,session,get:()=>structuredClone(value),set:v=>value=structuredClone(v),arm:()=>{armed=true;after=0;}};
}
const save=async s=>s.save(await s.prepareSave(),true);
for(const phase of ['save','load'])test(`R2 P0 verified history survives ${phase} post-replay legacy failure`,async()=>{
 const x=setup(),s=x.session(true),c=createAcController(s);await c.load();await c.prepare();await c.save(c.getSnapshot().proposal,true);const backup=await s.createBackup();
 const writer=phase==='save'?s:x.session();if(phase==='load')await writer.load();writer.add(placement,input);const id=writer.graph().attempts[0].id;
 if(phase==='save'){await c.prepare();x.arm();assert.equal(await c.save(c.getSnapshot().proposal,true),false);assert.equal(c.getSnapshot().ready,false);assert.doesNotMatch(c.getSnapshot().notice,/保存済み/);}
 else{await save(writer);x.arm();await assert.rejects(s.load(),/legacy-read-after/);}
 assert.equal(x.get().revision,2);assert.ok(x.get().issuedIds.includes(id));
 const other=x.session();await other.load();await other.save(await other.prepareRestore(backup),true);const r=x.get();assert.equal(r.revision,3);assert.ok(r.issuedIds.includes(id));
 const normal=x.session();await normal.load();assert.equal(JSON.parse(await normal.createBackup()).reservedIds.includes(id),true);
 r.revision=4;r.issuedIds=r.issuedIds.filter(v=>v!==id);x.set(r);const before=x.get();await assert.rejects(s.load(),/history|reservation/);await assert.rejects(s.createBackup());assert.deepEqual(x.get(),before);
});
test('R2 unverified current does not poison known history',async()=>{
 const x=setup(),s=x.session();await s.load();await save(s);const good=x.get(),bad=structuredClone(good),state=JSON.parse(bad.raw);state.graph.attempts=['unverified'];bad.raw=JSON.stringify(state);bad.revision++;bad.issuedIds.push('00000000-0000-4000-8000-000000009991');x.set(bad);await assert.rejects(s.load());x.set(good);await s.load();await save(s);assert.equal(x.get().issuedIds.includes('00000000-0000-4000-8000-000000009991'),false);await s.createBackup();
});
for(const kind of ['bad-id','uuid-alias','shared-arrays'])test(`R2 strict native envelope ${kind}`,async()=>{
 const v={raw:'{"format":"hosei-attempt-state","schemaVersion":24}',revision:1,committed:['a'.repeat(64)],issuedIds:[]};
 if(kind==='bad-id')v.issuedIds.push('not-an-id');else if(kind==='uuid-alias')v.issuedIds.push('00000000-0000-4000-8000-000000000001','hosei:attempt:00000000-0000-4000-8000-000000000001');else{const a=[];v.raw=null;v.revision=0;v.committed=a;v.issuedIds=a;}
 assert.throws(()=>requireAttemptAuthority(v));
});
let archiveTask;
const normalArchive=()=>archiveTask??=(async()=>{const x=setup(),s=x.session(),state=mixed();state.importedCourseAchievements[0].categoryRaw='literal 4.0000000000000001';const raw=JSON.stringify(state);await s.load();await s.save(await s.prepareMigration(raw),true);return{record:x.get(),backup:await s.createBackup(),raw};})();
test('R2 Attempt backup precision rejects outer number without altering destination',async()=>{
 const archive=await normalArchive(),x=setup(),s=x.session();x.set(archive.record);await s.load();const changed=archive.backup.replace('"earnedCreditsTotal":2','"earnedCreditsTotal":2.0000000000000001');assert.notEqual(changed,archive.backup);assert.deepEqual(JSON.parse(changed),JSON.parse(archive.backup));const before=x.get();await assert.rejects(s.prepareRestore(changed),/precision/);assert.deepEqual(x.get(),before);
});
for(const value of ['2','2.0','2e0','20e-1','0.002e3','2E+0000'])test(`R2 valid Attempt backup number ${value} and source text preserved`,async()=>{
 const archive=await normalArchive(),x=setup(),s=x.session();x.set(archive.record);await s.load();const p=await s.prepareRestore(archive.backup.replace('"earnedCreditsTotal":2','"earnedCreditsTotal":'+value));await s.save(p,true);assert.equal(JSON.parse(x.get().raw).source.raw,archive.raw);
});
test('R2 same session reconciles intact state after final legacy failure, then Undo and backup work',async()=>{
 const x=setup(),s=x.session(true),c=createAcController(s);await c.load();await c.prepare();await c.save(c.getSnapshot().proposal,true);c.add(placement,input);const id=c.getSnapshot().graph.attempts[0].id;await c.prepare();x.arm();assert.equal(await c.save(c.getSnapshot().proposal,true),false);assert.equal(await c.load(),true);assert.equal(c.getSnapshot().ready,true);const before=s.graph();s.remove(id);await save(s);await s.load();s.undo(id);await save(s);assert.deepEqual(s.graph(),before);assert.ok(JSON.parse(await s.createBackup()).reservedIds.includes(id));
});
test('R2 mismatching readback does not add an unverified extra reservation to known history',async()=>{
 const x=setup(),s=x.session();await s.load();await save(s);s.add(placement,input);const p=await s.prepareSave(),realRead=x.store.read;let sham=true;const fake='00000000-0000-4000-8000-000000009992';x.store.read=async()=>{const r=await realRead();if(sham&&r.revision===2)r.issuedIds.push(fake);return r;};await assert.rejects(s.save(p,true),/readback_conflict/);sham=false;await s.load();assert.equal(JSON.parse(await s.createBackup()).reservedIds.includes(fake),false);await save(s);assert.equal(x.get().issuedIds.includes(fake),false);
});
