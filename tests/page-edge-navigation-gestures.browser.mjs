// Local: PLANNER_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node --import tsx --test tests/page-edge-navigation-fixes.browser.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const origin = `http://127.0.0.1:${process.env.PLANNER_BROWSER_PORT || 4398}`;
let browser, server;
before(async () => {
  const engine = process.env.PLANNER_BROWSER_ENGINE || 'chromium';
  assert.ok(['chromium', 'webkit'].includes(engine));
  const browserType = (await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright'))[engine];
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', new URL(origin).port, '--strictPort'], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* Wait for Vite. */ }
    await delay(200);
  }
  assert.ok(ready, output);
  browser = await browserType.launch({ headless: true, ...(process.env.PLANNER_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANNER_BROWSER_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(t, path = '/', options = {}) {
  const context = await browser.newContext(options);
  t.after(() => context.close());
  // Home's external X/GAS requests are irrelevant to navigation and deterministic QA.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.edgeWrites = [];
    for (const key of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[key];
      Storage.prototype[key] = function(...args) { window.edgeWrites.push({key,args,storage:this === localStorage ? 'local' : 'session'}); return original.apply(this,args); };
    }
    window.navigationScrolls = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      window.navigationScrolls.push({ id: this.id, options });
      return original.call(this, options);
    };
  });
  await page.goto(origin + path);
  return page;
}
const nav=p=>p.getByRole('navigation',{name:'ページ移動',exact:true});
const center=p=>p.locator('.edge-scroll');
const item=(p,i)=>p.locator(`[data-edge-destination="${i}"]`);
async function save(name,data){if(process.env.EDGE_FIX_EVIDENCE){await mkdir(process.env.EDGE_FIX_EVIDENCE,{recursive:true});await writeFile(`${process.env.EDGE_FIX_EVIDENCE}/${name}.json`,JSON.stringify(data,null,2));}}
async function touch(p){const session=await p.context().newCDPSession(p);return (type,point)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:['touchEnd','touchCancel'].includes(type)?[]:[point]});}
async function middle(locator){const b=await locator.boundingBox();return{x:b.x+b.width/2,y:b.y+b.height/2};}
async function expand(p){await center(p).focus();if(await center(p).getAttribute('aria-expanded')!=='true')await p.keyboard.press('ArrowDown');}
test('F-03 movement range and F-04 single visible control',async t=>{
 const rows=[];
 for(const [width,height] of [[320,180],[375,812],[390,844],[812,375]]){
  const p=await open(t,'/qa',{viewport:{width,height},hasTouch:true,isMobile:true,reducedMotion:'reduce'}),send=await touch(p);
  const row={width,height,corners:[]};
  for(const [name,x,y] of [['top-left',1,1],['bottom-right',width-1,height-1],['top-right',width-1,1],['bottom-left',1,height-1]]){
   // Before: the dedicated handle. After: the only central control.
   const drag=await p.locator('.edge-drag').count()?p.locator('.edge-drag'):center(p);
   await send('touchStart',await middle(drag));await send('touchMove',{x,y});await send('touchEnd');await delay(80);
   const b=await center(p).boundingBox();row.corners.push({name,...b});
  }
  row.visibleButtons=await nav(p).getByRole('button').count();rows.push(row);
 }
 await save('movement',rows);
 for(const row of rows){
  assert.equal(row.visibleButtons,1);
  for(const b of row.corners){
   assert.ok(b.x>=8&&b.y>=8&&b.x+b.width<=row.width-8.01+0.02&&b.y+b.height<=row.height-8.01+0.02);
   assert.ok(Math.abs((b.name.includes('left')?b.x:row.width-b.x-b.width)-8)<1,JSON.stringify(b));
   assert.ok(Math.abs((b.name.includes('top')?b.y:row.height-b.y-b.height)-8)<1,JSON.stringify(b));
  }
 }
});
test('F-04 short tap, hold release, flick, drag and cancellation are mutually exclusive',async t=>{
 const p=await open(t,'/qa',{viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'}),send=await touch(p);
 await center(p).tap();await p.waitForFunction(()=>scrollY>100);
 await center(p).tap();await p.waitForFunction(()=>scrollY===0);
 const initialUrl=p.url();const point=await middle(center(p));
 await send('touchStart',point);await delay(180);assert.equal(await center(p).getAttribute('aria-expanded'),'false');await send('touchEnd');await p.waitForFunction(()=>scrollY>100);
 await center(p).tap();await p.waitForFunction(()=>scrollY===0);
 await send('touchStart',await middle(center(p)));await delay(510);await send('touchEnd');
 assert.equal(await center(p).getAttribute('aria-expanded'),'true');assert.equal(await p.evaluate(()=>scrollY),0);assert.equal(p.url(),initialUrl);
 await item(p,3).tap();await p.waitForFunction(()=>document.activeElement?.id==='media-panel');
 await p.goto(origin+'/qa');
 // Move into the interior so the surrounding menu can use all four directions.
 let b=await center(p).boundingBox();await send('touchStart',await middle(center(p)));await send('touchMove',{x:195,y:450});await delay(510);await send('touchEnd');
 assert.equal(await center(p).getAttribute('aria-expanded'),'false');assert.equal(await p.evaluate(()=>scrollY),0);
 b=await center(p).boundingBox();assert.ok(Math.abs(b.y-784)>20,'early motion moves the control');
 for(const mode of ['cancel','lost-capture','flick']){
  await p.evaluate(()=>{document.addEventListener('pointerdown',e=>{window.lastEdgePointer=e.pointerId;},{once:true});window.edgePushes=0;if(!window.edgeCounting){const push=history.pushState;history.pushState=function(...args){window.edgePushes++;return push.apply(this,args);};window.edgeCounting=true;}});
  await send('touchStart',await middle(center(p)));await delay(510);const target=await middle(item(p,0));await send('touchMove',target);
  if(mode==='cancel')await send('touchCancel');
  else if(mode==='lost-capture'){await p.evaluate(()=>document.querySelector('.edge-scroll').releasePointerCapture(window.lastEdgePointer));await send('touchMove',target);await send('touchEnd');}
  else{await send('touchEnd');await p.waitForFunction(()=>document.activeElement?.id==='course-query');}
  if(mode!=='flick'){assert.equal(p.url(),initialUrl);assert.equal(await center(p).getAttribute('aria-expanded'),'false');assert.equal(await p.evaluate(()=>window.edgePushes),0);}
  else assert.equal(await p.evaluate(()=>window.edgePushes),1);
 }
});
test('F-03 all four items stay reachable at every edge and viewport',async t=>{
 const rows=[];
 for(const [width,height] of [[320,180],[375,812],[390,844],[812,375]]){
  const p=await open(t,'/qa',{viewport:{width,height},hasTouch:true,isMobile:true,reducedMotion:'reduce'}),send=await touch(p);
  for(const [name,x,y] of [['top-left',1,1],['bottom-right',width-1,height-1],['top-right',width-1,1],['bottom-left',1,height-1]]){
   await send('touchStart',await middle(center(p)));await send('touchMove',{x,y});await send('touchEnd');await delay(80);
   const before=await center(p).boundingBox();
   await send('touchStart',await middle(center(p)));await delay(510);await send('touchEnd');
   assert.equal(await center(p).getAttribute('aria-expanded'),'true');
   assert.deepEqual(await center(p).boundingBox(),before,'opening must not reduce the anchor range');
   for(let i=0;i<4;i++){
    await item(p,i).focus();await item(p,i).scrollIntoViewIfNeeded();const b=await item(p,i).boundingBox();
    assert.ok(b.height>=44&&b.width>=44&&b.x>=8&&b.y>=8&&b.x+b.width<=width-8.01+0.02&&b.y+b.height<=height-8.01+0.02,JSON.stringify({width,height,name,i,b}));
    assert.equal(await item(p,i).evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;}),true);
    rows.push({width,height,corner:name,item:i,...b});
   }
   if(process.env.EDGE_FIX_EVIDENCE)await p.screenshot({path:`${process.env.EDGE_FIX_EVIDENCE}/edge-${width}x${height}-${name}.png`});
   await p.keyboard.press('Escape');
  }
 }
 await save('edge-items',rows);
});
test('F-05 selection and context-menu suppression is local to navigation',async t=>{
 const p=await open(t,'/contact',{reducedMotion:'reduce'});
 await center(p).focus();
 const styles=await center(p).evaluate(el=>({select:getComputedStyle(el).userSelect,webkitSelect:getComputedStyle(el).webkitUserSelect,callout:getComputedStyle(el).getPropertyValue('-webkit-touch-callout')}));
 assert.equal(styles.select,'none');assert.equal(styles.webkitSelect,'none');
 const context=await p.evaluate(()=>{
  function prevented(el){const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented;}
  return{nav:prevented(document.querySelector('.edge-scroll')),input:prevented(document.querySelector('#contact-name')),body:prevented(document.querySelector('main p'))};
 });
 assert.deepEqual(context,{nav:true,input:false,body:false});
 await p.locator('#contact-name').fill('Safari コピー確認');await p.locator('#contact-name').selectText();
 assert.deepEqual(await p.locator('#contact-name').evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,value:el.value})),{start:0,end:12,value:'Safari コピー確認'});
 await p.locator('main p').first().dblclick();assert.ok((await p.evaluate(()=>getSelection().toString())).length>0);
 await save('selection',{styles,context});
});
test('ordinary page swipe, AT-style activation and keyboard shortcuts remain available',async t=>{
 const p=await open(t,'/qa',{viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'}),send=await touch(p);
 await send('touchStart',{x:40,y:650});for(let y=600;y>=300;y-=50){await delay(65);await send('touchMove',{x:40,y});}await send('touchEnd');await p.waitForFunction(()=>scrollY>100);
 await p.evaluate(()=>document.querySelector('.edge-scroll').click());await item(p,0).waitFor();await p.waitForFunction(()=>document.activeElement?.dataset.edgeDestination==='0');
 await p.keyboard.press('Escape');
 await center(p).dispatchEvent('click',{detail:1});await p.waitForFunction(()=>document.activeElement?.dataset.edgeDestination==='0');
 await p.keyboard.press('Escape');await center(p).focus();await p.keyboard.press('ArrowDown');assert.equal(await item(p,0).evaluate(el=>document.activeElement===el),true);
 await p.keyboard.press('Escape');await p.keyboard.press('Home');await p.waitForFunction(()=>scrollY===0);
 const before=await center(p).boundingBox();await p.keyboard.press('Alt+ArrowLeft');const after=await center(p).boundingBox();assert.ok(after.x<before.x);
 assert.equal(await p.evaluate(()=>window.edgeWrites.filter(x=>x.storage==='local').length),0);
});
