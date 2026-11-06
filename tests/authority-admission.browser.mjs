// Synthetic native IndexedDB/Web Locks only, temporary loopback origin.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {files,mixed} from './fixtures/migration-fixture.mjs';
const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../',import.meta.url).pathname;
let browser,server,origin,bundle,validRecord;
const raw=' \n'+JSON.stringify(mixed(),null,2)+'\r\n';
before(async()=>{
 const output=await build({absWorkingDir:root,stdin:{resolveDir:root,contents:`
  export {createAcController} from './src/planner/attempts/production/acController';
  export {createGradeImportHost} from './src/planner/attempts/gradeImportHost/controller';
  export {createNativeHostStore} from './src/planner/attempts/gradeImportHost/nativeStore';
  export {emptyAuthority} from './src/planner/attempts/persistence/contracts';
  import {createIndexedDbAttemptStore} from './src/planner/attempts/persistence/indexedDb';
  import {createPlannerAttemptSession} from './src/planner/attempts/production/session';
  import {readLegacySnapshot} from './src/planner/attempts/production/authorityAdmission';
  import {prepareMigrationEnvironment} from './src/planner/attempts/migration/source';
  let env;
  export function setup(){const store=createIndexedDbAttemptStore(indexedDB);
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
test('A native inspection/preview allocates no database; B legacy blocks initialization and migrates explicitly',async t=>{
 const {page}=await fresh(t);
 const empty=await page.evaluate(async()=>{await api.load();await api.prepareSave();return {status:api.admission().case,dbs:await indexedDB.databases()};});assert.deepEqual(empty,{status:'A',dbs:[]});
 await page.evaluate(raw=>{localStorage.setItem('hosei-planner:v1',raw);localStorage.setItem('hosei-planner:v1:recovery','broken recovery\t');},raw);
 const result=await page.evaluate(async raw=>{
  const c=m.createAcController(api);await c.load();const blocked=await error(()=>api.prepareSave()),preview=await api.prepareMigration(raw);
  const before=await indexedDB.databases();await api.save(preview,true);const record=await store.read();
  return {blocked,before,case:api.admission().case,schema:JSON.parse(record.raw).schemaVersion,sourceRaw:JSON.parse(record.raw).source.raw,legacy:localStorage.getItem('hosei-planner:v1'),recovery:localStorage.getItem('hosei-planner:v1:recovery')};
 },raw);
 assert.match(result.blocked,/authority_save_blocked/);assert.deepEqual(result.before,[]);assert.equal(result.case,'E');assert.equal(result.schema,23);assert.equal(result.sourceRaw,raw);assert.equal(result.legacy,raw);assert.equal(result.recovery,'broken recovery\t');
});
for(const [label,value,missing] of [['G03','{"format":"hosei-grade-import-host","hostVersion":1}',false],['null',null,false],['undefined',undefined,false],['missing',null,true],['unknown',{format:'foreign',raw:'bytes'},false]])
test(`H native ${label}: read/commit refuse and protection preserves original`,async t=>{
 const {page}=await fresh(t);await seed(page,value,missing);
 const r=await page.evaluate(async next=>{
  let puts=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){puts++;return put.apply(this,a);};
  const load=await error(()=>api.load()),commit=await error(()=>store.commit(m.emptyAuthority(),next));
  return {load,commit,puts,protection:JSON.parse(await api.protectCurrent()),case:api.admission().case};
 },validRecord);
 assert.notEqual(r.load,'SUCCESS');assert.equal(r.commit,'stale_commit');assert.equal(r.puts,0);assert.equal(r.case,'H');assert.equal(r.protection.keyExists,!missing);
 if(value===undefined)assert.equal(r.protection.valueType,'undefined');else if(!missing)assert.deepEqual(r.protection.value,value);
});
test('G03 actual initialized host blocks ABC in both directions; no namespace changes',async t=>{
 const {page}=await fresh(t);
 const r=await page.evaluate(async next=>{
  const g=m.createGradeImportHost(indexedDB,navigator.locks,location.origin);await g.initialize();
  const native=m.createNativeHostStore(indexedDB),before=await native.read();
  const load=await error(()=>api.load()),commit=await error(()=>store.commit(m.emptyAuthority(),next));
  const protection=JSON.parse(await api.protectCurrent());return {load,commit,before,after:await native.read(),protection};
 },validRecord);
 assert.notEqual(r.load,'SUCCESS');assert.equal(r.commit,'stale_commit');assert.deepEqual(r.before,r.after);assert.equal(r.protection.value,r.before.value);
 const second=await fresh(t);await seed(second.page,validRecord);
 const inverse=await second.page.evaluate(async()=>{
  const native=m.createNativeHostStore(indexedDB),before=await store.read();
  const init=await error(()=>m.createGradeImportHost(indexedDB,navigator.locks,location.origin).initialize());
  const cas=await error(()=>native.cas(JSON.stringify(before),'foreign overwrite'));
  return {init,cas,before,after:await store.read()};
 });assert.equal(inverse.init,'existing_database');assert.equal(inverse.cas,'stale');assert.deepEqual(inverse.before,inverse.after);
});
test('I native queued Web Lock rechecks both legacy keys before first IDB put',async t=>{
 const {page,context}=await fresh(t),other=await context.newPage();await other.goto(origin);
 await page.evaluate(async()=>{await api.load();window.p=await api.prepareSave();});
 await other.evaluate(async()=>{window.lock=navigator.locks.request('hosei-planner:v1:write',()=>new Promise(r=>window.release=r));while(!window.release)await new Promise(r=>setTimeout(r,5));});
 await page.evaluate(()=>{window.result=error(()=>api.save(p,true));});
 await other.evaluate(async raw=>{localStorage.setItem('hosei-planner:v1',raw);window.release();await window.lock;},raw);
 const r=await page.evaluate(async()=>({error:await window.result,dbs:await indexedDB.databases(),retry:await error(()=>api.prepareSave())}));
 assert.match(r.error,/legacy_changed/);assert.match(r.retry,/requires_reload/);assert.deepEqual(r.dbs,[]);
});
