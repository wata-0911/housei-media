import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { build } from 'esbuild';
import { baseline, context, archive, course, choose, decide, plan, json, clone } from './adoptionFixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pure = 'src/planner/attempts/gradeImport/';
const parser = 'src/planner/attempts/jsonInput.ts';
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(d => d.isDirectory() ? files(resolve(directory, d.name)) : /\.[cm]?[jt]sx?$/.test(d.name) ? [resolve(directory, d.name)] : []);
}
function graph() {
  const nodes = new Map();
  for (const path of files(resolve(root, 'src'))) {
    const text = readFileSync(path, 'utf8');
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const edges = [];
    function add(specifier) {
      if (!specifier.startsWith('.')) return;
      const resolved = ts.resolveModuleName(specifier, path, { moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true }, ts.sys).resolvedModule;
      if (resolved) edges.push(relative(root, resolved.resolvedFileName));
    }
    function visit(node) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings) || node.importClause.name || bindings.elements.some(e => !e.isTypeOnly)) add(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) add(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.ok(ts.isStringLiteral(node.arguments[0]), 'dynamic runtime imports must be inspectable');
        add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast); nodes.set(relative(root, path), edges);
  }
  return nodes;
}
function closure(nodes, start) {
  const seen = new Set(), stack = [start];
  while (stack.length) { const p = stack.pop(); if (seen.has(p)) continue; seen.add(p); stack.push(...(nodes.get(p) || [])); }
  return seen;
}
test('production entry・PlannerPage・既存保存経路からpure/parserへのimport到達なし', () => {
  const nodes = graph();
  const starts = ['src/main.tsx', 'src/pages/PlannerPage.tsx', ...[...nodes.keys()].filter(p => /\/persistence\/|\/backup\//.test(p))];
  for (const start of starts) {
    assert.ok(nodes.has(start), start);
    assert.deepEqual([...closure(nodes, start)].filter(p => p.startsWith(pure) || p === parser), [], start);
  }
  // This rejects future direct consumers even if they are not reachable from main yet.
  for (const [from, edges] of nodes) if (!from.startsWith(pure)) assert.deepEqual(edges.filter(p => p.startsWith(pure) || p === parser), [], from);
});
test('pureの直接依存は正規parser/DTO/digestとpure内部のみ。writer/authority/Workerへ到達しない', () => {
  const nodes = graph(), allowed = new Set([parser, 'src/planner/gradeImport/gradeImportContract.ts', 'src/planner/digest.ts']);
  for (const [from, edges] of nodes) if (from.startsWith(pure)) {
    assert.ok(edges.every(p => p.startsWith(pure) || allowed.has(p)), from);
    assert.ok(!readFileSync(resolve(root, from), 'utf8').includes('/vendor/'));
    const reachable = [...closure(nodes, from)];
    assert.deepEqual(reachable.filter(p => /\/persistence\/|\/worker\/|indexedDb|authority|controller|ajv|\/validation\.|\/catalog\/|\/backup\//i.test(p)), []);
  }
});
test('browser bundleはdigest leafだけを参照し、backup/validation/AJV/catalog/保存hostを含めない', async () => {
  const result = await build({ absWorkingDir: root, entryPoints: [pure + 'adoption.ts'], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm' });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.includes(parser));
  assert.ok(inputs.includes('src/planner/gradeImport/gradeImportContract.ts'));
  assert.ok(inputs.includes('src/planner/digest.ts'));
  assert.deepEqual(inputs.filter(p => /ajv|\/validation\.|\/catalog\/|\/backup\//i.test(p)), []);
  assert.deepEqual(inputs.filter(p => /\/persistence\/|\/worker\/|indexedDb|authority|\/vendor\//i.test(p)), []);
});
test('コード生成禁止下のcold importと最小replayもI/O・clock・UUID発行を参照しない', async () => {
  // Compile before installing traps: tsx's transform cache itself reads Date.now.
  // The child loads emitted browser ESM without tsx or any source loader.
  const cspContext = await context(await archive([course('CSP過年度', 4, '2024')]), (await baseline()).empty);
  const cspDecision = await decide(cspContext, choose(cspContext, 'new', true));
  const expected = await plan(cspContext, cspDecision);
  const bundled = await build({ absWorkingDir: root,
    stdin: { contents: `export * from './src/planner/attempts/gradeImport/adoption'; export {createLedger,verifyLedgerState} from './src/planner/attempts/gradeImport/ledger'; export {createGradeSourceArchive,decodeGradeSourceArchive} from './src/planner/attempts/gradeImport/sourceArchive'; export {previewImport,verifyImportPreview} from './src/planner/attempts/gradeImport/preview';`, resolveDir: root },
    bundle: true, write: false, platform: 'browser', format: 'esm' });
  const temp = mkdtempSync(resolve(tmpdir(), 'planner-pure-cold-import-'));
  const entry = resolve(temp, 'pure.mjs'); writeFileSync(entry, bundled.outputFiles[0].contents);
  const program = `
    const names=['localStorage','sessionStorage','indexedDB','navigator','fetch','Worker','WebSocket','BroadcastChannel'];
    let reads=0;
    for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,get(){reads++;throw Error('forbidden IO '+name);}});
    Date.now=()=>{throw Error('clock');}; crypto.randomUUID=()=>{throw Error('UUID');};
    const a=await import(${JSON.stringify(pathToFileURL(entry).href)});
    const l=a;
    const s=await l.createLedger();
    await l.verifyLedgerState(JSON.stringify(s));
    const source=await a.createGradeSourceArchive(${JSON.stringify(cspContext.a.raw)});
    await a.decodeGradeSourceArchive(JSON.stringify(source));
    const args=[source,s,{issuedIds:[],reservedIds:[]}].map(JSON.stringify);
    const preview=await a.previewImport(...args);
    await a.verifyImportPreview(JSON.stringify(preview),...args);
    const decision=${JSON.stringify(cspDecision)};
    await a.prepareConfirmation(JSON.stringify(preview),...args,JSON.stringify(decision.selection));
    const adopted=await a.planAdoption(JSON.stringify(preview),...args,JSON.stringify(decision));
    const verified=await a.verifyAdoptionPlan(JSON.stringify(adopted),JSON.stringify(preview),...args,JSON.stringify(decision));
    if(adopted.planSha256!==${JSON.stringify(expected.planSha256)}||JSON.stringify(verified)!==JSON.stringify(adopted))throw Error('CSP full plan mismatch');
    if(reads!==0||typeof a.planAdoption!=='function')throw Error('boundary');
    console.log('cold-import-no-io');`;
  try { assert.equal(execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', program], { cwd: root, encoding: 'utf8' }).trim(), 'cold-import-no-io'); }
  finally { rmSync(temp, { recursive: true, force: true }); }
});
test('確認理由はbare operationから復元できず、判断receiptを保存資格に昇格しない', async () => {
  const c = await context(await archive([course('2024未照合', 4, '2024')]), (await baseline()).empty);
  const d1 = await decide(c, choose(c, 'new', false)), d2 = clone(d1);
  d2.confirmation.rows[0].reason = 'different explicit reason';
  const p1 = await plan(c, d1), p2 = await plan(c, d2);
  assert.deepEqual(p1.operations, p2.operations);
  assert.notEqual(p1.decisionSha256, p2.decisionSha256);
  assert.notEqual(p1.planSha256, p2.planSha256);
  assert.equal(p1.authorization.canCommit, false);
  assert.equal(p1.authorization.saveAuthority, 'not-issued');
  assert.equal(p1.authorization.burn, 'not-performed');
  assert.equal(p1.authorization.idIssuance, 'not-certified');
  assert.equal(p1.authorization.floorAuthenticity, 'not-certified');
  assert.equal(json(c.s), json((await baseline()).empty));
});
