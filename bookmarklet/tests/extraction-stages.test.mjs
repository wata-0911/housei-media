import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {harness, cells, rows32} from './fixtures/extraction-dom.mjs';
import {isHoseiGradeImportV1} from '../../src/planner/gradeImportContract.ts';

const extension = readFileSync(new URL('../../extension/hosei-planner-import/parser/extractor.js', import.meta.url), 'utf8');
const artifact = JSON.parse(readFileSync(new URL('../../src/generated/gradeImportBookmarklet.json', import.meta.url), 'utf8'));
const bookmarklet = decodeURIComponent(artifact.bookmarklet.slice('javascript:'.length));
const baseline = JSON.parse(readFileSync(new URL('./fixtures/extraction-741e780.json', import.meta.url), 'utf8'));
const secret = 'SECRET_PERSONAL_GRADE_VALUE';
const throwsSecret = () => { throw new Error(secret); };
const patch = (h, script) => vm.runInContext(script, h.context);
const body = `throw new Error('${secret}')`;
const atCell = h => h.tables[2].rows[17].physicalCells[5]; // logical cell 4 (one excluded physical label)
const extensionResult = h => { vm.runInContext(extension, h.context); return h.context.HoseiPlannerGradeExtractor.extractCurrentDocument(); };
const runBookmarklet = async h => { assert.equal(vm.runInContext(bookmarklet, h.context), undefined); await new Promise(resolve => setImmediate(resolve)); };
const codeOnly = code => ({ code });
const cases = [
  ['document selector', h => { h.document.querySelectorAll = throwsSecret; }, codeOnly('GI_EXTRACT_TABLE_QUERY')],
  ['table selector', h => { h.tables[2].querySelectorAll = throwsSecret; }, { code: 'GI_EXTRACT_ROW_QUERY', tableIndex: 2 }],
  ['row selector', h => { h.tables[2].rows[17].querySelectorAll = throwsSecret; }, { code: 'GI_EXTRACT_CELL_QUERY', tableIndex: 2, rowIndex: 17 }],
  ['classList getter', h => { Object.defineProperty(atCell(h), 'classList', { get: throwsSecret }); }, { code: 'GI_EXTRACT_CELL_FILTER', tableIndex: 2, rowIndex: 17, cellIndex: 4 }],
  ['contains method', h => { atCell(h).classList.contains = throwsSecret; }, { code: 'GI_EXTRACT_CELL_FILTER', tableIndex: 2, rowIndex: 17, cellIndex: 4 }],
  ['textContent getter', h => { Object.defineProperty(atCell(h), 'textContent', { get: throwsSecret }); }, { code: 'GI_EXTRACT_CELL_TEXT', tableIndex: 2, rowIndex: 17, cellIndex: 4 }],
  ['String conversion', h => patch(h, `String = function(){ ${body} };`), { code: 'GI_EXTRACT_CELL_TEXT', tableIndex: 2, rowIndex: 0, cellIndex: 0 }],
  ['trim', h => patch(h, `String.prototype.trim = function(){ ${body} };`), { code: 'GI_EXTRACT_CELL_TEXT', tableIndex: 2, rowIndex: 0, cellIndex: 0 }],
  ['replace', h => patch(h, `String.prototype.replace = function(){ ${body} };`), { code: 'GI_EXTRACT_CELL_TEXT', tableIndex: 2, rowIndex: 0, cellIndex: 0 }],
  ['row classification', h => patch(h, `String.prototype.startsWith = function(){ ${body} };`), { code: 'GI_EXTRACT_ROW_CLASSIFY', tableIndex: 2, rowIndex: 0 }],
  ['candidate Math.max', h => patch(h, `Math.max = function(){ ${body} };`), codeOnly('GI_EXTRACT_CANDIDATE_SELECT')],
  ['course Set.has', h => patch(h, `Set.prototype.has = function(){ ${body} };`), { code: 'GI_EXTRACT_COURSE_PARSE', tableIndex: 2, rowIndex: 1 }],
  ['course Date.UTC', h => patch(h, `Date.UTC = function(){ ${body} };`), { code: 'GI_EXTRACT_COURSE_PARSE', tableIndex: 2, rowIndex: 1 }],
  ['capture Date', h => patch(h, `Date = class { constructor(){ ${body} } };`), { code: 'GI_EXTRACT_CAPTURE_TIME', tableIndex: 2 }],
  ['Set initialization', h => patch(h, `Set = class { constructor(){ ${body} } };`), codeOnly('GI_EXTRACT_INITIALIZE')],
  ['Array.from', h => patch(h, `Array.from = function(){ ${body} };`), codeOnly('GI_EXTRACT_TABLE_QUERY')],
  ['Array.filter classification', h => patch(h, `Array.prototype.filter = function(){ ${body} };`), { code: 'GI_EXTRACT_ROW_CLASSIFY', tableIndex: 0 }],
  ['Array.filter cells', h => patch(h, `const originalFilter=Array.prototype.filter; Array.prototype.filter=function(...args){ if(this[0]?.classList){ ${body} } return Reflect.apply(originalFilter,this,args); };`), { code: 'GI_EXTRACT_CELL_FILTER', tableIndex: 2, rowIndex: 0 }],
  ['Array.map cells', h => patch(h, `Array.prototype.map = function(){ ${body} };`), { code: 'GI_EXTRACT_CELL_TEXT', tableIndex: 2, rowIndex: 0 }],
  ['table-list iterator', h => { h.document.querySelectorAll = () => ({ [Symbol.iterator]: throwsSecret }); }, codeOnly('GI_EXTRACT_TABLE_QUERY')],
  ['row-list iterator', h => { h.tables[2].querySelectorAll = () => ({ [Symbol.iterator]: throwsSecret }); }, { code: 'GI_EXTRACT_ROW_QUERY', tableIndex: 2 }],
  ['cell-list iterator', h => { h.tables[2].rows[17].querySelectorAll = () => ({ [Symbol.iterator]: throwsSecret }); }, { code: 'GI_EXTRACT_CELL_QUERY', tableIndex: 2, rowIndex: 17 }],
  ['Array iterator initialization', h => patch(h, `Array.prototype[Symbol.iterator] = function(){ ${body} };`), codeOnly('GI_EXTRACT_INITIALIZE')],
  ['Array iterator selection', h => {
    const query = h.document.querySelectorAll;
    h.document.querySelectorAll = selector => { patch(h, `Array.prototype[Symbol.iterator] = function(){ ${body} };`); return query(selector); };
  }, codeOnly('GI_EXTRACT_CANDIDATE_SELECT')],
  ['diagnostics map', h => patch(h, `const originalMap=Array.prototype.map; Array.prototype.map=function(...args){ if(this[0]?.courseRowCount!==undefined && args[0].length===1 && (''+args[0]).includes('valid24RowCount')) { ${body} } return Reflect.apply(originalMap,this,args); };`), { code: 'GI_EXTRACT_DIAGNOSTICS', tableIndex: 2 }],
  ['inspection result access', h => patch(h, `let rowFilters=0; const originalFilter=Array.prototype.filter; Array.prototype.filter=function(...args){ const result=Reflect.apply(originalFilter,this,args); if(Array.isArray(this[0]) && ++rowFilters===2) return new Proxy(result,{get(target,key){if(key==='length'){ ${body} } return Reflect.get(target,key);}}); return result; };`), { code: 'GI_EXTRACT_TABLE_INSPECT', tableIndex: 2 }],
];

