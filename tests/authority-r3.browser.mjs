import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {serveAc} from './ac-static-server.mjs';
import {files,initialState,originalRow,catalog} from './fixtures/migration-fixture.mjs';
import {createPlannerBackup} from '../src/planner/backup/plannerBackup.ts';
const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');
const sha=b=>createHash('sha256').update(b).digest('hex');
let browser,server,dir;
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'f01-r3-'));await cp(process.env.REMEDIATION_DIST||new URL('../../dist-ac',import.meta.url).pathname,dir,{recursive:true});
 const root=process.env.REMEDIATION_SOURCE||new URL('../',import.meta.url).pathname;
 const out=await build({absWorkingDir:root,stdin:{resolveDir:root,contents:`
  import {createPlannerAttemptSession} from './src/planner/attempts/production/session';
  import {createAuthorityIndexedDbStore} from './src/planner/attempts/persistence/authorityIndexedDb';
  import {readLegacySnapshot} from './src/planner/attempts/production/authorityAdmission';
  import {prepareMigrationEnvironment} from './src/planner/attempts/migration/source';
  let env;export function setup(){const store=createAuthorityIndexedDbStore(indexedDB);const api=createPlannerAttemptSession(store,navigator.locks,{readLegacy:()=>readLegacySnapshot(localStorage),migrationEnvironment:()=>env??=prepareMigrationEnvironment(${JSON.stringify(files)})});return{store,api};}
 `},bundle:true,write:false,platform:'browser',format:'esm',logLevel:'silent'});
 await writeFile(join(dir,'r3.bundle.js'),out.outputFiles[0].text);server=await serveAc(dir);browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await server?.close();if(dir)await rm(dir,{recursive:true,force:true});});
async function fresh(t,primary=null){const context=await browser.newContext({acceptDownloads:true});t.after(()=>context.close());const p=await context.newPage();p.setDefaultTimeout(180000);
 await p.addInitScript(primary=>{if(primary!==null){localStorage.setItem('hosei-planner:v1',primary);localStorage.setItem('hosei-planner:v1:recovery','distinct short recovery');}window.puts=0;window.byteReads=0;const put=IDBObjectStore.prototype.put,read=File.prototype.arrayBuffer;IDBObjectStore.prototype.put=function(...a){puts++;return put.apply(this,a);};File.prototype.arrayBuffer=function(){byteReads++;return read.call(this);};},primary);
 await p.goto(server.origin+'/__dev/ac');await p.getByTestId('save-status').filter({hasText:primary===null?'新規計画を開始できます':'旧schema22があります'}).waitFor();return p;}
