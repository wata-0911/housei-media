import test from 'node:test';
import assert from 'node:assert/strict';
import {serveAc} from './ac-static-server.mjs';
import {initialState,mixed,catalog} from './fixtures/migration-fixture.mjs';
import {createPlannerBackup} from '../src/planner/backup/plannerBackup.ts';
const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');
const raw=JSON.stringify(initialState());
async function setup(t){
 const server=await serveAc(process.env.REMEDIATION_DIST||new URL('../../dist-ac',import.meta.url).pathname);
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLANNER_BROWSER_EXECUTABLE});
 const context=await browser.newContext({acceptDownloads:true});t.after(async()=>{await context.close();await browser.close();await server.close();});
 const p=await context.newPage();p.setDefaultTimeout(90000);p.on('dialog',d=>d.accept());
 await p.addInitScript(()=>{window.puts=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){window.puts++;return put.apply(this,a);};
  const bytes=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){if(this.name.startsWith('slow'))return new Promise((ok,fail)=>{window.releaseFile=()=>this.name.includes('fail')?fail(Error('obsolete read failure')):bytes.call(this).then(ok,fail);});return bytes.call(this);};});
 await p.goto(server.origin+'/__dev/ac');await p.getByTestId('save-status').filter({hasText:'新規計画を開始できます'}).waitFor();return p;
}
const picker=p=>p.getByLabel('旧schema22原文から明示移行');
const choose=(p,name,value)=>picker(p).setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(value)});
const confirmation=p=>p.getByRole('group',{name:'保存確認',exact:true});
async function confirm(p){const d=p.waitForEvent('download');await p.getByRole('button',{name:'変更前の原文を保護',exact:true}).click();await d;await p.getByLabel('保護ファイルと保存内容を確認しました').check();await p.getByRole('button',{name:'確認して保存',exact:true}).click();await p.getByTestId('save-status').filter({hasText:'保存済み'}).waitFor();}
async function record(p){return p.evaluate(()=>new Promise((ok,fail)=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>{const db=q.result,tx=db.transaction('authority'),get=tx.objectStore('authority').get('current');tx.oncomplete=()=>{db.close();ok(get.result);};tx.onabort=()=>fail(tx.error);};q.onerror=()=>fail(q.error);}));}
for(const latestValid of [false,true])test(`R5 slow ${latestValid?'failure':'success'} → fast ${latestValid?'success':'failure'} only latest input`,{timeout:240000},async t=>{
 const p=await setup(t);await choose(p,latestValid?'slow-fail.json':'slow-valid.json',raw);await p.waitForFunction(()=>!!window.releaseFile);
 const latest=' \n'+raw+'\r\n';await choose(p,'latest.json',latestValid?latest:'{broken');if(latestValid)await confirmation(p).waitFor();else await p.getByRole('alert').waitFor();
 await p.evaluate(async()=>{releaseFile();await new Promise(r=>setTimeout(r,1000));});
 if(latestValid){await confirmation(p).waitFor();assert.equal(await p.getByRole('alert').count(),0);await confirm(p);assert.equal(JSON.parse((await record(p)).raw).source.raw,latest);assert.equal(await p.evaluate(()=>window.puts),1);}
 else{assert.equal(await confirmation(p).count(),0);assert.equal(await p.evaluate(()=>window.puts),0);assert.deepEqual(await p.evaluate(()=>indexedDB.databases()),[]);}
});
for(const operation of ['reload','cancel-input','cancel-native','unmount'])test(`R5 pending success invalidated by ${operation}`,{timeout:240000},async t=>{
 const p=await setup(t);await choose(p,'slow-valid.json',raw);await p.waitForFunction(()=>!!window.releaseFile);
 if(operation==='reload'){await p.getByRole('button',{name:'保存内容を再読込',exact:true}).click();await p.getByTestId('save-status').filter({hasText:'新規計画を開始できます'}).waitFor();}
 else if(operation==='cancel-input')await picker(p).setInputFiles([]);
 else if(operation==='cancel-native')await picker(p).dispatchEvent('cancel');
 else{await p.evaluate(()=>{history.pushState(null,'','/');dispatchEvent(new PopStateEvent('popstate'));});await picker(p).waitFor({state:'detached'});}
 await p.evaluate(async()=>{releaseFile();await new Promise(r=>setTimeout(r,1000));});assert.equal(await confirmation(p).count(),0);assert.equal(await p.evaluate(()=>window.puts),0);assert.deepEqual(await p.evaluate(()=>indexedDB.databases()),[]);
});
test('R5 pending failure invalidated by reload', {timeout:240000},async t=>{
 const p=await setup(t);await choose(p,'slow-fail.json',raw);await p.waitForFunction(()=>!!window.releaseFile);await p.getByRole('button',{name:'保存内容を再読込',exact:true}).click();await p.getByTestId('save-status').filter({hasText:'新規計画を開始できます'}).waitFor();await p.evaluate(async()=>{releaseFile();await new Promise(r=>setTimeout(r,1000));});assert.equal(await p.getByRole('alert').count(),0);assert.equal(await confirmation(p).count(),0);assert.equal(await p.evaluate(()=>window.puts),0);
});
test('R5 new selection immediately revokes existing confirmation before reading', {timeout:240000},async t=>{
 const p=await setup(t);await choose(p,'first.json',raw);await confirmation(p).waitFor();await choose(p,'slow-fail.json',raw);assert.equal(await confirmation(p).count(),0);await p.evaluate(()=>releaseFile());await p.getByRole('alert').waitFor();assert.equal(await confirmation(p).count(),0);assert.equal(await p.evaluate(()=>window.puts),0);
});
for(const populated of [false,true])test(`R10 actual standard v2 ${populated?'grades/progress':'empty'} preview → confirm → reload preserves original`,{timeout:300000},async t=>{
 const state=populated?mixed():initialState();if(populated){const row=state.importedCourseAchievements[0];row.earnedCreditsTotal=4;state.importedCourseAchievements.push({...row,id:'row0',fingerprint:'fp0',earnedCreditsTotal:0},{...row,id:'rowNull',fingerprint:'fpNull',earnedCreditsTotal:null});}
 const legacy=' \n'+JSON.stringify(state,null,2)+'\r\n',backup=JSON.stringify(await createPlannerBackup(legacy,catalog),null,2);assert.ok(backup.length>1048576);
 const p=await setup(t);await p.evaluate(raw=>{localStorage.setItem('hosei-planner:v1',raw);localStorage.setItem('hosei-planner:v1:recovery','old recovery');},legacy);
 await p.getByRole('button',{name:'保存内容を再読込',exact:true}).click();await p.getByTestId('save-status').filter({hasText:'旧schema22があります'}).waitFor();await choose(p,'standard-v2.json',backup);await confirmation(p).waitFor();assert.equal(await p.evaluate(()=>window.puts),0);await confirm(p);
 await p.getByRole('button',{name:'保存内容を再読込',exact:true}).click();await p.getByTestId('save-status').filter({hasText:'旧schema22と移行履歴を照合しました'}).waitFor();const r=await record(p),s=JSON.parse(r.raw);assert.equal(r.revision,1);assert.equal(s.schemaVersion,23);assert.equal(s.source.raw,backup);assert.deepEqual(s.retained.importedCourseAchievements,state.importedCourseAchievements);assert.equal(await p.evaluate(()=>localStorage.getItem('hosei-planner:v1')),legacy);assert.equal(await p.evaluate(()=>localStorage.getItem('hosei-planner:v1:recovery')),'old recovery');
 console.log(JSON.stringify({case:'R10',populated,utf16:backup.length,utf8:Buffer.byteLength(backup),revision:r.revision,schema:s.schemaVersion,rawIdentical:s.source.raw===backup,official:state.importedCourseAchievements.map(r=>r.earnedCreditsTotal)}));
});
