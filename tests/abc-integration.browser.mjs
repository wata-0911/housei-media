import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {serveAc} from './ac-static-server.mjs';
import {initialState,catalog,officialRow} from './fixtures/yi07-graduation.mjs';
import {isMediaSchooling} from '../src/planner/progress/mediaSchooling.ts';
import {englishState} from './fixtures/f02-r4-scenarios.mjs';
import fixed from './fixtures/abc-fixed.json' with{type:'json'};
const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');
const out=process.env.ABC_EVIDENCE||new URL('../../evidence/abc-browser/',import.meta.url).pathname;await mkdir(out,{recursive:true});
const authority=page=>page.evaluate(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('hosei-yi06-isolated-v1',1);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});return new Promise((r,j)=>{const tx=db.transaction('authority','readonly'),q=tx.objectStore('authority').get('current');let x;q.onsuccess=()=>x=q.result;tx.oncomplete=()=>{db.close();r(x);};tx.onabort=()=>j(tx.error);});});
async function setup(width){const server=await serveAc(new URL('../../dist-ac',import.meta.url).pathname);const browser=await chromium.launch({headless:true,executablePath:process.env.PLANNER_BROWSER_EXECUTABLE});const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true,reducedMotion:'reduce'});await context.route('**/*',r=>new URL(r.request().url()).origin===server.origin?r.continue():r.abort());const page=await context.newPage();page.setDefaultTimeout(120000);page.on('dialog',d=>d.accept());const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(server.origin+'/__dev/ac');await page.getByTestId('save-status').filter({hasText:'新規計画を開始できます'}).waitFor();return{page,errors,close:async()=>{await context.close();await browser.close();await server.close();}};}
async function confirm(p){const dl=p.waitForEvent('download');await p.getByRole('button',{name:'変更前の原文を保護',exact:true}).click();await dl;await p.getByLabel('保護ファイルと保存内容を確認しました').check();await p.getByRole('button',{name:'確認して保存',exact:true}).click();await p.getByTestId('save-status').filter({hasText:'保存済み'}).waitFor();}
async function save(p){await p.getByRole('button',{name:/^(新規計画の保存を準備|保存内容を準備)$/}).click();await confirm(p);}
async function reload(p){await p.getByRole('button',{name:'保存内容を再読込',exact:true}).click();await p.getByTestId('save-status').filter({hasText:/(再読込・照合|旧schema22と移行履歴を照合しました)/}).waitFor();}
async function add(p,method='correspondence',credits='4',title=fixed.title){await p.locator('#course-query').fill(title);await p.getByRole('button',{name:'この配置を選ぶ',exact:true}).first().click();const form=p.getByRole('form',{name:'履修記録の入力',exact:true});await form.getByLabel('予定年度（空欄は未設定）').fill('2033');await form.getByLabel('履修方法',{exact:true}).selectOption(method);await form.getByLabel('進捗',{exact:true}).selectOption('earned');await form.getByRole('button',{name:'下書きへ追加',exact:true}).click();await form.waitFor({state:'detached'});const card=p.locator('[data-attempt-id]').last(),quantity=card.getByRole('form',{name:title+'の本人記録単位',exact:true});await quantity.getByLabel('単位数（空欄は不明）').fill(credits);await quantity.getByRole('button',{name:'単位数を下書きに反映',exact:true}).click();return card;}
async function calculate(p){await p.getByLabel('計算に仮定する教育課程',{exact:true}).selectOption(fixed.scopeId);await p.getByRole('button',{name:'保存済み記録で条件付き計算',exact:true}).click();await p.getByTestId('recorded-calculation').waitFor();}
const general=p=>p.getByTestId('recorded-calculation').locator('[data-requirement-id="group-general"]');
for(const width of [1280,390])test(`ABC native ${width}: save/reload/T4/edit/held/Undo/invalid input/scenario`,{timeout:600000},async()=>{
 const h=await setup(width),p=h.page;try{
 // A starts with both legacy keys absent. G is tested separately; a corrupt
 // legacy primary cannot coexist with authorization to create a blank24.
 await save(p);const card=await add(p);assert.equal(await p.getByRole('button',{name:'保存済み記録で条件付き計算'}).isDisabled(),true);await save(p);await reload(p);const before=await authority(p);await calculate(p);assert.equal(await general(p).locator('td').nth(1).getAttribute('data-value'),'4');assert.match(await p.getByTestId('recorded-calculation').textContent(),/完成構成単位 4/);assert.match(await p.getByTestId('recorded-calculation').textContent(),/本人適用: 未確認/);assert.deepEqual(await authority(p),before);
 const q=card.getByRole('form',{name:fixed.title+'の本人記録単位',exact:true});await q.getByLabel('単位数（空欄は不明）').fill('-1');await q.getByRole('button',{name:'単位数を下書きに反映'}).click();await q.getByRole('alert').waitFor();assert.deepEqual(await authority(p),before);
 await q.getByLabel('単位数（空欄は不明）').fill('');await q.getByRole('button',{name:'単位数を下書きに反映'}).click();assert.equal(await p.getByTestId('recorded-calculation').count(),0);await save(p);await reload(p);await calculate(p);assert.equal(await p.locator('[data-held-attempt-id]').count(),1);assert.equal(JSON.parse((await authority(p)).raw).graph.attempts[0].plan.contribution.value,null);
 await q.getByLabel('単位数（空欄は不明）').fill('0');await q.getByRole('button',{name:'単位数を下書きに反映'}).click();await save(p);await reload(p);await calculate(p);assert.equal(JSON.parse((await authority(p)).raw).graph.attempts[0].plan.contribution.value,0);assert.equal(await p.locator('[data-held-attempt-id]').count(),1);
 await q.getByLabel('単位数（空欄は不明）').fill('4');await q.getByRole('button',{name:'単位数を下書きに反映'}).click();await save(p);await reload(p);await calculate(p);await card.getByRole('button',{name:'計画から削除',exact:true}).click();assert.equal(await p.getByTestId('recorded-calculation').count(),0);await save(p);await reload(p);await calculate(p);assert.equal(await general(p).locator('td').nth(1).getAttribute('data-value'),'0');await p.getByRole('button',{name:'この履修回をUndo',exact:true}).click();await save(p);await reload(p);await calculate(p);assert.equal(await general(p).locator('td').nth(1).getAttribute('data-value'),'4');
 const selector=p.getByLabel('計算に仮定する教育課程',{exact:true});await selector.selectOption('');assert.equal(await p.getByTestId('recorded-calculation').count(),0);await calculate(p);assert.deepEqual(await p.evaluate(()=>[localStorage.getItem('hosei-planner:v1'),localStorage.getItem('hosei-planner:v1:recovery')]),[null,null]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(h.errors,[]);await p.screenshot({path:join(out,`abc-${width}.png`),fullPage:true});await writeFile(join(out,`abc-${width}.json`),JSON.stringify({fixed,authority:await authority(p),text:await p.getByTestId('recorded-calculation').textContent(),errors:h.errors},null,2));
 // G is exercised only AFTER the A CRUD scenario. A deliberate old raw now
 // revokes writes on explicit reload while both legacy bytes and24 stay intact.
 const finalAuthority=await authority(p);
 await p.evaluate(()=>{localStorage.setItem('hosei-planner:v1','unaltered legacy raw');localStorage.setItem('hosei-planner:v1:recovery','unaltered recovery raw');});
 await p.getByRole('button',{name:'保存内容を再読込',exact:true}).click();
 await p.getByTestId('save-status').filter({hasText:'旧データのJSONを読み取れません'}).waitFor();
 assert.equal(await p.getByRole('button',{name:'保存内容を準備',exact:true}).isDisabled(),true);
 assert.deepEqual(await authority(p),finalAuthority);
 assert.deepEqual(await p.evaluate(()=>[localStorage.getItem('hosei-planner:v1'),localStorage.getItem('hosei-planner:v1:recovery')]),['unaltered legacy raw','unaltered recovery raw']);
 }finally{await h.close();}
});
for(const amount of [4,0,null])test(`ABC native schema22 →23 official ${amount} stays authoritative after personal T4`,{timeout:600000},async()=>{
 const h=await setup(390),p=h.page;try{
 const state=initialState();state.importedCourseAchievements=[officialRow(catalog.curriculum.courses.find(c=>c.id===fixed.curriculumCourseId),amount)];const raw=' \n'+JSON.stringify(state,null,2)+'\r\n';await p.evaluate(raw=>localStorage.setItem('hosei-planner:v1',raw),raw);await p.getByRole('button',{name:'保存内容を再読込',exact:true}).click();await p.getByTestId('save-status').filter({hasText:'旧schema22があります'}).waitFor();await p.getByLabel('旧schema22原文から明示移行').setInputFiles({name:'official-v22.json',mimeType:'application/json',buffer:Buffer.from(raw)});await p.getByRole('group',{name:'保存確認',exact:true}).waitFor();await confirm(p);await reload(p);await add(p);await save(p);await reload(p);const before=await authority(p),stored=JSON.parse(before.raw);assert.equal(stored.schemaVersion,23);assert.equal(stored.source.raw,raw);assert.deepEqual(stored.retained.importedCourseAchievements,state.importedCourseAchievements);await calculate(p);assert.match(await p.getByTestId('recorded-calculation').textContent(),/公式成績を優先（本人記録による追加算入0）/);assert.equal(await general(p).locator('td').nth(1).getAttribute('data-value'),amount===null?'0':String(amount));if(amount===null){assert.equal(await general(p).locator('td').nth(0).textContent(),'保留（unknown）');assert.match(await general(p).locator('td').nth(1).textContent(),/既知分 0（全体保留）/);assert.match(await p.locator('[data-reference-id="overall-reference-progress"]').textContent(),/不明（null）/);}assert.deepEqual(await authority(p),before);assert.equal(await p.evaluate(()=>localStorage.getItem('hosei-planner:v1')),raw);assert.deepEqual(h.errors,[]);await writeFile(join(out,`official-${amount}.json`),JSON.stringify({fixed,amount,raw,authority:before,text:await p.getByTestId('recorded-calculation').textContent(),errors:h.errors},null,2));
 }finally{await h.close();}
});
test('ABC F02-R1 A: persisted T4 keeps4 after S2 and S0, holding only extras',{timeout:600000},async()=>{
 const h=await setup(390),p=h.page;try{
  await save(p);await add(p);await save(p);await reload(p);await calculate(p);assert.equal(await general(p).locator('td').nth(1).getAttribute('data-value'),'4');
  for(const credits of ['2','0']) {
   await add(p,'schooling',credits);await save(p);await reload(p);const before=await authority(p);await calculate(p);
   assert.equal(await general(p).locator('td').nth(1).getAttribute('data-value'),'4');assert.deepEqual(await authority(p),before);
  }
  const before=await authority(p);assert.deepEqual(JSON.parse(before.raw).graph.attempts.map(a=>a.plan.contribution.value),[4,2,0]);assert.equal(await p.locator('[data-held-attempt-id]').count(),2);assert.deepEqual(h.errors,[]);
  await writeFile(join(out,'f02-r1-A.json'),JSON.stringify({authority:before,text:await p.getByTestId('recorded-calculation').textContent(),errors:h.errors},null,2));
 }finally{await h.close();}
});
test('ABC F02-R1 B: fractional S1 stays0; four proper awards keep4 after fifth',{timeout:600000},async()=>{
 const h=await setup(1280),p=h.page;try{
  await save(p);await add(p,'schooling','0.5','英語SⓈ※');await add(p,'schooling','0.5','英語SⓈ※');await save(p);await reload(p);let before=await authority(p);await calculate(p);
  const foreign=p.getByTestId('recorded-calculation').locator('[data-requirement-id="group-foreign"]');assert.equal(await foreign.locator('td').nth(1).getAttribute('data-value'),'0');assert.equal(await p.locator('[data-held-attempt-id]').count(),2);assert.deepEqual(await authority(p),before);
  for(let i=0;i<4;i++)await add(p,'schooling','1','英語SⓈ※');await save(p);await reload(p);await calculate(p);assert.equal(await foreign.locator('td').nth(1).getAttribute('data-value'),'4');
  await add(p,'schooling','1','英語SⓈ※');await save(p);await reload(p);before=await authority(p);await calculate(p);assert.equal(await foreign.locator('td').nth(1).getAttribute('data-value'),'4');assert.equal(await p.locator('[data-held-attempt-id]').count(),3);assert.deepEqual(await authority(p),before);
  assert.deepEqual(JSON.parse(before.raw).graph.attempts.map(a=>a.plan.contribution.value),[.5,.5,1,1,1,1,1]);assert.deepEqual(h.errors,[]);await writeFile(join(out,'f02-r1-B.json'),JSON.stringify({authority:before,text:await p.getByTestId('recorded-calculation').textContent(),errors:h.errors},null,2));
 }finally{await h.close();}
});
for(const schema of [23,24])test(`ABC F02-R2 schema${schema}: unknown method cannot satisfy foreign S after save/reload`,{timeout:600000},async()=>{
 const h=await setup(390),p=h.page;try{
  if(schema===23){const state=initialState(),raw=JSON.stringify(state);await p.getByLabel('旧schema22原文から明示移行').setInputFiles({name:'empty22.json',mimeType:'application/json',buffer:Buffer.from(raw)});await p.getByRole('group',{name:'保存確認',exact:true}).waitFor();await confirm(p);}else await save(p);
  await add(p,'correspondence','2','英語2');await add(p,'correspondence','2','英語3');await add(p,'unknown','2','英語2');await save(p);await reload(p);const before=await authority(p);await calculate(p);
  const foreign=p.getByTestId('recorded-calculation').locator('[data-requirement-id="group-foreign"]');assert.equal(await foreign.locator('td').nth(1).getAttribute('data-value'),'4');assert.notEqual(await foreign.locator('td').nth(0).textContent(),'条件上達成');assert.equal(await p.locator('[data-recorded-course-id]').count(),2);for(const row of await p.locator('[data-recorded-course-id]').all())assert.match(await row.textContent(),/スクーリング 0/);assert.equal(await p.locator('[data-held-attempt-id]').count(),1);
  const stored=JSON.parse(before.raw);assert.equal(stored.schemaVersion,schema);assert.deepEqual(stored.graph.attempts.map(a=>[a.method.value,a.plan.contribution.value]),[['correspondence',2],['correspondence',2],['unknown',2]]);assert.deepEqual(await authority(p),before);assert.deepEqual(h.errors,[]);
  await writeFile(join(out,`f02-r2-unknown-${schema}.json`),JSON.stringify({authority:before,text:await p.getByTestId('recorded-calculation').textContent(),errors:h.errors},null,2));
 }finally{await h.close();}
});
for(const [label,items,total]of [['omitted-T4-S0',[['35fb5bad-ec27-4c60-a16e-2271168170bb',undefined],['a2caa2ab-135f-4ad8-8998-75e8fd88ca59',0]],4],['omitted-politics-media-summer',[['5c3198fc-10c5-4806-bb2f-bd477670fbf3',undefined],['e0c4749c-d0ac-40af-8bd0-2952f7da9a88',undefined]],4]])test(`ABC F02-R2 formal22→23 ${label} preserves interpreted${total}`,{timeout:600000},async()=>{
 const h=await setup(1280),p=h.page;try{
  const state=initialState();Object.assign(state.graduationProfile,{admissionYear:2026,admissionType:'first_year',curriculumApplicability:'current_2026'});state.items=items.map(([offeringId,n])=>({offeringId,status:'earned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null,...(n===undefined?{}:{courseCreditContribution:n})}));const raw=JSON.stringify(state);
  await p.getByLabel('旧schema22原文から明示移行').setInputFiles({name:`${label}.json`,mimeType:'application/json',buffer:Buffer.from(raw)});await p.getByRole('group',{name:'保存確認',exact:true}).waitFor();await confirm(p);await reload(p);const before=await authority(p);await calculate(p);
  const totalCard=p.getByTestId('recorded-calculation').locator('[data-requirement-id="professional-law-total"]');assert.equal(await totalCard.locator('td').nth(1).getAttribute('data-value'),String(total));const stored=JSON.parse(before.raw);assert.equal(stored.schemaVersion,23);assert.equal(stored.source.raw,raw);assert.deepEqual(stored.graph.attempts.map(a=>Object.hasOwn(a.plan,'contribution')),items.map(([,n])=>n!==undefined));assert.deepEqual(await authority(p),before);assert.deepEqual(h.errors,[]);
  await writeFile(join(out,`f02-r2-migration-${label}.json`),JSON.stringify({raw,authority:before,text:await p.getByTestId('recorded-calculation').textContent(),errors:h.errors},null,2));
 }finally{await h.close();}
});

async function startR3(p,schema,state=initialState()){
 if(schema===23){const raw=JSON.stringify(state);await p.getByLabel('旧schema22原文から明示移行').setInputFiles({name:'r3-real22.json',mimeType:'application/json',buffer:Buffer.from(raw)});await p.getByRole('group',{name:'保存確認',exact:true}).waitFor();await confirm(p);}else await save(p);
 await reload(p);
}
for(const official of [false,true])test(`ABC F02-R4 D official${official}: another language recognition preserves English after protection save reload`,{timeout:900000},async()=>{
 const stages=[];
 for(const schooling of [undefined,null]){
  const h=await setup(390),p=h.page;try{
   const state=englishState(schooling,official),raw=JSON.stringify(state);await p.evaluate(raw=>localStorage.setItem('hosei-planner:v1',raw),raw);
   await p.getByRole('button',{name:'保存内容を再読込',exact:true}).click();
   await p.getByTestId('save-status').filter({hasText:'旧schema22があります'}).waitFor();
   await startR3(p,23,state);await save(p);await reload(p);const before=await authority(p),stored=JSON.parse(before.raw);assert.equal(stored.schemaVersion,23);assert.equal(stored.source.raw,raw);assert.deepEqual(stored.retained.graduationProfile,state.graduationProfile);await calculate(p);
   const foreign=p.getByTestId('recorded-calculation').locator('[data-requirement-id="group-foreign"]');assert.equal(await foreign.locator('td').nth(1).getAttribute('data-value'),'4');assert.equal(await foreign.locator('td').nth(0).textContent(),'条件上達成');assert.equal(await p.locator('[data-held-attempt-id]').count(),0);assert.deepEqual(await authority(p),before);assert.equal(await p.evaluate(()=>localStorage.getItem('hosei-planner:v1')),raw);assert.deepEqual(h.errors,[]);
   stages.push({schooling:schooling===undefined?'not entered':null,raw,authority:before,text:await p.getByTestId('recorded-calculation').textContent(),errors:h.errors});await p.screenshot({path:join(out,`f02-r4-D-${official}-${schooling===undefined?'baseline':'unknown'}.png`),fullPage:true});
  }finally{await h.close();}
 }
 await writeFile(join(out,`f02-r4-D-${official}.json`),JSON.stringify({stages},null,2));
});
for(const schema of [23,24])test(`ABC F02-R3 A schema${schema}: invalid media never supplies foreign S; genuine S1x2 does`,{timeout:900000},async()=>{
 const h=await setup(390),p=h.page,stages=[];try{
  await startR3(p,schema);await add(p,'correspondence','2','英語2');await add(p,'correspondence','2','英語3');
  const check=async(label,satisfied,held)=>{await save(p);await reload(p);const before=await authority(p);await calculate(p);const foreign=p.getByTestId('recorded-calculation').locator('[data-requirement-id="group-foreign"]');assert.equal(await foreign.locator('td').nth(1).getAttribute('data-value'),'4');assert.equal(await foreign.locator('td').nth(0).textContent()==='条件上達成',satisfied);assert.equal(await p.locator('[data-held-attempt-id]').count(),held);assert.deepEqual(await authority(p),before);const data=JSON.parse(before.raw);assert.equal(data.schemaVersion,schema);stages.push({label,authority:before,text:await p.getByTestId('recorded-calculation').textContent()});};
  await check('T2+T2',false,0);const extra=await add(p,'media','2','英語2');await check('invalid media2',false,1);const invalid=JSON.parse(stages.at(-1).authority.raw).graph.attempts.at(-1);assert.equal(await p.locator('[data-held-attempt-id]').getAttribute('data-held-attempt-id'),invalid.id);await extra.getByRole('button',{name:'計画から削除',exact:true}).click();await check('delete invalid',false,0);await add(p,'schooling','1','英語SⓈ※');await add(p,'schooling','1','英語SⓈ※');await check('genuine S1x2',true,0);assert.deepEqual(h.errors,[]);await writeFile(join(out,`f02-r3-A-${schema}.json`),JSON.stringify({stages,errors:h.errors},null,2));
 }finally{await h.close();}
});
for(const schema of [23,24])test(`ABC F02-R3 B schema${schema}: S8 survives duplicate add delete Undo with original quantities`,{timeout:900000},async()=>{
 const h=await setup(1280),p=h.page,stages=[];try{
  const names=schema===23?['行政法','刑法総論','民事訴訟法','国際法各論']:['行政法','刑事訴訟法','債権総論','刑法各論'];const state=initialState();Object.assign(state.graduationProfile,{admissionYear:2026,admissionType:'first_year',curriculumApplicability:'current_2026'});
  if(schema===23)state.items=names.flatMap(name=>['correspondence','schooling'].map(method=>{const o=catalog.offerings.find(o=>o.method===method&&!isMediaSchooling(o)&&catalog.curriculum.courses.some(c=>c.id===o.curriculumCourseId&&c.canonicalName===name));assert.ok(o,`${name}/${method}`);return {offeringId:o.id,status:'earned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null,courseCreditContribution:method==='correspondence'?4:2};}));
  await startR3(p,schema,state);if(schema===24)for(const name of names){await add(p,'correspondence','4',name);await add(p,'schooling','2',name);}
  const check=async(label,extra)=>{await save(p);await reload(p);const before=await authority(p);await calculate(p);const root=p.getByTestId('recorded-calculation'),total=root.locator('[data-requirement-id="professional-law-total"]'),schooling=root.locator('[data-requirement-id="professional-law-schooling"]');assert.equal(await total.locator('td').nth(1).getAttribute('data-value'),'16');assert.equal(await schooling.locator('td').nth(1).getAttribute('data-value'),'8');assert.equal(await schooling.locator('td').nth(0).textContent(),'条件上達成');for(const row of await p.locator('[data-recorded-course-id]').all())assert.match(await row.textContent(),/スクーリング 2/);const a=JSON.parse(before.raw);assert.equal(a.schemaVersion,schema);assert.equal(a.graph.attempts.filter(a=>a.membership.kind==='active').length,extra?9:8);assert.deepEqual(a.graph.attempts.slice(0,8).map(a=>a.plan.contribution.value),[4,2,4,2,4,2,4,2]);if(schema===23)assert.equal(a.source.raw,JSON.stringify(state));assert.deepEqual(await authority(p),before);stages.push({label,authority:before,text:await root.textContent()});};
  await check('four valid S2',false);const extra=await add(p,'schooling','2',names[0]);await check('duplicate added',true);const id=JSON.parse(stages.at(-1).authority.raw).graph.attempts.at(-1).id;assert.equal(await p.locator(`[data-held-attempt-id="${id}"]`).count(),1);await extra.getByRole('button',{name:'計画から削除',exact:true}).click();await check('duplicate deleted',false);await p.getByRole('button',{name:'この履修回をUndo',exact:true}).click();await check('duplicate restored',true);assert.deepEqual(h.errors,[]);await writeFile(join(out,`f02-r3-B-${schema}.json`),JSON.stringify({stages,errors:h.errors},null,2));
 }finally{await h.close();}
});
