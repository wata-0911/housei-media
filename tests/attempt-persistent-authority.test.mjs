import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createPersistentAttemptSession } from '../src/planner/attempts/persistence/persistentSession.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { backupDigest, backupRawDigest } from '../src/planner/backup/plannerBackupCompatibility.ts';
import { decodeAuthorityJson, decodeBackupJson } from '../src/planner/attempts/persistence/contractDecoders.ts';
import { env } from './fixtures/migration-fixture.mjs';
import { makeAttempt } from '../src/planner/attempts/workbench/catalogView.ts';
const locks = { request: async (name, options, run) => { assert.equal(name,'hosei-planner:v1:write'); assert.equal(options.mode,'exclusive'); return run(); } };
export function memory(initial=emptyAuthority()) {
  let record=structuredClone(initial), writes=0, failure;
  return {read:async()=>structuredClone(record), commit:async(expected,next)=>{assert.deepEqual(record,expected,'stale_commit'); if(failure)throw failure; record=structuredClone(next);writes++;}, snapshot:()=>structuredClone(record),set:value=>{record=structuredClone(value);},fail:value=>{failure=value;},writes:()=>writes};
}
export const confirm = (api,p,extra={})=>api.commit(p,{confirmed:true,protectedRaw:p.previousRaw,protectedSourceRaw:p.sourceRaw,...extra});
export async function setup() {const store=memory(),api=createPersistentAttemptSession(store,locks),p=await api.prepareNewPlan(),h=await confirm(api,p);return {store,api,h};}
export function add(api,h,title='新計画') {const ids=api.identities(h),a=makeAttempt(h.source.context.catalog,{title,courseId:null,placementId:null,plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''},ids.newAttemptIds());return {kind:'add',operationId:a.creationOperationId,attempt:a};}
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/persistence-rule1-parent.json.gz',import.meta.url))));

