import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { parseAttemptGraphJson } from '../src/planner/attempts/jsonInput.ts';
import * as validation from '../src/planner/attempts/validation.ts';
import * as operations from '../src/planner/attempts/workbench/operations.ts';
import { attemptFixture, deletedFixture, operationId } from './fixtures/attempt-fixture.mjs';
import { requireDecoded } from '../src/planner/attempts/migration/source.ts';
import { prepareMigrationIds } from '../src/planner/attempts/migration/assignments.ts';
import { createAttemptPersistence } from '../src/planner/attempts/persistence/controller.ts';

const snapshot = (...args) => validation.snapshotAttemptGraphJson(...args);
const workspace = (...args) => operations.createWorkspaceJson(...args);
const { graph: base, context } = attemptFixture();
const empty = '{"attempts":[],"ownedRecords":[],"removals":[]}';
function rejected(raw, code) {
  const result = snapshot(raw, context);
  assert.equal(result.valid, false);
  assert.equal(Object.hasOwn(result, 'graph'), false);
  assert.deepEqual(result.issues.map(i => [i.code, i.path]), [[code, '']]);
  return result.issues[0];
}
function detached(a, b) {
  const nodes = new Set();
  const collect = v => { if (v && typeof v === 'object') { nodes.add(v); Object.values(v).forEach(collect); } };
  collect(a);
  const visit = v => { if (v && typeof v === 'object') { assert.ok(!nodes.has(v)); assert.ok(Object.isFrozen(v)); Object.values(v).forEach(visit); } };
  visit(b);
}

test('JSON runtime type boundary never coerces or inspects non-string inputs', () => {
  let calls = 0;
  const touched = () => { calls++; throw new Error('must not run'); };
  const object = { toString: touched, valueOf: touched, toJSON: touched, [Symbol.iterator]: touched };
  Object.defineProperty(object, 'x', { get: touched });
  const proxy = new Proxy(object, { get: touched, ownKeys: touched, getPrototypeOf: touched, getOwnPropertyDescriptor: touched });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [undefined, null, false, 0, 1n, Symbol('raw'), object, proxy, revoked.proxy, new String(empty), [], () => empty]) {
    rejected(value, 'json_input_type');
    assert.throws(() => workspace(value, context), /json_input_type/);
  }
  assert.equal(calls, 0);
});

test('JSON snapshots preserve values, owners, removals, TODOs, null/zero/omission and array order', () => {
  const cases = [base, deletedFixture(base).deleted];
  for (const value of [undefined, null, 0]) {
    const graph = structuredClone(base);
    if (value === undefined) delete graph.attempts[0].plan.contribution;
    else graph.attempts[0].plan.contribution.value = value;
    graph.attempts[0].originalTitle = '波形 { } [ ] " \\ \n 日本語 😀 e\u0301 é \ud800';
    cases.push(graph);
  }
  for (const graph of cases) {
    const raw = JSON.stringify(graph), first = snapshot(raw, context), second = snapshot(raw, context);
    assert.equal(first.valid, true, JSON.stringify(first.issues));
    assert.deepEqual(first, validation.snapshotAttemptGraph(graph, context));
    assert.deepEqual(first.graph, graph);
    detached(graph, first.graph); detached(first.graph, second.graph);
    const w = workspace(raw, context);
    assert.deepEqual(w, operations.createWorkspace(graph, context));
    detached(first.graph, w.graph);
    assert.ok(Object.isFrozen(w) && Object.isFrozen(w.receipts) && Object.isFrozen(w.usedTodoIds));
    assert.deepEqual(w.usedTodoIds, graph.ownedRecords.filter(r => r.kind === 'todo').map(r => r.payload.id));
  }
});

