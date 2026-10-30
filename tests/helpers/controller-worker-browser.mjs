import {build} from 'esbuild';import {createServer} from 'node:http';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=new URL('../../',import.meta.url).pathname;
const auditPrelude=`
(()=>{
const audit={open:0,readwrite:0,put:0,delete:0,create:0,lock:0,ids:0,oracle:0};globalThis.__audit=audit;
const deny=k=>()=>{audit[k]++;throw new Error('forbidden_'+k)};
const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{audit.open++;return open(...args)};
indexedDB.deleteDatabase=deny('delete');IDBDatabase.prototype.createObjectStore=deny('create');
const transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]&&args[1]!=='readonly')return deny('readwrite')();return transaction.apply(this,args);};
IDBObjectStore.prototype.put=deny('put');IDBObjectStore.prototype.add=deny('put');IDBObjectStore.prototype.delete=deny('delete');IDBObjectStore.prototype.clear=deny('delete');if(navigator.locks)navigator.locks.request=deny('lock');
const uuid=crypto.randomUUID.bind(crypto);crypto.randomUUID=()=>{audit.ids++;return uuid()};
const nativeSend=globalThis.postMessage.bind(globalThis);globalThis.postMessage=data=>{nativeSend(JSON.stringify({testAudit:{...audit}}));nativeSend(data);};
})();
`;
const rawPlugin={name:'raw-files',setup(b){b.onResolve({filter:/\?raw$/},a=>({path:resolve(a.resolveDir,a.path.slice(0,-4)),namespace:'exact-raw'}));b.onLoad({filter:/.*/,namespace:'exact-raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}};
const oraclePlugin={name:'private-controller-oracle',setup(b){b.onResolve({filter:/^audit-base-controller$/},()=>({path:'base-controller',namespace:'audit-base'}));b.onLoad({filter:/.*/,namespace:'audit-base'},()=>({contents:execFileSync('git',['show','1f75d6db958608dfb149d1aa0f610e3c58a21d2d:src/planner/attempts/persistence/controller.ts'],{cwd:root,encoding:'utf8'}),loader:'ts',resolveDir:root+'src/planner/attempts/persistence'}));b.onLoad({filter:/worker\/session\.ts$/},async a=>{
let s=await readFile(a.path,'utf8');s="import {createAttemptPersistence as createBaselinePersistence} from 'audit-base-controller';\nimport {sameAttemptData as auditEqual} from '../../validation';\nimport {replayState as auditReplay} from '../codec';\n"+s;
s=s.replace('const controller=createAttemptPersistence(store,undefined,environment,undefined,{issued:id=>editIds.restrict([id]),reserved:()=>editIds.reservations(),beforeCommand:(workspace,command)=>editIds.checkCommand(workspace,command)});',`const controller=createAttemptPersistence(store,undefined,environment,undefined,{issued:id=>editIds.restrict([id]),reserved:()=>editIds.reservations(),beforeCommand:(workspace,command)=>editIds.checkCommand(workspace,command)});
const oracle=createBaselinePersistence(store,undefined,environment),auditMigrations=new WeakMap(),auditHandles=new WeakMap(),auditProposals=new WeakMap();
async function auditHandle(actual,expected){
 if(actual===null||expected===null){if(actual!==expected)throw Error('audit_null');return;}
 if(!auditEqual([actual.state,actual.workspace,actual.source],[expected.state,expected.workspace,expected.source]))throw Error('audit_all_values');
 const a=await auditReplay(actual.state),b=await auditReplay(expected.state);
 if(!auditEqual([a.state,a.workspace,a.requiredReservations],[b.state,b.workspace,b.requiredReservations]))throw Error('audit_reservations');
 auditHandles.set(actual,expected);globalThis.__audit.oracle++;
}
async function auditConfirm(target){const native=crypto.randomUUID.bind(crypto),tape=[];let m,o,i=0;
 try{crypto.randomUUID=()=>{const id=native();tape.push(id);return id;};m=await controller.confirmDate(target.session,target.proposal,true);crypto.randomUUID=()=>{if(i>=tape.length)throw Error('oracle_ID_count');return tape[i++];};o=await oracle.confirmDate(auditMigrations.get(target.session),auditProposals.get(target.proposal),true);}
 finally{crypto.randomUUID=native;}
 if(i!==tape.length||!auditEqual(m,o))throw Error('audit_corrected_session');auditMigrations.set(m,o);globalThis.__audit.oracle++;return m;
}
async function auditLegacy(raw){const native=crypto.randomUUID.bind(crypto),tape=[];let m,o,i=0;
 try{crypto.randomUUID=()=>{const id=native();tape.push(id);return id;};m=await controller.inspectLegacy(raw);crypto.randomUUID=()=>{if(i>=tape.length)throw Error('oracle_ID_count');return tape[i++];};o=await oracle.inspectLegacy(raw);}
 finally{crypto.randomUUID=native;}
 if(i!==tape.length||!auditEqual(m,o))throw Error('audit_migration_session');auditMigrations.set(m,o);globalThis.__audit.oracle++;return m;
}`);
s=s.replace('try{h=await controller.load();}', 'try{h=await controller.load();await auditHandle(h,await oracle.load());}');
s=s.replace('const m=corrected&&activeMigration?(await store.read(),activeMigration):await controller.inspectLegacy(raw);','const m=corrected&&activeMigration?(await store.read(),activeMigration):await auditLegacy(raw);');
s=s.replace('const p=await controller.prepareNewPlan();','const p=await controller.prepareNewPlan();await auditHandle(p.handle,(await oracle.prepareNewPlan()).handle);');
s=s.replace('const p=await controller.prepareEdits(d.handle,commands);','const p=await controller.prepareEdits(d.handle,commands);await auditHandle(p.handle,(await oracle.prepareEdits(auditHandles.get(d.handle),commands)).handle);');
s=s.replace('const p=await controller.prepareMigration(m.session);','const p=await controller.prepareMigration(m.session);await auditHandle(p.handle,(await oracle.prepareMigration(auditMigrations.get(m.session))).handle);');
s=s.replace('const proposal=await controller.proposeDate(target.session,target.date.offeringId,target.date.assessmentId,c.newDate!);','const proposal=await controller.proposeDate(target.session,target.date.offeringId,target.date.assessmentId,c.newDate!);auditProposals.set(proposal,await oracle.proposeDate(auditMigrations.get(target.session),target.date.offeringId,target.date.assessmentId,c.newDate!));');
s=s.replace('const m=await controller.confirmDate(target.session,target.proposal,true);','const m=await auditConfirm(target);');
s=s.replace('const p=await controller.inspectBackup(raw);','const p=await controller.inspectBackup(raw);const oraclePreview=await oracle.inspectBackup(raw);if(!auditEqual(p,oraclePreview))throw Error("audit_backup_preview");await auditHandle(p.handle,oraclePreview.handle);');
s=s.replace('const p=await controller.prepareEdits(d.handle,[]);','const p=await controller.prepareEdits(d.handle,[]);await auditHandle(p.handle,(await oracle.prepareEdits(auditHandles.get(d.handle),[])).handle);');
return {contents:s,loader:'ts',resolveDir:dirname(a.path)};
});}};
const cloneFault=kind=>({name:'qualification-clone-'+kind,setup(b){b.onLoad({filter:/worker\/session\.ts$/},async a=>({contents:(await readFile(a.path,'utf8')).replace(kind==='migration'?'controller.prepareMigration(m.session)':'controller.assertPreview(candidate.preview);',kind==='migration'?'controller.prepareMigration(structuredClone(m.session))':'candidate={...candidate,preview:structuredClone(candidate.preview)};controller.assertPreview(candidate.preview);'),loader:'ts'}));}});
export async function controllerBrowser(){
 const compile=async(path,extra={})=>(await build({entryPoints:[root+path],bundle:true,write:false,format:'esm',platform:'browser',plugins:[rawPlugin],...extra})).outputFiles[0].text;
 const [worker,observed,client,plain,cloneMigration,clonePreview,pending]=await Promise.all([
 compile('src/planner/attempts/persistence/worker/preview.worker.ts',{banner:{js:auditPrelude}}),
 compile('src/planner/attempts/persistence/worker/preview.worker.ts',{banner:{js:auditPrelude},plugins:[rawPlugin,oraclePlugin]}),
 compile('src/planner/attempts/persistence/worker/client.ts'),compile('src/planner/attempts/persistence/worker/preview.worker.ts'),compile('src/planner/attempts/persistence/worker/preview.worker.ts',{banner:{js:auditPrelude},plugins:[rawPlugin,cloneFault('migration')]}),compile('src/planner/attempts/persistence/worker/preview.worker.ts',{banner:{js:auditPrelude},plugins:[rawPlugin,cloneFault('preview')]}),compile('src/planner/attempts/persistence/worker/preview.worker.ts',{banner:{js:auditPrelude},plugins:[rawPlugin,{name:'test-deferred-read',setup(b){b.onLoad({filter:/preview\.worker\.ts$/},async a=>({contents:(await readFile(a.path,'utf8')).replace('()=>readIndexedDbAuthority(indexedDB)','()=>new Promise<void>(resolve=>setTimeout(resolve,75)).then(()=>readIndexedDbAuthority(indexedDB))'),loader:'ts'}));}}]})]);
 const delayedEdit=await compile('src/planner/attempts/persistence/worker/preview.worker.ts',{banner:{js:auditPrelude},plugins:[rawPlugin,{name:'test-await-edit',setup(b){b.onLoad({filter:/worker\/session\.ts$/},async a=>({contents:(await readFile(a.path,'utf8')).replace('const p=await controller.prepareEdits(d.handle,commands);',"const p=await controller.prepareEdits(d.handle,commands);globalThis.postMessage(JSON.stringify({testEditAwait:true}));await new Promise(resolve=>setTimeout(resolve,250));"),loader:'ts'}));}}]});
 const assets={'/delayed-edit.js':delayedEdit,'/pending.js':pending,'/clone-migration.js':cloneMigration,'/clone-preview.js':clonePreview,'/native/preview.worker.ts':plain,'/native/client.js':client,'/preview.worker.ts':worker,'/observed.js':observed,'/client.js':client,'/fault.js':'throw new Error("PRIVATE_SECRET");'};
 const server=createServer((req,res)=>{res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');if(req.url==='/')res.end('<!doctype html><title>Controller Worker isolation test</title>');else if(assets[req.url])res.end(assets[req.url]);else{res.statusCode=404;res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const module=process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright', {chromium}=await import(module);let browser;
 try{browser=await chromium.launch({headless:true,args:['--enable-precise-memory-info','--js-flags=--expose-gc'],...(process.env.PLANNER_BROWSER_EXECUTABLE?{executablePath:process.env.PLANNER_BROWSER_EXECUTABLE}:{})});}catch(e){server.close();throw e;}
 return {browser,origin:`http://127.0.0.1:${server.address().port}`,async close(){await browser.close();await new Promise(r=>server.close(r));}};
}
export async function setupPage(runtime){const page=await runtime.browser.newPage();await page.goto(runtime.origin);await page.evaluate(async()=>{
 window.api=await import('/client.js');window.audits=[];
 window.makeClient=(url='/preview.worker.ts')=>api.createControllerWorkerClient(()=>{const w=new Worker(url,{type:'module'});let handler;w.onmessage=e=>{if(typeof e.data==='string'){let d;try{d=JSON.parse(e.data)}catch{}if(d?.testAudit){audits.push(d.testAudit);return;}}handler?.(e);};return {postMessage:m=>w.postMessage(m),terminate:()=>w.terminate(),set onmessage(h){handler=h;},set onerror(h){w.onerror=e=>{(window.workerErrors??=[]).push({message:e.message,filename:e.filename,line:e.lineno});h?.(e);};},set onmessageerror(h){w.onmessageerror=h;}};});
 window.seed=async record=>{await new Promise((resolve,reject)=>{const r=indexedDB.open('hosei-yi06-isolated-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('authority');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('authority','readwrite');tx.objectStore('authority').put(record,'current');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});};
 window.readRecord=async()=>new Promise((resolve,reject)=>{const r=indexedDB.open('hosei-yi06-isolated-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('authority','readonly'),get=tx.objectStore('authority').get('current');let value;get.onsuccess=()=>value=get.result;tx.oncomplete=()=>{db.close();resolve(value);};};});
 });return page;}
export async function saveEvidence(name,value){if(!process.env.CONTROLLER_EVIDENCE)return;await mkdir(process.env.CONTROLLER_EVIDENCE,{recursive:true});await writeFile(resolve(process.env.CONTROLLER_EVIDENCE,name),JSON.stringify(value,null,2)+'\n');}
