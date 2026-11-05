// BUILD TIME ONLY. Never import from src/. No SHA environment override.
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const exporterSources = Object.freeze([
 'vite.config.js', 'scripts/grade-import-backup-revision.mjs',
 ...['codec','contracts','controller','json','restoreStore','revision'].map(n=>`src/planner/attempts/gradeImportHost/portable/${n}.ts`),
]);
function nativeGit(root,args) {
 // Do not inherit GIT_DIR/GIT_WORK_TREE/index/config replacement variables.
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 return execFileSync('git',['--no-replace-objects','--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.fileMode=true',...args],
  {cwd:root,env,stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024});
}
/** The injected git/read functions exist only for build-helper unit tests.
 * Vite always uses the native defaults; no runtime caller or JSON reaches here. */
export function resolveExporterStamp(root,{git=args=>nativeGit(root,args),read=path=>readFileSync(resolve(root,path))}={}) {
 try {
  const text=args=>git(args).toString('utf8');
  if(realpathSync(text(['rev-parse','--show-toplevel']).trim())!==realpathSync(root))throw Error('wrong_worktree');
  const revision=text(['rev-parse','--verify','HEAD^{commit}']).trim();
  if(!/^[a-f0-9]{40}$/.test(revision))throw Error('invalid_revision');
  const clean=()=>{
   if(text(['status','--porcelain=v1','--untracked-files=all']).length)throw Error('dirty_worktree');
   // status alone hides assume-unchanged / skip-worktree changes.
   if(text(['ls-files','-v','-z']).split('\0').filter(Boolean).some(p=>!p.startsWith('H ')))throw Error('hidden_index_flags');
   if(text(['ls-files','--others','--ignored','--exclude-standard','--','src','dev','scripts']).length)throw Error('ignored_source');
  };
  clean();
  const tree=text(['ls-tree','-r','-z','HEAD','--',...exporterSources]).split('\0').filter(Boolean);
  for(const path of exporterSources) {
   if(!tree.some(row=>/^100(?:644|755) blob [a-f0-9]{40}\t/.test(row)&&row.split('\t')[1]===path))throw Error('exporter_not_in_commit');
   if(!Buffer.from(read(path)).equals(git(['show',`HEAD:${path}`])))throw Error('source_bytes_differ');
  }
  clean();
  if(text(['rev-parse','--verify','HEAD^{commit}']).trim()!==revision)throw Error('checkout_changed');
  return Object.freeze({stamp:Object.freeze({source:'clean-git',revision}),reason:null});
 } catch(e) {
  const known=['wrong_worktree','invalid_revision','dirty_worktree','hidden_index_flags','ignored_source','exporter_not_in_commit','source_bytes_differ','checkout_changed'];
  return Object.freeze({stamp:null,reason:known.includes(e.message)?e.message:'git_unavailable'});
 }
}
export function exporterBuildSettings(root,{command='build',resolveStamp=()=>resolveExporterStamp(root)}={}) {
 const result=command==='build'?resolveStamp():{stamp:null,reason:'not_distribution_build'};
 const verify=()=>{
  if(result.stamp){const next=resolveStamp();if(!next.stamp||next.stamp.revision!==result.stamp.revision)throw Error('G03 exporter source changed during build');}
 };
 return {
  result,
  define:{'import.meta.__G03_EXPORTER_STAMP__':JSON.stringify(result.stamp),'import.meta.__G03_EXPORTER_TEST__':'false'},
  plugin:{name:'g03-exporter-clean-source',buildStart:verify,generateBundle:verify},
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const result=resolveExporterStamp(fileURLToPath(new URL('../',import.meta.url)));
 console.log(JSON.stringify(result));if(!result.stamp)process.exitCode=1;
}
