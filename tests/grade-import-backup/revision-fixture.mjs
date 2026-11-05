// TEST ONLY. Never imported by Vite config, build scripts or product modules.
// Deliberately synthetic: this is NOT a Git implementation commit.
import {build} from 'esbuild';
export const TEST_REVISION = 'f'.repeat(40);
export const testRevisionDefine = Object.freeze({
 'import.meta.__G03_EXPORTER_STAMP__': JSON.stringify({source:'test-only',revision:TEST_REVISION}),
 'import.meta.__G03_EXPORTER_TEST__': 'true',
});
export async function bundledCodec(define = testRevisionDefine) {
 const result=await build({entryPoints:['src/planner/attempts/gradeImportHost/portable/codec.ts'],bundle:true,write:false,platform:'node',format:'esm',define});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
}
