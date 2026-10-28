import test from 'node:test';import assert from 'node:assert/strict';
import {createControllerWorkerClient} from '../src/planner/attempts/persistence/worker/client.ts';
import {validateControl,parseResponse} from '../src/planner/attempts/persistence/worker/protocol.ts';
const t='a'.repeat(48),u='b'.repeat(48);
function mock(){const sent=[];let killed=0;const w={postMessage:x=>sent.push(x),terminate:()=>killed++,onmessage:null,onerror:null,onmessageerror:null};const client=createControllerWorkerClient(()=>w,{startup:1000,job:1000});const boot=JSON.parse(sent[0]).boot;const send=r=>w.onmessage?.({data:JSON.stringify(r)});return {w,client,sent,boot,send,get killed(){return killed;},ready(){send({version:1,boot,type:'ready',mode:'preview-only'});}};}
const tick=()=>new Promise(r=>setTimeout(r,0));
test('strict protocol rejects write opcodes, caller flags and malformed DTOs',()=>{
 for(const op of ['commit','commitPreview','prepareEdits','writeMode','prepareNewPlan','proposeDate'])assert.throws(()=>validateControl({version:1,boot:1,requestId:1,op,session:t,expectedView:u}));
 assert.throws(()=>parseResponse(JSON.stringify({version:1,boot:1,requestId:1,type:'result',value:{view:t,preview:u,canCommit:true}}),'prepareMigration'));
});
test('separate primitive raw frame and exact guarded control; no object crosses port',async()=>{
 const m=mock();m.ready();const start=m.client.startSession();await tick();let c=JSON.parse(m.sent.at(-1));m.send({version:1,boot:m.boot,requestId:c.requestId,type:'result',value:{session:t,view:u,mode:'preview-only'}});await start;
 const raw='{"schemaVersion":999}',p=m.client.inspectLegacyRaw({session:t,expectedView:u,raw});await tick();assert.equal(m.sent.at(-1),raw);c=JSON.parse(m.sent.at(-2));assert.equal(c.raw,undefined);m.send({version:1,boot:m.boot,requestId:c.requestId,type:'result',value:{view:u,status:'rejected',diagnosticCount:1}});await p;assert.ok(m.sent.every(s=>typeof s==='string'));m.client.close();
});
test('getters never run; extra keys/stage2 summary/forged tokens rejected before IPC',async()=>{
 const m=mock();m.ready();let reads=0;for(const g of [{get session(){reads++;return t;},expectedView:u},{session:t,expectedView:u,callerFlag:true},{session:{kind:'read-only-replay'},expectedView:u},{session:t,expectedView:'clone'}])await assert.rejects(m.client.openCommitted(g));assert.equal(reads,0);assert.equal(m.sent.length,1);m.client.close();
});
for(const variant of ['stale','oversize','object','duplicate-ready','wrong-dto'])test(`client fail closed on ${variant}; late callbacks do not read data`,async()=>{
 const m=mock();m.ready();const p=m.client.startSession();await tick();const handler=m.w.onmessage,id=JSON.parse(m.sent.at(-1)).requestId;
 if(variant==='object')handler({data:{}});else if(variant==='oversize')handler({data:' '.repeat(32769)});else if(variant==='duplicate-ready')m.ready();else m.send({version:1,boot:variant==='stale'?m.boot+1:m.boot,requestId:id,type:'result',value:{session:t,view:u,mode:'write'}});
 await assert.rejects(p,{code:'protocol'});assert.equal(m.killed,1);let reads=0;handler({get data(){reads++;throw Error('late');}});assert.equal(reads,0);
});
test('hard cancel/abort/close terminate once and never reuse old credentials',async()=>{
 const m=mock();m.ready();const p=m.client.startSession();await tick();m.client.cancel();m.client.close();await assert.rejects(p,{code:'cancelled'});assert.equal(m.killed,1);await assert.rejects(m.client.openCommitted({session:t,expectedView:u}),{code:'closed'});
});
test('startup error, messageerror and timeout terminate',async()=>{
 for(const kind of ['error','messageerror','timeout']){const m=mock();const p=m.client.startSession();if(kind==='error')m.w.onerror({});if(kind==='messageerror')m.w.onmessageerror({});await assert.rejects(p);assert.equal(m.killed,1);}
});

