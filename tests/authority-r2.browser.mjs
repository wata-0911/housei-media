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
  export function setup(fault=false){const native=createAuthorityIndexedDbStore(indexedDB);let armed=false,reads=0;const store={...native,async read(){const r=await native.read();if(armed)reads++;return r;}};
   const api=createPlannerAttemptSession(store,navigator.locks,{readLegacy:()=>{if(fault&&armed&&reads){armed=false;throw Error('legacy-after-full-readback');}return readLegacySnapshot(localStorage);},
    migrationEnvironment:()=>env??=prepareMigrationEnvironment(${JSON.stringify(files)}),protectAuthority:()=>store.protectOriginal()});return {store,api,arm(){armed=true;reads=0;}};}
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
async function writeRaw(page,kind){return page.evaluate(async kind=>{
 const db=await new Promise(r=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>r(q.result);});
 const read=()=>new Promise(r=>{const t=db.transaction('authority'),q=t.objectStore('authority').get('current');t.oncomplete=()=>r(q.result);});let v=await read();
 if(kind==='shared-arrays'){const a=[];v={raw:null,revision:0,committed:a,issuedIds:a};}else if(kind==='shared-object'){const a={n:1};v={a,b:a};}
 await new Promise(r=>{const t=db.transaction('authority','readwrite');t.objectStore('authority').put(v,'current');t.oncomplete=r;});db.close();return true;
},kind);}
async function unsafe(page){return page.evaluate(()=>new Promise((ok,fail)=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>{const db=q.result,t=db.transaction('authority'),r=t.objectStore('authority').get('current');t.oncomplete=()=>{db.close();ok({revision:r.result.revision,raw:r.result.raw,sharedArrays:r.result.committed===r.result.issuedIds,sharedObject:r.result.a===r.result.b,n:r.result.a?.n});};t.onabort=()=>fail(t.error);};}));}
test('R2 native §4.2 complete verified readback retains IDs after final legacy failure',async t=>{
 const {page}=await fresh(t);const result=await page.evaluate(async()=>{
  const x=m.setup(true),s=x.api,c=m.createAcController(s);await c.load();await c.prepare();await c.save(c.getSnapshot().proposal,true);const backup=await s.createBackup();
  s.add('hosei:cp:b99c65d5-5917-422d-bda4-75a4f99ad8b7',JSON.stringify({plannedYear:2044,method:'correspondence',status:'planned'}));const id=s.graph().attempts[0].id;await c.prepare();x.arm();const saved=await c.save(c.getSnapshot().proposal,true),failedUi=c.getSnapshot();
  const at2=await x.store.read(),other=m.setup().api;await other.load();await other.save(await other.prepareRestore(backup),true);const at3=await x.store.read();
  const v={...at3,revision:4,issuedIds:at3.issuedIds.filter(v=>v!==id)};
  await new Promise((ok,fail)=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>{const db=q.result,t=db.transaction('authority','readwrite');t.objectStore('authority').put(v,'current');t.oncomplete=()=>{db.close();ok();};t.onabort=()=>fail(t.error);};});
  let puts=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){puts++;return put.apply(this,a);};const load=await error(()=>s.load()),backupResult=await error(()=>s.createBackup());IDBObjectStore.prototype.put=put;
  const after=await x.store.read();return{saved,ready:failedUi.ready,notice:failedUi.notice,at2:at2.revision,idAt2:at2.issuedIds.includes(id),at3:at3.revision,idAt3:at3.issuedIds.includes(id),knownCount:at3.issuedIds.length,missingCount:v.issuedIds.length,load,backupResult,puts,unchanged:JSON.stringify(after)===JSON.stringify(v)};
 });console.log(JSON.stringify(result));assert.equal(result.saved,false);assert.equal(result.ready,false);assert.doesNotMatch(result.notice,/保存済み/);assert.equal(result.at2,2);assert.equal(result.at3,3);assert.ok(result.idAt2&&result.idAt3);assert.notEqual(result.load,'SUCCESS');assert.notEqual(result.backupResult,'SUCCESS');assert.equal(result.puts,0);assert.equal(result.unchanged,true);
});
for(const kind of ['bad-id','uuid-alias','missing-reservation','late-next-attribute','late-next-value','late-expected-value'])test(`R2 native §4.3 ${kind} put0`,async t=>{
 const {page}=await fresh(t);await seed(page,validRecord);const result=await page.evaluate(async kind=>{
  const expected=await store.read(),next=structuredClone(expected);next.revision++;
  if(kind==='bad-id')next.issuedIds.push('not-an-id');if(kind==='uuid-alias')next.issuedIds.push('hosei:attempt:'+next.issuedIds[0].split(':').at(-1));if(kind==='missing-reservation')next.issuedIds.shift();
  let puts=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){puts++;return put.apply(this,a);};
  const p=error(()=>store.commit(expected,next));if(kind==='late-next-attribute')next.issuedIds.side='after call';if(kind==='late-next-value')next.revision++;if(kind==='late-expected-value')expected.revision++;
  const outcome=await p;IDBObjectStore.prototype.put=put;const after=await error(()=>store.read());return{outcome,puts,read:after};
 },kind);assert.notEqual(result.outcome,'SUCCESS');assert.equal(result.puts,0);assert.equal((await unsafe(page)).revision,1);
});
for(const kind of ['shared-arrays','shared-object'])test(`R2 native §4.3 ${kind} raw protection refuses loss`,async t=>{
 const {page}=await fresh(t);await seed(page,validRecord);await writeRaw(page,kind);const before=await unsafe(page);const r=await page.evaluate(async()=>({protection:await error(()=>api.protectCurrent()),load:await error(()=>api.load())}));assert.match(r.protection,/protection_unrepresentable/);assert.notEqual(r.load,'SUCCESS');assert.deepEqual(await unsafe(page),before);assert.equal(kind==='shared-arrays'?before.sharedArrays:before.sharedObject,true);
});
test('R2 native valid next is stored from a distinct private snapshot',async t=>{
 const {page}=await fresh(t);await seed(page,validRecord);const r=await page.evaluate(async()=>{const expected=await store.read(),next=structuredClone(expected);next.revision++;let sameRoot=null,sameArray=null,puts=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){puts++;sameRoot=a[0]===next;sameArray=a[0].issuedIds===next.issuedIds;return put.apply(this,a);};await store.commit(expected,next);IDBObjectStore.prototype.put=put;const fresh=m.setup().api;await fresh.load();return{puts,sameRoot,sameArray,revision:(await store.read()).revision,case:fresh.admission().case};});assert.deepEqual(r,{puts:1,sameRoot:false,sameArray:false,revision:2,case:'D'});
});
test('R2 native initial next mutation aborts versionchange with no DB left',async t=>{
 const {page}=await fresh(t);const r=await page.evaluate(async next=>{let puts=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){puts++;return put.apply(this,a);};const p=error(()=>store.commit(m.emptyAuthority(),next));next.issuedIds.side='after call';const outcome=await p;IDBObjectStore.prototype.put=put;return{outcome,puts,dbs:await indexedDB.databases()};},validRecord);assert.notEqual(r.outcome,'SUCCESS');assert.equal(r.puts,0);assert.deepEqual(r.dbs,[]);
});
test('R2 native invalid expected is rejected before opening database',async t=>{
 const {page}=await fresh(t);const r=await page.evaluate(async next=>{const expected=m.emptyAuthority();expected.issuedIds.push('not-an-id');let opens=0;const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(...a){opens++;return open.apply(this,a);};const outcome=await error(()=>store.commit(expected,next));IDBFactory.prototype.open=open;return{outcome,opens,dbs:await indexedDB.databases()};},validRecord);assert.notEqual(r.outcome,'SUCCESS');assert.equal(r.opens,0);assert.deepEqual(r.dbs,[]);
});
