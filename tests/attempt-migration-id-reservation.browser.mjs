import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {mixed,media} from './fixtures/migration-fixture.mjs';

test('native failed date allocation burns every UUID before rejection, rejects replay, then permits fresh correction and edits without writes',{timeout:90000},async()=>{
 const rawPlugin={name:'raw',setup(b){b.onResolve({filter:/\?raw$/},a=>({path:resolve(a.resolveDir,a.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}};
 const injection={name:'test-only-date-uuid-tape',setup(b){b.onLoad({filter:/worker\/session\.ts$/},async a=>{
  let s=await readFile(a.path,'utf8');
  const date='const m=await controller.confirmDate(target.session,target.proposal,true);';assert.ok(s.includes(date));
  s=s.replace(date,`const m=await (async()=>{
   const originalUUID=crypto.randomUUID.bind(crypto),call=globalThis.dateCalls++,tape=[],first=originalUUID();let n=0;
   const before=JSON.stringify([activeMigration,activeDraft,activePreview,view]);
   crypto.randomUUID=()=>{const i=n++,id=call===0?(i===0||i===3?first:originalUUID()):call===1?(globalThis.failedIds[i]??originalUUID()):originalUUID();tape.push(id);return id;};
   try{return await controller.confirmDate(target.session,target.proposal,true);}
   catch(e){globalThis.postMessage(JSON.stringify({testAllocation:{call,error:e.message,tape,unchanged:before===JSON.stringify([activeMigration,activeDraft,activePreview,view]),burned:editIds.reservations()}}));throw e;}
   finally{if(call===0)globalThis.failedIds=tape;crypto.randomUUID=originalUUID;}
  })();`);
  const edit='const commands=buildEdits(d.handle,d.expected,c.intents!,registry,editIds);';assert.ok(s.includes(edit));
  s=s.replace(edit,`const commands=(()=>{const originalUUID=crypto.randomUUID.bind(crypto);let n=0;crypto.randomUUID=()=>globalThis.failedIds[n++]??originalUUID();try{const commands=buildEdits(d.handle,d.expected,c.intents!,registry,editIds);globalThis.postMessage(JSON.stringify({testCommands:commands}));return commands;}finally{crypto.randomUUID=originalUUID;}})();`);
  return {contents:s,loader:'ts'};
 });}};
 const banner=`(()=>{const audit={readwrite:0,put:0,delete:0,create:0,lock:0};const deny=k=>()=>{audit[k]++;throw Error(k)};const tx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...a){if(a[1]&&a[1]!=='readonly')return deny('readwrite')();return tx.apply(this,a)};IDBObjectStore.prototype.put=deny('put');IDBObjectStore.prototype.add=deny('put');IDBObjectStore.prototype.delete=deny('delete');IDBObjectStore.prototype.clear=deny('delete');indexedDB.deleteDatabase=deny('delete');IDBDatabase.prototype.createObjectStore=deny('create');if(navigator.locks)navigator.locks.request=deny('lock');const send=postMessage.bind(globalThis);globalThis.postMessage=x=>{send(JSON.stringify({testAudit:{...audit}}));send(x)};globalThis.dateCalls=0;globalThis.failedIds=[];})();`;
 const worker=(await build({entryPoints:['src/planner/attempts/persistence/worker/preview.worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',plugins:[rawPlugin,injection],banner:{js:banner}})).outputFiles[0].text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/w.js'?'text/javascript':'text/html');res.end(req.url==='/w.js'?worker:'<!doctype html><title>Date ID reservation regression</title>');});
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});let browser;
 try{
  const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true,executablePath:process.env.PLANNER_BROWSER_EXECUTABLE});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  const state=mixed();state.mediaSchoolingProgress[media.id].assessments[0].scheduledDate='2027-02-30';
  const out=await page.evaluate(async raw=>{
   const w=new Worker('/w.js',{type:'module'}),pending=new Map(),audits=[],allocations=[],commands=[],responses=[];let id=0,session,view,draft,readyResolve,readyReject;
   const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j;});w.onerror=e=>readyReject(Error(e.message));
   w.onmessage=e=>{const r=JSON.parse(e.data);if(r.testAudit){audits.push(r.testAudit);return;}if(r.testAllocation){allocations.push(r.testAllocation);return;}if(r.testCommands){commands.push(r.testCommands);return;}if(r.type==='ready'){readyResolve();return;}pending.get(r.requestId)?.(r);pending.delete(r.requestId);};
   w.postMessage(JSON.stringify({version:1,boot:44,type:'hello'}));await ready;
   const call=async(op,extra={},input)=>{const n=++id,p=new Promise(r=>pending.set(n,r));w.postMessage(JSON.stringify({version:1,boot:44,requestId:n,op,...(session?{session,expectedView:view}:{}),...extra}));if(input!==undefined)w.postMessage(input);const r=await p;responses.push(r);if(r.type==='result'){view=r.value?.view??view;draft=r.value?.draft??draft;}return r;};
   const started=await call('startSession');session=started.value.session;await call('inspectLegacyRaw',{},raw);const initialView=view,date=(await call('readPage',{kind:'dates'})).value.rows[0].row;
   const p1=(await call('proposeDate',{date,newDate:null})).value,failed=await call('confirmDate',{correction:p1.correction,confirmed:true}),kept=await call('readPage',{kind:'dates'});
   const p2=(await call('proposeDate',{date,newDate:'2028-02-29'})).value,replay=await call('confirmDate',{correction:p2.correction,confirmed:true});
   const reinspect=await call('inspectLegacyRaw',{},raw),date2=(await call('readPage',{kind:'dates'})).value.rows[0].row,p3=(await call('proposeDate',{date:date2,newDate:null})).value,fresh=await call('confirmDate',{correction:p3.correction,confirmed:true});
   await call('prepareMigration',{migration:fresh.value.migration});
   const add={kind:'add',selection:null,title:'fresh',plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''};await call('prepareEdits',{draft,intents:[add]});
   const owner=(await call('readPage',{kind:'attempts'})).value.rows.at(-1).row;
   await call('prepareEdits',{draft,intents:[{kind:'add_record',owner:null,fields:{kind:'todo',text:'todo',done:false}},{kind:'add_record',owner,fields:{kind:'media',totalLessons:null}}]});
   const record=(await call('readPage',{kind:'records'})).value.rows.filter(r=>r.kind==='media').at(-1).row;
   await call('prepareEdits',{draft,intents:[{kind:'edit_payload',record,changes:{kind:'media',addAssessment:{type:'other',label:'fresh',scheduledDate:null,completed:false}}}]});
   const saved=await call('prepareSave',{draft});w.terminate();return {initialView,failed,kept,replay,reinspect,fresh,saved,allocations,commands,audits,responses,dbs:await indexedDB.databases()};
  },JSON.stringify(state));
  if(process.env.CONTROLLER_EVIDENCE)await writeFile(resolve(process.env.CONTROLLER_EVIDENCE,'date-reservation-native.json'),JSON.stringify({chromium:browser.version(),...out},null,2));
  assert.equal(out.allocations.length,2);assert.equal(out.failed.type,'error');assert.equal(out.replay.type,'error');assert.equal(out.kept.value.total,1);assert.equal(out.kept.value.view,out.initialView);
  for(const a of out.allocations){assert.equal(a.error,'assignment_uuid_collision');assert.equal(a.unchanged,true);for(const id of a.tape)assert.ok(a.burned.includes(id));}
  const lost=new Set(out.allocations[0].tape);assert.ok(lost.size>2);assert.equal(out.fresh.value.status,'ready');assert.equal(out.saved.value.preview.canCommit,false);
  assert.equal(out.commands.length,3);for(const c of out.commands)for(const id of lost)assert.ok(!JSON.stringify(c).includes(id));
  assert.equal(out.responses.filter(r=>r.type==='error').length,2);for(const a of out.audits)for(const k of ['readwrite','put','delete','create','lock'])assert.equal(a[k],0);assert.deepEqual(out.dbs,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
