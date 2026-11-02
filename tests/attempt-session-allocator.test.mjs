import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createSynchronousAttemptSession } from '../src/planner/attempts/persistence/syncSession.ts';
import { SessionIdentityAllocator } from '../src/planner/attempts/persistence/sessionIds.ts';
import { createWorkbenchIdentityOwner } from '../src/planner/attempts/workbench/sessionIdentities.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { makeAttempt } from '../src/planner/attempts/workbench/catalogView.ts';
import { newAttemptIds } from '../src/planner/attempts/workbench/operations.ts';
import { replayState } from '../src/planner/attempts/persistence/codec.ts';
import { prepareMigrationIds, validateMigrationAssignments } from '../src/planner/attempts/migration/assignments.ts';
import { referencedUuids, catalogUuids } from '../src/planner/attempts/persistence/identity.ts';
import { emptyProgress } from '../dev/attempts/progressDefaults.ts';
const uuid = n => `e3000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function tape(values, run) {
  const original = crypto.randomUUID; let calls = 0;
  crypto.randomUUID = () => { calls++; return typeof values === 'function' ? values(calls) : values.shift() ?? original.call(crypto); };
  try { return await run(() => calls); } finally { crypto.randomUUID = original; }
}
async function setup() {
  let writes = 0;
  const api = createSynchronousAttemptSession({ read: async () => emptyAuthority(), commit: async () => { writes++; throw Error('unexpected_write'); } }, undefined);
  const p = await api.prepareNewPlan(), h = p.handle;
  return { api, h, ids: api.identities(h), writes: () => writes };
}
function add(h, ids, title = 'learner') {
  const a = makeAttempt(h.source.context.catalog, { title, courseId:null, placementId:null,
    plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:'' }, ids?.newAttemptIds());
  return { kind:'add', operationId:a.creationOperationId, attempt:a };
}
const golden = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/persistence-rule1-parent.json.gz', import.meta.url))));
const old = await replayState(JSON.parse(golden.fixtures.find(f=>JSON.parse(f.stateRaw).schemaVersion===23).stateRaw));

test('1: every namespace burns synchronously before return; sink observes burn before any caller gets ID', async () => {
  const seen = []; let a; a = new SessionIdentityAllocator(id => { assert.ok(a.canonicalReservations().includes(id)); seen.push(id); });
  await tape([uuid(1),uuid(2),uuid(3),uuid(4)], () => {
    const occupied=a.snapshot([]);
    for (const prefix of ['hosei:attempt:','hosei:attempt-op:','hosei:owned:','']) { const id=a.mint(occupied,prefix); assert.equal(seen.at(-1),id); }
  });
  assert.equal(seen.length,4);
});
test('2: no Command created: abandoned form IDs remain unavailable', async () => {
  const t=await setup(); let abandoned;
  await tape([uuid(10),uuid(11)],()=>{abandoned=t.ids.newAttemptIds();});
  await tape([uuid(10),uuid(11),uuid(12)],()=>assert.equal(t.ids.newAssessmentId(),uuid(12)));
  assert.equal(abandoned.id.endsWith(uuid(10)),true); assert.equal(t.writes(),0);
});
test('3: failed Command retains every minted ID and publishes no new Workspace', async () => {
  const t=await setup(); const c=add(t.h,t.ids); c.attempt.originalTitle='';
  assert.throws(()=>t.api.dispatch(t.h,t.h.workspace,c));
  const tails=[c.attempt.id,c.operationId].map(x=>x.split(':').at(-1));
  await tape([...tails,uuid(20)],()=>assert.equal(t.ids.newAssessmentId(),uuid(20)));
  assert.equal(t.h.workspace.receipts.length,0); assert.equal(t.writes(),0);
});
test('4: failed batch keeps IDs from all generation positions, no partial candidate', async () => {
  const t=await setup(), first=add(t.h,t.ids), second=add(t.h,t.ids); second.attempt.originalTitle='';
  await assert.rejects(t.api.prepareEdits(t.h,[first,second]));
  const ids=[first.attempt.id,first.operationId,second.attempt.id,second.operationId].map(x=>x.split(':').at(-1));
  await tape([...ids,uuid(30)],()=>assert.equal(t.ids.newAssessmentId(),uuid(30)));
  assert.equal(t.h.workspace.receipts.length,0); assert.equal(t.writes(),0);
});
test('5: sibling facades share one lifetime across handle changes', async () => {
  const t=await setup(), other=t.api.identities(t.h); const id=t.ids.newAssessmentId();
  await tape([id,uuid(40)],()=>assert.equal(other.newRecordId(),`hosei:owned:${uuid(40)}`));
  const next=await t.api.prepareEdits(t.h,[]), nextIds=t.api.identities(next.handle);
  await tape([id,uuid(41)],()=>assert.equal(nextIds.newAssessmentId(),uuid(41)));
});
test('6: remove/Undo do not release Attempt/operation reservations', async () => {
  const t=await setup(), c=add(t.h,t.ids); let w=t.api.dispatch(t.h,t.h.workspace,c);
  const remove={kind:'remove',operationId:t.ids.newOperationId(),attemptId:c.attempt.id}; w=t.api.dispatch(t.h,w,remove);
  const undo={kind:'undo',operationId:t.ids.newOperationId(),attemptId:c.attempt.id,removalOperationId:remove.operationId}; w=t.api.dispatch(t.h,w,undo);
  const used=[c.attempt.id,c.operationId,remove.operationId,undo.operationId].map(x=>x.split(':').at(-1));
  await tape([...used,uuid(50)],()=>assert.equal(t.ids.newAssessmentId(),uuid(50)));
  assert.equal(w.receipts.length,3);
});
test('7: verified source/catalog/assignments/host reservations are occupied before mint', async () => {
  const f=golden.fixtures.find(f=>JSON.parse(f.stateRaw).schemaVersion===23);
  const host='hosei:owned:'+uuid(60);
  const api=createSynchronousAttemptSession({read:async()=>({raw:f.stateRaw,revision:1,committed:[f.digest],issuedIds:[...old.requiredReservations,host]}),commit:async()=>{throw Error('write');}},undefined,old.environment);
  const h=await api.load(), ids=api.identities(h);
  const source=[[...referencedUuids(old.source.state)][0], [...catalogUuids(old.source)][0], old.state.assignments.attempts[0].attemptId.split(':').at(-1)];
  await tape([...source,uuid(60),uuid(61)],()=>assert.equal(ids.newAssessmentId(),uuid(61)));
});
test('8: TODO/assessment/owned/operation/Attempt cannot reuse UUID tails', async () => {
  const t=await setup(), payload=t.ids.newAssessmentId();
  await tape([payload,uuid(70)],()=>assert.equal(t.ids.newOperationId(),'hosei:attempt-op:'+uuid(70)));
  await tape([payload,uuid(70),uuid(71)],()=>assert.equal(t.ids.newRecordId(),'hosei:owned:'+uuid(71)));
});
test('9: retained payload identity update/reorder mints no extra nested identities', async () => {
  const t=await setup(), c=add(t.h,t.ids); let w=t.api.dispatch(t.h,t.h.workspace,c);
  const record=emptyProgress('media',c.attempt.id,t.ids); record.payload.assessments=[1,2].map(n=>({id:t.ids.newAssessmentId(),type:'other',label:String(n),scheduledDate:null,completed:false}));
  w=t.api.dispatch(t.h,w,{kind:'add_record',operationId:t.ids.newOperationId(),record});
  const op=t.ids.newOperationId();
  await tape(()=>{throw Error('unexpected_mint');},()=>{w=t.api.dispatch(t.h,w,{kind:'edit_payload',operationId:op,recordId:record.id,payload:{...record.payload,assessments:[...record.payload.assessments].reverse().map(a=>({...a,label:'updated'}))}});});
  assert.equal(w.receipts.length,3);
});
test('10: retry exactly 128; invalid UUID never reaches sink; sink throw still burns', async () => {
  const a=new SessionIdentityAllocator(); a.restrict([uuid(80)]);
  await tape(()=>uuid(80),calls=>{assert.throws(()=>a.mint(a.snapshot([])),/exhausted/);assert.equal(calls(),128);});
  let sinks=0; const b=new SessionIdentityAllocator(()=>{sinks++;throw Error('sink');});
  await tape(['invalid'],()=>assert.throws(()=>b.mint(new Set()),/uuid_shape/));assert.equal(sinks,0);
  await tape([uuid(81)],()=>assert.throws(()=>b.mint(new Set()),/sink/));assert.ok(b.reservations().includes(uuid(81)));
});
test('11: default helper and foreign owner IDs cannot enter qualified UI session', async () => {
  const t=await setup(); const foreign=createWorkbenchIdentityOwner(()=>[]);
  for(const identity of [newAttemptIds(),foreign.ids.newAttemptIds()]){
    const c=add(t.h,{newAttemptIds:()=>identity}); assert.throws(()=>t.api.dispatch(t.h,t.h.workspace,c),/untracked_session_identity/);
  }
  assert.throws(()=>t.api.dispatch(t.h,t.h.workspace,add(t.h)),/untracked_session_identity/);
  assert.throws(()=>t.api.identities(structuredClone(t.h)),/unverified_identity_handle/);
  const c=add(t.h,t.ids);assert.throws(()=>t.api.dispatch(t.h,structuredClone(t.h.workspace),c),/unverified_identity_workspace/);
});
test('12: migration retries occupied source/canonical aliases; synchronous sink and table issuance stay private', async () => {
  const reserved=['hosei:owned:'+uuid(90)], issued=[];
  await tape([uuid(90),...old.requiredReservations.slice(0,2).map(x=>x.split(':').at(-1))],()=>{
    const table=prepareMigrationIds(old.source,reserved,undefined,id=>issued.push(id));
    validateMigrationAssignments(old.source,table,reserved);
    assert.throws(()=>validateMigrationAssignments(old.source,structuredClone(table),reserved),/unverified_assignment/);
    assert.equal(table.attempts.some(a=>a.attemptId.endsWith(uuid(90))),false);
  });
  const burned=[];await assert.rejects(tape([uuid(91)],()=>prepareMigrationIds(old.source,[],undefined,id=>{burned.push(id);throw Error('sink_failure');})),/sink_failure/);
  assert.equal(burned.length,1);
  await tape([uuid(91)],()=>{const table=prepareMigrationIds(old.source,burned);assert.notEqual(table.attempts[0].attemptId,burned[0]);});
});
test('13: UI route inventory forbids direct crypto/default fallback in save-capable components', () => {
  for(const name of ['AttemptForm','Workbench','ProgressEditor','TodoPanel','progressDefaults']){
    const s=readFileSync(new URL('../dev/attempts/'+name+(name==='progressDefaults'?'.ts':'.tsx'),import.meta.url),'utf8');
    assert.ok(!/crypto\.randomUUID|import\s*\{[^}]*\bnew(?:OperationId|RecordId|AttemptIds)\b[^}]*\}\s*from/.test(s),name);
    assert.ok(/identities|\bids\b/.test(s),name);
  }
  const page=readFileSync(new URL('../dev/persistence/PersistencePage.tsx',import.meta.url),'utf8');assert.ok(page.includes('identities={api.identities(editing)}'));
});
test('14: new session does not add v2/v4 persistence, RPC, locks or allocator factory arguments', async () => {
  const t=await setup(); t.ids.newAssessmentId(); const p=await t.api.prepareEdits(t.h,[]);
  assert.equal(p.handle.state.rule.version,1); assert.equal('reservationCoverage' in p.handle.state,false);assert.equal(t.writes(),0);
  const s=readFileSync(new URL('../src/planner/attempts/persistence/syncSession.ts',import.meta.url),'utf8');
  assert.ok(!/indexedDB|navigator|fetch\(|postMessage|randomUUID/.test(s));
});
test('15: TODO ticket cannot be substituted by assessment ticket or a copied introduction command', async () => {
  const t=await setup();
  const c={kind:'add_record',operationId:t.ids.newOperationId(),record:{id:t.ids.newRecordId(),kind:'todo',owner:null,payload:{id:t.ids.newAssessmentId(),text:'role mismatch',done:false}}};
  assert.throws(()=>t.api.dispatch(t.h,t.h.workspace,c),/untracked_session_identity/);
  c.record.payload.id=t.ids.newTodoId();
  const w=t.api.dispatch(t.h,t.h.workspace,c);
  assert.equal(w.graph.ownedRecords.length,1);
  await assert.rejects(t.api.prepareEdits(t.h,[structuredClone(c)]),/untracked_session_identity/);
  // Same exact command is still allowed for the controller's ordered preview replay.
  assert.equal((await t.api.prepareEdits(t.h,[c])).handle.workspace.receipts.length,1);
});
test('16: actual form mounts burn before submit; edit mount retains Attempt identity', async () => {
  const {createElement}=await import('react'), {renderToString}=await import('react-dom/server');
  const {AttemptForm}=await import('../dev/attempts/AttemptForm.tsx');
  const t=await setup(), owner=createWorkbenchIdentityOwner(()=>[t.h.source,t.h.state]);
  const props={context:t.h.source.context,identities:owner.ids,submit:()=>false,close:()=>{}};
  renderToString(createElement(AttemptForm,props)); assert.equal(owner.reservations().length,2);
  const c=add(t.h,t.ids);renderToString(createElement(AttemptForm,{...props,attempt:c.attempt}));
  assert.equal(owner.reservations().length,3);
});
test('17: frozen controller/Worker/decoder/scope code stays byte-identical; new modules stay outside production', async () => {
  const {execFileSync}=await import('node:child_process');
  for(const file of ['src/planner/attempts/persistence/controller.ts','src/planner/attempts/persistence/sessionIds.ts','src/planner/attempts/persistence/commandIdentities.ts','src/planner/attempts/persistence/identityFold.ts','src/planner/attempts/persistence/worker/session.ts','src/planner/attempts/persistence/worker/editBridge.ts','src/planner/attempts/persistence/contractDecoders.ts','src/planner/attempts/persistence/legacyPreview.ts','scripts/verify-controller-worker-scope.mjs']){
    assert.equal(readFileSync(file,'utf8'),execFileSync('git',['show','d965e08ee6eb9f4c4df529b00a808aca7321b9e2:'+file],{encoding:'utf8'}),file);
  }
  const {build}=await import('esbuild'); const b=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',loader:{'.svg':'text','.png':'dataurl','.woff2':'dataurl'},external:['*.css'],logLevel:'silent'});
  assert.ok(!Object.keys(b.metafile.inputs).some(p=>/syncSession|sessionIdentities|sessionIds/.test(p)));
});

test('18: abandoned identities cannot cross verified handle/source epochs, even within same living session', async () => {
  const t=await setup(), pending=add(t.h,t.ids);
  const next=await t.api.prepareNewPlan();
  await assert.rejects(t.api.prepareEdits(next.handle,[pending]),/untracked_session_identity/);
  const old=pending.attempt.id.split(':').at(-1);
  await tape([old,uuid(99)],()=>assert.equal(t.api.identities(next.handle).newAssessmentId(),uuid(99)));
});
