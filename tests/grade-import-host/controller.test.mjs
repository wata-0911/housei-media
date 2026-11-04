import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { withPlannerWriteLock as leaf, PLANNER_WRITE_LOCK, STORAGE_KEY, BACKUP_KEY } from '../../src/planner/backup/storagePrimitives.ts';
import { withPlannerWriteLock as old, PLANNER_WRITE_LOCK as oldKey, STORAGE_KEY as oldStorage, BACKUP_KEY as oldBackup } from '../../src/planner/backup/storage.ts';
const root=fileURLToPath(new URL('../../',import.meta.url));
const folder='src/planner/attempts/gradeImportHost/';
function files(p){return readdirSync(p,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(resolve(p,d.name)):/\.[jt]sx?$/.test(d.name)?[resolve(p,d.name)]:[]);}
function graph(){
 const nodes=new Map();
 for(const p of files(resolve(root,'src'))){const edges=[],ast=ts.createSourceFile(p,readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);
  const add=s=>{if(s.startsWith('.')){const r=ts.resolveModuleName(s,p,{moduleResolution:ts.ModuleResolutionKind.Bundler,resolveJsonModule:true},ts.sys).resolvedModule;if(r)edges.push(relative(root,r.resolvedFileName));}};
  const visit=n=>{if(ts.isImportDeclaration(n)&&!n.importClause?.isTypeOnly){const b=n.importClause?.namedBindings;if(!b||!ts.isNamedImports(b)||n.importClause.name||b.elements.some(e=>!e.isTypeOnly))add(n.moduleSpecifier.text);}
   if(ts.isExportDeclaration(n)&&!n.isTypeOnly&&n.moduleSpecifier)add(n.moduleSpecifier.text);
   if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword){assert.ok(ts.isStringLiteral(n.arguments[0]));add(n.arguments[0].text);}ts.forEachChild(n,visit);};visit(ast);nodes.set(relative(root,p),edges);
 }return nodes;
}
function closure(nodes,start){const seen=new Set(),stack=[start];while(stack.length){const p=stack.pop();if(seen.has(p))continue;seen.add(p);stack.push(...nodes.get(p)||[]);}return [...seen];}
test('V21: old Lock public API same function/constants; required/fallback/errors unchanged',async()=>{
 assert.equal(leaf,old);assert.equal(PLANNER_WRITE_LOCK,oldKey);assert.equal(STORAGE_KEY,oldStorage);assert.equal(BACKUP_KEY,oldBackup);assert.equal(PLANNER_WRITE_LOCK,'hosei-planner:v1:write');
 let calls=0;const action=()=>++calls;assert.equal(await old(action,undefined),1);
 await assert.rejects(old(action,undefined,true),/Web Locks/);assert.equal(calls,1);
 const requests=[],locks={request:async(...args)=>{requests.push(args.slice(0,2));return args[2]();}};
 assert.equal(await leaf(async()=>42,locks,true),42);assert.deepEqual(requests,[[PLANNER_WRITE_LOCK,{mode:'exclusive'}]]);
 const error=new Error('identity');await assert.rejects(leaf(()=>{throw error;},locks,true),e=>e===error);
});
test('V21: leaf extraction preserves pre-existing function body byte for byte',()=>{
 const now=readFileSync(resolve(root,'src/planner/backup/storagePrimitives.ts'),'utf8');
 const body=now.slice(now.indexOf('export async function withPlannerWriteLock'),now.indexOf('\n}\n',now.indexOf('export async function withPlannerWriteLock'))+2);
 // Fixed baseline 3f424b5: remains valid after this candidate is committed.
 assert.equal(createHash('sha256').update(body).digest('hex'),'6323bcd8c19559e26b1596208a31a5507532079678a528e3631ce22d2ebe1ced');
});
test('V22: production, old persistence/backup, workbench and Workers cannot reach host; pure cannot reach host',()=>{
 const nodes=graph();for(const [start] of nodes){if(start.startsWith(folder))continue;
  if(start==='src/main.tsx'||start==='src/pages/PlannerPage.tsx'||/\/persistence\/|\/backup\/|\/workbench\/|[Ww]orker|\/gradeImport\//.test(start))assert.deepEqual(closure(nodes,start).filter(p=>p.startsWith(folder)),[],start);
 }
 for(const [start,edges]of nodes)if(start.startsWith(folder)){
  if(start!==folder+'codec.ts')assert.deepEqual(edges.filter(p=>p.startsWith('src/planner/attempts/gradeImport/')||p==='src/planner/attempts/jsonInput.ts'),[],start);
 }
});
test('V22: browser host bundle has no AJV/validation/catalog/old host/Worker and CSP cold import performs no IO',async()=>{
 const b=await build({absWorkingDir:root,entryPoints:[folder+'controller.ts'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm'}),inputs=Object.keys(b.metafile.inputs);
 assert.deepEqual(inputs.filter(p=>/ajv|\/validation\.|\/catalog\/|\/workbench\/|[Ww]orker|\/backup\/storage\.ts|persistence\/(controller|indexedDb|codec|newPlan)\.ts/.test(p)),[]);
 assert.ok(inputs.includes('src/planner/backup/storagePrimitives.ts'));assert.ok(inputs.includes('src/planner/attempts/persistence/sessionIds.ts'));
 const dir=mkdtempSync(resolve(tmpdir(),'g03-csp-'));const p=resolve(dir,'host.mjs');writeFileSync(p,b.outputFiles[0].contents);
 try{const result=execFileSync(process.execPath,['--disallow-code-generation-from-strings','--input-type=module','-e',`
 let reads=0;for(const name of ['indexedDB','navigator','localStorage','sessionStorage','fetch','Worker','BroadcastChannel','WebSocket','location'])Object.defineProperty(globalThis,name,{configurable:true,get(){reads++;throw Error('IO '+name);}});
 crypto.randomUUID=()=>{throw Error('UUID');};Date.now=()=>{throw Error('clock');};const m=await import(${JSON.stringify(pathToFileURL(p).href)});if(typeof m.createGradeImportHost!=='function'||reads!==0)throw Error('boundary');console.log('G03 cold import no IO');
 `],{encoding:'utf8'});assert.equal(result.trim(),'G03 cold import no IO');}finally{rmSync(dir,{recursive:true,force:true});}
});
