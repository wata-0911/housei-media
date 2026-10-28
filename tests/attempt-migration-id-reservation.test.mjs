import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMigrationIds, validateMigrationAssignments} from '../src/planner/attempts/migration/assignments.ts';
import {env, mixed, media, decode} from './fixtures/migration-fixture.mjs';
import {createAttemptPersistence} from '../src/planner/attempts/persistence/controller.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {EditIds} from '../src/planner/attempts/persistence/worker/editBridge.ts';
import {editProbe} from './helpers/controller-edit-probe.mjs';
const worker=await editProbe(), native=crypto.randomUUID.bind(crypto);
const store=()=>({read:async()=>emptyAuthority(),commit:async()=>{throw Error('unexpected_write');}});
const add=(title='fresh')=>({kind:'add',selection:null,title,plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''});
const tail=id=>id.split(':').at(-1);
const badRaw=()=>{const x=worker.mixed();x.mediaSchoolingProgress[worker.media.id].assessments[0].scheduledDate='2027-02-30';return JSON.stringify(x);};
function tapeWithCollision(){const first=native(),tape=[];let n=0;crypto.randomUUID=()=>{const id=n++===3?first:n===1?first:native();tape.push(id);return id;};return tape;}
function replayTape(tape){let n=0;crypto.randomUUID=()=>n<tape.length?tape[n++]:native();return ()=>n;}
async function setup(read=async()=>worker.emptyAuthority()){
 const s=worker.createPreviewSession(read,async()=>worker.env,9),started=await s.request({version:1,boot:9,requestId:1,op:'startSession'});let id=1,view=started.view,draft;
 const control=(op,extra={})=>({version:1,boot:9,requestId:++id,op,session:started.session,expectedView:view,...extra});
 const accept=r=>{if(r?.view)view=r.view;if(r?.draft)draft=r.draft;return r;};
 const call=async(op,extra={},raw)=>accept(await s.request(control(op,extra),raw));
 return {s,call,control,get view(){return view;},get draft(){return draft;},edit:intents=>call('prepareEdits',{draft,intents}),rows:async kind=>(await call('readPage',{kind})).rows};
}
function retained(t){const p=t.s.__probe();return {migration:p.activeMigration,draft:p.activeDraft,preview:p.activePreview,view:p.view,json:JSON.stringify([p.activeMigration,p.activeDraft,p.activePreview])};}
function unchanged(t,b){const p=t.s.__probe();assert.equal(p.activeMigration,b.migration);assert.equal(p.activeDraft,b.draft);assert.equal(p.activePreview,b.preview);assert.equal(p.view,b.view);assert.equal(JSON.stringify([p.activeMigration,p.activeDraft,p.activePreview]),b.json);}
function burned(t,tape){const restrictions=new Set(t.s.__probe().editIds.reservations());for(const id of tape)assert.ok(restrictions.has(id),id);}
async function propose(t,date,newDate=null){return t.call('proposeDate',{date,newDate});}

test('sync allocator notifies every UUID before next generation/validation; sink exceptions and existing-table qualification',async()=>{
 const decoded=await decode(mixed());assert.equal(decoded.status,'decoded');const source=decoded.source,seen=[],tape=tapeWithCollision(),generate=crypto.randomUUID;
 crypto.randomUUID=()=>{assert.equal(seen.length,tape.length);return generate();};
 try{
  assert.throws(()=>prepareMigrationIds(source,[],undefined,id=>seen.push(id)),/assignment_uuid_collision/);
  assert.ok(new Set(tape).size>2);assert.deepEqual(seen.map(tail),tape);
  crypto.randomUUID=native;let notified=0;
  assert.throws(()=>prepareMigrationIds(source,[],undefined,()=>{notified++;throw Error('sink_failure');}),/sink_failure/);assert.equal(notified,1);
  const table=prepareMigrationIds(source,[],undefined,id=>assert.ok(id));assert.ok(!(table instanceof Promise));validateMigrationAssignments(source,table);
  crypto.randomUUID=()=>{throw Error('must_not_generate');};assert.equal(prepareMigrationIds(source,[],table,()=>{throw Error('must_not_notify');}),table);
  assert.throws(()=>prepareMigrationIds(source,[],structuredClone(table)),/unverified_assignment_history/);
 }finally{crypto.randomUUID=native;}
});

test('bare controller initial inspect retains all failed allocation IDs, retry cache rejection, and fresh synchronous allocator compatibility',async()=>{
 const c=createAttemptPersistence(store(),undefined,env),raw=JSON.stringify(mixed()),tape=tapeWithCollision();
 try{
  await assert.rejects(c.inspectLegacy(raw),/assignment_uuid_collision/);crypto.randomUUID=native;
  for(const id of new Set(tape)){let n=0;crypto.randomUUID=()=>n++===0?id:native();await assert.rejects(c.inspectLegacy(raw),/assignment_uuid_collision/);}
  crypto.randomUUID=native;const m=await c.inspectLegacy(raw);assert.ok(m.table);assert.equal(await c.inspectLegacy(raw),m);
  for(const id of new Set(tape))assert.ok(m.reservedIds.some(x=>tail(x)===id));
 }finally{crypto.randomUUID=native;}
});

