import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanStateJson } from '../src/planner/attempts/replay/stateJson.ts';
import { REPLAY_STATE_LIMITS as limits, checkStateBudget } from '../src/planner/attempts/replay/limits.ts';
import { replayStateJson } from '../src/planner/attempts/replay/replayStateJson.ts';

for(const [name,maximum]of Object.entries(limits))test('state budget '+name+' inclusive boundary',()=>{
 checkStateBudget(name,maximum-1);checkStateBudget(name,maximum);assert.throws(()=>checkStateBudget(name,maximum+1),e=>e.code==='resource_limit'&&e.message.includes(name));
});
for(const raw of ['{"a":1,"\\u0061":2}','{"x":-0.0}','{"x":1e400}','{"x":-1e-999}','{"x":9007199254740993}'])test('state representation rejection '+raw,()=>assert.throws(()=>scanStateJson(raw)));
test('state scanner Unicode, __proto__, null/0/omission/order',()=>{const raw='{"__proto__":{"x":1},"emoji":"\\ud83d\\ude00","a":[null,0,"\\u0000",1.25]}';const s=scanStateJson(raw);assert.deepEqual(s.value,JSON.parse(raw));assert.equal(Object.getPrototypeOf(s.value),Object.prototype);assert.equal(Object.hasOwn(s.value,'__proto__'),true);});
test('depth boundary checked before native parse',()=>{const raw=n=>'['.repeat(n)+'0'+']'.repeat(n);scanStateJson(raw(limits.depth+1));assert.throws(()=>scanStateJson(raw(limits.depth+2)),e=>e.code==='resource_limit');});
test('UTF8 exact raw rejection, no TextEncoder needed',()=>{assert.throws(()=>scanStateJson(' '.repeat(limits.rawBytes+1)),e=>e.code==='resource_limit');assert.throws(()=>scanStateJson('"'+'日'.repeat(Math.floor(limits.rawBytes/3))+'"'),e=>e.code==='resource_limit');});
test('state history and aggregate work over limits never enter replay',async()=>{
 const state={schemaVersion:24,history:{commands:Array(limits.commands+1).fill({kind:'edit'})},graph:{attempts:[],ownedRecords:[],removals:[]}};
 await assert.rejects(replayStateJson(JSON.stringify(state)),e=>e.code==='resource_limit'&&e.message.includes('commands'));
 state.history.commands=Array(2500).fill({kind:'edit'});state.x='x'.repeat(10000);
 await assert.rejects(replayStateJson(JSON.stringify(state)),e=>e.code==='resource_limit'&&e.message.includes('work'));
});
test('nested source duplicate/depth/number checks run before existing decoder',async()=>{
 for(const raw of ['{"a":1,"a":2}','['.repeat(74)+'0'+']'.repeat(74),'{"x":-0}']){
  await assert.rejects(replayStateJson(JSON.stringify({schemaVersion:23,source:{raw},corrections:[],history:{commands:[]},graph:{attempts:[],ownedRecords:[],removals:[]}})),e=>['duplicate_json_key','resource_limit','unrepresentable_json_number'].includes(e.code));
 }
});
// Test-only scanner copy changes no production constants/registries. Exercises
// counting at small boundaries; audited Graph code/profile is not instrumented.
test('scanner field/container/value/string budgets mechanically enforced',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'replay-budget-'));
 const scanner=new URL('../src/planner/attempts/replay/stateJson.ts',import.meta.url).pathname;
 const limitsPath=new URL('../src/planner/attempts/replay/limits.ts',import.meta.url).pathname;
 const code=await readFile(limitsPath,'utf8');
 for(const [budget,good,bad]of [
  ['fields','{"a":0,"b":0}','{"a":0,"b":0,"c":0}'],
  ['containers','[{}]','[{},{}]'],['values','[0]','[0,0]'],
  ['stringBytes','"ab"','"abc"'],['totalStringBytes','["a","b"]','["a","bc"]'],
 ]){
  const outfile=join(dir,budget+'.mjs');
  await build({entryPoints:[scanner],bundle:true,format:'esm',platform:'node',outfile,plugins:[{name:'small-budget',setup(b){b.onLoad({filter:/replay\/limits\.ts$/},()=>({contents:code.replace(new RegExp('('+budget+': )[^,]+'), '$1'+'2'),loader:'ts'}));}}]});
  const {scanStateJson:small}=await import(pathToFileURL(outfile));small(good);assert.throws(()=>small(bad),e=>e.code==='resource_limit'&&e.message.includes(budget));
 }
});
