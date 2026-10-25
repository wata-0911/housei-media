import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const root = new URL('../', import.meta.url).pathname;
const port = Number(process.env.YI06_BROWSER_PORT || 4206), origin = `http://127.0.0.1:${port}`;
const servers=[], caches=[]; let browser;
async function server(p, flag, mode='development') {
  const cacheDir=await mkdtemp(join(tmpdir(),'yi06-vite-')); caches.push(cacheDir);
  const code=`import {createServer} from 'vite'; const s=await createServer(${JSON.stringify({mode,cacheDir,server:{host:'127.0.0.1',port:p,strictPort:true}})}); await s.listen();`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:root,env:{...process.env,YI06_PERSISTENCE:flag,YI05_WORKBENCH:'',NODE_ENV:mode==='production'?'production':'development'},stdio:'pipe'});
  servers.push(child); let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  for(let i=0;i<150;i++){if(child.exitCode!==null)throw new Error(output);try{if((await fetch(`http://127.0.0.1:${p}`,{headers:{Connection:'close'}})).ok)return;}catch(e){if(i===149)output+=String(e)+String(e.cause);}await delay(200);}throw new Error(output);
}
before(async()=>{await server(port,'1');await server(port+1,'true');await server(port+2,'1','production');await server(port+3,'1');
  const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true,...(process.env.PLANNER_BROWSER_EXECUTABLE?{executablePath:process.env.PLANNER_BROWSER_EXECUTABLE}:{})});});
after(async()=>{await browser?.close();servers.forEach(s=>s.kill('SIGTERM'));await Promise.all(caches.map(p=>rm(p,{recursive:true,force:true})));});
async function open(t,width=1280,base=origin){const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
  await context.addInitScript(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
    set.call(localStorage,'hosei-planner:v1','primary original \n  bytes');set.call(localStorage,'hosei-planner:v1:recovery','recovery original');window.calls=[];
    for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.calls.push(name);throw new Error('legacy storage forbidden');};
    window.originalBytes=()=>[get.call(localStorage,'hosei-planner:v1'),get.call(localStorage,'hosei-planner:v1:recovery')];});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`${base}/__dev/persistence`,{timeout:120000,waitUntil:'domcontentloaded'});
  await page.getByRole('status').waitFor({timeout:120000});
  t.after(async()=>{try{assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.calls),[]);assert.deepEqual(await page.evaluate(()=>window.originalBytes()),['primary original \n  bytes','recovery original']);}finally{await context.close();}});return {page,context};}
async function confirm(page){const download=page.waitForEvent('download');await page.getByRole('button',{name:'置換前原文・移行元を保護ファイルに保存'}).click();await download;
  const adoption=page.getByLabel('発行者が認証されていないことを理解し、選択したバックアップを復旧元として採用します');if(await adoption.count())await adoption.check();
  await page.getByLabel('保護ファイルの保存先と比較内容を確認し、隔離保存の全件置換に同意します').check();await page.getByRole('button',{name:'確認して隔離保存'}).click();
  await page.getByRole('status').filter({hasText:'隔離保存が完了'}).waitFor({timeout:60000});}
async function migrate(page){await page.getByRole('button',{name:'fixtureを移行preview'}).click();await page.getByText('移行結果: ready',{exact:true}).waitFor({timeout:60000});await confirm(page);}
async function save(page){await page.getByRole('button',{name:'編集の保存preview'}).click();await page.getByRole('button',{name:'確認して隔離保存'}).waitFor({timeout:60000});await confirm(page);}
async function add(page){await page.getByRole('button',{name:'新しい履修回',exact:true}).click();const form=page.getByRole('form',{name:'新規履修回'});await form.getByLabel('未確定科目の名称').fill('2035年の履修回');await form.getByLabel('予定年度',{exact:true}).fill('2035');await form.getByRole('button',{name:'新規Attemptを追加'}).click();await form.waitFor({state:'detached'});}
async function rawState(page){return page.evaluate(async()=>{const {createIndexedDbAttemptStore}=await import('/src/planner/attempts/persistence/indexedDb.ts');return JSON.parse((await createIndexedDbAttemptStore(indexedDB).read()).raw);});}