test('JSON Workspace directly uses its snapshot and continues remove/Undo and TODO history', () => {
  let w = workspace(JSON.stringify(base), context);
  const a = w.graph.attempts[0], removal = { kind: 'remove', attemptId: a.id, operationId: operationId(90001) };
  w = operations.applyCommand(w, removal, context);
  const reset = workspace(JSON.stringify(w.graph), context);
  const undo = { kind: 'undo', attemptId: a.id, removalOperationId: removal.operationId, operationId: operationId(90002) };
  assert.throws(() => operations.applyCommand(reset, undo, context), /undo_history_unproven/);
  w = operations.applyCommand(w, undo, context);
  assert.deepEqual(w.graph, base);
  assert.deepEqual(w.usedTodoIds, reset.usedTodoIds);
});

test('JSON context is checked again; JSON fields cannot supply trusted context', () => {
  const raw = JSON.stringify(base), good = snapshot(raw, context);
  assert.equal(good.valid, true);
  const changed = { ...context, catalog: { ...context.catalog, institutionalCourses: [] } };
  const bad = snapshot(raw, changed);
  assert.equal(bad.valid, false); assert.ok(bad.issues.some(i => i.code === 'unknown_course'));
  assert.deepEqual(bad, validation.snapshotAttemptGraph(base, changed));
  const withTrust = { ...base, context, trusted: true };
  assert.deepEqual(snapshot(JSON.stringify(withTrust), context), validation.snapshotAttemptGraph(withTrust, context));
  const official = structuredClone(base); official.attempts[0].plan.importedSourceCourseId = 'official-aggregate';
  assert.equal(snapshot(JSON.stringify(official), context).valid, true);
  assert.equal(snapshot(JSON.stringify(official), { ...context, officialAchievementIds: [] }).valid, false);
});

test('JSON parse owns __proto__ data without prototype mutation or unknown-field removal', () => {
  const raw = '{"__proto__":{"polluted":true},"attempts":[],"ownedRecords":[],"removals":[]}';
  const result = snapshot(raw, context);
  assert.deepEqual(result, validation.snapshotAttemptGraph(JSON.parse(raw), context));
  assert.equal(result.valid, false); assert.equal({}.polluted, undefined);
});

for (const raw of ['{"a":0,"\\u0061":1}', '{"😀":0,"\\ud83d\\ude00":1}', '{"a":{"z":1,"z":2}}', '{"\\u005f_proto__":0,"__proto__":1}', '{"a":0,"a":1}']) {
  test(`JSON escaped duplicate rejected: ${raw}`, () => rejected(raw, 'duplicate_json_key'));
}
test('JSON duplicate sets are per object; Unicode normalization is not applied', () => {
  const raw = '{"a":{"x":0},"b":{"x":1},"é":2,"e\\u0301":3}';
  assert.deepEqual(snapshot(raw, context), validation.snapshotAttemptGraph(JSON.parse(raw), context));
});

for (const token of ['-0', '-0.0', '-0e0', '-0E+3', '-0e-9999', '-1e-9999', '1e309', '-1e309', '9007199254740992', '9.007199254740992e15', '9007199254740991.9']) {
  test(`JSON unrepresentable number ${token}`, () => rejected(`[${token}]`, 'unrepresentable_json_number'));
}
for (const token of ['0', '0e-9999', '1e-9999', '1.0000000000000001', '0.1234567890123456789', '9007199254740991', '-9007199254740991']) {
  test(`JSON existing Number contract ${token}`, () => {
    const raw = `[${token}]`;
    assert.deepEqual(snapshot(raw, context), validation.snapshotAttemptGraph(JSON.parse(raw), context));
  });
}
for (const raw of ['', ' ', '\ufeff' + empty, '[01]', '[+0]', '[NaN]', '[Infinity]', '[.1]', '[1.]', '[1e]', '[--1]', '[true false]', '[1,]', '{"x":}', '{"x" 0}', '{"x":0,}', '[]{}', '"\\x20"', '"\\u123z"', '"\n"', '"unterminated', '"abc\\', '{', '[']) {
  test(`JSON syntax rejected ${JSON.stringify(raw)}`, () => rejected(raw, 'json_syntax'));
}

