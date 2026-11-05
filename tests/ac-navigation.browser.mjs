import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {serveAc} from './ac-static-server.mjs';
const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');
const dir=new URL('../../evidence/navigation/',import.meta.url);await mkdir(dir,{recursive:true});
const server=await serveAc(new URL('../../dist-ac',import.meta.url).pathname),base=server.origin;
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLANNER_BROWSER_EXECUTABLE});
 for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(30000);
 await page.route('**/*',async r=>{if(!r.request().url().startsWith(base))return r.abort();if(/InstitutionalPlannerPage-.*\.js/.test(r.request().url()))await new Promise(res=>setTimeout(res,600));return r.continue();});
 await page.addInitScript(()=>{window.moves=[];const old=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(o){window.moves.push(this.id);return old.call(this,o);};});
 async function check(id){try{await page.waitForFunction(id=>document.activeElement?.id===id,id,{timeout:8000});const b=await page.locator('#'+id).boundingBox(),h=await page.locator('header').boundingBox();assert.ok(b.y>=h.y+h.height-1&&b.y<900);}catch(error){console.log('C01_DIAGNOSTIC',JSON.stringify(await page.evaluate(()=>({href:location.href,active:document.activeElement?.outerHTML,moves:window.moves}))));await page.screenshot({path:new URL(`failure-${width}.png`,dir).pathname,fullPage:true});throw error;}}
 async function shortcut(id){await page.locator('.page-edge-navigation .edge-scroll').waitFor();await page.waitForTimeout(500);await page.locator('.page-edge-navigation .edge-scroll').focus();await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-edge-destination')==='0');const labels={'planned-heading':'履修・修得一覧へ','course-query':'科目検索へ','graduation-progress-heading':'卒業要件へ'};await page.getByRole('button',{name:labels[id],exact:true}).focus();await page.keyboard.press('Enter');await check(id);}
 for(const id of ['planned-heading','course-query','graduation-progress-heading']){
 await page.goto(base+'/qa');await page.locator('.edge-scroll').waitFor();assert.equal(await page.locator('[data-edge-destination]').count(),3);assert.equal(await page.getByRole('button',{name:'メディア記録へ',exact:true}).count(),0);await page.locator('.edge-scroll').focus();await page.keyboard.press('ArrowUp');await page.waitForFunction(()=>document.activeElement?.textContent==='履修・修得一覧へ');await page.keyboard.press('Escape');await shortcut(id);console.log(`PASS ${width} cross-page ${id}`);await page.reload();await check(id);await shortcut(id);await shortcut(id);const other=id==='course-query'?'planned-heading':'course-query';await shortcut(other);await page.goBack();await check(id);await page.goForward();await check(other);await page.goto(base+'/__dev/ac#'+id);await check(id);
 }
 await shortcut('course-query');const before=await page.evaluate(()=>window.moves.length);await page.locator('#course-query').fill('簿記');await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.moves.length),before);await page.getByRole('button',{name:'この配置を選ぶ'}).first().click();assert.equal(await page.evaluate(()=>window.moves.length),before);assert.equal(await page.getByRole('button',{name:'下書きへ追加'}).isDisabled(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:new URL(`navigation-${width}.png`,dir).pathname,fullPage:true});console.log(`PASS ${width}: all shortcuts/repeat/history/direct/reload/lazy600ms/keyboard/header/non-rescroll`);await page.close();
 }
 await writeFile(new URL('result.json',dir),JSON.stringify({widths:[1280,390],passed:true,lazyDelayMs:600,allThreeAnchors:true,allDisplayedDestinationsChecked:true,mediaUnavailable:true,arrowUpUsesLastAvailable:true}));
}finally{await browser?.close();await server.close();}
