import {build} from 'esbuild';import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
/** Test build only: access live objects in the same bundled controller/env realm.
 * Neither product RPC nor the shipped session factory gains this accessor. */
export async function editProbe(){
 const file=root+'tests/fixtures/.controller-edit-probe-'+process.pid+'.mjs';
 const built=await build({stdin:{contents:`export {createPreviewSession} from './src/planner/attempts/persistence/worker/session.ts';export {createAttemptPersistence} from './src/planner/attempts/persistence/controller.ts';export {replayState} from './src/planner/attempts/persistence/codec.ts';export {backupDigest} from './src/planner/backup/plannerBackupCompatibility.ts';export {emptyAuthority} from './src/planner/attempts/persistence/contracts.ts';export {env,mixed,media} from './tests/fixtures/migration-fixture.mjs';`,resolveDir:root,sourcefile:'test-only-probe.mjs'},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'test-only-private-observation',setup(b){b.onLoad({filter:/worker\/session\.ts$/},async a=>({contents:(await readFile(a.path,'utf8')).replace('  request(c:Control,raw?:string){','  __probe(){return {controller,registry,activeDraft,activePreview,activeMigration,pages,authority,selected,view,vector,editIds};},\n  request(c:Control,raw?:string){'),loader:'ts'}));}}]});
 await writeFile(file,built.outputFiles[0].text);try{return await import(file);}finally{await unlink(file);}
}
