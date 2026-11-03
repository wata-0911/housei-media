import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// JSDOM is deliberately an optional local QA tool, not a product dependency.
const { JSDOM } = await import(process.env.CALENDAR_JSDOM_MODULE || 'jsdom');
const originalFetch=globalThis.fetch, originalCreate=URL.createObjectURL, originalRevoke=URL.revokeObjectURL;
let Page, root, dom, created, revoked, calls, fetchHandler;
before(async()=>{
  const directory=resolve('node_modules/.cache/calendar-draft-ui');await mkdir(directory,{recursive:true});
  const output=resolve(directory,'page.mjs');
  await build({entryPoints:['src/pages/CalendarApprovePage.tsx'],outfile:output,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',define:{'import.meta.env.VITE_LIFF_ID':'"mock-liff-id"'},plugins:[{name:'mock-liff',setup(builder){builder.onResolve({filter:/^@line\/liff$/},()=>({path:'liff',namespace:'mock'}));builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export default {init:async()=>{},isLoggedIn:()=>globalThis.mockLiff.loggedIn,getDecodedIDToken:()=>({name:"Mock member"}),getIDToken:()=>globalThis.mockLiff.token,isInClient:()=>false,login:()=>{globalThis.mockLiff.loginCalled=true}};'}));}}]});
  Page=(await import(pathToFileURL(output).href)).default;
  await rm(output);
});
beforeEach(()=>{
  dom=new JSDOM('<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',{url:'https://app.test/calendar-approve'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.mockLiff={loggedIn:true,token:'raw-token'};created=[];revoked=[];calls=[];
  URL.createObjectURL=blob=>{assert.ok(blob.size>0);const url=`blob:mock-${created.length}`;created.push(url);return url;};
  URL.revokeObjectURL=url=>revoked.push(url);
  fetchHandler=async url=>url==='/api/calendar-auth'?Response.json({authorized:true}):imageResponse();
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return fetchHandler(url,init);};
  root=createRoot(document.getElementById('root'));
});
afterEach(async()=>{if(root)await act(async()=>root.unmount());dom.window.close();globalThis.fetch=originalFetch;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;delete globalThis.window;delete globalThis.document;delete globalThis.mockLiff;delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
function imageResponse({month='2026-11',generatedAt='2026-11-02T03:00:00.000Z',contentType='image/png'}={}){return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':contentType,'X-Calendar-Year-Month':month,'X-Calendar-Generated-At':generatedAt}});}
async function render(){await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Page))));}
async function unmount(){await act(async()=>root.unmount());root=null;}
function disabled(){const buttons=[...document.querySelectorAll('button')].filter(b=>['修正が必要','この画像を承認'].includes(b.textContent.trim()));assert.equal(buttons.length,2);assert.ok(buttons.every(b=>b.disabled));}
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};}

