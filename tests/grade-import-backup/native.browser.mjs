// Synthetic sources only. Separate Chromium processes/userDataDirs, fixed
// loopback origin per run, real File/IndexedDB/Web Locks. No product UI entry.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {testRevisionDefine} from './revision-fixture.mjs';
import {input,course,oracle,canonical,digest} from '../grade-import-pure/ledgerFixture.mjs';
const root=new URL('../../',import.meta.url).pathname;
const source=(n=4)=>'\r\n '+JSON.stringify({...input([course('PR-A 独立原文𠮷',n,'2024')]),metadata:{unknown:['\\u3042','😀',null,0],manualCredits:937}},null,2).replace(/\n/g,'\r\n')+' \r\n';
let server,browser,chromium,origin,backupText,savedRaw,artifacts;
const sha=b=>createHash('sha256').update(b).digest('hex');
before(async()=>{
 ({chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright'));
 const code=await build({absWorkingDir:root,stdin:{resolveDir:root,contents:`export {createGradeImportBackupController} from './src/planner/attempts/gradeImportHost/portable/controller';export {inspectBackupBytes} from './src/planner/attempts/gradeImportHost/portable/codec';export {createGradeImportHost} from './src/planner/attempts/gradeImportHost/controller';export {createGradeImportHostV2} from './src/planner/attempts/gradeImportHost/controllerV2';export {createNativeHostStore} from './src/planner/attempts/gradeImportHost/nativeStore';`},bundle:true,write:false,platform:'browser',format:'esm',define:testRevisionDefine});
 server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'");if(req.url==='/entry.mjs'){res.setHeader('Content-Type','text/javascript');res.end(code.outputFiles[0].text);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>PR-A synthetic isolation</title><input type=file id=file>');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 artifacts=process.env.G03_BACKUP_ARTIFACTS||await mkdtemp(resolve(tmpdir(),'g03-backup-artifacts-'));
 browser=await chromium.launch({headless:true});
 const ctx=await browser.newContext(),page=await ctx.newPage();await setup(page);await makeHistory(page,'empty',true);
 savedRaw=await page.evaluate(()=>h.snapshotJson);backupText=await page.evaluate(async()=>{globalThis.b=makeBackup();globalThis.exported=await b.exportBackup();return exported.text();});await ctx.close();
 await writeFile(resolve(artifacts,'reference.b1.json'),backupText);await writeFile(resolve(artifacts,'reference.host.json'),savedRaw);
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
async function setup(page){
 await page.goto(origin);await page.evaluate(async()=>{
  globalThis.a=await import('/entry.mjs');globalThis.count={put:0,uuid:0,ls:0,open:0};globalThis.spans=[];globalThis.transactions=[];globalThis.putContexts=[];globalThis.held=0;
  globalThis.locks={request:(name,opts,fn)=>navigator.locks.request(name,opts,async()=>{held++;const start=performance.now();try{return await fn();}finally{spans.push(performance.now()-start);held--;}})};
  const put=IDBObjectStore.prototype.put,uuid=crypto.randomUUID.bind(crypto),open=indexedDB.open.bind(indexedDB),set=Storage.prototype.setItem,transaction=IDBDatabase.prototype.transaction;
  IDBObjectStore.prototype.put=function(...args){count.put++;putContexts.push({held,mode:this.transaction.mode});return put.apply(this,args);};crypto.randomUUID=()=>{count.uuid++;return uuid();};indexedDB.open=(...args)=>{count.open++;return open(...args);};Storage.prototype.setItem=function(...args){count.ls++;return set.apply(this,args);};
  IDBDatabase.prototype.transaction=function(...args){transactions.push({held,mode:args[1],durability:args[2]?.durability});return transaction.apply(this,args);};
  globalThis.makeBackup=(useLocks=locks,provider=undefined)=>a.createGradeImportBackupController(indexedDB,useLocks,location.origin,localStorage,provider);
  globalThis.error=async fn=>{try{await fn();return 'SUCCESS';}catch(e){return e.code||e.message;}};
  globalThis.current=()=>a.createNativeHostStore(indexedDB).read();
  globalThis.confirmation=(t,reason='PR-A independent explicit adoption')=>({selectionSha256:t.selectionSha256,confirmed:true,rows:t.rows.map(r=>({...r,confirmed:true,reason}))});
  globalThis.adopt=async(s,active=true)=>{const p=await c.preview(h,s),cand=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest),ref=cand?{achievementId:cand.achievementId,revisionId:cand.revisionId,observationId:cand.observationId}:null;globalThis.i=await c.prepare(p,active,JSON.stringify(ref));const q=await c.confirm(i,JSON.stringify(confirmation(JSON.parse(i.targetsJson))));globalThis.result=await c.commit(q);globalThis.h=result.handle;};
 });
}
async function fresh(t){const ctx=await browser.newContext();t.after(()=>ctx.close());const page=await ctx.newPage();await setup(page);return{ctx,page};}
async function makeHistory(page,provenance='empty',unused=false,from=4,to=2,active=true){
 await page.evaluate(async({provenance,unused,s4})=>{
  globalThis.c=provenance==='upgrade'?a.createGradeImportHost(indexedDB,locks,location.origin):a.createGradeImportHostV2(indexedDB,locks,location.origin);globalThis.h=await c.initialize();
  if(unused){const p=await c.preview(h,s4);globalThis.retired=await c.prepare(p,false);c.cancel();h=await c.load();}
  await adopt(s4);
  if(provenance==='upgrade'){
   c=a.createGradeImportHostV2(indexedDB,locks,location.origin);h=await c.load();const up=await c.prepareUpgrade(h);const q=await c.confirmUpgrade(up,JSON.stringify({...JSON.parse(up.targetJson),confirmed:true,reason:'PR-A explicit v1 upgrade'}));await c.commitUpgrade(q);c=a.createGradeImportHostV2(indexedDB,locks,location.origin);h=await c.load();
  }
 },{provenance,unused,s4:source(from)});
 await page.evaluate(({s2,active})=>adopt(s2,active),{s2:source(to),active});
 if(unused)await page.evaluate(async s=>{const p=await c.preview(h,s),x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest);globalThis.pending=await c.prepare(p,true,JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId}));c.cancel();h=await c.load();},source(to+1));
}
async function selected(page,text=backupText){await page.locator('#file').setInputFiles({name:'selected.b1.json',mimeType:'application/json',buffer:Buffer.from(text)});await page.evaluate(()=>{globalThis.file=document.querySelector('#file').files[0];});}
async function ready(page,text=backupText){await selected(page,text);return page.evaluate(async()=>{globalThis.b=makeBackup();globalThis.intent=await b.prepareRestore(file);globalThis.q=await b.confirmRestore(intent,JSON.stringify({targetSha256:intent.targetSha256,confirmed:true,reason:'PR-A explicit restore into isolated empty profile'}));return JSON.parse(intent.targetsJson);});}
async function seed(page,value,missing=false,version=1){await page.evaluate(({value,missing,version})=>new Promise((resolve,reject)=>{const req=indexedDB.open('hosei-yi06-isolated-v1',version);req.onupgradeneeded=()=>{const s=req.result.createObjectStore('authority');if(!missing)s.put(value,'current');};req.onsuccess=()=>{req.result.close();resolve();};req.onerror=()=>reject(req.error);}),{value,missing,version});}
function hostOracle(A,raws){
 const r=JSON.parse(A),l=JSON.parse(r.ledgerRaw),base=r.hostVersion===2?JSON.parse(r.legacyBaseRaw):null,events=[...(base?.events||[]),...r.events];
 assert.deepEqual(l,oracle(l.journal.entries.map(e=>e.operation),[r.hostId]));
 assert.equal(l.view.achievements.length,1);assert.equal(l.view.details.length,7);assert.equal(l.view.detailRevisions.length,7*raws.length);assert.ok(l.view.details.every(d=>d.revisionIds.length===raws.length));assert.ok(l.view.revisions.every(x=>x.achievementId===l.view.achievements[0].id));
 const H=[r.hostId,...events.filter(e=>e.body.kind==='reserve').flatMap(e=>e.body.grant.ids)];assert.deepEqual(r.authority.reservedIds,H);assert.equal(new Set(H.map(x=>x.split(':').at(-1))).size,H.length);
 const receipts=events.filter(e=>e.body.kind==='adopt').map(e=>e.body.receipt);assert.deepEqual(r.receipts,receipts);
 assert.deepEqual(r.authority.consumedGrantIds,receipts.map(x=>x.grantId));assert.deepEqual(r.authority.opReceipts,receipts.flatMap(x=>x.operations.map(o=>({operationId:o.operationId,receiptSha256:digest(x)}))));
 assert.equal(r.authority.generation,events.length);
 const ops=l.journal.entries.map(e=>e.operation),outcomes=[];let committed=0;
 for(const e of events){
  const {eventSha256,...body}=e;assert.equal(eventSha256,digest(body));
  const prefix=oracle(ops.slice(0,committed),[r.hostId]),floor={issuedIds:prefix.issuedIds,reservedIds:prefix.reservedIds};
  if(e.body.kind==='reserve'){
   assert.equal(e.body.grant.ledgerSha256,sha(JSON.stringify(prefix)));assert.equal(e.body.grant.floorSha256,sha(JSON.stringify(floor)));
  }else{
   const rec=e.body.receipt;assert.equal(rec.beforeLedgerEntries,committed);assert.equal(rec.beforeLedgerSha256,sha(JSON.stringify(prefix)));assert.equal(rec.floorSha256,sha(JSON.stringify(floor)));
   assert.equal(rec.decision.confirmation.rows[0].reason,'PR-A independent explicit adoption');
   assert.deepEqual(rec.operations,ops.slice(committed,committed+rec.operations.length).map(o=>({operationId:o.operationId,payloadSha256:digest(o)})));
   committed+=rec.operations.length;const after=oracle(ops.slice(0,committed),[r.hostId]);assert.equal(rec.afterLedgerSha256,sha(JSON.stringify(after)));
   outcomes.push({...('policy' in e?{policy:e.policy}:{}),receiptSha256:digest(rec),operationIds:rec.operations.map(o=>o.operationId),ledgerEntries:committed,ledgerSha256:sha(JSON.stringify(after)),sequence:e.sequence});
  }
 }
 assert.deepEqual(r.outcomes,outcomes);assert.equal(r.authority.tipSha256,r.events.at(-1)?.eventSha256??base?.authority.tipSha256??null);
 if(r.hostVersion===2)assert.equal(r.anchorSha256,digest({domain:'g03-explicit-policy-upgrade/v2',receipt:r.migration}));
 for(const [i,s] of raws.entries()){
  assert.equal(l.view.snapshots[i].archive.raw,s);assert.deepEqual(Buffer.from(l.view.snapshots[i].archive.raw),Buffer.from(s));
  assert.deepEqual(l.view.revisions[i].record,JSON.parse(s).courses[0]);assert.equal(l.view.snapshots[i].archive.rawSha256,sha(s));
 }
 return {r,l,H};
}
for(const provenance of ['empty','upgrade'])test(`A01/A02/A05/A07/A24: ${provenance} 4->2->B1->R0->actual process restart, independent all-history oracle`,async()=>{
 const profileP=await mkdtemp(resolve(tmpdir(),'g03-source-')),profileQ=await mkdtemp(resolve(tmpdir(),'g03-restored-'));let p,q;const pids=[];
 const processId=async ctx=>{const cdp=await ctx.browser().newBrowserCDPSession();return (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(x=>x.type==='browser').id;};
 try{
  p=await chromium.launchPersistentContext(profileP,{headless:true});pids.push(await processId(p));let page=await p.newPage();await setup(page);await makeHistory(page,provenance,true);
  const A=await page.evaluate(()=>h.snapshotJson);const expected=hostOracle(A,[source(4),source(2)]);assert.equal(expected.r.baseProvenance,provenance==='empty'?'native-v2-empty':'native-v1-upgrade');assert.equal(expected.H.length,92);assert.equal(expected.l.view.achievements[0].activeRevisionId,expected.l.view.revisions[1].id);
  const fileText=await page.evaluate(async()=>{globalThis.exporter=makeBackup();return (await exporter.exportBackup()).text();});
  assert.equal((await page.evaluate(()=>current())).value,A);const wire=JSON.parse(fileText);assert.equal(wire.record.payload,Buffer.from(A,'utf16le').toString('base64'));assert.equal(wire.record.sha256,sha(Buffer.from(A,'utf16le')));
  const disk=resolve(artifacts,`${provenance}.b1.json`);await writeFile(disk,fileText);await writeFile(resolve(artifacts,`${provenance}.host.json`),A);await p.close();p=null;
  q=await chromium.launchPersistentContext(profileQ,{headless:true});pids.push(await processId(q));page=await q.newPage();await setup(page);await page.locator('#file').setInputFiles(disk);await page.evaluate(()=>{globalThis.file=document.querySelector('#file').files[0];});
  const restored=await page.evaluate(async()=>{const b=makeBackup(),i=await b.prepareRestore(file),q=await b.confirmRestore(i,JSON.stringify({confirmed:true,targetSha256:i.targetSha256,reason:'restore exact selected file'})),before={...count};const result=await b.commitRestore(q);return{result,delta:{put:count.put-before.put,uuid:count.uuid-before.uuid,ls:count.ls-before.ls},raw:(await current()).value};});
  assert.deepEqual(restored.delta,{put:1,uuid:0,ls:0});assert.equal(restored.result.status,'restored');assert.equal(restored.raw,A);await q.close();q=null;
  q=await chromium.launchPersistentContext(profileQ,{headless:true});pids.push(await processId(q));page=await q.newPage();await setup(page);
  const reloaded=await page.evaluate(async()=>{const d=a.createGradeImportHostV2(indexedDB,locks,location.origin),h=await d.load(),r=JSON.parse(h.snapshotJson),before={...count},acks=[];for(const receipt of r.receipts)acks.push(await d.acknowledge(h,JSON.stringify(receipt)));const bad=structuredClone(r.receipts[0]);bad.decision.confirmation.rows[0].reason='different';const rejected=await error(()=>d.acknowledge(h,JSON.stringify(bad)));const base=JSON.parse(r.legacyBaseRaw),grants=[...base.events,...r.events].filter(e=>e.body.kind==='reserve'&&!r.authority.consumedGrantIds.includes(e.body.grant.intentId));const burns=[];for(const e of grants)burns.push(await d.recover(h,JSON.stringify({grantId:e.body.grant.intentId,receipt:null})));return{raw:h.snapshotJson,acks,rejected,burns,delta:{put:count.put-before.put,uuid:count.uuid-before.uuid},fake:await error(()=>d.confirm({targetsJson:'{}',issuedIds:[]},'{}'))};});
  assert.equal(reloaded.raw,A);assert.deepEqual(JSON.parse(reloaded.raw),expected.r);assert.deepEqual(reloaded.acks.map(JSON.parse),expected.r.outcomes);assert.equal(reloaded.rejected,'receipt_conflict');assert.equal(reloaded.fake,'unqualified');assert.equal(reloaded.burns.length,2);assert.ok(reloaded.burns.every(x=>x.status==='not_adopted_burn_retained'));assert.deepEqual(reloaded.delta,{put:0,uuid:0});
  hostOracle(reloaded.raw,[source(4),source(2)]);await ready(page,fileText);const again=await page.evaluate(async()=>{const before={...count},result=await b.commitRestore(q);return{result,put:count.put-before.put,uuid:count.uuid-before.uuid};});assert.equal(again.result.status,'already_present');assert.equal(again.put,0);assert.equal(again.uuid,0);
  const collision=await page.evaluate(async s=>{const d=a.createGradeImportHostV2(indexedDB,locks,location.origin),h=await d.load(),p=await d.preview(h,s),x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest),r=JSON.parse(h.snapshotJson),old=crypto.randomUUID,before=count.put;crypto.randomUUID=()=>r.authority.reservedIds.at(-1).split(':').at(-1);try{return{code:await error(()=>d.prepare(p,true,JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId}))),puts:count.put-before};}finally{crypto.randomUUID=old;}},source(0));assert.deepEqual(collision,{code:'allocator_exhausted',puts:0});assert.equal((await page.evaluate(()=>current())).value,A);
  await q.close();q=null;p=await chromium.launchPersistentContext(profileP,{headless:true});page=await p.newPage();await setup(page);assert.equal((await page.evaluate(()=>current())).value,A);assert.equal(await page.evaluate(()=>localStorage.length),0);
  assert.equal(new Set(pids).size,3);console.log(JSON.stringify({A01:{provenance,pids,codeUnits:A.length,sha256:sha(Buffer.from(A,'utf16le')),H:expected.H.length,receipts:expected.r.receipts.length,artifacts:disk}}));
 }finally{await p?.close();await q?.close();await rm(profileP,{recursive:true,force:true});await rm(profileQ,{recursive:true,force:true});}
});
for(const [from,to,active] of [[4,2,false],[null,2,true],[0,2,true],[4,0,true]])test(`A04: ${from}->${to} active=${active} survives R0`,async t=>{
 const {page}=await fresh(t);await makeHistory(page,'empty',false,from,to,active);const A=await page.evaluate(()=>h.snapshotJson),text=await page.evaluate(async()=> (await makeBackup().exportBackup()).text());const ctx=await browser.newContext();t.after(()=>ctx.close());const target=await ctx.newPage();await setup(target);await ready(target,text);await target.evaluate(()=>b.commitRestore(q));const r=hostOracle((await target.evaluate(()=>current())).value,[source(from),source(to)]);assert.equal(JSON.stringify(r.r),JSON.stringify(JSON.parse(A)));assert.deepEqual(r.l.view.revisions.map(x=>x.record.earnedCredits.value),[from,to]);assert.equal(r.l.view.achievements[0].activeRevisionId,r.l.view.revisions[active?1:0].id);
});
for(const state of ['empty','t1','adopted'])test(`A02/A05: native v1 ${state} exports/restores without implicit upgrade`,async t=>{
 const {page}=await fresh(t);await page.evaluate(async({state,s})=>{globalThis.c=a.createGradeImportHost(indexedDB,locks,location.origin);globalThis.h=await c.initialize();if(state==='adopted')await adopt(s);else if(state==='t1'){const p=await c.preview(h,s);globalThis.i=await c.prepare(p,true);h=await c.load();}},{state,s:source()});const A=await page.evaluate(()=>h.snapshotJson),text=await page.evaluate(async()=> (await makeBackup().exportBackup()).text());const ctx=await browser.newContext();t.after(()=>ctx.close());const p=await ctx.newPage();await setup(p);await ready(p,text);await p.evaluate(()=>b.commitRestore(q));assert.equal((await p.evaluate(()=>current())).value,A);assert.equal(JSON.parse(A).hostVersion,1);
});
for(const mode of ['missing','undefined','schema23','schema24','object','corrupt','v1empty','v2empty','otherValid','version2'])test(`A08/A09/A18: existing ${mode} is preserved with put0`,async t=>{
 const {page}=await fresh(t);let value=mode==='undefined'?undefined:mode==='schema23'||mode==='schema24'?{raw:JSON.stringify({schemaVersion:mode==='schema23'?23:24}),revision:0,committed:[],issuedIds:[]}:mode==='object'?{format:'hosei-attempt-authority',authorityVersion:2,issuedIds:['keep']}:mode==='corrupt'?'{bad':savedRaw+'\n';
 if(mode==='v1empty'||mode==='v2empty')await page.evaluate(async mode=>{const c=mode==='v1empty'?a.createGradeImportHost(indexedDB,locks,location.origin):a.createGradeImportHostV2(indexedDB,locks,location.origin);await c.initialize();},mode);
 else await seed(page,value,mode==='missing',mode==='version2'?2:1);
 await selected(page);const before=await page.evaluate(async()=>({native:await current().catch(e=>({e:e.code||e.message})),count:{...count}}));const code=await page.evaluate(()=>error(()=>makeBackup().prepareRestore(file)));assert.notEqual(code,'SUCCESS');const after=await page.evaluate(async()=>({native:await current().catch(e=>({e:e.code||e.message})),count:{...count}}));assert.deepEqual(after.native,before.native);assert.equal(after.count.put,before.count.put);assert.equal(after.count.uuid,before.count.uuid);
});
for(const key of ['hosei-planner:v1','hosei-planner:v1:recovery'])test(`A18: LS ${key} prevents R0 without mutation`,async t=>{
 const {page}=await fresh(t);await selected(page);const r=await page.evaluate(async key=>{localStorage.setItem(key,'\r\n preserve old raw');const before={...count},code=await error(()=>makeBackup().prepareRestore(file));return{code,before,after:count,value:localStorage.getItem(key),db:await indexedDB.databases()};},key);assert.equal(r.code,'legacy_storage');assert.deepEqual(r.after,r.before);assert.equal(r.value,'\r\n preserve old raw');assert.equal(r.db.length,0);
});
test('A23/A24: no Web Locks and fake/cross-controller proposals reject before any put',async t=>{
 const {page}=await fresh(t);await ready(page);const r=await page.evaluate(async()=>{const before={...count},other=makeBackup(),none=a.createGradeImportBackupController(indexedDB,undefined,location.origin,localStorage);return{fake:await error(()=>b.commitRestore({...q})),other:await error(()=>other.commitRestore(q)),none:await error(()=>none.prepareRestore(file)),before,after:count};});assert.equal(r.fake,'unqualified');assert.equal(r.other,'unqualified');assert.match(r.none,/Web Locks/);assert.equal(r.after.put,r.before.put);assert.equal(r.after.uuid,r.before.uuid);
});
test('A07/A23: restore confirmation seals exact target/reason and rejects copies',async t=>{
 const {page}=await fresh(t);await ready(page);const r=await page.evaluate(async()=>({changed:await error(()=>b.confirmRestore(intent,JSON.stringify({targetSha256:intent.targetSha256,confirmed:true,reason:'changed'}))),fake:await error(()=>b.confirmRestore({...intent},'{}')),wrong:await error(()=>b.confirmRestore(intent,JSON.stringify({targetSha256:'0'.repeat(64),confirmed:true,reason:'x'})))}));assert.deepEqual(r,{changed:'receipt_conflict',fake:'unqualified',wrong:'confirmation_required'});
});
for(const phase of ['prepare','commit'])test(`A17: ${phase} Lock-wait cancel has put0`,async t=>{
 const {ctx,page}=await fresh(t);if(phase==='commit')await ready(page);else {await selected(page);await page.evaluate(()=>{globalThis.b=makeBackup();});}
 const holder=await ctx.newPage();await holder.goto(origin);await holder.evaluate(()=>{globalThis.pending=navigator.locks.request('hosei-planner:v1:write',()=>new Promise(r=>{globalThis.release=r;globalThis.held=true;}));});await holder.waitForFunction(()=>held);
 await page.evaluate(phase=>{globalThis.before={...count};globalThis.pending=error(()=>phase==='prepare'?b.prepareRestore(file):b.commitRestore(q));},phase);await page.evaluate(()=>b.cancel());await holder.evaluate(()=>release());const r=await page.evaluate(async()=>({code:await pending,put:count.put-before.put,uuid:count.uuid-before.uuid}));assert.deepEqual(r,{code:'cancelled',put:0,uuid:0});assert.deepEqual(await page.evaluate(()=>indexedDB.databases()),[]);
});
for(const mode of ['quota','abort','cancelBeforePut','cancelAfterPut','ackUnknown','postRead'])test(`A15/A16/A17: ${mode} terminal state, exact-current explicit recovery`,async t=>{
 const {page}=await fresh(t);await ready(page);const r=await page.evaluate(async mode=>{
  const put=IDBObjectStore.prototype.put,create=IDBDatabase.prototype.createObjectStore,close=IDBDatabase.prototype.close,databases=indexedDB.databases.bind(indexedDB);let wrote=false;const before={...count};
  IDBDatabase.prototype.close=function(...args){if(mode==='ackUnknown'&&wrote)throw Error('lost creation ACK');return close.apply(this,args);};
  IDBDatabase.prototype.createObjectStore=function(...args){const s=create.apply(this,args);if(mode==='cancelBeforePut')b.cancel();return s;};
  IDBObjectStore.prototype.put=function(...args){if(mode==='quota')throw new DOMException('quota','QuotaExceededError');const r=put.apply(this,args);wrote=true;if(mode==='abort')this.transaction.abort();if(mode==='cancelAfterPut')b.cancel();return r;};
  indexedDB.databases=async()=>{if(mode==='postRead'&&wrote)throw Error('post-read lost');return databases();};
  try{return{code:await error(()=>b.commitRestore(q)),stopped:b.isStopped(),put:count.put-before.put,uuid:count.uuid-before.uuid};}finally{IDBObjectStore.prototype.put=put;IDBDatabase.prototype.createObjectStore=create;IDBDatabase.prototype.close=close;indexedDB.databases=databases;}
 },mode);
 const committed=['cancelAfterPut','ackUnknown','postRead'].includes(mode);assert.equal(r.code,committed?'outcome_unknown':mode==='cancelBeforePut'?'cancelled':'aborted');assert.equal(r.stopped,committed);assert.equal(r.uuid,0);assert.equal(r.put,mode==='quota'||mode==='cancelBeforePut'?0:1);
 const status=await page.evaluate(()=>makeBackup().queryRestore(file));assert.equal(status.status,committed?'already_present':'not_present');if(committed){assert.equal((await page.evaluate(()=>current())).value,savedRaw);assert.equal(await page.evaluate(()=>error(()=>b.commitRestore(q))),'session_stopped');}
 else {await ready(page);assert.equal((await page.evaluate(()=>b.commitRestore(q))).status,'restored');}
});
test('A13: inventory-to-open race preserves the competing writer without restore put',async t=>{
 const {page}=await fresh(t);await ready(page);const winner=savedRaw+'\r\n';const r=await page.evaluate(async winner=>{
  const open=indexedDB.open.bind(indexedDB);let injected=false,winnerPuts=0;const before=count.put;
  indexedDB.open=(...args)=>{if(!injected&&args[0]==='hosei-yi06-isolated-v1'){injected=true;const w=open(...args);w.onupgradeneeded=()=>{w.result.createObjectStore('authority').put(winner,'current');winnerPuts++;};w.onsuccess=()=>w.result.close();}return open(...args);};
  try{return{code:await error(()=>b.commitRestore(q)),stopped:b.isStopped(),totalPuts:count.put-before,winnerPuts};}finally{indexedDB.open=open;}
 },winner);assert.deepEqual(r,{code:'existing_database',stopped:true,totalPuts:1,winnerPuts:1});assert.equal((await page.evaluate(()=>current())).value,winner);
});
test('A12/A14: export observes valid B, permanently rejects A after ABA, no artifact issued',async t=>{
 const {page}=await fresh(t);await seed(page,savedRaw);const r=await page.evaluate(async A=>{
  globalThis.original=A;const transaction=IDBDatabase.prototype.transaction;let scheduled=false,mutation;
  IDBDatabase.prototype.transaction=function(...args){const tx=transaction.apply(this,args);if(!scheduled&&args[1]==='readonly'){scheduled=true;tx.addEventListener('complete',()=>{mutation=new Promise((resolve,reject)=>{const req=indexedDB.open('hosei-yi06-isolated-v1',1);req.onsuccess=()=>{const db=req.result,t=transaction.call(db,'authority','readwrite');t.objectStore('authority').put(JSON.stringify(JSON.parse(globalThis.original))+'\n','current');t.oncomplete=()=>{db.close();resolve();};t.onabort=()=>reject(t.error);};});});}return tx;};
  globalThis.b=makeBackup();try{const code=await error(()=>b.exportBackup());await mutation;return{code,stopped:b.isStopped()};}finally{IDBDatabase.prototype.transaction=transaction;}
 },savedRaw);assert.deepEqual(r,{code:'stale',stopped:true});
 // Test-side fault restoration, never product recovery/rollback.
 await page.evaluate(async A=>{const db=await new Promise(r=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>r(q.result);});await new Promise(r=>{const t=db.transaction('authority','readwrite');t.objectStore('authority').put(A,'current');t.oncomplete=r;});db.close();},savedRaw);
 assert.equal(await page.evaluate(()=>error(()=>b.exportBackup())),'session_stopped');
});
test('A16/A18: explicit query distinguishes absent / exact / conflict / malformed without writes',async t=>{
 const {page}=await fresh(t);await selected(page);assert.equal((await page.evaluate(()=>makeBackup().queryRestore(file))).status,'not_present');await seed(page,savedRaw+'\n');const before=await page.evaluate(()=>count.put);assert.equal((await page.evaluate(()=>makeBackup().queryRestore(file))).status,'conflict_or_unresolved');assert.equal(await page.evaluate(()=>count.put),before);
 const ctx=await browser.newContext();t.after(()=>ctx.close());const p=await ctx.newPage();await setup(p);await seed(p,'{bad');await selected(p);assert.equal((await p.evaluate(()=>makeBackup().queryRestore(file))).status,'conflict_or_unresolved');
});
test('A19: other origin and changed environment cannot rebind historical environments',async t=>{
 const {page}=await fresh(t);await selected(page);const r=await page.evaluate(async()=>{const foreign=a.createGradeImportBackupController(indexedDB,locks,'https://backup.invalid',localStorage);const code=await error(()=>foreign.prepareRestore(file));globalThis.env={origin:location.origin,database:'hosei-yi06-isolated-v1',store:'authority',key:'current'};const d=makeBackup(locks,()=>env),i=await d.prepareRestore(file),q=await d.confirmRestore(i,JSON.stringify({confirmed:true,targetSha256:i.targetSha256,reason:'x'}));env={...env,key:'other'};return{code,changed:await error(()=>d.commitRestore(q)),stopped:d.isStopped(),count};});assert.equal(r.code,'stale');assert.equal(r.changed,'stale');assert.equal(r.stopped,true);assert.equal(r.count.put,0);assert.equal(r.count.uuid,0);
});
test('A10/A11: corrupted, unknown and truncated selected files have put0',async t=>{
 const {page}=await fresh(t);for(const text of ['{bad',backupText.slice(0,-1),JSON.stringify({...JSON.parse(backupText),backupVersion:9}),JSON.stringify({format:'hosei-attempt-backup',backupVersion:4})]){
  await selected(page,text);assert.notEqual(await page.evaluate(()=>error(()=>makeBackup().prepareRestore(file))),'SUCCESS');}
 assert.equal(await page.evaluate(()=>count.put),0);assert.equal(await page.evaluate(()=>count.uuid),0);assert.deepEqual(await page.evaluate(()=>indexedDB.databases()),[]);
});
test('A03: valid native outer literal lone surrogate survives B1 and R0 code-unit exactly',async t=>{
 const {page}=await fresh(t);await page.evaluate(async s=>{
  globalThis.c=a.createGradeImportHostV2(indexedDB,locks,location.origin);globalThis.h=await c.initialize();
  globalThis.confirmation=t=>({selectionSha256:t.selectionSha256,confirmed:true,rows:t.rows.map(r=>({...r,confirmed:true,reason:'lone-'+String.fromCharCode(0xd800)}))});await adopt(s);
  const exact=h.snapshotJson.replaceAll('"reason":"lone-\\ud800"','"reason":"lone-'+String.fromCharCode(0xd800)+'"');
  if(exact===h.snapshotJson)throw Error('fixture did not introduce native literal surrogate');globalThis.A=exact;
  const req=indexedDB.open('hosei-yi06-isolated-v1',1);await new Promise(r=>{req.onsuccess=r;});const db=req.result;await new Promise(r=>{const tx=db.transaction('authority','readwrite');tx.objectStore('authority').put(exact,'current');tx.oncomplete=r;});db.close();
 },source());const A=await page.evaluate(()=>A),text=await page.evaluate(async()=> (await makeBackup().exportBackup()).text());assert.equal(JSON.parse(text).record.payload,Buffer.from(A,'utf16le').toString('base64'));
 const ctx=await browser.newContext();t.after(()=>ctx.close());const target=await ctx.newPage();await setup(target);await ready(target,text);await target.evaluate(()=>b.commitRestore(q));assert.equal((await target.evaluate(()=>current())).value,A);
});
test('A13/A14: another tab creates valid host after preview; old restore authority stays invalid',async t=>{
 const {ctx,page}=await fresh(t);await ready(page);const other=await ctx.newPage();await setup(other);await other.evaluate(async()=>{const c=a.createGradeImportHostV2(indexedDB,locks,location.origin);await c.initialize();});
 const winner=(await other.evaluate(()=>current())).value,before=await page.evaluate(()=>count.put);assert.equal(await page.evaluate(()=>error(()=>b.commitRestore(q))),'stale');assert.equal(await page.evaluate(()=>b.isStopped()),true);assert.equal((await other.evaluate(()=>current())).value,winner);assert.equal(await page.evaluate(()=>count.put),before);
 assert.equal(await page.evaluate(()=>error(()=>b.confirmRestore(intent,JSON.stringify({targetSha256:intent.targetSha256,confirmed:true,reason:'PR-A explicit restore into isolated empty profile'})))),'session_stopped');
});
test('A17/A18: observed old LS invalidates an issued restore intent irreversibly',async t=>{
 const {page}=await fresh(t);await ready(page);const r=await page.evaluate(async()=>{localStorage.setItem('hosei-planner:v1','do not touch');const before=count.put,code=await error(()=>b.commitRestore(q));localStorage.removeItem('hosei-planner:v1');return{code,stopped:b.isStopped(),old:await error(()=>b.confirmRestore(intent,'{}')),puts:count.put-before};});assert.deepEqual(r,{code:'legacy_storage',stopped:true,old:'session_stopped',puts:0});
});
test('A12/A24: controller native reads and restore creation stay inside the common exclusive Lock',async t=>{
 const {page}=await fresh(t);await ready(page);const r=await page.evaluate(async()=>{transactions.length=0;putContexts.length=0;const result=await b.commitRestore(q);return{result,transactions,putContexts};});assert.equal(r.result.status,'restored');assert.ok(r.transactions.length>0);assert.ok(r.transactions.every(x=>x.held>0));assert.deepEqual(r.putContexts,[{held:1,mode:'versionchange'}]);
});
test('A06: T2 confirmed quota abort backs up its exact T1 burns and restores them',async t=>{
 const {page}=await fresh(t);const A=await page.evaluate(async({s4,s2})=>{
  globalThis.c=a.createGradeImportHostV2(indexedDB,locks,location.origin);globalThis.h=await c.initialize();await adopt(s4);
  const p=await c.preview(h,s2),x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest);globalThis.i=await c.prepare(p,true,JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId}));const q=await c.confirm(i,JSON.stringify(confirmation(JSON.parse(i.targetsJson)))),before=(await current()).value,put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=()=>{throw new DOMException('quota','QuotaExceededError');};try{if(await error(()=>c.commit(q))!=='aborted')throw Error('must confirm terminal abort');}finally{IDBObjectStore.prototype.put=put;}if((await current()).value!==before)throw Error('T1 raw changed');return before;
 },{s4:source(4),s2:source(2)});const text=await page.evaluate(async()=> (await makeBackup().exportBackup()).text());const ctx=await browser.newContext();t.after(()=>ctx.close());const p=await ctx.newPage();await setup(p);await ready(p,text);await p.evaluate(()=>b.commitRestore(q));assert.equal((await p.evaluate(()=>current())).value,A);
 const r=JSON.parse(A),g=r.events.filter(e=>e.body.kind==='reserve').at(-1).body.grant;const outcome=await p.evaluate(async g=>{const d=a.createGradeImportHostV2(indexedDB,locks,location.origin),h=await d.load();return d.recover(h,JSON.stringify({grantId:g.intentId,receipt:null}));},g);assert.equal(outcome.status,'not_adopted_burn_retained');
});
test('A08/A09: an older backup cannot discard a current host newer unused reservation',async t=>{
 const {page}=await fresh(t);await seed(page,savedRaw);await page.evaluate(async s=>{const d=a.createGradeImportHostV2(indexedDB,locks,location.origin),h=await d.load(),p=await d.preview(h,s),x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest);await d.prepare(p,false,JSON.stringify({achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId}));},source(0));const C=(await page.evaluate(()=>current())).value;assert.ok(JSON.parse(C).authority.reservedIds.length>JSON.parse(savedRaw).authority.reservedIds.length);await selected(page);const before=await page.evaluate(()=>count.put);assert.equal(await page.evaluate(()=>error(()=>makeBackup().prepareRestore(file))),'existing_database');assert.equal(await page.evaluate(()=>count.put),before);assert.equal((await page.evaluate(()=>current())).value,C);
});
