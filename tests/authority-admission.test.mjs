import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerAttemptSession, protectLegacyPlannerRaw } from '../src/planner/attempts/production/session.ts';
import { createAcController } from '../src/planner/attempts/production/acController.ts';
import { readLegacySnapshot } from '../src/planner/attempts/production/authorityAdmission.ts';
import { createAttemptPersistence } from '../src/planner/attempts/persistence/controller.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { requireAttemptAuthority } from '../src/planner/attempts/persistence/authorityFormat.ts';
import { env, mixed, originalRow, detail, media, schooling, initialState } from './fixtures/migration-fixture.mjs';
const locks = { request: async (_n, _o, fn) => fn() };
const placement = 'hosei:cp:b99c65d5-5917-422d-bda4-75a4f99ad8b7';
const input = JSON.stringify({ plannedYear: null, method: 'correspondence', status: 'planned' });
function memory(...args) {
  let state = structuredClone(args.length ? args[0] : emptyAuthority());
  return {
    writes: 0, failure: '', hook: null, afterWrite: null,
    snapshot: () => structuredClone(state),
    async read() { if (this.failure === 'read') throw Error('SecurityError'); return structuredClone(state); },
    async commit(e, n) {
      if (this.hook) await this.hook();
      assert.deepEqual(e, state, 'stale_commit');
      if (this.failure === 'quota') throw Error('QuotaExceededError');
      state = structuredClone(n); this.writes++;
      this.afterWrite?.();
      if (this.failure === 'unknown') throw Error('outcome_unknown');
    },
  };
}
function setup(primaryRaw = null, recoveryRaw = null, store = memory(), lock = locks) {
  const legacy = { primaryRaw, recoveryRaw };
  const api = createPlannerAttemptSession(store, lock, { readLegacy: () => ({ ...legacy }), migrationEnvironment: async () => env });
  return { api, store, legacy };
}
const save = async api => api.save(await api.prepareSave(), true);
const raw22 = () => ' \n' + JSON.stringify(mixed(), null, 2) + '\r\n';
async function migrated() {
  const x = setup(raw22(), 'broken old recovery\t'); await x.api.load();
  const p = await x.api.prepareMigration(x.legacy.primaryRaw); await x.api.save(p, true); return x;
}
test('A → D: no write on load/preview, explicit schema24, repeated save and reload', async () => {
  const {api,store} = setup(); assert.equal(await api.load(), null); assert.equal(api.admission().case, 'A');
  const p = await api.prepareSave(); assert.equal(store.writes, 0); await assert.rejects(api.save(p, false), /confirmation/);
  await api.save(p, true); const before = store.snapshot(); assert.equal(api.admission().case, 'D');
  await save(api); assert.equal(store.snapshot().revision, before.revision + 1);
  assert.deepEqual(JSON.parse(store.snapshot().raw), JSON.parse(before.raw));
  const reload = setup(null, null, store).api; await reload.load(); assert.equal(reload.admission().case, 'D');
});
test('B: legacy is never an empty latest plan; migration preview is read only and mismatched source refused', async () => {
  const {api,store,legacy} = setup(raw22(), 'recovery\t');
  const c = createAcController(api); assert.equal(await c.load(), true);
  assert.equal(c.getSnapshot().admission.case, 'B'); assert.equal(c.getSnapshot().graph, null);
  assert.equal(c.getSnapshot().admission.canCreate, false); assert.match(c.getSnapshot().notice, /旧schema22/);
  assert.equal(await c.prepare(), false); assert.equal(store.writes, 0);
  await assert.rejects(api.prepareMigration(JSON.stringify(initialState())), /migration_source_conflict/);
  await c.prepareMigration(legacy.primaryRaw); const p = c.getSnapshot().proposal;
  assert.equal(store.writes, 0); assert.deepEqual(JSON.parse(p.protectionRaw).legacy, legacy);
  c.cancel(); assert.equal(store.writes, 0); assert.equal(api.admission().case, 'B');
});
test('B → E → C: migration provenance, existing schema23 and source drift are distinguished', async () => {
  const {api,store,legacy} = await migrated(); const before = store.snapshot(), raw = legacy.primaryRaw;
  assert.equal(api.admission().case, 'E'); assert.equal(api.admission().canEdit, true);
  assert.equal(JSON.parse(before.raw).source.raw, raw); assert.equal(legacy.recoveryRaw, 'broken old recovery\t');
  const e = setup(raw, legacy.recoveryRaw, store).api; await e.load(); assert.equal(e.admission().canEdit, true);
  const c = setup(null, null, store).api; await c.load(); assert.equal(c.admission().case, 'C');
  const changed = JSON.parse(raw); changed.items[0].plannedYear = 2040;
  const conflict = setup(JSON.stringify(changed), null, store).api; const graph = await conflict.load();
  assert.ok(graph.attempts.length); assert.equal(conflict.admission().case, 'E'); assert.equal(conflict.admission().canEdit, false);
  assert.throws(() => conflict.add(placement, input), /not_editable/); await assert.rejects(conflict.prepareSave(), /authority_save_blocked/);
  assert.deepEqual(store.snapshot(), before); assert.equal(legacy.primaryRaw, raw);
});
test('F: old22 + schema24 is a visible separate-plan conflict with no writes', async () => {
  const {api,store} = setup(); await api.load(); await save(api); api.add(placement, input); await save(api);
  const before = store.snapshot(), x = setup(raw22(), null, store), c = createAcController(x.api); await c.load();
  assert.equal(c.getSnapshot().admission.case, 'F'); assert.ok(c.getSnapshot().graph.attempts.length);
  assert.equal(c.getSnapshot().ready, false); assert.match(c.getSnapshot().notice, /別計画/);
  assert.equal(c.add(placement,input), false); await assert.rejects(x.api.prepareMigration(x.legacy.primaryRaw), /migration_blocked/);
  assert.deepEqual(store.snapshot(), before);
});
for (const [label, primary, recovery] of [
  ['broken', '{oops', null], ['empty text', '', null], ['future', '{"schemaVersion":99}', null],
  ['unknown fields', JSON.stringify({...mixed(), unrecognized: {raw:'must retain'}}), null],
  ['old curriculum/unsupported', JSON.stringify({...mixed(),schemaVersion:21}), null], ['recovery only', null, raw22()],
]) test(`G ${label}: no create/migrate/normalization, exact primary and recovery protection`, async () => {
  const {api,store,legacy} = setup(primary,recovery); await api.load();
  assert.equal(api.admission().case, 'G'); await assert.rejects(api.prepareSave(), /blocked/);
  await assert.rejects(api.prepareMigration(raw22()), /blocked/); assert.equal(store.writes, 0);
  const protection = JSON.parse(await protectLegacyPlannerRaw({getItem:k=>k.endsWith(':recovery')?legacy.recoveryRaw:legacy.primaryRaw}));
  assert.equal(protection.primaryRaw,primary); assert.equal(protection.recoveryRaw,recovery);
});
for (const value of [null, undefined, '{"format":"hosei-grade-import-host","hostVersion":1}',
  {format:'hosei-grade-import-host',hostVersion:2}, {raw:null,revision:1,committed:[],issuedIds:[]},
  {raw:'{"schemaVersion":24,"format":"other"}',revision:1,committed:['a'.repeat(64)],issuedIds:[]}])