for (const [name, install, expected] of cases) {
  test(`safe extraction boundary: ${name} (extension and Bookmarklet)`, async () => {
    const direct = harness(); install(direct);
    let failure;
    try { extensionResult(direct); assert.fail('expected extraction failure'); } catch (error) { failure = error; }
    assert.deepEqual({ ...failure }, expected);
    assert.equal(Object.getPrototypeOf(failure), null);
    assert.equal(failure.message, undefined); assert.equal(failure.stack, undefined); assert.equal(failure.cause, undefined);
    assert.deepEqual(Object.keys(direct.context.HoseiPlannerGradeExtractor).sort(), ['date', 'extractCurrentDocument', 'extractRows', 'report']);
    const h = harness(); install(h); await runBookmarklet(h);
    assert.equal(h.copied.length, 0); assert.equal(h.alerts.length, 1);
    assert.match(h.alerts[0], new RegExp(`\\[${expected.code}\\]`));
    for (const [key, label] of [['tableIndex','table'], ['rowIndex','row'], ['cellIndex','cell']]) {
      if (expected[key] === undefined) assert.doesNotMatch(h.alerts[0], new RegExp(`${label} index:`));
      else assert.match(h.alerts[0], new RegExp(`${label} index: ${expected[key]}(?:\\n|$)`));
    }
    assert.deepEqual(h.logs, []);
    assert.doesNotMatch(JSON.stringify({ alerts: h.alerts, logs: h.logs, failure }), new RegExp(secret));
  });
}

