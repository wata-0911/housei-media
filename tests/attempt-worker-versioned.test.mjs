import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewSession,createReadonlyStore} from '../src/planner/attempts/persistence/worker/session.ts';
import {previewLegacyRule2Migration} from '../src/planner/attempts/persistence/legacyPreview.ts';
import {backupDigest} from '../src/planner/backup/plannerBackupCompatibility.ts';
import {replayFixture} from './fixtures/replay-state-fixture.mjs';
import {env} from './fixtures/migration-fixture.mjs';
const c=(id,op,start={},extra={})=>({version:1,boot:1,requestId:id,op,...(start.session?{session:start.session,expectedView:start.view}:{}),...extra});
let fixture;
async function example(){if(!fixture)fixture=(async()=>{const f=await replayFixture(24,'normal',1),p=await previewLegacyRule2Migration(f.raw);assert.equal(p.status,'preview');const raw=JSON.stringify(p.candidate),coverage={policyVersion:2,kind:'native-v2',baselineStateSha256:null};return {old:f,record:{raw,revision:1,committed:[await backupDigest(p.candidate)],issuedIds:p.analysis.r2,format:'hosei-attempt-authority',authorityVersion:2,reservationCoverage:coverage},state:p.candidate};})();return structuredClone(await fixture);}
test('PR5 v2 native content loads and displays without edit authority',{timeout:120000},async()=>{const f=await example(),s=createPreviewSession(async()=>f.record,async()=>env,1);try{const start=await s.request(c(1,'startSession')),loaded=await s.request(c(2,'openCommitted',start));assert.equal(loaded.content.coverage,'native-v2');assert.equal(loaded.content.ruleVersion,2);assert.equal(loaded.content.canCommit,false);assert.equal(loaded.draft,undefined);assert.equal((await s.request(c(3,'readPage',{...start,view:loaded.view},{kind:'attempts'}))).total,f.state.graph.attempts.length);assert.deepEqual(f.record.raw,JSON.stringify(f.state));}finally{s.close();}});
test('PR5 invalid original nested descriptor rejects before clone or registration',async()=>{const record={raw:null,revision:0,committed:[],issuedIds:[]};Object.defineProperty(record.issuedIds,0,{enumerable:true,get(){throw Error('GETTER_RAN');}});let seen=0;const clone=globalThis.structuredClone;globalThis.structuredClone=()=>{throw Error('CLONE_RAN');};try{await assert.rejects(createReadonlyStore(async()=>record,()=>seen++).read(),{message:'authority_record_invalid'});assert.equal(seen,0);}finally{globalThis.structuredClone=clone;}});

import {versionedFixture,seal} from './helpers/worker-versioned-fixture.mjs';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {validateResult,validateControl,parseResponse} from '../src/planner/attempts/persistence/worker/protocol.ts';
const startSession=async(record=emptyAuthority(),provider=async()=>env)=>{const s=createPreviewSession(typeof record==='function'?record:async()=>record,provider,1);const start=await s.request(c(1,'startSession'));return {s,start};};
const rejection=code=>error=>{assert.equal(error.code??error.message,code);return true;};

test('PR5 schema24 authority/backup/state matrix: full value, raw/digest, preview and closed DTO',{timeout:120000},async()=>{
 const f=await versionedFixture(),original=structuredClone(f);
 for(const [record,rule]of [[f.legacy,1],[f.authority,2]]){const {s,start}=await startSession(record);try{const loaded=await s.request(c(2,'openCommitted',start));validateResult(loaded,'openCommitted');assert.equal(loaded.summary.schemaVersion,24);assert.equal(!!loaded.draft,rule===1);assert.equal(loaded.content?.ruleVersion??1,rule);if(rule===2)await assert.rejects(s.request(c(3,'prepareEdits',{...start,view:loaded.view},{draft:loaded.handle,intents:[{kind:'add',title:'x',selection:null,plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''}]})),rejection('readonly_mode'));}finally{s.close();}}
 const oldBody={format:'hosei-attempt-backup',backupVersion:3,createdAt:'2026-11-02T00:00:00.000Z',state:f.state,reservedIds:f.legacy.issuedIds};
 for(const backup of [await seal(oldBody),f.backup]){const {s,start}=await startSession();try{const result=await s.request(c(2,'inspectBackupRaw',start),JSON.stringify(backup));validateResult(result,'inspectBackupRaw');assert.equal(result.status,'ready');assert.equal(result.backupVersion,backup.backupVersion);assert.equal(result.evidence,'portable-unadopted');const save=await s.request(c(3,'prepareSave',{...start,view:result.view},{restorePreview:result.restorePreview}));validateResult(save,'prepareSave');assert.equal(save.preview.canCommit,false);assert.equal(save.recoveryHint.candidateStateSha256,await backupDigest(backup.state));assert.ok(!JSON.stringify(save).includes('rawFiles'));}finally{s.close();}}
 for(const [raw,rule]of [[f.raw,1],[f.authority.raw,2]]){const {s,start}=await startSession();try{const result=await s.request(c(2,'inspectAttemptRaw',start),raw);validateResult(result,'inspectAttemptRaw');assert.equal(result.content.ruleVersion,rule);assert.equal(result.content.saveAuthority,'not-issued');assert.equal(result.status,'ready');if(rule===1){const p=await s.request(c(3,'prepareMigration',{...start,view:result.view},{migration:result.migration}));validateResult(p,'prepareMigration');assert.equal(p.content.coverage,'legacy-unproven');assert.equal(p.content.baselineStateSha256,await backupDigest(f.state));assert.equal(p.canCommit,false);const save=await s.request(c(4,'prepareSave',{...start,view:p.view},{draft:p.draft}));validateResult(save,'prepareSave');assert.equal(save.recoveryHint.candidateStateSha256,f.preview.candidateDigest);}}finally{s.close();}}
 assert.deepEqual(f,original);
});

