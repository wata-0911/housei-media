import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const root=new URL('../',import.meta.url).pathname,port=Number(process.env.PR4_BROWSER_PORT||4284),origin=`http://127.0.0.1:${port}`;
let server,browser;let serverLog='';
before(async()=>{
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,env:{...process.env,YI06_PERSISTENCE:'1'},stdio:'pipe'});
 server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
 for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error(serverLog);try{if((await fetch(origin)).ok)break;}catch{}if(i===99)throw Error(serverLog);await delay(200);}
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});console.log('Chromium '+browser.version());
});
after(async()=>{await browser?.close();server?.kill('SIGTERM');});
async function open(t,holdInitialRead=false){const context=await browser.newContext({acceptDownloads:true});
 await context.addInitScript(()=>{window.legacyCalls=0;for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.legacyCalls++;throw Error('legacy forbidden');};
  window.puts=[];const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){window.puts.push(this.transaction.mode);if(window.failure==='quota')throw new DOMException('full','QuotaExceededError');const request=put.apply(this,a);if(window.failure==='abort')this.transaction.abort();return request;};});
 if(holdInitialRead)await context.addInitScript(()=>{const databases=IDBFactory.prototype.databases;const gate=new Promise(resolve=>window.releaseInitialRead=resolve);IDBFactory.prototype.databases=async function(){await gate;return databases.call(this);};});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/__dev/persistence-v2');if(!holdInitialRead)await page.getByRole('status').filter({hasText:'隔離hostは空です'}).waitFor();
 t.after(async()=>{try{assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.legacyCalls),0);}finally{await context.close();}});return {page,context};}
async function modules(page){await page.evaluate(async(writerPath)=>{const {createPersistentAttemptSession}=await import('/src/planner/attempts/persistence/persistentSession.ts');const {createIndexedDbAttemptStore}=await import(writerPath);window.store=createIndexedDbAttemptStore(indexedDB);window.factory=(...args)=>createPersistentAttemptSession(window.store,args.length?args[0]:navigator.locks);window.api=window.factory();},process.env.PR4_WRITER_MODULE||'/src/planner/attempts/persistence/indexedDb.ts');}
async function saveUI(page){const wait=page.waitForEvent('download');await page.getByRole('button',{name:'置換前authority・source・選択原文を保護'}).click();await wait;const adoption=page.getByLabel('発行者未認証の選択ファイルを復旧元として採用する');if(await adoption.count())await adoption.check();await page.getByLabel('保護ファイルと差分を確認し、全件置換を確定する').check();await page.getByRole('button',{name:'確認してv2保存'}).click();await page.getByRole('status').filter({hasText:'隔離保存と正規再読込が完了'}).waitFor({timeout:120000});}