test('authorized preview posts raw token twice; metadata shown and controls disabled',async()=>{await render();assert.deepEqual(calls.map(c=>[c.url,JSON.parse(c.init.body)]),[['/api/calendar-auth',{idToken:'raw-token'}],['/api/calendar-draft',{idToken:'raw-token'}]]);assert.equal(document.querySelector('img').getAttribute('src'),'blob:mock-0');assert.equal(document.querySelector('img').alt,'2026-11 カレンダー下書き');assert.equal(document.querySelector('time').dateTime,'2026-11-02T03:00:00.000Z');assert.ok(document.body.textContent.includes('対象月：2026-11'));assert.ok(calls.every(c=>c.init.cache==='no-store'));disabled();});
test('unknown historical generation time is explicit',async()=>{fetchHandler=async url=>url.includes('auth')?Response.json({authorized:true}):imageResponse({generatedAt:''});await render();assert.ok(document.body.textContent.includes('生成日時：不明'));assert.equal(document.querySelector('time'),null);disabled();});
test('logged out requires login and never calls APIs',async()=>{mockLiff.loggedIn=false;await render();const login=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('LINEでログイン'));await act(async()=>login.click());assert.equal(mockLiff.loginCalled,true);assert.equal(calls.length,0);disabled();});
test('missing raw token never calls APIs',async()=>{mockLiff.token=null;await render();assert.equal(calls.length,0);assert.match(document.querySelector('[role="alert"]').textContent,/IDトークンを取得できません/);disabled();});
for(const status of [400,401,403,502,503])test(`auth ${status} never requests image`,async()=>{fetchHandler=async()=>Response.json({authorized:false},{status});await render();assert.equal(calls.length,1);assert.equal(document.querySelector('img'),null);assert.equal(created.length,0);assert.ok(document.querySelector('[role="alert"]'));disabled();});
test('HTTP200 auth without authorized true never calls draft',async()=>{fetchHandler=async()=>Response.json({authorized:false});await render();assert.equal(calls.length,1);assert.equal(created.length,0);disabled();});
for(const [status,code,text] of [[404,'draft_not_ready','表示できる下書き'],[401,undefined,'LINE認証情報が無効'],[403,undefined,'グループへの所属'],[502,'draft_bridge_auth','下書き取得先の認証設定'],[502,'draft_invalid_response','有効なカレンダー画像'],[503,'server_config','設定が不足'],[504,'draft_timeout','タイムアウト']])test(`draft ${status}/${code} distinguished`,async()=>{fetchHandler=async url=>url.includes('auth')?Response.json({authorized:true}):Response.json({ok:false,code},{status});await render();assert.ok(document.querySelector('[role="alert"]').textContent.includes(text));assert.equal(document.querySelector('img'),null);assert.equal(created.length,0);disabled();});
for(const options of [{month:'2026-99'},{generatedAt:'unsafe'},{contentType:'text/html'}])test('malformed success metadata/MIME never creates Blob URL',async()=>{fetchHandler=async url=>url.includes('auth')?Response.json({authorized:true}):imageResponse(options);await render();assert.equal(created.length,0);assert.equal(document.querySelector('img'),null);assert.ok(document.querySelector('[role="alert"]'));disabled();});
test('loading state visible; resolved authorized draft replaces it',async()=>{const pending=deferred();fetchHandler=async url=>url.includes('auth')?Response.json({authorized:true}):pending.promise;await render();assert.ok(document.body.textContent.includes('カレンダー画像を取得中'));assert.equal(document.querySelector('[aria-busy="true"]')!==null,true);disabled();await act(async()=>pending.resolve(imageResponse()));assert.ok(document.querySelector('img'));disabled();});
test('unmount aborts requests and revokes the created URL exactly once',async()=>{await render();const signals=calls.map(c=>c.init.signal);await unmount();assert.ok(signals.every(s=>s.aborted));assert.deepEqual(revoked,created);assert.equal(document.querySelector('meta[name="robots"]'),null);});
test('late fetch response after unmount cannot create stale URL',async()=>{const pending=deferred();fetchHandler=async url=>url.includes('auth')?Response.json({authorized:true}):pending.promise;await render();const signal=calls[1].init.signal;await unmount();assert.equal(signal.aborted,true);await act(async()=>pending.resolve(imageResponse()));assert.equal(created.length,0);});
test('late Blob read after unmount cannot create stale URL',async()=>{const pending=deferred();fetchHandler=async url=>{if(url.includes('auth'))return Response.json({authorized:true});const response=imageResponse();response.blob=()=>pending.promise;return response;};await render();await unmount();await act(async()=>pending.resolve(new Blob(['test'],{type:'image/png'})));assert.equal(created.length,0);});
test('late auth success after unmount never starts draft fetch',async()=>{const pending=deferred();fetchHandler=()=>pending.promise;await render();await unmount();await act(async()=>pending.resolve(Response.json({authorized:true})));assert.equal(calls.length,1);assert.equal(created.length,0);});
test('remount requests fresh auth and draft, not old token authority or Blob URL',async()=>{await render();await unmount();root=createRoot(document.getElementById('root'));await render();assert.equal(calls.length,4);assert.deepEqual(revoked,['blob:mock-0']);assert.equal(document.querySelector('img').src,'blob:mock-1');disabled();});
test('image display failure hides preview but never enables actions',async()=>{await render();await act(async()=>document.querySelector('img').dispatchEvent(new window.Event('error')));assert.equal(document.querySelector('img'),null);assert.ok(document.querySelector('[role="alert"]').textContent.includes('表示できません'));disabled();});
test('initial auth config503 identifies configuration rather than generic LINE failure',async()=>{fetchHandler=async()=>Response.json({code:'auth_server_config',error:'not echoed'},{status:503});await render();assert.equal(document.querySelector('[role="alert"]').textContent,'認証サーバーの設定が不足しています。');assert.equal(calls.length,1);disabled();});
for(const [code,text]of [['line_membership_unavailable','LINEグループへの所属を確認できませんでした。時間をおいて再度お試しください。'],['line_verification_unavailable','LINE認証サービスを確認できませんでした。時間をおいて再度お試しください。'],['auth_server_config','認証サーバーの設定が不足しています。'],['draft_upstream','下書き取得先でエラーが発生しました。']])test(`draft taxonomy ${code} is explicit and does not echo upstream`,async()=>{fetchHandler=async url=>url.includes('auth')?Response.json({authorized:true}):Response.json({code,error:'untrusted detail'},{status:code==='auth_server_config'?503:502});await render();assert.equal(document.querySelector('[role="alert"]').textContent,text);assert.ok(!document.body.textContent.includes('untrusted detail'));assert.equal(created.length,0);disabled();});
test('image onError revokes immediately and unmount never double revokes',async()=>{await render();const image=document.querySelector('img');await act(async()=>image.dispatchEvent(new window.Event('error')));assert.deepEqual(revoked,['blob:mock-0']);assert.equal(document.querySelector('img'),null);await unmount();assert.deepEqual(revoked,['blob:mock-0']);});