test(`H foreign/corrupt authority ${JSON.stringify(value)} refuses all writes`, async () => {
  assert.throws(()=>requireAttemptAuthority(value)); const store = memory(value), {api} = setup(null,null,store);
  await assert.rejects(api.load()); assert.equal(api.admission().case, 'H');
  await assert.rejects(api.prepareSave(), /requires_reload/); assert.equal(store.writes,0); assert.deepEqual(store.snapshot(),value);
});
for (const key of ['primaryRaw','recoveryRaw']) test(`I: ${key} changes after confirmation, including under queued Web Lock`, async () => {
  let atLock = false, change = () => {};
  const lock = {request:async(_n,_o,fn)=>{if(atLock)change();return fn();}};
  const {api,store,legacy} = setup(null,null,memory(),lock); await api.load(); const p = await api.prepareSave();
  change = () => { legacy[key] = key==='primaryRaw'?raw22():'new recovery'; }; atLock=true;
  await assert.rejects(api.save(p,true), /legacy_changed/); assert.equal(store.writes,0);
  assert.throws(()=>api.add(placement,input), /not_editable/); await assert.rejects(api.save(p,true), /stale_preview/);
  await assert.rejects(api.prepareSave(), /requires_reload/); atLock=false; await api.load();
  assert.equal(api.admission().case,key==='primaryRaw'?'B':'G');
});
test('I: synchronous draft edit detects legacy drift and revokes controller permissions', async () => {
  const {api,store,legacy} = await migrated(), c = createAcController(api); await c.load(); const before=store.snapshot();
  legacy.primaryRaw += ' '; assert.equal(c.add(placement,input),false); assert.equal(c.getSnapshot().ready,false);
  assert.deepEqual(store.snapshot(),before); await c.load(); assert.equal(c.getSnapshot().admission.case,'E');
});
for (const first of ['new','migration']) test(`I: new initialization vs migration CAS, ${first} wins`, async () => {
  const store=memory(), a=setup(null,null,store).api, b=setup(null,null,store).api; await a.load();await b.load();
  const np=await a.prepareSave(), mp=await b.prepareMigration(raw22());
  const winner=first==='new'?a:b, loser=first==='new'?b:a, wp=first==='new'?np:mp, lp=first==='new'?mp:np;
  await winner.save(wp,true);const before=store.snapshot();await assert.rejects(loser.save(lp,true),/stale_commit/);
  assert.deepEqual(store.snapshot(),before);await assert.rejects(loser.save(lp,true),/stale_preview/);
  await loser.load();assert.equal(loser.admission().case,first==='new'?'D':'C');
});
test('I: existing authority is not replaced by initialization or another migration', async () => {
  const {store}=await migrated(), {api}=setup(null,null,store);await api.load();const before=store.snapshot();
  await assert.rejects(api.prepareMigration(raw22()),/blocked/);await save(api);
  assert.deepEqual(JSON.parse(store.snapshot().raw),JSON.parse(before.raw));
});
for (const fault of ['quota','unknown','readback','legacy-after-write','storage-read']) test(`J ${fault}: no false UI success; failure consumes permission until reload`, async () => {
  const {api,store,legacy}=setup(), c=createAcController(api);await c.load();await c.prepare();await c.save(c.getSnapshot().proposal,true);
  c.add(placement,input);await c.prepare();const p=c.getSnapshot().proposal,before=store.snapshot();
  if(fault==='readback')store.afterWrite=()=>store.failure='read';
  else if(fault==='legacy-after-write')store.afterWrite=()=>legacy.primaryRaw=raw22();
  else store.failure=fault==='storage-read'?'read':fault;
  if(fault==='storage-read'){assert.equal(await c.load(),false);assert.equal(c.getSnapshot().ready,false);}
  else {assert.equal(await c.save(p,true),false);assert.equal(c.getSnapshot().ready,false);assert.doesNotMatch(c.getSnapshot().notice,/保存済み/);}
  assert.equal(c.add(placement,input),false);store.failure='';store.afterWrite=null;
  const after=store.snapshot();if(fault==='quota'||fault==='storage-read')assert.deepEqual(after,before);else assert.equal(after.revision,before.revision+1);
  await c.load();assert.equal(c.getSnapshot().admission.case,fault==='legacy-after-write'?'F':'D');assert.deepEqual(store.snapshot(),after);
});
test('retained 4/0/null, メ, manual matching, old curriculum, recognition, thesis, all progress and Undo survive canonical backup/restore', async () => {
  let state=mixed(); const scope=env.origin.programs.find(p=>p.department==='地理学科').scopeId;
  state.selectedScopeId=scope;state.graduationProfile.curriculumApplicability='legacy_or_transition';
  state.thesisProgressByScope[scope]={selection:'selected',status:'in_progress'};
  state.thesisGuidanceByScope[scope]={steps:{first:{status:'passed',passedOn:'2026-09-01'}},geographyReportSubmitted:false};
  state.graduationProfile.recognizedCredits.totalCredits=4;
  state.importedCourseAchievements=[originalRow({earnedCreditsTotal:4}), originalRow({id:'official-0',fingerprint:'fp0',earnedCreditsTotal:0}),originalRow({id:'official-null',fingerprint:'fpnull',earnedCreditsTotal:null})];
  state.importedStudyRecords[0].rawTerm='メ';
  Object.assign(state.importedCourseAchievements[1],{rawName:schooling.name,courseId:schooling.courseId,selectedOfferingId:schooling.id,selectionSource:'manual',match:'exact_unique',candidateOfferingIds:[schooling.id]});
  state.importedStudyRecords.push(detail({id:'detail-manual',fingerprint:'detail-manual-fingerprint',sourceCourseId:'official-0',offeringId:schooling.id,match:'exact_unique',rawName:schooling.name,method:'schooling',rawTerm:'過年度',credits:0}));
  // Construct a fixture already saved by the legacy loader. This setup is not
  // the migration path: the raw protection boundary is fixed below, afterwards.
  const {loadState}=await import('../src/planner/backup/storage.ts');
  const initialized=loadState({getItem:()=>JSON.stringify(state),setItem(){throw Error('fixture must not write');}},env.origin);
  assert.equal(initialized.error,null);state=initialized.state;
  assert.deepEqual(state.importedCourseAchievements.map(r=>r.earnedCreditsTotal),[4,0,null]);
  assert.equal(state.importedCourseAchievements[1].selectionSource,'manual');
  const raw=' \n'+JSON.stringify(state)+'\r\n', {api,store,legacy}=setup(raw,'legacy recovery bytes\t');
  const {decodeMigrationSource}=await import('../src/planner/attempts/migration/source.ts');
  const decoded=await decodeMigrationSource(raw,env,env.origin);assert.equal(decoded.status,'decoded',JSON.stringify(decoded.diagnostics));
  await api.load();const p=await api.prepareMigration(raw);await api.save(p,true);
  const saved=JSON.parse(store.snapshot().raw);assert.deepEqual(saved.retained.importedCourseAchievements,state.importedCourseAchievements);
  assert.deepEqual(saved.retained.importedStudyRecords,state.importedStudyRecords);assert.deepEqual(saved.retained.graduationProfile,state.graduationProfile);
  assert.deepEqual(saved.retained.thesisProgressByScope,state.thesisProgressByScope);assert.deepEqual(saved.retained.thesisGuidanceByScope,state.thesisGuidanceByScope);
  assert.equal(saved.source.raw,raw);const graph=api.graph();
  for(const [kind,field] of [['media','mediaSchoolingProgress'],['correspondence','correspondenceProgress'],['evaluation','courseEvaluations']]) {
    for(const old of Object.values(state[field])) {const {offeringId,...payload}=old;void offeringId;assert.ok(graph.ownedRecords.some(r=>r.kind===kind&&JSON.stringify(r.payload)===JSON.stringify(payload)));}
  }
  const id=graph.attempts[0].id;api.remove(id);await save(api);await api.load();api.undo(id);await save(api);assert.deepEqual(api.graph(),graph);
  const canonical=createAttemptPersistence(store,locks,env), h=await canonical.load(), backup=await canonical.createBackup(h);
  const receiver=memory(), restore=createAttemptPersistence(receiver,locks,env), preview=await restore.inspectBackup(backup);
  assert.equal(receiver.writes,0);await assert.rejects(restore.commit(preview,true,preview.previousRaw,preview.sourceRaw),/adoption/);
  await restore.commit(preview,true,preview.previousRaw,preview.sourceRaw,{acceptedBackupRawSha256:preview.recovery.rawSha256,protectedBackupRaw:backup});
  assert.deepEqual((await restore.load()).state,(await canonical.load()).state);
  assert.equal(legacy.primaryRaw,raw);assert.equal(legacy.recoveryRaw,'legacy recovery bytes\t');
});
test('nested media UUID remains held with no source/DB writes', async () => {
  const state=mixed();state.mediaSchoolingProgress[media.id].assessments[0].id=crypto.randomUUID();
  const {api,store,legacy}=setup(JSON.stringify(state));await api.load();
  await assert.rejects(api.prepareMigration(legacy.primaryRaw),/nested_identity_history/);assert.equal(store.writes,0);
});
test('legacy read access failure is distinct from absence', () => {
  assert.throws(()=>readLegacySnapshot({getItem(){throw Error('SecurityError');}}),/SecurityError/);
  assert.deepEqual(readLegacySnapshot({getItem:()=>null}),{primaryRaw:null,recoveryRaw:null});
});
test('production backup/restore uses one authority, explicit portable adoption and verified readback', async () => {
  const x=setup();await x.api.load();await save(x.api);x.api.add(placement,input);await save(x.api);
  const backup=await x.api.createBackup();assert.equal(JSON.parse(backup).backupVersion,3);
  const y=setup();await y.api.load();const p=await y.api.prepareRestore(backup);assert.equal(y.store.writes,0);
  assert.equal(JSON.parse(p.protectionRaw).backupRaw,backup);assert.ok(p.adoptionSha256);
  await assert.rejects(y.api.save(p,true),/adoption/);assert.equal(y.store.writes,0);assert.equal(y.api.admission().canEdit,false);
  await y.api.load();const accepted=await y.api.prepareRestore(backup);await y.api.save(accepted,true,accepted.adoptionSha256);
  assert.deepEqual(y.api.graph(),x.api.graph());assert.equal(y.api.admission().case,'D');
  const stale=setup(null,null,x.store).api;await stale.load();x.api.add(placement,input);await save(x.api);
  await assert.rejects(stale.createBackup(),/stale_backup/);assert.throws(()=>stale.add(placement,input),/not_editable/);
});
test('restore cannot create schema24 over legacy22, or adopt another migrated source', async () => {
  const x=setup();await x.api.load();await save(x.api);const backup=await x.api.createBackup();
  const old=setup(raw22());await old.api.load();await assert.rejects(old.api.prepareRestore(backup),/restore_source_conflict/);assert.equal(old.store.writes,0);
  const unrelated=setup();await unrelated.api.load();await unrelated.api.save(await unrelated.api.prepareMigration(JSON.stringify(initialState())),true);
  const migratedBackup=await unrelated.api.createBackup();await assert.rejects(old.api.prepareRestore(migratedBackup),/restore_source_conflict/);
  const p=await old.api.prepareMigration(old.legacy.primaryRaw);await old.api.prepareRestore('broken').catch(()=>{});
  await assert.rejects(old.api.save(p,true),/stale_preview/);assert.equal(old.store.writes,0);
});
test('E verified explicit date-correction lineage remains editable against its exact protected original', async () => {
  const state=mixed();state.mediaSchoolingProgress[media.id].assessments[0].scheduledDate='2027-02-30';
  const raw=JSON.stringify(state),store=memory(),core=createAttemptPersistence(store,locks,env),s=await core.inspectLegacy(raw);
  assert.equal(s.preview.status,'held');const correction=await core.proposeDate(s,media.id,'assessment/raw~id',null);
  const fixed=await core.confirmDate(s,correction,true),p=await core.prepareMigration(fixed);await core.commit(p,true,p.previousRaw,p.sourceRaw);
  const {api}=setup(raw,null,store);await api.load();assert.equal(api.admission().case,'E');assert.equal(api.admission().canEdit,true);
  await save(api);const saved=JSON.parse(store.snapshot().raw);assert.equal(saved.corrections[0].originalRaw,raw);
});
