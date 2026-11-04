// Expensive cases are in their own serial entry so Work B can finish before
// they run. Measurements are instrumented samples, not public performance gates.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {testRevisionDefine} from './revision-fixture.mjs';
import {input,course,oracle} from '../grade-import-pure/ledgerFixture.mjs';
const root=new URL('../../',import.meta.url).pathname;
let browser,server,origin,chromium;
const raw=(n,padding=0)=>JSON.stringify({...input([course('PR-A maximum/history',n,'2024')]),metadata:{pad:'x'.repeat(padding)}});
before(async()=>{
 ({chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright'));
 const b=await build({absWorkingDir:root,stdin:{resolveDir:root,contents:`export {createGradeImportBackupController} from './src/planner/attempts/gradeImportHost/portable/controller';export {createGradeImportHost} from './src/planner/attempts/gradeImportHost/controller';export {createGradeImportHostV2} from './src/planner/attempts/gradeImportHost/controllerV2';export {createNativeHostStore} from './src/planner/attempts/gradeImportHost/nativeStore';`},bundle:true,write:false,platform:'browser',format:'esm',define:testRevisionDefine});
 server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'");if(req.url==='/a.mjs'){res.setHeader('Content-Type','text/javascript');res.end(b.outputFiles[0].text);}else res.end('<!doctype html><title>PR-A capacity fixture</title>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
async function setup(page){await page.goto(origin);await page.evaluate(async()=>{
 globalThis.a=await import('/a.mjs');globalThis.metrics={puts:0,uuids:0,spans:[]};globalThis.locks={request:(name,opts,action)=>navigator.locks.request(name,opts,async()=>{const start=performance.now();try{return await action();}finally{metrics.spans.push(performance.now()-start);}})};
 const put=IDBObjectStore.prototype.put,uuid=crypto.randomUUID.bind(crypto);IDBObjectStore.prototype.put=function(...args){metrics.puts++;return put.apply(this,args);};crypto.randomUUID=()=>{metrics.uuids++;return uuid();};
 globalThis.error=async fn=>{try{await fn();return'SUCCESS';}catch(e){return e.code||e.message;}};
 globalThis.adopt=async s=>{const p=await c.preview(h,s),x=JSON.parse(p.displayJson).rows[0].candidates.find(x=>x.isLatest),i=await c.prepare(p,true,JSON.stringify(x?{achievementId:x.achievementId,revisionId:x.revisionId,observationId:x.observationId}:null)),t=JSON.parse(i.targetsJson),q=await c.confirm(i,JSON.stringify({selectionSha256:t.selectionSha256,confirmed:true,rows:t.rows.map(r=>({...r,confirmed:true,reason:'maximum/history independent confirmation'}))}));globalThis.h=(await c.commit(q)).handle;};
 globalThis.exportFile=async()=>{const b=a.createGradeImportBackupController(indexedDB,locks,location.origin,localStorage),start=performance.now();globalThis.file=await b.exportBackup();return{text:await file.text(),ms:performance.now()-start,metrics};};
});}
async function restore(page,text){return page.evaluate(async text=>{
 const file=new File([text],'maximum.b1.json'),b=a.createGradeImportBackupController(indexedDB,locks,location.origin,localStorage),start=performance.now(),i=await b.prepareRestore(file),q=await b.confirmRestore(i,JSON.stringify({targetSha256:i.targetSha256,confirmed:true,reason:'explicit isolated capacity restore'})),before={...metrics};const result=await b.commitRestore(q);return{result,ms:performance.now()-start,metrics,delta:{puts:metrics.puts-before.puts,uuids:metrics.uuids-before.uuids},raw:(await a.createNativeHostStore(indexedDB).read()).value};
 },text);}
async function measureHeap(page,action){const cdp=await page.context().newCDPSession(page),samples=[];let sampling=false;const sample=async()=>{if(sampling)return;sampling=true;try{samples.push((await cdp.send('Runtime.getHeapUsage')).usedSize);}finally{sampling=false;}};await sample();const interval=setInterval(()=>{sample().catch(()=>{});},500);try{const result=await action();await sample();return{result,heapSamples:samples.length,maxObservedHeapBytes:Math.max(...samples),nodeMaxRSSKiB:process.resourceUsage().maxRSS};}finally{clearInterval(interval);await cdp.detach();}}
for(const scenario of ['near-limit-v1','maximum-source','long-history'])test(`A20/A21/A22: ${scenario} lossless native backup/restore with time and sampled heap`,async()=>{
 console.log(JSON.stringify({capacityStart:{scenario,utc:new Date().toISOString()}}));
 const ctx=await browser.newContext(),dst=await browser.newContext();let s,t;
 try{s=await ctx.newPage();t=await dst.newPage();await setup(s);await setup(t);const start=performance.now();let expected=[];
 if(scenario==='near-limit-v1'){
  await s.evaluate(async()=>{globalThis.c=a.createGradeImportHost(indexedDB,locks,location.origin);globalThis.h=await c.initialize();const raw=' '.repeat(8*1024*1024-h.snapshotJson.length)+h.snapshotJson;const db=await new Promise(r=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>r(q.result);});await new Promise(r=>{const tx=db.transaction('authority','readwrite');tx.objectStore('authority').put(raw,'current');tx.oncomplete=r;});db.close();globalThis.A=raw;});
  const refusal=await s.evaluate(async()=>{const d=a.createGradeImportHostV2(indexedDB,locks,location.origin),h=await d.load(),i=await d.prepareUpgrade(h),before=metrics.puts,code=await error(()=>d.confirmUpgrade(i,JSON.stringify({...JSON.parse(i.targetJson),confirmed:true,reason:'capacity-only attempt'})));return{code,puts:metrics.puts-before};});assert.deepEqual(refusal,{code:'resource_limit',puts:0});
 }else{
  const pad=scenario==='maximum-source'?1024*1024-Buffer.byteLength(raw(4))-40:0;expected=scenario==='maximum-source'?[raw(4,pad),raw(2,pad)]:[4,3,2,0,null,5,1,6].map(n=>raw(n));
  await s.evaluate(async({sources,upgrade})=>{
   globalThis.c=upgrade?a.createGradeImportHost(indexedDB,locks,location.origin):a.createGradeImportHostV2(indexedDB,locks,location.origin);globalThis.h=await c.initialize();await adopt(sources[0]);
   if(upgrade){c=a.createGradeImportHostV2(indexedDB,locks,location.origin);h=await c.load();const i=await c.prepareUpgrade(h),q=await c.confirmUpgrade(i,JSON.stringify({...JSON.parse(i.targetJson),confirmed:true,reason:'maximum v1 base preservation'}));await c.commitUpgrade(q);c=a.createGradeImportHostV2(indexedDB,locks,location.origin);h=await c.load();}
   for(const source of sources.slice(1))await adopt(source);globalThis.A=h.snapshotJson;
  },{sources:expected,upgrade:scenario==='maximum-source'});
 }
 const setupMs=performance.now()-start;console.log(JSON.stringify({capacityPhase:{scenario,phase:'setup-complete',setupMs}}));
 const exported=await measureHeap(s,()=>s.evaluate(()=>exportFile()));console.log(JSON.stringify({capacityPhase:{scenario,phase:'export-complete',ms:exported.result.ms}}));const restored=await measureHeap(t,()=>restore(t,exported.result.text));
 const A=await s.evaluate(()=>A);assert.equal(restored.result.raw,A);assert.deepEqual(restored.result.delta,{puts:1,uuids:0});
 const hash=b=>createHash('sha256').update(b).digest('hex');
 if(process.env.G03_BACKUP_ARTIFACTS){await mkdir(process.env.G03_BACKUP_ARTIFACTS,{recursive:true});await writeFile(resolve(process.env.G03_BACKUP_ARTIFACTS,scenario+'.b1.json'),exported.result.text);await writeFile(resolve(process.env.G03_BACKUP_ARTIFACTS,scenario+'.host.json'),A);}
 const r=JSON.parse(A),l=JSON.parse(r.ledgerRaw);assert.deepEqual(l,oracle(l.journal.entries.map(e=>e.operation),[r.hostId]));assert.deepEqual(l.view.snapshots.map(x=>x.archive.raw),expected);
 console.log(JSON.stringify({capacity:{scenario,setupMs,sourceSha256:expected.map(x=>hash(x)),hostUtf16Sha256:hash(Buffer.from(A,'utf16le')),fileSha256:hash(exported.result.text),hostBytes:Buffer.byteLength(A),fileBytes:Buffer.byteLength(exported.result.text),sourceBytes:expected[0]?Buffer.byteLength(expected[0]):0,receipts:r.receipts.length,H:r.authority.reservedIds.length,exportMs:exported.result.ms,restoreMs:restored.result.ms,sourceLockSpansMs:exported.result.metrics.spans,restoreLockSpansMs:restored.result.metrics.spans,exportHeap:{samples:exported.heapSamples,maxObservedBytes:exported.maxObservedHeapBytes},restoreHeap:{samples:restored.heapSamples,maxObservedBytes:restored.maxObservedHeapBytes},nodeMaxRSSKiB:restored.nodeMaxRSSKiB}}));
 }finally{await ctx.close();await dst.close();}
});
test('A21: 128 real v2 reserves keep all burns, 129th refuses without a put',async()=>{
 const ctx=await browser.newContext();try{const p=await ctx.newPage();await setup(p);const result=await p.evaluate(async s=>{
  const start=performance.now();globalThis.c=a.createGradeImportHostV2(indexedDB,locks,location.origin);globalThis.h=await c.initialize();for(let k=0;k<128;k++){const p=await c.preview(h,s);await c.prepare(p,false);c.cancel();h=await c.load();}
  const A=h.snapshotJson,before=metrics.puts,p=await c.preview(h,s),code=await error(()=>c.prepare(p,false));const r=JSON.parse(A),l=JSON.parse(r.ledgerRaw);const b=a.createGradeImportBackupController(indexedDB,locks,location.origin,localStorage);const file=await b.exportBackup();return{code,puts:metrics.puts-before,H:r.authority.reservedIds.length,events:r.events.length,F:l.reservedIds,hostId:r.hostId,unchanged:(await a.createNativeHostStore(indexedDB).read()).value===A,ms:performance.now()-start,fileBytes:file.size};
 },raw(4));assert.equal(result.code,'resource_limit');assert.equal(result.puts,0);assert.equal(result.events,128);assert.equal(result.H,1+128*26);assert.deepEqual(result.F,[result.hostId]);assert.equal(result.unchanged,true);console.log(JSON.stringify({maximumReserves:result}));}finally{await ctx.close();}
});
