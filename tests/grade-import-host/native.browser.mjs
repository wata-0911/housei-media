// Synthetic data only; dedicated loopback origin and isolated Chromium profiles.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { raw, course, input, oracle } from './fixture.mjs';

const root=new URL('../../',import.meta.url).pathname;
let server,browser,origin,chromium;
const bundles=new Map();
before(async()=>{
 console.log('native fixture: load Playwright');
 ({chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright'));
 const entries={host:`export * from './src/planner/attempts/gradeImportHost/controller';export * from './src/planner/attempts/gradeImportHost/codec';export * from './src/planner/attempts/gradeImportHost/nativeStore';`,
  old:`export {createIndexedDbAttemptStore} from './src/planner/attempts/persistence/indexedDb';`};
 if(process.env.G03_PR4_REFERENCE)entries.pr4=`export {createIndexedDbAttemptStore} from ${JSON.stringify(resolve(process.env.G03_PR4_REFERENCE,'src/planner/attempts/persistence/indexedDb.ts'))};`;
 for(const [key,contents] of Object.entries(entries)){
  console.log('native fixture: bundle '+key);
  const b=await build({absWorkingDir:root,stdin:{contents,resolveDir:root},bundle:true,write:false,platform:'browser',format:'esm',nodePaths:[resolve(root,'node_modules')]});bundles.set('/'+key+'.mjs',b.outputFiles[0].text);
 }
 console.log('native fixture: start loopback server');
 server=createServer((req,res)=>{
  if(req.url!=='/legacy')res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'");
  if(bundles.has(req.url)){res.setHeader('Content-Type','text/javascript');res.end(bundles.get(req.url));}
  else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Isolated synthetic G03 fixture</title>');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 console.log('native fixture: launch Chromium');
 browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
async function setup(page){
 await page.goto(origin);
 await page.evaluate(async()=>{
  globalThis.a=await import('/host.mjs');globalThis.c=a.createGradeImportHost(indexedDB,navigator.locks,location.origin);
  globalThis.counts={puts:0,uuids:0,opens:0};
  const put=IDBObjectStore.prototype.put,uuid=crypto.randomUUID.bind(crypto),open=indexedDB.open.bind(indexedDB);
  IDBObjectStore.prototype.put=function(...args){counts.puts++;return put.apply(this,args);};
  crypto.randomUUID=()=>{counts.uuids++;return uuid();};
  indexedDB.open=(...args)=>{counts.opens++;return open(...args);};
  globalThis.error=async fn=>{try{await fn();return 'SUCCESS';}catch(e){return e.code||e.message;}};
  globalThis.confirmation=(t,reason='synthetic explicit adoption')=>({selectionSha256:t.selectionSha256,confirmed:true,rows:t.rows.map(r=>({...r,confirmed:true,reason}))});
  globalThis.reserve=async(source,activate=false)=>{
   globalThis.p=await c.preview(h,source);globalThis.i=await c.prepare(p,activate);return i;
  };
  globalThis.seal=async()=>{globalThis.q=await c.confirm(i,JSON.stringify(confirmation(JSON.parse(i.targetsJson))));return q;};
  globalThis.record=async()=>{const v=await a.createNativeHostStore(indexedDB).read();return v.exists?{...v}:v;};
 });
}
async function fresh(t){const ctx=await browser.newContext();t.after(()=>ctx.close());const page=await ctx.newPage();await setup(page);return {ctx,page};}
async function init(page){await page.evaluate(async()=>{globalThis.h=await c.initialize();});}
async function reservation(page,source=raw(),active=false){await page.evaluate(({source,active})=>reserve(source,active),{source,active});}
async function adoption(page,source=raw(),active=false){await reservation(page,source,active);await page.evaluate(async()=>{await seal();globalThis.result=await c.commit(q);globalThis.h=result.handle;});}
async function seed(page,value,missing=false){await page.evaluate(({value,missing})=>new Promise((resolve,reject)=>{const r=indexedDB.open('hosei-yi06-isolated-v1',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('authority');if(!missing)s.put(value,'current');};r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);}),{value,missing});}

test('V01/V06/V21: read creates nothing; locks mandatory; preview read-only; localStorage untouched',async t=>{
 const {page}=await fresh(t);
 assert.deepEqual(await page.evaluate(async()=>{localStorage.setItem('hosei-planner:v1','synthetic old bytes');const h=await c.load();return {h,dbs:await indexedDB.databases(),counts};}),{h:null,dbs:[],counts:{puts:0,uuids:0,opens:0}});
 assert.equal(await page.evaluate(()=>error(()=>a.createGradeImportHost(indexedDB,undefined,location.origin).initialize())), 'このブラウザでは安全な復元に必要なWeb Locksを利用できません。対応ブラウザで復元してください。');
 assert.deepEqual(await page.evaluate(()=>counts),{puts:0,uuids:0,opens:0});
 await init(page);const before=await page.evaluate(()=>({...counts}));
 await page.evaluate(async s=>{await c.preview(h,s);await c.preview(h,s);c.cancel();},raw());
 assert.deepEqual(await page.evaluate(()=>counts),before);
 assert.equal(await page.evaluate(()=>localStorage.getItem('hosei-planner:v1')),'synthetic old bytes');
});
for(const [label,value,missing] of [['23',{raw:'{"schemaVersion":23}',revision:0,committed:[],issuedIds:[]}],['24',{raw:'{"schemaVersion":24}',revision:0,committed:[],issuedIds:[]}],['v2',{format:'hosei-attempt-authority',version:2,coverage:'native-v2'}],['corrupt','{oops'],['unknown','{"hostVersion":99}'],['missing',null,true],['stored undefined',undefined]])
 test(`V02: preserve existing ${label}`,async t=>{
  const {page}=await fresh(t);await seed(page,value,missing);const before=await page.evaluate(()=>record());
  const b=await page.evaluate(async()=>{const before={...counts};return {init:await error(()=>c.initialize()),load:await error(()=>c.load()),before,after:counts};});
  assert.equal(b.init,'existing_database');assert.notEqual(b.load,'SUCCESS');assert.equal(b.after.puts,b.before.puts);assert.equal(b.after.uuids,b.before.uuids);
  assert.deepEqual(await page.evaluate(()=>record()),before);assert.equal(before.keyExists,!missing);
 });

test('V05/V06/V08/V15: two rows/forged objects rejected without write or UUID; getters untouched',async t=>{
 const {page}=await fresh(t);await init(page);const b=await page.evaluate(()=>({...counts}));
 const results=await page.evaluate(async s=>{
  let gets=0;const evil=Object.defineProperty({},'x',{get(){gets++;throw Error('getter');}});
  return [await error(()=>c.preview(h,evil)),gets,await error(()=>c.preview(h,s)),await error(()=>c.prepare({displayJson:'{}'},false)),await error(()=>c.commit({})),await error(()=>c.acknowledge(h,evil))];
 },JSON.stringify(input([course(),course()])));
 assert.deepEqual(results,['input_type',0,'unsupported_policy','unqualified','unqualified','input_type']);assert.equal((await page.evaluate(()=>counts)).puts,b.puts);assert.equal((await page.evaluate(()=>counts)).uuids,b.uuids);
});

test('V07: reservation crash/restart retains burn; old tickets do not revive',async()=>{
 const profile=await mkdtemp(resolve(tmpdir(),'g03-reservation-profile-'));let ctx;
 try{
  ctx=await chromium.launchPersistentContext(profile,{headless:true});let page=await ctx.newPage();await setup(page);await init(page);await reservation(page);
  const first=await page.evaluate(()=>({ids:i.issuedIds,raw:h.snapshotJson,targets:i.targetsJson}));
  const t1=await page.evaluate(async()=>{c.cancel();return (await record()).value;});
  assert.deepEqual(JSON.parse(t1).receipts,[]);assert.equal(JSON.parse(JSON.parse(t1).ledgerRaw).issuedIds.length,0);
  const session=await ctx.browser().newBrowserCDPSession();const pid1=(await session.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id;
  await ctx.close();ctx=null;
  ctx=await chromium.launchPersistentContext(profile,{headless:true});page=await ctx.newPage();await setup(page);
  const session2=await ctx.browser().newBrowserCDPSession();const pid2=(await session2.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id;
  assert.notEqual(pid1,pid2);
  const reread=await page.evaluate(async()=>{globalThis.h=await c.load();return h.snapshotJson;});assert.equal(reread,t1);
  assert.equal(await page.evaluate(()=>error(()=>c.confirm({targetsJson:'{}',issuedIds:[]},'{}'))),'unqualified');
  const reused=await page.evaluate(async({id,source})=>{const old=crypto.randomUUID;crypto.randomUUID=()=>id;try{const p=await c.preview(h,source);return await error(()=>c.prepare(p,false));}finally{crypto.randomUUID=old;}},{id:first.ids[0].split(':').at(-1),source:raw()});assert.equal(reused,'allocator_exhausted');
  await reservation(page);const next=await page.evaluate(()=>i.issuedIds);assert.equal(next.some(x=>first.ids.includes(x)),false);
  await page.evaluate(async()=>{await seal();globalThis.result=await c.commit(q);globalThis.h=result.handle;});
  const committed=await page.evaluate(()=>({raw:h.snapshotJson,receipt:result.receiptJson,outcome:result.outcomeJson}));
  await ctx.close();ctx=null;
  ctx=await chromium.launchPersistentContext(profile,{headless:true});page=await ctx.newPage();await setup(page);
  const session3=await ctx.browser().newBrowserCDPSession();const pid3=(await session3.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id;
  assert.notEqual(pid2,pid3);
  const adopted=await page.evaluate(async saved=>{globalThis.h=await c.load();const b={...counts};return {raw:h.snapshotJson,outcome:await c.acknowledge(h,saved.receipt),b,after:counts};},committed);
  assert.equal(adopted.raw,committed.raw);assert.equal(adopted.outcome,committed.outcome);assert.equal(adopted.b.puts,adopted.after.puts);assert.equal(adopted.b.uuids,adopted.after.uuids);
  console.log(JSON.stringify({processRestarts:{pid1,pid2,pid3,burnsAfterReserve:JSON.parse(reread).authority.reservedIds.length}}));
 }finally{await ctx?.close();await rm(profile,{recursive:true,force:true});}
});
for(const activate of [false,true])test(`V09/V10/V11/V12/V13: atomic adopt active=${activate}, restart/retry/different receipt`,async t=>{
 const {page}=await fresh(t);await init(page);await adoption(page,raw(),activate);
 const saved=await page.evaluate(()=>({raw:h.snapshotJson,receipt:result.receiptJson,outcome:result.outcomeJson}));const record=JSON.parse(saved.raw),l=JSON.parse(record.ledgerRaw);
 assert.deepEqual(l,oracle(l.journal.entries.map(e=>e.operation),[record.hostId]));assert.equal(record.authority.reservedIds.length,activate?28:27);assert.equal(l.journal.entries.length,activate?2:1);
 assert.equal(l.view.snapshots[0].archive.raw,raw());assert.equal(l.view.revisions[0].record.earnedCredits.value,4);
 await page.reload();await setup(page);
 const retry=await page.evaluate(async s=>{globalThis.h=await c.load();const before={...counts};const result=await c.acknowledge(h,s.receipt);const changed=JSON.parse(s.receipt);changed.decision.confirmation.rows[0].reason='different';const rejection=await error(()=>c.acknowledge(h,JSON.stringify(changed)));return {result,rejection,before,after:counts,raw:h.snapshotJson};},saved);
 assert.equal(retry.result,saved.outcome);assert.equal(retry.rejection,'receipt_conflict');assert.equal(retry.raw,saved.raw);assert.equal(retry.after.puts,retry.before.puts);assert.equal(retry.after.uuids,retry.before.uuids);
 assert.equal(await page.evaluate(s=>error(()=>c.preview(h,s)),raw()),'unsupported_policy');
});
for(const mode of ['quota','abort'])test(`V16: ${mode} abort leaves T1 data unchanged`,async t=>{
 const {page}=await fresh(t);await init(page);await reservation(page,raw(),mode==='abort');await page.evaluate(()=>seal());const before=await page.evaluate(()=>record());
 const result=await page.evaluate(async mode=>{const orig=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(mode==='quota')throw new DOMException('synthetic quota','QuotaExceededError');const r=orig.apply(this,args);this.transaction.abort();return r;};try{return {result:await error(()=>c.commit(q)),stopped:c.isStopped()};}finally{IDBObjectStore.prototype.put=orig;}},mode);
 assert.equal(result.result,'aborted');assert.equal(result.stopped,false);assert.deepEqual(await page.evaluate(()=>record()),before);
 await page.evaluate(async()=>{await seal();globalThis.result=await c.commit(q);});const accepted=JSON.parse((await page.evaluate(()=>record())).value);assert.equal(accepted.receipts.length,1);assert.equal(JSON.parse(accepted.ledgerRaw).journal.entries.length,mode==='abort'?2:1);
});

test('V14/V17: second tab reservation wins; first stale preview cannot mint/write',async t=>{
 const {ctx,page}=await fresh(t);await init(page);await page.evaluate(async s=>{globalThis.p=await c.preview(h,s);},raw());
 const other=await ctx.newPage();await setup(other);await other.evaluate(async()=>{globalThis.h=await c.load();});await reservation(other);
 const result=await page.evaluate(async()=>{const b={...counts};const e=await error(()=>c.prepare(p,false));return {e,b,after:counts,stopped:c.isStopped()};});
 assert.equal(result.e,'stale');assert.equal(result.stopped,true);assert.equal(result.b.puts,result.after.puts);assert.equal(result.b.uuids,result.after.uuids);
 assert.equal(JSON.parse((await other.evaluate(()=>record())).value).authority.reservedIds.length,27);
});
test('V17: native full raw CAS detects change including key missing/undefined',async t=>{
 const {page}=await fresh(t);await init(page);
 const result=await page.evaluate(async()=>{const s=a.createNativeHostStore(indexedDB),old=await s.read();await s.cas(old.value,old.value+' ');const b=counts.puts;const e=await error(()=>s.cas(old.value,old.value));return {e,b,puts:counts.puts,value:(await s.read()).value,expected:old.value+' '};});
 assert.equal(result.e,'stale');assert.equal(result.b,result.puts);assert.equal(result.value,result.expected);
});
for(const writer of ['old',...(process.env.G03_PR4_REFERENCE?['pr4']:[])])test(`V17: actual ${writer} stale writer put0 against G03 string`,async t=>{
 const {page}=await fresh(t);await init(page);const before=await page.evaluate(()=>record());
 await page.goto(origin+'/legacy');
 const result=await page.evaluate(async writer=>{const {createIndexedDbAttemptStore}=await import('/'+writer+'.mjs');let puts=0;const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){puts++;return old.apply(this,args);};const expected={raw:null,revision:0,committed:[],issuedIds:[]};try{await createIndexedDbAttemptStore(indexedDB).commit(expected,expected);return {puts,error:'SUCCESS'};}catch(e){return {puts,error:e.message};}finally{IDBObjectStore.prototype.put=old;}},writer);
 assert.deepEqual(result,{puts:0,error:'stale_commit'});await setup(page);assert.deepEqual(await page.evaluate(()=>record()),before);
});

test('V18: committed write then strict post-read failure stops session; explicit recovery finds receipt',async t=>{
 const {page}=await fresh(t);await init(page);await reservation(page);await page.evaluate(()=>seal());
 const result=await page.evaluate(async()=>{
  const old=IDBDatabase.prototype.transaction;let wrote=false;
  IDBDatabase.prototype.transaction=function(...args){if(wrote&&args[1]==='readonly')throw Error('synthetic post-read failure');const tx=old.apply(this,args);if(args[1]==='readwrite')tx.addEventListener('complete',()=>{wrote=true;});return tx;};
  try {const e=await error(()=>c.commit(q));return {e,stopped:c.isStopped(),later:await error(()=>c.load()),decision:q.decisionJson};}finally{IDBDatabase.prototype.transaction=old;}
 });assert.equal(result.e,'outcome_unknown');assert.equal(result.stopped,true);assert.equal(result.later,'session_stopped');
 const recovery=await page.evaluate(async()=>{
  const d=a.createGradeImportHost(indexedDB,navigator.locks,location.origin),h=await d.load();const r=JSON.parse(h.snapshotJson),receipt=r.receipts[0];const b={...counts};return {recovery:await d.recover(h,JSON.stringify({grantId:receipt.grantId,receipt})),b,after:counts};
 });assert.equal(recovery.recovery.status,'already_committed');assert.equal(recovery.b.puts,recovery.after.puts);assert.equal(recovery.b.uuids,recovery.after.uuids);
});
test('V18: unconsumed durable grant is recoverable as not-adopted; never revives ticket',async t=>{
 const {page}=await fresh(t);await init(page);await reservation(page);
 const result=await page.evaluate(async()=>{const before=(await record()).value;const id=i.issuedIds[0];c.cancel();const d=a.createGradeImportHost(indexedDB,navigator.locks,location.origin),h=await d.load();return {r:await d.recover(h,JSON.stringify({grantId:id,receipt:null})),before,after:(await record()).value};});assert.equal(result.r.status,'not_adopted_burn_retained');assert.equal(result.before,result.after);
});
test('V18/V19: cancellation after native submit is unknown; accepted data is not rolled back',async t=>{
 const {page}=await fresh(t);await init(page);await reservation(page);await page.evaluate(()=>seal());
 const result=await page.evaluate(async()=>{const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const result=old.apply(this,args);c.cancel();return result;};try{return {e:await error(()=>c.commit(q)),stopped:c.isStopped()};}finally{IDBObjectStore.prototype.put=old;}});
 assert.deepEqual(result,{e:'outcome_unknown',stopped:true});assert.equal(JSON.parse((await page.evaluate(()=>record())).value).receipts.length,1);
});
test('V19: cancellation while waiting on shared Lock prevents T1/T2 put',async t=>{
 const {ctx,page}=await fresh(t);await init(page);await page.evaluate(async s=>{globalThis.p=await c.preview(h,s);},raw());
 const lock=await ctx.newPage();await lock.goto(origin);await lock.evaluate(()=>{globalThis.wait=navigator.locks.request('hosei-planner:v1:write',()=>new Promise(resolve=>{globalThis.release=resolve;globalThis.held=true;}));});await lock.waitForFunction(()=>globalThis.held);
 await page.evaluate(()=>{globalThis.pending=error(()=>c.prepare(p,false));});await page.evaluate(()=>c.cancel());await lock.evaluate(()=>release());assert.equal(await page.evaluate(()=>pending),'cancelled');
 assert.equal(JSON.parse((await page.evaluate(()=>record())).value).events.length,0);
 await reservation(page);await page.evaluate(()=>seal());
 await lock.evaluate(()=>{globalThis.held=false;globalThis.wait=navigator.locks.request('hosei-planner:v1:write',()=>new Promise(resolve=>{globalThis.release=resolve;globalThis.held=true;}));});await lock.waitForFunction(()=>held);
 const before=await page.evaluate(()=>record());await page.evaluate(()=>{globalThis.pending=error(()=>c.commit(q));});await page.evaluate(()=>c.cancel());await lock.evaluate(()=>release());assert.equal(await page.evaluate(()=>pending),'cancelled');assert.deepEqual(await page.evaluate(()=>record()),before);
});
test('V14: observed environment revocation stops old session even if provider later recovers',async t=>{
 const {page}=await fresh(t);await init(page);
 const r=await page.evaluate(async s=>{
  globalThis.changed=false;globalThis.c=a.createGradeImportHost(indexedDB,navigator.locks,location.origin,()=>a.environment(changed?'https://changed.invalid':location.origin));globalThis.h=await c.load();globalThis.p=await c.preview(h,s);changed=true;const e=await error(()=>c.prepare(p,false));changed=false;return {e,stopped:c.isStopped(),again:await error(()=>c.load())};
 },raw());assert.deepEqual(r,{e:'stale',stopped:true,again:'session_stopped'});
});
test('V20: late upgrade after blocked open never creates current',async t=>{
 const {page}=await fresh(t);const r=await page.evaluate(async()=>{
  let wrote=0,aborts=0;
  const req={},factory={databases:async()=>[],open:()=>{queueMicrotask(()=>{req.onblocked();queueMicrotask(()=>{req.transaction={abort(){aborts++;}};req.result={createObjectStore(){wrote++;throw Error('must not write');}};req.onupgradeneeded({oldVersion:0});});});return req;}};
  return {error:await error(()=>a.createNativeHostStore(factory).initialize('{}')),get wrote(){return wrote;},get aborts(){return aborts;}};
 });assert.equal(r.error,'database_blocked');assert.equal(r.wrote,0);assert.equal(r.aborts,1);
});
for(const phase of ['reserve','adopt'])test(`V18: ambiguous ${phase} submission suspends session without rollback or automatic resend`,async t=>{
 const {page}=await fresh(t);await init(page);
 if(phase==='adopt'){await reservation(page);await page.evaluate(()=>seal());}else await page.evaluate(async s=>{globalThis.p=await c.preview(h,s);},raw());
 const r=await page.evaluate(async phase=>{
  const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const result=old.apply(this,args);this.transaction.abort=()=>{throw Error('synthetic unavailable abort');};throw Error('synthetic submission result unknown');};
  try{return {error:await error(()=>phase==='reserve'?c.prepare(p,false):c.commit(q)),stopped:c.isStopped(),next:await error(()=>c.load())};}finally{IDBObjectStore.prototype.put=old;}
 },phase);
 assert.deepEqual(r,{error:'outcome_unknown',stopped:true,next:'session_stopped'});
 const record=JSON.parse((await page.evaluate(()=>record())).value);assert.equal(record.receipts.length,phase==='adopt'?1:0);assert.equal(record.authority.reservedIds.length,27);
 const recovered=await page.evaluate(async phase=>{const d=a.createGradeImportHost(indexedDB,navigator.locks,location.origin),h=await d.load(),r=JSON.parse(h.snapshotJson);const receipt=r.receipts[0]??null;return d.recover(h,JSON.stringify({grantId:r.events[0].body.grant.intentId,receipt}));},phase);
 assert.equal(recovered.status,phase==='adopt'?'already_committed':'not_adopted_burn_retained');
});
for(const mode of ['missing','undefined'])test(`V17: CAS distinguishes present undefined and missing key (${mode})`,async t=>{
 const {page}=await fresh(t);await init(page);
 const r=await page.evaluate(async mode=>{
  const store=a.createNativeHostStore(indexedDB),before=await store.read();
  await new Promise((resolve,reject)=>{const req=indexedDB.open('hosei-yi06-isolated-v1',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction('authority','readwrite');const s=tx.objectStore('authority');if(mode==='missing')s.delete('current');else s.put(undefined,'current');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
  const current=await store.read(),b=counts.puts;const rejection=await error(()=>store.cas(before.value,before.value));return {key:current.keyExists,value:current.value,rejection,b,after:counts.puts};
 },mode);assert.equal(r.key,mode==='undefined');assert.equal(r.value,undefined);assert.equal(r.rejection,'stale');assert.equal(r.b,r.after);
});
test('V19: cancellation during T1 submit retains durable H and publishes no prepared ticket',async t=>{
 const {page}=await fresh(t);await init(page);await page.evaluate(async s=>{globalThis.p=await c.preview(h,s);},raw());
 const r=await page.evaluate(async()=>{const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const r=old.apply(this,args);c.cancel();return r;};try{return {e:await error(()=>c.prepare(p,false)),stopped:c.isStopped()};}finally{IDBObjectStore.prototype.put=old;}});
 assert.deepEqual(r,{e:'outcome_unknown',stopped:true});const state=JSON.parse((await page.evaluate(()=>record())).value);assert.equal(state.authority.reservedIds.length,27);assert.equal(state.receipts.length,0);assert.equal(JSON.parse(state.ledgerRaw).issuedIds.length,0);
});

test('V08/V13: live intent binds one decision; allocation spoof and altered reason cannot be sealed',async t=>{
 const {page}=await fresh(t);await init(page);await reservation(page);await page.evaluate(()=>seal());
 const r=await page.evaluate(async()=>{
  const t=JSON.parse(i.targetsJson),confirmation1=confirmation(t),other=confirmation(t,'changed reason'),bad={...confirmation1,allocation:{importOperationId:'fake'}};
  return {copy:await error(()=>c.confirm({...i},JSON.stringify(confirmation1))),bad:await error(()=>c.confirm(i,JSON.stringify(bad))),changed:await error(()=>c.confirm(i,JSON.stringify(other)))};
 });assert.equal(r.copy,'unqualified');assert.equal(r.bad,'shape');assert.equal(r.changed,'receipt_conflict');
 await page.evaluate(async()=>{globalThis.result=await c.commit(q);});assert.equal(JSON.parse((await page.evaluate(()=>record())).value).receipts.length,1);
});
test('V01/V02/V20: unsupported database version and unavailable inventory fail closed',async t=>{
 const {page}=await fresh(t);
 const r=await page.evaluate(async()=>{
  const noInventory={open:indexedDB.open.bind(indexedDB)};const b={...counts};const denied=await error(()=>a.createGradeImportHost(noInventory,navigator.locks,location.origin).initialize());
  await new Promise((resolve,reject)=>{const req=indexedDB.open('hosei-yi06-isolated-v1',2);req.onupgradeneeded=()=>req.result.createObjectStore('authority').put('foreign-version-bytes','current');req.onsuccess=()=>{req.result.close();resolve();};req.onerror=()=>reject(req.error);});
  const at=counts.puts,init=await error(()=>c.initialize()),load=await error(()=>c.load());
  const value=await new Promise(resolve=>{const req=indexedDB.open('hosei-yi06-isolated-v1',2);req.onsuccess=()=>{const db=req.result,tx=db.transaction('authority','readonly'),get=tx.objectStore('authority').get('current');tx.oncomplete=()=>{db.close();resolve(get.result);};};});
  return {denied,b,init,load,at,puts:counts.puts,value,uuids:counts.uuids};
 });assert.equal(r.denied,'database_inventory_unavailable');assert.equal(r.init,'existing_database');assert.equal(r.load,'existing_database');assert.equal(r.at,r.puts);assert.equal(r.value,'foreign-version-bytes');assert.equal(r.uuids,0);
});
test('V21: T1/T2 strict transactions and post-reads stay inside common exclusive Lock',async t=>{
 const {page}=await fresh(t);
 const r=await page.evaluate(async source=>{
  let held=false;const requests=[],transactions=[];const locks={request:(name,opts,action)=>navigator.locks.request(name,opts,async()=>{held=true;requests.push({name,mode:opts.mode});try{return await action();}finally{held=false;}})};
  const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){transactions.push({held,mode:args[1],durability:args[2]?.durability??null});if(!held)throw Error('outside Lock');return original.apply(this,args);};
  try{globalThis.c=a.createGradeImportHost(indexedDB,locks,location.origin);globalThis.h=await c.initialize();await reserve(source);await seal();globalThis.result=await c.commit(q);return {requests,transactions};}finally{IDBDatabase.prototype.transaction=original;}
 },raw());assert.ok(r.transactions.length>=5);assert.equal(r.transactions.every(x=>x.held),true);assert.deepEqual(r.transactions.filter(x=>x.mode==='readwrite').map(x=>x.durability),['strict','strict']);assert.equal(r.requests.length,3);assert.equal(r.requests.every(x=>x.name==='hosei-planner:v1:write'&&x.mode==='exclusive'),true);
});

test('V14/V17: another tab adopts atomically; stale proposal cannot replace winner',async t=>{
 const {ctx,page}=await fresh(t);await init(page);await reservation(page);await page.evaluate(()=>seal());
 const other=await ctx.newPage();await setup(other);await other.evaluate(async()=>{globalThis.h=await c.load();});await adoption(other);
 const winner=(await other.evaluate(()=>record())).value;const result=await page.evaluate(async()=>{const before={...counts};return {e:await error(()=>c.commit(q)),before,after:counts,stopped:c.isStopped()};});
 assert.equal(result.e,'stale');assert.equal(result.stopped,true);assert.equal(result.before.puts,result.after.puts);assert.equal(result.before.uuids,result.after.uuids);
 assert.equal((await page.evaluate(()=>record())).value,winner);const state=JSON.parse(winner);assert.equal(state.receipts.length,1);assert.equal(state.authority.reservedIds.length,53);assert.equal(JSON.parse(state.ledgerRaw).view.revisions.length,1);
});
test('V19: cancel after private mint but before T1 submit publishes nothing; session burn prevents reuse',async t=>{
 const {page}=await fresh(t);await init(page);await page.evaluate(async s=>{globalThis.p=await c.preview(h,s);},raw());
 const r=await page.evaluate(async source=>{
  const old=crypto.randomUUID,privateIds=[];const before=(await record()).value,b=counts.puts;
  crypto.randomUUID=()=>{const id=old();privateIds.push(id);if(privateIds.length===26)queueMicrotask(()=>c.cancel());return id;};
  let rejected;try{rejected=await error(()=>c.prepare(p,false));}finally{crypto.randomUUID=old;}
  const after=(await record()).value,puts=counts.puts;globalThis.h=await c.load();await reserve(source);
  return {rejected,b,puts,before,after,reused:i.issuedIds.some(id=>privateIds.includes(id.split(':').at(-1)))};
 },raw());assert.equal(r.rejected,'cancelled');assert.equal(r.b,r.puts);assert.equal(r.before,r.after);assert.equal(r.reused,false);
});
test('V02: database created by a racing foreign writer between inventory and open is never overwritten',async t=>{
 const {page}=await fresh(t);
 const r=await page.evaluate(async()=>{
  const originalOpen=indexedDB.open.bind(indexedDB);let raced=false;
  const factory={databases:indexedDB.databases.bind(indexedDB),open(...args){if(!raced){raced=true;const peer=originalOpen(...args);peer.onupgradeneeded=()=>peer.result.createObjectStore('authority').put({foreign:'exact bytes'},'current');peer.onsuccess=()=>peer.result.close();}return originalOpen(...args);}};
  const c=a.createGradeImportHost(factory,navigator.locks,location.origin),result=await error(()=>c.initialize());const v=await record();return {result,v,puts:counts.puts};
 });assert.equal(r.result,'existing_database');assert.deepEqual(r.v.value,{foreign:'exact bytes'});assert.equal(r.puts,1);
});
test('V20/V18: real versionchange during submission preserves commit and stops uncertain session',async t=>{
 const {page}=await fresh(t);await init(page);await reservation(page);await page.evaluate(()=>seal());
 const r=await page.evaluate(async()=>{
  const oldPut=IDBObjectStore.prototype.put,oldOpen=indexedDB.open;let changes=0,upgrade;
  indexedDB.open=function(...args){const r=oldOpen.apply(this,args);r.addEventListener('success',()=>r.result.addEventListener('versionchange',()=>{changes++;}));return r;};
  IDBObjectStore.prototype.put=function(...args){
   const r=oldPut.apply(this,args),bucket=this;
   // Keep this real native transaction active until the queued versionchange
   // event is observed. Without this scheduling barrier it may finish/close
   // before the peer open runs, which exercises a different (also safe) race.
   function pending(){const get=bucket.get('current');get.onsuccess=()=>{if(changes===0)pending();};}pending();
   upgrade=new Promise((resolve,reject)=>{const req=indexedDB.open('hosei-yi06-isolated-v1',2);req.onsuccess=()=>{req.result.close();resolve();};req.onerror=()=>reject(req.error);});return r;
  };
  let e;try{e=await error(()=>c.commit(q));await upgrade;}finally{IDBObjectStore.prototype.put=oldPut;indexedDB.open=oldOpen;}
  const value=await new Promise(resolve=>{const req=indexedDB.open('hosei-yi06-isolated-v1',2);req.onsuccess=()=>{const db=req.result,tx=db.transaction('authority','readonly'),get=tx.objectStore('authority').get('current');tx.oncomplete=()=>{db.close();resolve(get.result);};};});
  return {e,changes,stopped:c.isStopped(),value};
 });assert.equal(r.e,'outcome_unknown');assert.equal(r.stopped,true);assert.ok(r.changes>=1);const state=JSON.parse(r.value);assert.equal(state.receipts.length,1);assert.equal(JSON.parse(state.ledgerRaw).view.revisions[0].record.earnedCredits.value,4);
});

// F-01: A -> observed abnormal B -> exact A restoration is fault injection.
// Restoration is performed only by these tests, never by the host controller.
async function f01Write(page,mode,saved){
 await page.evaluate(async({mode,saved})=>{
  if(mode==='transport'){
   globalThis.f01Databases=indexedDB.databases;
   indexedDB.databases=async()=>{throw Object.assign(new Error('synthetic read failure'),{code:'f01_read_failure'});};return;
  }
  if(globalThis.f01Databases){indexedDB.databases=f01Databases;delete globalThis.f01Databases;}
  if(mode==='absent'){
   await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('hosei-yi06-isolated-v1');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});return;
  }
  await new Promise((resolve,reject)=>{
   const req=indexedDB.open('hosei-yi06-isolated-v1',1);
   req.onupgradeneeded=()=>req.result.createObjectStore('authority');
   req.onsuccess=()=>{
    const db=req.result,tx=db.transaction('authority','readwrite'),s=tx.objectStore('authority');
    if(mode==='missing')s.delete('current');
    else if(mode==='undefined')s.put(undefined,'current');
    else if(mode==='corrupt')s.put('{broken','current');
    else if(mode==='non-string')s.put({foreign:'not a G03 string'},'current');
    else if(mode==='decode'){const altered=JSON.parse(saved);altered.authority.generation++;s.put(JSON.stringify(altered),'current');}
    else s.put(saved,'current');
    tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
   };req.onerror=()=>reject(req.error);
  });
 },{mode,saved});
}
async function f01Ready(page){
 await init(page);await reservation(page,raw(),true);
 return page.evaluate(async source=>{
  globalThis.hA=await c.load();globalThis.pA=await c.preview(hA,source);
  globalThis.f01Confirmation=JSON.stringify(confirmation(JSON.parse(i.targetsJson)));
  globalThis.q=await c.confirm(i,f01Confirmation);globalThis.qSpare=await c.confirm(i,f01Confirmation);
  return hA.snapshotJson;
 },raw());
}
for(const [mode,firstCode] of [['corrupt','invalid_json'],['missing','invalid_host'],['undefined','invalid_host']])
 test(`F-01 ABA ${mode}: first code/put0, irreversible old credentials, new-controller burn recovery`,async t=>{
  const {page}=await fresh(t),saved=await f01Ready(page);await f01Write(page,mode,saved);
  const first=await page.evaluate(async()=>{const b={...counts},code=await error(()=>c.commit(q));return {code,stopped:c.isStopped(),putDelta:counts.puts-b.puts,uuidDelta:counts.uuids-b.uuids};});
  await f01Write(page,'restore',saved);
  const next=await page.evaluate(async source=>{
   const b={...counts},codes={};
   codes.confirm=await error(()=>c.confirm(i,f01Confirmation));codes.commit=await error(()=>c.commit(qSpare));codes.prepare=await error(()=>c.prepare(pA,false));
   codes.preview=await error(()=>c.preview(hA,source));codes.load=await error(()=>c.load());codes.initialize=await error(()=>c.initialize());
   codes.acknowledge=await error(()=>c.acknowledge(hA,'{}'));codes.recover=await error(()=>c.recover(hA,JSON.stringify({grantId:i.issuedIds[0],receipt:null})));
   codes.badAckAfterStop=await error(()=>c.acknowledge(hA,undefined));codes.badRecoverAfterStop=await error(()=>c.recover(hA,undefined));
   const deltas={puts:counts.puts-b.puts,uuids:counts.uuids-b.uuids};
   const d=a.createGradeImportHost(indexedDB,navigator.locks,location.origin),dh=await d.load();
   let recovery;try{recovery=await d.recover(dh,JSON.stringify({grantId:i.issuedIds[0],receipt:null}));}catch(e){recovery={code:e.code||e.message};}
   return {codes,deltas,newRaw:dh.snapshotJson,recovery,H:JSON.parse(dh.snapshotJson).authority.reservedIds};
  },raw());
  console.log(JSON.stringify({F01:mode,first,oldCodes:next.codes,afterRestore:next.deltas,newRecovery:next.recovery}));
  assert.deepEqual(first,{code:firstCode,stopped:true,putDelta:0,uuidDelta:0});
  assert.deepEqual(Object.values(next.codes),Array(Object.keys(next.codes).length).fill('session_stopped'));
  assert.deepEqual(next.deltas,{puts:0,uuids:0});assert.equal(next.newRaw,saved);assert.deepEqual(next.recovery,{status:'not_adopted_burn_retained'});
  assert.deepEqual(next.H,JSON.parse(saved).authority.reservedIds);assert.equal(next.H.length,28);
 });
for(const route of ['load','prepare','acknowledge','recover','initialize'])for(const [mode,code] of [['corrupt','invalid_json'],['missing','invalid_host'],['undefined','invalid_host']])
 test(`F-01 read route ${route}/${mode}: old qualification cannot resume after A restoration`,async t=>{
  const {page}=await fresh(t),saved=await f01Ready(page);
  if(route==='prepare')await page.evaluate(()=>c.cancel());
  await f01Write(page,mode,saved);
  const first=await page.evaluate(async route=>{
   const before={...counts};const actions={load:()=>c.load(),prepare:()=>c.prepare(pA,false),acknowledge:()=>c.acknowledge(hA,'{}'),recover:()=>c.recover(hA,JSON.stringify({grantId:i.issuedIds[0],receipt:null})),initialize:()=>c.initialize()};
   const code=await error(actions[route]);return {code,stopped:c.isStopped(),puts:counts.puts-before.puts,uuids:counts.uuids-before.uuids};
  },route);
  await f01Write(page,'restore',saved);
  const after=await page.evaluate(async()=>{const before={...counts};return {code:await error(()=>c.load()),puts:counts.puts-before.puts,uuids:counts.uuids-before.uuids};});
  assert.deepEqual(first,{code,stopped:true,puts:0,uuids:0});assert.deepEqual(after,{code:'session_stopped',puts:0,uuids:0});
 });
for(const route of ['commit','load'])for(const [mode,code] of [['transport','f01_read_failure'],['absent','stale'],['non-string','invalid_host'],['decode','invalid_host']])
 test(`F-01 read failure ${route}/${mode}: first error preserved and session permanently stopped`,async t=>{
  const {page}=await fresh(t),saved=await f01Ready(page);await f01Write(page,mode,saved);
  const first=await page.evaluate(async route=>{const before={...counts},code=await error(()=>route==='commit'?c.commit(q):c.load());return {code,stopped:c.isStopped(),puts:counts.puts-before.puts,uuids:counts.uuids-before.uuids};},route);
  await f01Write(page,'restore',saved);
  const after=await page.evaluate(async()=>({confirm:await error(()=>c.confirm(i,f01Confirmation)),load:await error(()=>c.load())}));
  assert.deepEqual(first,{code,stopped:true,puts:0,uuids:0});assert.deepEqual(after,{confirm:'session_stopped',load:'session_stopped'});
 });
test('F-01 control: repeated never-initialized loads are normal null, then initialize remains possible',async t=>{
 const {page}=await fresh(t);assert.deepEqual(await page.evaluate(async()=>({one:await c.load(),two:await c.load(),stopped:c.isStopped(),counts})),{one:null,two:null,stopped:false,counts:{puts:0,uuids:0,opens:0}});
 await init(page);assert.equal(await page.evaluate(()=>c.isStopped()),false);
});
test('F-01 control: invalid caller JSON/copy credentials/preview errors do not revoke a valid native session',async t=>{
 const {page}=await fresh(t);await init(page);
 const r=await page.evaluate(async source=>{
  const before={...counts};let gets=0;const evil=Object.defineProperty({},'raw',{get(){gets++;throw Error('getter');}});
  const codes=[await error(()=>c.preview(h,evil)),await error(()=>c.preview({...h},source)),await error(()=>c.prepare({},false)),await error(()=>c.commit({})),await error(()=>c.confirm({},'{}')),await error(()=>c.acknowledge(h,undefined)),await error(()=>c.recover(h,undefined)),await error(()=>c.acknowledge(h,'{}')),await error(()=>c.recover(h,'{}'))];
  const result={codes,gets,stopped:c.isStopped(),delta:{puts:counts.puts-before.puts,uuids:counts.uuids-before.uuids}};
  await reserve(source);await seal();globalThis.result=await c.commit(q);return result;
 },raw());assert.deepEqual(r.codes,['input_type','unqualified','unqualified','unqualified','unqualified','input_type','input_type','receipt_conflict','shape']);assert.equal(r.gets,0);assert.equal(r.stopped,false);assert.deepEqual(r.delta,{puts:0,uuids:0});
});
for(const [mode,code] of [['missing','database_missing'],['version','existing_database']])
 test(`F-01 CAS acquisition ${mode}: qualified read failure between fresh and transaction revokes authority`,async t=>{
  const {page}=await fresh(t),saved=await f01Ready(page);
  const result=await page.evaluate(async mode=>{
   const original=indexedDB.databases.bind(indexedDB);let samples=0;
   indexedDB.databases=async()=>{const value=await original();if(++samples===3)return mode==='missing'?[]:value.map(v=>({...v,version:2}));return value;};
   const before={...counts};let first;
   try{first=await error(()=>c.commit(q));}finally{indexedDB.databases=original;}
   return {first,stopped:c.isStopped(),samples,puts:counts.puts-before.puts,uuids:counts.uuids-before.uuids,reconfirm:await error(()=>c.confirm(i,f01Confirmation))};
  },mode);
  console.log(JSON.stringify({F01CAS:mode,...result}));
  assert.deepEqual(result,{first:code,stopped:true,samples:3,puts:0,uuids:0,reconfirm:'session_stopped'});
  assert.equal((await page.evaluate(()=>record())).value,saved);
 });