function limit(raw, budget, maximum) {
  const issue = rejected(raw, 'resource_limit');
  assert.match(issue.message, new RegExp(budget)); assert.ok(issue.message.includes(String(maximum)));
}
function acceptedScan(raw) {
  parseAttemptGraphJson(raw);
}
test('JSON container depth counts root as zero: 63/64/65', () => {
  for (const depth of [63, 64]) acceptedScan('['.repeat(depth + 1) + '0' + ']'.repeat(depth + 1));
  limit('['.repeat(66) + '0' + ']'.repeat(66), 'depth', 64);
  limit('['.repeat(10000), 'depth', 64);
});
test('JSON raw UTF-8 byte boundary includes whitespace and counts astral/lone-surrogate bytes', () => {
  const max = 32 * 1024 * 1024;
  for (const suffix of ['', '😀', '\ud800', '日']) {
    const prefix = JSON.stringify(suffix), bytes = Buffer.byteLength(prefix);
    for (const delta of [-1, 0]) acceptedScan(prefix + ' '.repeat(max - bytes + delta));
    limit(prefix + ' '.repeat(max - bytes + 1), 'rawBytes', max);
  }
  const lone = '"\ud800"';
  limit(lone + ' '.repeat(max - Buffer.byteLength(lone) + 1), 'rawBytes', max);
});
test('JSON container count includes root: 99999/100000/100001', () => {
  const raw = n => '[' + Array(n - 1).fill('{}').join(',') + ']';
  acceptedScan(raw(99999)); acceptedScan(raw(100000)); limit(raw(100001), 'containers', 100000);
});
test('JSON value count includes root and every child but excludes keys', () => {
  const raw = n => '[' + '0,'.repeat(n - 2) + '0]';
  acceptedScan(raw(999999)); acceptedScan(raw(1000000)); limit(raw(1000001), 'values', 1000000);
});
test('JSON field count is cumulative across objects: 499999/500000/500001', () => {
  const raw = n => '{' + Array.from({ length: n }, (_, i) => `"${i}":0`).join(',') + '}';
  acceptedScan(raw(499999)); acceptedScan(raw(500000)); limit(raw(500001), 'fields', 500000);
  const children = n => Array.from({ length: n }, (_, i) => `"${i}":0`).join(',');
  const first = children(249999);
  acceptedScan('{"a":{' + first + '},"b":{' + first + '}}');
  limit('{"a":{' + first + '},"b":{' + children(250000) + '}}', 'fields', 500000);
});
test('JSON decoded string budget counts key/value UTF-8 after escape decoding', () => {
  const max = 8 * 1024 * 1024;
  for (const n of [max - 1, max]) acceptedScan('"' + 'a'.repeat(n) + '"');
  limit('"' + 'a'.repeat(max + 1) + '"', 'stringBytes', max);
  limit('{"' + 'a'.repeat(max + 1) + '":0}', 'stringBytes', max);
  // Different spellings of the same decoded bytes count identically.
  acceptedScan('"' + '😀'.repeat(max / 4) + '"');
  limit('"' + '\\ud83d\\ude00'.repeat(max / 4) + 'x"', 'stringBytes', max);
  acceptedScan('"' + 'a'.repeat(max - 3) + '\\ud800"');
  limit('"' + 'a'.repeat(max - 2) + '\\ud800"', 'stringBytes', max);
  // Unknown fields are scanned before schema can discard or reject anything.
  limit('{"unknown":"' + 'x'.repeat(max + 1) + '"}', 'stringBytes', max);
});

test('JSON cumulative string budget counts both decoded keys and values (isolated scanner instrumentation)', async () => {
  // In production totalStringBytes is dominated by rawBytes (JSON syntax adds
  // bytes). Raise ONLY rawBytes in an isolated, unregistered parser copy to
  // exercise totalStringBytes -1 / exact / +1; production limits stay fixed.
  const source = readFileSync(new URL('../src/planner/attempts/jsonInput.ts', import.meta.url), 'utf8');
  assert.equal(source.split('rawBytes: 32 * 1024 * 1024').length, 2);
  const instrumented = source.replace('rawBytes: 32 * 1024 * 1024', 'rawBytes: 64 * 1024 * 1024');
  const code = ts.transpile(instrumented, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 });
  const isolated = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const parse = isolated.parseAttemptGraphJson, size = 8 * 1024 * 1024;
  const raw = delta => '["' + 'a'.repeat(size) + '","' + 'b'.repeat(size) + '","' + 'c'.repeat(size) + '","' + 'd'.repeat(size - 1) + '"' + (delta < 0 ? '' : ',"x"') + (delta > 0 ? ',"y"' : '') + ']';
  parse(raw(-1)); parse(raw(0));
  assert.throws(() => parse(raw(1)), e => e.code === 'resource_limit' && e.message.includes('totalStringBytes') && e.message.includes('33554432'));
  const withKey = '{"k":' + raw(0) + '}';
  assert.throws(() => parse(withKey), e => e.code === 'resource_limit' && e.message.includes('totalStringBytes'));
});

