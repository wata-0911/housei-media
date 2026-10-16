import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env, mixed, initialState, decode, media, item, schooling } from './fixtures/migration-fixture.mjs';
import { createAttemptPersistence } from '../src/planner/attempts/persistence/controller.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { encodeState, replayState } from '../src/planner/attempts/persistence/codec.ts';
import { backupDigest } from '../src/planner/backup/plannerBackupCompatibility.ts';
import { newOperationId, newAttemptIds, newRecordId } from '../src/planner/attempts/workbench/operations.ts';
import { validateMigrationAssignments } from '../src/planner/attempts/migration/assignments.ts';
import { PLANNER_WRITE_LOCK } from '../src/planner/backup/storage.ts';
import { buildMigrationTarget } from '../src/planner/attempts/migration/transform.ts';
import { applyCommand } from '../src/planner/attempts/workbench/operations.ts';
import { makeAttempt } from '../src/planner/attempts/workbench/catalogView.ts';

const locks = { request: async (name, options, action) => { assert.equal(name, PLANNER_WRITE_LOCK); assert.deepEqual(options, { mode: 'exclusive' }); return action(); } };
function memory() {
  let data = emptyAuthority(); const store = { reads: 0, writes: 0, failure: '',
    async read() { store.reads++; if (store.failure === 'read') throw new Error('SecurityError read'); return structuredClone(data); },
    async commit(expected, next) {
      if (store.failure === 'write') throw new Error('SecurityError write');
      if (store.failure === 'quota') throw new Error('QuotaExceededError');
      assert.deepEqual(data, expected, 'CAS'); store.writes++; data = structuredClone(next);
    },
    snapshot: () => structuredClone(data), corrupt: fn => { fn(data); },
  }; return store;
}
const create = (store, lock = locks) => createAttemptPersistence(store, lock, env);
async function start(store = memory(), state = mixed(), kind = 'local') {
  const api = create(store); const decoded = await decode(state, kind); assert.equal(decoded.status, 'decoded');
  const session = await api.inspectLegacy(decoded.source.raw); assert.equal(session.preview.status, 'ready');
  const preview = await api.prepareMigration(session);
  const loaded = await api.commit(preview, true, preview.previousRaw, preview.sourceRaw); return { store, api, loaded };
}
async function save(api, loaded, commands) { const p = await api.prepareEdits(loaded, commands); return api.commit(p, true, p.previousRaw, p.sourceRaw); }
const remove = a => ({ kind: 'remove', attemptId: a.id, operationId: newOperationId() });
const undo = t => ({ kind: 'undo', attemptId: t.attemptSnapshot.id, removalOperationId: t.operationId, operationId: newOperationId() });
const add = (title = '独立履修回') => { const ids = newAttemptIds(); return { kind: 'add', operationId: ids.creationOperationId,
  attempt: makeAttempt(env.catalog, { title, courseId: null, placementId: null, plan: { plannedYear: 2035, plannedTerm: null, studyYear: null, status: 'planned', contribution: {value:null,source:'learner',note:null}, earnedOrder: null }, method: 'media', note: '' }, ids) }; };