test('gate: invalid flag/query/direct modules and production serve refuse',async()=>{for(const p of [port+1,port+2])for(const path of ['/__dev/persistence','/__dev/persistence?YI06_PERSISTENCE=1','/dev/persistence/main.tsx','/src/planner/attempts/persistence/controller.ts','/src/planner/attempts/persistence/newPlan.ts','/dev%2fpersistence/main.tsx',`/@fs${root}dev/persistence/main.tsx`])assert.equal((await fetch(`http://127.0.0.1:${p}${path}`,{headers:{Connection:'close'}})).status,404);});
for(const width of [1280,390])test(`Chromium ${width}px: migration, reload, CRUD, backup file and repeated replacement`,async t=>{
  const {page}=await open(t,width);await migrate(page);const first=await rawState(page);await page.reload();await page.getByRole('status').filter({hasText:'再検証して読み込み'}).waitFor({timeout:60000});
  assert.deepEqual(await rawState(page),first);await add(page);await save(page);await page.reload();await page.getByRole('heading',{name:'履修計画 / active 2件'}).waitFor({timeout:60000});
  const card=page.locator('[data-attempt-id]').last();await card.getByRole('button',{name:'予定を編集'}).click();const form=page.getByRole('form',{name:'Attempt編集'});await form.getByLabel('予定年度',{exact:true}).fill('2040');await form.getByRole('button',{name:'編集をメモリに反映'}).click();await form.waitFor({state:'detached'});await save(page);
  const expected=await rawState(page);const pending=page.waitForEvent('download');await page.getByRole('button',{name:'確定状態の新backupを書き出す'}).click();const download=await pending;const backup=await readFile(await download.path());
  assert.equal(JSON.parse(backup).format,'hosei-attempt-backup');await page.locator('[data-attempt-id]').last().getByRole('button',{name:'計画から削除'}).click();await save(page);
  for(let i=0;i<2;i++){await page.getByLabel('新backupファイル').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:backup});await page.getByText(/操作: restore/).waitFor({timeout:60000});await confirm(page);assert.deepEqual(await rawState(page),expected);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  if(process.env.YI06_SCREENSHOT_DIR){await mkdir(process.env.YI06_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.YI06_SCREENSHOT_DIR,`${width}.png`),fullPage:true});}
});
test('fresh-origin preview and cancel create no persistent DB',async t=>{const {page}=await open(t);const names=()=>page.evaluate(async()=>(await indexedDB.databases()).map(db=>db.name));assert.deepEqual(await names(),[]);await page.getByRole('button',{name:'fixtureを移行preview'}).click();await page.getByText('移行結果: ready',{exact:true}).waitFor({timeout:60000});assert.deepEqual(await names(),[]);await page.getByRole('button',{name:'取消（保存しない）'}).click();assert.deepEqual(await names(),[]);});
test('real reload preserves deletion order, original owner and undo snapshots',async t=>{const {page}=await open(t);await migrate(page);await add(page);await save(page);const original=await rawState(page);const ids=original.graph.attempts.map(a=>a.id);
  for(const id of ids)await page.locator(`[data-attempt-id="${id}"]`).getByRole('button',{name:'計画から削除'}).click();await save(page);await page.reload();await page.getByRole('heading',{name:'履修計画 / active 0件'}).waitFor({timeout:60000});
  await page.locator(`[data-attempt-id="${ids[0]}"]`).getByRole('button',{name:'このAttemptをUndo'}).click();await page.getByRole('alert').filter({hasText:'undo_order_conflict'}).waitFor();
  for(const id of [...ids].reverse())await page.locator(`[data-attempt-id="${id}"]`).getByRole('button',{name:'このAttemptをUndo'}).click();await save(page);
  const next=await rawState(page);assert.deepEqual(next.graph.ownedRecords,original.graph.ownedRecords);assert.deepEqual(next.graph.attempts.filter(a=>a.membership.kind==='active').map(a=>a.id),ids);
});
for(const fixture of ['held-day','held-month'])test(`real explicit correction ${fixture} preserves old raw through reload`,async t=>{const {page}=await open(t);await page.getByLabel('移行fixture').selectOption(fixture);await page.getByRole('button',{name:'fixtureを移行preview'}).click();await page.getByText('移行結果: held',{exact:true}).waitFor({timeout:60000});const original=await page.getByTestId('source-original').textContent();
  await page.getByRole('button',{name:'修正案を比較',exact:true}).click();await page.getByLabel('原値・修正案・新IDを確認しました').check();await page.getByRole('button',{name:'確認した日付を再decode'}).click();await page.getByText('移行結果: ready',{exact:true}).waitFor({timeout:60000});await confirm(page);await page.reload();await page.getByRole('status').filter({hasText:'再検証して読み込み'}).waitFor({timeout:60000});assert.equal((await rawState(page)).corrections[0].originalRaw,original);
});
test('two tabs: queued stale commit rejects under native Web Lock',async t=>{const {page,context}=await open(t);await migrate(page);const other=await context.newPage();await other.goto(`${origin}/__dev/persistence`);await other.getByRole('status').waitFor({timeout:60000});
  await page.evaluate(async()=>{window.releaseLock=null;window.lockDone=navigator.locks.request('hosei-planner:v1:write',()=>new Promise(r=>window.releaseLock=r));while(!window.releaseLock)await new Promise(r=>setTimeout(r,5));});
  await other.getByRole('button',{name:'編集の保存preview'}).click();await other.getByRole('button',{name:'確認して隔離保存'}).waitFor({timeout:60000});const d=other.waitForEvent('download');await other.getByRole('button',{name:'置換前原文・移行元を保護ファイルに保存'}).click();await d;await other.getByLabel('保護ファイルの保存先と比較内容を確認し、隔離保存の全件置換に同意します').check();await other.getByRole('button',{name:'確認して隔離保存'}).click();
  // Simulate a writer that already owns this same native lock, using the atomic adapter.
  await page.evaluate(async()=>{const {createIndexedDbAttemptStore}=await import('/src/planner/attempts/persistence/indexedDb.ts');const store=createIndexedDbAttemptStore(indexedDB),s=await store.read();await store.commit(s,{...s,revision:s.revision+1});window.releaseLock();await window.lockDone;});
  await other.getByRole('alert').filter({hasText:'stale_commit'}).waitFor({timeout:60000});await other.close();
});
for(const mode of ['quota','no-lock'])test(`real browser ${mode}: failure leaves original state and no success notice`,async t=>{const {page}=await open(t);await migrate(page);const original=await rawState(page);
  if(mode==='quota'){await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError');};});await add(page);await page.getByRole('button',{name:'編集の保存preview'}).click();await page.getByRole('button',{name:'確認して隔離保存'}).waitFor({timeout:60000});const d=page.waitForEvent('download');await page.getByRole('button',{name:'置換前原文・移行元を保護ファイルに保存'}).click();await d;await page.getByLabel('保護ファイルの保存先と比較内容を確認し、隔離保存の全件置換に同意します').check();await page.getByRole('button',{name:'確認して隔離保存'}).click();await page.getByRole('alert').filter({hasText:'QuotaExceededError'}).waitFor({timeout:60000});}
  else await page.evaluate(async()=>{const {createAttemptPersistence}=await import('/src/planner/attempts/persistence/controller.ts');const {createIndexedDbAttemptStore}=await import('/src/planner/attempts/persistence/indexedDb.ts');const {loadMigrationEnvironment}=await import('/dev/attempts/fixtures.ts');const api=createAttemptPersistence(createIndexedDbAttemptStore(indexedDB),undefined,await loadMigrationEnvironment());const h=await api.load(),p=await api.prepareEdits(h,[]);try{await api.commit(p,true,p.previousRaw,p.sourceRaw);throw new Error('unexpected success');}catch(e){if(!String(e).includes('Web Locks'))throw e;}});
  assert.deepEqual(await rawState(page),original);
});
test('corrupt saved original stays intact and can be protected after reload refusal',async t=>{const {page}=await open(t);await migrate(page);const original='{ broken JSON \n 原文';await page.evaluate(async raw=>{const {createIndexedDbAttemptStore}=await import('/src/planner/attempts/persistence/indexedDb.ts');const store=createIndexedDbAttemptStore(indexedDB),s=await store.read();await store.commit(s,{...s,raw});},original);await page.reload();await page.getByRole('alert').filter({hasText:'再読込拒否'}).waitFor({timeout:60000});
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'現在の隔離保存原文を保護（検証失敗時も可）'}).click();const file=await pending,body=JSON.parse(await readFile(await file.path(),'utf8'));assert.equal(body.currentRaw,original);assert.equal(body.sha256.length,64);assert.equal(body.committed,undefined);
});

