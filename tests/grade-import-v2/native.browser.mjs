// Synthetic data only; dedicated loopback origin and isolated Chromium profiles.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { raw, course, input, oracle } from '../grade-import-host/fixture.mjs';

const root=new URL('../../',import.meta.url).pathname;
let server,browser,origin,chromium;
const bundles=new Map();
before(async()=>{
 console.log('native fixture: load Playwright');
 ({chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright'));
 const entries={host:`export * from './src/planner/attempts/gradeImportHost/controller';export {createGradeImportHostV2} from './src/planner/attempts/gradeImportHost/controllerV2';export * as v2 from './src/planner/attempts/gradeImportHost/codecV2';export {decodeNativeRecord} from './src/planner/attempts/gradeImportHost/dispatch';export * from './src/planner/attempts/gradeImportHost/codec';export * from './src/planner/attempts/gradeImportHost/nativeStore';`,
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

async function oldRecord(page,source=raw(),unused=false){await init(page);if(unused){await reservation(page,source);await page.evaluate(async()=>{globalThis.retired=i;c.cancel();globalThis.h=await c.load();});}await adoption(page,source,true);return page.evaluate(()=>({raw:h.snapshotJson,receipt:result.receiptJson,outcome:result.outcomeJson}));}
async function migrate(page){return page.evaluate(async()=>{
 globalThis.oldC=c;globalThis.c=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin);globalThis.h=await c.load();
 globalThis.up=await c.prepareUpgrade(h);globalThis.upReceipt=JSON.stringify({...JSON.parse(up.targetJson),confirmed:true,reason:'explicit synthetic policy migration'});globalThis.upQ=await c.confirmUpgrade(up,upReceipt);globalThis.upResult=await c.commitUpgrade(upQ);
 if(!c.isStopped())throw Error('upgrader must retire');
 globalThis.c=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin);globalThis.h=await c.load();
 globalThis.reserve=async(source,active=false,refOverride=undefined)=>{globalThis.p=await c.preview(h,source);const preview=JSON.parse(p.displayJson),candidate=preview.rows[0].candidates.find(x=>x.isLatest);const ref=refOverride===undefined?(candidate?{achievementId:candidate.achievementId,revisionId:candidate.revisionId,observationId:candidate.observationId}:null):refOverride;globalThis.i=await c.prepare(p,active,JSON.stringify(ref));return i;};
 return h.snapshotJson;
});}
async function replace(page,mode,value){return page.evaluate(({mode,value})=>new Promise((resolve,reject)=>{const r=indexedDB.open('hosei-yi06-isolated-v1',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('authority','readwrite'),s=tx.objectStore('authority');if(mode==='missing')s.delete('current');else s.put(mode==='undefined'?undefined:value,'current');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};}),{mode,value});}
test('T01/T03/T10/T14: native v1 migration, 4->2, exact old/new ack and full replay',async t=>{
 const {page}=await fresh(t),old=await oldRecord(page,raw(),true);const migrated=JSON.parse(await migrate(page));assert.equal(migrated.legacyBaseRaw,old.raw);assert.deepEqual(migrated.authority.reservedIds,JSON.parse(old.raw).authority.reservedIds);
 const retired=await page.evaluate(async()=>{const b={...counts};const outcome=await c.recover(h,JSON.stringify({grantId:retired.issuedIds[0],receipt:null}));return {outcome,code:await error(()=>c.confirm(retired,'{}')),b,after:counts};});assert.equal(retired.outcome.status,'not_adopted_burn_retained');assert.equal(retired.code,'unqualified');assert.equal(retired.b.puts,retired.after.puts);assert.equal(retired.b.uuids,retired.after.uuids);
 const oldAck=await page.evaluate(async s=>{const b={...counts};return {ack:await c.acknowledge(h,s.receipt),b,after:counts};},old);assert.equal(oldAck.ack,old.outcome);assert.equal(oldAck.b.puts,oldAck.after.puts);assert.equal(oldAck.b.uuids,oldAck.after.uuids);
 await adoption(page,raw(2),true);const saved=await page.evaluate(()=>({raw:h.snapshotJson,receipt:result.receiptJson,outcome:result.outcomeJson}));const r=JSON.parse(saved.raw),l=JSON.parse(r.ledgerRaw);assert.equal(r.legacyBaseRaw,old.raw);assert.deepEqual(l.view.revisions.map(x=>x.record.earnedCredits.value),[4,2]);assert.deepEqual(l,oracle(l.journal.entries.map(e=>e.operation),[r.hostId]));assert.equal(r.authority.reservedIds.length,migrated.authority.reservedIds.length+19);
 const ack=await page.evaluate(async s=>{const d=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin),h=await d.load(),b={...counts};const ack=await d.acknowledge(h,s.receipt);const changed=JSON.parse(s.receipt);changed.decision.confirmation.rows[0].reason='different';return {raw:h.snapshotJson,ack,b,after:counts,rejected:await error(()=>d.acknowledge(h,JSON.stringify(changed)))};},saved);assert.equal(ack.raw,saved.raw);assert.equal(ack.ack,saved.outcome);assert.equal(ack.rejected,'receipt_conflict');assert.equal(ack.b.puts,ack.after.puts);assert.equal(ack.b.uuids,ack.after.uuids);
});
for(const active of [false,true])test(`T04/T08: T1 burn and exact abort retry, active=${active}`,async t=>{
 const {page}=await fresh(t);await oldRecord(page);await migrate(page);await reservation(page,raw(2),active);await page.evaluate(()=>seal());const before=await page.evaluate(()=>record());
 const r=await page.evaluate(async()=>{const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw new DOMException('quota','QuotaExceededError');};try{return {e:await error(()=>c.commit(q)),stopped:c.isStopped()};}finally{IDBObjectStore.prototype.put=old;}});assert.deepEqual(r,{e:'aborted',stopped:false});assert.deepEqual(await page.evaluate(()=>record()),before);
 await page.evaluate(async()=>{await seal();globalThis.result=await c.commit(q);globalThis.h=result.handle;});const state=JSON.parse((await page.evaluate(()=>record())).value),l=JSON.parse(state.ledgerRaw);assert.equal(l.view.revisions.length,2);assert.equal(l.view.achievements[0].activeRevisionId,l.view.revisions[active?1:0].id);
});
for(const [from,to]of [[null,2],[0,2],[4,0]])test(`T05: ${from}->${to} keeps exact historical quantity`,async t=>{const {page}=await fresh(t);const old=await oldRecord(page,raw(from));await migrate(page);await adoption(page,raw(to),true);const r=JSON.parse((await page.evaluate(()=>record())).value);assert.equal(r.legacyBaseRaw,old.raw);assert.deepEqual(JSON.parse(r.ledgerRaw).view.revisions.map(x=>x.record.earnedCredits.value),[from,to]);});
test('T02: explicit empty v2, first new and successive corrections',async t=>{
 const {page}=await fresh(t);await page.evaluate(async()=>{globalThis.c=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin);globalThis.h=await c.initialize();});
 await adoption(page,raw(),true);const original=(await page.evaluate(()=>record())).value;
 // install the explicit-ID helper used after migration without upgrading again
 await page.evaluate(()=>{globalThis.h=result.handle;globalThis.reserve=async(source,active=false)=>{globalThis.p=await c.preview(h,source);const candidate=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest);globalThis.i=await c.prepare(p,active,JSON.stringify({achievementId:candidate.achievementId,revisionId:candidate.revisionId,observationId:candidate.observationId}));};});
 await adoption(page,raw(2),true);await adoption(page,raw(0),true);const r=JSON.parse((await page.evaluate(()=>record())).value);assert.equal(r.baseProvenance,'native-v2-empty');assert.deepEqual(JSON.parse(r.ledgerRaw).view.revisions.map(x=>x.record.earnedCredits.value),[4,2,0]);assert.equal(JSON.parse(original).receipts.length,1);
});
test('T06/T07/T15: unsupported rows/year/name/unchanged DTO and foreign candidate refuse put/UUID',async t=>{
 const {page}=await fresh(t);await oldRecord(page);await migrate(page);
 const r=await page.evaluate(async({same,multi,year,renamed,missing})=>{
  const before={...counts},codes=[];codes.push(await error(()=>c.preview(h,same)));codes.push(await error(()=>c.preview(h,multi)));codes.push(await error(()=>c.preview(h,missing)));
  for(const raw of [year,renamed]){const p=await c.preview(h,raw);codes.push(await error(()=>c.prepare(p,true,JSON.stringify({achievementId:'foreign',revisionId:'foreign',observationId:'foreign'}))));}
  return {codes,before,after:counts};
 },{same:raw(),multi:JSON.stringify(input([course(),course()])),year:raw(2,'2023'),renamed:JSON.stringify(input([course('renamed',2,'2024')])),missing:JSON.stringify({...input([course()]),courses:[{...course(),earnedCredits:undefined}]})});assert.equal(r.codes.every(x=>x!=='SUCCESS'),true);assert.equal(r.before.puts,r.after.puts);assert.equal(r.before.uuids,r.after.uuids);
});
for(const mode of ['corrupt','missing','undefined','decode'])test(`T12: v2 F-01 ABA ${mode} never revives qualification`,async t=>{
 const {page}=await fresh(t);await oldRecord(page);await migrate(page);await reservation(page,raw(2),true);await page.evaluate(()=>seal());const A=(await page.evaluate(()=>record())).value;let B='{broken';if(mode==='decode'){const r=JSON.parse(A);r.authority.generation++;B=JSON.stringify(r);}await replace(page,mode,B);
 const first=await page.evaluate(async()=>{const b={...counts};return {e:await error(()=>c.commit(q)),stopped:c.isStopped(),puts:counts.puts-b.puts,ids:counts.uuids-b.uuids};});assert.notEqual(first.e,'SUCCESS');assert.equal(first.stopped,true);assert.equal(first.puts,0);assert.equal(first.ids,0);
 await replace(page,'restore',A);const second=await page.evaluate(async()=>{const b={...counts};const codes=[await error(()=>c.confirm(i,JSON.stringify(confirmation(JSON.parse(i.targetsJson))))),await error(()=>c.commit(q)),await error(()=>c.prepare(p,false)),await error(()=>c.load()),await error(()=>c.acknowledge(h,undefined))];const d=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin),dh=await d.load();return {codes,puts:counts.puts-b.puts,ids:counts.uuids-b.uuids,recovery:await d.recover(dh,JSON.stringify({grantId:i.issuedIds[0],receipt:null}))};});assert.deepEqual(second.codes,Array(5).fill('session_stopped'));assert.equal(second.puts,0);assert.equal(second.ids,0);assert.equal(second.recovery.status,'not_adopted_burn_retained');
});
test('T09: second tab correction wins, stale old proposal puts zero',async t=>{
 const {page,ctx}=await fresh(t);await oldRecord(page);await migrate(page);await reservation(page,raw(2),true);await page.evaluate(()=>seal());
 const other=await ctx.newPage();await setup(other);await other.evaluate(async()=>{globalThis.c=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin);globalThis.h=await c.load();globalThis.reserve=async(s,active)=>{globalThis.p=await c.preview(h,s);const x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest);globalThis.i=await c.prepare(p,active,JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId}));};});await adoption(other,raw(0),true);const winner=(await other.evaluate(()=>record())).value;
 const lost=await page.evaluate(async()=>{const b=counts.puts;return {e:await error(()=>c.commit(q)),stopped:c.isStopped(),puts:counts.puts-b};});assert.deepEqual(lost,{e:'stale',stopped:true,puts:0});assert.equal((await page.evaluate(()=>record())).value,winner);
});
for(const phase of ['upgrade','adopt'])test(`T11: ${phase} committed then post-read failure is unknown; explicit recovery`,async t=>{
 const {page}=await fresh(t);await oldRecord(page);if(phase==='adopt'){await migrate(page);await reservation(page,raw(2),true);await page.evaluate(()=>seal());}else await page.evaluate(async()=>{globalThis.c=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin);globalThis.h=await c.load();globalThis.up=await c.prepareUpgrade(h);globalThis.upReceipt=JSON.stringify({...JSON.parse(up.targetJson),confirmed:true,reason:'upgrade'});globalThis.upQ=await c.confirmUpgrade(up,upReceipt);});
 const r=await page.evaluate(async phase=>{const old=IDBDatabase.prototype.transaction;let wrote=false;IDBDatabase.prototype.transaction=function(...args){if(wrote&&args[1]==='readonly')throw Error('lost post-read');const tx=old.apply(this,args);if(args[1]==='readwrite')tx.addEventListener('complete',()=>{wrote=true;});return tx;};try{return {e:await error(()=>phase==='upgrade'?c.commitUpgrade(upQ):c.commit(q)),stopped:c.isStopped()};}finally{IDBDatabase.prototype.transaction=old;}},phase);assert.deepEqual(r,{e:'outcome_unknown',stopped:true});
 const recovered=await page.evaluate(async phase=>{const d=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin),h=await d.load(),r=JSON.parse(h.snapshotJson);return phase==='upgrade'?d.recoverUpgrade(h,upReceipt):d.recover(h,JSON.stringify({grantId:i.issuedIds[0],receipt:r.receipts.at(-1)}));},phase);assert.equal(recovered.status,phase==='upgrade'?'already_upgraded':'already_committed');
});
test('T11: actual browser process restart after migration and correction',async()=>{
 const profile=await mkdtemp(resolve(tmpdir(),'g03-v2-restart-'));let ctx;const pids=[];
 async function pid(){const session=await ctx.browser().newBrowserCDPSession();pids.push((await session.send('SystemInfo.getProcessInfo')).processInfo.find(x=>x.type==='browser').id);}
 try{ctx=await chromium.launchPersistentContext(profile,{headless:true});await pid();let page=await ctx.newPage();await setup(page);const old=await oldRecord(page);await migrate(page);await ctx.close();ctx=null;
 ctx=await chromium.launchPersistentContext(profile,{headless:true});await pid();page=await ctx.newPage();await setup(page);await page.evaluate(async()=>{globalThis.c=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin);globalThis.h=await c.load();globalThis.reserve=async(s,active)=>{globalThis.p=await c.preview(h,s);const x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest);globalThis.i=await c.prepare(p,active,JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId}));};});await adoption(page,raw(2),true);const saved=await page.evaluate(()=>({raw:h.snapshotJson,receipt:result.receiptJson,outcome:result.outcomeJson}));await ctx.close();ctx=null;
 ctx=await chromium.launchPersistentContext(profile,{headless:true});await pid();page=await ctx.newPage();await setup(page);const read=await page.evaluate(async s=>{const d=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin),h=await d.load();return {raw:h.snapshotJson,ack:await d.acknowledge(h,s.receipt)};},saved);assert.equal(read.raw,saved.raw);assert.equal(read.ack,saved.outcome);assert.equal(JSON.parse(read.raw).legacyBaseRaw,old.raw);assert.equal(new Set(pids).size,3);console.log(JSON.stringify({v2ProcessRestarts:pids}));
 }finally{await ctx?.close();await rm(profile,{recursive:true,force:true});}
});
for(const writer of ['old',...(process.env.G03_PR4_REFERENCE?['pr4']:[])])test(`T13/T17: ${writer} object writer and v1 controller refuse v2`,async t=>{
 const {page}=await fresh(t);await oldRecord(page);await migrate(page);const before=(await page.evaluate(()=>record())).value;
 assert.equal(await page.evaluate(()=>error(()=>oldC.load())),'shape');assert.equal(await page.evaluate(()=>oldC.isStopped()),true);
 await page.goto(origin+'/legacy');const r=await page.evaluate(async writer=>{const {createIndexedDbAttemptStore}=await import('/'+writer+'.mjs');let puts=0;const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){puts++;return old.apply(this,args);};try{await createIndexedDbAttemptStore(indexedDB).commit({raw:null,revision:0,committed:[],issuedIds:[]},{raw:null,revision:0,committed:[],issuedIds:[]});return {puts,e:'SUCCESS'};}catch(e){return {puts,e:e.message};}finally{IDBObjectStore.prototype.put=old;}},writer);assert.deepEqual(r,{puts:0,e:'stale_commit'});await setup(page);assert.equal((await page.evaluate(()=>record())).value,before);
});
for(const value of [{raw:'{"schemaVersion":23}',revision:0,committed:[],issuedIds:[]},{raw:'{"schemaVersion":24}',revision:0,committed:[],issuedIds:[]},undefined])test('T13: foreign/missing current is never upgraded or reinitialized',async t=>{const {page}=await fresh(t);await seed(page,value);const before=await page.evaluate(()=>record());const r=await page.evaluate(async()=>{const d=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin),b={...counts};return {e:await error(()=>d.load()),init:await error(()=>d.initialize()),puts:counts.puts-b.puts,ids:counts.uuids-b.uuids};});assert.notEqual(r.e,'SUCCESS');assert.equal(r.init,'existing_database');assert.equal(r.puts,0);assert.equal(r.ids,0);assert.deepEqual(await page.evaluate(()=>record()),before);});
test('T01/T10/T11: upgrade explicit qualification, exact receipt seal, abort/retry and read-only recovery',async t=>{
 const {page}=await fresh(t),old=await oldRecord(page);
 const r=await page.evaluate(async()=>{
  globalThis.c=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin);globalThis.h=await c.load();const b={...counts};
  const before=(await record()).value;const unsupported=await error(()=>c.preview(h,'{}'));globalThis.up=await c.prepareUpgrade(h);const receipt={...JSON.parse(up.targetJson),confirmed:true,reason:'explicit upgrade reason'};globalThis.upReceipt=JSON.stringify(receipt);
  const fake=await error(()=>c.commitUpgrade({receiptJson:upReceipt}));globalThis.upQ=await c.confirmUpgrade(up,upReceipt);const changed=await error(()=>c.confirmUpgrade(up,JSON.stringify({...receipt,reason:'another reason'})));
  const put=IDBObjectStore.prototype.put;let aborted;IDBObjectStore.prototype.put=()=>{throw new DOMException('quota','QuotaExceededError');};try{aborted=await error(()=>c.commitUpgrade(upQ));}finally{IDBObjectStore.prototype.put=put;}
  const same=(await record()).value===before,stopped=c.isStopped(),d=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin),dh=await d.load(),notYet=await d.recoverUpgrade(dh,upReceipt);
  upQ=await c.confirmUpgrade(up,upReceipt);await c.commitUpgrade(upQ);const upgraded=await record(),next=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin),nh=await next.load();return {b,after:counts,unsupported,fake,changed,aborted,same,stopped,notYet,upgraded:upgraded.value,again:await next.recoverUpgrade(nh,upReceipt),wrong:await error(()=>next.recoverUpgrade(nh,JSON.stringify({...receipt,reason:'another reason'})))};
 });assert.equal(r.unsupported,'unsupported_policy');assert.equal(r.fake,'unqualified');assert.equal(r.changed,'receipt_conflict');assert.equal(r.aborted,'aborted');assert.equal(r.same,true);assert.equal(r.stopped,false);assert.equal(r.notYet.status,'not_upgraded');assert.equal(r.again.status,'already_upgraded');assert.equal(r.wrong,'receipt_conflict');assert.equal(r.after.uuids,r.b.uuids);assert.equal(JSON.parse(r.upgraded).legacyBaseRaw,old.raw);
});
for(const mode of ['shape','ledger','raw','receipt'])test(`T06: corrupt v1 ${mode} is preserved, never migrated`,async t=>{
 const {page}=await fresh(t);const old=await oldRecord(page);const r=JSON.parse(old.raw);if(mode==='shape')r.extra=1;else if(mode==='ledger')r.ledgerRaw=r.ledgerRaw.replace('"value":4','"value":2');else if(mode==='raw')r.events[0].body.grant.archiveSha256='0'.repeat(64);else r.receipts[0].decision.confirmation.rows[0].reason='forged';const bad=JSON.stringify(r);await replace(page,'restore',bad);
 const result=await page.evaluate(async()=>{const d=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin),b={...counts};return {load:await error(()=>d.load()),init:await error(()=>d.initialize()),b,after:counts};});assert.notEqual(result.load,'SUCCESS');assert.equal(result.init,'existing_database');assert.equal(result.b.puts,result.after.puts);assert.equal(result.b.uuids,result.after.uuids);assert.equal((await page.evaluate(()=>record())).value,bad);
});
for(const phase of ['upgrade','prepare','commit'])test(`T09/T11: ${phase} Lock-wait cancellation submits no write`,async t=>{
 const {page,ctx}=await fresh(t);const old=await oldRecord(page);
 if(phase==='upgrade')await page.evaluate(async()=>{globalThis.c=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin);globalThis.h=await c.load();globalThis.up=await c.prepareUpgrade(h);globalThis.upReceipt=JSON.stringify({...JSON.parse(up.targetJson),confirmed:true,reason:'upgrade'});globalThis.upQ=await c.confirmUpgrade(up,upReceipt);});
 else {await migrate(page);if(phase==='commit'){await reservation(page,raw(2),true);await page.evaluate(()=>seal());}else await page.evaluate(async s=>{globalThis.p=await c.preview(h,s);const x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest);globalThis.ref=JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId});},raw(2));}
 const before=(await page.evaluate(()=>record())).value,holder=await ctx.newPage();await holder.goto(origin);await holder.evaluate(()=>{globalThis.pending=navigator.locks.request('hosei-planner:v1:write',()=>new Promise(r=>{globalThis.release=r;globalThis.held=true;}));});await holder.waitForFunction(()=>held);
 await page.evaluate(phase=>{globalThis.b={...counts};globalThis.pending=error(()=>phase==='upgrade'?c.commitUpgrade(upQ):phase==='prepare'?c.prepare(p,true,ref):c.commit(q));},phase);await page.evaluate(()=>c.cancel());await holder.evaluate(()=>release());
 const r=await page.evaluate(async()=>({e:await pending,puts:counts.puts-b.puts,ids:counts.uuids-b.uuids,stopped:c.isStopped()}));assert.deepEqual(r,{e:'cancelled',puts:0,ids:0,stopped:false});assert.equal((await page.evaluate(()=>record())).value,before);void old;
});
for(const phase of ['upgrade','prepare','commit'])test(`T11: ${phase} submit cancellation suspends with durable bytes retained`,async t=>{
 const {page}=await fresh(t);await oldRecord(page);
 if(phase==='upgrade')await page.evaluate(async()=>{globalThis.c=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin);globalThis.h=await c.load();globalThis.up=await c.prepareUpgrade(h);globalThis.upReceipt=JSON.stringify({...JSON.parse(up.targetJson),confirmed:true,reason:'upgrade'});globalThis.upQ=await c.confirmUpgrade(up,upReceipt);});
 else {await migrate(page);if(phase==='commit'){await reservation(page,raw(2),true);await page.evaluate(()=>seal());}else await page.evaluate(async s=>{globalThis.p=await c.preview(h,s);const x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest);globalThis.ref=JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId});},raw(2));}
 const r=await page.evaluate(async phase=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const r=put.apply(this,args);c.cancel();return r;};try{return {e:await error(()=>phase==='upgrade'?c.commitUpgrade(upQ):phase==='prepare'?c.prepare(p,true,ref):c.commit(q)),stopped:c.isStopped()};}finally{IDBObjectStore.prototype.put=put;}},phase);assert.deepEqual(r,{e:'outcome_unknown',stopped:true});
 const state=JSON.parse((await page.evaluate(()=>record())).value);assert.equal(state.hostVersion,2);assert.equal(JSON.parse(state.ledgerRaw).view.revisions.length,phase==='commit'?2:1);
});
test('T16/T18: v2 transaction/readback Lock coverage and costs, LS byte invariant',async t=>{
 const {page}=await fresh(t);await oldRecord(page);
 const r=await page.evaluate(async source=>{
  localStorage.setItem('hosei-planner:v1','synthetic unchanged old state');let held=false;const spans=[],transactions=[],locks={request:(name,opts,action)=>navigator.locks.request(name,opts,async()=>{held=true;const start=performance.now();try{return await action();}finally{spans.push(performance.now()-start);held=false;}})};
  const old=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){transactions.push({held,mode:args[1],durability:args[2]?.durability});if(!held)throw Error('outside lock');return old.apply(this,args);};
  try{let d=a.createGradeImportHostV2(indexedDB,locks,location.origin),h=await d.load(),up=await d.prepareUpgrade(h),q=await d.confirmUpgrade(up,JSON.stringify({...JSON.parse(up.targetJson),confirmed:true,reason:'explicit'}));await d.commitUpgrade(q);d=a.createGradeImportHostV2(indexedDB,locks,location.origin);h=await d.load();const p=await d.preview(h,source),x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest),i=await d.prepare(p,true,JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId}));q=await d.confirm(i,JSON.stringify(confirmation(JSON.parse(i.targetsJson))));const result=await d.commit(q);return {spans,transactions,bytes:new TextEncoder().encode(result.handle.snapshotJson).length,ls:localStorage.getItem('hosei-planner:v1')};}finally{IDBDatabase.prototype.transaction=old;}
 },raw(2));assert.equal(r.ls,'synthetic unchanged old state');assert.equal(r.transactions.every(x=>x.held),true);assert.deepEqual(r.transactions.filter(x=>x.mode==='readwrite').map(x=>x.durability),['strict','strict','strict']);console.log(JSON.stringify({T18Native:r}));
});
test('T01: native migration preserves noncanonical v1 outer bytes exactly',async t=>{const {page}=await fresh(t),old=await oldRecord(page),bytes='\n'+JSON.stringify(JSON.parse(old.raw),null,2)+'\n';await replace(page,'restore',bytes);const r=JSON.parse(await migrate(page));assert.equal(r.legacyBaseRaw,bytes);assert.equal(await page.evaluate(s=>c.acknowledge(h,s),old.receipt),old.outcome);});
test('T12 valid-record ABA: load of another valid reservation revokes all earlier proposals',async t=>{
 const {page,ctx}=await fresh(t);await oldRecord(page);await migrate(page);await reservation(page,raw(2),true);await page.evaluate(()=>seal());const A=(await page.evaluate(()=>record())).value;
 const other=await ctx.newPage();await setup(other);await other.evaluate(async source=>{const d=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin),h=await d.load(),p=await d.preview(h,source),x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest);await d.prepare(p,true,JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId}));},raw(0));
 const B=(await other.evaluate(()=>record())).value;const observed=await page.evaluate(async()=>({code:await error(()=>c.load()),stopped:c.isStopped()}));await replace(page,'restore',A);
 const after=await page.evaluate(async()=>{const before={...counts},confirmationJson=JSON.stringify(confirmation(JSON.parse(i.targetsJson)));const confirm=await error(()=>c.confirm(i,confirmationJson));let commit=confirm;if(confirm==='SUCCESS'){const q=await c.confirm(i,confirmationJson);commit=await error(()=>c.commit(q));}return {confirm,commit,puts:counts.puts-before.puts,ids:counts.uuids-before.uuids};});
 console.log(JSON.stringify({ValidReadABA:{observed,after,beforeH:JSON.parse(A).authority.reservedIds.length,observedH:JSON.parse(B).authority.reservedIds.length}}));assert.deepEqual(observed,{code:'stale',stopped:true});assert.deepEqual(after,{confirm:'session_stopped',commit:'session_stopped',puts:0,ids:0});
});

