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