let portableFixturePromise;
async function portableFixture(t){return portableFixturePromise??= (async()=>{
 const {page}=await open(t);await migrate(page);await add(page);await add(page);await save(page);
 const deleted=await page.evaluate(async()=>{
  const {createAttemptPersistence}=await import('/src/planner/attempts/persistence/controller.ts');const {createIndexedDbAttemptStore}=await import('/src/planner/attempts/persistence/indexedDb.ts');const {loadMigrationEnvironment}=await import('/dev/attempts/fixtures.ts');const {newRecordId,newOperationId}=await import('/src/planner/attempts/workbench/operations.ts');
  const api=createAttemptPersistence(createIndexedDbAttemptStore(indexedDB),navigator.locks,await loadMigrationEnvironment()),h=await api.load();
  const record={id:newRecordId(),kind:'todo',owner:null,payload:{id:crypto.randomUUID(),text:'portable deleted TODO',done:false}},commands=[{kind:'add_record',operationId:newOperationId(),record},{kind:'delete_todo',operationId:newOperationId(),recordId:record.id}];
  const p=await api.prepareEdits(h,commands);await api.commit(p,true,p.previousRaw,p.sourceRaw);return record;
 });
 await page.reload();await page.getByRole('status').filter({hasText:'再検証して読み込み'}).waitFor({timeout:60000});const beforeDeletion=await rawState(page),ids=beforeDeletion.graph.attempts.filter(a=>a.membership.kind==='active').map(a=>a.id);
 for(const id of ids)await page.locator(`[data-attempt-id="${id}"]`).getByRole('button',{name:'計画から削除'}).click();await save(page);
 const state=await rawState(page),pending=page.waitForEvent('download');await page.getByRole('button',{name:'確定状態の新backupを書き出す'}).click();const file=await pending,backup=await readFile(await file.path());
 assert.equal(JSON.parse(backup).backupVersion,2);return {backup,state,beforeDeletion,ids,deleted};
})();}
async function selectPortable(page,backup){await page.getByLabel('新backupファイル').setInputFiles({name:'portable.json',mimeType:'application/json',buffer:backup});await page.getByText(/操作: restore/).waitFor({timeout:60000});}
async function dbNames(page){return page.evaluate(async()=>(await indexedDB.databases()).map(db=>db.name));}
async function storeSnapshot(page){return page.evaluate(async()=>{const {createIndexedDbAttemptStore}=await import('/src/planner/attempts/persistence/indexedDb.ts');return createIndexedDbAttemptStore(indexedDB).read();});}