test('JSON scanner/native parser agree across deterministic valid values and syntax mutations', () => {
  let seed = 183;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const strings = ['abc', '{[,]}', '"\\\n\b\f\r\t/', '日本😀', '\ud800', '\udc00', '\ud800\ud800\udc00', '__proto__', 'é', 'e\u0301'];
  const generate = depth => {
    const tag = random(depth ? 6 : 4);
    if (tag === 0) return null;
    if (tag === 1) return Boolean(random(2));
    if (tag === 2) return random(100000) / 8;
    if (tag === 3) return strings[random(strings.length)];
    if (tag === 4) return Array.from({ length: random(5) }, () => generate(depth - 1));
    return Object.fromEntries(Array.from({ length: random(5) }, (_, i) => [strings[random(strings.length)] + i, generate(depth - 1)]));
  };
  for (let i = 0; i < 1500; i++) {
    const raw = JSON.stringify(generate(4));
    assert.deepEqual(parseAttemptGraphJson(raw), JSON.parse(raw));
    for (const candidate of [raw.slice(0, -1), raw + ',', raw.replace(/:/, '::')]) {
      let valid = true, native;
      try { native = JSON.parse(candidate); } catch { valid = false; }
      if (valid) assert.deepEqual(parseAttemptGraphJson(candidate), native);
      else assert.throws(() => parseAttemptGraphJson(candidate), e => e.code === 'json_syntax');
    }
  }
});

test('JSON parser output alone is mutable and carries no snapshot certificate', () => {
  const parsed = parseAttemptGraphJson(JSON.stringify(base));
  assert.equal(Object.isFrozen(parsed), false);
  let clones = 0; const native = globalThis.structuredClone;
  try {
    globalThis.structuredClone = (...args) => { clones++; return native(...args); };
    assert.equal(validation.snapshotAttemptGraph(parsed, context).valid, true);
  } finally { globalThis.structuredClone = native; }
  assert.ok(clones > 1);
});

test('JSON scanned UTF-8 matches native values across raw/escaped surrogate pairs', () => {
  for (const contents of ['\ud83d\\ude00', '\\ud83d\ude00', '\ud800', '\udc00', '\\ud800\\ud800\\udc00', '\\b\\f\\n\\r\\t\\/\\\\\\"']) {
    const raw = '"' + contents + '"';
    assert.equal(parseAttemptGraphJson(raw), JSON.parse(raw));
  }
});

test('JSON resource rejection happens before whole-tree native parse and reveals no partial graph', () => {
  const parse = JSON.parse; let calls = 0;
  try {
    JSON.parse = (...args) => { calls++; return parse(...args); };
    limit(' '.repeat(32 * 1024 * 1024 + 1), 'rawBytes', 32 * 1024 * 1024);
    limit('['.repeat(10000), 'depth', 64);
    limit('"' + 'x'.repeat(8 * 1024 * 1024 + 1), 'stringBytes', 8 * 1024 * 1024);
    assert.equal(calls, 0);
  } finally { JSON.parse = parse; }
});