for (const [name, tables] of [
  ['normal32', undefined], ['noTables', []], ['noCourses', [[cells('***区分'), cells('')]]],
  ['filteredRows', [[cells('***区分'), cells('bad').slice(0,23), cells('論理学',{2:'4',5:'4'}), [...cells('bad'),'extra']]]],
  ['uniqueCandidate', [[cells('small')], rows32()]],
]) test(`generated extension output equals immutable 741e780 baseline: ${name}`, () => {
  assert.equal(baseline.sourceCommit, '741e780b0db2db304024c22e5ad35805dc0bd731');
  assert.deepEqual(structuredClone(extensionResult(harness(tables))), baseline.outcomes[name]);
});

test('generated Bookmarklet contract, order, category and diagnostics equal the 741e780 golden fixture', async () => {
  const h = harness(); await runBookmarklet(h);
  const payload = JSON.parse(h.copied[0]);
  assert.equal(payload.courses.length, 32);
  assert.ok(Array.isArray(payload.courses)); assert.ok(isHoseiGradeImportV1(payload));
  assert.deepEqual(payload, baseline.outcomes.normal32.value);
  assert.deepEqual(structuredClone(h.logs), [['Hosei grade import diagnostics', baseline.outcomes.normal32.diagnostics]]);
  assert.deepEqual(Object.keys(payload).sort(), ['capturedAt', 'courses', 'schemaVersion', 'source']);
});

test('row classification index is the original logical row even after malformed rows are filtered', async () => {
  const h = harness(); h.tables[2].rows[0].physicalCells.pop();
  patch(h, `String.prototype.startsWith = function(){ ${body} };`);
  await runBookmarklet(h); assert.match(h.alerts[0], /row index: 1/);
});

test('course parse reports selected logical row index, not output course index', async () => {
  const h = harness();
  patch(h, `let gradeCalls=0; const original=Set.prototype.has; Set.prototype.has=function(value){if(++gradeCalls===4){ ${body} } return Reflect.apply(original,this,[value]);};`);
  await runBookmarklet(h);
  assert.match(h.alerts[0], /GI_EXTRACT_COURSE_PARSE/); assert.match(h.alerts[0], /row index: 2/);
  assert.doesNotMatch(h.alerts[0], /course index/);
});

test('an arbitrary thrown Proxy is never inspected for a forged safe code or private error properties', async () => {
  let propertyReads = 0;
  const h = harness(); h.document.querySelectorAll = () => { throw new Proxy({}, { get() { propertyReads++; throwsSecret(); }, getPrototypeOf() { propertyReads++; throwsSecret(); } }); };
  await runBookmarklet(h);
  assert.equal(propertyReads, 0); assert.match(h.alerts[0], /GI_EXTRACT_TABLE_QUERY/);
  assert.doesNotMatch(JSON.stringify([h.alerts,h.logs]), new RegExp(secret));
});

test('Object.prototype error/index pollution is never inherited into safe failures', async () => {
  const h = harness(); patch(h, `Object.prototype.message='${secret}'; Object.prototype.stack='${secret}'; Object.prototype.tableIndex='${secret}';`);
  h.document.querySelectorAll = throwsSecret;
  await runBookmarklet(h); assert.match(h.alerts[0], /GI_EXTRACT_TABLE_QUERY/);
  assert.doesNotMatch(h.alerts[0], /table index:|SECRET_PERSONAL/);
});

for (const method of ['some', 'every']) test(`Array.${method} is not used by extractor; output remains exactly the baseline`, () => {
  const h = harness(); patch(h, `Array.prototype.${method}=function(){ ${body} };`);
  assert.deepEqual(structuredClone(extensionResult(h)), baseline.outcomes.normal32);
});
for (const method of ['call', 'apply', 'bind']) test(`Function.prototype.${method} override is not invoked by extractor`, () => {
  const h = harness(); patch(h, `Function.prototype.${method}=function(){ ${body} };`);
  assert.deepEqual(structuredClone(extensionResult(h)), baseline.outcomes.normal32);
});
