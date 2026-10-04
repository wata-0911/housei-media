import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { harness } from './fixtures/extraction-dom.mjs';
import { boundary, readCandidateResult, finalizeExtraction, isSafeExtractionFailure } from '../../shared/grade-import/extractor.js';

const extension = readFileSync(new URL('../../extension/hosei-planner-import/parser/extractor.js', import.meta.url), 'utf8');
const bookmarklet = decodeURIComponent(JSON.parse(readFileSync(new URL('../../src/generated/gradeImportBookmarklet.json', import.meta.url), 'utf8')).bookmarklet.slice(11));
const secret = 'SECRET_PERSONAL_GRADE_VALUE';
const bomb = `throw new Error('${secret}')`;
const selectedProxy = field => `const originalFilter=Array.prototype.filter; Array.prototype.filter=function(...args){const r=Reflect.apply(originalFilter,this,args); if(this[0]?.courseRowCount!==undefined) return [new Proxy(r[0],{get(target,key){if(key==='${field}'){${bomb}}return Reflect.get(target,key);}})]; return r;};`;
const cases = [
  ['Array.from returns null', 'Array.from=()=>null;', { code:'GI_EXTRACT_TABLE_RESULT', field:'candidates' }],
  ['Array.from returns array-like object', 'Array.from=()=>({length:0});', { code:'GI_EXTRACT_TABLE_RESULT', field:'candidates' }],
  ['candidate array length getter throws', `Array.from=()=>new Proxy([], {get(target,key){if(key==='length'){${bomb}}return Reflect.get(target,key);}});`, { code:'GI_EXTRACT_TABLE_RESULT', field:'candidates.length' }],
  ['candidate array length is invalid', `Array.from=()=>new Proxy([], {get(target,key){return key==='length'?'${secret}':Reflect.get(target,key);}});`, { code:'GI_EXTRACT_TABLE_RESULT', field:'candidates.length' }],
  ['array result check throws', `Array.isArray=()=>{${bomb}};`, { code:'GI_EXTRACT_TABLE_RESULT', field:'candidates' }],
  ['filter returns null selected', `const originalFilter=Array.prototype.filter; Array.prototype.filter=function(...args){return this[0]?.courseRowCount!==undefined?[null]:Reflect.apply(originalFilter,this,args);};`, { code:'GI_EXTRACT_CANDIDATE_RESULT', field:'selected' }],
  ['tie map returns non-array', `const originalMap=Array.prototype.map; Array.prototype.map=function(...args){if(this.length===2 && this[0]?.courseRowCount!==undefined)return {};return Reflect.apply(originalMap,this,args);};`, { code:'GI_EXTRACT_CANDIDATE_RESULT', field:'tieCandidateIndexes' }],
  ['selected.index getter throws', selectedProxy('index'), { code:'GI_EXTRACT_SELECTED_RESULT', field:'selected.index' }],
  ['selected.courseRowCount getter throws', selectedProxy('courseRowCount'), { code:'GI_EXTRACT_SELECTED_RESULT', tableIndex:2, field:'selected.courseRowCount' }],
  ['selected.rows getter throws', selectedProxy('rows'), { code:'GI_EXTRACT_SELECTED_RESULT', tableIndex:2, field:'selected.rows' }],
  ...['index','courseRowCount','rows'].map(field => [
    `selected.${field} has invalid shape`, selectedProxy(field).replace(bomb, `return '${secret}';`),
    {code:'GI_EXTRACT_SELECTED_RESULT', ...(field==='index'?{}:{tableIndex:2}), field:`selected.${field}`},
  ]),
  ['final courses guard throws', `const original=Array.isArray; Array.isArray=function(value){if(value?.[0]?.rawName){${bomb}}return original(value);};`, {code:'GI_EXTRACT_FINAL_COURSES', tableIndex:2, field:'value.courses'}],
  ['diagnostics map returns non-array', `const originalMap=Array.prototype.map; Array.prototype.map=function(...args){if(this[0]?.courseRowCount!==undefined && args[0].length===1 && (''+args[0]).includes('valid24RowCount')) return {};return Reflect.apply(originalMap,this,args);};`, {success:true}],
  ['diagnostics map returns private string array', `const originalMap=Array.prototype.map; Array.prototype.map=function(...args){if(this[0]?.courseRowCount!==undefined && args[0].length===1 && (''+args[0]).includes('valid24RowCount')) return ['${secret}'];return Reflect.apply(originalMap,this,args);};`, {success:true}],
  ['diagnostics map adds private property', `const originalMap=Array.prototype.map; Array.prototype.map=function(...args){const r=Reflect.apply(originalMap,this,args);if(this[0]?.courseRowCount!==undefined && args[0].length===1 && (''+args[0]).includes('valid24RowCount')) r.privateValue='${secret}';return r;};`, {success:true}],
  ['cell filter returns non-array', `const originalFilter=Array.prototype.filter; Array.prototype.filter=function(...args){return this[0]?.classList?null:Reflect.apply(originalFilter,this,args);};`, {code:'GI_EXTRACT_CELL_TEXT', tableIndex:2, rowIndex:0}],
  ['row query Array.from returns wrong shape', `const original=Array.from; Array.from=function(value,...args){return value?.[0]?.physicalCells?null:original(value,...args);};`, {code:'GI_EXTRACT_ROW_CLASSIFY', tableIndex:2}],
];
// Regression: this same hostile setup previously failed with
// GI_EXTRACT_CANDIDATE_RESULT / selected. Both mappings must now succeed.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/extraction-741e780.json', import.meta.url), 'utf8')).outcomes.normal32;
for (const scope of ['all', 'table', 'row']) test(`Array.from ignores mapper argument: ${scope} mapping succeeds with exact baseline`, async () => {
  const script = `const originalFrom=Array.from; Array.from=function(value,...args){
    const ignore='${scope}'==='all' || ('${scope}'==='table' && value?.[0]?.rows) || ('${scope}'==='row' && value?.[0]?.physicalCells);
    return ignore ? originalFrom(value) : originalFrom(value,...args);
  };`;
  const direct=harness(); vm.runInContext(script,direct.context); vm.runInContext(extension,direct.context);
  const outcome=direct.context.HoseiPlannerGradeExtractor.extractCurrentDocument();
  assert.deepEqual(structuredClone(outcome),baseline);
  assert.equal(outcome.value.courses.length,32);
  const h=harness(); vm.runInContext(script,h.context); vm.runInContext(bookmarklet,h.context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.copied.length,1); assert.equal(h.alerts.length,1);
  assert.doesNotMatch(h.alerts[0],/GI_/);
  const payload=JSON.parse(h.copied[0]); assert.ok(Array.isArray(payload.courses));
  assert.deepEqual(payload,baseline.value);
  assert.deepEqual(payload,structuredClone(outcome.value));
  assert.deepEqual(structuredClone(h.logs),[['Hosei grade import diagnostics',baseline.diagnostics]]);
});
test('DOM collection conversions pass exactly one argument to Array.from', async () => {
  for (const source of [extension,bookmarklet]) {
    const h=harness();
    vm.runInContext(`const original=Array.from; Array.from=function(value){if(arguments.length!==1)throw new Error('${secret}');return original(value);};`,h.context);
    vm.runInContext(source,h.context);
    if(source===extension) assert.deepEqual(structuredClone(h.context.HoseiPlannerGradeExtractor.extractCurrentDocument()),baseline);
    else {await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(JSON.parse(h.copied[0]),baseline.value);}
  }
});
for (const [name, script, expected] of cases) test(`result boundary: ${name} (both generated artifacts)`, async () => {
  if (expected.success) {
    const direct=harness();vm.runInContext(script,direct.context);vm.runInContext(extension,direct.context);
    assert.deepEqual(structuredClone(direct.context.HoseiPlannerGradeExtractor.extractCurrentDocument()),baseline);
    const h=harness();vm.runInContext(script,h.context);vm.runInContext(bookmarklet,h.context);await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(JSON.parse(h.copied[0]),baseline.value);
    assert.deepEqual(structuredClone(h.logs),[['Hosei grade import diagnostics',baseline.diagnostics]]);
    assert.doesNotMatch(h.alerts[0],/GI_/);
    return;
  }
  const direct=harness(); vm.runInContext(script,direct.context); vm.runInContext(extension,direct.context);
  let failure;
  try { direct.context.HoseiPlannerGradeExtractor.extractCurrentDocument(); } catch(error) { failure=error; }
  assert.deepEqual({...failure},expected); assert.equal(Object.getPrototypeOf(failure),null);
  assert.deepEqual(Object.keys(direct.context.HoseiPlannerGradeExtractor).sort(),['date','extractCurrentDocument','extractRows','report']);
  const h=harness(); vm.runInContext(script,h.context); vm.runInContext(bookmarklet,h.context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.alerts.length,1); assert.ok(h.alerts[0].startsWith(`[${expected.code}]`));
  if(expected.field) assert.ok(h.alerts[0].includes(`field: ${expected.field}\n`));
  else assert.doesNotMatch(h.alerts[0],/field:/);
  assert.deepEqual(h.logs,[]); assert.deepEqual(h.copied,[]);
  assert.doesNotMatch(JSON.stringify({failure,alerts:h.alerts,logs:h.logs}),new RegExp(secret));
});

