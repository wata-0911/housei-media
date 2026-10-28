import {createHash} from 'node:crypto';import {build} from 'esbuild';import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url).pathname;
const base='1f75d6db958608dfb149d1aa0f610e3c58a21d2d';
const bundle=await build({entryPoints:[root+'src/planner/attempts/persistence/worker/client.ts'],bundle:true,write:false,format:'esm',platform:'browser',metafile:true});const inputs=Object.keys(bundle.metafile.inputs);
assert.ok(inputs.every(x=>/worker\/(client|protocol|contracts|editInput)\.ts$/.test(x)));const code=bundle.outputFiles[0].text;assert.ok(!/createAttemptPersistence|prepareMigrationEnvironment|indexedDB/.test(code));
const old=execFileSync('git',['show',base+':src/planner/attempts/persistence/indexedDb.ts'],{cwd:root,encoding:'utf8'}),now=await readFile(root+'src/planner/attempts/persistence/indexedDb.ts','utf8'),reader=await readFile(root+'src/planner/attempts/persistence/indexedDbRead.ts','utf8');
assert.equal(old.slice(old.indexOf('    async commit(')),now.slice(now.indexOf('    async commit(')));
const readBody=old.slice(old.indexOf("      if (!factory.databases)"),old.indexOf('    async commit(')).trim().replace(/},$/,'}');assert.ok(reader.trimEnd().endsWith(readBody));
for(const path of ['codec.ts','newPlan.ts','identity.ts','contracts.ts'])assert.equal(await readFile(root+'src/planner/attempts/persistence/'+path,'utf8'),execFileSync('git',['show',base+':src/planner/attempts/persistence/'+path],{cwd:root,encoding:'utf8'}));
const entry=await build({entryPoints:[root+'src/main.tsx'],bundle:true,write:false,format:'esm',platform:'browser',metafile:true,loader:{'.svg':'text','.png':'dataurl','.woff2':'dataurl'},external:['*.css'],logLevel:'silent'});const production=Object.keys(entry.metafile.inputs);assert.ok(!production.some(x=>/persistence\/worker\//.test(x)));
// R1 approves only synchronous migration-ID reservation wiring in the controller.
// Pin the entire reviewed file; codec/identity/newPlan/writer checks above remain.
const controller=await readFile(root+'src/planner/attempts/persistence/controller.ts','utf8');
const controllerSha256=createHash('sha256').update(controller).digest('hex');
assert.equal(controllerSha256,'60223ece744db201ccdfaa7b234cc642ffc81bc6f98b03dced7fa23c5091930e');
for(const path of ['source.ts','contracts.ts'])assert.equal(await readFile(root+'src/planner/attempts/migration/'+path,'utf8'),execFileSync('git',['show',base+':src/planner/attempts/migration/'+path],{cwd:root,encoding:'utf8'}));
const result={base,mainInputs:inputs,mainBundleBytes:Buffer.byteLength(code),productionInputs:production.length,productionWorkerInputs:production.filter(x=>/persistence\/worker\//.test(x)),readerMechanical:true,writerByteIdentical:true,controllerSha256,controllerOnlyApprovedReadonlyProbeAndIdReservations:true,codecContractsUnchanged:true};console.log(JSON.stringify(result,null,2));if(process.env.CONTROLLER_EVIDENCE)await writeFile(process.env.CONTROLLER_EVIDENCE+'/scope.json',JSON.stringify(result,null,2)+'\n');
