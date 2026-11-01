import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
if (process.argv.length !== 4) throw Error('usage: node --import tsx make-rule1-parent-fixture.mjs PARENT_CHECKOUT OUTPUT_GZ');
const parent = resolve(process.argv[2]);
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: parent, encoding: 'utf8' }).trim(), '9c0780b0884a582827fb0c3126a0937ab75770fa');
assert.equal(execFileSync('git', ['status', '--porcelain=v1'], { cwd: parent, encoding: 'utf8' }).trim(), '');
const root=pathToFileURL(parent + '/');
const mod=p=>import(new URL(p,root));
const {mixed,decode,env}=await mod('tests/fixtures/migration-fixture.mjs');
const {prepareMigrationIds}=await mod('src/planner/attempts/migration/assignments.ts');
const {buildMigrationTarget}=await mod('src/planner/attempts/migration/transform.ts');
const {createWorkspace,applyCommand}=await mod('src/planner/attempts/workbench/operations.ts');
const {createNewPlanSource,emptyNewPlanWorkspace,encodeNewPlan}=await mod('src/planner/attempts/persistence/newPlan.ts');
const {encodeState,replayState}=await mod('src/planner/attempts/persistence/codec.ts');
const {makeAttempt}=await mod('src/planner/attempts/workbench/catalogView.ts');
const {backupDigest}=await mod('src/planner/backup/plannerBackupCompatibility.ts');
const u=n=>`c3000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const result={parent:'9c0780b0884a582827fb0c3126a0937ab75770fa',fixtures:[]};
for(const schema of [23,24]){
 let source,table,base,workspace;
 if(schema===23){source=(await decode(mixed())).source; const native=crypto.randomUUID;let n=100;try{crypto.randomUUID=()=>u(n++);table=prepareMigrationIds(source);}finally{crypto.randomUUID=native;}base=buildMigrationTarget(source,table);workspace=createWorkspace(base.graph,source.context);}
 else{source=await createNewPlanSource();workspace=emptyNewPlanWorkspace(source);}
 const attempt=makeAttempt(source.context.catalog,{title:'旧rule1入れ子予約fixture',courseId:null,placementId:null,plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''},{id:`hosei:attempt:${u(1)}`,creationOperationId:`hosei:attempt-op:${u(2)}`});
 const record={id:`hosei:owned:${u(4)}`,kind:'media',owner:{kind:'attempt',attemptId:attempt.id},payload:{totalLessons:null,lessons:[],assessments:[]}};
 const commands=[{kind:'add',operationId:attempt.creationOperationId,attempt},{kind:'add_record',operationId:`hosei:attempt-op:${u(3)}`,record},{kind:'edit_payload',operationId:`hosei:attempt-op:${u(6)}`,recordId:record.id,payload:{...record.payload,assessments:[{id:u(5),type:'other',label:'旧履歴X',scheduledDate:null,completed:false}]}}];
 for(const command of commands)workspace=applyCommand(workspace,command,source.context);
 const state=schema===23?await encodeState(source,table,base,workspace,env.target):await encodeNewPlan(source,workspace);
 const replay=await replayState(state);
 result.fixtures.push({stateRaw:JSON.stringify(state,null,2),digest:await backupDigest(state),workspace:replay.workspace,requiredReservations:replay.requiredReservations});
}
writeFileSync(resolve(process.argv[3]),gzipSync(JSON.stringify(result),{level:9}));
console.log(result.fixtures.map(f=>({schema:JSON.parse(f.stateRaw).schemaVersion,digest:f.digest})));
