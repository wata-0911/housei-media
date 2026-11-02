import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
const cases=['root-undefined','coverage-undefined','NaN','Infinity','invalid-Date','boxed-String'];
let browser,page,server,dir,fixture;const errors=[];
const evidence=process.env.PR4_BOUNDARY_EVIDENCE;
async function record(name,data){console.log(name+' '+JSON.stringify(data));if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,name+'.json'),JSON.stringify(data,null,2));}}
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
before(async()=>{
 if(process.env.PR4_SCHEMA23_AUTHORITY)fixture=JSON.parse(await readFile(process.env.PR4_SCHEMA23_AUTHORITY,'utf8'));
 else {
  const {env,initialState}=await import('./fixtures/migration-fixture.mjs');
  const {decodeMigrationSource}=await import('../src/planner/attempts/migration/source.ts');const {prepareMigrationIds}=await import('../src/planner/attempts/migration/assignments.ts');
  const {buildMigrationTarget}=await import('../src/planner/attempts/migration/transform.ts');const {createWorkspace}=await import('../src/planner/attempts/workbench/operations.ts');const {encodeState}=await import('../src/planner/attempts/persistence/codec.ts');
  const d=await decodeMigrationSource(JSON.stringify(initialState()),env,env.origin);assert.equal(d.status,'decoded');const table=prepareMigrationIds(d.source),base=buildMigrationTarget(d.source,table),state=await encodeState(d.source,table,base,createWorkspace(base.graph,d.source.context),env.target);
  fixture={raw:JSON.stringify(state),revision:7,committed:[createHash('sha256').update(canonical(state)).digest('hex')],issuedIds:state.history.issuedIds};
 }
 const state=JSON.parse(fixture.raw);assert.equal(state.schemaVersion,23);assert.equal(state.rule.version,1);assert.equal(createHash('sha256').update(canonical(state)).digest('hex'),fixture.committed[0]);
 dir=await mkdtemp(join(tmpdir(),'pr4-boundary-'));const bundle=join(dir,'probe.js');await build({stdin:{contents:"import * as probe from './tests/helpers/persistent-boundary-probe.mjs';globalThis.probe=probe;",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outfile:bundle,logLevel:'silent'});
 const code=await readFile(bundle);server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/probe.js'?'text/javascript':'text/html');res.end(req.url==='/probe.js'?code:'<!doctype html><script src="/probe.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});console.log('Chromium '+browser.version());page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!globalThis.probe);
});
after(async()=>{try{assert.deepEqual(errors,[]);}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));if(dir)await rm(dir,{recursive:true,force:true});}});
for(const name of cases)test(`F02 native malformed ${name}: no handle/ID/backup, unchanged record, CAS preserved`,{timeout:120000},async()=>{
 const result=await page.evaluate(name=>probe.malformed(name),name);await record('f02-'+name,result);
 assert.equal(result.loaded.ok,false);assert.equal(result.loaded.error,'authority_record_invalid');assert.equal(result.identity.ok,false);assert.equal(result.backup.ok,false);assert.equal(result.newPlan.ok,false);assert.equal(result.mints,0);assert.equal(result.productPuts,0);assert.equal(result.directCAS.ok,false);assert.equal(result.directCAS.error,'stale_commit');assert.deepEqual(result.after,result.before);assert.equal(result.after.revision,1);
 if(name==='root-undefined')assert.equal(result.before.rootExtra,true);if(name==='coverage-undefined')assert.equal(result.before.coverageExtra,true);if(name==='NaN')assert.equal(result.before.baselineNaN,true);if(name==='Infinity')assert.equal(result.before.baselineInfinity,true);if(name==='invalid-Date')assert.equal(result.before.invalidDate,true);if(name==='boxed-String'){assert.equal(result.before.rawTag,'[object String]');assert.equal(result.protection.ok,false);}else{assert.equal(result.protection.ok,true);const p=JSON.parse(result.protection.value);assert.equal(p.sha256,createHash('sha256').update(p.currentRaw,'utf8').digest('hex'));}
});
for(const name of cases)test(`F02 postcommit ${name}: unknown, one product put, no retry or rollback`,{timeout:120000},async()=>{
 const result=await page.evaluate(name=>probe.postcommitCorruption(name),name);await record('post-'+name,result);assert.equal(result.result.ok,false);assert.equal(result.result.error,'commit_outcome_unknown');assert.equal(result.result.cause,'authority_record_invalid');assert.equal(result.storeCommits,1);assert.equal(result.productPuts,1);assert.equal(result.injectedPuts,1);assert.equal(result.after.revision,2);assert.equal(result.retry.error,'explicit_confirmation_required');assert.equal(result.backup.ok,false);assert.equal(result.reloaded.ok,false);
});
test('F02 native schema24 positive: load, tracked edit, commit, v4 export',{timeout:120000},async()=>{
 const result=await page.evaluate(()=>probe.positive24());await record('positive24',result);assert.deepEqual(result,{revision:2,status:'native-v2-save-authorized',attempts:1,backupVersion:4,backupStateEqual:true,reserved:true,productPuts:1,injectedPuts:0});
});
for(const mode of ['before-change','stable','static','lock-change','provider-reject','provider-delay','during-validation','post-reject','post-change'])test(`F01 schema23 ${mode}`,{timeout:120000},async()=>{
 const result=await page.evaluate(({fixture,mode})=>probe.environmentCase(fixture,mode),{fixture,mode});await record('f01-'+mode,result);assert.equal(result.invariant.allOtherValuesEqual,true);assert.equal(result.invariant.baseline,fixture.committed[0]);assert.equal(result.allSavedOtherValuesEqual,true);
 if(['stable','static'].includes(mode)){assert.equal(result.result.ok,true);assert.equal(result.result.saveStatus,'legacy-unproven');assert.equal(result.productPuts,1);assert.equal(result.commits,1);assert.equal(result.revisionAfter,8);assert.equal(result.savedCoverage.baselineStateSha256,fixture.committed[0]);for(const r of Object.values(result.restrictions))assert.equal(r.error,'legacy_normal_save_blocked');if(mode==='stable')assert.ok(result.providerCalls>result.previewCalls);}
 else if(mode.startsWith('post-')){assert.equal(result.result.ok,false);assert.equal(result.result.error,'commit_outcome_unknown');assert.equal(result.productPuts,1);assert.equal(result.commits,1);assert.equal(result.revisionAfter,8);assert.equal(result.retry.error,'explicit_confirmation_required');}
 else {assert.equal(result.result.ok,false);assert.equal(result.result.error,mode==='provider-reject'?'environment_provider_rejected':'target_catalog_changed');assert.equal(result.productPuts,0);assert.equal(result.commits,0);assert.equal(result.revisionAfter,7);assert.equal(result.rawUnchanged,true);}
 if(mode==='lock-change'){assert.equal(result.waiting.settled,false);assert.equal(result.waiting.callsSincePreview,0);assert.equal(result.waiting.productPuts,0);}if(mode==='provider-delay'){assert.equal(result.waiting.settled,false);assert.equal(result.waiting.revision,7);assert.equal(result.waiting.productPuts,0);}if(mode==='during-validation')assert.ok(result.commitCalls>=3);
});
test('F01 all environment fields: origin/rawFiles/catalog/archive changes fail before put; restoring A permits retry',{timeout:120000},async()=>{
 const result=await page.evaluate(fixture=>probe.environmentFields(fixture),fixture);await record('f01-fields',result);
 for(const row of result.results){assert.equal(row.result.ok,false);assert.equal(row.result.error,'target_catalog_changed');assert.equal(row.revision,7);assert.equal(row.productPuts,0);}
 assert.equal(result.finalStatus,'legacy-unproven');assert.equal(result.finalRevision,8);assert.equal(result.productPuts,1);
});