test('authority: new host v2 commit/reload, strict rejection, clones and decoder never qualify',async()=>{
 const {store,api,h}=await setup();assert.equal(h.state.rule.version,2);assert.equal(h.saveStatus,'native-v2-save-authorized');assert.equal(store.snapshot().authorityVersion,2);
 assert.deepEqual((await api.load()).state,h.state);await assert.rejects(api.prepareEdits({...h},[]),/unverified/);
 const p=await api.prepareEdits(h,[]);await assert.rejects(confirm(api,{...p}),/confirmation|preview/);
 const content=await decodeAuthorityJson(JSON.stringify(store.snapshot()));assert.equal(content.saveAuthority,'not-issued');assert.throws(()=>api.identities(content),/unverified/);
 for(const change of [{authorityVersion:3},{reservationCoverage:{policyVersion:2,kind:'native-v2',baselineStateSha256:'a'.repeat(64)}},{issuedIds:[]}]) {const before=store.snapshot();store.set({...before,...change});await assert.rejects(api.load());store.set(before);}
 assert.equal(store.writes(),1);
});
test('reservations: abandoned and failed burns, nested R2, rollback and all namespace reuse',async()=>{
 const {store,api,h}=await setup(),ids=api.identities(h),abandoned=ids.newAssessmentId(),c=add(api,h),bad=add(api,h);bad.attempt.originalTitle='';await assert.rejects(api.prepareEdits(h,[bad]));
 const p=await api.prepareEdits(h,[c]),next=await confirm(api,p);const host=store.snapshot();for(const id of [abandoned,bad.operationId,bad.attempt.id,c.operationId,c.attempt.id])assert.ok(host.issuedIds.includes(id));
 const backup=await api.createBackup(next);const record={id:api.identities(next).newRecordId(),kind:'media',owner:{kind:'attempt',attemptId:c.attempt.id},payload:{totalLessons:0,lessons:[],assessments:[{id:api.identities(next).newAssessmentId(),label:'試験',type:'final',scheduledDate:null,completed:false}]}};
 const edit={kind:'add_record',operationId:api.identities(next).newOperationId(),record};const n2=await confirm(api,await api.prepareEdits(next,[edit]));const before=store.snapshot();assert.ok(n2.state.history.issuedIds.includes(record.payload.assessments[0].id));
 const inspected=await api.inspectBackup(backup);assert.throws(()=>api.identities(inspected),/unverified/);const restore=await api.prepareRestore(inspected);assert.throws(()=>api.identities(restore.handle),/recovery/);
 await confirm(api,restore,{acceptedBackupRawSha256:await backupRawDigest(backup),protectedBackupRaw:backup});assert.deepEqual(store.snapshot().issuedIds,before.issuedIds);assert.deepEqual(store.snapshot().committed,before.committed);
 const reloadApi=createPersistentAttemptSession(store,locks),loaded=await reloadApi.load();assert.deepEqual(loaded.state,next.state);assert.ok(store.snapshot().issuedIds.includes(record.payload.assessments[0].id));
 const original=crypto.randomUUID;crypto.randomUUID=()=>record.payload.assessments[0].id;try {for(const name of ['newOperationId','newRecordId','newAssessmentId','newTodoId','newAttemptIds'])assert.throws(()=>reloadApi.identities(loaded)[name](),/allocator_exhausted/);}finally{crypto.randomUUID=original;}
});
test('migration: legacy load unchanged, explicit conversion baseline fixed, no normal qualification, stale preview rejected',async()=>{
 for(const f of fixture.fixtures){const old=JSON.parse(f.stateRaw),store=memory({raw:f.stateRaw,revision:1,committed:[f.digest],issuedIds:old.history.issuedIds}),api=createPersistentAttemptSession(store,locks,env);
 const h=await api.load();assert.deepEqual(h.state,old);assert.equal(store.writes(),0);assert.throws(()=>api.identities(h),/legacy/);await assert.rejects(api.prepareNewPlan(),/legacy/);
 const p=await api.previewLegacyMigration();assert.equal(p.migration.comparison.allOtherValuesEqual,true);await assert.rejects(api.commit(p,{confirmed:false}),/confirmation/);await assert.rejects(confirm(api,{...p}),/confirmation|preview/);
 const original=store.snapshot();store.set({...original,revision:2});await assert.rejects(confirm(api,p),/stale/);assert.equal(store.writes(),0);store.set(original);
 const next=await confirm(api,p);assert.equal(next.coverage.kind,'legacy-unproven');assert.equal(next.coverage.baselineStateSha256,f.digest);assert.equal(next.state.rule.version,2);assert.equal(next.saveStatus,'legacy-unproven');assert.throws(()=>api.identities(next),/legacy/);await assert.rejects(api.prepareEdits(next,[]),/legacy/);
 assert.ok(store.snapshot().committed.includes(f.digest));assert.deepEqual((await decodeAuthorityJson(JSON.stringify(store.snapshot()))).value,store.snapshot());
 }
});
test('storage: all-field stale including lock wait, failure retry, no lock, postcommit read failure is unknown',async()=>{
 const {store,api,h}=await setup(),p=await api.prepareEdits(h,[add(api,h)]),original=store.snapshot();
 for(const change of [{revision:2},{raw:'broken'},{committed:[...original.committed,'b'.repeat(64)]},{issuedIds:[...original.issuedIds,'ef000000-0000-4000-8000-000000000001']},{reservationCoverage:{policyVersion:2,kind:'legacy-unproven',baselineStateSha256:'c'.repeat(64)}},{format:'bad'}]){store.set({...original,...change});await assert.rejects(confirm(api,p));assert.equal(store.writes(),1);}store.set(original);
 store.fail(new DOMException('full','QuotaExceededError'));await assert.rejects(confirm(api,p),/full/);assert.deepEqual(store.snapshot(),original);store.fail(null);await confirm(api,p);assert.equal(store.writes(),2);
 const no=createPersistentAttemptSession(store,undefined),np=await no.prepareEdits(await no.load(),[]);await assert.rejects(confirm(no,np),/Web Locks/);assert.equal(store.writes(),2);
 let readFailed=false;const unknown=createPersistentAttemptSession({read:()=>readFailed?Promise.reject(Error('read failure')):store.read(),commit:async(e,n)=>{await store.commit(e,n);readFailed=true;}},locks);const up=await unknown.prepareEdits(await unknown.load(),[]);await assert.rejects(confirm(unknown,up),/commit_outcome_unknown/);assert.equal(store.writes(),3);
});
test('backup: v4 export/inspect/adopt separate, tamper/protection rejected, explicit selected-file consent, zero export writes',async()=>{
 const {store,api,h}=await setup(),raw=await api.createBackup(h),body=JSON.parse(raw);assert.equal(body.backupVersion,4);await decodeBackupJson(raw);assert.equal(store.writes(),1);
 const other=memory(),destination=createPersistentAttemptSession(other,locks),inspect=await destination.inspectBackup(raw);assert.equal(other.writes(),0);await assert.rejects(destination.prepareRestore(await decodeBackupJson(raw)),/unverified/);await assert.rejects(destination.prepareRestore({...inspect}),/unverified/);const p=await destination.prepareRestore(inspect);await assert.rejects(confirm(destination,p),/adoption/);assert.equal(other.writes(),0);
 await assert.rejects(confirm(destination,p,{acceptedBackupRawSha256:await backupRawDigest(raw),protectedBackupRaw:raw+' '}),/adoption/);
 await confirm(destination,p,{acceptedBackupRawSha256:await backupRawDigest(raw),protectedBackupRaw:raw});assert.deepEqual((await destination.load()).state,h.state);assert.equal(other.writes(),1);
 for(const change of [{backupVersion:5},{sha256:'a'.repeat(64)}])await assert.rejects(destination.inspectBackup(JSON.stringify({...body,...change})));
 const {sha256,...rest}=body;void sha256;const missing={...rest,reservedIds:[]};await assert.rejects(destination.inspectBackup(JSON.stringify({...missing,sha256:await backupDigest(missing)})));
 await assert.rejects(destination.inspectBackup(await destination.protectCurrent()));assert.equal(other.writes(),1);
});
test('F03: corrupt raw protection bypasses strict read, preserves UTF8 digest, zero mint/write/qualification',async()=>{
 const raw='破損 {\n原文',store=memory({raw,revision:1,committed:['d'.repeat(64)],issuedIds:[]}),api=createPersistentAttemptSession(store,locks),before=store.snapshot();
 const original=crypto.randomUUID;crypto.randomUUID=()=>{throw Error('mint forbidden');};try{const protectedRaw=JSON.parse(await api.protectCurrent());assert.deepEqual(protectedRaw,{format:'hosei-yi06-protection',protectionVersion:1,currentRaw:raw,sha256:createHash('sha256').update(raw,'utf8').digest('hex')});await assert.rejects(api.load());await assert.rejects(api.prepareNewPlan());}finally{crypto.randomUUID=original;}assert.equal(store.writes(),0);assert.deepEqual(store.snapshot(),before);
});