for(const depth of [8,12,16])test(`R3 native DAG ${depth+1} objects ownKeys linear, put0 and identity preserved`,async t=>{
 const p=await fresh(t);const r=await p.evaluate(async depth=>{
  const m=await import('/r3.bundle.js'),{store}=m.setup();let v={n:1};for(let i=0;i<depth;i++)v={l:v,r:v};
  const db=await new Promise((ok,fail)=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('authority');q.onsuccess=()=>ok(q.result);q.onerror=()=>fail(q.error);});
  await new Promise((ok,fail)=>{const t=db.transaction('authority','readwrite');t.objectStore('authority').put(v,'current');t.oncomplete=ok;t.onabort=()=>fail(t.error);});
  const get=()=>new Promise(ok=>{const t=db.transaction('authority'),q=t.objectStore('authority').get('current');t.oncomplete=()=>ok(q.result);});
  const preserved=node=>{for(let i=0;i<depth;i++){if(node.l!==node.r)return false;node=node.l;}return node.n===1;};const before=preserved(await get());puts=0;
  let count=0,error;const own=Reflect.ownKeys;Reflect.ownKeys=function(...a){count++;return own(...a);};try{await store.protectOriginal();}catch(e){error=e.message;}finally{Reflect.ownKeys=own;}
  const after=preserved(await get());db.close();return{objects:depth+1,ownKeys:count,error,puts,before,after};
 },depth);console.log(JSON.stringify(r));assert.match(r.error,/protection_unrepresentable/);assert.equal(r.puts,0);assert.ok(r.before&&r.after);assert.ok(r.ownKeys<=4*r.objects,String(r.ownKeys));
});
const compact=JSON.stringify(initialState());
const state=initialState();state.importedCourseAchievements=[4,0,null].map((credits,i)=>originalRow({id:'raw-'+i,fingerprint:'fp-'+i,earnedCreditsTotal:credits,categoryRaw:'日本語😀\uFFFD\uFEFF literal 4.0000000000000001'}));const japanese=JSON.stringify(state);
const cases=[['8MiB',compact.padStart(8388608,' '),compact,false],['16MiB-1',compact.padStart(16777215,' '),compact,false],['16MiB',compact.padStart(16777216,' '),compact,false],['16MiB+1',compact.padStart(16777217,' '),compact,false],['tabs',compact.padStart(11000000,'\t'),compact,false],['compact',compact,compact,true],['japanese',japanese,japanese,true]];
for(const [label,raw,primary,accept] of cases)test(`R3 UI ${label} ${accept?'reload and backup':'rejects before put'}`,{timeout:300000},async t=>{await checkUi(t,label,raw,primary,accept);});
test('R3 UI original standard pretty v2 reload and backup',{timeout:300000},async t=>{await checkUi(t,'standard-v2',JSON.stringify(await createPlannerBackup(japanese,catalog),null,2),japanese,true);});
async function checkUi(t,label,raw,primary,accept){
 const p=await fresh(t,primary),bytes=Buffer.from(raw),selectedSha=sha(bytes);await p.getByLabel('旧schema22原文から明示移行').setInputFiles({name:label+'.json',mimeType:'application/json',buffer:bytes});
 const mode=await Promise.race([p.getByRole('alert').waitFor().then(()=>'rejected'),p.getByRole('group',{name:'保存確認',exact:true}).waitFor().then(()=>'preview')]);let protectionSha=null,status='input rejected';
 if(mode==='preview'){assert.equal(await p.evaluate(()=>puts),0);const event=p.waitForEvent('download');await p.getByRole('button',{name:'変更前の原文を保護',exact:true}).click();const download=await event;protectionSha=sha(Buffer.from(JSON.parse(await readFile(await download.path(),'utf8')).sourceRaw));assert.equal(protectionSha,selectedSha);await p.getByLabel('保護ファイルと保存内容を確認しました').check();await p.getByRole('button',{name:'確認して保存',exact:true}).click();await p.getByTestId('save-status').filter({hasText:/保存済み|保存失敗/}).waitFor();status=await p.getByTestId('save-status').innerText();}
 const alerts=await p.getByRole('alert').allTextContents();
 const data=await p.evaluate(async()=>{
  const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');let record=null;
  if((await indexedDB.databases()).some(d=>d.name==='hosei-yi06-isolated-v1'))record=await new Promise(ok=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>{const db=q.result,t=db.transaction('authority'),g=t.objectStore('authority').get('current');t.oncomplete=()=>{db.close();ok(g.result);};};});
  return{puts,byteReads,revision:record?.revision??0,recordBytes:record?new TextEncoder().encode(JSON.stringify(record)).length:0,recordSha:record?await hash(JSON.stringify(record)):null,sourceSha:record?await hash(JSON.parse(record.raw).source.raw):null,primary:localStorage.getItem('hosei-planner:v1'),recovery:localStorage.getItem('hosei-planner:v1:recovery')};
 });
 await p.reload();await p.getByTestId('save-status').filter({hasText:/旧schema22|書込みを停止/}).waitFor();const reloadStatus=await p.getByTestId('save-status').innerText();let freshResult;
 try{freshResult=await p.evaluate(async()=>{const {api}= (await import('/r3.bundle.js')).setup();await api.load();if(!api.graph())return{load:'OK',empty:true};const backup=JSON.parse(await api.createBackup());return{load:'OK',empty:false,backupSchema:backup.state.schemaVersion,sourceRaw:backup.state.source.raw};});}catch(e){freshResult={load:String(e)};}
 console.log(JSON.stringify({label,selectedBytes:bytes.length,selectedSha,protectionSha,status,alerts,puts:data.puts,byteReads:data.byteReads,revision:data.revision,recordBytes:data.recordBytes,recordSha:data.recordSha,sourceSha:data.sourceSha,reloadStatus,freshLoad:freshResult.load,backupSchema:freshResult.backupSchema,legacyUnchanged:data.primary===primary&&data.recovery==='distinct short recovery'}));
 assert.equal(data.primary,primary);assert.equal(data.recovery,'distinct short recovery');assert.equal(freshResult.load,'OK');if(accept){assert.equal(data.puts,1);assert.match(status,/保存済み/);assert.equal(data.sourceSha,selectedSha);assert.equal(freshResult.backupSchema,23);assert.equal(freshResult.sourceRaw,raw);}else{assert.equal(data.puts,0);assert.match(alerts.join(' '),/unreadable|input_limit|capacity_limit/);assert.equal(data.revision,0);assert.equal(data.recordSha,null);assert.equal(freshResult.empty,true);assert.doesNotMatch(status,/保存済み/);if(label==='16MiB+1')assert.equal(data.byteReads,0);}
}