test('bare controller confirmDate retains failed UUIDs without Worker; original source/table survives',async()=>{
 const c=createAttemptPersistence(store(),undefined,env),input=mixed();input.mediaSchoolingProgress[media.id].assessments[0].scheduledDate='2027-02-30';
 const raw=JSON.stringify(input),m=await c.inspectLegacy(raw),assessment=input.mediaSchoolingProgress[media.id].assessments[0].id,old=JSON.stringify(m);
 const p=await c.proposeDate(m,media.id,assessment,null),tape=tapeWithCollision();
 try{
  await assert.rejects(c.confirmDate(m,p,true),/assignment_uuid_collision/);crypto.randomUUID=native;
  for(const id of new Set(tape)){const next=await c.proposeDate(m,media.id,assessment,'2028-02-29');let n=0;crypto.randomUUID=()=>n++===0?id:native();await assert.rejects(c.confirmDate(m,next,true),/assignment_uuid_collision/);crypto.randomUUID=native;}
  assert.equal(await c.inspectLegacy(raw),m);assert.equal(JSON.stringify(m),old);
  const next=await c.proposeDate(m,media.id,assessment,null),ok=await c.confirmDate(m,next,true);assert.equal(ok.preview.status,'ready');assert.equal(JSON.stringify(m),old);
 }finally{crypto.randomUUID=native;}
});

test('Worker failed date batch burns every UUID across correction, operation, TODO, assessment, remove and Undo; no partial publication',async()=>{
 const t=await setup();try{
  const raw=badRaw();await t.call('inspectLegacyRaw',{},raw);const date=(await t.rows('dates'))[0].row,p=await propose(t,date),before=retained(t),tape=tapeWithCollision();
  await assert.rejects(t.call('confirmDate',{correction:p.correction,confirmed:true}),/assignment_uuid_collision/);crypto.randomUUID=native;unchanged(t,before);burned(t,tape);
  for(const id of new Set(tape)){const p2=await propose(t,date,'2028-02-29');let n=0;crypto.randomUUID=()=>n++===0?id:native();await assert.rejects(t.call('confirmDate',{correction:p2.correction,confirmed:true}),/assignment_uuid_collision/);crypto.randomUUID=native;unchanged(t,before);burned(t,tape);}
  await t.call('inspectLegacyRaw',{},raw);assert.equal(t.s.__probe().activeMigration,before.migration);burned(t,tape);
  const freshDate=(await t.rows('dates'))[0].row,p3=await propose(t,freshDate),ok=await t.call('confirmDate',{correction:p3.correction,confirmed:true});assert.equal(ok.status,'ready');await t.call('prepareMigration',{migration:ok.migration});
  async function edit(intents){const old=t.s.__probe().activeDraft.handle.workspace.receipts.length,used=replayTape(tape);await t.edit(intents);crypto.randomUUID=native;assert.equal(used(),tape.length);const commands=t.s.__probe().activeDraft.handle.workspace.receipts.slice(old);for(const id of new Set(tape))assert.ok(!JSON.stringify(commands).includes(id));}
  await edit([add()]);let attempt=(await t.rows('attempts')).at(-1).row;
  await edit([{kind:'add_record',owner:null,fields:{kind:'todo',text:'fresh todo',done:false}},{kind:'add_record',owner:attempt,fields:{kind:'media',totalLessons:null}}]);
  let records=await t.rows('records'),record=records.filter(r=>r.kind==='media').at(-1).row;
  await edit([{kind:'edit_payload',record,changes:{kind:'media',addAssessment:{type:'other',label:'fresh assessment',scheduledDate:null,completed:false}}}]);
  attempt=(await t.rows('attempts')).at(-1).row;await edit([{kind:'remove',attempt}]);const removal=(await t.rows('removals')).at(-1).row;await edit([{kind:'undo',removal}]);burned(t,tape);
 }finally{crypto.randomUUID=native;t.s.close();}
});

