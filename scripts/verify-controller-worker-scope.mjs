import {createHash} from 'node:crypto';import {build} from 'esbuild';import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url).pathname;
const base='1f75d6db958608dfb149d1aa0f610e3c58a21d2d';
const bundle=await build({entryPoints:[root+'src/planner/attempts/persistence/worker/client.ts'],bundle:true,write:false,format:'esm',platform:'browser',metafile:true});const inputs=Object.keys(bundle.metafile.inputs);
assert.ok(inputs.every(x=>/worker\/(client|protocol|contracts|editInput)\.ts$/.test(x)));const code=bundle.outputFiles[0].text;assert.ok(!/createAttemptPersistence|prepareMigrationEnvironment|indexedDB/.test(code));
const old=execFileSync('git',['show',base+':src/planner/attempts/persistence/indexedDb.ts'],{cwd:root,encoding:'utf8'}),now=await readFile(root+'src/planner/attempts/persistence/indexedDb.ts','utf8'),reader=await readFile(root+'src/planner/attempts/persistence/indexedDbRead.ts','utf8');
assert.equal(old.slice(old.indexOf('    async commit(')),now.slice(now.indexOf('    async commit(')));
const readBody=old.slice(old.indexOf("      if (!factory.databases)"),old.indexOf('    async commit(')).trim().replace(/},$/,'}');assert.ok(reader.trimEnd().endsWith(readBody));
for(const path of ['identity.ts'])assert.equal(await readFile(root+'src/planner/attempts/persistence/'+path,'utf8'),execFileSync('git',['show',base+':src/planner/attempts/persistence/'+path],{cwd:root,encoding:'utf8'}));
const entry=await build({entryPoints:[root+'src/main.tsx'],bundle:true,write:false,format:'esm',platform:'browser',metafile:true,loader:{'.svg':'text','.png':'dataurl','.woff2':'dataurl'},external:['*.css'],logLevel:'silent'});const production=Object.keys(entry.metafile.inputs);assert.ok(!production.some(x=>/persistence\/worker\//.test(x)));
// Preserve the reviewed controller, allowing only the qualified pre-command hook.
const controller=await readFile(root+'src/planner/attempts/persistence/controller.ts','utf8');
const oldController=execFileSync('git',['show','81f98862f1cd62aa4d9d9cc04d7f83864ea1858f:src/planner/attempts/persistence/controller.ts'],{cwd:root,encoding:'utf8'});
assert.equal(createHash('sha256').update(oldController).digest('hex'),'60223ece744db201ccdfaa7b234cc642ffc81bc6f98b03dced7fa23c5091930e');
const controllerChanges=[
 ['type MigrationIdReservations = { issued: (id: string) => void; reserved: () => readonly string[] };',
 `type MigrationIdReservations = { issued: (id: string) => void; reserved: () => readonly string[];
  // Trusted, synchronous validation only. Never supplied through Worker RPC.
  beforeCommand?: (workspace: Workspace, command: Command) => void };`],
 ["  if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes <= 0) throw new Error('capacity_policy');",
 "  if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes <= 0) throw new Error('capacity_policy');\n  const beforeCommand = migrationIds?.beforeCommand;"],
 ['      checkFreshCommandIds(command, occupied);',
 `      checkFreshCommandIds(command, occupied);
      // requireHandle/recovery and legacy freshness checks precede this hook.
      // The next line outside this block remains the sole graph application.
      beforeCommand?.(workspace, command);`],
];
let expectedController=oldController;
for(const [from,to] of controllerChanges){assert.equal(expectedController.split(from).length,2);expectedController=expectedController.replace(from,to);}
assert.equal(controller,expectedController,'controller_outside_qualified_hook_delta');
const controllerSha256=createHash('sha256').update(controller).digest('hex');
const oldSession=execFileSync('git',['show','81f98862f1cd62aa4d9d9cc04d7f83864ea1858f:src/planner/attempts/persistence/worker/session.ts'],{cwd:root,encoding:'utf8'});
const wiring='{issued:id=>editIds.restrict([id]),reserved:()=>editIds.reservations()}';
assert.equal(oldSession.split(wiring).length,2);
assert.equal(await readFile(root+'src/planner/attempts/persistence/worker/session.ts','utf8'),oldSession.replace(wiring,'{issued:id=>editIds.restrict([id]),reserved:()=>editIds.reservations(),beforeCommand:(workspace,command)=>editIds.checkCommand(workspace,command)}'),'session_outside_identity_hook_wiring');
for(const path of ['source.ts','contracts.ts'])assert.equal(await readFile(root+'src/planner/attempts/migration/'+path,'utf8'),execFileSync('git',['show',base+':src/planner/attempts/migration/'+path],{cwd:root,encoding:'utf8'}));
// 3C-0a must not connect pure rule2 encoders to controller/production/backup.
const rule2Apis = /encodeStateRule2|encodeNewPlanRule2|replayStateRule2|replayNewPlanRule2/;
assert.ok(!rule2Apis.test(controller));
for(const path of production)assert.ok(!/commandIdentities|identityFold|sessionIds/.test(path));
// Recognize committed additions as well as local additions. Keep status exact:
// a deletion, rename or type change is never an allowed implementation edit.
const allowed=new Map([
 ['scripts/verify-controller-worker-scope.mjs','M'],
 ['src/planner/attempts/persistence/codec.ts','M'],
 ['src/planner/attempts/persistence/contracts.ts','M'],
 ['src/planner/attempts/persistence/newPlan.ts','M'],
 ['src/planner/attempts/persistence/worker/editBridge.ts','M'],
 ['docs/attempt-identity-rule2-3c0a.md','A'],
 ['src/planner/attempts/persistence/commandIdentities.ts','A'],
 ['src/planner/attempts/persistence/identityFold.ts','A'],
 ['src/planner/attempts/persistence/sessionIds.ts','A'],
 ['tests/attempt-identity-rule2.test.mjs','A'],
 // R2 requires the qualified apply boundary and its private Worker wiring.
 ['src/planner/attempts/persistence/controller.ts','M'],
 ['src/planner/attempts/persistence/worker/session.ts','M'],
 ['tests/helpers/controller-worker-browser.mjs','M'],
 ['tests/attempt-identity-boundary.test.mjs','A'],
]);
const changes=execFileSync('git',['diff','--name-status','--no-renames','81f98862f1cd62aa4d9d9cc04d7f83864ea1858f'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean).map(line=>line.split('\t'));
assert.ok(changes.every(([status,path,...extra])=>!extra.length&&allowed.get(path)===status),'scope_tracked_change:'+JSON.stringify(changes));
const changed=changes.map(([,path])=>path);
const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
assert.ok(untracked.every(path=>allowed.get(path)==='A'),'scope_untracked_change:'+JSON.stringify(untracked));
const result={base,implementationBase:'81f98862f1cd62aa4d9d9cc04d7f83864ea1858f',changed,untracked,mainInputs:inputs,mainBundleBytes:Buffer.byteLength(code),productionInputs:production.length,productionWorkerInputs:production.filter(x=>/persistence\/worker\//.test(x)),readerMechanical:true,writerByteIdentical:true,controllerSha256,controllerOnlyApprovedReadonlyProbeAndIdReservations:true,qualifiedIdentityHookDeltaOnly:true,sessionOnlyIdentityHookWiring:true,exactChangeStatus:true,rule1IdentityUnchanged:true,rule2PureAndDisconnected:true};console.log(JSON.stringify(result,null,2));if(process.env.CONTROLLER_EVIDENCE)await writeFile(process.env.CONTROLLER_EVIDENCE+'/scope.json',JSON.stringify(result,null,2)+'\n');
