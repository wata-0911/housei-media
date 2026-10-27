import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayFixture } from './fixtures/replay-state-fixture.mjs';
const load = () => import('../src/planner/attempts/replay/replayStateJson.ts');

for (const value of [null, {}, new String('{}'), 23, Symbol(), {toString(){throw Error('coerced');}}]) test('primitive input only: '+typeof value, async()=>{
  const api = await load(); await assert.rejects(api.replayStateJson(value), e=>e.code==='json_input_type');
});
for (const raw of ['{', '{"a":1,"\\u0061":2}', '{"x":-0}', '{"x":9007199254740993}']) test('reject syntax/duplicate/numeric representation '+raw,async()=>{
  await assert.rejects((await load()).replayStateJson(raw));
});
for (const version of [23,24]) test('schema'+version+' full ordered 100 Command replay and bounded summary',async()=>{
  const f=await replayFixture(version);
  const {replayStateJson}=await load(); const result=await replayStateJson(f.raw);
  assert.equal(result.schemaVersion,version); assert.equal(result.commands,100);
  assert.equal(result.graphSha256,f.state.verification.graphSha256);
  assert.equal(result.retainedSha256,f.state.verification.retainedSha256);
  assert.ok(JSON.stringify(result).length<1024);
  for(const key of ['state','workspace','source','base','environment','handle','issuedIds','requiredReservations'])assert.equal(Object.hasOwn(result,key),false);
  assert.equal(f.raw,JSON.stringify(f.state));
});
