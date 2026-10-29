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
// R1 approves only synchronous migration-ID reservation wiring in the controller.
// Pin the reviewed controller; rule2 codecs are pure opt-in additions below.
const controller=await readFile(root+'src/planner/attempts/persistence/controller.ts','utf8');
const controllerSha256=createHash('sha256').update(controller).digest('hex');
assert.equal(controllerSha256,'60223ece744db201ccdfaa7b234cc642ffc81bc6f98b03dced7fa23c5091930e');
for(const path of ['source.ts','contracts.ts'])assert.equal(await readFile(root+'src/planner/attempts/migration/'+path,'utf8'),execFileSync('git',['show',base+':src/planner/attempts/migration/'+path],{cwd:root,encoding:'utf8'}));
// 3C-0a must not connect pure rule2 encoders to controller/production/backup.
const rule2Apis = /encodeStateRule2|encodeNewPlanRule2|replayStateRule2|replayNewPlanRule2/;
assert.ok(!rule2Apis.test(controller));
for(const path of production)assert.ok(!/commandIdentities|identityFold|sessionIds/.test(path));
const changed=execFileSync('git',['diff','--name-only','81f98862f1cd62aa4d9d9cc04d7f83864ea1858f'],{cwd:root,encoding:'utf8'}).trim().split('\n');
const allowed=new Set(['src/planner/attempts/persistence/codec.ts','src/planner/attempts/persistence/newPlan.ts','src/planner/attempts/persistence/contracts.ts','src/planner/attempts/persistence/worker/editBridge.ts','scripts/verify-controller-worker-scope.mjs']);
assert.ok(changed.every(path=>allowed.has(path)),JSON.stringify(changed));
const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const additions=new Set(['docs/attempt-identity-rule2-3c0a.md','src/planner/attempts/persistence/commandIdentities.ts','src/planner/attempts/persistence/identityFold.ts','src/planner/attempts/persistence/sessionIds.ts','tests/attempt-identity-rule2.test.mjs']);
assert.ok(untracked.every(path=>additions.has(path)),JSON.stringify(untracked));
const result={base,implementationBase:'81f98862f1cd62aa4d9d9cc04d7f83864ea1858f',changed,untracked,mainInputs:inputs,mainBundleBytes:Buffer.byteLength(code),productionInputs:production.length,productionWorkerInputs:production.filter(x=>/persistence\/worker\//.test(x)),readerMechanical:true,writerByteIdentical:true,controllerSha256,controllerOnlyApprovedReadonlyProbeAndIdReservations:true,rule1IdentityUnchanged:true,rule2PureAndDisconnected:true};console.log(JSON.stringify(result,null,2));if(process.env.CONTROLLER_EVIDENCE)await writeFile(process.env.CONTROLLER_EVIDENCE+'/scope.json',JSON.stringify(result,null,2)+'\n');
