import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import os from 'node:os';
const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');
let browser,server,origin;
before(async()=>{
 const output=await build({stdin:{resolveDir:new URL('../',import.meta.url).pathname,contents:`
 import {createAuthorityIndexedDbStore} from './src/planner/attempts/persistence/authorityIndexedDb';
 import {createPlannerAttemptSession} from './src/planner/attempts/production/session';
 export {backupDigest} from './src/planner/digest';
 export const store=createAuthorityIndexedDbStore(indexedDB);export const make=()=>createPlannerAttemptSession(store,navigator.locks);
 `},bundle:true,platform:'browser',format:'esm',write:false,logLevel:'silent'});
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.mjs'?'text/javascript':'text/html');res.end(req.url==='/bundle.mjs'?output.outputFiles[0].text:'<button style="position:absolute;left:0;top:0;width:200px;height:100px" onclick="window.received.push({at:performance.now(),phase:window.phase})">Synthetic input probe</button>');});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});
 console.log(JSON.stringify({kind:'r6-environment',platform:os.platform(),release:os.release(),node:process.version,cpu:os.cpus()[0]?.model,cpus:os.cpus().length,memory:os.totalmem(),browser:browser.version()}));
});
after(async()=>{await browser?.close();server?.closeAllConnections();if(server)await new Promise(ok=>server.close(ok));});
const sizes=process.env.F01_R6_SMALL==='1'?[4000]:[1662,2000,4000,10000,20000,100001];
for(const [count,instrumented] of [...sizes.map(n=>[n,true]),...(process.env.F01_R6_SMALL==='1'?[]:[[100001,false]])])test(`R6 native same-host ${count} instrumented=${instrumented}`,{timeout:300000},async t=>{
 const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();await page.goto(origin);const client=await context.newCDPSession(page);
 // Normal public save -> explicit portable adoption -> actual backup. No DB seeding.
 const setup=await page.evaluate(async n=>{
  window.m=await import('/bundle.mjs');window.api=m.make();window.puts=0;window.received=[];window.phase='setup';const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){puts++;return put.apply(this,a);};
  await api.load();await api.save(await api.prepareSave(),true);const initial=await m.store.read(),body=JSON.parse(await api.createBackup());delete body.sha256;
  const burn=n===100001;
  for(let i=1;body.reservedIds.length<n-(burn?2:0);i++)body.reservedIds.push(i.toString(16).padStart(8,'0')+'-aaab-4aaa-8aab-000000000000');
  const input=JSON.stringify({...body,sha256:await m.backupDigest(body)});
  if(burn){const random=crypto.randomUUID,ids=['b4719cef-4e35-452f-8393-d8ba59a3bdb7','87e38c41-ba8a-45ba-9384-5e8a2c39a97b'];try{crypto.randomUUID=()=>ids.shift();api.add('hosei:cp:b99c65d5-5917-422d-bda4-75a4f99ad8b7',JSON.stringify({plannedYear:2038,method:'correspondence',status:'planned'}));}finally{crypto.randomUUID=random;}await api.load();}
  const proposal=await api.prepareRestore(input);puts=0;await api.save(proposal,true,proposal.adoptionSha256);const sourcePut=puts;
  window.raw=await api.createBackup();window.before=await m.store.read();window.api=m.make();await api.load();puts=0;
  const recordSha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(before))))].map(x=>x.toString(16).padStart(2,'0')).join('');
  return{sourcePut,count:before.issuedIds.length,rawUnchanged:before.raw===initial.raw,dbCount:(await indexedDB.databases()).length,backupBytes:new Blob([raw]).size,burn,recordSha};
 },count);
 assert.equal(setup.count,count);assert.equal(setup.sourcePut,1);assert.ok(setup.rawUnchanged);assert.equal(setup.dbCount,1);
 if(count===100001)assert.equal(setup.recordSha,'5a2b41e284b682fb31de284b0c55c69d3e166b72bca9b56513e1d32c243a9a43','exact sixth-audit record reproduced through public save/burn/discard/restore');
 const loadBefore=os.loadavg(),input=[],pending=[];let done=false;
 const send=async trigger=>{const start=Date.now();await client.send('Input.dispatchMouseEvent',{type:'mousePressed',x:80,y:45,button:'left',clickCount:1});await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:80,y:45,button:'left',clickCount:1});input.push({trigger,wallMs:Date.now()-start});};
 page.on('console',msg=>{if(msg.text()==='r6-membership-start')pending.push(send('membership'));});
 const resultTask=page.evaluate(async({n,instrumented})=>{
  const tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'});
  const oldIncludes=Array.prototype.includes,oldHas=Set.prototype.has,oldSome=Array.prototype.some,maps=new WeakMap();let calls=0,positions=0,lookups=0,marked=false;
  if(instrumented){Array.prototype.includes=function(value,...args){if(this.length===n&&typeof value==='string'&&!args.length){let map=maps.get(this);if(!map){map=new Map(this.map((id,i)=>[id,i]));maps.set(this,map);}calls++;positions+=map.has(value)?map.get(value)+1:this.length;}return oldIncludes.call(this,value,...args);};
   Set.prototype.has=function(value){if(this.size===n)lookups++;return oldHas.call(this,value);};
   Array.prototype.some=function(fn,...args){if(!marked&&this.length===n&&/issued(Index|Ids)/.test(fn.toString())){marked=true;console.log('r6-membership-start');}return oldSome.call(this,fn,...args);};}
  // Chromium's JS heap observations are phase samples, not process RSS/peak memory.
  const memory=()=>performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,jsHeapSizeLimit:performance.memory.jsHeapSizeLimit}:null;
  const heapBefore=memory();let previous=performance.now(),maxTimerGap=0;const timer=setInterval(()=>{const now=performance.now();maxTimerGap=Math.max(maxTimerGap,now-previous);previous=now;},10);const start=performance.now();window.phase='prepare';
  let previewMs,saveMs,previewPuts,portable;
  try{const proposal=await api.prepareRestore(raw);previewMs=performance.now()-start;previewPuts=puts;portable=proposal.adoptionSha256!==null;window.phase='save';const saved=performance.now();await api.save(proposal,true,proposal.adoptionSha256);saveMs=performance.now()-saved;}finally{Array.prototype.includes=oldIncludes;Set.prototype.has=oldHas;Array.prototype.some=oldSome;}
  const heapAfterSave=memory();window.phase='done';await new Promise(ok=>setTimeout(ok,100));clearInterval(timer);observer.disconnect();const after=await m.store.read(),savedPuts=puts;window.phase='reload';const fresh=m.make();await fresh.load();const output=await fresh.createBackup(),out=JSON.parse(output);window.phase='done';const heapAfterBackup=memory();
  const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  return{n,instrumented,previewMs,saveMs,previewPuts,portable,puts:savedPuts,finalPuts:puts,revision:after.revision,orderedEqual:JSON.stringify(after.issuedIds)===JSON.stringify(before.issuedIds)&&JSON.stringify(out.reservedIds)===JSON.stringify(before.issuedIds),rawEqual:after.raw===before.raw,idsSha:await sha(JSON.stringify(after.issuedIds)),rawSha:await sha(after.raw),dbCount:(await indexedDB.databases()).length,legacy:localStorage.getItem('hosei-planner:v1'),recovery:localStorage.getItem('hosei-planner:v1:recovery'),calls:instrumented?calls:null,positions:instrumented?positions:null,lookups:instrumented?lookups:null,marked,maxTimerGap,tasks,maxLongTaskMs:tasks.length?Math.max(...tasks.map(x=>x.duration)):0,heapBefore,heapAfterSave,heapAfterBackup,received};
 },{n:count,instrumented}).finally(()=>{done=true;});
 const clicks=(async()=>{while(!done){await new Promise(ok=>setTimeout(ok,25));if(!done)await send('periodic');}})();
 const result=await resultTask;await clicks;await Promise.all(pending);
 const row={kind:'r6-native-perf',...setup,...result,input,maxInputWallMs:input.length?Math.max(...input.map(x=>x.wallMs)):null,loadBefore,loadAfter:os.loadavg()};console.log(JSON.stringify(row));
 assert.equal(result.previewPuts,0);assert.equal(result.puts,1);assert.equal(result.finalPuts,1);assert.equal(result.revision,3);assert.ok(result.orderedEqual&&result.rawEqual);assert.equal(result.dbCount,1);assert.equal(result.legacy,null);assert.equal(result.recovery,null);
 if(instrumented){assert.equal(result.calls,0,'real reservation membership must avoid repeated includes');assert.equal(result.positions,0);assert.ok(result.lookups>=count);}
 // Wall/LT/input/heap are measurements for an independently agreed latency budget.
 // The deterministic regression gate is real repeated-membership work, not a tuned timer.
 assert.ok(result.received.length>0,'actual CDP input was received');
});