test('migration held/corrections: frozen audit bytes retained; no mint or forced qualification; coverage laundering refused',async()=>{
 const evidence=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/persistence-rule1-pr1-audit.json.gz',import.meta.url))));
 for(const f of evidence.fixtures.filter(f=>['24-legacy-nonuuid','24-legacy-cross-namespace','23-corrections'].includes(f.name))){
  const state=JSON.parse(f.state1Raw),store=memory({raw:f.state1Raw,revision:1,committed:[f.digest1],issuedIds:state.history.issuedIds}),api=createPersistentAttemptSession(store,locks,env),before=store.snapshot();
  const original=crypto.randomUUID;crypto.randomUUID=()=>{throw Error('unexpected mint');};let p;try{p=await api.previewLegacyMigration();}finally{crypto.randomUUID=original;}
  if(f.name!=='23-corrections'){assert.equal(p.status,'held');assert.equal(p.saveAuthority,'not-issued');await assert.rejects(api.commit(p,{confirmed:true}),/confirmation/);assert.deepEqual(store.snapshot(),before);continue;}
  assert.deepEqual(p.handle.state,f.state2);assert.deepEqual(p.handle.state.corrections,state.corrections);const h=await confirm(api,p);assert.deepEqual(h.workspace,f.workspace);assert.deepEqual(h.state.source,state.source);assert.deepEqual(h.state.corrections,state.corrections);
  const raw=await api.createBackup(h),b=JSON.parse(raw);assert.equal(b.reservationCoverage.baselineStateSha256,f.digest1);
  for(const coverage of [{policyVersion:2,kind:'native-v2',baselineStateSha256:null},{policyVersion:2,kind:'legacy-unproven',baselineStateSha256:'e'.repeat(64)}]){const {sha256,...body}=b;void sha256;body.reservationCoverage=coverage;const forged=JSON.stringify({...body,sha256:await backupDigest(body)});assert.equal((await decodeBackupJson(forged)).saveAuthority,'not-issued');await assert.rejects(api.inspectBackup(forged),/implicit_promotion/);}
  assert.equal(store.writes(),1);
 }
});
test('old backup v1/v2/v3: strict inspection preserves rule1, no implicit rule2 adoption and v1 still needs host',async()=>{
 for(const f of fixture.fixtures){const state=JSON.parse(f.stateRaw),version=state.schemaVersion===24?3:2,body={format:'hosei-attempt-backup',backupVersion:version,createdAt:'2026-11-02T00:00:00.000Z',state,reservedIds:f.requiredReservations},raw=JSON.stringify({...body,sha256:await backupDigest(body)}),store=memory(),api=createPersistentAttemptSession(store,locks,env);
  const i=await api.inspectBackup(raw);assert.equal(i.backupKind,'legacy');assert.equal(i.raw,raw);assert.deepEqual(i.migration.analysis.original,state);await assert.rejects(api.prepareRestore(i),/legacy_backup_explicit_migration/);assert.equal(store.writes(),0);
  if(version===2){const v1={...body,backupVersion:1};delete v1.reservedIds;const text=JSON.stringify({...v1,sha256:await backupDigest(v1)});await assert.rejects(api.inspectBackup(text),/unverified_assignment_history/);store.set({raw:f.stateRaw,revision:1,committed:[f.digest],issuedIds:state.history.issuedIds});assert.equal((await api.inspectBackup(text)).backupKind,'legacy');assert.equal(store.writes(),0);}
 }
});
test('ticket boundaries and accumulating burn: default/role/copied command rejected, 128 abandoned IDs survive successful save/reload',async()=>{
 const {store,api,h}=await setup(),ids=api.identities(h),all=[];
 const untracked=makeAttempt(h.source.context.catalog,{title:'default',courseId:null,placementId:null,plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''});await assert.rejects(api.prepareEdits(h,[{kind:'add',operationId:untracked.creationOperationId,attempt:untracked}]),/untracked_session_identity/);
 const c=add(api,h);api.dispatch(h,h.workspace,c);await assert.rejects(api.prepareEdits(h,[structuredClone(c)]),/untracked_session_identity/);
 const wrong=add(api,h);wrong.operationId='hosei:attempt-op:'+ids.newAssessmentId();wrong.attempt.creationOperationId=wrong.operationId;await assert.rejects(api.prepareEdits(h,[wrong]),/untracked_session_identity/);
 for(let n=0;n<128;n++)all.push(ids.newTodoId());const next=await confirm(api,await api.prepareEdits(h,[c]));all.forEach(id=>assert.ok(store.snapshot().issuedIds.includes(id)));
 const after=api.identities(next);for(let n=0;n<16;n++)all.push(after.newAssessmentId());await confirm(api,await api.prepareEdits(next,[]));all.forEach(id=>assert.ok(store.snapshot().issuedIds.includes(id)));
 const fresh=createPersistentAttemptSession(store,locks),loaded=await fresh.load(),snapshot=store.snapshot();assert.deepEqual(loaded.state.history.commands,[c]);assert.equal(new Set(snapshot.issuedIds).size,snapshot.issuedIds.length);
 const original=crypto.randomUUID;crypto.randomUUID=()=>all[0];try{assert.throws(()=>fresh.identities(loaded).newOperationId(),/allocator_exhausted/);}finally{crypto.randomUUID=original;}
});
test('concurrent strict v2 reads and corrupt rescue never shrink validated reservation union',async()=>{
 const {store}=await setup(),base=store.snapshot(),a='ac000000-0000-4000-8000-000000000001',b='ac000000-0000-4000-8000-000000000002';
 for(const reverse of [false,true]){let calls=0,resolveA,resolveB;const pa=new Promise(r=>resolveA=r),pb=new Promise(r=>resolveB=r),api=createPersistentAttemptSession({read:()=>++calls===1?pa:calls===2?pb:Promise.resolve({...base,raw:'破損 {救済'}),commit:async()=>{throw Error('write forbidden');}},locks);
  const loadA=api.load(),loadB=api.load();const rescue=JSON.parse(await api.protectCurrent());assert.equal(rescue.currentRaw,'破損 {救済');
  if(reverse){resolveA({...base,issuedIds:[...base.issuedIds,a]});await loadA;resolveB({...base,issuedIds:[...base.issuedIds,b]});}else{resolveB({...base,issuedIds:[...base.issuedIds,b]});await loadB;resolveA({...base,issuedIds:[...base.issuedIds,a]});}
  const [ha,hb]=await Promise.all([loadA,loadB]);for(const h of [ha,hb])for(const id of [a,b]){const original=crypto.randomUUID;crypto.randomUUID=()=>id;try{assert.throws(()=>api.identities(h).newTodoId(),/allocator_exhausted/);}finally{crypto.randomUUID=original;}}
 }
});
test('PR4 boundary: frozen contracts/Worker/fixtures unchanged; production and preview Worker receive no new save authority',async()=>{
 const {execFileSync}=await import('node:child_process');
 for(const file of ['controller.ts','syncSession.ts','indexedDbRead.ts','codec.ts','contracts.ts','versionedContracts.ts','contractDecoders.ts','legacyPreview.ts','sessionIds.ts','identityFold.ts','commandIdentities.ts','worker/session.ts','worker/editBridge.ts']){
  const path='src/planner/attempts/persistence/'+file;assert.equal(execFileSync('git',['hash-object',path],{encoding:'utf8'}),execFileSync('git',['rev-parse','cd4a6a4a331eb13d624b30fe7c9481e636856aba:'+path],{encoding:'utf8'}),path);
 }
 for(const path of ['src/planner/attempts/workbench/sessionIdentities.ts','scripts/verify-controller-worker-scope.mjs','tests/fixtures/persistence-rule1-parent.json.gz','tests/fixtures/persistence-rule1-pr1-audit.json.gz'])assert.equal(execFileSync('git',['hash-object',path],{encoding:'utf8'}),execFileSync('git',['rev-parse','cd4a6a4a331eb13d624b30fe7c9481e636856aba:'+path],{encoding:'utf8'}),path);
 const {build}=await import('esbuild');for(const entry of ['src/main.tsx','src/planner/attempts/persistence/worker/preview.worker.ts']){const output=await build({entryPoints:[entry],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',loader:{'.svg':'text','.png':'dataurl','.woff2':'dataurl'},external:['*.css'],logLevel:'silent'});
 assert.ok(!Object.keys(output.metafile.inputs).some(p=>/persistentSession|AuthorityV2Page|authoritySnapshot/.test(p)),entry);}
});
