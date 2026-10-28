import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight, scanWorkerJson, INPUT_PROFILES } from '../src/planner/attempts/persistence/worker/workerInput.ts';
test('primitive gate rejects objects without reading getters',()=>{let reads=0;assert.throws(()=>preflight({get x(){reads++;}},'legacy'));assert.equal(reads,0);});
test('all profiles reject decoded duplicates, deep containers and lossy numbers',()=>{
 for(const profile of Object.keys(INPUT_PROFILES))for(const raw of ['{"x":1,"\\u0078":2}','[1,]','-0','1e999','9007199254740992','['.repeat(76)+'0'+']'.repeat(76)])assert.throws(()=>scanWorkerJson(raw,INPUT_PROFILES[profile]));
});
test('independent profiles; exact scanner boundaries and unknown fields survive',()=>{
 assert.notEqual(INPUT_PROFILES.state,INPUT_PROFILES.backup);assert.notEqual(INPUT_PROFILES.state,INPUT_PROFILES.legacy);
 const p={...INPUT_PROFILES.state,rawBytes:7,depth:0,values:2,fields:1,containers:1,stringBytes:1,totalStringBytes:1};
 assert.deepEqual(scanWorkerJson('{"x":0}',p).value,{x:0});assert.throws(()=>scanWorkerJson('{"x":0} ',p));
 assert.deepEqual(scanWorkerJson('{"__proto__":null,"unknown":"a"}',INPUT_PROFILES.state).value,JSON.parse('{"__proto__":null,"unknown":"a"}'));
});
import {checkBudget,WorkerInputError} from '../src/planner/attempts/persistence/worker/workerInput.ts';
for(const [name,p]of Object.entries(INPUT_PROFILES))test(`${name}: every independent budget inclusive -1/0/+1`,()=>{for(const [key,max]of Object.entries(p)){checkBudget(p,key,max-1);checkBudget(p,key,max);assert.throws(()=>checkBudget(p,key,max+1),{code:'resource_limit'});assert.throws(()=>checkBudget(p,key,Infinity));assert.throws(()=>checkBudget(p,key,Number.MAX_SAFE_INTEGER+1));}});
test('scanner actual resource boundaries, every profile and retained unknown values',()=>{
 for(const p of Object.values(INPUT_PROFILES))for(const [budget,good,bad,max]of [
 ['fields','{"a":0,"b":0}','{"a":0,"b":0,"c":0}',2],['containers','[{}]','[{},{}]',2],['values','[0]','[0,0]',2],['stringBytes','"ab"','"abc"',2],['totalStringBytes','["a","b"]','["a","bc"]',2],['depth','[[]]','[[[]]]',1]]){
  const small={...p,[budget]:max};scanWorkerJson(good,small);assert.throws(()=>scanWorkerJson(bad,small),{code:'resource_limit'});
 }
});
test('all native parse gates reject first; unexpected native Error identity preserved',()=>{
 const native=JSON.parse;try{for(const raw of ['{"a":1,"\\u0061":2}','-0','[1,]','['.repeat(76)+'0'+']'.repeat(76)]){let whole=0;JSON.parse=s=>{if(s===raw)whole++;return native(s);};assert.throws(()=>scanWorkerJson(raw,INPUT_PROFILES.state));assert.equal(whole,0);}
 const fault=new RangeError('PRIVATE_SECRET',{cause:new TypeError('secret')});JSON.parse=()=>{throw fault;};assert.throws(()=>scanWorkerJson('0',INPUT_PROFILES.state),e=>e===fault&&e.cause===fault.cause);
 }finally{JSON.parse=native;}
});
test('Unicode/surrogate decoded bytes match independent Buffer oracle',()=>{
 let seed=17;for(let i=0;i<2000;i++){let text='';for(let j=0;j<10;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;text+=String.fromCharCode(seed&65535);}const raw=JSON.stringify(text),s=scanWorkerJson(raw,INPUT_PROFILES.state);assert.equal(s.totalStringBytes,Buffer.byteLength(text));assert.equal(s.value,text);}
});
const skeleton=(version=23)=>({schemaVersion:version,source:{raw:'{"unknown":[0,1,2]}'},corrections:[],history:{commands:[]},graph:{attempts:[],ownedRecords:[],removals:[]}});
test('outer plus every embedded source/correction charges all four aggregate budgets',()=>{
 const state=skeleton();state.corrections=[{originalRaw:'{"x":0}',proposedRaw:'{"y":[1]}'}];
 for(const kind of ['state','backup']){const raw=JSON.stringify(kind==='state'?state:{state,reservedIds:[]}),result=preflight(raw,kind);
  for(const [budget,key]of [['values','values'],['fields','fields'],['containers','containers'],['totalStringBytes','totalStringBytes']]){preflight(raw,kind,{...INPUT_PROFILES[kind],[budget]:result[key]});assert.throws(()=>preflight(raw,kind,{...INPUT_PROFILES[kind],[budget]:result[key]-1}),{code:'resource_limit'});}
  for(const position of ['originalRaw','proposedRaw']){const bad=structuredClone(state);bad.corrections[0][position]='{"x":0,"x":0}';assert.throws(()=>preflight(JSON.stringify(kind==='state'?bad:{state:bad,reservedIds:[]}),kind),{code:'duplicate_json_key'});}
 }
});
test('backup reserved IDs, commands, corrections and work cannot hide behind envelope',()=>{
 const state=skeleton();const p={...INPUT_PROFILES.backup,reservedIds:2,commands:2,corrections:2};
 const raw=()=>JSON.stringify({state,reservedIds:['x','y']});preflight(raw(),'backup',p);assert.throws(()=>preflight(raw(),'backup',{...p,reservedIds:1}),{code:'resource_limit'});
 state.history.commands=[{kind:'edit'},{kind:'edit'}];preflight(raw(),'backup',p);assert.throws(()=>preflight(raw(),'backup',{...p,commands:1}),{code:'resource_limit'});
 state.corrections=[{originalRaw:'{}',proposedRaw:'{}'},{originalRaw:'{}',proposedRaw:'{}'}];const result=preflight(raw(),'backup',p);assert.throws(()=>preflight(raw(),'backup',{...p,corrections:1}),{code:'resource_limit'});preflight(raw(),'backup',{...p,work:result.work});assert.throws(()=>preflight(raw(),'backup',{...p,work:result.work-1}),{code:'resource_limit'});
});
test('legacy envelope includes catalog strings and owner maps in structural/work accounting',()=>{
 const state={schemaVersion:22,todos:[0,1],mediaSchoolingProgress:{a:0},correspondenceProgress:{b:0},courseEvaluations:{c:0}};const raw=JSON.stringify({format:'hosei-planner-backup',state,catalog:{unknown:'preserved'}}),r=preflight(raw,'legacy');assert.equal(r.work,r.values+Math.ceil(r.totalStringBytes/16)+100000+25);assert.throws(()=>preflight(raw,'legacy',{...INPUT_PROFILES.legacy,work:r.work-1}),{code:'resource_limit'});
});
test('giant input: actual 64MiB raw and 24MiB decoded string inclusive boundaries',()=>{
 const p=INPUT_PROFILES.state,native=JSON.parse;let whole=0;try{JSON.parse=s=>{whole++;return native(s);};scanWorkerJson('0'+' '.repeat(p.rawBytes-1),p);assert.equal(whole,1);whole=0;assert.throws(()=>scanWorkerJson('0'+' '.repeat(p.rawBytes),p),{code:'resource_limit'});assert.equal(whole,0);
 scanWorkerJson('"'+'x'.repeat(p.stringBytes)+'"',p);assert.throws(()=>scanWorkerJson('"'+'x'.repeat(p.stringBytes+1)+'"',p),{code:'resource_limit'});
 }finally{JSON.parse=native;}
});
test('Worker byte admission precedes fingerprint allocation even before session startup',async()=>{
 const {createPreviewSession}=await import('../src/planner/attempts/persistence/worker/session.ts');let calls=0;const s=createPreviewSession(async()=>{calls++;throw Error('backend forbidden');},async()=>{calls++;throw Error('environment forbidden');},1);
 await assert.rejects(s.request({version:1,boot:1,requestId:1,op:'inspectLegacyRaw'},'日'.repeat(Math.floor(INPUT_PROFILES.legacy.rawBytes/3)+1)),{code:'resource_limit'});assert.equal(calls,0);s.close();
});
