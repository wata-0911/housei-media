import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlannerAttemptSession} from '../src/planner/attempts/production/session.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {requireAttemptAuthority} from '../src/planner/attempts/persistence/authorityFormat.ts';
import {createPlannerBackup} from '../src/planner/backup/plannerBackup.ts';
import {env,initialState,mixed,catalog} from './fixtures/migration-fixture.mjs';
const locks={request:async(_n,_o,fn)=>fn()};
const placement='hosei:cp:b99c65d5-5917-422d-bda4-75a4f99ad8b7';
const input=JSON.stringify({plannedYear:null,method:'correspondence',status:'planned'});
function setup(primaryRaw=null){
 let value=emptyAuthority(),reads=0,writes=0;
 const legacy={primaryRaw,recoveryRaw:'protected recovery'};if(primaryRaw===null)legacy.recoveryRaw=null;
 const store={async read(){reads++;if(store.fail)throw Error('SecurityError');store.hook?.(reads);return structuredClone(value);},async commit(e,n){assert.deepEqual(e,value,'stale_commit');value=structuredClone(n);writes++;}};
 const session=()=>createPlannerAttemptSession(store,locks,{readLegacy:()=>({...legacy}),migrationEnvironment:async()=>env});
 return{api:session(),session,store,legacy,get:()=>structuredClone(value),set:v=>{value=structuredClone(v);},writes:()=>writes};
}
const save=async s=>s.save(await s.prepareSave(),true);
async function started(){const x=setup();await x.api.load();await save(x.api);return x;}
test('R1 corrupt destination cannot be replaced by old session known checkpoint',async()=>{
 const x=await started(),backup=await x.api.createBackup(),v=x.get();const s=JSON.parse(v.raw);s.graph.attempts=['synthetic'];v.raw=JSON.stringify(s);v.revision++;x.set(v);
 await assert.rejects(x.session().load());const before=x.get();await assert.rejects(x.api.prepareRestore(backup));assert.deepEqual(x.get(),before);
});
test('R1 legitimate destination update needs reload; rollback preserves protection and IDs',async()=>{
 const x=await started(),backup=await x.api.createBackup();const other=x.session();await other.load();other.add(placement,input);await save(other);const before=x.get();
 await assert.rejects(x.api.prepareRestore(backup));assert.deepEqual(x.get(),before);await x.api.load();const p=await x.api.prepareRestore(backup);assert.equal(JSON.parse(p.protectionRaw).previousRaw,before.raw);
 await x.api.save(p,true);assert.equal(x.get().revision,before.revision+1);assert.equal(JSON.parse(x.get().raw).graph.attempts.length,0);for(const id of before.issuedIds)assert.ok(x.get().issuedIds.includes(id));
});
for(const field of ['raw','revision','committed','issuedIds'])test(`R1 destination ${field} changes during restore inspection`,async()=>{
 const x=await started(),backup=await x.api.createBackup();let once=false;
 x.store.hook=()=>{if(once)return;once=true;const v=x.get();if(field==='raw')v.raw+=' ';else if(field==='revision')v.revision++;else if(field==='committed')v.committed.push('a'.repeat(64));else v.issuedIds.push('00000000-0000-4000-8000-000000009999');x.set(v);};
 await assert.rejects(x.api.prepareRestore(backup));assert.equal(x.writes(),1);
});
for(const field of ['committed','issuedIds'])for(const extension of ['extra','hole','outside'])test(`R2 strict ${field}/${extension}`,async()=>{
 const x=await started(),v=x.get();if(extension==='extra')v[field].auditExtension={raw:'synthetic'};else if(extension==='hole')v[field].length+=1;else v[field]['4294967295']='outside';assert.throws(()=>requireAttemptAuthority(v));
});
test('R6 destination read failure revokes old preview; input error is separate',async()=>{
 const x=setup();await x.api.load();const p=await x.api.prepareSave();x.store.fail=true;await assert.rejects(x.api.prepareSave());assert.equal(x.api.admission().canCreate,false);x.store.fail=false;await assert.rejects(x.api.save(p,true),/stale|reload/);assert.equal(x.writes(),0);
 await x.api.load();await assert.rejects(x.api.prepareMigration('{bad'));assert.equal(x.api.admission().canCreate,true);
});
test('R7 primary backup envelope refused, same state/catalog file remains valid',async()=>{
 const state=initialState(),raw=JSON.stringify(state),backup=JSON.stringify(await createPlannerBackup(raw,catalog),null,2),x=setup(backup);await x.api.load();assert.equal(x.api.admission().case,'G');assert.equal(x.api.admission().canMigrate,false);await assert.rejects(x.api.prepareMigration(backup));assert.equal(x.writes(),0);
 const y=setup(raw);await y.api.load();const p=await y.api.prepareMigration(backup);await y.api.save(p,true);assert.equal(y.api.admission().case,'E');assert.equal(JSON.parse(y.get().raw).source.raw,backup);
});
test('R8 removed rollback reservation refuses backup',async()=>{
 const x=await started(),backup=await x.api.createBackup();x.api.add(placement,input);await save(x.api);const ids=x.get().issuedIds;await x.api.save(await x.api.prepareRestore(backup),true);const v=x.get();const removed=ids.find(id=>!JSON.parse(v.raw).history.issuedIds.includes(id));assert.ok(removed);v.issuedIds=v.issuedIds.filter(id=>id!==removed);v.revision++;x.set(v);const before=x.get();await assert.rejects(x.api.createBackup());assert.deepEqual(x.get(),before);
});
test('R8 update between backup reads is rejected',async()=>{
 const x=await started();let n=0;x.store.hook=()=>{if(++n===2){const v=x.get();v.revision++;x.set(v);}};await assert.rejects(x.api.createBackup());assert.equal(x.writes(),1);
});
test('R9 decimal precision loss held, 4.0 and envelope/whitespace differences allowed',async()=>{
 const state=mixed();state.importedCourseAchievements[0].earnedCreditsTotal=4;const raw=JSON.stringify(state);const imprecise=raw.replace('"earnedCreditsTotal":4','"earnedCreditsTotal":4.0000000000000001');assert.notEqual(raw,imprecise);
 const x=setup(imprecise);await x.api.load();assert.equal(x.api.admission().canMigrate,false);await assert.rejects(x.api.prepareMigration(raw));assert.equal(x.writes(),0);
 const y=setup(raw.replace('"earnedCreditsTotal":4','"earnedCreditsTotal":4.0'));await y.api.load();await y.api.save(await y.api.prepareMigration(' \n'+raw),true);assert.equal(y.api.admission().case,'E');
});
for(const populated of [false,true])test(`R10 standard pretty v2 ${populated?'populated':'empty'} preserves raw`,async()=>{
 const state=populated?mixed():initialState(),raw=JSON.stringify(state),backup=JSON.stringify(await createPlannerBackup(raw,catalog),null,2);assert.ok(backup.length>1048576);const x=setup(raw);await x.api.load();const p=await x.api.prepareMigration(backup);assert.equal(JSON.parse(p.protectionRaw).sourceRaw,backup);await x.api.save(p,true);await x.api.load();assert.equal(JSON.parse(x.get().raw).source.raw,backup);assert.equal(x.legacy.primaryRaw,raw);assert.equal(x.legacy.recoveryRaw,'protected recovery');
});
test('R1 update between destination witness and inspectBackup is fenced',async()=>{
 const x=await started(),backup=await x.api.createBackup();let reads=0;x.store.hook=()=>{if(++reads===2){const v=x.get();v.revision++;x.set(v);}};await assert.rejects(x.api.prepareRestore(backup),/stale/);assert.equal(x.writes(),1);
});
test('R8 update after backup internal read is caught before issuing file',async()=>{
 const x=await started();let reads=0;x.store.hook=()=>{if(++reads===3){const v=x.get();v.revision++;x.set(v);}};await assert.rejects(x.api.createBackup(),/stale/);assert.equal(x.writes(),1);
});
