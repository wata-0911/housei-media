import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE);
const root=resolve(process.env.PLANNER_DIST);
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://local').pathname;let file=resolve(root,'.'+path);if(!file.startsWith(root+'/')||!extname(path))file=resolve(root,'index.html');try{res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end('not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLANNER_BROWSER_EXECUTABLE});
const key='hosei-planner:v1';
try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(30000);
  try{
   await page.goto(origin+'/planner');await page.locator('#course-query').waitFor();
   await page.locator('#course-query').fill('公開科目');
   await page.getByRole('button',{name:'公開科目を履修計画に追加'}).click();
   await page.waitForFunction(key=>{const raw=localStorage.getItem(key);return raw&&JSON.parse(raw).publicCourses.length===1},key);
   const raw=await page.evaluate(key=>localStorage.getItem(key),key);
   const course=JSON.parse(raw).publicCourses[0];
   const cards=page.getByText('履修予定年度：未設定',{exact:false});
   const visible=await cards.count();
   const horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   console.log(JSON.stringify({phase:'public-add',width,plannedYear:course.plannedYear,visible,overflow:horizontalOverflow,rawBytes:new TextEncoder().encode(raw).length}));
   assert.equal(course.plannedYear,null,'A search click must not choose 2026 as the student plan year');
   assert.ok(visible>0,'The planned year must be visibly labelled');
   assert.equal(horizontalOverflow,false);
   await page.reload();await page.locator('#curriculum-course-list').waitFor();
   const reload=JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key));
   assert.equal(reload.publicCourses.length,1);assert.equal(reload.publicCourses[0].plannedYear,null);
   console.log(JSON.stringify({phase:'public-reload',width,plannedYear:reload.publicCourses[0].plannedYear}));
   await page.locator('#course-query').fill('簿記');
   const firstResult=page.getByRole('list',{name:'検索結果'}).locator('li').first();
   const resultTitle=await firstResult.locator('h3').textContent();
   await firstResult.getByRole('button').click();
   await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).items.length===1,key);
   const courseRow=page.locator('[data-curriculum-course-id]').filter({has:page.locator('[data-attempt-id]')}).first();
   await courseRow.waitFor();
   await courseRow.getByRole('button',{name:'詳細・編集を開く'}).click();
   const attempt=courseRow.locator('[data-attempt-id]').first();
   assert.equal(await attempt.isVisible(),true,'The existing attempt editor must remain visible');
   assert.equal(await courseRow.count(),1);
   console.log(JSON.stringify({phase:'curriculum-existing',width,resultTitle,courses:await page.locator('[data-curriculum-course-id]').count(),attempts:await attempt.count(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}));
   const publicSection=page.getByRole('region',{name:'公開科目'});
   await publicSection.getByRole('button',{name:/詳細を開く|^開く$/}).first().click();
   const yearInput=publicSection.getByRole('textbox',{name:'計画年度'}).first();
   await yearInput.fill('2027');await yearInput.press('Enter');
   await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).publicCourses[0].plannedYear===2027,key);
   await page.reload();await page.locator('#curriculum-course-list').waitFor();
   assert.equal(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key)).publicCourses[0].plannedYear,2027);
   console.log(JSON.stringify({phase:'public-edit-reload',width,plannedYear:2027}));
   await page.evaluate(key=>{const state=JSON.parse(localStorage.getItem(key));state.publicCourses[0].plannedYear=2026;localStorage.setItem(key,JSON.stringify(state));},key);
   await page.reload();await page.locator('#curriculum-course-list').waitFor();
   assert.equal(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key)).publicCourses[0].plannedYear,2026);
   console.log(JSON.stringify({phase:'legacy-year-preserved',width,plannedYear:2026}));
  }finally{await context.close();}
 }
 console.log('PASS public-course default, display, reload at desktop and 390px');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
