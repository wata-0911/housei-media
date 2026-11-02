import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
export const parent='51ec5140038ef177f8581862cad22bdef064db95';
const root=new URL('../',import.meta.url).pathname;
export const allowed=new Map([
 ...['client','contracts','display','preview.worker','protocol','session','workerInput'].map(x=>['src/planner/attempts/persistence/worker/'+x+'.ts','M']),
 ['src/planner/attempts/persistence/worker/versionedRead.ts','A'],
 ['docs/attempt-readonly-worker-3c0b-pr5.md','A'],
 ['scripts/verify-readonly-worker-pr5-scope.mjs','A'],
 ...['attempt-worker-versioned.test.mjs','attempt-worker-versioned.browser.mjs','attempt-worker-pr5-scope.test.mjs','helpers/worker-versioned-browser.mjs','helpers/worker-versioned-fixture.mjs'].map(x=>['tests/'+x,'A']),
 ['tests/attempt-controller-worker-session.test.mjs','M'],
]);
export function checkRows(rows,local=false){for(const [status,path,...extra]of rows)assert.ok(!extra.length&&(local?(status==='M'&&allowed.has(path)||status==='A'&&allowed.get(path)==='A'):allowed.get(path)===status),'scope_change:'+JSON.stringify([status,path,...extra]));}
export function checkModes(summary){for(const line of summary.split('\n').filter(Boolean)){const created=/^ create mode 100644 (.+)$/.exec(line);assert.ok(created&&allowed.get(created[1])==='A','scope_mode:'+line);}}
export async function verify(){
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});
 const rows=(...args)=>git('diff','--name-status','--no-renames',...args).trim().split('\n').filter(Boolean).map(x=>x.split('\t'));
 checkRows(rows(parent));checkRows(rows('HEAD'),true);
 for(const args of [['--cached','HEAD'],[]]){checkRows(rows(...args),true);checkModes(git('diff','--summary','--no-renames',...args));}
 const untracked=git('ls-files','--others','--exclude-standard').trim().split('\n').filter(Boolean);for(const path of untracked)assert.equal(allowed.get(path),'A','scope_untracked:'+path);
 for(const [path]of allowed){const stat=await lstat(root+path);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'scope_regular:'+path);}
 // The original read/writer, synchronous qualification, F03 rescue, allocator,
 // decoder/fold and production remain byte-fixed to the reviewed parent.
 const protectedPaths=['indexedDbRead.ts','indexedDb.ts','authoritySnapshot.ts','persistentSession.ts','syncSession.ts','controller.ts','contractDecoders.ts','versionedContracts.ts','legacyPreview.ts','sessionIds.ts','identityFold.ts','commandIdentities.ts','worker/queue.ts','worker/registry.ts','worker/editBridge.ts'];
 for(const suffix of protectedPaths){const path='src/planner/attempts/persistence/'+suffix,expected=git('show',parent+':'+path);assert.equal(await readFile(root+path,'utf8'),expected,'scope_frozen_working:'+path);assert.equal(git('show',':'+path),expected,'scope_frozen_index:'+path);}
 // Only the bridge test's object identity assertion changes: the product now
 // returns an independent frozen snapshot. Keep the rest of its tests exact.
 const testPath='tests/attempt-controller-worker-session.test.mjs',before=git('show',parent+':'+testPath),after=await readFile(root+testPath,'utf8');
 const old="test('read bridge preflights and returns exact same record; commit always throws',async()=>{const record=emptyAuthority();let seen;const store=createReadonlyStore(async()=>record,r=>seen=r);assert.equal(await store.read(),record);assert.equal(seen,record);";
 const next="test('read bridge validates and returns independent frozen exact snapshot; commit always throws',async()=>{const record=emptyAuthority();let seen;const store=createReadonlyStore(async()=>record,r=>seen=r);const result=await store.read();assert.notEqual(result,record);assert.deepEqual(result,record);assert.equal(seen,result);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.issuedIds));";
 assert.equal(before.split(old).length,2);assert.equal(after,before.replace(old,next),'scope_bridge_test_delta');
 const options={bundle:true,write:false,format:'esm',platform:'browser',metafile:true,logLevel:'silent'};
 const main=await build({...options,entryPoints:[root+'src/planner/attempts/persistence/worker/client.ts']});const mainInputs=Object.keys(main.metafile.inputs);assert.ok(mainInputs.every(x=>/worker\/(client|protocol|contracts|editInput)\.ts$/.test(x)));
 const production=await build({...options,entryPoints:[root+'src/main.tsx'],loader:{'.svg':'text','.png':'dataurl','.woff2':'dataurl'},external:['*.css']});assert.ok(!Object.keys(production.metafile.inputs).some(x=>/persistence\/|identityFold|commandIdentities/.test(x)));
 const rawPlugin={name:'scope-exact-raw',setup(b){b.onResolve({filter:/\?raw$/},a=>({path:resolve(a.resolveDir,a.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}};
 const worker=await build({...options,entryPoints:[root+'src/planner/attempts/persistence/worker/preview.worker.ts'],plugins:[rawPlugin]});
 const workerInputs=Object.keys(worker.metafile.inputs);
 assert.ok(!/testOracle|__audit|testAudit/.test(worker.outputFiles[0].text),'product_test_hook');
 assert.ok(!workerInputs.some(x=>/persistence\/(?:persistentSession|syncSession|indexedDb|artifacts|sessionIdentityOwner)\.ts$|dev\//.test(x)),'worker_writer_dependency');
 const entry=await readFile(root+'src/planner/attempts/persistence/worker/preview.worker.ts','utf8'),session=await readFile(root+'src/planner/attempts/persistence/worker/session.ts','utf8');
 assert.ok(!/from ['"].*(?:persistentSession|syncSession|indexedDb['"])/.test(entry+session));assert.ok(session.includes('async commit(){throw new Fault(\'readonly_mode\');}'));assert.ok(session.includes('createAttemptPersistence(store,undefined,environment'));
 return {parent,changes:rows(parent),untracked,mainInputs,mainBundleBytes:main.outputFiles[0].contents.length,productionWorkerInputs:0,workerInputs,workerBundleBytes:worker.outputFiles[0].contents.length,frozenBoundaries:protectedPaths,oldScopeVerifierUnchanged:true,nativeRuntimeCountersRequiredSeparately:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await verify(),null,2));