const emptyContext = () => ({__proto__:null});
const capture = action => { try { action(); } catch(error) { return error; } assert.fail('expected safe failure'); };
for(const field of ['selected','tieCandidateIndexes']) test(`candidate result ${field} getter failure retains fixed field`,()=>{
  let reads=0;
  const untrusted=new Proxy({}, {get(){reads++;throw new Error(secret);},getPrototypeOf(){reads++;throw new Error(secret);}});
  const result={selected:{},tieCandidateIndexes:[]}; Object.defineProperty(result,field,{get(){throw untrusted;}});
  const error=capture(()=>boundary('GI_EXTRACT_EXCEPTION',emptyContext(),()=>readCandidateResult(result)));
  assert.deepEqual({...error},{code:'GI_EXTRACT_CANDIDATE_RESULT',field});
  assert.ok(isSafeExtractionFailure(error)); assert.equal(reads,0);
});
for(const value of [null, [], 'SECRET_PERSONAL_GRADE_VALUE']) test(`candidate result rejects ${value===null?'null':Array.isArray(value)?'array':'primitive'} record`,()=>{
  const error=capture(()=>readCandidateResult(value));
  assert.deepEqual({...error},{code:'GI_EXTRACT_CANDIDATE_RESULT',field:'selection'});
});
test('final assembly exception is sanitized, with no throwable property access',()=>{
  let reads=0;
  const raw=new Proxy({}, {get(){reads++;throw new Error(secret);}});
  const error=capture(()=>boundary('GI_EXTRACT_EXCEPTION',emptyContext(),()=>finalizeExtraction(emptyContext(),()=>{throw raw;})));
  assert.deepEqual({...error},{code:'GI_EXTRACT_FINAL_ASSEMBLE',field:'result'}); assert.equal(reads,0);
});
test('final assembly payload getter exception is FINAL_VALUE',()=>{
  const error=capture(()=>finalizeExtraction(emptyContext(),()=>({ok:true,diagnostics:{tableCandidates:[],tieCandidateIndexes:[],selectedCandidateIndex:null},get value(){throw new Error(secret);}})));
  assert.deepEqual({...error},{code:'GI_EXTRACT_FINAL_VALUE',field:'result.value'});
});
for(const code of ['GI_EXTRACT_CELL_TEXT','GI_EXTRACT_ROW_QUERY','GI_EXTRACT_COURSE_PARSE']) test(`nested boundary preserves exact failure identity: ${code}`,()=>{
  let inner;
  const outer=capture(()=>boundary('GI_EXTRACT_EXCEPTION',emptyContext(),()=>{
    inner=capture(()=>boundary(code,emptyContext(),()=>{throw new Error(secret);}));
    throw inner;
  }));
  assert.equal(outer,inner); assert.ok(isSafeExtractionFailure(outer));
  assert.deepEqual({...outer},{code});
});
for(const [code,install] of [
  ['GI_EXTRACT_CELL_TEXT',h=>Object.defineProperty(h.tables[2].rows[1].physicalCells[2],'textContent',{get(){throw new Error(secret);}})],
  ['GI_EXTRACT_ROW_QUERY',h=>{h.tables[2].querySelectorAll=()=>{throw new Error(secret);};}],
  ['GI_EXTRACT_COURSE_PARSE',h=>vm.runInContext(`Set.prototype.has=()=>{${bomb}}`,h.context)],
]) test(`Bookmarklet notification starts with preserved inner code: ${code}`,async()=>{
  const h=harness();install(h);vm.runInContext(bookmarklet,h.context);await new Promise(resolve=>setImmediate(resolve));
  assert.ok(h.alerts[0].startsWith(`[${code}]`)); assert.deepEqual(h.logs,[]); assert.deepEqual(h.copied,[]);
});
test('arbitrary diagnostic field label is not copied or coerced',()=>{
  let reads=0; const field=new Proxy({}, {get(){reads++;throw new Error(secret);}});
  const error=capture(()=>boundary('GI_EXTRACT_FINALIZE',emptyContext(),()=>{throw null;},field));
  assert.deepEqual({...error},{code:'GI_EXTRACT_FINALIZE'}); assert.equal(reads,0);
});