for (const kind of ['local', 'v1', 'v2']) for (const fixture of ['manual', 'official', 'mixed', 'orphan']) test(`migration ${kind}/${fixture}: lossless source, quantities, ordering and reload`, async () => {
  const state = fixture === 'manual' ? initialState() : mixed();
  if (fixture === 'manual') state.items = [{ ...item(schooling), courseCreditContribution: 0 }];
  if (fixture === 'official' || fixture === 'orphan') state.items = [];
  if (fixture === 'official') { state.todos = []; state.mediaSchoolingProgress = {}; state.correspondenceProgress = {}; state.courseEvaluations = {}; }
  const { store, loaded } = await start(memory(), state, kind);
  const second = await create(store).load(); assert.deepEqual(second.state, loaded.state); assert.deepEqual(second.workspace, loaded.workspace);
  assert.deepEqual(second.source.state, state); assert.deepEqual(second.state.retained.importedCourseAchievements, state.importedCourseAchievements);
  assert.deepEqual(second.state.retained.importedCourseUserMeta, state.importedCourseUserMeta); assert.equal(store.writes, 1);
  assert.throws(() => validateMigrationAssignments(second.source, second.state.assignments, second.state.assignments.reservedIds), /unverified_assignment_history/);
});
test('preview and cancellation write nothing, repeated inspect retains issuance', async () => {
  const store = memory(), api = create(store), raw = JSON.stringify(mixed());
  const [a,b] = await Promise.all([api.inspectLegacy(raw), api.inspectLegacy(raw)]); assert.equal(a, b);
  const p = await api.prepareMigration(a); assert.ok(p.bytes > 1000000); assert.equal(store.writes, 0);
  await assert.rejects(api.commit(p, false, null, p.sourceRaw), /confirmation/);
  await assert.rejects(api.commit(p, true, 'wrong', p.sourceRaw), /protection/); assert.equal(store.writes, 0);
});
test('copied sessions, handles, previews cannot mint a durable witness', async () => {
  const store = memory(), api = create(store), s = await api.inspectLegacy(JSON.stringify(mixed()));
  await assert.rejects(api.prepareMigration(structuredClone(s)), /not_ready/);
  const p = await api.prepareMigration(s);
  await assert.rejects(api.commit(structuredClone(p), true, null, p.sourceRaw), /confirmation/);
  await assert.rejects(api.prepareEdits(structuredClone(p.handle), []), /unverified_assignment_history/); assert.equal(store.writes, 0);
});
for (const date of ['2027-02-30', '2027-99-99']) for (const next of ['2028-02-29', null]) test(`held ${date}, explicit correction ${next}, original and IDs survive reload`, async () => {
  const state = mixed(); state.mediaSchoolingProgress[media.id].assessments[0].scheduledDate = date;
  const store = memory(), api = create(store), session = await api.inspectLegacy(JSON.stringify(state)); assert.equal(session.preview.status, 'held');
  await assert.rejects(api.prepareMigration(session), /not_ready/);
  const proposal = await api.proposeDate(session, media.id, 'assessment/raw~id', next);
  await assert.rejects(api.confirmDate(session, proposal, false), /confirmation/);
  const corrected = await api.confirmDate(session, proposal, true); assert.equal(corrected.preview.status, 'ready');
  assert.equal(await api.confirmDate(session, proposal, true), corrected);
  const p = await api.prepareMigration(corrected); const loaded = await api.commit(p, true, null, p.sourceRaw);
  const reloaded = await create(store).load(); assert.deepEqual(reloaded.state, loaded.state);
  assert.equal(reloaded.state.corrections[0].originalRaw, session.raw);
  assert.notEqual(reloaded.state.assignments.attempts[0].attemptId, session.table.attempts[0].attemptId);
});
test('CRUD replay is durable and conflicting operation replay is refused', async () => {
  let { store, api, loaded } = await start(); const command = add(); loaded = await save(api, loaded, [command]);
  api = create(store); loaded = await api.load(); const before = loaded.workspace.graph.attempts.length;
  loaded = await save(api, loaded, [command]); assert.equal(loaded.workspace.graph.attempts.length, before);
  await assert.rejects(api.prepareEdits(loaded, [{ ...command, attempt: { ...command.attempt, originalTitle: '改変' } }]), /replay_conflict/);
  loaded = await save(api, loaded, [add()]); assert.equal(loaded.workspace.graph.attempts.length, before + 1);
  assert.deepEqual(loaded.state.retained.importedCourseAchievements, mixed().importedCourseAchievements);
});
for (const order of [[0,1],[1,0],[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]) test(`durable LIFO ${order}: full snapshot/owner/payload and active order`, async () => {
  let { store, api, loaded } = await start(); const original = structuredClone(loaded.workspace.graph), rows = original.attempts;
  loaded = await save(api, loaded, order.map(i => remove(rows[i])));
  api = create(store); loaded = await api.load();
  await assert.rejects(api.prepareEdits(loaded, [undo(loaded.workspace.graph.removals[0])]), /undo_order_conflict/);
  const commands = [...loaded.workspace.graph.removals].reverse().map(undo); loaded = await save(api, loaded, commands);
  assert.deepEqual(loaded.workspace.graph.attempts.filter(a=>a.membership.kind==='active').map(a=>a.id), rows.map(a=>a.id));
  assert.deepEqual(loaded.workspace.graph.ownedRecords, original.ownedRecords); assert.deepEqual(loaded.workspace.graph.removals, []);
});
test('deleted TODO and record IDs cannot be reused after reload or backup rollback', async () => {
  let { store, api, loaded } = await start(); const backup = await api.createBackup(loaded);
  const record = { id: newRecordId(), kind: 'todo', owner: null, payload: { id: crypto.randomUUID(), text: '一度だけ', done: false } };
  loaded = await save(api, loaded, [{ kind: 'add_record', operationId: newOperationId(), record }, { kind: 'delete_todo', operationId: newOperationId(), recordId: record.id }]);
  api = create(store); loaded = await api.load();
  await assert.rejects(api.prepareEdits(loaded, [{ kind: 'add_record', operationId: newOperationId(), record }]), /historical_id_reused/);
  const p = await api.inspectBackup(backup); loaded = await api.commit(p, true, p.previousRaw, p.sourceRaw);
  await assert.rejects(api.prepareEdits(loaded, [{ kind: 'add_record', operationId: newOperationId(), record: { ...record, id: newRecordId() } }]), /historical_id_reused/);
});
for (const change of [s=>s.history.commands.pop(), s=>s.graph.removals[0].previousPosition++, s=>s.graph.removals.reverse(), s=>s.graph.removals[0].attemptSnapshot.originalTitle='偽snapshot', s=>s.graph.ownedRecords[0].owner.attemptId=s.graph.attempts[1].id]) test(`damaged history/owner rejected by replay: ${change}`, async () => {
  const { api, loaded } = await start(); const p = await api.prepareEdits(loaded, loaded.workspace.graph.attempts.map(remove));
  const state = structuredClone(p.handle.state); change(state); await assert.rejects(replayState(state));
});
test('new backup roundtrip replaces, repeated restore does not multiply, portable preview requires adoption', async () => {
  const { store, api, loaded } = await start(); const backup = await api.createBackup(loaded);
  const foreign=create(memory()), imported=await foreign.inspectBackup(backup);
  await assert.rejects(foreign.commit(imported,true,null,imported.sourceRaw), /portable_adoption/);
  for (let i=0;i<2;i++) { const p=await api.inspectBackup(backup); const next=await api.commit(p,true,p.previousRaw,p.sourceRaw); assert.deepEqual(next.state,loaded.state); }
  assert.equal(store.writes,3);
});
for (const mutate of [b=>b.extra=1,b=>b.backupVersion=999,b=>b.createdAt='2027-02-30T00:00:00.000Z',b=>b.state.graph.attempts[0].originalTitle='偽造',b=>delete b.state.source.rawFiles,b=>b.state.schemaVersion=999]) test(`backup corruption refuses without writes: ${mutate}`, async () => {
  const { store,api,loaded }=await start(); const before=store.snapshot(); const value=JSON.parse(await api.createBackup(loaded)); mutate(value);
  await assert.rejects(api.inspectBackup(JSON.stringify(value))); assert.deepEqual(store.snapshot(),before);
});
test('rehashed inconsistent state, duplicate JSON and protection rejected', async () => {
  const { store,api,loaded }=await start(); const b=JSON.parse(await api.createBackup(loaded)); b.state.graph.attempts[0].originalTitle='偽造'; const {sha256,...body}=b; void sha256; b.sha256=await backupDigest(body);
  await assert.rejects(api.inspectBackup(JSON.stringify(b)),/state_replay_mismatch/);
  await assert.rejects(api.inspectBackup('{"format":"a","format":"b"}'),/duplicate_json_key/);
  await assert.rejects(api.inspectBackup('{"format":"hosei-planner-protection","protectionVersion":1}'));
  assert.equal(store.writes,1);
});
for (const failure of ['read','write','quota','no-lock']) test(`${failure}: fail closed with no partial commit or rollback`,async()=>{
  const store=memory(), api=create(store, failure==='no-lock' ? null : locks), s=await api.inspectLegacy(JSON.stringify(mixed())), p=await api.prepareMigration(s), before=store.snapshot();
  store.failure=failure;
  if(failure==='read') await assert.rejects(api.load(),/SecurityError/);
  else await assert.rejects(api.commit(p,true,null,p.sourceRaw));
  assert.equal(store.writes,0); assert.deepEqual(store.snapshot(),before);
});
test('stale preview and Web Lock queued update both reject',async()=>{
  const store=memory(); let release; const queued={request:async(_n,_o,fn)=>{ await new Promise(r=>release=r); return fn(); }};
  const a=create(store,queued), b=create(store); const pa=await a.prepareMigration(await a.inspectLegacy(JSON.stringify(mixed())));
  const attempt=a.commit(pa,true,null,pa.sourceRaw); while(!release) await new Promise(r=>setTimeout(r,5));
  const pb=await b.prepareMigration(await b.inspectLegacy(JSON.stringify(initialState()))); await b.commit(pb,true,null,pb.sourceRaw); const before=store.snapshot();
  release(); await assert.rejects(attempt,/CAS/); assert.deepEqual(store.snapshot(),before); assert.equal(store.writes,1);
});
test('corrupted current JSON is preserved, no automatic initialization or downgrade',async()=>{
  const {store}=await start(); store.corrupt(s=>s.raw='{ broken original bytes'); const before=store.snapshot(); await assert.rejects(create(store).load()); assert.deepEqual(store.snapshot(),before); const protection=JSON.parse(await create(store).protectCurrent()); assert.equal(protection.currentRaw,before.raw); assert.equal(protection.committed,undefined);
});
test('all owned payload CRUD and detached edit survive save/reload with retained official data',async()=>{
  let {store,api,loaded}=await start(); const original=structuredClone(loaded.state.retained), record=loaded.workspace.graph.ownedRecords.find(r=>r.kind==='media'), todo=loaded.workspace.graph.ownedRecords.find(r=>r.kind==='todo');
  const commands=[{kind:'edit_payload',operationId:newOperationId(),recordId:record.id,payload:{...record.payload,assessments:record.payload.assessments.map(a=>({...a,completed:true,scheduledDate:'2028-02-29'}))}},
    {kind:'assign_todo',operationId:newOperationId(),recordId:todo.id,expectedOwner:todo.owner,owner:null},
    {kind:'edit_payload',operationId:newOperationId(),recordId:todo.id,payload:{...todo.payload,text:'編集済み',done:true}}];
  for(const r of loaded.workspace.graph.ownedRecords.filter(r=>['correspondence','evaluation'].includes(r.kind))) commands.push({kind:'edit_payload',operationId:newOperationId(),recordId:r.id,payload:{...r.payload,...(r.kind==='evaluation'?{finalGrade:'S'}:{examGrade:'A',calligraphyBatchStatus:'grading'})}});
  loaded=await save(api,loaded,commands);const before=loaded.state;api=create(store);loaded=await api.load();assert.deepEqual(loaded.state,before);assert.deepEqual(loaded.state.retained,original);
  const a=loaded.workspace.graph.attempts[0];loaded=await save(api,loaded,[remove(a)]);const r=loaded.workspace.graph.ownedRecords.find(r=>r.kind==='media');loaded=await save(api,loaded,[{kind:'edit_payload',operationId:newOperationId(),recordId:r.id,payload:{...r.payload,totalLessons:12}}]);
  api=create(store);loaded=await api.load();loaded=await save(api,loaded,[undo(loaded.workspace.graph.removals.at(-1))]);assert.equal(loaded.workspace.graph.ownedRecords.find(row=>row.id===r.id).payload.totalLessons,12);
});
for(const value of [undefined,null,0,2])test(`future Offering-free same-name attempt contribution ${value} survives restart`,async()=>{
  const {store,api,loaded}=await start();const a=add(),b=add();for(const c of [a,b]){if(value===undefined)delete c.attempt.plan.contribution;else c.attempt.plan.contribution.value=value;}
  const next=await save(api,loaded,[a,b]), reloaded=await create(store).load();assert.deepEqual(next.state,reloaded.state);assert.notEqual(a.attempt.id,b.attempt.id);assert.deepEqual(a.attempt.legacyRefs,[]);
});
for(const raw of ['not JSON','{"schemaVersion":22,"schemaVersion":22}','{"schemaVersion":999}',JSON.stringify({...initialState(),extra:true})])test(`unsupported source never changes store: ${raw.slice(0,40)}`,async()=>{
  const store=memory(),api=create(store),s=await api.inspectLegacy(raw);await assert.rejects(api.prepareMigration(s),/not_ready/);assert.deepEqual(store.snapshot(),emptyAuthority());
});
for(const change of [s=>s.catalog.metadata.graduationCheckComplete=true,s=>s.source.rawFileSha256[Object.keys(s.source.rawFileSha256)[0]]='0'.repeat(64),s=>s.rule.version=2,s=>s.assignments.attempts[0].attemptId=s.assignments.attempts[1].attemptId,s=>s.history.usedTodoIds=[],s=>s.history.commands.push(s.history.commands[0])])test(`strict replay refuses catalog/hash/rule/ID/history damage: ${change}`,async()=>{
  const {api,loaded}=await start();const p=await api.prepareEdits(loaded,[remove(loaded.workspace.graph.attempts[0])]);const value=structuredClone(p.handle.state);change(value);await assert.rejects(replayState(value));
});
test('capacity limit refuses the complete archive, never omits or splits it',async()=>{
  const store=memory(),api=createAttemptPersistence(store,locks,env,1024),s=await api.inspectLegacy(JSON.stringify(mixed())),p=await api.prepareMigration(s);
  assert.ok(p.bytes>1024);await assert.rejects(api.commit(p,true,null,p.sourceRaw),/capacity_limit/);assert.equal(store.writes,0);assert.deepEqual(store.snapshot(),emptyAuthority());
});
test('new UUIDs cannot collide with retained non-Attempt IDs or each other',async()=>{
 const {api,loaded}=await start();const a=add();a.attempt.id=`hosei:attempt:${loaded.state.retained.publicCourses[0].id}`;await assert.rejects(api.prepareEdits(loaded,[a]),/historical_id_reused/);
 const operationId=newOperationId(),record={id:newRecordId(),kind:'todo',owner:null,payload:{id:operationId.split(':').at(-1),text:'collision',done:false}};
 await assert.rejects(api.prepareEdits(loaded,[{kind:'add_record',operationId,record}]),/historical_id_reused/);
 const pending=add(),todo={id:newRecordId(),kind:'todo',owner:null,payload:{id:pending.operationId.split(':').at(-1),text:'pending collision',done:false}};
 await assert.rejects(api.prepareEdits(loaded,[pending,{kind:'add_record',operationId:newOperationId(),record:todo}]),/historical_id_reused/);
 todo.payload.id=loaded.source.context.catalog.institutionalCourses[0].id.split(':').at(-1);
 await assert.rejects(api.prepareEdits(loaded,[{kind:'add_record',operationId:newOperationId(),record:todo}]),/historical_id_reused/);
});

const consent = p => ({acceptedBackupRawSha256:p.recovery.rawSha256,protectedBackupRaw:p.recovery.raw});
async function envelope(state,reservedIds=state.history.issuedIds){const body={format:'hosei-attempt-backup',backupVersion:2,createdAt:'2026-10-16T00:00:00.000Z',state,reservedIds};return JSON.stringify({...body,sha256:await backupDigest(body)});}
async function rehashBackup(value){const {sha256,...body}=value;void sha256;return JSON.stringify({...body,sha256:await backupDigest(body)});}
async function externalState(loaded,commands,reserved=[]){
 const table=structuredClone(loaded.state.assignments);table.reservedIds.push(...reserved);
 const base=buildMigrationTarget(loaded.source,table);let workspace=loaded.workspace;
 for(const command of commands) workspace=applyCommand(workspace,command,loaded.source.context);
 return encodeState(loaded.source,table,base,workspace,env.target,loaded.state.corrections);
}
test('portable recovery requires original protection and file-specific adoption; reload still needs a host witness',async()=>{
 const {api,loaded}=await start(),raw=await api.createBackup(loaded),store=memory(),foreign=create(store),p=await foreign.inspectBackup(raw);
 assert.equal(JSON.parse(raw).backupVersion,2);assert.equal(p.recovery.portable,true);assert.equal(store.writes,0);assert.deepEqual(store.snapshot(),emptyAuthority());
 await assert.rejects(foreign.commit(p,false,null,p.sourceRaw,consent(p)),/confirmation/);
 await assert.rejects(foreign.commit(p,true,null,p.sourceRaw),/portable_adoption/);
 await assert.rejects(foreign.commit(p,true,null,p.sourceRaw,{...consent(p),protectedBackupRaw:'other file'}),/portable_adoption/);
 await assert.rejects(foreign.commit(p,true,'wrong original',p.sourceRaw,consent(p)),/protection/);
 await assert.rejects(foreign.prepareEdits(p.handle,[]),/unconfirmed_recovery/);
 await assert.rejects(foreign.createBackup(p.handle),/unconfirmed_recovery/);
 await assert.rejects(foreign.commit({...p},true,null,p.sourceRaw,consent(p)),/confirmation/);
 const restored=await foreign.commit(p,true,null,p.sourceRaw,consent(p));assert.deepEqual(restored.state,loaded.state);assert.equal(store.writes,1);
 assert.deepEqual((await create(store).load()).workspace,loaded.workspace);
 assert.throws(()=>validateMigrationAssignments(restored.source,restored.state.assignments,restored.state.assignments.reservedIds),/unverified_assignment/);
 store.corrupt(s=>s.committed=['0'.repeat(64)]);const before=store.snapshot();await assert.rejects(create(store).load(),/unverified_assignment/);assert.deepEqual(store.snapshot(),before);
});
test('portable backup retains rollback tombstones, repeated replacement, original quantities and LIFO',async()=>{
 let {store,api,loaded}=await start();const original=loaded.state,first=await api.createBackup(loaded),later=add();
 loaded=await save(api,loaded,[later]);const todo={id:newRecordId(),kind:'todo',owner:null,payload:{id:crypto.randomUUID(),text:'deleted',done:false}};
 loaded=await save(api,loaded,[{kind:'add_record',operationId:newOperationId(),record:todo},{kind:'delete_todo',operationId:newOperationId(),recordId:todo.id}]);
 let p=await api.inspectBackup(first);loaded=await api.commit(p,true,p.previousRaw,p.sourceRaw);
 const rolled=await api.createBackup(loaded);assert.ok(JSON.parse(rolled).reservedIds.includes(later.attempt.id));assert.ok(JSON.parse(rolled).reservedIds.includes(todo.payload.id));
 loaded=await save(api,loaded,loaded.workspace.graph.attempts.map(remove));const backup=await api.createBackup(loaded),target=memory();let receiver=create(target);
 for(let n=0;n<2;n++){p=await receiver.inspectBackup(backup);const restored=await receiver.commit(p,true,p.previousRaw,p.sourceRaw,consent(p));assert.deepEqual(restored.state,loaded.state);receiver=create(target);}
 let restored=await receiver.load();await assert.rejects(receiver.prepareEdits(restored,[later]),/historical_id_reused/);
 await assert.rejects(receiver.prepareEdits(restored,[{kind:'add_record',operationId:newOperationId(),record:{...todo,id:newRecordId()}}]),/historical_id_reused/);
 await assert.rejects(receiver.prepareEdits(restored,[undo(restored.workspace.graph.removals[0])]),/undo_order/);
 restored=await save(receiver,restored,[...restored.workspace.graph.removals].reverse().map(undo));
 assert.deepEqual(restored.state.graph,original.graph);assert.deepEqual(restored.state.retained,original.retained);assert.deepEqual(restored.state.source,original.source);
 assert.ok(store.snapshot().issuedIds.includes(todo.payload.id));
});
test('unknown overlapping host history rejects; disjoint replacement preserves the previous reservations',async()=>{
 const a=await start(),b=await start();const before=b.store.snapshot();await assert.rejects(b.api.inspectBackup(await a.api.createBackup(a.loaded)),/recovery_host_collision/);assert.deepEqual(b.store.snapshot(),before);
 const empty=await start(memory(),initialState()),p=await b.api.inspectBackup(await empty.api.createBackup(empty.loaded));
 const after=await b.api.commit(p,true,p.previousRaw,p.sourceRaw,consent(p));assert.deepEqual(after.state,empty.loaded.state);
 for(const id of before.issuedIds)assert.ok(b.store.snapshot().issuedIds.includes(id));
});
test('v1 compatibility remains host-only because rollback reservations were absent',async()=>{
 const {api,loaded}=await start();const value=JSON.parse(await api.createBackup(loaded));delete value.reservedIds;value.backupVersion=1;const raw=await rehashBackup(value);
 const p=await api.inspectBackup(raw);assert.equal(p.recovery.portable,false);assert.deepEqual((await api.commit(p,true,p.previousRaw,p.sourceRaw)).state,loaded.state);
 await assert.rejects(create(memory()).inspectBackup(raw),/unverified_assignment_history/);
});
for(const kind of ['operation','attempt','record','todo'])test(`portable replay rejects ${kind} UUID colliding with an unused reservation`,async()=>{
 const {loaded}=await start(),id=crypto.randomUUID(),reserved=`hosei:owned:${id}`;let command;
 if(kind==='operation'){command=add();command.operationId=`hosei:attempt-op:${id}`;command.attempt.creationOperationId=command.operationId;}
 else if(kind==='attempt'){command=add();command.attempt.id=`hosei:attempt:${id}`;}
 else command={kind:'add_record',operationId:newOperationId(),record:{id:kind==='record'?`hosei:owned:${id}`:newRecordId(),kind:'todo',owner:null,payload:{id:kind==='todo'?id:crypto.randomUUID(),text:'collision',done:false}}};
 const state=await externalState(loaded,[command],[reserved]),store=memory();await assert.rejects(create(store).inspectBackup(await envelope(state)),/historical_id_reused/);assert.equal(store.writes,0);
});
for(const pick of [h=>h.state.retained.publicCourses[0].id,h=>h.source.context.catalog.institutionalCourses[0].id.split(':').at(-1),h=>h.source.sourceCatalog.offerings[0].id,h=>h.state.assignments.attempts[0].operationId.split(':').at(-1)])test(`portable replay rejects TODO collision with source/catalog/assignment: ${pick}`,async()=>{
 const {loaded}=await start();const id=pick(loaded),command={kind:'add_record',operationId:newOperationId(),record:{id:newRecordId(),kind:'todo',owner:null,payload:{id,text:'collision',done:false}}};
 // Some old Offering IDs are not UUIDs; use the source catalog's first actual UUID.
 if(!/^[0-9a-f-]{36}$/.test(id)){const {referencedUuids}=await import('../src/planner/attempts/persistence/identity.ts');command.record.payload.id=[...referencedUuids(loaded.source.sourceCatalog)][0];}
 const state=await externalState(loaded,[command]);await assert.rejects(create(memory()).inspectBackup(await envelope(state)),/historical_id_reused/);
});
test('portable replay rejects a deleted record UUID reused as a TODO ID',async()=>{
 const {loaded}=await start(),record={id:newRecordId(),kind:'todo',owner:null,payload:{id:crypto.randomUUID(),text:'first',done:false}};
 const commands=[{kind:'add_record',operationId:newOperationId(),record},{kind:'delete_todo',operationId:newOperationId(),recordId:record.id},{kind:'add_record',operationId:newOperationId(),record:{...record,id:newRecordId(),payload:{...record.payload,id:record.id.split(':').at(-1)}}}];
 const state=await externalState(loaded,commands);await assert.rejects(create(memory()).inspectBackup(await envelope(state)),/historical_id_reused/);
});
for(const change of [b=>b.reservedIds.pop(),b=>b.reservedIds.push(b.reservedIds[0]),b=>b.reservedIds.push('not-an-id'),b=>b.reservedIds.push('hosei:owned:'+b.reservedIds[0].split(':').at(-1)),b=>b.state.history.commands.push({kind:'undo',operationId:newOperationId(),attemptId:b.state.graph.attempts[0].id,removalOperationId:newOperationId()}),b=>b.state.source.rawFiles[Object.keys(b.state.source.rawFiles)[0]]+=' ',b=>b.state.schemaVersion=24,b=>b.extra=true])test(`portable rehashed malformed backup refuses without storage: ${change}`,async()=>{
 const {api,loaded}=await start(),value=JSON.parse(await api.createBackup(loaded)),store=memory();change(value);await assert.rejects(create(store).inspectBackup(await rehashBackup(value)));assert.deepEqual(store.snapshot(),emptyAuthority());
});
for(const failure of ['quota','write','no-lock','stale'])test(`portable ${failure} refuses without changing current raw`,async()=>{
 const {api,loaded}=await start(),raw=await api.createBackup(loaded),store=memory(),receiver=create(store,failure==='no-lock'?null:locks),p=await receiver.inspectBackup(raw);
 if(failure==='stale')await start(store,initialState());else store.failure=failure;
 const before=store.snapshot();await assert.rejects(receiver.commit(p,true,p.previousRaw,p.sourceRaw,consent(p)));assert.deepEqual(store.snapshot(),before);
});
test('portable source TODO cannot share the UUID of retained non-Attempt data',async()=>{
 const state=mixed();state.todos[0].id=state.publicCourses[0].id;const api=create(memory()),p=await api.prepareMigration(await api.inspectLegacy(JSON.stringify(state)));
 await assert.rejects(create(memory()).inspectBackup(await envelope(p.handle.state)),/source_todo_uuid_collision/);
});