test('native Chromium UI: atomic v2 initialize, edit, export, inspect-only, explicit restore and reload',async t=>{
 const {page}=await open(t);await page.getByRole('button',{name:'native-v2 新規計画preview'}).click();await page.getByText(/操作: new-plan/).waitFor();assert.deepEqual(await page.evaluate(()=>window.puts),[]);await saveUI(page);assert.deepEqual(await page.evaluate(()=>window.puts),['versionchange']);
 await page.getByRole('button',{name:'新しい履修回',exact:true}).click();const form=page.getByRole('form',{name:'新規履修回'});await form.getByLabel('未確定科目の名称').fill('native IDB');await form.getByRole('button',{name:'新規Attemptを追加'}).click();await page.getByRole('button',{name:'編集を保存preview'}).click();await page.getByText(/操作: edit/).waitFor();await saveUI(page);
 await modules(page);const expected=await page.evaluate(()=>window.store.read());assert.equal(JSON.parse(expected.raw).graph.attempts.length,1);assert.match(await page.getByTestId('saved-state').textContent(),/receipt 1/);const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'確定状態をbackup v4 export'}).click();const file=await downloading,raw=await readFile(await file.path(),'utf8');assert.equal(JSON.parse(raw).backupVersion,4);
 const before=await page.evaluate(()=>window.puts.length);await page.getByLabel('backup inspect').setInputFiles({name:'v4.json',mimeType:'application/json',buffer:Buffer.from(raw)});await page.getByText('v4 / not-issued').waitFor();assert.equal(await page.evaluate(()=>window.puts.length),before);
 await page.getByRole('button',{name:'選択ファイルを復元preview'}).click();await page.getByText(/操作: restore/).waitFor();await saveUI(page);await page.reload();await page.getByRole('status').filter({hasText:'確定保存を再読込'}).waitFor();await modules(page);const next=await page.evaluate(()=>window.store.read());assert.equal(next.raw,expected.raw);assert.deepEqual(next.issuedIds,expected.issuedIds);assert.deepEqual(next.committed,expected.committed);assert.equal(next.revision,expected.revision+1);
 if(process.env.PR4_EVIDENCE){await mkdir(process.env.PR4_EVIDENCE,{recursive:true});await page.screenshot({path:process.env.PR4_EVIDENCE+'/ui.png',fullPage:true});}
});
for(const mode of ['quota','abort'])for(const initial of [true,false])test(`native IDB ${mode}, ${initial?'initial versionchange':'existing readwrite'}: no success, original intact, retry`,async t=>{
 const {page}=await open(t);await modules(page);const result=await page.evaluate(async({mode,initial})=>{
 const confirm=(api,p)=>api.commit(p,{confirmed:true,protectedRaw:p.previousRaw,protectedSourceRaw:p.sourceRaw});
 if(!initial)await confirm(api,await api.prepareNewPlan());const previous=await store.read(),p=await api.prepareNewPlan(),before=window.puts.length;window.failure=mode;let error='';try{await confirm(api,p);}catch(e){error=String(e);}window.failure='';const after=await store.read(),names=(await indexedDB.databases()).map(d=>d.name);const failedPuts=window.puts.slice(before);await confirm(api,p);const next=await store.read();return {previous,after,names,error,failedPuts,next,puts:window.puts};
 },{mode,initial});assert.deepEqual(result.after,result.previous);assert.match(result.error,mode==='quota'?/QuotaExceededError|full/:/abort/i);assert.deepEqual(result.failedPuts,[initial?'versionchange':'readwrite']);if(initial)assert.deepEqual(result.names,[]);assert.equal(result.next.revision,result.previous.revision+1);
});
test('native IDB CAS: every field incl coverage/version/closed keys, no lost update, read/put/unknown DB errors',async t=>{
 const {page}=await open(t);await modules(page);const result=await page.evaluate(async()=>{
 const p=await api.prepareNewPlan();await api.commit(p,{confirmed:true,protectedRaw:p.previousRaw,protectedSourceRaw:p.sourceRaw});const original=await store.read(),out=[];
 for(const change of [{revision:2},{raw:'broken'},{committed:[...original.committed,'a'.repeat(64)]},{issuedIds:[...original.issuedIds,'ab000000-0000-4000-8000-000000000001']},{reservationCoverage:{policyVersion:2,kind:'legacy-unproven',baselineStateSha256:'b'.repeat(64)}},{authorityVersion:3},{format:'other'},{unknown:true}]){
  const altered={...original,...change};await store.commit(original,altered);const n=window.puts.length;let error='';try{await store.commit(original,original);}catch(e){error=String(e);}out.push({error,unchanged:JSON.stringify(await store.read())===JSON.stringify(altered),writes:window.puts.length-n});await store.commit(altered,original);
 }
 const get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(){throw new DOMException('read denied','SecurityError');};let read='',write='';try{await store.read();}catch(e){read=String(e);}try{await store.commit(original,original);}catch(e){write=String(e);}IDBObjectStore.prototype.get=get;
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hosei-yi06-isolated-v1',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();let unknown='';try{await store.read();}catch(e){unknown=String(e);}return {out,read,write,unknown,version:(await indexedDB.databases()).find(d=>d.name==='hosei-yi06-isolated-v1').version};
 });for(const item of result.out){assert.match(item.error,/stale_commit/);assert.equal(item.unchanged,true);assert.equal(item.writes,0);}assert.match(result.read,/SecurityError/);assert.match(result.write,/SecurityError/);assert.match(result.unknown,/unsupported_authority_version/);assert.equal(result.version,2);
});
test('two real tabs/sessions: same revision only one wins; lock waiting detects changed checkpoint',async t=>{
 const {page,context}=await open(t);await modules(page);await page.evaluate(async()=>{const p=await api.prepareNewPlan();await api.commit(p,{confirmed:true,protectedRaw:p.previousRaw,protectedSourceRaw:p.sourceRaw});window.p=await api.prepareEdits(await api.load(),[]);});
 const other=await context.newPage();await other.goto(origin+'/__dev/persistence-v2');await other.getByRole('status').filter({hasText:'再読込'}).waitFor();await modules(other);await other.evaluate(async()=>{window.p=await api.prepareEdits(await api.load(),[]);});
 const results=await Promise.all([page,other].map(p=>p.evaluate(async()=>{try{await api.commit(window.p,{confirmed:true,protectedRaw:window.p.previousRaw,protectedSourceRaw:window.p.sourceRaw});return 'success';}catch(e){return String(e);}})));assert.equal(results.filter(x=>x==='success').length,1);assert.equal(results.filter(x=>/stale_commit/.test(x)).length,1);
 await other.evaluate(async()=>{window.p=await api.prepareEdits(await api.load(),[]);});await page.evaluate(async()=>{window.lock=navigator.locks.request('hosei-planner:v1:write',()=>new Promise(r=>window.release=r));while(!window.release)await new Promise(r=>setTimeout(r,5));});
 await other.evaluate(()=>{window.pending=api.commit(window.p,{confirmed:true,protectedRaw:window.p.previousRaw,protectedSourceRaw:window.p.sourceRaw}).then(()=> 'success',e=>String(e));});
 await page.evaluate(async()=>{const s=await store.read();await store.commit(s,{...s,committed:[...s.committed,'f'.repeat(64)]});window.release();await window.lock;});assert.match(await other.evaluate(()=>window.pending),/stale_commit/);await other.close();
});
test('browser Lock absence refuses commit; corrupt raw rescue is readonly with exact digest',async t=>{
 const {page}=await open(t);await modules(page);const result=await page.evaluate(async()=>{const no=factory(undefined),p=await no.prepareNewPlan();let error='';try{await no.commit(p,{confirmed:true,protectedRaw:p.previousRaw,protectedSourceRaw:p.sourceRaw});}catch(e){error=String(e);}const before=window.puts.length;const original={raw:'破損 {\n原文',revision:1,committed:['d'.repeat(64)],issuedIds:[]};await store.commit(await store.read(),original);const saved=window.puts.length;const protection=JSON.parse(await api.protectCurrent());let strict='';try{await api.load();}catch(e){strict=String(e);}return {error,puts:window.puts.slice(0,before),protection,original,strict,rescueWrites:window.puts.length-saved};});
 // factory default must not substitute navigator.locks for explicit undefined.
 assert.match(result.error,/Web Locks/);assert.deepEqual(result.puts,[]);assert.equal(result.protection.currentRaw,result.original.raw);assert.equal(result.protection.sha256.length,64);assert.ok(result.strict);assert.equal(result.rescueWrites,0);
});

