import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { replayState } from '../src/planner/attempts/persistence/codec.ts';
import { replayStateJson } from '../src/planner/attempts/replay/replayStateJson.ts';
import { replayFixture } from './fixtures/replay-state-fixture.mjs';
import { backupDigest } from '../src/planner/backup/plannerBackupCompatibility.ts';
import { applyCommand, newOperationId, newRecordId } from '../src/planner/attempts/workbench/operations.ts';
import { encodeNewPlan, createNewPlanSource } from '../src/planner/attempts/persistence/newPlan.ts';

// Instrument a separate bundle only: observe the private full result immediately
// after the production replay call; production API/Worker expose no such hook.
let observedApi;
async function observer(){return observedApi??=(async()=>{const dir=await mkdtemp(join(tmpdir(),'replay-observer-')),outfile=join(dir,'observed.mjs');await build({entryPoints:[new URL('../src/planner/attempts/replay/replayStateJson.ts',import.meta.url).pathname],bundle:true,format:'esm',platform:'node',outfile,plugins:[{name:'test-only-observer',setup(b){b.onLoad({filter:/replayStateJson\.ts$/},async a=>({contents:(await readFile(a.path,'utf8')).replace('const replay = await replayState(parsed.value);','const replay = await replayState(parsed.value); globalThis.__stage2Observed = replay;'),loader:'ts'}));}}]});return import(pathToFileURL(outfile));})();}
for(const version of [23,24])test('all values of state/Workspace/reservations equal old full replay schema'+version,async()=>{
 const {raw,state,workspace}=await replayFixture(version),old=await replayState(JSON.parse(raw)),api=await observer();
 try{await api.replayStateJson(raw);const observed=globalThis.__stage2Observed;assert.deepEqual(observed.state,old.state);assert.deepEqual(observed.workspace,old.workspace);assert.deepEqual(observed.requiredReservations,old.requiredReservations);assert.deepEqual(observed.state,state);assert.deepEqual(observed.workspace,workspace);assert.equal(observed.workspace.receipts.length,100);}finally{delete globalThis.__stage2Observed;}
});
for(const version of [23,24])test('rehashed source/graph/history/retained/context modifications refuse schema'+version,async()=>{
 const {state}=await replayFixture(version,'normal',3);
 const mutations={graph:s=>s.graph.attempts[0].originalTitle='forged',retained:s=>s.retained.graduationCheckComplete=true,history:s=>s.history.commands.reverse(),ids:s=>s.history.issuedIds.pop(),duplicate:s=>s.history.commands.push(s.history.commands[0]),context:s=>s.graph.attempts[0].identity={status:'confirmed',ref:{institutionalCourseId:'unknown-course',sourceRevisionId:'unknown',evidenceIds:['missing']},candidateAuditIds:[],reason:null},source:s=>{if(version===24)s.source.masterSha256='a'.repeat(64);else s.source.rawFiles[Object.keys(s.source.rawFiles)[0]]+=' ';}};
 for(const change of Object.values(mutations)){const s=structuredClone(state);change(s);s.verification.graphSha256=await backupDigest(s.graph);s.verification.retainedSha256=await backupDigest(s.retained);await assert.rejects(replayStateJson(JSON.stringify(s)));}
});
test('remove, Undo, deleted TODO permanent reservations and receipts preserved',async()=>{
 const f=await replayFixture(24,'normal',2),source=await createNewPlanSource();let w=f.workspace;
 const submit=c=>{w=applyCommand(w,c,source.context);};
 const record={id:newRecordId(),kind:'todo',owner:{kind:'attempt',attemptId:w.graph.attempts[0].id},payload:{id:crypto.randomUUID(),text:'synthetic',done:false}};
 submit({kind:'add_record',operationId:newOperationId(),record});submit({kind:'delete_todo',operationId:newOperationId(),recordId:record.id});
 const attemptId=w.graph.attempts[0].id;submit({kind:'remove',operationId:newOperationId(),attemptId});const ticket=w.graph.removals.at(-1);submit({kind:'undo',operationId:newOperationId(),attemptId,removalOperationId:ticket.operationId});
 const state=await encodeNewPlan(source,w),old=await replayState(state),api=await observer();
 try{await api.replayStateJson(JSON.stringify(state));assert.deepEqual(globalThis.__stage2Observed.workspace,old.workspace);assert.deepEqual(globalThis.__stage2Observed.requiredReservations,old.requiredReservations);assert.ok(old.requiredReservations.includes(record.id));assert.ok(old.requiredReservations.includes(record.payload.id));assert.ok(old.workspace.usedTodoIds.includes(record.payload.id));}finally{delete globalThis.__stage2Observed;}
});
test('unexpected Error/cause remains identical inside same-realm JSON API',async()=>{
 const f=await replayFixture(24,'normal',2),original=globalThis.structuredClone,e=new Error('synthetic fault',{cause:new TypeError('synthetic cause')});
 globalThis.structuredClone=()=>{throw e;};try{await assert.rejects(replayStateJson(f.raw),error=>error===e&&error.cause===e.cause);}finally{globalThis.structuredClone=original;}
});
