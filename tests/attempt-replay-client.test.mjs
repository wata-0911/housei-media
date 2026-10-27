import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReplayClient, ReplayClientError } from '../src/planner/attempts/replay/client.ts';
import { parseResponse, safeError, replayFailure } from '../src/planner/attempts/replay/protocol.ts';
import { StateJsonInputError, REPLAY_STATE_LIMITS } from '../src/planner/attempts/replay/limits.ts';
const summary={kind:'read-only-replay',schemaVersion:24,commands:100,attempts:1,ownedRecords:0,removals:0,reservations:100,graphSha256:'a'.repeat(64),retainedSha256:'b'.repeat(64)};
function fake(){return {sent:[],terminated:0,onmessage:null,onerror:null,onmessageerror:null,postMessage(v){assert.equal(typeof v,'string');this.sent.push(v);},terminate(){this.terminated++;},emit(v){this.onmessage?.({data:typeof v==='string'?v:JSON.stringify(v)});}};}
function begin(){const w=fake(),api=createReplayClient(()=>w),p=api.replay('{}'),epoch=Number(w.sent[0].split(':')[1]);return {w,api,p,epoch};}
function ready(b){b.w.emit({version:1,type:'ready',epoch:b.epoch});return Number(b.w.sent[1].split('\n')[0].split(':')[2]);}
const response=(b,job,extra={})=>({version:1,type:'success',epoch:b.epoch,job,summary,replayMs:1,...extra});
for(const value of [{},null,new String('{}'),Symbol(),()=>0,new Proxy({}, {get(){throw Error('getter');}})])test('client rejects nonstring without Worker/serialization',async()=>{
 let calls=0;const api=createReplayClient(()=>{calls++;throw Error();});await assert.rejects(api.replay(value),e=>e.code==='json_input_type');assert.equal(calls,0);
});
test('client rejects huge primitive before creating Worker',async()=>{let calls=0;await assert.rejects(createReplayClient(()=>{calls++;}).replay(' '.repeat(REPLAY_STATE_LIMITS.rawBytes+1)),e=>e.code==='resource_limit');assert.equal(calls,0);});
test('ready, success, bounded frozen summary, duplicate/late closure ignored',async()=>{
 const b=begin(),job=ready(b),old=b.w.onmessage;b.w.emit(response(b,job));const r=await b.p;assert.deepEqual(r.summary,summary);assert.ok(Object.isFrozen(r.summary));assert.equal(b.w.terminated,1);old({data:JSON.stringify(response(b,job,{summary:{...summary,commands:0}}))});assert.equal(r.summary.commands,100);
});
for(const scenario of ['epoch','job','duplicate-ready','before-ready','object','large','unknown-key','wrong-summary','message-error'])test('client protocol rejects '+scenario,async()=>{
 const b=begin();let job;
 if(scenario!=='before-ready')job=ready(b);
 if(scenario==='epoch')b.w.emit(response(b,job,{epoch:b.epoch+1}));
 if(scenario==='job')b.w.emit(response(b,job+1));
 if(scenario==='duplicate-ready')b.w.emit({version:1,type:'ready',epoch:b.epoch});
 if(scenario==='before-ready')b.w.emit(response(b,1));
 if(scenario==='object')b.w.onmessage({data:response(b,job)});
 if(scenario==='large')b.w.emit(' '.repeat(4097));
 if(scenario==='unknown-key')b.w.emit(response(b,job,{state:{}}));
 if(scenario==='wrong-summary')b.w.emit(response(b,job,{summary:{...summary,saved:true}}));
 if(scenario==='message-error')b.w.onmessageerror({data:undefined});
 await assert.rejects(b.p,e=>e.kind==='protocol');assert.equal(b.w.terminated,1);
});
for(const mode of ['cancel','signal'])test(mode+' terminates, stale closure cannot settle restarted job',async()=>{
 const workers=[];const api=createReplayClient(()=>{const w=fake();workers.push(w);return w;});const signal=new AbortController(),p=api.replay('{}',signal.signal),w=workers[0],old=w.onmessage,epoch=Number(w.sent[0].split(':')[1]);
 if(mode==='cancel')api.cancel();else signal.abort();await assert.rejects(p,e=>e.kind==='cancelled');assert.equal(w.terminated,1);
 const p2=api.replay('{}'),w2=workers[1],b={w:w2,epoch:Number(w2.sent[0].split(':')[1])},job=ready(b);old({data:JSON.stringify(response({epoch},job))});w2.emit(response(b,job));assert.equal((await p2).summary.commands,100);assert.notEqual(epoch,b.epoch);
});
test('busy and pre-aborted jobs create no additional Worker',async()=>{const b=begin();await assert.rejects(b.api.replay('{}'),e=>e.kind==='busy');b.api.cancel();await assert.rejects(b.p);const ac=new AbortController();ac.abort();let calls=0;await assert.rejects(createReplayClient(()=>{calls++;}).replay('{}',ac.signal),e=>e.kind==='cancelled');assert.equal(calls,0);});
test('startup constructor and script failures are distinct from replay crash',async()=>{
 await assert.rejects(createReplayClient(()=>{throw Error('private path');}).replay('{}'),e=>e.kind==='startup_failure'&&!e.message.includes('private'));
 for(const started of [false,true]){const b=begin();if(started)ready(b);let prevented=false;b.w.onerror({preventDefault(){prevented=true;},message:'private raw'});await assert.rejects(b.p,e=>e.kind===(started?'worker_failure':'startup_failure'));assert.ok(prevented);}
});
for(const kind of ['invalid_input','resource_limit','internal'])test('remote failure category '+kind,async()=>{const b=begin(),job=ready(b);const error=kind==='invalid_input'?new StateJsonInputError('json_syntax','private'):kind==='resource_limit'?new StateJsonInputError('resource_limit','private'):new Error('private',{cause:new Error('secret')});const failure=replayFailure(error);b.w.emit({version:1,type:'failure',epoch:b.epoch,job,failure});await assert.rejects(b.p,e=>e instanceof ReplayClientError&&e.kind===kind&&!JSON.stringify(e).includes('private'));});
test('safe Error/cause is bounded, cyclic/getter/Proxy redacted, unexpected TypeError internal',()=>{
 const e=new Error('private',{cause:new Error('secret')});e.cause.cause=e;
 assert.ok(JSON.stringify(safeError(e)).length<300);assert.ok(!JSON.stringify(safeError(e)).includes('private'));
 let gets=0;const value={get cause(){gets++;throw Error();}};safeError(value);assert.equal(gets,0);
 safeError(new Proxy({}, {getOwnPropertyDescriptor(){throw Error();}}));
 assert.equal(replayFailure(new TypeError('engine bug')).kind,'internal');
 assert.equal(replayFailure(new Error('state_replay_mismatch')).kind,'internal');
 for(const message of ['json_syntax','resource_limit','source_revalidation','state_replay_mismatch'])assert.equal(replayFailure(new Error(message)).kind,'internal');
});
test('response exact bounds, finite timing, counts and safe errors',()=>{
 const b={epoch:1};for(const v of [null,{},'[]','{',JSON.stringify(response(b,1,{replayMs:-1})),JSON.stringify(response(b,1,{summary:{...summary,commands:10001}})),JSON.stringify({version:1,type:'failure',epoch:1,job:1,failure:{kind:'internal',code:'unexpected_error',error:{name:'Error',message:'secret'}}})])assert.throws(()=>parseResponse(v));
});
test('oversized UTF8 refuses before Worker/IPC and yields to timers',async()=>{
 let calls=0,ticks=0;const timer=setInterval(()=>ticks++,1);
 try{await assert.rejects(createReplayClient(()=>{calls++;return fake();}).replay('日'.repeat(Math.floor(REPLAY_STATE_LIMITS.rawBytes/3)+1)),e=>e.kind==='resource_limit');assert.equal(calls,0);assert.ok(ticks>1);}finally{clearInterval(timer);}
});
test('cancel during main transport scan starts no Worker, permits fresh job',async()=>{
 let calls=0;const workers=[];const api=createReplayClient(()=>{calls++;const w=fake();workers.push(w);return w;});const p=api.replay(' '.repeat(Math.floor(REPLAY_STATE_LIMITS.rawBytes/3)+1));api.cancel();await assert.rejects(p,e=>e.kind==='cancelled');assert.equal(calls,0);
 const p2=api.replay('{}'),w=workers[0],b={w,epoch:Number(w.sent[0].split(':')[1])};w.emit(response(b,ready(b)));assert.equal((await p2).summary.commands,100);
});
test('transport UTF8 count across surrogate chunk boundaries',async()=>{
 const {checkReplayTransport}=await import('../src/planner/attempts/replay/limits.ts');
 const raw=' '.repeat(65535)+'😀'+' '.repeat(Math.floor(REPLAY_STATE_LIMITS.rawBytes/3));await checkReplayTransport(raw,()=>false);
});
test('ready/job timeout terminates and never resolves a partial result',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=begin();t.mock.timers.tick(30000);await assert.rejects(pending.p,e=>e.kind==='startup_failure'&&e.code==='ready_timeout');assert.equal(pending.w.terminated,1);
 const running=begin();ready(running);t.mock.timers.tick(300000);await assert.rejects(running.p,e=>e.kind==='worker_failure'&&e.code==='job_timeout');assert.equal(running.w.terminated,1);
});
test('thrown Proxy classification failure remains internal with bounded redaction',()=>{
 const thrown=new Proxy({}, {getPrototypeOf(){throw Error('private');},getOwnPropertyDescriptor(){throw Error('private');}});const failure=replayFailure(thrown);assert.equal(failure.kind,'internal');assert.ok(!JSON.stringify(failure).includes('private'));
});