test('portable A to empty B on another origin: explicit adoption, atomic initialization, reload, repeat, IDs and LIFO',async t=>{
 const fixture=await portableFixture(t),{page}=await open(t,390,`http://127.0.0.1:${port+3}`);assert.deepEqual(await dbNames(page),[]);
 await page.evaluate(()=>{window.putModes=[];const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){window.putModes.push(this.transaction.mode);return put.apply(this,args);};});
 await selectPortable(page,fixture.backup);assert.deepEqual(await dbNames(page),[]);assert.equal(await page.getByRole('button',{name:'確認して隔離保存'}).isDisabled(),true);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'置換前原文・移行元を保護ファイルに保存'}).click();const file=await pending,protectedBody=JSON.parse(await readFile(await file.path(),'utf8'));
 assert.equal(protectedBody.previousRaw,null);assert.equal(protectedBody.backupRaw,fixture.backup.toString());
 await page.getByLabel('保護ファイルの保存先と比較内容を確認し、隔離保存の全件置換に同意します').check();assert.equal(await page.getByRole('button',{name:'確認して隔離保存'}).isDisabled(),true);assert.deepEqual(await dbNames(page),[]);
 await page.getByLabel('発行者が認証されていないことを理解し、選択したバックアップを復旧元として採用します').check();await page.getByRole('button',{name:'確認して隔離保存'}).click();await page.getByRole('status').filter({hasText:'隔離保存が完了'}).waitFor({timeout:60000});
 assert.deepEqual(await page.evaluate(()=>window.putModes),['versionchange']);assert.deepEqual(await rawState(page),fixture.state);
 await page.reload();await page.getByRole('status').filter({hasText:'再検証して読み込み'}).waitFor({timeout:60000});assert.deepEqual(await rawState(page),fixture.state);
 await selectPortable(page,fixture.backup);await confirm(page);assert.deepEqual(await rawState(page),fixture.state);
 const before=await storeSnapshot(page);
 const rejection=await page.evaluate(async record=>{const {createAttemptPersistence}=await import('/src/planner/attempts/persistence/controller.ts');const {createIndexedDbAttemptStore}=await import('/src/planner/attempts/persistence/indexedDb.ts');const {loadMigrationEnvironment}=await import('/dev/attempts/fixtures.ts');const {newRecordId,newOperationId}=await import('/src/planner/attempts/workbench/operations.ts');const api=createAttemptPersistence(createIndexedDbAttemptStore(indexedDB),navigator.locks,await loadMigrationEnvironment()),h=await api.load();try{await api.prepareEdits(h,[{kind:'add_record',operationId:newOperationId(),record:{...record,id:newRecordId()}}]);return 'unexpected acceptance';}catch(e){return String(e);}},fixture.deleted);
 assert.match(rejection,/historical_id_reused/);assert.deepEqual(await storeSnapshot(page),before);
 await page.locator(`[data-attempt-id="${fixture.ids[0]}"]`).getByRole('button',{name:'このAttemptをUndo'}).click();await page.getByRole('alert').filter({hasText:'undo_order_conflict'}).waitFor();
 for(const id of [...fixture.ids].reverse())await page.locator(`[data-attempt-id="${id}"]`).getByRole('button',{name:'このAttemptをUndo'}).click();await save(page);
 const restored=await rawState(page);assert.deepEqual(restored.graph,fixture.beforeDeletion.graph);assert.deepEqual(restored.retained,fixture.state.retained);assert.deepEqual(restored.source,fixture.state.source);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.YI06_SCREENSHOT_DIR){await page.screenshot({path:join(process.env.YI06_SCREENSHOT_DIR,'portable-390.png'),fullPage:true});}
 const reservations=(await storeSnapshot(page)).issuedIds;
 await add(page);await save(page);await page.reload();await page.getByRole('status').filter({hasText:'再検証して読み込み'}).waitFor({timeout:60000});
 const afterNewAttempt=await storeSnapshot(page);for(const id of reservations)assert.ok(afterNewAttempt.issuedIds.includes(id),id);
 for(const id of JSON.parse(fixture.backup).reservedIds)assert.ok(afterNewAttempt.issuedIds.includes(id),id);
});
test('P2 source/catalog omissions and namespace aliases refuse rehashed files in Chromium',async t=>{
 const fixture=await portableFixture(t),{page}=await open(t),backup=JSON.parse(fixture.backup);
 const {referencedUuids}=await import('../src/planner/attempts/persistence/identity.ts');const {backupDigest}=await import('../src/planner/backup/plannerBackupCompatibility.ts');
 const oldCatalog=referencedUuids(fixture.state.source.catalog),source=referencedUuids(JSON.parse(fixture.state.source.raw));
 const institutional=await page.evaluate(async()=>{const {loadMigrationEnvironment}=await import('/dev/attempts/fixtures.ts');return (await loadMigrationEnvironment()).catalog;});
 const institutionalOnly=[...referencedUuids(institutional)].find(id=>!oldCatalog.has(id)&&!source.has(id));assert.ok(institutionalOnly);
 for(const id of referencedUuids([fixture.state.source.catalog,institutional]))assert.ok(backup.reservedIds.includes(id),id);
 const ids=[institutionalOnly,[...source][0],fixture.state.assignments.attempts[0].attemptId,fixture.state.history.commands[0].operationId,fixture.deleted.payload.id];
 for(const [index,id] of [...ids,institutionalOnly].entries()){
  const body={...backup,reservedIds:backup.reservedIds.filter(value=>value!==id)};delete body.sha256;
  if(index===ids.length)body.reservedIds.push(`hosei:owned:${id}`);
  const raw=JSON.stringify({...body,sha256:await backupDigest(body)});
  await page.getByLabel('新backupファイル').setInputFiles({name:'missing-reservation.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await page.getByRole('alert').filter({hasText:index===ids.length?'reservation_uuid_collision':'backup_reservations_missing'}).waitFor({timeout:60000});
  assert.deepEqual(await dbNames(page),[]);assert.equal(await page.getByRole('button',{name:'確認して隔離保存'}).count(),0);
 }
});
test('portable malformed, rehashed receipt, raw archive and future version refuse with empty DB',async t=>{
 const fixture=await portableFixture(t),{page}=await open(t);const {backupDigest}=await import('../src/planner/backup/plannerBackupCompatibility.ts');
 // Selecting a bad file must invalidate a previously valid, uncommitted preview.
 await selectPortable(page,fixture.backup);
 for(const mutate of [b=>b.sha256='0'.repeat(64),b=>b.state.history.commands.push({...b.state.history.commands.at(-1),operationId:'hosei:attempt-op:'+crypto.randomUUID(),attemptId:'hosei:attempt:'+crypto.randomUUID()}),b=>b.state.source.rawFiles[Object.keys(b.state.source.rawFiles)[0]]+=' ',b=>b.backupVersion=999,b=>b.state.catalog.metadata.sourceLinksReverified=true]){
  const value=JSON.parse(fixture.backup);mutate(value);if(value.sha256!=='0'.repeat(64)){const {sha256,...body}=value;void sha256;value.sha256=await backupDigest(body);}
  await page.getByLabel('新backupファイル').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await page.getByRole('alert').waitFor({timeout:60000});
  assert.equal(await page.getByRole('button',{name:'確認して隔離保存'}).count(),0);assert.deepEqual(await dbNames(page),[]);assert.equal((await storeSnapshot(page)).raw,null);
 }
});
for(const mode of ['quota','no-lock'])test(`portable empty DB ${mode}: no partial database, raw or witness`,async t=>{
 const fixture=await portableFixture(t),{page,context}=await open(t);
 if(mode==='no-lock'){await context.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));await page.reload();await page.getByRole('status').waitFor({timeout:60000});}
 await selectPortable(page,fixture.backup);const original=await storeSnapshot(page);
 if(mode==='quota')await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('injected full','QuotaExceededError');};});
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'置換前原文・移行元を保護ファイルに保存'}).click();await pending;
 await page.getByLabel('発行者が認証されていないことを理解し、選択したバックアップを復旧元として採用します').check();await page.getByLabel('保護ファイルの保存先と比較内容を確認し、隔離保存の全件置換に同意します').check();await page.getByRole('button',{name:'確認して隔離保存'}).click();
 await page.getByRole('alert').filter({hasText:mode==='quota'?'QuotaExceededError':'Web Locks'}).waitFor({timeout:60000});assert.deepEqual(await dbNames(page),[]);assert.deepEqual(await storeSnapshot(page),original);assert.equal(await page.getByText(/隔離保存が完了/).count(),0);
});
test('portable queued commit rejects a concurrent first writer and preserves its exact raw',async t=>{
 const fixture=await portableFixture(t),{page,context}=await open(t);await selectPortable(page,fixture.backup);
 const other=await context.newPage();await other.goto(`${origin}/__dev/persistence`);await other.getByRole('status').waitFor({timeout:60000});
 await other.evaluate(async()=>{window.lockDone=navigator.locks.request('hosei-planner:v1:write',()=>new Promise(r=>window.releaseLock=r));while(!window.releaseLock)await new Promise(r=>setTimeout(r,5));});
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'置換前原文・移行元を保護ファイルに保存'}).click();await pending;
 await page.getByLabel('発行者が認証されていないことを理解し、選択したバックアップを復旧元として採用します').check();await page.getByLabel('保護ファイルの保存先と比較内容を確認し、隔離保存の全件置換に同意します').check();await page.getByRole('button',{name:'確認して隔離保存'}).click();
 const winner=await other.evaluate(async backup=>{const {createIndexedDbAttemptStore}=await import('/src/planner/attempts/persistence/indexedDb.ts');const {backupDigest}=await import('/src/planner/backup/plannerBackupCompatibility.ts');const store=createIndexedDbAttemptStore(indexedDB),current=await store.read(),value=JSON.parse(backup),next={raw:JSON.stringify(value.state,null,2),revision:1,committed:[await backupDigest(value.state)],issuedIds:value.reservedIds};await store.commit(current,next);window.releaseLock();await window.lockDone;return next;},fixture.backup.toString());
 await page.getByRole('alert').filter({hasText:'stale_commit'}).waitFor({timeout:60000});assert.deepEqual(await storeSnapshot(page),winner);await other.close();
});

