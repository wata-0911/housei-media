import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
test('Chromium: rejected/thrown assessment submissions keep inputs, renew new IDs and retain existing IDs',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'progress-draft-'));let browser;
  const entry=`import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';
import {ProgressEditor} from ${JSON.stringify(resolve('dev/attempts/ProgressEditor.tsx'))};
import {createWorkbenchIdentityOwner} from ${JSON.stringify(resolve('src/planner/attempts/workbench/sessionIdentities.ts'))};
const record={id:'hosei:owned:b7110000-0000-4000-8000-000000009999',kind:'media',owner:null,payload:{totalLessons:null,lessons:[],assessments:[{id:'inherited',type:'other',label:'existing',scheduledDate:null,completed:false}]}};
const owner=createWorkbenchIdentityOwner(()=>record);const root=createRoot(document.getElementById('root'));
window.probe={mode:'false',commands:[],reservations:()=>owner.reservations()};
const render=()=>root.render(<StrictMode><ProgressEditor record={record} identities={owner.ids} submit={c=>{window.probe.commands.push(structuredClone(c));if(window.probe.mode==='throw')throw Error('rejected');return window.probe.mode==='success';}} /></StrictMode>);window.probe.render=render;render();`;
  await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},outfile:join(dir,'bundle.js'),bundle:true,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
  const server=createServer(async(req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?await readFile(join(dir,'bundle.js')):'<div id="root"></div><script type="module" src="/bundle.js"></script>');});
  try {
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
    const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByLabel('試験名 1').fill('existing edited');
    const add=page.getByRole('button',{name:'試験を追加',exact:true}),submit=page.getByRole('button',{name:'メディア進捗をメモリに反映'});
    await add.click();await add.click();
    for(const i of [2,3]) {await page.getByLabel('試験名 '+i).fill('draft '+i);await page.getByLabel('試験種別 '+i).selectOption('midterm');await page.getByLabel('予定日 '+i+'（YYYY-MM-DD・空欄=null）').fill('2027-02-30');await page.getByLabel('試験完了 '+i,{exact:true}).check();}
    const ids=()=>page.locator('p').filter({hasText:'assessment ID:'}).allTextContents();
    let previous=await ids();
    for(const mode of ['false','throw','false']) {
      await page.evaluate(m=>window.probe.mode=m,mode);await submit.click();
      await page.waitForFunction(()=>window.probe.commands.length>0);await page.evaluate(()=>window.probe.render());
      for(const i of [2,3]) {assert.equal(await page.getByLabel('試験名 '+i).inputValue(),'draft '+i);assert.equal(await page.getByLabel('試験種別 '+i).inputValue(),'midterm');assert.equal(await page.getByLabel('予定日 '+i+'（YYYY-MM-DD・空欄=null）').inputValue(),'2027-02-30');assert.equal(await page.getByLabel('試験完了 '+i,{exact:true}).isChecked(),true);}
      const next=await ids();assert.equal(next[0],previous[0]);assert.notEqual(next[1],previous[1]);assert.notEqual(next[2],previous[2]);previous=next;
      assert.equal(await page.getByLabel('試験名 1').inputValue(),'existing edited');
    }
    // An empty name failure still retains all other draft values.
    await page.getByLabel('試験名 2').fill('');await submit.click();assert.equal(await page.getByLabel('試験名 2').inputValue(),'');
    await page.getByLabel('試験名 2').fill('final input');for(const i of [2,3])await page.getByLabel('予定日 '+i+'（YYYY-MM-DD・空欄=null）').fill('2028-02-29');
    await page.evaluate(()=>window.probe.mode='success');await submit.click();
    const commands=await page.evaluate(()=>window.probe.commands),last=commands.at(-1);
    assert.equal(last.payload.assessments[0].id,'inherited');assert.equal(last.payload.assessments[1].label,'final input');assert.equal(last.payload.assessments[1].scheduledDate,'2028-02-29');
    const reserved=new Set(await page.evaluate(()=>window.probe.reservations()));
    for(const c of commands) {assert.ok(reserved.has(c.operationId));for(const a of c.payload.assessments.slice(1))assert.ok(reserved.has(a.id));}
  } finally {await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