test('T18 maximum raw: native migration/correction Lock time and storage budget',async t=>{
 const {page}=await fresh(t);const object=JSON.parse(raw()),budget=1024*1024;object.metadata.pad='x'.repeat(budget-Buffer.byteLength(JSON.stringify(object))-40);const original=JSON.stringify(object);await oldRecord(page,original);object.courses[0].earnedCredits={raw:'2',value:2};const corrected=JSON.stringify(object);
 const r=await page.evaluate(async source=>{
  localStorage.setItem('hosei-planner:v1','synthetic unchanged old state');let held=false;const spans=[],transactions=[],locks={request:(name,opts,action)=>navigator.locks.request(name,opts,async()=>{held=true;const start=performance.now();try{return await action();}finally{spans.push(performance.now()-start);held=false;}})};
  const old=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){transactions.push({held,mode:args[1],durability:args[2]?.durability});if(!held)throw Error('outside lock');return old.apply(this,args);};
  try{let d=a.createGradeImportHostV2(indexedDB,locks,location.origin),h=await d.load(),up=await d.prepareUpgrade(h),q=await d.confirmUpgrade(up,JSON.stringify({...JSON.parse(up.targetJson),confirmed:true,reason:'explicit'}));await d.commitUpgrade(q);d=a.createGradeImportHostV2(indexedDB,locks,location.origin);h=await d.load();const p=await d.preview(h,source),x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest),i=await d.prepare(p,true,JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId}));q=await d.confirm(i,JSON.stringify(confirmation(JSON.parse(i.targetsJson))));const result=await d.commit(q);return {spans,transactions,bytes:new TextEncoder().encode(result.handle.snapshotJson).length,ls:localStorage.getItem('hosei-planner:v1')};}finally{IDBDatabase.prototype.transaction=old;}
 },corrected);assert.equal(r.ls,'synthetic unchanged old state');assert.equal(r.transactions.every(x=>x.held),true);assert.deepEqual(r.transactions.filter(x=>x.mode==='readwrite').map(x=>x.durability),['strict','strict','strict']);console.log(JSON.stringify({T18MaximumNative:{...r,rawBytes:Buffer.byteLength(original)}}));
});
