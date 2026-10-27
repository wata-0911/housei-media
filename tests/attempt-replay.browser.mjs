import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { replayBrowser } from './helpers/replay-browser.mjs';
import { replayFixture } from './fixtures/replay-state-fixture.mjs';
let runtime,raw24,raw23;
before(async()=>{runtime=await replayBrowser();raw24=(await replayFixture(24,'normal',100)).raw;raw23=(await replayFixture(23,'normal',100)).raw;});
after(async()=>{await runtime?.close();});
async function page(t){const p=await runtime.browser.newPage();await p.goto(runtime.origin);t.after(()=>p.close());return p;}
for(const [version,raw]of [[23,()=>raw23],[24,()=>raw24]])test('native Worker schema'+version+': all state/Workspace/reservation values match full legacy replay; no writes or IDs',async t=>{
 const p=await page(t);const result=await p.evaluate(async raw=>{
  const api=replayClient.createReplayClient(()=>new Worker('/observed.js',{type:'module'}));
  const result=await api.replay(raw);return {result,dbs:await indexedDB.databases()};
 },raw());assert.equal(result.result.summary.schemaVersion,version);assert.equal(result.result.summary.commands,100);assert.deepEqual(result.dbs,[]);assert.ok(JSON.stringify(result.result).length<1024);
});
test('native Worker input/resource/internal failures are safe and have no partial success',async t=>{
 const p=await page(t);const results=await p.evaluate(async raw=>{
  const run=async(wire,url='/replay.worker.ts')=>{const api=replayClient.createReplayClient(()=>new Worker(url,{type:'module'}));try{return {success:await api.replay(wire)};}catch(e){return {kind:e.kind,code:e.code,remote:e.remote,message:e.message};}};
  return [await run('{'),await run('"'+'日'.repeat(23000000)+'"'),await run(raw,'/fault.js'),await run(raw,'/startup-fault.js')];
 },raw24);
 assert.deepEqual(results.map(x=>x.kind),['invalid_input','resource_limit','internal','startup_failure']);assert.ok(!JSON.stringify(results).includes('synthetic secret'));for(const r of results)assert.equal(r.success,undefined);
});
test('native Worker malformed/nonstring/giant protocol messages reject',async t=>{
 const p=await page(t);const values=await p.evaluate(async()=>{
  const run=message=>new Promise(resolve=>{const w=new Worker('/replay.worker.ts',{type:'module'});w.onmessage=e=>{w.terminate();resolve(e.data);};w.postMessage(message);});
  const out=[];for(const message of [{kind:'replay'},'hello:0','garbage',' '.repeat(64*1024*1024+101)])out.push(await run(message));return out;
 });assert.deepEqual(values,Array(4).fill('invalid_replay_request'));
});
test('native Worker cancel/terminate/restart has no stale success',async t=>{
 const p=await page(t);const result=await p.evaluate(async raw=>{
  const workers=[];const api=replayClient.createReplayClient(()=>{const w=new Worker('/replay.worker.ts',{type:'module'});workers.push(w);return w;});
  const ac=new AbortController();const old=api.replay(raw,ac.signal).then(()=> 'success',e=>e.kind);ac.abort();const cancelled=await old;
  const next=await api.replay(raw);return {cancelled,next,workers:workers.length,dbs:await indexedDB.databases()};
 },raw24);assert.equal(result.cancelled,'cancelled');assert.equal(result.next.summary.commands,100);assert.equal(result.workers,2);assert.deepEqual(result.dbs,[]);
});
test('Vite build recognizes actual Dedicated Worker entry without production UI integration',async()=>{
 const {build}=await import('vite');const {mkdtemp,readFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const out=await mkdtemp(join(tmpdir(),'replay-vite-'));
 const result=await build({configFile:false,logLevel:'silent',build:{outDir:out,emptyOutDir:false,minify:false,rollupOptions:{preserveEntrySignatures:'exports-only',input:new URL('../src/planner/attempts/replay/client.ts',import.meta.url).pathname}}});
 const chunks=result.output.filter(x=>x.type==='chunk');assert.ok(chunks.length);assert.match(chunks[0].code,/read-only-attempt-replay/);
 const {readdir}=await import('node:fs/promises');assert.ok((await readdir(join(out,'assets'))).some(x=>/replay\.worker.*\.js/.test(x)));
 for(const file of await readdir(join(out,'assets')))if(/replay\.worker.*\.js/.test(file)){const code=await readFile(join(out,'assets',file),'utf8');assert.ok(!code.includes('createAttemptPersistence'));assert.ok(!code.includes('indexedDB.open'));assert.ok(!code.includes('randomUUID'));}
});
test('terminate a dispatched CPU replay; no partial result; fresh epoch can finish',async t=>{
 const p=await page(t);const result=await p.evaluate(async raw=>{
  let cancelFirst=true,dispatched=0,api;
  api=replayClient.createReplayClient(()=>{const w=new Worker('/replay.worker.ts',{type:'module'});return {
   postMessage(m){w.postMessage(m);if(m.startsWith('replay:')){dispatched++;if(cancelFirst){cancelFirst=false;setTimeout(()=>api.cancel(),30);}}},terminate(){w.terminate();},set onmessage(h){w.onmessage=h;},set onerror(h){w.onerror=h;},set onmessageerror(h){w.onmessageerror=h;}
  };});
  const first=await api.replay(raw).then(()=>({success:true}),e=>({kind:e.kind}));const next=await api.replay(raw);return {first,next,dispatched};
 },raw24);assert.deepEqual(result.first,{kind:'cancelled'});assert.equal(result.dispatched,2);assert.equal(result.next.summary.commands,100);
});
test('native Worker rejects wrong epoch and duplicate dispatch before pending completion',async t=>{
 const p=await page(t);const result=await p.evaluate(async raw=>{
  async function run(mode){const w=new Worker(mode==='duplicate'?'/pending.js':'/replay.worker.ts',{type:'module'});const out=[];await new Promise(resolve=>{w.onmessage=e=>{out.push(e.data);if(out.length===1){if(mode==='epoch')w.postMessage('replay:8:1\n'+raw);else{w.postMessage('replay:7:1\n'+raw);w.postMessage('replay:7:1\n'+raw);}}else{w.terminate();resolve();}};w.postMessage('hello:7');});return out;}
  return [await run('epoch'),await run('duplicate')];
 },raw24);for(const messages of result){assert.equal(JSON.parse(messages[0]).type,'ready');assert.equal(messages[1],'invalid_replay_request');}
});
test('native ESM default client factory resolves and runs the actual module Worker URL',async t=>{
 const p=await page(t);const result=await p.evaluate(async raw=>{
  const {createReplayClient}=await import('/native-client.js');const result=await createReplayClient().replay(raw);return {result,dbs:await indexedDB.databases()};
 },raw24);assert.equal(result.result.summary.commands,100);assert.equal(result.result.summary.schemaVersion,24);assert.deepEqual(result.dbs,[]);
});
