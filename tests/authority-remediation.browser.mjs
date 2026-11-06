// Synthetic native IndexedDB/Web Locks only, temporary loopback origin.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {files,mixed} from './fixtures/migration-fixture.mjs';
const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');
const root=process.env.REMEDIATION_SOURCE||new URL('../',import.meta.url).pathname;
let browser,server,origin,bundle,validRecord;
const raw=' \n'+JSON.stringify(mixed(),null,2)+'\r\n';
before(async()=>{
 const output=await build({absWorkingDir:root,stdin:{resolveDir:root,contents:`
  export {createAcController} from './src/planner/attempts/production/acController';
  export {createGradeImportHost} from './src/planner/attempts/gradeImportHost/controller';
  export {createNativeHostStore} from './src/planner/attempts/gradeImportHost/nativeStore';
  export {emptyAuthority} from './src/planner/attempts/persistence/contracts';
  import {createAuthorityIndexedDbStore} from './src/planner/attempts/persistence/authorityIndexedDb';
  import {createPlannerAttemptSession} from './src/planner/attempts/production/session';
  import {readLegacySnapshot} from './src/planner/attempts/production/authorityAdmission';
  import {prepareMigrationEnvironment} from './src/planner/attempts/migration/source';
  let env;
  export function setup(){const store=createAuthorityIndexedDbStore(indexedDB);
   const api=createPlannerAttemptSession(store,navigator.locks,{readLegacy:()=>readLegacySnapshot(localStorage),
    migrationEnvironment:()=>env??=prepareMigrationEnvironment(${JSON.stringify(files)}),protectAuthority:()=>store.protectOriginal()});return {store,api};}
 `},bundle:true,write:false,platform:'browser',format:'esm',logLevel:'silent'});bundle=output.outputFiles[0].text;
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.mjs'?'text/javascript':'text/html');res.end(req.url==='/bundle.mjs'?bundle:'<!doctype html><title>F01 isolated synthetic test</title>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.PLANNER_BROWSER_EXECUTABLE});
 const context=await browser.newContext(),page=await context.newPage();await page.goto(origin);
 validRecord=await page.evaluate(async()=>{const m=await import('/bundle.mjs'),{api,store}=m.setup();await api.load();await api.save(await api.prepareSave(),true);return store.read();});
 await context.close();
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>{server.closeAllConnections();server.close(r);});});
async function fresh(t){const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();await page.goto(origin);
 await page.evaluate(async()=>{window.m=await import('/bundle.mjs');Object.assign(window,m.setup());window.error=async fn=>{try{await fn();return 'SUCCESS';}catch(e){return e.code||e.message;}};});return {page,context};}