test('UI quota failure leaves saved display and raw unchanged, then explicit retry succeeds',async t=>{
 const {page}=await open(t);await page.getByRole('button',{name:'native-v2 新規計画preview'}).click();await page.getByText(/操作: new-plan/).waitFor();await page.evaluate(()=>window.failure='quota');
 const file=page.waitForEvent('download');await page.getByRole('button',{name:'置換前authority・source・選択原文を保護'}).click();await file;await page.getByLabel('保護ファイルと差分を確認し、全件置換を確定する').check();await page.getByRole('button',{name:'確認してv2保存'}).click();await page.getByRole('alert').filter({hasText:/QuotaExceededError/}).waitFor();assert.equal(await page.getByTestId('saved-state').textContent(),'確定表示: なし');assert.deepEqual(await page.evaluate(()=>indexedDB.databases()),[]);
 await page.evaluate(()=>window.failure='');await page.getByRole('button',{name:'確認してv2保存'}).click();await page.getByRole('status').filter({hasText:'隔離保存と正規再読込が完了'}).waitFor();assert.match(await page.getByTestId('saved-state').textContent(),/native-v2-save-authorized/);
});
test('development gate: invalid flag and production refuse new route and direct modules',async()=>{
 for(const [offset,flag,mode] of [[1,'true','development'],[2,'1','production']]){
  const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port+offset),'--strictPort','--mode',mode],{cwd:root,env:{...process.env,YI06_PERSISTENCE:flag,NODE_ENV:mode},stdio:'pipe'});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  try{let ready=false;for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error(log);try{await fetch(`http://127.0.0.1:${port+offset}`);ready=true;break;}catch{}await delay(100);}assert.ok(ready,log);
   for(const path of ['/__dev/persistence-v2','/__dev/persistence-v2?YI06_PERSISTENCE=1','/dev/persistence/v2-main.tsx','/dev/persistence/AuthorityV2Page.tsx','/src/planner/attempts/persistence/persistentSession.ts','/dev%2fpersistence/v2-main.tsx'])assert.equal((await fetch(`http://127.0.0.1:${port+offset}${path}`)).status,404,path);
  }finally{child.kill('SIGTERM');}
 }
});

