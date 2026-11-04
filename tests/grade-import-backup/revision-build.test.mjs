import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {build as viteBuild} from 'vite';
import {resolveExporterStamp,exporterBuildSettings,exporterSources} from '../../scripts/grade-import-backup-revision.mjs';
import {TEST_REVISION} from './revision-fixture.mjs';
import {reserved,json} from '../grade-import-host/fixture.mjs';
const root=process.cwd(),modelSHA='a'.repeat(40);
// A model Git process, NOT a real clean commit. The real clean-checkout gate
// must run after committing; these fixtures never attest the current candidate.
function gitModel(change=()=>undefined) {
 const calls=[];
 const git=args=>{
  calls.push(args);const altered=change(args,calls);if(altered!==undefined)return Buffer.from(altered);
  switch(args[0]) {
   case 'rev-parse':return Buffer.from(args[1]==='--show-toplevel'?root+'\n':modelSHA+'\n');
   case 'status':return Buffer.from('');
   case 'ls-files':return Buffer.from(args[1]==='-v'?'H file\0':'');
   case 'ls-tree':return Buffer.from(exporterSources.map(p=>`100644 blob ${'b'.repeat(40)}\t${p}\0`).join(''));
   case 'show':return Buffer.from('fixture '+args[1].slice(5));
   default:throw Error('unexpected git '+args);
  }
 };
 return {git,read:p=>Buffer.from('fixture '+p),calls};
}
test('F01 build: model clean source selects actual checkout HEAD, never environment/PR head override',()=>{
 const f=gitModel();const result=resolveExporterStamp(root,f);
 assert.deepEqual(result,{stamp:{source:'clean-git',revision:modelSHA},reason:null});
 for(const p of exporterSources)assert.ok(f.calls.some(a=>a[0]==='show'&&a[1]==='HEAD:'+p));
 const build=exporterBuildSettings(root,{resolveStamp:()=>result});
 assert.equal(build.define['import.meta.__G03_EXPORTER_TEST__'],'false');
 assert.equal(JSON.parse(build.define['import.meta.__G03_EXPORTER_STAMP__']).revision,modelSHA);
 build.plugin.buildStart();build.plugin.generateBundle();
});
for(const [name,change,reason] of [
 ['tracked edit',a=>a[0]==='status'?' M src/codec.ts\n':undefined,'dirty_worktree'],
 ['untracked implementation',a=>a[0]==='status'?'?? src/revision.ts\n':undefined,'dirty_worktree'],
 ['missing exporter in commit',a=>a[0]==='ls-tree'?'':undefined,'exporter_not_in_commit'],
 ['invalid HEAD',a=>a[0]==='rev-parse'&&a[1]==='--verify'?'invalid\n':undefined,'invalid_revision'],
 ['hidden assume unchanged',a=>a[0]==='ls-files'&&a[1]==='-v'?'h file\0':undefined,'hidden_index_flags'],
 ['hidden skip worktree',a=>a[0]==='ls-files'&&a[1]==='-v'?'S file\0':undefined,'hidden_index_flags'],
 ['ignored source',a=>a[0]==='ls-files'&&a[1]==='--others'?'src/x.local\n':undefined,'ignored_source'],
 ['symlink exporter',a=>a[0]==='ls-tree'?exporterSources.map(p=>`120000 blob ${'b'.repeat(40)}\t${p}\0`).join(''):undefined,'exporter_not_in_commit'],
 ['HEAD race',(a,c)=>a[0]==='rev-parse'&&a[1]==='--verify'&&c.filter(x=>x[0]==='rev-parse'&&x[1]==='--verify').length===2?'c'.repeat(40)+'\n':undefined,'checkout_changed'],
])test('F01 build: '+name+' disables stamp',()=>{
 const r=resolveExporterStamp(root,gitModel(change));assert.equal(r.stamp,null);assert.equal(r.reason,reason);
});
test('F01 build: unavailable Git, byte mismatch and build-time edit disable or abort',()=>{
 assert.equal(resolveExporterStamp(root,{git:()=>{throw Error('no Git');}}).stamp,null);
 const f=gitModel();assert.equal(resolveExporterStamp(root,{...f,read:()=>Buffer.from('dirty')}).reason,'source_bytes_differ');
 const clean=resolveExporterStamp(root,f);let r=clean;
 const b=exporterBuildSettings(root,{resolveStamp:()=>r});r={stamp:null,reason:'dirty_worktree'};
 assert.throws(()=>b.plugin.buildStart(),/source changed/);assert.throws(()=>b.plugin.generateBundle(),/source changed/);
 r={stamp:{source:'clean-git',revision:'c'.repeat(40)}};assert.throws(()=>b.plugin.generateBundle(),/source changed/);
 const dev=exporterBuildSettings(root,{command:'serve',resolveStamp:()=>{throw Error('must not stamp dev');}});assert.equal(dev.define['import.meta.__G03_EXPORTER_STAMP__'],'null');
});
test('F01 build: real Vite distribution ignores environment hints and matches checkout or fails closed',async()=>{
 const names=['G03_EXPORTER_REVISION','VITE_G03_EXPORTER_REVISION','VERCEL_GIT_COMMIT_SHA'];const before=names.map(n=>process.env[n]);
 try{
  for(const n of names)process.env[n]=TEST_REVISION;
  const r=resolveExporterStamp(root);
  const dirty=execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{encoding:'utf8'}).length>0;
  if(dirty){assert.equal(r.stamp,null);assert.equal(r.reason,'dirty_worktree');}
  else {assert.equal(r.stamp.revision,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());}
  const outputs=await viteBuild({configFile:resolve(root,'vite.config.js'),logLevel:'warn',build:{write:false,minify:false,lib:{entry:resolve(root,'src/planner/attempts/gradeImportHost/portable/codec.ts'),formats:['es'],fileName:'codec'}}});
  const code=outputs[0].output.filter(o=>o.type==='chunk').map(o=>o.code).join('\n');
  assert.equal(code.includes(TEST_REVISION),false);assert.equal((/["']test-only["']/).test(code),false);assert.equal(code.includes('node:child_process'),false);
  const m=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  if(!r.stamp)await assert.rejects(m.packBackup(json((await reserved()).t1)),e=>e.code==='revision_unavailable');
  else assert.equal(JSON.parse(new TextDecoder().decode(await m.packBackup(json((await reserved()).t1)))).producer.revision,r.stamp.revision);
 }finally{names.forEach((n,i)=>{if(before[i]===undefined)delete process.env[n];else process.env[n]=before[i];});}
});
test('F01 build: production settings have no test-helper dependency or SHA env read',()=>{
 const source=readFileSync('scripts/grade-import-backup-revision.mjs','utf8');
 assert.equal(/revision-fixture|tests\/|VERCEL_GIT_COMMIT_SHA|VITE_G03|G03_EXPORTER_REVISION/.test(source),false);
 assert.ok(source.includes("'--no-replace-objects'"));
});
test('F01 build: production main graph still cannot reach portable exporter or test revision helper',async()=>{
 let checked=false;
 await viteBuild({configFile:resolve(root,'vite.config.js'),logLevel:'warn',build:{write:false},plugins:[{name:'f01-production-graph',generateBundle(){
  const inputs=[...this.getModuleIds()];assert.deepEqual(inputs.filter(p=>/gradeImportHost\/portable\/|revision-fixture|grade-import-backup-revision/.test(p)),[]);checked=true;
 }}]});assert.equal(checked,true);
});
