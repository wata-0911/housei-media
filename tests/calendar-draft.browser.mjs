// Local deterministic UI QA; no live LINE/GAS. CALENDAR_PLAYWRIGHT_MODULE may point to an installed Playwright.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const origin = `http://127.0.0.1:${process.env.CALENDAR_BROWSER_PORT || 4193}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64');
let browser, server;
before(async () => {
  const { chromium } = await import(process.env.CALENDAR_PLAYWRIGHT_MODULE || 'playwright');
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',new URL(origin).port,'--strictPort'], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, VITE_LIFF_ID: 'mock-liff-id' }, stdio: 'pipe',
  });
  let output=''; server.stdout.on('data',b=>output+=b); server.stderr.on('data',b=>output+=b);
  let ready=false;
  for (let i=0;i<100;i++) { if(server.exitCode!==null) throw new Error(output); try {if((await fetch(origin)).ok){ready=true;break;}}catch{} await delay(100); }
  assert.ok(ready,output);
  browser=await chromium.launch({headless:true,...(process.env.CALENDAR_BROWSER_EXECUTABLE?{executablePath:process.env.CALENDAR_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
});
after(async()=>{await browser?.close();server?.kill();});
async function open(t, options={}) {
  const context=await browser.newContext({viewport:{width:390,height:844}});t.after(()=>context.close());
  const calls=[];
  await context.addInitScript(({loggedOut})=>{
    window.mockLoggedOut=loggedOut; window.previewCreated=[];window.previewRevoked=[];window.apiAborts=[];
    const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=(blob)=>{const url=create(blob);window.previewCreated.push(url);return url;};
    URL.revokeObjectURL=(url)=>{window.previewRevoked.push(url);return revoke(url);};
    const original=window.fetch.bind(window);
    window.fetch=(url, init)=>{if(String(url).includes('/api/calendar-'))init.signal?.addEventListener('abort',()=>window.apiAborts.push(String(url)));return original(url,init);};
  },{loggedOut:options.loggedOut||false});
  await context.route('**/*',async route=>{
    const url=route.request().url();
    if(url.includes('/@line_liff')||url.includes('/@line/liff')||url.includes('/node_modules/@line/liff/')) return route.fulfill({contentType:'application/javascript',body:`export default {init:async()=>{},isLoggedIn:()=>!window.mockLoggedOut,getDecodedIDToken:()=>({name:'Mock member'}),getIDToken:()=> 'raw-mock-token',isInClient:()=>false,login:()=>{window.mockLoginCalled=true}};`});
    if(url.endsWith('/api/calendar-auth')) { calls.push({kind:'auth',body:route.request().postDataJSON()});return route.fulfill({status:options.authStatus||200,contentType:'application/json',body:JSON.stringify({authorized:options.authStatus?false:true})}); }
    if(url.endsWith('/api/calendar-draft')) {
      calls.push({kind:'draft',body:route.request().postDataJSON()});
      if(options.holdDraft){options.holdDraft(route);return;}
      if(options.draftStatus) return route.fulfill({status:options.draftStatus,contentType:'application/json',body:JSON.stringify({ok:false,code:options.code})});
      return route.fulfill({status:200,contentType:'image/png',headers:{'X-Calendar-Year-Month':options.month||'2026-11','X-Calendar-Generated-At':options.generatedAt??'2026-11-02T03:00:00.000Z'},body:png});
    }
    if(new URL(url).origin!==origin) return route.abort();
    return route.continue();
  });
  const page=await context.newPage();await page.goto(origin+'/calendar-approve');
  return {page,calls};
}
async function disabled(page) { for(const name of ['修正が必要','この画像を承認']) assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true); }

test('authorized mobile preview uses raw ID token, paired metadata, no horizontal overflow and disabled actions',async t=>{
  const {page,calls}=await open(t);const image=page.getByRole('img',{name:'2026-11 カレンダー下書き'});await image.waitFor();
  await page.waitForFunction(()=>document.querySelector('img[alt*="下書き"]')?.naturalWidth>0);
  assert.deepEqual(calls,[{kind:'auth',body:{idToken:'raw-mock-token'}},{kind:'draft',body:{idToken:'raw-mock-token'}}]);
  assert.ok(await page.getByText('対象月：2026-11').isVisible());assert.equal(await page.locator('time').getAttribute('datetime'),'2026-11-02T03:00:00.000Z');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await disabled(page);
  await page.screenshot({path:'/tmp/calendar-draft-mobile.png',fullPage:true});
});
test('unknown historical generation time is shown explicitly',async t=>{const {page}=await open(t,{generatedAt:''});await page.getByRole('img',{name:'2026-11 カレンダー下書き'}).waitFor();assert.ok(await page.getByText('生成日時：不明').isVisible());await disabled(page);});
test('logged-out flow never requests draft and login stays usable',async t=>{const {page,calls}=await open(t,{loggedOut:true});await page.getByRole('button',{name:'LINEでログイン'}).click();assert.equal(await page.evaluate(()=>window.mockLoginCalled),true);assert.deepEqual(calls,[]);await disabled(page);});
for(const status of [401,403,502]) test(`auth ${status} never requests draft`,async t=>{const {page,calls}=await open(t,{authStatus:status});await page.getByRole('alert').waitFor();assert.deepEqual(calls.map(c=>c.kind),['auth']);assert.equal(await page.getByRole('img',{name:/下書き/}).count(),0);await disabled(page);});
for(const [status,code,text] of [[404,'draft_not_ready','表示できる下書きはまだありません。'],[401,undefined,'LINE認証情報が無効または期限切れです。再ログインしてください。'],[403,undefined,'承認用グループへの所属を確認できません。'],[502,'draft_bridge_auth','下書き取得先の認証設定を確認してください。'],[502,'draft_invalid_response','有効なカレンダー画像と日時情報を取得できませんでした。'],[503,'server_config','下書き取得サーバーの設定が不足しています。'],[504,'draft_timeout','下書き取得がタイムアウトしました。']]) test(`draft ${status}/${code} shows correct error, no image`,async t=>{const {page}=await open(t,{draftStatus:status,code});await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('alert').textContent(),text);assert.equal(await page.getByRole('img',{name:/下書き/}).count(),0);await disabled(page);});
test('malformed metadata never creates Blob URL or shows image',async t=>{const {page}=await open(t,{month:'2026-99'});await page.getByRole('alert').waitFor();assert.deepEqual(await page.evaluate(()=>window.previewCreated),[]);await disabled(page);});
test('unmount revokes Blob URL; back navigation reauthenticates with a new preview',async t=>{
  const {page,calls}=await open(t);await page.getByRole('img',{name:/下書き/}).waitFor();const first=await page.evaluate(()=>window.previewCreated[0]);
  await page.getByRole('link',{name:'法政通信メディア',exact:true}).first().click();await page.waitForURL(origin+'/');
  assert.ok((await page.evaluate(()=>window.previewRevoked)).includes(first));await page.goBack();await page.getByRole('img',{name:/下書き/}).waitFor();
  assert.equal(calls.filter(c=>c.kind==='draft').length,2);await disabled(page);
});
test('pending draft aborts on navigation; late response cannot create stale preview',async t=>{
  let held;const {page}=await open(t,{holdDraft:route=>held=route});await page.getByText('カレンダー画像を取得中...').waitFor();await disabled(page);
  await page.getByRole('link',{name:'法政通信メディア',exact:true}).first().click();await page.waitForURL(origin+'/');
  assert.ok((await page.evaluate(()=>window.apiAborts)).includes('/api/calendar-draft'));
  await held.fulfill({status:200,contentType:'image/png',headers:{'X-Calendar-Year-Month':'2026-11','X-Calendar-Generated-At':''},body:png}).catch(()=>{});
  assert.deepEqual(await page.evaluate(()=>window.previewCreated),[]);assert.equal(await page.getByRole('img',{name:/下書き/}).count(),0);
});
