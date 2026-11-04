import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {adopted,json} from '../grade-import-host/fixture.mjs';
// External diagnostic bundle only; never edit or replace the production v1 verifier.
test('P1: one old decode per genesis; public target still fully decodes',async()=>{
 const root=new URL('../../',import.meta.url).pathname,dir=await mkdtemp(resolve(tmpdir(),'g03-p1-'));
 try{
  const built=await build({absWorkingDir:root,stdin:{contents:"export * from './src/planner/attempts/gradeImportHost/codecV2';",resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'count-v1-entry',setup(b){b.onLoad({filter:/gradeImportHost\/codec\.ts$/},async({path})=>{const s=await readFile(path,'utf8'),mark='export async function decodeHost(raw: unknown): Promise<FrozenRecord> {';assert.equal(s.split(mark).length,2);return {contents:s.replace(mark,mark+'globalThis.__g03P1DecodeCount++;'),loader:'ts'};});}}]});
  const file=resolve(dir,'codec.mjs');await writeFile(file,built.outputFiles[0].text);const api=await import(pathToFileURL(file).href),old=await adopted(true),raw='\n'+JSON.stringify(old.t2,null,2)+'\n';
  globalThis.__g03P1DecodeCount=0;const target=await api.upgradeTarget(raw,'native-v1-upgrade');assert.equal(globalThis.__g03P1DecodeCount,1);
  globalThis.__g03P1DecodeCount=0;const migrated=await api.migrate(raw,'native-v1-upgrade',{...target,confirmed:true,reason:'P1 exact bytes'}),migrateCount=globalThis.__g03P1DecodeCount;
  globalThis.__g03P1DecodeCount=0;const decoded=await api.decodeHostV2(json(migrated)),decodeCount=globalThis.__g03P1DecodeCount;
  console.log(JSON.stringify({P1:{migrateCount,decodeCount,legacyBytesPreserved:decoded.legacyBaseRaw===raw}}));
  assert.equal(decodeCount,1,'one old decode per v2 genesis');assert.equal(migrateCount,2,'two genesis executions in migrate');assert.equal(decoded.legacyBaseRaw,raw);assert.equal(decoded.ledgerRaw,old.t2.ledgerRaw);assert.deepEqual(decoded.receipts,old.t2.receipts);assert.deepEqual(decoded.outcomes,old.t2.outcomes);assert.deepEqual(decoded.authority,old.t2.authority);assert.deepEqual(decoded,migrated);assert.ok(Object.isFrozen(decoded)&&Object.isFrozen(decoded.authority.reservedIds));assert.ok(!Object.keys(api).some(k=>/Decoded|Validated|Verified|Cache/.test(k)));
 }finally{delete globalThis.__g03P1DecodeCount;await rm(dir,{recursive:true,force:true});}
});