test('JSON Workspace parses once; every node is frozen before trusted context code runs', () => {
  const parse = JSON.parse, raw = JSON.stringify(base);
  let parsed, calls = 0, inspected = false;
  try {
    JSON.parse = (...args) => { calls++; parsed = parse(...args); return parsed; };
    const ctx = new Proxy(context, { get(target, key) {
      inspected = true;
      const frozen = v => { if (v && typeof v === 'object') { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } };
      frozen(parsed); return target[key];
    } });
    const w = workspace(raw, ctx);
    assert.equal(calls, 1); assert.strictEqual(w.graph, parsed); assert.ok(inspected);
  } finally { JSON.parse = parse; }
});

test('JSON representation does not grant decoded source, issuance or persistence handle authority', async () => {
  const good = snapshot(JSON.stringify(base), context); assert.equal(good.valid, true);
  assert.throws(() => requireDecoded(good.graph), /unvalidated_source/);
  assert.throws(() => prepareMigrationIds(good.graph), /unvalidated_source/);
  let reads = 0, writes = 0;
  const api = createAttemptPersistence({ async read() { reads++; throw new Error('unexpected read'); }, async commit() { writes++; } }, undefined);
  const fake = { workspace: workspace(JSON.stringify(base), context), state: {}, source: {} };
  await assert.rejects(api.prepareEdits(fake, []), /unverified_assignment_history/);
  await assert.rejects(api.createBackup(fake), /unverified_assignment_history/);
  assert.equal(reads, 0); assert.equal(writes, 0);
});

test('JSON snapshots reenter the old object API with full public separation; wrappers/clones/realms have no certificate', () => {
  const good = snapshot(JSON.stringify(base), context); assert.equal(good.valid, true);
  const again = validation.snapshotAttemptGraph(good.graph, context); assert.equal(again.valid, true); detached(good.graph, again.graph);
  let calls = 0;
  const native = globalThis.structuredClone;
  try {
    globalThis.structuredClone = value => { calls++; return native(value); };
    assert.equal(validation.snapshotAttemptGraph(new Proxy(good.graph, {}), context).valid, false);
    calls = 0;
    assert.equal(validation.snapshotAttemptGraph(native(good.graph), context).valid, true);
    assert.ok(calls > 1);
    const foreign = vm.runInNewContext('JSON.parse(raw)', { raw: JSON.stringify(base) });
    assert.equal(validation.snapshotAttemptGraph(foreign, context).valid, false);
  } finally { globalThis.structuredClone = native; }
});

test('JSON new entrance avoids receiver probes and native subtree guards, including Workspace', () => {
  const native = globalThis.structuredClone, map = Map.prototype.has, set = Set.prototype.has;
  let clones = 0, probes = 0;
  const count = original => function (...args) { if (Object.getPrototypeOf(this) === Object.prototype) probes++; return Reflect.apply(original, this, args); };
  try {
    globalThis.structuredClone = (...args) => { clones++; return native(...args); };
    Map.prototype.has = count(map); Set.prototype.has = count(set);
    assert.equal(snapshot(JSON.stringify(base), context).valid, true);
    assert.deepEqual(workspace(JSON.stringify(base), context).graph, base);
  } finally { globalThis.structuredClone = native; Map.prototype.has = map; Set.prototype.has = set; }
  assert.equal(clones, 0); assert.equal(probes, 0);
});

test('JSON unexpected parse/freeze/context failures preserve Error/cause identity', () => {
  for (const kind of ['parse', 'freeze', 'context']) for (const ErrorType of [Error, TypeError, RangeError, SyntaxError]) {
    const cause = new Error('original cause'), fault = new ErrorType('internal fault', { cause });
    const parse = JSON.parse, freeze = Object.freeze;
    const ctx = kind === 'context' ? new Proxy(context, { get() { throw fault; } }) : context;
    try {
      // JSON.parse SyntaxError is the sole input-syntax conversion site.
      if (kind === 'parse' && ErrorType === SyntaxError) continue;
      if (kind === 'parse') JSON.parse = () => { throw fault; };
      if (kind === 'freeze') Object.freeze = () => { throw fault; };
      assert.throws(() => snapshot(empty, ctx), e => e === fault && e.cause === cause);
      assert.throws(() => workspace(empty, ctx), e => e === fault && e.cause === cause);
    } finally { JSON.parse = parse; Object.freeze = freeze; }
  }
});
