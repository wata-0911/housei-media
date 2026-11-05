import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {serveAc} from './ac-static-server.mjs';
import {mixed} from './fixtures/migration-fixture.mjs';
const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');
const evidence=new URL(process.env.AC_BROWSER_EVIDENCE || '../../evidence/browser/',import.meta.url);await mkdir(evidence,{recursive:true});
const legacyRaw=' \n'+JSON.stringify(mixed(),null,2)+'\r\n', recoveryRaw='broken recovery raw\t';
const title='世界地誌（1）（アジア）';
const authority=page=>page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hosei-yi06-isolated-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise((resolve,reject)=>{const tx=db.transaction('authority','readonly'),get=tx.objectStore('authority').get('current');let value;get.onsuccess=()=>value=get.result;tx.oncomplete=()=>{db.close();resolve(value);};tx.onabort=()=>reject(tx.error);});});
function checkState(a){const s=JSON.parse(a.raw);assert.equal(s.schemaVersion,24);assert.equal(s.retained.graduationCheckComplete,false);assert.equal(s.retained.graduationEvaluation,'not_evaluated');return s;}
for(const width of [1280,390])test(`A+C native browser ${width}: CRUD, failure, unknown outcome, load failure, CAS, C01`,{timeout:600000},async()=>{
 const server=await serveAc(new URL('../../dist-ac',import.meta.url).pathname),origin=server.origin;
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLANNER_BROWSER_EXECUTABLE});
 const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true,reducedMotion:'reduce'});const errors=[],phases=[];let page;const start=Date.now();
 function phase(name){const value={width,name,elapsedMs:Date.now()-start};phases.push(value);console.log(JSON.stringify(value));}
 try{
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.addInitScript(({legacyRaw,recoveryRaw})=>{
  if(!localStorage.getItem('ac-fixture')){localStorage.setItem('hosei-planner:v1',legacyRaw);localStorage.setItem('hosei-planner:v1:recovery',recoveryRaw);localStorage.setItem('ac-fixture','yes');}
  window.moves=[];const scroll=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(o){window.moves.push(this.id);return scroll.call(this,o);};
  const put=IDBObjectStore.prototype.put,transaction=IDBDatabase.prototype.transaction,complete=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete').set;
  window.fault='';IDBObjectStore.prototype.put=function(...args){if(window.fault==='quota'){window.fault='';throw new DOMException('synthetic quota','QuotaExceededError');}return put.apply(this,args);};
  IDBDatabase.prototype.transaction=function(...args){if(window.fault==='read'&&args[1]==='readonly')throw Error('synthetic_read_failed');const tx=transaction.apply(this,args);
   if(args[1]==='readwrite')Object.defineProperty(tx,'oncomplete',{configurable:true,set(fn){complete.call(tx,function(e){if(window.fault==='unknown'){window.fault='';this.onabort?.(e);}else {if(window.fault==='postread')window.fault='read';fn.call(this,e);}});}});
   return tx;};
 },{legacyRaw,recoveryRaw});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 page.setDefaultTimeout(120000);
 const status=p=>p.getByTestId('save-status');
 async function open(p=page){await p.bringToFront();await p.goto(origin+'/__dev/ac');await status(p).filter({hasText:/新規計画を開始できます|再読込・照合/}).waitFor();}
 async function prepare(p=page){await p.bringToFront();await p.getByRole('button',{name:/^(新規計画の保存を準備|保存内容を準備)$/}).click();await p.getByRole('group',{name:'保存確認',exact:true}).waitFor();}
 async function confirm(p=page,success=true){await p.bringToFront();const dl=p.waitForEvent('download');await p.getByRole('button',{name:'変更前の原文を保護',exact:true}).click();await dl;await p.getByLabel('保護ファイルと保存内容を確認しました').check();await p.getByRole('button',{name:'確認して保存',exact:true}).click();await status(p).filter({hasText:success?'保存済み':'保存失敗・競合または応答不明'}).waitFor();}
 async function save(p=page){await prepare(p);await confirm(p);}
 async function reload(p=page){await p.bringToFront();await p.getByRole('button',{name:'保存内容を再読込',exact:true}).click();await status(p).filter({hasText:'再読込・照合'}).waitFor();}
 async function add(p=page,year='2033',double=false){await p.bringToFront();await p.locator('#course-query').fill(title);await p.getByRole('button',{name:'この配置を選ぶ',exact:true}).first().click();const f=p.getByRole('form',{name:'履修記録の入力',exact:true});await f.getByLabel('予定年度（空欄は未設定）').fill(year);await f.getByLabel('履修方法',{exact:true}).selectOption('correspondence');if(double)await f.evaluate(f=>{f.requestSubmit();f.requestSubmit();});else await f.getByRole('button',{name:'下書きへ追加',exact:true}).click();await f.waitFor({state:'detached'});}
 async function unchangedLegacy(p=page){assert.deepEqual(await p.evaluate(()=>[localStorage.getItem('hosei-planner:v1'),localStorage.getItem('hosei-planner:v1:recovery')]),[legacyRaw,recoveryRaw]);}
 await open();phase('loaded');await save();phase('schema24-created');assert.equal(checkState(await authority(page)).graph.attempts.length,0);
 await add(page,'2033',true);assert.equal(await page.locator('[data-attempt-id]').count(),1);assert.match(await status(page).textContent(),/未保存/);await save();const first=checkState(await authority(page));assert.equal(first.graph.attempts.length,1);await page.reload();await status(page).filter({hasText:'再読込・照合'}).waitFor();
 const card=page.locator('[data-attempt-id]').first();const id=await card.getAttribute('data-attempt-id');
 await card.getByRole('button',{name:'履修記録を編集',exact:true}).click();const f=card.getByRole('form',{name:'履修記録の入力',exact:true});await f.getByLabel('予定年度（空欄は未設定）').fill('2034');await f.getByLabel('進捗',{exact:true}).selectOption('in_progress');await f.getByRole('button',{name:'変更を下書きに反映'}).click();
 const progress=card.getByRole('form',{name:title+'の通信進捗'});await progress.getByLabel('必要リポート数',{exact:true}).fill('0');await progress.getByRole('button',{name:'進捗を下書きに反映'}).click();await save();const before=checkState(await authority(page));assert.equal(before.graph.attempts[0].plan.plannedYear,2034);assert.equal(before.graph.ownedRecords[0].payload.requiredReports,0);phase('edit-progress-saved');
 await card.getByRole('button',{name:'計画から削除',exact:true}).click();await save();const deleted=checkState(await authority(page));assert.equal(deleted.graph.attempts[0].membership.kind,'detached');assert.deepEqual(deleted.graph.ownedRecords,before.graph.ownedRecords);await page.reload();await status(page).filter({hasText:'再読込・照合'}).waitFor();await page.getByRole('button',{name:'この履修回をUndo'}).click();await save();const undone=checkState(await authority(page));assert.deepEqual(undone.graph,before.graph);assert.equal(undone.graph.attempts[0].id,id);await unchangedLegacy();phase('delete-reload-undo');
 // Quota failure consumes confirmation and requires reload. No duplicate replay.
 await add();const stable=await authority(page);await prepare();await page.evaluate(()=>window.fault='quota');await confirm(page,false);assert.deepEqual(await authority(page),stable);assert.equal(await page.getByRole('group',{name:'保存確認',exact:true}).count(),0);assert.equal(await card.getByRole('button',{name:'履修記録を編集',exact:true}).isDisabled(),true);await reload();assert.equal(await page.locator('[data-attempt-id]').count(),1);phase('quota-reconciled');
 // Real IDB commit, synthetic loss of completion receipt: UI must not say saved.
 await add();await prepare();await page.evaluate(()=>window.fault='unknown');await confirm(page,false);let committed=await authority(page);assert.equal(checkState(committed).graph.attempts.length,2);assert.doesNotMatch(await status(page).textContent(),/保存済み/);await reload();assert.deepEqual(await authority(page),committed);assert.equal(await page.locator('[data-attempt-id]').count(),2);phase('unknown-response-reconciled');
 // Newdev compatibility: native write succeeds, but the pinned verifier's
 // post-commit read fails. Preserve the durable addition and require reload.
 await add();await prepare();await page.evaluate(()=>window.fault='postread');await confirm(page,false);assert.doesNotMatch(await status(page).textContent(),/保存済み/);await page.evaluate(()=>window.fault='');committed=await authority(page);assert.equal(checkState(committed).graph.attempts.length,3);await reload();assert.deepEqual(await authority(page),committed);phase('post-commit-read-failure-reconciled');
 // Failed read revokes prepared save and retains last display snapshot.
 await prepare();await page.evaluate(()=>window.fault='read');await page.getByRole('button',{name:'保存内容を再読込',exact:true}).click();await page.getByRole('alert').filter({hasText:'synthetic_read_failed'}).waitFor();assert.equal(await page.getByRole('group',{name:'保存確認',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'保存内容を準備',exact:true}).isDisabled(),true);await page.evaluate(()=>window.fault='');assert.deepEqual(await authority(page),committed);await reload();phase('failed-load-recovered');
 // Both tabs share real Web Locks and native CAS; only the winner's addition persists.
 const other=await context.newPage();other.setDefaultTimeout(120000);other.on('dialog',d=>d.accept());await open(other);await add(page,'2041');await add(other,'2042');await prepare(page);await prepare(other);await confirm(page);const winner=await authority(page);await confirm(other,false);assert.deepEqual(await authority(other),winner);await reload(other);assert.equal(checkState(await authority(other)).graph.attempts.length,4);assert.equal(checkState(winner).graph.attempts.filter(a=>a.plan.plannedYear===2042).length,0);await other.close();await unchangedLegacy();phase('two-tab-cas');
 // Identity and method boundaries through the rendered shared search/form.
 await page.locator('#course-query').fill('ビジネス英語A');await page.getByRole('button',{name:'この配置を選ぶ',exact:true}).first().click();await page.getByRole('form',{name:'履修記録の入力'}).getByLabel('履修方法',{exact:true}).selectOption('correspondence');await page.getByRole('button',{name:'下書きへ追加',exact:true}).click();await page.getByRole('alert').filter({hasText:'方式を確認'}).waitFor();assert.deepEqual(await authority(page),winner);await page.getByRole('button',{name:'入力を閉じる'}).click();
 // C01: actual shortcuts, repeat, back/forward, direct hash and reload.
 async function check(id){await page.waitForFunction(id=>document.activeElement?.id===id,id);const b=await page.locator('#'+id).boundingBox(),h=await page.locator('header').boundingBox();assert.ok(b.y>=h.y+h.height-1&&b.y<900,`${id}: header/viewport`);}
 async function shortcut(id){await page.locator('.page-edge-navigation .edge-scroll').waitFor();await page.locator('.page-edge-navigation .edge-scroll').focus();await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-edge-destination')==='0');const labels={'planned-heading':'履修・修得一覧へ','course-query':'科目検索へ','graduation-progress-heading':'卒業要件へ'};await page.getByRole('button',{name:labels[id],exact:true}).focus();await page.keyboard.press('Enter');await check(id);}
 for(const id of ['planned-heading','course-query','graduation-progress-heading']){await page.goto(origin+'/qa');await shortcut(id);await shortcut(id);await shortcut(id==='course-query'?'planned-heading':'course-query');await page.goBack();await check(id);await page.goForward();await page.goto(origin+'/__dev/ac#'+id);await check(id);await page.reload();await check(id);}
 await shortcut('course-query');const moves=await page.evaluate(()=>window.moves.length);await page.locator('#course-query').fill(title);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.moves.length),moves);await page.getByRole('button',{name:'この配置を選ぶ',exact:true}).first().click();assert.equal(await page.evaluate(()=>window.moves.length),moves);
 assert.ok((await page.locator('article.institutional-planner').textContent()).includes('保存済み記録で条件付き計算'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:new URL(`ac-${width}.png`,evidence).pathname,fullPage:true});await unchangedLegacy();assert.deepEqual(errors,[]);phase('c01-and-preservation');
 await writeFile(new URL(`result-${width}.json`,evidence),JSON.stringify({width,phases,errors,authority:await authority(page),legacyRawPreserved:true},null,2));
 }catch(error){console.error(error);await page?.screenshot({path:new URL(`failure-${width}.png`,evidence).pathname,fullPage:true}).catch(()=>{});throw error;}finally{await context.close();await browser.close();await server.close();await writeFile(new URL(`phases-${width}.json`,evidence),JSON.stringify(phases,null,2));}
});

