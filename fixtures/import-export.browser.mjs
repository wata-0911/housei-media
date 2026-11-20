import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { correspondence, item, state } from '../tests/fixtures/curriculum-course-ui.mjs';

const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE);
const root = resolve(process.env.PLANNER_DIST);
const types = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local').pathname;
  let file=resolve(root,'.'+path);
  if(!file.startsWith(root+'/')||!extname(path))file=resolve(root,'index.html');
  try{res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}
  catch{res.statusCode=404;res.end('not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLANNER_BROWSER_EXECUTABLE});
const key='hosei-planner:v1';
const number=(value)=>({raw:String(value),value});
const grade={schemaVersion:1,source:'hosei_web_learning_grade_table',capturedAt:'2026-10-24T00:00:00.000Z',courses:[{
 rawName:'合成未照合科目ABC',categoryRaw:'専門',compositionCredits:number(4),additionalEnrollment:number(0),
 recognizedExemption:{raw:'',value:null},earnedCredits:number(4),schoolingCredits:number(0),
 reports:Array.from({length:4},()=>({raw:'',status:'none',date:null})),
 creditExam:{rawDate:'',rawCredits:'',rawGrade:'',date:null,credits:null,grade:null,pendingMarker:false},
 schoolings:Array.from({length:2},()=>({rawYear:'',rawTerm:'',rawDate:'',rawCredits:'',rawGrade:'',year:null,term:null,date:null,credits:null,grade:null}))
}]};
try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true,reducedMotion:'reduce'});
  try{
   const initial=state({items:[item(correspondence)]});
   await context.addInitScript(({key,raw})=>{if(!localStorage.getItem('fixture-loaded')){localStorage.setItem(key,raw);localStorage.setItem('fixture-loaded','1');}},{key,raw:JSON.stringify(initial)});
   const page=await context.newPage();page.setDefaultTimeout(12000);await page.goto(origin+'/planner');
   const panel=page.locator('#grade-import-panel');
   await panel.locator('xpath=..').evaluate(el=>{el.open=true;});
   await panel.getByRole('textbox',{name:'またはJSONを貼り付け',exact:true}).fill(JSON.stringify(grade));
   await panel.getByRole('button',{name:'読み込み・検証',exact:true}).click();
   await panel.locator('fieldset').waitFor();
   assert.equal(await panel.getByRole('checkbox',{name:'合成未照合科目ABCを取り込む'}).count(),1);
   await panel.getByRole('button',{name:'確認した履修実績を保存・履修計画に仮登録',exact:true}).click();
   await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).importedCourseAchievements?.some(x=>x.rawName==='合成未照合科目ABC'),key);
   const afterImport=JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key));
   assert.deepEqual(afterImport.items,initial.items);
   assert.ok(!afterImport.items.some(x=>x.offeringId==='合成未照合科目ABC'));
   await panel.getByRole('textbox',{name:'またはJSONを貼り付け',exact:true}).fill(JSON.stringify(grade));
   await panel.getByRole('button',{name:'読み込み・検証',exact:true}).click();
   await panel.locator('fieldset').waitFor();
   assert.equal(await panel.getByRole('button',{name:'確認した履修実績を保存・履修計画に仮登録',exact:true}).isDisabled(),true);
   const beforeExport=await page.evaluate(key=>localStorage.getItem(key),key);
   const csvPromise=page.waitForEvent('download');
   await page.getByRole('button',{name:'CSVで保存',exact:true}).click();
   const csv=await csvPromise;
   assert.match(csv.suggestedFilename(),/\.csv$/);
   await page.getByRole('button',{name:'画像を生成',exact:true}).click();
   await page.getByText('PNGを生成しました。保存方法を選択してください。',{exact:true}).waitFor({timeout:30000});
   const pngPromise=page.waitForEvent('download');
   await page.getByRole('link',{name:'ファイルをダウンロード',exact:true}).click();
   const png=await pngPromise;
   assert.match(png.suggestedFilename(),/\.png$/);
   assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),beforeExport);
   await page.reload();
   assert.ok(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key)).importedCourseAchievements.some(x=>x.rawName==='合成未照合科目ABC'));
   console.log(JSON.stringify({width,importedCourseRows:afterImport.importedCourseAchievements.length,reimportDuplicateBlocked:true,csv:csv.suggestedFilename(),png:png.suggestedFilename(),exportNoWrite:true,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}));
  }finally{await context.close();}
 }
 console.log('PASS grade import/reimport duplicate hold and CSV/PNG download');
}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