for(const mutation of ['coverage','version','reservations','checkpoint','raw'])test(`PR5 same revision ${mutation} change latches through ABA and settled replay`,{timeout:30000},async()=>{
 const f=await versionedFixture();let record=f.authority;const {s,start}=await startSession(()=>record);try{const request=c(2,'openCommitted',start),loaded=await s.request(request),g={...start,view:loaded.view};record=structuredClone(record);
 if(mutation==='coverage')record.reservationCoverage={policyVersion:2,kind:'legacy-unproven',baselineStateSha256:'a'.repeat(64)};
 if(mutation==='version')record.authorityVersion=3;
 if(mutation==='reservations')record.issuedIds.push('f5000000-0000-4000-8000-000000000001');
 if(mutation==='checkpoint')record.committed.push('b'.repeat(64));
 if(mutation==='raw')record.raw+=' ';
 await assert.rejects(s.request(c(3,'inspectAttemptRaw',g),f.authority.raw),e=>{assert.match(e.code??e.message,/stale_authority|unsupported_authority_version/);return true;});record=f.authority;
 await assert.rejects(s.request(c(4,'openCommitted',g)),rejection('stale_authority'));await assert.rejects(s.request(request),rejection('stale_authority'));
 assert.equal((await s.request(c(5,'readPage',g,{kind:'attempts'}))).total,f.modern.graph.attempts.length);
 }finally{s.close();}
});

for(const mutation of ['root-undefined','coverage-undefined','nan','infinity','date','boxed','accessor'])test(`PR5 original record ${mutation} rejects before clone, IDs and callback`,async()=>{
 const f=await versionedFixture(),r=f.authority;let getter=0,observed=0,ids=0;
 if(mutation==='root-undefined')r.extra=undefined;if(mutation==='coverage-undefined')r.reservationCoverage.extra=undefined;if(mutation==='nan')r.reservationCoverage.baselineStateSha256=NaN;if(mutation==='infinity')r.reservationCoverage.baselineStateSha256=Infinity;if(mutation==='date')r.reservationCoverage.baselineStateSha256=new Date(NaN);if(mutation==='boxed')r.raw=new String(r.raw);if(mutation==='accessor')Object.defineProperty(r,'raw',{enumerable:true,get(){getter++;return '{}';}});
 const uuid=crypto.randomUUID,clone=globalThis.structuredClone;crypto.randomUUID=()=>{ids++;throw Error('ID_RAN');};globalThis.structuredClone=()=>{throw Error('CLONE_RAN');};try{await assert.rejects(createReadonlyStore(async()=>r,()=>observed++).read(),rejection('authority_record_invalid'));assert.equal(observed,0);assert.equal(getter,0);assert.equal(ids,0);}finally{crypto.randomUUID=uuid;globalThis.structuredClone=clone;}
});