for(const failure of ['cancel','authority','exception'])test(`date allocation burn survives post-allocation ${failure} and preserves original view`,async()=>{
 let authority=worker.emptyAuthority();const t=await setup(async()=>structuredClone(authority));
 try{
  await t.call('inspectLegacyRaw',{},badRaw());const date=(await t.rows('dates'))[0].row,p=await propose(t,date),before=retained(t),controller=t.s.__probe().controller,original=controller.confirmDate,tape=[];
  let entered,release;const atGate=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  controller.confirmDate=async(...args)=>{const m=await original(...args);entered();await gate;if(failure==='exception')throw Error('after_allocation');return m;};
  crypto.randomUUID=()=>{const id=native();tape.push(id);return id;};const c=t.control('confirmDate',{correction:p.correction,confirmed:true}),pending=t.s.request(c);const observed=assert.rejects(pending,failure==='cancel'?{code:'cancelled'}:failure==='authority'?{code:'stale_authority'}:/after_allocation/);
  await atGate;crypto.randomUUID=native;assert.ok(tape.length>2);burned(t,tape);
  if(failure==='cancel')t.s.cancel(c.requestId);if(failure==='authority')authority.committed.push('f'.repeat(64));release();await observed;unchanged(t,before);burned(t,tape);
  if(failure==='authority'){authority=worker.emptyAuthority();await assert.rejects(propose(t,date),{code:'stale_authority'});burned(t,tape);}
  else {controller.confirmDate=original;const p2=await propose(t,date);replayTape(tape);await assert.rejects(t.call('confirmDate',{correction:p2.correction,confirmed:true}),/assignment_uuid_collision/);crypto.randomUUID=native;unchanged(t,before);}
 }finally{crypto.randomUUID=native;t.s.close();}
});

test('Worker initial inspect burn survives throw; reservations synchronize both directions and all bare UUID aliases exhaust at 128',async()=>{
 const t=await setup();try{
  const raw=JSON.stringify(worker.mixed()),tape=tapeWithCollision();await assert.rejects(t.call('inspectLegacyRaw',{},raw),/assignment_uuid_collision/);crypto.randomUUID=native;burned(t,tape);
  for(const id of new Set(tape)){let n=0;crypto.randomUUID=()=>n++===0?id:native();await assert.rejects(t.call('inspectLegacyRaw',{},raw),/assignment_uuid_collision/);crypto.randomUUID=native;}
  await t.call('inspectLegacyRaw',{},raw);burned(t,tape);
  const extra=native();t.s.__probe().editIds.restrict(['hosei:owned:'+extra]);let n=0;crypto.randomUUID=()=>n++===0?extra:native();
  // A controller-side inspect also consults Worker restrictions, including failed edits.
  await assert.rejects(t.s.__probe().controller.inspectLegacy(JSON.stringify(worker.mixed(),null,2)),/assignment_uuid_collision/);crypto.randomUUID=native;
  for(const prefix of ['', 'hosei:attempt:', 'hosei:attempt-op:', 'hosei:owned:']){const ids=new EditIds();ids.restrict([prefix+extra]);let calls=0;crypto.randomUUID=()=>{calls++;return extra;};assert.throws(()=>ids.mint(new Set(),prefix),{code:'resource_limit'});assert.equal(calls,128);}
 }finally{crypto.randomUUID=native;t.s.close();}
});

for(const path of ['inspect','confirm'])test(`controller ${path} burns each generated prefix when UUID factory throws mid-table`,async()=>{
 const c=createAttemptPersistence(store(),undefined,env),input=mixed();if(path==='confirm')input.mediaSchoolingProgress[media.id].assessments[0].scheduledDate='2027-02-30';
 const raw=JSON.stringify(input),m=path==='confirm'?await c.inspectLegacy(raw):null,assessment=input.mediaSchoolingProgress[media.id].assessments[0].id;
 const invoke=async()=>path==='inspect'?c.inspectLegacy(raw):c.confirmDate(m,await c.proposeDate(m,media.id,assessment,null),true),tape=[];
 try{
  crypto.randomUUID=()=>{if(tape.length===3)throw Error('factory_failure');const id=native();tape.push(id);return id;};await assert.rejects(invoke(),/factory_failure/);assert.equal(tape.length,3);crypto.randomUUID=native;
  for(const id of tape){let n=0;crypto.randomUUID=()=>n++===0?id:native();await assert.rejects(invoke(),/assignment_uuid_collision/);crypto.randomUUID=native;}
  const fresh=await invoke();assert.ok(fresh.table);if(m)assert.equal(m.raw,raw);
 }finally{crypto.randomUUID=native;}
});

test('failed allocation colliding with a source bare UUID preserves its canonical restriction and permits a fresh valid migration',async()=>{
 const c=createAttemptPersistence(store(),undefined,env),input=mixed(),raw=JSON.stringify(input),sourceId=input.todos[0].id;let n=0;
 try{crypto.randomUUID=()=>n++===0?sourceId:native();await assert.rejects(c.inspectLegacy(raw),/assignment_uuid_collision/);crypto.randomUUID=native;
  const m=await c.inspectLegacy(raw),p=await c.prepareMigration(m);assert.equal(m.preview.status,'ready');assert.equal(p.handle.source.raw,raw);assert.equal(p.handle.state.schemaVersion,23);await worker.replayState(p.handle.state);
 }finally{crypto.randomUUID=native;}
});
