import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createNewPlanSource, emptyNewPlanWorkspace, encodeNewPlan, encodeNewPlanRule2, replayNewPlanRule2 } from '../src/planner/attempts/persistence/newPlan.ts';
import { encodeState, encodeStateRule2, replayState, replayStateRule2, assignmentIds } from '../src/planner/attempts/persistence/codec.ts';
import { analyzeCommandIdentities, checkIntroducedIdentities } from '../src/planner/attempts/persistence/commandIdentities.ts';
import { CanonicalReservations, foldCommandIdentities, requireRule2Reservations } from '../src/planner/attempts/persistence/identityFold.ts';
import { SessionIdentityAllocator } from '../src/planner/attempts/persistence/sessionIds.ts';
import { sourceUuids, idTail, unionReservations } from '../src/planner/attempts/persistence/identity.ts';
import { createWorkspace } from '../src/planner/attempts/workbench/operations.ts';
import { makeAttempt } from '../src/planner/attempts/workbench/catalogView.ts';
import { backupDigest } from '../src/planner/backup/plannerBackupCompatibility.ts';
import { createAttemptPersistence } from '../src/planner/attempts/persistence/controller.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { prepareMigrationIds } from '../src/planner/attempts/migration/assignments.ts';
import { buildMigrationTarget } from '../src/planner/attempts/migration/transform.ts';
import { mixed, decode, env, media } from './fixtures/migration-fixture.mjs';
const U=n=>`e1000000-0000-4000-8000-${String(n).padStart(12,'0')}`,op=n=>`hosei:attempt-op:${U(n)}`,rid=n=>`hosei:owned:${U(n)}`;
const assessment=(n,label='初期')=>({id:typeof n==='number'?U(n):n,type:'other',label,scheduledDate:null,completed:false});
const source24=await createNewPlanSource();
function add(source,n=1){const attempt=makeAttempt(source.context.catalog,{title:'固定UUID',courseId:null,placementId:null,plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''},{id:`hosei:attempt:${U(n)}`,creationOperationId:op(n+1)});return {kind:'add',operationId:op(n+1),attempt};}
const record=(owner,n=4,assessments=[])=>({id:rid(n),kind:'media',owner:{kind:'attempt',attemptId:owner},payload:{totalLessons:0,lessons:[],assessments}});
const addRecord=(r,n=3)=>({kind:'add_record',operationId:op(n),record:r});
const editPayload=(r,assessments,n)=>({kind:'edit_payload',operationId:op(n),recordId:r.id,payload:{...r.payload,assessments}});
function run(seed,commands,structural=[]){return foldCommandIdentities(seed,commands,structural);}
function initial24(){return {source:source24,initial:emptyNewPlanWorkspace(source24)};}
function setup(){const seed=initial24(),a=add(source24),r=record(a.attempt.id),commands=[a,addRecord(r)];return {seed,a,r,commands,workspace:run(seed,commands).workspace};}
async function evidence(name,value){if(process.env.IDENTITY_EVIDENCE){await mkdir(process.env.IDENTITY_EVIDENCE,{recursive:true});await writeFile(`${process.env.IDENTITY_EVIDENCE}/${name}.json`,JSON.stringify(value,null,2));}}

