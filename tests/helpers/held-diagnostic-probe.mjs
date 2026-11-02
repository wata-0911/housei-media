import {build} from 'esbuild';import {readFile,writeFile,mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
const root=new URL('../../',import.meta.url).pathname;
/** Test-only multiplicity at the real analysis/display seam. Product analysis
 * and full replay still run; only the already-held blockers are expanded. */
export async function heldProbe(){
 const target=await mkdtemp(join(process.env.PR214_TEST_OUTPUT||tmpdir(),'held-probe-'));
 const result=await build({stdin:{contents:`export {createPreviewSession} from './src/planner/attempts/persistence/worker/session.ts';export {env} from './tests/fixtures/migration-fixture.mjs';export {versionedFixture} from './tests/helpers/worker-versioned-fixture.mjs';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'test-only-held-count',setup(b){b.onLoad({filter:/worker\/session\.ts$/},async a=>{const s=await readFile(a.path,'utf8'),from='rule2Diagnostics(analysis?.blockers??[])';if(s.split(from).length!==2)throw Error('held_probe_seam');return {contents:s.replace(from,'rule2Diagnostics(analysis?.blockers.length ? (globalThis as unknown as {testBlockers:{kind:string}[]}).testBlockers : [])'),loader:'ts',resolveDir:dirname(a.path)};});b.onLoad({filter:/\.mjs$/},async a=>({contents:(await readFile(a.path,'utf8')).replaceAll('import.meta.url',JSON.stringify('file://'+a.path)),loader:'js',resolveDir:dirname(a.path)}));}}]});const path=join(target,'probe.mjs');await writeFile(path,result.outputFiles[0].text);return import(path);
}