test('PR5 provider full-value changes/reject/delay invalidate candidates without mint or success',{timeout:30000},async()=>{
 const f=await versionedFixture();for(const key of ['origin','target','rawFiles','catalog','legacyArchive','reject','delay']){let latest=env,release,entered;const waiting=new Promise(r=>entered=r);let defer=false;const {s,start}=await startSession(f.authority,async()=>{if(key==='reject'&&defer)throw Error('private');if(defer&&key==='delay'){entered();return new Promise(r=>release=r);}return latest;});try{const loaded=await s.request(c(2,'openCommitted',start)),g={...start,view:loaded.view};if(key!=='reject'&&key!=='delay'){latest=structuredClone(env);latest[key]={changed:true};}defer=true;let settled=false;const p=s.request(c(3,'openCommitted',g)).finally(()=>settled=true);const rejected=assert.rejects(p,rejection('environment_changed'));if(key==='delay'){await waiting;assert.equal(settled,false);release({...env,target:{changed:true}});}await rejected;latest=env;defer=false;await assert.rejects(s.request(c(4,'openCommitted',g)),rejection('stale_authority'));assert.equal((await s.request(c(5,'readPage',g,{kind:'attempts'}))).total,f.modern.graph.attempts.length);}finally{s.close();}}
});

test('PR5 v4 invalid coverage / R2 omission / unknown version rejects exact reasons, no mint',{timeout:30000},async()=>{
 const f=await versionedFixture();for(const [kind,expected]of [['coverage','reservation_coverage_invalid'],['r2','backup_reservations_missing'],['version','unsupported_backup']]){const b=structuredClone(f.backup);if(kind==='coverage')b.reservationCoverage.baselineStateSha256='a'.repeat(64);if(kind==='r2')b.reservedIds=[];if(kind==='version')b.backupVersion=5;const {s,start}=await startSession();let ids=0;const uuid=crypto.randomUUID;crypto.randomUUID=()=>{ids++;throw Error('ID_RAN');};try{await assert.rejects(s.request(c(2,'inspectBackupRaw',start),JSON.stringify(await seal(b))),rejection(expected));assert.equal(ids,0);}finally{crypto.randomUUID=uuid;s.close();}}
});

test('PR5 RPC rejects write/credential objects and closed DTO cannot grant commit',async()=>{
 for(const op of ['commit','save','write','exportBackup','adopt','protect','writeMode'])assert.throws(()=>validateControl(c(2,op,{session:'a'.repeat(48),view:'b'.repeat(48)})),rejection('protocol'));
 assert.throws(()=>validateControl({...c(2,'inspectAttemptRaw',{session:'a'.repeat(48),view:'b'.repeat(48)}),factory:'evil'}),rejection('protocol'));
 const {s,start}=await startSession();try{const result=await s.request(c(2,'inspectAttemptRaw',start),(await versionedFixture()).authority.raw);validateResult(result,'inspectAttemptRaw');const bad=structuredClone(result);bad.content.canCommit=true;assert.throws(()=>validateResult(bad,'inspectAttemptRaw'),rejection('protocol'));const extra=structuredClone(result);extra.content.raw='SECRET';assert.throws(()=>parseResponse(JSON.stringify({version:1,boot:1,requestId:2,type:'result',value:extra}),'inspectAttemptRaw'),rejection('protocol'));}finally{s.close();}
});

import {createPersistentAttemptSession} from '../src/planner/attempts/persistence/persistentSession.ts';
import {decodeStateJson,decodeBackupJson} from '../src/planner/attempts/persistence/contractDecoders.ts';
test('PR5 copied DTO/token/decoder values never enter synchronous save/ID/export registries',{timeout:30000},async()=>{
 const f=await versionedFixture(),{s,start}=await startSession(f.authority);let writes=0;const host=createPersistentAttemptSession({read:async()=>f.authority,commit:async()=>{writes++;throw Error('WRITE_RAN');}},undefined,env);try{const dto=await s.request(c(2,'openCommitted',start)),state=await decodeStateJson(f.authority.raw),backup=await decodeBackupJson(JSON.stringify(f.backup));
 for(const fake of [dto,structuredClone(dto),dto.handle,state,structuredClone(state.value),backup]){assert.throws(()=>host.identities(fake),/unverified_persistent_handle/);await assert.rejects(host.prepareEdits(fake,[]),/unverified_persistent_handle/);await assert.rejects(host.createBackup(fake),/unverified_persistent_handle/);}
 assert.equal(writes,0);
 }finally{s.close();}
});