// Assertions describe GREEN conditions, independent of the preserved RED source.
test('I01/I02: nested initial assessment; add/update/reorder is one introduction per record',()=>{
 const {seed,a}=setup(),r=record(a.attempt.id,4,[assessment(5)]),commands=[a,addRecord(r),editPayload(r,[assessment(5,'更新'),assessment(7)],6),editPayload(r,[assessment(7),assessment(5,'行順変更')],8)];
 const fold=run(seed,commands);assert.deepEqual(fold.issuedIds,[op(2),a.attempt.id,op(3),rid(4),U(5),op(6),U(7),op(8)]);
 assert.deepEqual(fold.events.map(e=>e.introduced.map(x=>x.canonicalId)),[[op(2),a.attempt.id],[op(3),rid(4),U(5)],[op(6),U(7)],[op(8)]]);
 assert.deepEqual(fold.workspace.graph.ownedRecords[0].payload.assessments,[assessment(7),assessment(5,'行順変更')]);
 assert.equal(fold.events[3].updated.filter(o=>o.role==='assessment').length,2);
});
test('I03/I07: remove/Undo and deleted TODO retain history and chronology; all eight Commands exact H2/R2 ordering',async()=>{
 for(const schema of [23,24]){
  let seed,base,table,source;
  if(schema===23){source=(await decode(mixed())).source;table=prepareMigrationIds(source);base=buildMigrationTarget(source,table);seed={source,initial:createWorkspace(base.graph,source.context),tables:[table]};}else{seed=initial24();source=seed.source;}
  const a=add(source),r=record(a.attempt.id,4,[assessment(5)]),todo={id:rid(11),kind:'todo',owner:null,payload:{id:U(12),text:'履歴',done:false}};
  const commands=[a,addRecord(r),editPayload(r,[assessment(5,'更新'),assessment(7)],6),editPayload(r,[assessment(7),assessment(5,'順序')],8),{kind:'edit',operationId:op(9),attemptId:a.attempt.id,changes:{originalTitle:'変更済み'}},addRecord(todo,10),{kind:'assign_todo',operationId:op(13),recordId:todo.id,owner:{kind:'attempt',attemptId:a.attempt.id},expectedOwner:null},{kind:'delete_todo',operationId:op(14),recordId:todo.id},{kind:'remove',operationId:op(15),attemptId:a.attempt.id},{kind:'undo',operationId:op(16),attemptId:a.attempt.id,removalOperationId:op(15)}];
  if(schema===23){const old=seed.initial.graph.ownedRecords.find(r=>r.kind==='media');commands.push(editPayload(old,old.payload.assessments.map(a=>({...a,label:'元ID保持'})),17));}
  const fold=run(seed,commands),expected=[...(table?assignmentIds(table):[]),op(2),a.attempt.id,op(3),rid(4),U(5),op(6),U(7),op(8),op(9),op(10),rid(11),U(12),op(13),op(14),op(15),op(16),...(schema===23?[op(17),...seed.initial.usedTodoIds]:[])];
  assert.deepEqual(fold.issuedIds,[...new Set(expected)]);assert.equal(new Set(commands.map(c=>c.kind)).size,8);
  const state=schema===23?await encodeStateRule2(source,table,base,fold.workspace,env.target):await encodeNewPlanRule2(source,fold.workspace);
  const replay=await replayStateRule2(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(replay.state,state);assert.deepEqual(replay.workspace,fold.workspace);assert.deepEqual(replay.source,source);
  for(const mutate of [s=>s.history.issuedIds.reverse(),s=>s.history.commands.push(s.history.commands[0]),s=>s.graph.ownedRecords.find(r=>r.id===rid(4)).payload.assessments[0].label='tampered']){const invalid=structuredClone(state);mutate(invalid);await assert.rejects(replayStateRule2(invalid));}
  const expectedR=[...state.history.issuedIds];const tails=new Set(expectedR.map(idTail));
  for(const id of [...sourceUuids(source),...references([state,fold.workspace])])if(!tails.has(id)){tails.add(id);expectedR.push(id);}
  assert.deepEqual(replay.requiredReservations,expectedR);assert.deepEqual(replay.requiredReservations,run(seed,commands,state).requiredReservations);
  assert.ok(state.history.issuedIds.includes(U(5)));assert.ok(state.history.issuedIds.includes(U(12)));assert.equal(replay.workspace.graph.removals.length,0);
  assert.deepEqual(replay.workspace.graph.ownedRecords,fold.workspace.graph.ownedRecords);
  if(schema===23){assert.equal(source.state.mediaSchoolingProgress[media.id].assessments[0].id,'assessment/raw~id');assert.deepEqual(state.retained,base.retained);assert.deepEqual(state.source.raw,source.raw);assert.deepEqual(state.assignments,table);assert.deepEqual(state.ledger,base.ledger);}
  await evidence(`green-schema${schema}-all-values`,{state,workspace:fold.workspace,requiredReservations:replay.requiredReservations,sourceState:source.kind==='new-plan'?source.evidence:source.state});
  const deleted={...todo,id:rid(19)};assert.throws(()=>run(seed,[...commands,addRecord(deleted,18)]),/historical_id_reused/);
 }
});
import { referencedUuids as references } from '../src/planner/attempts/persistence/identity.ts';
test('I04/I05/I06: all namespace tails, both introduction directions, across records and inside one command',async()=>{
 const {seed,a,r,commands}=setup(),withX=[...commands,editPayload(r,[assessment(5)],6)];
 const collisions=[];
 // Every existing operation/Attempt/owned/source/catalog tail blocks new assessments.
 for(const tail of [U(2),U(1),U(4),[...sourceUuids(source24)][0]])collisions.push([...commands,editPayload(r,[assessment(tail)],20)]);
 collisions.push([...commands,editPayload(r,[assessment(20)],20)]);
 collisions.push([...withX,addRecord(record(a.attempt.id,22,[assessment(5)]),21)]);
 collisions.push([...withX,addRecord({id:rid(22),kind:'todo',owner:null,payload:{id:U(5),text:'衝突',done:false}},21)]);
 const todo={id:rid(22),kind:'todo',owner:null,payload:{id:U(23),text:'TODO',done:false}};
 collisions.push([...commands,addRecord(todo,21),editPayload(r,[assessment(23)],24)]);
 for(const role of ['operation','attempt','owned']){
  if(role==='operation')collisions.push([...withX,{kind:'edit',operationId:op(5),attemptId:a.attempt.id,changes:{originalTitle:'X'}}]);
  if(role==='attempt'){const c=add(source24,25);c.attempt.id=`hosei:attempt:${U(5)}`;collisions.push([...withX,c]);}
  if(role==='owned')collisions.push([...withX,addRecord(record(a.attempt.id,5),24)]);
 }
 // Same-command and reverse order TODO/assessment, plus duplicate assessments.
 collisions.push([a,addRecord(record(a.attempt.id,4,[assessment(3)]))]);
 collisions.push([a,addRecord(record(a.attempt.id,4,[assessment(4)]))]);
 collisions.push([a,addRecord(record(a.attempt.id,4,[assessment(5),assessment(5)]))]);
 const observation=[],before=JSON.stringify(seed.initial);
 for(const [index,cs] of collisions.entries()){let error;try{run(seed,cs);}catch(e){error=e.message;}assert.match(error,/historical_id_reused/);assert.equal(JSON.stringify(seed.initial),before);observation.push({index,commands:cs,error,originalUnchanged:true});}
 await evidence('green-uuid-collision-matrix',observation);
 assert.deepEqual(run(seed,commands).workspace,setup().workspace);
 // Different rows using the exact same string are NOT normalized references.
 const canonical=new CanonicalReservations();canonical.declare({canonicalId:U(5),uuidTail:U(5),role:'assessment',path:'/a'},'record:a');
 assert.throws(()=>canonical.declare({canonicalId:U(5),uuidTail:U(5),role:'assessment',path:'/b'},'record:b'),/identity_declaration_collision/);
});
test('I08: source non-UUID assessment is retained; new non-UUID assessment is refused; labels/keys remain restrictions',async()=>{
 const source=(await decode(mixed())).source,table=prepareMigrationIds(source),base=buildMigrationTarget(source,table),initial=createWorkspace(base.graph,source.context),r=initial.graph.ownedRecords.find(r=>r.kind==='media'),seed={source,initial,tables:[table]};
 const c=editPayload(r,r.payload.assessments.map(a=>({...a,label:U(50),completed:true})),49),fold=run(seed,[c]);
 assert.deepEqual(fold.events[0].introduced.map(o=>o.canonicalId),[op(49)]);assert.equal(fold.workspace.graph.ownedRecords.find(r=>r.kind==='media').payload.assessments[0].id,'assessment/raw~id');
 assert.throws(()=>run(seed,[c,editPayload(r,[...c.payload.assessments,assessment(50)],51)]),/historical_id_reused/);
 assert.throws(()=>run(seed,[editPayload(r,[...r.payload.assessments,assessment('new-non-uuid')],52)]),/identity_role_or_shape/);
 const state=await encodeStateRule2(source,table,base,fold.workspace,env.target),replay=await replayStateRule2(state);
 assert.ok(replay.requiredReservations.includes(U(50)));assert.deepEqual(replay.source.raw,source.raw);assert.deepEqual(replay.state.retained,base.retained);
});
test('rule2 canonical references normalize only proven aliases; rule1 union contract unchanged',()=>{
 assert.throws(()=>unionReservations([op(5)],[U(5)]),/reservation_uuid_collision_or_shape/);
 const r=new CanonicalReservations();r.restrict([op(5)]);r.references([U(5),U(5)]);assert.deepEqual(r.values(),[op(5)]);
 assert.throws(()=>r.restrict([rid(5)]),/reservation_canonical_mismatch/);
 assert.throws(()=>requireRule2Reservations([U(5)],[op(5)]),/canonical/);assert.throws(()=>requireRule2Reservations([],[op(5)]),/missing/);requireRule2Reservations([op(5)],[op(5)]);
});
test('rule2 rejects forged state/H2 order, duplicate receipts, graph, rule downgrade and role aliases',async()=>{
 const {seed,commands,r}=setup(),workspace=run(seed,[...commands,editPayload(r,[assessment(5)],6)]).workspace,state=await encodeNewPlanRule2(source24,workspace);
 for(const mutate of [s=>s.history.issuedIds.reverse(),s=>s.history.issuedIds.pop(),s=>s.history.issuedIds.push(U(99)),s=>s.history.commands.push(s.history.commands[0]),s=>s.graph.ownedRecords[0].payload.assessments[0].label='偽造',s=>s.rule.version=1,s=>s.rule.extra=true,s=>s.history.commands[2].payload.assessments[0].id=op(5)]){const s=structuredClone(state);mutate(s);await assert.rejects(replayStateRule2(s));}
 await assert.rejects(replayState(state),/unsupported/);assert.equal((await encodeNewPlan(source24,workspace)).rule.version,1);
});
test('F01/F02: allocator burns before return/sink throw; no self collision; failed IDs never reused',()=>{
 const native=crypto.randomUUID.bind(crypto),issued=[],ids=new SessionIdentityAllocator(id=>{issued.push(id);if(issued.length===3)throw Error('sink');}),before=ids.snapshot([]),occupied=new Set(before);let n=60;
 try{crypto.randomUUID=()=>U(n++);const operationId=ids.mint(occupied,'hosei:attempt-op:'),id=ids.mint(occupied,'hosei:attempt:');assert.throws(()=>ids.mint(occupied,'hosei:owned:'),/sink/);assert.deepEqual(ids.reservations(),[U(60),U(61),U(62)]);
 const command=add(source24);command.operationId=operationId;command.attempt.id=id;command.attempt.creationOperationId=operationId;
 const delta=analyzeCommandIdentities(emptyNewPlanWorkspace(source24),command);assert.doesNotThrow(()=>checkIntroducedIdentities(delta.introduced,before));assert.throws(()=>checkIntroducedIdentities(delta.introduced,ids.snapshot([])),/historical_id_reused/);
 for(const uuid of ids.reservations()){crypto.randomUUID=()=>uuid;assert.throws(()=>ids.mint(new Set()),/allocator_exhausted/);}
 crypto.randomUUID=()=> 'invalid';assert.throws(()=>ids.mint(new Set()),/uuid_shape/);assert.equal(ids.reservations().length,3);
 crypto.randomUUID=()=>{throw Error('factory_middle');};assert.throws(()=>ids.mint(new Set()),/factory_middle/);assert.deepEqual(ids.reservations(),[U(60),U(61),U(62)]);
 }finally{crypto.randomUUID=native;}
});

test('schema23 rule2: two corrections validated before identity introduction; all source/raw/quantity/table values preserved',async()=>{
 const s=mixed();s.mediaSchoolingProgress[media.id].assessments[0].scheduledDate='2027-02-30';s.mediaSchoolingProgress[media.id].assessments.push({...assessment('second/raw'),scheduledDate:'2027-99-99'});
 const store={read:async()=>emptyAuthority(),commit:async()=>{throw Error('write');}},api=createAttemptPersistence(store,undefined,env);
 let session=await api.inspectLegacy(JSON.stringify(s));for(const id of ['assessment/raw~id','second/raw']){const p=await api.proposeDate(session,media.id,id,null);session=await api.confirmDate(session,p,true);}
 const p=await api.prepareMigration(session),h=p.handle,state=await encodeStateRule2(h.source,h.state.assignments,h.base??buildMigrationTarget(h.source,h.state.assignments),h.workspace,h.state.catalog,h.state.corrections),replay=await replayStateRule2(state);
 assert.deepEqual(replay.state,state);assert.deepEqual(replay.workspace,h.workspace);assert.deepEqual(replay.source.raw,h.source.raw);assert.deepEqual(state.corrections,h.state.corrections);assert.deepEqual(state.retained,h.state.retained);
 assert.deepEqual(state.history.issuedIds,[...new Set([...state.corrections.flatMap(c=>assignmentIds(c.originalAssignments)),...assignmentIds(state.assignments),...h.workspace.usedTodoIds])]);
 const bad=structuredClone(state);bad.corrections[0].proposedRaw+=' ';await assert.rejects(replayStateRule2(bad),/correction_chain/);
 const duplicate=mixed();duplicate.mediaSchoolingProgress[media.id].assessments=[assessment(5),assessment(5)];const d=await decode(duplicate);if(d.status==='decoded'){const t=prepareMigrationIds(d.source),b=buildMigrationTarget(d.source,t);assert.throws(()=>run({source:d.source,initial:{graph:b.graph,receipts:[],usedTodoIds:d.source.state.todos.map(t=>t.id)},tables:[t]},[]),/identity_declaration_collision/);}
 await evidence('green-schema23-corrections',{state,workspace:replay.workspace,requiredReservations:replay.requiredReservations});
});

// Full old-rule fixtures are produced on the fixed baseline by red-rule1.mjs.
test('C01: fixed-HEAD rule1 full states/digests/replay and controller read-only load remain unchanged',async()=>{
 if(!process.env.RULE1_FIXTURES)throw Error('RULE1_FIXTURES required for old-HEAD oracle');
 const {readFile}=await import('node:fs/promises');
 for(const schema of [23,24]){
  const f=JSON.parse(await readFile(`${process.env.RULE1_FIXTURES}/rule1-schema${schema}.json`,'utf8')),before=JSON.stringify(f.state),digest=await backupDigest(f.state),replay=await replayState(f.state);
  assert.deepEqual(replay.state,f.state);assert.deepEqual(replay.workspace,f.workspace);assert.deepEqual(replay.requiredReservations,f.requiredReservations);assert.equal(digest,f.digest);assert.equal(JSON.stringify(replay.state),before);
  let writes=0;const api=createAttemptPersistence({read:async()=>structuredClone(f.authority),commit:async()=>{writes++;}},undefined,env),h=await api.load();assert.deepEqual(h.state,f.state);assert.equal(writes,0);assert.equal(await backupDigest(h.state),digest);
  await evidence(`green-rule1-schema${schema}`,{digest,fullStateEqual:true,workspaceEqual:true,reservationsEqual:true,writes});
 }
});

test('I06: TODO same-ID edit is retained; ID replacement is rejected; pure encoder binds pinned new-plan source',async()=>{
 const {seed,a}=setup(),todo={id:rid(71),kind:'todo',owner:null,payload:{id:U(72),text:'元TODO',done:false}},commands=[a,addRecord(todo,70)];
 const command={kind:'edit_payload',operationId:op(73),recordId:todo.id,payload:{...todo.payload,text:'編集',done:true}},fold=run(seed,[...commands,command]);
 assert.deepEqual(fold.events.at(-1).introduced.map(o=>o.canonicalId),[op(73)]);assert.ok(fold.events.at(-1).retained.some(o=>o.canonicalId===U(72)));
 assert.throws(()=>run(seed,[...commands,{...command,payload:{...command.payload,id:U(74)}}]),/todo_id_immutable/);
 const source=structuredClone(source24);source.evidence.masterSha256='0'.repeat(64);await assert.rejects(encodeNewPlanRule2(source,fold.workspace),/new_plan_source_mismatch/);
});

test('F01: actual Worker assessment mint remains burned after batch dispatch failure; original draft/receipts/view survive',async()=>{
 const {editProbe}=await import('./helpers/controller-edit-probe.mjs'),worker=await editProbe(),session=worker.createPreviewSession(async()=>worker.emptyAuthority(),async()=>worker.env,901);
 let seq=0,view,draft;const start=await session.request({version:1,boot:901,requestId:++seq,op:'startSession'});view=start.view;
 const call=async(op,extra={})=>{const r=await session.request({version:1,boot:901,requestId:++seq,op,session:start.session,expectedView:view,...extra});view=r.view??view;draft=r.draft??draft;return r;};
 const native=crypto.randomUUID.bind(crypto);
 try{
  await call('prepareNewPlan');await call('prepareEdits',{draft,intents:[{kind:'add',selection:null,title:'元Attempt',plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''}]});
  let attempt=(await call('readPage',{kind:'attempts'})).rows[0].row;await call('prepareEdits',{draft,intents:[{kind:'add_record',owner:attempt,fields:{kind:'media',totalLessons:null}}]});
  attempt=(await call('readPage',{kind:'attempts'})).rows[0].row;
  const record=(await call('readPage',{kind:'records'})).rows[0].row,prior=session.__probe(),original={draft:prior.activeDraft,preview:prior.activePreview,view:prior.view,json:JSON.stringify(prior.activeDraft)},tape=[];let n=80;
  crypto.randomUUID=()=>{const id=U(n++);tape.push(id);return id;};
  await assert.rejects(call('prepareEdits',{draft,intents:[{kind:'edit_payload',record,changes:{kind:'media',addAssessment:{type:'other',label:'失敗batch',scheduledDate:null,completed:false}}},{kind:'remove',attempt},{kind:'edit',attempt,changes:{title:'detached error'}}]}),/restore_before_edit/);
  crypto.randomUUID=native;
  const after=session.__probe();assert.equal(after.activeDraft,original.draft);assert.equal(after.activePreview,original.preview);assert.equal(after.view,original.view);assert.equal(JSON.stringify(after.activeDraft),original.json);assert.deepEqual(tape,[U(80),U(81),U(82),U(83)]);
  for(const uuid of tape){assert.ok(after.editIds.reservations().includes(uuid));crypto.randomUUID=()=>uuid;assert.throws(()=>after.editIds.mint(new Set(),'hosei:attempt:'),{code:'resource_limit'});}
  crypto.randomUUID=native;
  await call('prepareEdits',{draft,intents:[{kind:'edit_payload',record,changes:{kind:'media',addAssessment:{type:'other',label:'正常復帰',scheduledDate:null,completed:false}}}]});
  assert.equal(session.__probe().activeDraft.handle.workspace.receipts.length,3);assert.ok(!tape.some(uuid=>JSON.stringify(session.__probe().activeDraft.handle.workspace).includes(uuid)));
 }finally{crypto.randomUUID=native;session.close();}
});
