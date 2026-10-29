import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,mkdtemp,symlink,copyFile,unlink} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const evidence=process.env.BOUNDARY_EVIDENCE;
assert.ok(evidence,'BOUNDARY_EVIDENCE must be outside the repository');await mkdir(evidence,{recursive:true});
const built=await build({stdin:{contents:`export {createPreviewSession} from './src/planner/attempts/persistence/worker/session.ts';export {createAttemptPersistence} from './src/planner/attempts/persistence/controller.ts';export {makeAttempt} from './src/planner/attempts/workbench/catalogView.ts';export {emptyAuthority} from './src/planner/attempts/persistence/contracts.ts';export {env} from './tests/fixtures/migration-fixture.mjs';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'test-only-apply-count',setup(b){
 b.onLoad({filter:/migration-fixture\.mjs$/},async a=>({loader:'js',contents:(await readFile(a.path,'utf8')).replaceAll('import.meta.url',JSON.stringify('file://'+a.path))}));
 b.onLoad({filter:/workbench\/operations\.ts$/},async a=>({loader:'ts',contents:(await readFile(a.path,'utf8')).replace('  const command = structuredClone(input);','  globalThis.__boundaryApplyCalls = (globalThis.__boundaryApplyCalls ?? 0) + 1;\n  const command = structuredClone(input);')}));
 b.onLoad({filter:/worker\/session\.ts$/},async a=>({loader:'ts',contents:(await readFile(a.path,'utf8')).replace('  request(c:Control,raw?:string){','  probe(){return {controller,editIds,activeDraft,activePreview,view};},\n  request(c:Control,raw?:string){')}));
}}]});
const probe=resolve(evidence,'boundary-probe.mjs');await writeFile(probe,built.outputFiles[0].text);const api=await import('file://'+probe);
const U=n=>`a2060000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={title:'boundary',courseId:null,placementId:null,plan:{status:'planned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null},method:'media',note:''};
function add(h,n){const attempt=api.makeAttempt(h.source.context.catalog,input,{id:'hosei:attempt:'+U(n+1),creationOperationId:'hosei:attempt-op:'+U(n)});return {kind:'add',operationId:attempt.creationOperationId,attempt};}
function memory(){let record=api.emptyAuthority();return {writes:0,read:async()=>structuredClone(record),async commit(expected,next){assert.deepEqual(expected,record);record=structuredClone(next);this.writes++;},snapshot:()=>structuredClone(record)};}
const locks={request:async(_n,_o,f)=>f()};
const commit=(c,p)=>c.commit(p,true,p.previousRaw,p.sourceRaw);

test('qualified factory hook sees actual prestates, preserves duplicates, rejects copied handles before callback, aborts atomically',async()=>{
 const store=memory(),seen=[];let reject=false;
 const c=api.createAttemptPersistence(store,locks,undefined,undefined,{issued(){},reserved:()=>[],beforeCommand:(w,cmd)=>{seen.push({operationId:cmd.operationId,receipts:w.receipts.length,title:w.graph.attempts.at(-1)?.originalTitle});if(reject)throw Error('trusted_policy_rejection');}});
 const p=await c.prepareNewPlan(),h=p.handle,cmd=add(h,1);
 await assert.rejects(c.prepareEdits(structuredClone(h),[cmd]),/unverified_assignment_history/);assert.throws(()=>c.dispatch(structuredClone(h),h.workspace,cmd),/unverified_assignment_history/);assert.equal(seen.length,0);
 const before=JSON.stringify(h),preview=await c.prepareEdits(h,[cmd,{kind:'edit',operationId:'hosei:attempt-op:'+U(3),attemptId:cmd.attempt.id,changes:{originalTitle:'first'}},{kind:'edit',operationId:'hosei:attempt-op:'+U(4),attemptId:cmd.attempt.id,changes:{originalTitle:'second'}}]);
 assert.deepEqual(seen,[{operationId:cmd.operationId,receipts:0,title:undefined},{operationId:'hosei:attempt-op:'+U(3),receipts:1,title:'boundary'},{operationId:'hosei:attempt-op:'+U(4),receipts:2,title:'first'}]);assert.equal(JSON.stringify(h),before);
 const w=preview.handle.workspace,count=seen.length;assert.equal(c.dispatch(h,w,cmd),w);assert.equal(seen.length,count);assert.throws(()=>c.dispatch(h,w,{...cmd,attempt:{...cmd.attempt,originalTitle:'conflict'}}),/replay_conflict/);assert.equal(seen.length,count);
 reject=true;await assert.rejects(c.prepareEdits(h,[add(h,10)]),/trusted_policy_rejection/);assert.equal(store.writes,0);assert.equal(JSON.stringify(h),before);
 reject=false;const loaded=await commit(c,preview),backup=await c.createBackup(loaded);const reloaded=await c.load();assert.deepEqual(reloaded.state,loaded.state);assert.deepEqual(reloaded.workspace,loaded.workspace);assert.equal(seen.length,count+1); // no hooks during commit/replay/load/backup
 const target=memory();let recoveryCalls=0;const other=api.createAttemptPersistence(target,locks,undefined,undefined,{issued(){},reserved:()=>[],beforeCommand(){recoveryCalls++;}}),recovery=await other.inspectBackup(backup);await assert.rejects(other.prepareEdits(recovery.handle,[cmd]),/unconfirmed_recovery/);assert.equal(recoveryCalls,0);assert.equal(target.writes,0);
 await writeFile(resolve(evidence,'qualified-hook.json'),JSON.stringify({seen,noCallbackForCopiedHandle:true,noCallbackForRecovery:true,commitBackupReloadEqual:true},null,2));
});

test('Worker applies each Command once; 50 edits, assessment sequence and failed batch keep original state and every burn',async()=>{
 const s=api.createPreviewSession(async()=>api.emptyAuthority(),async()=>api.env,991);let id=0,view,draft;
 const start=await s.request({version:1,boot:991,requestId:++id,op:'startSession'});view=start.view;
 const call=async(op,extra={})=>{const r=await s.request({version:1,boot:991,requestId:++id,op,session:start.session,expectedView:view,...extra});view=r.view??view;draft=r.draft??draft;return r;};
 const edit=intents=>call('prepareEdits',{draft,intents}),rows=async kind=>(await call('readPage',{kind})).rows;
 const addIntent={kind:'add',selection:null,title:'counter',plan:input.plan,method:'media',note:''};const results=[];
 try{
  await call('prepareNewPlan');globalThis.__boundaryApplyCalls=0;await edit([addIntent]);assert.equal(globalThis.__boundaryApplyCalls,1);
  let a=(await rows('attempts'))[0].row;
  globalThis.__boundaryApplyCalls=0;await edit(Array.from({length:50},(_,n)=>({kind:'edit',attempt:a,changes:{title:'edit '+n}})));assert.equal(globalThis.__boundaryApplyCalls,50);results.push({operation:'edit50',applyCalls:50});
  a=(await rows('attempts'))[0].row;await edit([{kind:'add_record',owner:a,fields:{kind:'media',totalLessons:null}}]);let r=(await rows('records'))[0].row;
  globalThis.__boundaryApplyCalls=0;await edit(['first','second'].map(label=>({kind:'edit_payload',record:r,changes:{kind:'media',addAssessment:{type:'other',label,scheduledDate:null,completed:false}}})));assert.equal(globalThis.__boundaryApplyCalls,2);assert.equal(s.probe().activeDraft.handle.workspace.graph.ownedRecords[0].payload.assessments.length,2);
  a=(await rows('attempts'))[0].row;r=(await rows('records'))[0].row;const prior=s.probe(),original=JSON.stringify(prior.activeDraft),burned=prior.editIds.reservations().length;
  globalThis.__boundaryApplyCalls=0;await assert.rejects(edit([{...addIntent,title:'partial'},{kind:'remove',attempt:a},{kind:'edit',attempt:a,changes:{title:'detached'}}]),/restore_before_edit/);assert.equal(globalThis.__boundaryApplyCalls,3);assert.equal(s.probe().activeDraft,prior.activeDraft);assert.equal(s.probe().activePreview,prior.activePreview);assert.equal(s.probe().view,prior.view);assert.equal(JSON.stringify(prior.activeDraft),original);assert.equal(prior.editIds.reservations().length-burned,4);
  const native=crypto.randomUUID.bind(crypto),failed=prior.editIds.reservations().slice(burned);try{for(const uuid of failed){crypto.randomUUID=()=>uuid;assert.throws(()=>prior.editIds.mint(new Set()),{code:'resource_limit'});}}finally{crypto.randomUUID=native;}
  await edit([{kind:'edit_payload',record:r,changes:{kind:'media',addAssessment:{type:'other',label:'fresh',scheduledDate:null,completed:false}}}]);
  // Neither copied Commands nor Commands built by another allocator have a ticket.
  const h=s.probe().activeDraft.handle,c=add(h,500),copy=structuredClone(c);assert.throws(()=>prior.controller.dispatch(h,h.workspace,copy),{code:'internal'});
  results.push({operation:'failed',applyCalls:3,burned:failed,originalUnchanged:true});await writeFile(resolve(evidence,'single-apply.json'),JSON.stringify(results,null,2));
 }finally{s.close();delete globalThis.__boundaryApplyCalls;}
});

test('standard scope accepts fully tracked future commit tree and rejects tracked/untracked/protected mutations',async()=>{
 const checkout=await mkdtemp(resolve(evidence,'../scope-checkout-'));execFileSync('git',['clone','--no-hardlinks','--no-checkout',root,checkout],{stdio:'pipe'});execFileSync('git',['checkout','--detach','7bcad0403e3bac8389a638abe006bd6de2e81419'],{cwd:checkout,stdio:'pipe'});
 const paths=[...new Set([...execFileSync('git',['diff','--name-only','HEAD'],{cwd:root,encoding:'utf8'}).trim().split('\n'),...execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n')].filter(Boolean))];
 for(const p of paths){await mkdir(dirname(resolve(checkout,p)),{recursive:true});await copyFile(resolve(root,p),resolve(checkout,p));}
 await symlink(resolve(root,'node_modules'),resolve(checkout,'node_modules'),'dir');execFileSync('git',['add','--',...paths],{cwd:checkout});execFileSync('git',['diff','--exit-code'],{cwd:checkout});const tree=execFileSync('git',['write-tree'],{cwd:checkout,encoding:'utf8'}).trim();
 const status=execFileSync('git',['diff','--name-status','--no-renames','81f98862f1cd62aa4d9d9cc04d7f83864ea1858f'],{cwd:checkout,encoding:'utf8'});assert.equal(status,execFileSync('git',['diff','--cached','--name-status','--no-renames','81f98862f1cd62aa4d9d9cc04d7f83864ea1858f'],{cwd:checkout,encoding:'utf8'}));assert.equal(execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:checkout,encoding:'utf8'}),'');
 const run=name=>{const r=spawnSync(process.execPath,['scripts/verify-controller-worker-scope.mjs'],{cwd:checkout,encoding:'utf8'});return writeFile(resolve(evidence,'scope-'+name+'.log'),r.stdout+r.stderr).then(()=>r.status);};
 assert.equal(await run('tracked-clean-equivalent'),0);const readme=resolve(checkout,'README.md'),raw=await readFile(readme);await writeFile(readme,Buffer.concat([raw,Buffer.from('\nforbidden scope test\n')]));assert.equal(await run('negative-tracked'),1);await writeFile(readme,raw);
 const extra=resolve(checkout,'outside-allowed.txt');await writeFile(extra,'forbidden');assert.equal(await run('negative-untracked'),1);await unlink(extra);
 for(const path of ['src/planner/attempts/persistence/controller.ts','src/planner/attempts/migration/source.ts']){const p=resolve(checkout,path),raw=await readFile(p);await writeFile(p,Buffer.concat([raw,Buffer.from('\n// forbidden invariant change\n')]));assert.equal(await run('negative-'+path.split('/').at(-1)),1);await writeFile(p,raw);}
 assert.equal(await run('restored'),0);await writeFile(resolve(evidence,'scope-clean-equivalent.json'),JSON.stringify({base:'81f98862f1cd62aa4d9d9cc04d7f83864ea1858f',publicHead:'7bcad0403e3bac8389a638abe006bd6de2e81419',futureTree:tree,worktreeEqualsIndex:true,untracked:[],noCommitCreated:true,status,negativeTracked:true,negativeUntracked:true,protectedController:true,protectedSource:true},null,2));
});