test('PR5 pending read snapshot owns A, rejects B without rebinding; cancellation preserves usable old view',{timeout:30000},async()=>{
 const f=await versionedFixture();let record=f.authority,gate,entered,calls=0;const seen=new Promise(r=>entered=r),s=createPreviewSession(async()=>{calls++;const own=structuredClone(record);if(gate){entered();await gate;}return own;},async()=>env,1);try{const start=await s.request(c(1,'startSession')),v=await s.request(c(2,'openCommitted',start)),g={...start,view:v.view};let release;gate=new Promise(r=>release=r);const waiting=s.request(c(3,'openCommitted',g));await seen;s.cancel(3);release();await assert.rejects(waiting,rejection('cancelled'));gate=undefined;const rows=await s.request(c(4,'readPage',g,{kind:'attempts'}));assert.equal(rows.total,f.modern.graph.attempts.length);assert.equal((await s.request(c(5,'openCommitted',g))).content.ruleVersion,2);assert.ok(calls>3);
 }finally{s.close();}
});

import {preflight,INPUT_PROFILES} from '../src/planner/attempts/persistence/worker/workerInput.ts';
test('PR5 new inputs retain decoded duplicate/numeric/escaped-source and reservation gates',{timeout:30000},async()=>{
 const f=await versionedFixture();for(const raw of ['{"x":1,"\\u0078":2}','{"schemaVersion":-0}','{"schemaVersion":9007199254740993}','{"schemaVersion":1e999}'])assert.throws(()=>preflight(raw,'state'),e=>{assert.match(e.code,/duplicate_json_key|unrepresentable_json_number/);return true;});
 assert.throws(()=>preflight(f.authority.raw,'state',{...INPUT_PROFILES.state,reservedIds:0}),rejection('resource_limit'));
 const invalid=structuredClone(f.modern);invalid.rule.version=3;const {s,start}=await startSession();try{await assert.rejects(s.request(c(2,'inspectAttemptRaw',start),JSON.stringify(invalid)),rejection('unsupported_persistence_version'));}finally{s.close();}
 const changed=structuredClone(f.backup);changed.state.graph.attempts[0].originalTitle+='forged';const x=await startSession();try{await assert.rejects(x.s.request(c(2,'inspectBackupRaw',x.start),JSON.stringify(await seal(changed))),rejection('state_replay_mismatch'));}finally{x.s.close();}
});

test('PR5 environment change during full validation rejects before publish and after cancellation',{timeout:30000},async()=>{
 const f=await versionedFixture();let latest=env,change=false;const s=createPreviewSession(async()=>{if(change)latest={...env,target:{changed:true}};return f.authority;},async()=>latest,1);try{const start=await s.request(c(1,'startSession')),loaded=await s.request(c(2,'openCommitted',start)),g={...start,view:loaded.view};change=true;await assert.rejects(s.request(c(3,'openCommitted',g)),rejection('environment_changed'));assert.equal((await s.request(c(4,'readPage',g,{kind:'attempts'}))).total,f.modern.graph.attempts.length);latest=env;change=false;await assert.rejects(s.request(c(5,'openCommitted',g)),rejection('stale_authority'));}finally{s.close();}
});

test('PR5 A captured before awaited read never gets B provenance; previous displayed state survives',{timeout:30000},async()=>{
 const f=await versionedFixture();let record=f.authority,gate,entered;const waiting=new Promise(r=>entered=r),s=createPreviewSession(async()=>{const own=structuredClone(record);if(gate){entered();await gate;}return own;},async()=>env,1);try{const start=await s.request(c(1,'startSession')),v=await s.request(c(2,'openCommitted',start)),g={...start,view:v.view};let release;gate=new Promise(r=>release=r);const next=s.request(c(3,'openCommitted',g));const rejected=assert.rejects(next,rejection('stale_authority'));await waiting;record=structuredClone(record);record.reservationCoverage={policyVersion:2,kind:'legacy-unproven',baselineStateSha256:'a'.repeat(64)};release();gate=undefined;await rejected;record=f.authority;await assert.rejects(s.request(c(4,'openCommitted',g)),rejection('stale_authority'));assert.equal((await s.request(c(5,'readPage',g,{kind:'attempts'}))).total,f.modern.graph.attempts.length);}finally{s.close();}
});

test('PR5 old backup v3 remains inspectable on v2 host without conversion or promotion',{timeout:30000},async()=>{
 const f=await versionedFixture(),b=await seal({format:'hosei-attempt-backup',backupVersion:3,createdAt:'2026-11-02T00:00:00.000Z',state:f.state,reservedIds:f.legacy.issuedIds}),{s,start}=await startSession(f.authority);try{const i=await s.request(c(2,'inspectBackupRaw',start),JSON.stringify(b));validateResult(i,'inspectBackupRaw');assert.equal(i.backupVersion,3);assert.equal(i.content.ruleVersion,1);assert.equal(i.content.coverage,'explicit-migration-required');assert.equal(i.evidence,'portable-unadopted');const p=await s.request(c(3,'prepareSave',{...start,view:i.view},{restorePreview:i.restorePreview}));validateResult(p,'prepareSave');assert.equal(p.preview.canCommit,false);assert.equal(p.recoveryHint.candidateStateSha256,await backupDigest(f.state));assert.equal(p.preview.content.ruleVersion,1);}finally{s.close();}
});