for (const width of [1280,390]) test(`new source ${width}: empty preview, seeded Placement search, explicit save, reload and portable v3`, async t => {
  const { page } = await open(t,width);
  await page.getByRole('button',{name:'新しい空の履修計画の初期化preview'}).click();
  await page.getByText(/操作: new-plan/).waitFor({timeout:60000});
  assert.deepEqual(await dbNames(page),[]);
  assert.equal(await page.getByRole('button',{name:'確認して隔離保存'}).isDisabled(),true);
  await page.getByText('初期状態・出典・公式数量・非Attempt情報・対応台帳',{exact:true}).click();
  await page.getByText(/"origin": "new-plan"/).waitFor();
  await page.getByRole('button',{name:'この新規状態を未保存draftとして採用して編集',exact:true}).click();
  await page.getByRole('heading',{name:'履修計画 / active 0件',exact:true}).waitFor();
  assert.deepEqual(await dbNames(page),[]);assert.equal((await storeSnapshot(page)).raw,null);
  const {loadYi01InstitutionalCatalog}=await import('../src/planner/institutional/yi01.ts');
  const {createInstitutionalSearchAdapter}=await import('../src/planner/institutional/search.ts');
  const {CURRENT_CURRICULUM_SEARCH_TARGET}=await import('../src/planner/institutional/currentSearch.ts');
  const rows=createInstitutionalSearchAdapter(loadYi01InstitutionalCatalog(),CURRENT_CURRICULUM_SEARCH_TARGET).search({scope:{kind:'all'}}).rows;
  for (const status of ['safe','ambiguous','conflict','safe']) {
    const row=rows.find(r=>r.placement.kind==='course_placement'&&r.placement.identityDecision.status===status);
    await page.getByRole('button',{name:'新しい履修回',exact:true}).click();
    const form=page.getByRole('form',{name:'新規履修回'});
    await form.getByRole('region',{name:'制度Placement検索'}).waitFor();
    await form.getByLabel('制度科目を検索',{exact:true}).fill(row.placement.officialName);
    await form.getByLabel('制度科目を検索',{exact:true}).press('Enter');
    assert.equal((await storeSnapshot(page)).raw,null);
    await form.getByRole('button',{name:`この配置を選択: ${row.placement.officialName} / ${row.scope.officialScopeLabel} / ${row.placement.placementRoleKey}`,exact:true}).click();
    await form.getByRole('button',{name:'新規Attemptを追加',exact:true}).click();await form.waitFor({state:'detached'});
  }
  assert.equal((await storeSnapshot(page)).raw,null);await save(page);
  const added=await rawState(page),ids=added.graph.attempts.map(a=>a.id);assert.equal(new Set(ids).size,4);
  assert.deepEqual(added.graph.attempts.map(a=>a.identity.status),['confirmed','ambiguous','conflict','confirmed']);
  const first=page.locator(`[data-attempt-id="${ids[0]}"]`);
  await first.getByRole('button',{name:'予定を編集',exact:true}).click();
  const edit=page.getByRole('form',{name:'Attempt編集'});await edit.getByLabel('予定年度',{exact:true}).fill('2032');await edit.getByRole('button',{name:'編集をメモリに反映'}).click();
  await first.getByText('このAttemptの進捗・評価（方式を問わず保持）',{exact:true}).click();
  await first.getByRole('button',{name:'科目評価を開始',exact:true}).click();await first.getByLabel('最終評価',{exact:true}).selectOption('A');
  await first.getByRole('button',{name:'科目評価をメモリに反映'}).click();
  const todo=page.getByRole('form',{name:'TODO追加'});await todo.getByLabel('新しいTODO').fill('新規source TODO');await todo.getByLabel('追加先owner').selectOption(ids[0]);await todo.getByRole('button',{name:'TODOを追加',exact:true}).click();
  await save(page);const beforeDelete=await rawState(page);
  for (const id of ids.slice(0,2)) await page.locator(`[data-attempt-id="${id}"]`).getByRole('button',{name:'計画から削除',exact:true}).click();
  await save(page);await page.reload();await page.getByRole('status').filter({hasText:'再検証して読み込み'}).waitFor({timeout:60000});
  const expected=await rawState(page);assert.equal(expected.graph.removals.length,2);assert.deepEqual(expected.graph.ownedRecords,beforeDelete.graph.ownedRecords);
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'確定状態の新backupを書き出す'}).click();const file=await pending,backup=await readFile(await file.path());assert.equal(JSON.parse(backup).backupVersion,3);
  const {page:other}=await open(t,width,`http://127.0.0.1:${port+3}`);await selectPortable(other,backup);assert.deepEqual(await dbNames(other),[]);
  const protection=other.waitForEvent('download');await other.getByRole('button',{name:'置換前原文・移行元を保護ファイルに保存'}).click();await protection;
  await other.getByLabel('保護ファイルの保存先と比較内容を確認し、隔離保存の全件置換に同意します').check();assert.equal(await other.getByRole('button',{name:'確認して隔離保存'}).isDisabled(),true);
  await other.getByLabel('発行者が認証されていないことを理解し、選択したバックアップを復旧元として採用します').check();await other.getByRole('button',{name:'確認して隔離保存'}).click();await other.getByRole('status').filter({hasText:'隔離保存が完了'}).waitFor({timeout:60000});
  assert.deepEqual(await rawState(other),expected);await other.reload();await other.getByRole('status').filter({hasText:'再検証して読み込み'}).waitFor({timeout:60000});assert.deepEqual(await rawState(other),expected);
  await other.locator(`[data-attempt-id="${ids[0]}"]`).getByRole('button',{name:'このAttemptをUndo'}).click();await other.getByRole('alert').filter({hasText:'undo_order_conflict'}).waitFor();
  for(const id of ids.slice(0,2).reverse())await other.locator(`[data-attempt-id="${id}"]`).getByRole('button',{name:'このAttemptをUndo'}).click();await save(other);assert.deepEqual((await rawState(other)).graph,beforeDelete.graph);
  assert.equal(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  // A new empty preview cannot silently replace a populated saved plan.
  await other.getByRole('button',{name:'新しい空の履修計画の初期化preview'}).click();await other.getByText(/操作: new-plan/).waitFor();assert.deepEqual((await rawState(other)).graph,beforeDelete.graph);
  await other.getByRole('button',{name:'取消（保存しない）'}).click();assert.deepEqual((await rawState(other)).graph,beforeDelete.graph);
});

for(const failure of ['quota','abort'])test(`new source atomic initialization ${failure}: empty DB preserved`,async t=>{
  const {page}=await open(t);await page.getByRole('button',{name:'新しい空の履修計画の初期化preview'}).click();await page.getByText(/操作: new-plan/).waitFor();
  await page.evaluate(mode=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(mode==='quota')throw new DOMException('full','QuotaExceededError');const request=original.apply(this,args);this.transaction.abort();return request;};},failure);
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'置換前原文・移行元を保護ファイルに保存'}).click();await pending;await page.getByLabel('保護ファイルの保存先と比較内容を確認し、隔離保存の全件置換に同意します').check();await page.getByRole('button',{name:'確認して隔離保存'}).click();await page.getByRole('alert').waitFor();assert.deepEqual(await dbNames(page),[]);assert.equal((await storeSnapshot(page)).raw,null);assert.equal(await page.getByText(/隔離保存が完了/).count(),0);
});