test('A+C native schema22 explicit migration → schema23 reload/edit/remove/Undo preserves officials and source bytes',{timeout:600000},async()=>{
 const server=await serveAc(new URL('../../dist-ac',import.meta.url).pathname),origin=server.origin;
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLANNER_BROWSER_EXECUTABLE});
 const context=await browser.newContext({viewport:{width:390,height:900},acceptDownloads:true});
 try{
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage();page.setDefaultTimeout(120000);page.on('dialog',d=>d.accept());
 await page.goto(origin+'/__dev/ac');await page.getByTestId('save-status').filter({hasText:'新規計画を開始できます'}).waitFor();
 await page.evaluate(({legacyRaw,recoveryRaw})=>{localStorage.setItem('hosei-planner:v1',legacyRaw);localStorage.setItem('hosei-planner:v1:recovery',recoveryRaw);},{legacyRaw,recoveryRaw});
 async function confirm(){const dl=page.waitForEvent('download');await page.getByRole('button',{name:'変更前の原文を保護'}).click();await dl;await page.getByLabel('保護ファイルと保存内容を確認しました').check();await page.getByRole('button',{name:'確認して保存'}).click();await page.getByTestId('save-status').filter({hasText:'保存済み'}).waitFor();}
 async function save(){await page.getByRole('button',{name:'保存内容を準備',exact:true}).click();await confirm();}
 await page.getByLabel('旧schema22原文から明示移行').setInputFiles({name:'legacy-v22.json',mimeType:'application/json',buffer:Buffer.from(legacyRaw)});await page.getByRole('group',{name:'保存確認',exact:true}).waitFor();await confirm();
 const original=JSON.parse((await authority(page)).raw);assert.equal(original.schemaVersion,23);assert.equal(original.source.raw,legacyRaw);const source=mixed();assert.deepEqual(original.retained.importedCourseAchievements,source.importedCourseAchievements);assert.deepEqual(original.retained.importedStudyRecords,source.importedStudyRecords);
 const card=page.locator('[data-attempt-id]').filter({has:page.getByRole('button',{name:'履修記録を編集',exact:true})}).first();
 const id=await card.getAttribute('data-attempt-id');await card.getByRole('button',{name:'履修記録を編集',exact:true}).click();const form=card.getByRole('form',{name:'履修記録の入力'});await form.getByLabel('予定年度（空欄は未設定）').fill('2038');await form.getByRole('button',{name:'変更を下書きに反映'}).click();await save();const edited=JSON.parse((await authority(page)).raw);
 const editedAttempt=edited.graph.attempts.find(a=>a.id===id),originalAttempt=original.graph.attempts.find(a=>a.id===id);
 assert.equal(editedAttempt.plan.plannedYear,2038);assert.deepEqual(editedAttempt.identity,originalAttempt.identity);assert.deepEqual(editedAttempt.placement,originalAttempt.placement);assert.equal(editedAttempt.method.value,originalAttempt.method.value);
 await page.reload();await page.getByTestId('save-status').filter({hasText:'再読込・照合'}).waitFor();
 await page.locator(`[data-attempt-id="${id}"]`).getByRole('button',{name:'計画から削除'}).click();await save();await page.reload();await page.getByTestId('save-status').filter({hasText:'再読込・照合'}).waitFor();await page.locator(`[data-attempt-id="${id}"]`).getByRole('button',{name:'この履修回をUndo'}).click();await save();
 const restored=JSON.parse((await authority(page)).raw);assert.equal(restored.source.raw,legacyRaw);assert.deepEqual(restored.retained,original.retained);assert.deepEqual(restored.graph,edited.graph);assert.deepEqual(restored.source,original.source);assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('hosei-planner:v1'),localStorage.getItem('hosei-planner:v1:recovery')]),[legacyRaw,recoveryRaw]);
 await writeFile(new URL('schema23-migration.json',evidence),JSON.stringify({schema:restored.schemaVersion,rawExact:true,retainedExact:true,undoExact:true,sourceExact:true,attempts:restored.graph.attempts.length},null,2));
 }finally{await context.close();await browser.close();await server.close();}
});