function admissionMock({startup=1000,job=5000}={}){
 const sent=[];let killed=0;const w={postMessage:data=>sent.push(data),terminate:()=>killed++,onmessage:null,onerror:null,onmessageerror:null};const client=createControllerWorkerClient(()=>w,{startup,job}),boot=JSON.parse(sent[0]).boot;
 const send=value=>w.onmessage?.({data:JSON.stringify(value)});
 const controls=()=>sent.filter(x=>x.startsWith('{')).map(JSON.parse).filter(x=>x.op);
 const respond=c=>send({version:1,boot,requestId:c.requestId,type:'result',value:c.op==='startSession'?{session:t,view:u,mode:'preview-only'}:c.op==='readPage'?{view:u,rows:[],total:0}:{view:u,status:'rejected',diagnosticCount:1}});
 return {w,client,sent,boot,controls,respond,ready:()=>send({version:1,boot,type:'ready',mode:'preview-only'}),get killed(){return killed;}};
}
const g={session:t,expectedView:u},observe=p=>p.then(value=>({ok:true,value}),e=>({ok:false,code:e.code}));
async function started(m){m.ready();const p=m.client.startSession();await tick();m.respond(m.controls().at(-1));await p;}
for(const ready of [true,false])test(`R2 same-turn twenty requests reserve only eight (${ready?'ready':'waiting ready'})`,async()=>{
 const m=admissionMock();if(ready)await started(m);const before=m.controls().length,jobs=Array.from({length:20},()=>observe(m.client.readPage({...g,kind:'attempts'})));await tick();
 if(!ready){assert.equal(m.controls().length,0);m.ready();await tick();}
 const sent=m.controls().slice(before);assert.equal(sent.length,8);for(const c of sent)m.respond(c);const results=await Promise.all(jobs);assert.equal(results.filter(x=>x.ok).length,8);assert.equal(results.filter(x=>x.code==='busy').length,12);m.client.close();
});
test('R2 eight exact, ninth busy, response releases slot synchronously for reuse',async()=>{
 const m=admissionMock();await started(m);const jobs=Array.from({length:8},()=>observe(m.client.readPage({...g,kind:'attempts'})));const ninth=observe(m.client.readPage({...g,kind:'attempts'}));await tick();const batch=m.controls().slice(1);assert.equal(batch.length,8);assert.equal((await ninth).code,'busy');m.respond(batch[0]);const reused=observe(m.client.readPage({...g,kind:'attempts'}));await tick();assert.equal(m.controls().length,10);for(const c of batch.slice(1))m.respond(c);m.respond(m.controls().at(-1));assert.ok((await Promise.all([...jobs,reused])).every(x=>x.ok));m.client.close();
});
test('R2 invalid inputs never occupy slots',async()=>{
 const m=admissionMock();await started(m);for(let i=0;i<20;i++)await assert.rejects(m.client.readPage({...g,kind:'attempts',extra:i}));const jobs=Array.from({length:8},()=>observe(m.client.readPage({...g,kind:'attempts'})));await tick();assert.equal(m.controls().length,9);for(const c of m.controls().slice(1))m.respond(c);assert.ok((await Promise.all(jobs)).every(x=>x.ok));m.client.close();
});
test('R2 transport waiting occupies one slot, preserves one raw upload and rejects ninth',async()=>{
 const m=admissionMock();await started(m);const native=setTimeout,held=[];globalThis.setTimeout=(fn,delay,...args)=>delay===0?(held.push(()=>fn(...args)),0):native(fn,delay,...args);
 try{
  const raw=observe(m.client.inspectLegacyRaw({...g,raw:' '.repeat(Math.floor(64*1024*1024/3)+1)}));
  const otherRaw=observe(m.client.inspectLegacyRaw({...g,raw:'{}'}));const jobs=Array.from({length:20},()=>observe(m.client.readPage({...g,kind:'attempts'})));
  for(let i=0;i<5;i++)await Promise.resolve();assert.equal((await otherRaw).code,'busy');assert.equal(m.controls().length,8);
  const pages=m.controls().slice(1);assert.equal(pages.length,7);let steps=0;while(held.length){assert.ok(++steps<400);held.shift()();for(let i=0;i<8;i++)await Promise.resolve();}
  for(let i=0;i<8;i++)await Promise.resolve();const posted=m.controls();assert.equal(posted.length,9);assert.equal(posted.at(-1).op,'inspectLegacyRaw');assert.equal(m.sent.at(-1).length,Math.floor(64*1024*1024/3)+1);
  for(const c of pages)m.respond(c);m.respond(posted.at(-1));const results=await Promise.all(jobs);assert.equal(results.filter(x=>x.ok).length,7);assert.equal(results.filter(x=>x.code==='busy').length,13);assert.ok((await raw).ok);
 }finally{globalThis.setTimeout=native;m.client.close();}
});
test('R2 transport rejection releases its slot and raw gate without posting',async()=>{
 const m=admissionMock();await started(m);await assert.rejects(m.client.inspectLegacyRaw({...g,raw:'日'.repeat(Math.floor(64*1024*1024/3)+1)}),{code:'resource_limit'});assert.equal(m.controls().length,1);
 const raw=observe(m.client.inspectLegacyRaw({...g,raw:'{}'})),pages=Array.from({length:7},()=>observe(m.client.readPage({...g,kind:'attempts'})));await tick();assert.equal(m.controls().length,9);await assert.rejects(m.client.inspectLegacyRaw({...g,raw:'{}'}),{code:'busy'});for(const c of m.controls().slice(1))m.respond(c);assert.ok((await raw).ok);assert.ok((await Promise.all(pages)).every(x=>x.ok));m.client.close();
});
for(const phase of ['preparing','sent'])for(const reason of ['worker-error','abort','close','timeout'])test(`R2 ${reason} during ${phase} releases all slots once; late callbacks cannot resend`,async()=>{
 const m=admissionMock({startup:phase==='preparing'&&reason==='timeout'?25:1000,job:reason==='timeout'?25:5000});if(phase==='sent')await started(m);const signal=new AbortController();let adds=0,removes=0;const add=signal.signal.addEventListener.bind(signal.signal),remove=signal.signal.removeEventListener.bind(signal.signal);signal.signal.addEventListener=(...args)=>{adds++;return add(...args);};signal.signal.removeEventListener=(...args)=>{removes++;return remove(...args);};
 const jobs=Array.from({length:8},()=>observe(m.client.readPage({...g,kind:'attempts'},{signal:signal.signal})));if(phase==='sent')await tick();const old=m.w.onmessage;
 if(reason==='worker-error')m.w.onerror({});if(reason==='abort')signal.abort();if(reason==='close')m.client.close();
 const results=await Promise.all(jobs);assert.ok(results.every(x=>!x.ok));assert.equal(m.killed,1);assert.equal(adds,8);assert.equal(removes,8);let reads=0;old({get data(){reads++;throw Error('late');}});assert.equal(reads,0);m.client.close();await assert.rejects(m.client.readPage({...g,kind:'attempts'}),{code:'closed'});assert.equal(removes,8);
});
test('R2 duplicate settle closes safely without double releasing another request',async()=>{
 const m=admissionMock();await started(m);const jobs=Array.from({length:8},()=>observe(m.client.readPage({...g,kind:'attempts'})));await tick();const requests=m.controls().slice(1);m.respond(requests[0]);m.respond(requests[0]);const results=await Promise.all(jobs);assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.filter(x=>x.code==='protocol').length,7);assert.equal(m.killed,1);await assert.rejects(m.client.readPage({...g,kind:'attempts'}),{code:'closed'});
});
test('R2 Worker error response releases a slot without shutting down other requests',async()=>{
 const m=admissionMock();await started(m);const jobs=Array.from({length:8},()=>observe(m.client.readPage({...g,kind:'attempts'})));await tick();const requests=m.controls().slice(1);m.w.onmessage({data:JSON.stringify({version:1,boot:m.boot,requestId:requests[0].requestId,type:'error',code:'stale_authority'})});const replacement=observe(m.client.readPage({...g,kind:'attempts'}));await tick();assert.equal(m.controls().length,10);await assert.rejects(m.client.readPage({...g,kind:'attempts'}),{code:'busy'});for(const c of requests.slice(1))m.respond(c);m.respond(m.controls().at(-1));assert.equal((await jobs[0]).code,'stale_authority');assert.ok((await Promise.all([...jobs.slice(1),replacement])).every(x=>x.ok));assert.equal(m.killed,0);m.client.close();
});
test('R2 postMessage throw cancels preparing and sent slots once',async()=>{
 const m=admissionMock();await started(m);const signal=new AbortController();let removes=0;const remove=signal.signal.removeEventListener.bind(signal.signal);signal.signal.removeEventListener=(...args)=>{removes++;return remove(...args);};m.w.postMessage=()=>{throw Error('transport down');};const jobs=Array.from({length:8},()=>observe(m.client.readPage({...g,kind:'attempts'},{signal:signal.signal})));const results=await Promise.all(jobs);assert.equal(results.filter(x=>x.code==='internal').length,1);assert.equal(results.filter(x=>x.code==='closed').length,7);assert.equal(removes,8);assert.equal(m.killed,1);m.client.close();assert.equal(removes,8);
});
for(const reason of ['abort','close'])test(`R2 ${reason} during transport releases raw and all preparation slots without sending`,async()=>{
 const m=admissionMock();await started(m);const native=setTimeout,held=[],signal=new AbortController();globalThis.setTimeout=(fn,delay,...args)=>delay===0?(held.push(()=>fn(...args)),0):native(fn,delay,...args);
 try{const raw=observe(m.client.inspectLegacyRaw({...g,raw:' '.repeat(Math.floor(64*1024*1024/3)+1)},{signal:signal.signal})),pages=Array.from({length:7},()=>observe(m.client.readPage({...g,kind:'attempts'})));if(reason==='abort')signal.abort();else m.client.close();const results=await Promise.all([raw,...pages]);assert.equal(results[0].code,reason==='abort'?'cancelled':'closed');assert.ok(results.slice(1).every(x=>x.code==='closed'));assert.equal(m.killed,1);for(const resume of held)resume();for(let i=0;i<12;i++)await Promise.resolve();assert.equal(m.controls().length,1);m.client.close();}finally{globalThis.setTimeout=native;m.client.close();}
});
test('R2 settled raw releases synchronously and old finally cannot unlock its replacement',async()=>{
 const m=admissionMock();await started(m);const first=observe(m.client.inspectLegacyRaw({...g,raw:'{}'}));await tick();m.respond(m.controls().at(-1));const second=observe(m.client.inspectLegacyRaw({...g,raw:'[]'}));assert.ok((await first).ok);await tick();await assert.rejects(m.client.inspectLegacyRaw({...g,raw:'{}'}),{code:'busy'});assert.equal(m.controls().length,3);m.respond(m.controls().at(-1));assert.ok((await second).ok);m.client.close();
});