test('native IDB explicit rule1 migration: original authority protected, legacy coverage retained and normal save refused',async t=>{
 const {page}=await open(t);await modules(page);const original=await page.evaluate(async()=>{
  const {createAttemptPersistence}=await import('/src/planner/attempts/persistence/controller.ts'),old=createAttemptPersistence(store,navigator.locks),p=await old.prepareNewPlan();await old.commit(p,true,p.previousRaw,p.sourceRaw);return store.read();
 });await page.reload();await page.getByRole('status').filter({hasText:'再読込'}).waitFor();await page.getByRole('button',{name:'現在rule1を明示移行preview'}).click();await page.getByText(/操作: migration/).waitFor();
 const protection=page.waitForEvent('download');await page.getByRole('button',{name:'置換前authority・source・選択原文を保護'}).click();const file=await protection;assert.deepEqual(JSON.parse(await readFile(await file.path(),'utf8')).previousAuthority,original);
 await page.getByLabel('保護ファイルと差分を確認し、全件置換を確定する').check();await page.getByRole('button',{name:'確認してv2保存'}).click();await page.getByRole('status').filter({hasText:'隔離保存と正規再読込が完了'}).waitFor();assert.match(await page.getByTestId('saved-state').textContent(),/legacy-unproven/);assert.equal(await page.getByRole('button',{name:'編集を保存preview'}).count(),0);
 await modules(page);const record=await page.evaluate(()=>store.read()),restored=JSON.parse(record.raw);restored.rule.version=1;restored.history.issuedIds=JSON.parse(original.raw).history.issuedIds;assert.deepEqual(restored,JSON.parse(original.raw));assert.equal(record.reservationCoverage.baselineStateSha256,original.committed[0]);assert.ok(record.committed.includes(original.committed[0]));
 await page.getByRole('button',{name:'native-v2 新規計画preview'}).click();await page.getByRole('alert').filter({hasText:/legacy_normal_save_blocked/}).waitFor();assert.deepEqual(await page.evaluate(()=>store.read()),record);
});
test('native portable v4 adoption into a separate empty BrowserContext: inspect zero writes, selected consent, permanent burn reload',async t=>{
 const source=await open(t);await modules(source.page);const backup=await source.page.evaluate(async()=>{
  const save=p=>api.commit(p,{confirmed:true,protectedRaw:p.previousRaw,protectedSourceRaw:p.sourceRaw});let h=await save(await api.prepareNewPlan());const abandoned=api.identities(h).newAssessmentId();h=await save(await api.prepareEdits(h,[]));return {raw:await api.createBackup(h),abandoned,state:h.state};
 });const destination=await open(t),page=destination.page;await page.getByLabel('backup inspect').setInputFiles({name:'portable-v4.json',mimeType:'application/json',buffer:Buffer.from(backup.raw)});await page.getByText('v4 / not-issued').waitFor();assert.deepEqual(await page.evaluate(()=>indexedDB.databases()),[]);assert.deepEqual(await page.evaluate(()=>window.puts),[]);
 await page.getByRole('button',{name:'選択ファイルを復元preview'}).click();await page.getByText(/操作: restore/).waitFor();assert.equal(await page.getByRole('button',{name:'確認してv2保存'}).isDisabled(),true);await saveUI(page);assert.deepEqual(await page.evaluate(()=>window.puts),['versionchange']);
 await page.reload();await page.getByRole('status').filter({hasText:'再読込'}).waitFor();await modules(page);const result=await page.evaluate(async id=>{const h=await api.load(),record=await store.read(),original=crypto.randomUUID;crypto.randomUUID=()=>id;let error='';try{api.identities(h).newOperationId();}catch(e){error=String(e);}finally{crypto.randomUUID=original;}return {state:h.state,ids:record.issuedIds,error};},backup.abandoned);
 assert.deepEqual(result.state,backup.state);assert.ok(result.ids.includes(backup.abandoned));assert.match(result.error,/allocator_exhausted/);
});

test('startup: actions wait for the initial host read so a late load cannot replace a newer saved display',async t=>{
 const {page}=await open(t,true);await page.waitForFunction(()=>typeof window.releaseInitialRead==='function');assert.equal(await page.getByRole('button',{name:'native-v2 新規計画preview'}).isDisabled(),true);await page.evaluate(()=>window.releaseInitialRead());await page.getByRole('status').filter({hasText:'隔離hostは空です'}).waitFor();assert.equal(await page.getByRole('button',{name:'native-v2 新規計画preview'}).isDisabled(),false);
});
