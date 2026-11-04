// Local: PLANNER_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node --import tsx --test tests/page-edge-navigation-fixes.browser.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const origin = `http://127.0.0.1:${process.env.PLANNER_BROWSER_PORT || 4298}`;
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
const nav = p => p.getByRole('navigation', { name: 'ページ移動', exact: true });
const toggle = p => nav(p).locator('.edge-scroll');
const item = (p, i) => p.locator(`[data-edge-destination="${i}"]`);
async function expand(p) {
  await toggle(p).focus();
  if (await toggle(p).getAttribute('aria-expanded') !== 'true') await toggle(p).press('Space');
}
async function evidence(name, data) {
  if (!process.env.EDGE_FIX_EVIDENCE) return;
  await mkdir(process.env.EDGE_FIX_EVIDENCE, { recursive: true });
  await writeFile(`${process.env.EDGE_FIX_EVIDENCE}/${name}.json`, JSON.stringify(data, null, 2));
}
// Original independent-review counterexamples: same page, input and Escape steps.
test('F-01 original: closed navigation must preserve Header search Escape restoration', async t => {
  const p = await open(t, '/contact');
  await p.getByRole('button', { name: '検索を開く', exact: true }).click();
  await p.locator('#header-search').fill('独立確認'); await delay(120);
  assert.equal(await toggle(p).getAttribute('aria-expanded'), 'false');
  await p.keyboard.press('Escape'); await delay(120);
  assert.equal(await p.locator('#header-search').count(), 0);
  assert.equal(await p.getByRole('button', { name: '検索を開く', exact: true }).evaluate(el => el === document.activeElement), true);
  assert.equal(await toggle(p).getAttribute('aria-expanded'), 'false');
});
test('F-01 original: closed navigation must leave contact-name focused on Escape', async t => {
  const p = await open(t, '/contact');
  await p.locator('#contact-name').focus();
  assert.equal(await toggle(p).getAttribute('aria-expanded'), 'false');
  await p.keyboard.press('Escape'); await delay(80);
  assert.equal(await p.evaluate(() => document.activeElement.id), 'contact-name');
});
test('F-01 open navigation: internal focus restores; external focus retained; handled Escape respected', async t => {
  const p = await open(t, '/contact');
  await expand(p); await item(p, 0).focus(); await p.keyboard.press('Escape');
  assert.equal(await toggle(p).getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle(p).evaluate(el => el === document.activeElement), true);
  await toggle(p).press('Space'); assert.equal(await toggle(p).getAttribute('aria-expanded'), 'true');
  await toggle(p).press('Space'); assert.equal(await toggle(p).getAttribute('aria-expanded'), 'false');
  await p.locator('#contact-name').focus(); await toggle(p).hover();
  assert.equal(await toggle(p).getAttribute('aria-expanded'), 'true');
  await p.keyboard.press('Escape');
  assert.equal(await toggle(p).getAttribute('aria-expanded'), 'false');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'contact-name');
  await p.mouse.move(0, 0); await expand(p); await item(p, 0).focus();
  await p.evaluate(() => document.querySelector('[data-edge-destination="0"]').addEventListener('keydown', e => { if (e.key === 'Escape') e.preventDefault(); }));
  await p.keyboard.press('Escape');
  assert.equal(await toggle(p).getAttribute('aria-expanded'), 'true');
  assert.equal(await item(p, 0).evaluate(el => el === document.activeElement), true);
});
const sizes = [[320,180], [320,568], [375,812], [390,844], [640,320], [844,390]];
test('F-02 original geometry: readable 44px targets, scroll reachability and bounds at every viewport', async t => {
  const rows = [];
  for (const [width,height] of sizes) {
    const p = await open(t, '/qa', { viewport: {width,height}, reducedMotion: 'reduce' });
    await expand(p);
    const row = { width, height, items: [] };
    for (let i=0;i<4;i++) {
      await item(p,i).focus();
      await item(p,i).scrollIntoViewIfNeeded();
      row.items.push(await item(p,i).evaluate(el => {
        const r=el.getBoundingClientRect(), root=el.closest('.page-edge-navigation').getBoundingClientRect();
        const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return {width:r.width,height:r.height,fontSize:getComputedStyle(el).fontSize,x:r.x,y:r.y,right:r.right,bottom:r.bottom,hit:hit===el,root:{x:root.x,y:root.y,right:root.right,bottom:root.bottom}, transform:getComputedStyle(el.closest('.page-edge-navigation')).transform};
      }));
      if (process.env.EDGE_FIX_EVIDENCE) await p.screenshot({path:`${process.env.EDGE_FIX_EVIDENCE}/viewport-${width}x${height}-item-${i}.png`});
    }
    rows.push(row);
    await p.context().close();
  }
  await evidence('geometry', rows);
  for (const row of rows) for (const b of row.items) {
    assert.ok(b.height >= 44 && b.width >= 44, JSON.stringify({viewport:row, item:b}));
    assert.ok(parseFloat(b.fontSize)>=11 && b.transform === 'none');
    assert.ok(b.x>=0 && b.y>=0 && b.right<=row.width && b.bottom<=row.height && b.hit, JSON.stringify(b));
    assert.ok(b.root.x>=0 && b.root.y>=0 && b.root.right<=row.width && b.root.bottom<=row.height);
  }
});
test('F-02 compact: every destination reachable by keyboard and real tap; no compact flick commit', async t => {
  for (const touchMode of [false,true]) {
    const p = await open(t, '/qa', {viewport:{width:320,height:180},isMobile:touchMode,hasTouch:touchMode,reducedMotion:'reduce'});
    for (let i=0;i<4;i++) {
      await p.goto(origin+'/qa');
      if (touchMode) {
        const session=await p.context().newCDPSession(p), b=await toggle(p).boundingBox();
        await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});await delay(510);
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } else await expand(p);
      for (let j=0;j<=i;j++) {
        if (!touchMode) await p.keyboard.press('Tab');
      }
      if (touchMode) { await item(p,i).scrollIntoViewIfNeeded(); await item(p,i).tap(); }
      else { assert.equal(await item(p,i).evaluate(el=>el===document.activeElement),true); await p.keyboard.press('Enter'); }
      const id=['course-query','planner-start','planned-heading','media-panel'][i];
      await p.waitForFunction(id=>document.activeElement.id===id,id);
      assert.equal(await p.evaluate(()=>localStorage.length),0);
    }
    if (touchMode) {
      await p.goto(origin+'/qa');
      const session=await p.context().newCDPSession(p);
      const b=await toggle(p).boundingBox(), x=b.x+b.width/2,y=b.y+b.height/2;
      const dispatch=(type,x,y)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
      await dispatch('touchStart',x,y); await delay(510);
      await item(p,0).waitFor(); const target=await item(p,0).boundingBox();
      await dispatch('touchMove',target.x+target.width/2,target.y+target.height/2); await dispatch('touchEnd');
      assert.equal(new URL(p.url()).pathname,'/qa','compact flick requires a separate tap');
      assert.equal(await toggle(p).getAttribute('aria-expanded'),'true');
      await item(p,0).tap(); await p.waitForFunction(()=>document.activeElement.id==='course-query');
    }
  }
});
test('F-02 rotation, drag, visualViewport and safe-area bounds',async t=>{
  const p=await open(t,'/qa',{viewport:{width:320,height:180},reducedMotion:'reduce'});
  for (const [width,height] of [[320,180],[844,390],[320,568],[375,812],[390,844]]) {
    await p.setViewportSize({width,height});
    await expand(p);
    const drag=await nav(p).locator('.edge-scroll').boundingBox();
    await p.mouse.move(drag.x+10,drag.y+10); await p.mouse.down(); await p.mouse.move(width+100,height+100,{steps:8}); await p.mouse.up();
    await expand(p);
    for(let i=0;i<4;i++){
      await item(p,i).focus();await item(p,i).scrollIntoViewIfNeeded();
      const b=await item(p,i).boundingBox();assert.ok(b.height>=44&&b.x>=0&&b.y>=0&&b.x+b.width<=width&&b.y+b.height<=height);
    }
  }
  // Simulated insets supplement actual viewport tests; not an iOS device claim.
  await p.locator('.edge-safe-area').evaluate(el=>{el.style.padding='16px 12px 20px 12px';});
  await p.evaluate(()=>dispatchEvent(new Event('resize')));await delay(80);await expand(p);
  const session=await p.context().newCDPSession(p);
  await session.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});await delay(100);await expand(p);
  const result=await nav(p).evaluate(el=>{
    const b=el.getBoundingClientRect(),v=visualViewport;
    return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,left:v.offsetLeft,top:v.offsetTop,width:v.width,height:v.height};
  });
  assert.ok(result.x>=result.left+12&&result.y>=result.top+16&&result.right<=result.left+result.width-12&&result.bottom<=result.top+result.height-20,JSON.stringify(result));
  for(let i=0;i<4;i++){
    await item(p,i).focus();await item(p,i).scrollIntoViewIfNeeded();const b=await item(p,i).boundingBox();
    assert.ok(b.height>=44&&b.x>=result.left+12&&b.y>=result.top+16&&b.x+b.width<=result.left+result.width-12&&b.y+b.height<=result.top+result.height-20,JSON.stringify(b));
  }
});
test('F-01 Escape cancels active long press without navigation or synthetic click',async t=>{
  const p=await open(t,'/qa',{viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const session=await p.context().newCDPSession(p), b=await toggle(p).boundingBox();
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+20,y:b.y+20}]});await delay(510);
  assert.equal(await toggle(p).getAttribute('aria-expanded'),'true');await p.keyboard.press('Escape');
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await toggle(p).getAttribute('aria-expanded'),'false');assert.equal(new URL(p.url()).pathname,'/qa');
});
test('F-01/F-02 regression: three site pages × four shortcuts preserve all storage',async t=>{
  const p=await open(t,'/',{reducedMotion:'reduce'});
  const routes=[];
  for(const path of ['/','/qa','/contact']) for(let i=0;i<4;i++){
    await p.goto(origin+path);await expand(p);
    const before=await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));
    const beforeWrites=await p.evaluate(()=>window.edgeWrites);
    const beforeSession=await p.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).map(k=>[k,sessionStorage.getItem(k)])));
    await item(p,i).click();
    const id=['course-query','planner-start','planned-heading','media-panel'][i];
    await p.waitForFunction(id=>document.activeElement?.id===id,id);
    assert.deepEqual(await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))),before);
    await evidence('storage-observation',await p.evaluate(()=>window.edgeWrites));
    assert.deepEqual(await p.evaluate(()=>window.edgeWrites),beforeWrites,'navigation adds no Storage writes');
    assert.equal(await p.evaluate(()=>window.edgeWrites.filter(x=>x.storage==='local').length),0,'no localStorage writes including Planner JSON');
    assert.deepEqual(await p.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).map(k=>[k,sessionStorage.getItem(k)]))),beforeSession);
    routes.push({from:path,destination:i,url:p.url(),focus:id});
  }
  await evidence('routes',routes);
});
