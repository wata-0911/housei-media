import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
test('A14/A23: historical dependencies retain pinned bytes (R6 membership-only persistence revision)',()=>{
 const pinned=JSON.parse(readFileSync(new URL('./historical-dependencies.json',import.meta.url)));for(const[p,h]of Object.entries(pinned))assert.equal(createHash('sha256').update(readFileSync(p)).digest('hex'),h,p);
});
test('A23: backup cold browser import requires no IO, UUID, clock or dynamic code generation',async()=>{
 const r=await build({entryPoints:['src/planner/attempts/gradeImportHost/portable/controller.ts'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm'});
 assert.deepEqual(Object.keys(r.metafile.inputs).filter(p=>/ajv|\/validation\.|\/catalog\/|\/workbench\/|[Ww]orker|\/backup\/storage\.ts|persistence\/(codec|controller|indexedDb|newPlan)\.ts/.test(p)),[]);
 assert.deepEqual(Object.keys(r.metafile.inputs).filter(p=>/grade-import-backup-revision|revision-fixture|node:/.test(p)),[]);
 const d=mkdtempSync(resolve(tmpdir(),'g03-b1-csp-')),file=resolve(d,'backup.mjs');writeFileSync(file,r.outputFiles[0].contents);
 try{const out=execFileSync(process.execPath,['--disallow-code-generation-from-strings','--input-type=module','-e',`for(const n of ['indexedDB','navigator','location','localStorage','File','Blob','fetch','Worker'])Object.defineProperty(globalThis,n,{get(){throw Error('IO '+n);}});crypto.randomUUID=()=>{throw Error('UUID');};Date.now=()=>{throw Error('clock');};const m=await import(${JSON.stringify(pathToFileURL(file).href)});if(typeof m.createGradeImportBackupController!=='function')throw Error('export');console.log('no IO');`],{encoding:'utf8'});assert.equal(out.trim(),'no IO');}finally{rmSync(d,{recursive:true,force:true});}
});