// Small all-Command regression is separate from the unchanged 100+ receipt
// stress/oracle test. It keeps the full final-value oracle, without claiming
// that the long-history test completed within its original timeout.
for(const schema of [23,24])test(`PR5 rule1 schema${schema} eight Commands preserve complete state/Workspace/source`,{timeout:180000},async()=>{
 const {editProbe}=await import('./helpers/controller-edit-probe.mjs'),a=await editProbe();
 const s=a.createPreviewSession(async()=>a.emptyAuthority(),async()=>a.env,77);let id=0,v,session,draft;
 const call=async(op,extra={},raw)=>{const r=await s.request({version:1,boot:77,requestId:++id,op,...(session?{session,expectedView:v}:{}),...extra},raw);if(r?.view)v=r.view;if(r?.draft)draft=r.draft;return r;};
 const add={kind:'add',selection:null,title:'PR5 all Commands',plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''};
 const edit=intents=>call('prepareEdits',{draft,intents}),rows=async kind=>(await call('readPage',{kind})).rows;
 try{const start=await call('startSession');session=start.session;if(schema===23){const i=await call('inspectLegacyRaw',{},JSON.stringify(a.mixed()));assert.equal(i.status,'ready');await call('prepareMigration',{migration:i.migration});}else await call('prepareNewPlan');
 const initial=s.__probe().activeDraft.handle;
 await edit([add]);let attempt=(await rows('attempts')).at(-1).row;
 await edit([{kind:'edit',attempt,changes:{title:'edited'}}]);
 await edit([{kind:'add_record',owner:null,fields:{kind:'todo',text:'TODO',done:false}}]);
 let todo=(await rows('records')).filter(r=>r.kind==='todo').at(-1).row;
 await edit([{kind:'edit_payload',record:todo,changes:{kind:'todo',text:'updated',done:true}}]);
 todo=(await rows('records')).filter(r=>r.kind==='todo').at(-1).row;attempt=(await rows('attempts')).at(-1).row;
 await edit([{kind:'assign_todo',todo,owner:attempt,expectedOwner:null}]);
 todo=(await rows('records')).filter(r=>r.kind==='todo').at(-1).row;
 await edit([{kind:'delete_todo',todo}]);attempt=(await rows('attempts')).at(-1).row;
 await edit([{kind:'remove',attempt}]);const removal=(await rows('removals')).at(-1).row;
 await edit([{kind:'undo',removal}]);
 const actual=s.__probe().activeDraft.handle,commands=actual.workspace.receipts.slice(initial.workspace.receipts.length);assert.deepEqual(commands.map(c=>c.kind),['add','edit','add_record','edit_payload','assign_todo','delete_todo','remove','undo']);
 const r=await a.replayState(initial.state),record={raw:JSON.stringify(initial.state),revision:1,committed:[await a.backupDigest(initial.state)],issuedIds:r.requiredReservations};
 const oracle=a.createAttemptPersistence({read:async()=>record,commit:async()=>{throw Error('WRITE_RAN');}},undefined,a.env),h=await oracle.load(),expected=(await oracle.prepareEdits(h,commands)).handle;
 assert.deepEqual(actual.state,expected.state);assert.deepEqual(actual.workspace,expected.workspace);assert.deepEqual(actual.source,expected.source);assert.deepEqual((await a.replayState(actual.state)).requiredReservations,(await a.replayState(expected.state)).requiredReservations);assert.equal((await call('prepareSave',{draft})).preview.canCommit,false);
 }finally{s.close();}
});

test('PR5 v22 live migration on v2 host is explicitly unconnected, never coerces authority',{timeout:30000},async()=>{
 const f=await versionedFixture(),{s,start}=await startSession(f.authority);let ids=0;const uuid=crypto.randomUUID;crypto.randomUUID=()=>{ids++;throw Error('ID_RAN');};try{const {mixed}=await import('./fixtures/migration-fixture.mjs');await assert.rejects(s.request(c(2,'inspectLegacyRaw',start),JSON.stringify(mixed())),rejection('readonly_mode'));assert.equal(ids,0);assert.equal(await backupDigest(JSON.parse(f.authority.raw)),f.authority.committed[0]);}finally{crypto.randomUUID=uuid;s.close();}
});
