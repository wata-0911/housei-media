// Focused F01 native/CSP gate. TEST ONLY revision never enters Vite production.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {input,course} from '../grade-import-pure/ledgerFixture.mjs';
import {testRevisionDefine,TEST_REVISION} from './revision-fixture.mjs';
import {resolveExporterStamp} from '../../scripts/grade-import-backup-revision.mjs';
const root=process.cwd(),requireClean=process.env.G03_REQUIRE_CLEAN_EXPORTER==='1';
const evidence=process.env.G03_REVISION_EVIDENCE;
let browser,server,origin,productionStamp;
before(async()=>{
 productionStamp=resolveExporterStamp(root);
 if(requireClean){assert.ok(productionStamp.stamp,'real clean exporter commit required; no test fallback');assert.equal(productionStamp.stamp.revision,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());}
 const output=await viteBuild({configFile:resolve(root,'vite.config.js'),logLevel:'warn',build:{write:false,minify:false,lib:{entry:resolve(root,'tests/grade-import-backup/revision-entry.ts'),formats:['es'],fileName:'revision'}}});
 const prod=output[0].output.filter(o=>o.type==='chunk');assert.equal(prod.length,1);
 assert.equal(prod[0].code.includes(TEST_REVISION),false);assert.equal((/["']test-only["']/).test(prod[0].code),false);
 const modules={'/production.mjs':prod[0].code};
 for(const [name,define] of Object.entries({test:testRevisionDefine,missing:{},invalid:{...testRevisionDefine,'import.meta.__G03_EXPORTER_STAMP__':JSON.stringify({source:'test-only',revision:'BAD'})},testInDistribution:{...testRevisionDefine,'import.meta.__G03_EXPORTER_TEST__':'false'}})){
  const b=await build({entryPoints:['tests/grade-import-backup/revision-entry.ts'],bundle:true,write:false,format:'esm',platform:'browser',define});modules['/'+name+'.mjs']=b.outputFiles[0].text;
 }
 server=createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'");res.setHeader('Content-Type',modules[req.url]?'text/javascript':'text/html');res.end(modules[req.url]||'<!doctype html><title>F01 isolated revision</title>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 const {chromium}=await import(process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true});
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(resolve(evidence,'production-stamp.json'),JSON.stringify({requireClean,...productionStamp},null,2)+'\n');}
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
test('F01 native: TEST ONLY export, missing/invalid/forbidden test stamp put0 UUID0, unstamped R0',async t=>{
 const source=await browser.newContext();t.after(()=>source.close());const page=await source.newPage();await page.goto(origin);
 const raw=JSON.stringify(input([course('F01合成原文𠮷',4,'2024')]));
 const result=await page.evaluate(async raw=>{
  const api=await import('/test.mjs'),c=api.createGradeImportHostV2(indexedDB,navigator.locks,location.origin),h=await c.initialize();
  // Legal T1-only backup, including unconsumed durable burns.
  const p=await c.preview(h,raw);await c.prepare(p,false);
  const A=(await api.createNativeHostStore(indexedDB).read()).value;
  const text=await (await api.createGradeImportBackupController(indexedDB,navigator.locks,location.origin,localStorage).exportBackup()).text();
  let puts=0,uuids=0;const put=IDBObjectStore.prototype.put,uuid=crypto.randomUUID;
  IDBObjectStore.prototype.put=function(...args){puts++;return put.apply(this,args);};crypto.randomUUID=()=>{uuids++;return uuid.call(crypto);};
  const errors={};for(const name of ['missing','invalid','testInDistribution']){
   const m=await import('/'+name+'.mjs');const x=m.createGradeImportBackupController(indexedDB,navigator.locks,location.origin,localStorage);
   try{await x.exportBackup();errors[name]='ISSUED';}catch(e){errors[name]=e.code;}
  }
  return {A,text,errors,puts,uuids,current:(await api.createNativeHostStore(indexedDB).read()).value};
 },raw);
 assert.equal(JSON.parse(result.text).producer.revision,TEST_REVISION);assert.equal(result.current,result.A);
 assert.deepEqual(result.errors,{missing:'revision_unavailable',invalid:'revision_unavailable',testInDistribution:'revision_unavailable'});assert.equal(result.puts,0);assert.equal(result.uuids,0);
 const target=await browser.newContext();t.after(()=>target.close());const p=await target.newPage();await p.goto(origin);
 const restored=await p.evaluate(async({text,A})=>{
  const a=await import('/missing.mjs');const inspected=await a.inspectBackupBytes(new TextEncoder().encode(text));if(inspected.raw!==A)throw Error('inspect mismatch');
  const b=a.createGradeImportBackupController(indexedDB,navigator.locks,location.origin,localStorage),file=new File([text],'explicit-test-only.b1.json'),i=await b.prepareRestore(file),q=await b.confirmRestore(i,JSON.stringify({targetSha256:i.targetSha256,confirmed:true,reason:'F01 explicit isolated R0'}));
  const r=await b.commitRestore(q);return {status:r.status,A:(await a.createNativeHostStore(indexedDB).read()).value};
 },result);
 assert.equal(restored.status,'restored');assert.equal(restored.A,result.A);
 if(evidence){await writeFile(resolve(evidence,'test-only.b1.json'),result.text);await writeFile(resolve(evidence,'test-only.host.json'),result.A);await writeFile(resolve(evidence,'native-stamp-evidence.json'),JSON.stringify({...result,text:undefined,A:undefined,current:undefined,restored:{status:restored.status,exact:true},testRevision:TEST_REVISION},null,2)+'\n');}
});
test('F01 native: Vite distribution uses real clean checkout or refuses export',async t=>{
 const ctx=await browser.newContext();t.after(()=>ctx.close());const p=await ctx.newPage();await p.goto(origin);
 const r=await p.evaluate(async()=>{
  const a=await import('/production.mjs'),c=a.createGradeImportHostV2(indexedDB,navigator.locks,location.origin);await c.initialize();
  const A=(await a.createNativeHostStore(indexedDB).read()).value,b=a.createGradeImportBackupController(indexedDB,navigator.locks,location.origin,localStorage);
  try{return {text:await(await b.exportBackup()).text(),A};}catch(e){return {code:e.code,A};}
 });
 if(productionStamp.stamp){assert.equal(JSON.parse(r.text).producer.revision,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());assert.equal(Buffer.from(JSON.parse(r.text).record.payload,'base64').toString('utf16le'),r.A);}
 else {assert.equal(r.code,'revision_unavailable');assert.equal(r.text,undefined);}
 if(evidence){await writeFile(resolve(evidence,'distribution-result.json'),JSON.stringify({requireClean,code:r.code,revision:r.text?JSON.parse(r.text).producer.revision:null,exportIssued:!!r.text},null,2)+'\n');if(r.text)await writeFile(resolve(evidence,'distribution.b1.json'),r.text);}
});