async function seed(page,value,missing=false){await page.evaluate(({value,missing})=>new Promise((resolve,reject)=>{
 const r=indexedDB.open('hosei-yi06-isolated-v1',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('authority');if(!missing)s.put(value,'current');};r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);
}),{value,missing});}
async function actual(page){return page.evaluate(()=>new Promise((ok,fail)=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>{const db=q.result,tx=db.transaction('authority','readonly'),r=tx.objectStore('authority').get('current');tx.oncomplete=()=>{db.close();ok(r.result);};tx.onabort=()=>fail(tx.error);};q.onerror=()=>fail(q.error);}));}
test('R1 Astra native corrupt current remains byte and registry identical',async t=>{
 const {page}=await fresh(t);await seed(page,validRecord);
 const r=await page.evaluate(async()=>{
  await api.load();const backup=await api.createBackup(),v=await store.read();const state=JSON.parse(v.raw);state.graph.attempts=['synthetic'];v.raw=JSON.stringify(state);v.revision++;
  await new Promise((ok,fail)=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>{const db=q.result,tx=db.transaction('authority','readwrite');tx.objectStore('authority').put(v,'current');tx.oncomplete=()=>{db.close();ok();};tx.onabort=()=>fail(tx.error);};});
  const next=m.setup().api;await error(()=>next.load());const outcome=await error(async()=>api.save(await api.prepareRestore(backup),true));return{before:v,outcome,admission:next.admission().case};
 });assert.notEqual(r.outcome,'SUCCESS');assert.equal(r.admission,'H');assert.deepEqual(await actual(page),r.before);
});
for(const field of ['committed','issuedIds'])for(const kind of ['extra','hole','outside'])test(`R2 native ${field}/${kind} never put or drop unknown data`,async t=>{
 const {page}=await fresh(t);await seed(page,validRecord);
 const r=await page.evaluate(async({field,kind})=>{
  await api.load();const p=await api.prepareSave(),v=await store.read();if(kind==='extra')v[field].auditExtension={raw:'synthetic'};else if(kind==='hole')v[field].length++;else v[field]['4294967295']='outside';
  const db=await new Promise(r=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>r(q.result);});await new Promise(r=>{const tx=db.transaction('authority','readwrite');tx.objectStore('authority').put(v,'current');tx.oncomplete=r;});
  let puts=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){puts++;return put.apply(this,a);};const fresh=m.setup().api;const load=await error(()=>fresh.load()),save=await error(()=>api.save(p,true));IDBObjectStore.prototype.put=put;
  const after=await new Promise(r=>{const tx=db.transaction('authority'),q=tx.objectStore('authority').get('current');tx.oncomplete=()=>r(q.result);});db.close();
  return{load,save,puts,same:kind==='extra'?JSON.stringify(after[field].auditExtension)===JSON.stringify(v[field].auditExtension):kind==='hole'?!Object.hasOwn(after[field],after[field].length-1):after[field]['4294967295']===v[field]['4294967295'],revision:after.revision,beforeRevision:v.revision};
 },{field,kind});assert.notEqual(r.load,'SUCCESS');assert.notEqual(r.save,'SUCCESS');assert.equal(r.puts,0);assert.equal(r.same,true);assert.equal(r.revision,r.beforeRevision);
});
for(const kind of ['Map','Date','NaN','undefined-property','negative-zero','array-extra'])test(`R4 native protection refuses lossy ${kind}`,async t=>{
 const {page}=await fresh(t);const r=await page.evaluate(async kind=>{
  const v=kind==='Map'?new Map([['private','synthetic']]):kind==='Date'?new Date(0):kind==='NaN'?NaN:kind==='negative-zero'?-0:kind==='array-extra'?Object.assign([],{extra:'synthetic'}):{meaning:undefined};
  await new Promise((ok,fail)=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('authority').put(v,'current');q.onsuccess=()=>{q.result.close();ok();};q.onerror=()=>fail(q.error);});
  return error(()=>api.protectCurrent());
 },kind);assert.match(r,/protection.*unrepresentable/);
});
for(const initialized of [false,true])test(`R3 native ${initialized?'readwrite':'versionchange'} late legacy change aborts before put`,async t=>{
 const {page}=await fresh(t);if(initialized)await seed(page,validRecord);
 const before=initialized?await actual(page):null;
 const r=await page.evaluate(async raw=>{
  await api.load();const p=await api.prepareSave();let puts=0,inject=true;const put=IDBObjectStore.prototype.put,getKey=IDBObjectStore.prototype.getKey;
  IDBObjectStore.prototype.put=function(...a){puts++;return put.apply(this,a);};
  IDBObjectStore.prototype.getKey=function(...a){const r=getKey.apply(this,a);r.addEventListener('success',()=>{if(inject){inject=false;localStorage.setItem('hosei-planner:v1',raw);localStorage.setItem('hosei-planner:v1:recovery','late recovery');}});return r;};
  const save=await error(()=>api.save(p,true));IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.getKey=getKey;return{save,puts,dbs:await indexedDB.databases(),legacy:localStorage.getItem('hosei-planner:v1'),recovery:localStorage.getItem('hosei-planner:v1:recovery')};
 },raw);assert.match(r.save,/legacy_changed/);assert.equal(r.puts,0);assert.equal(r.legacy,raw);assert.equal(r.recovery,'late recovery');if(initialized)assert.deepEqual(await actual(page),before);else assert.deepEqual(r.dbs,[]);
});
test('R3 native two tabs queued IDB transaction rejects visible old writer update',async t=>{
 const {page,context}=await fresh(t);await seed(page,validRecord);await page.evaluate(async()=>{await api.load();window.p=await api.prepareSave();});
 const before=await actual(page),other=await context.newPage();await other.goto(origin);await other.evaluate(async()=>{
  window.db=await new Promise(r=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>r(q.result);});window.hold=true;window.tx=db.transaction('authority','readwrite');const bucket=tx.objectStore('authority');function poll(){const q=bucket.get('current');q.onsuccess=()=>{if(window.hold)poll();};}poll();
 });
 await page.evaluate(()=>{const transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...a){const tx=transaction.apply(this,a);if(a[1]==='readwrite')window.queued=true;return tx;};window.result=error(()=>api.save(p,true));});await page.waitForFunction(()=>window.queued);await other.evaluate(raw=>{localStorage.setItem('hosei-planner:v1',raw);window.hold=false;db.close();},raw);
 const r=await page.evaluate(async()=>({outcome:await window.result}));assert.match(r.outcome,/legacy_changed/);assert.deepEqual(await actual(page),before);
});
