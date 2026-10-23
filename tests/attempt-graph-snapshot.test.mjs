import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as validation from '../src/planner/attempts/validation.ts';
const { snapshotAttemptGraph, validateAttemptGraph } = validation;
import { adaptAttemptGraduation } from '../src/planner/attempts/graduation/adapter.ts';
import { attemptFixture, deletedFixture } from './fixtures/attempt-fixture.mjs';
import { applyCommand, createWorkspace, newOperationId } from '../src/planner/attempts/workbench/operations.ts';
import { master, decode } from './fixtures/migration-fixture.mjs';
import { initialState, programs, retained, newAttempt } from './fixtures/yi07-graduation.mjs';

const { source } = await decode(initialState());
const scope = programs[0].scopeId;
const fixture = () => {
  const a = newAttempt(master);
  return { a, graph: { attempts: [a], ownedRecords: [], removals: [] } };
};
// Same ownKeys/getter attack as independent PR #181 audit N2. Each entry point
// receives a fresh attack: a previous call must not disarm the next test.
function n2(mode) {
  const x = fixture(), originalGraph = structuredClone(x.graph);
  const key = mode === 'negative-contribution' ? 'actualYear' : 'originalTitle', original = x.a[key];
  let reads = 0, traps = 0;
  x.graph.ownedRecords = new Proxy([], { ownKeys(target) {
    traps++;
    Object.defineProperty(x.a, key, { enumerable: true, configurable: true, get() {
      reads++;
      if (mode === 'getter' || reads === 2) {
        if (mode === 'invalid-id') x.a.id = 'invalid-graph-id';
        if (mode === 'negative-contribution') x.a.plan.contribution.value = -100;
        Object.defineProperty(x.a, key, { value: original, writable: true, enumerable: true, configurable: true });
      }
      return original;
    } });
    x.graph.ownedRecords = target;
    return Reflect.ownKeys(target);
  } });
  return { ...x, originalGraph, counts: () => ({ reads, traps }) };
}
for (const mode of ['getter', 'invalid-id', 'negative-contribution']) {
  test(`N2 validator: ${mode} never invokes a late-installed getter`, () => {
    const x = n2(mode), result = validateAttemptGraph(x.graph, source.context);
    console.log(JSON.stringify({ entry: 'validator', mode, ...x.counts(), valid: result.valid }));
    assert.equal(x.counts().reads, 0);
    assert.equal(result.valid, false);
    assert.ok(x.counts().traps > 0, 'attack must run');
  });
  test(`N2 adapter: ${mode} never invokes a late-installed getter or returns changed data`, () => {
    const x = n2(mode), result = adaptAttemptGraduation({ graph: x.graph, retained: retained(source.state) }, source, scope);
    console.log(JSON.stringify({ entry: 'adapter', mode, ...x.counts(), status: result.status,
      id: result.attempts?.[0].record.id, quantity: result.attempts?.[0].quantities.learnerContribution }));
    assert.equal(x.counts().reads, 0);
    assert.ok(x.counts().traps > 0, 'attack must run');
    assert.equal(result.status, 'rejected');
    assert.equal(Object.hasOwn(result, 'graph'), false);
  });
}

for (const entry of ['validator', 'snapshot', 'adapter']) {
  const invoke = graph => entry === 'validator' ? validateAttemptGraph(graph, source.context)
    : entry === 'snapshot' ? snapshotAttemptGraph(graph, source.context)
      : adaptAttemptGraduation({ graph, retained: retained(source.state) }, source, scope);
  const refused = r => entry === 'adapter' ? r.status === 'rejected' : r.valid === false;
  for (const [label, corrupt] of [
    ['invalid ID', x => { x.a.id = 'invalid-graph-id'; }],
    ['negative contribution', x => { x.a.plan.contribution.value = -100; }],
    ['sparse attempts', x => { x.graph.attempts.length = 2; }],
    ['huge sparse array', x => { x.graph.ownedRecords = Array(0xffffffff); }],
    ['array extra key', x => { x.graph.attempts.extra = true; }],
    ['array non-index key', x => { x.graph.attempts['01'] = x.a; }],
    ['hidden property', x => { Object.defineProperty(x.a, 'hidden', { value: 1 }); }],
    ['symbol key', x => { x.a[Symbol('hidden')] = 1; }],
    ['cycle', x => { x.a.plan.contribution.note = x.graph; }],
    ...[undefined, NaN, Infinity, -Infinity, -0, 1n, Symbol('value'), () => 1].map((v, i) =>
      [`non-JSON leaf ${i}`, x => { x.a.plan.contribution.value = v; }]),
    ...[new Date(), new Map(), new Set(), new Uint8Array(2), /regexp/, Promise.resolve(), new WeakMap(), new WeakSet(), new WeakRef({})].map(v =>
      [`non-JSON object ${v.constructor.name}`, x => { x.a.plan.contribution.note = v; }]),
    ['custom prototype', x => { Object.setPrototypeOf(x.a, { inherited: true }); }],
    ['custom array prototype', x => { Object.setPrototypeOf(x.graph.attempts, Object.create(Array.prototype)); }],
    ['unknown key', x => { x.a.extra = true; }],
    ['own __proto__', x => { Object.defineProperty(x.a, '__proto__', { value: {}, enumerable: true }); }],
    ['dangling owner', x => { x.graph.ownedRecords = [{ id: 'hosei:owned:00000000-0000-4000-8000-000000001111',
      kind: 'todo', owner: { kind: 'attempt', attemptId: 'hosei:attempt:00000000-0000-4000-8000-000000002222' },
      payload: { id: 'todo', text: 'synthetic', done: false } }]; }],
    ['duplicate operation', x => { const b = newAttempt(master); b.creationOperationId = x.a.creationOperationId; x.graph.attempts.push(b); }],
    ['duplicate ID', x => { const b = newAttempt(master); b.id = x.a.id; x.graph.attempts.push(b); }],
    ...['ownKeys', 'getPrototypeOf', 'getOwnPropertyDescriptor'].map(trap =>
      [`throwing ${trap}`, x => { x.graph.attempts = new Proxy(x.graph.attempts, { [trap]() { throw new Error('trap'); } }); }]),
    ['revoked proxy', x => { const p = Proxy.revocable([], {}); p.revoke(); x.graph.ownedRecords = p.proxy; }],
    ['disappearing descriptor', x => { x.graph.attempts = new Proxy(x.graph.attempts, {
      getOwnPropertyDescriptor(target, key) { return key === '0' ? undefined : Reflect.getOwnPropertyDescriptor(target, key); },
    }); }],
  ]) test(`${entry} rejects ${label}`, () => {
    const x = fixture(); corrupt(x);
    const r = invoke(x.graph); assert.ok(refused(r), JSON.stringify(r));
    if (entry === 'snapshot') assert.equal(Object.hasOwn(r, 'graph'), false, 'invalid snapshots are not exposed');
  });
  for (const target of ['root', 'attempt', 'array', 'nested']) for (const kind of ['get', 'set', 'both']) {
    test(`${entry} rejects ${target} ${kind} accessor without executing it`, () => {
      const x = fixture(); let reads = 0, writes = 0;
      const [object, key] = target === 'root' ? [x.graph, 'attempts'] : target === 'attempt' ? [x.a, 'originalTitle']
        : target === 'array' ? [x.graph.attempts, '0'] : [x.a.plan.contribution, 'value'];
      Object.defineProperty(object, key, { enumerable: true, configurable: true,
        ...(kind !== 'set' ? { get() { reads++; return 2; } } : {}),
        ...(kind !== 'get' ? { set() { writes++; } } : {}) });
      assert.ok(refused(invoke(x.graph))); assert.equal(reads, 0); assert.equal(writes, 0);
    });
  }
  for (const mutation of ['id', 'contribution', 'owner']) test(`${entry} validates mutation captured before visiting the affected record: ${mutation}`, () => {
    const x = fixture();
    x.graph.attempts = new Proxy(x.graph.attempts, { ownKeys(target) {
      if (mutation === 'id') x.a.id = 'invalid-graph-id';
      if (mutation === 'contribution') x.a.plan.contribution.value = -100;
      if (mutation === 'owner') x.a.method = { value: 'schooling', source: 'official_detail',
        evidence: { kind: 'official_detail', studyRecordId: 'missing' } };
      return Reflect.ownKeys(target);
    } });
    assert.ok(refused(invoke(x.graph)));
  });
}

for (const mode of ['getter', 'invalid-id', 'negative-contribution']) test(`N2 snapshot API rejects ${mode} without exposing a partial graph`, () => {
  const x = n2(mode), r = snapshotAttemptGraph(x.graph, source.context);
  assert.equal(r.valid, false); assert.equal(x.counts().reads, 0);
  assert.equal(Object.hasOwn(r, 'graph'), false);
});
for (const point of ['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf']) {
  test(`later ${point} trap cannot alter captured ID, quantity or nested references`, () => {
    const x = fixture(); let traps = 0;
    const mutate = () => { traps++; x.a.id = 'invalid-graph-id'; x.a.plan.contribution.value = -100;
      x.a.identity.candidateAuditIds.push('missing'); };
    x.graph.ownedRecords = new Proxy([], { [point](...args) { mutate(); return Reflect[point](...args); } });
    const result = adaptAttemptGraduation({ graph: x.graph, retained: retained(source.state) }, source, scope);
    assert.ok(traps > 0); assert.equal(result.status, 'rejected');
    assert.equal(Object.hasOwn(result, 'graph'), false);
    assert.equal(x.a.id, 'invalid-graph-id', 'trap side effects on original are not prevented');
    assert.equal(Object.isFrozen(x.a.plan), false);
  });
}
test('Proxy rejection does not use get, set, has, toJSON or array iterator', () => {
  const x = fixture(); let gets = 0, sets = 0, has = 0;
  const traps = { get() { gets++; throw new Error('get'); }, set() { sets++; throw new Error('set'); },
    has() { has++; throw new Error('has'); } };
  x.graph.attempts[0] = new Proxy(x.a, traps);
  x.graph.attempts = new Proxy(x.graph.attempts, traps);
  const r = snapshotAttemptGraph(new Proxy(x.graph, traps), source.context);
  assert.equal(r.valid, false); assert.equal(Object.hasOwn(r, 'graph'), false);
  assert.deepEqual([gets, sets, has], [0, 0, 0]);
});
for (const contribution of ['omitted', null, 0, 2, 4]) test(`snapshot and adapter preserve ${contribution}, unknowns and input mutability`, () => {
  const x = fixture();
  if (contribution === 'omitted') delete x.a.plan.contribution;
  else x.a.plan.contribution.value = contribution;
  const expected = structuredClone(x.graph);
  Object.setPrototypeOf(x.a, null);
  const r = snapshotAttemptGraph(x.graph, source.context);
  assert.equal(r.valid, true); assert.deepEqual(r.graph, expected);
  const adapted = adaptAttemptGraduation({ graph: x.graph, retained: retained(source.state) }, source, scope);
  assert.equal(adapted.status, 'adapted'); assert.deepEqual(adapted.graph, expected);
  assert.equal(adapted.graduationCheckComplete, false); assert.equal(adapted.sourceLinksReverified, false);
  x.a.originalTitle = 'changed after return';
  assert.deepEqual(r.graph, expected); assert.deepEqual(adapted.graph, expected);
  assert.throws(() => { r.graph.attempts[0].originalTitle = 'cannot mutate snapshot'; }, TypeError);
});
test('all owner payloads, references, deletion tickets, receipts and reverse Undo survive capture', () => {
  const { graph, context } = attemptFixture();
  const { deleted } = deletedFixture(graph);
  const snapshot = snapshotAttemptGraph(deleted, context);
  assert.equal(snapshot.valid, true); assert.deepEqual(snapshot.graph, deleted);
  assert.equal(Object.isFrozen(deleted.attempts[0]), false);
  let w = createWorkspace(graph, context);
  const commands = graph.attempts.map(a => ({ kind: 'remove', attemptId: a.id, operationId: newOperationId() }));
  for (const command of commands) w = applyCommand(w, command, context);
  const expected = structuredClone(w);
  w = { ...w, graph: snapshotAttemptGraph(w.graph, context).graph };
  assert.deepEqual(w, expected);
  for (const command of [...commands].reverse()) w = applyCommand(w,
    { kind: 'undo', attemptId: command.attemptId, removalOperationId: command.operationId, operationId: newOperationId() }, context);
  assert.deepEqual(w.graph, graph); assert.deepEqual(w.receipts.slice(0, commands.length), commands);
});

for (const entry of ['validator', 'snapshot', 'adapter']) for (const brand of ['Date', 'Map', 'Set', 'RegExp', 'WeakRef', 'Proxy']) {
  test(`${entry} preserves R2 rejection of disguised ${brand} without internal-entry getter calls`, () => {
    let reads = 0;
    const hidden = { get secret() { reads++; return 'must not serialize'; } };
    const objects = { Date: new Date(0), Map: new Map([[hidden, hidden]]), Set: new Set([hidden]),
      RegExp: /graph/, WeakRef: new WeakRef(hidden), Proxy: new Proxy({ attempts: [], ownedRecords: [], removals: [] }, {}) };
    const value = objects[brand];
    Object.setPrototypeOf(value, Object.prototype); Object.assign(value, { attempts: [], ownedRecords: [], removals: [] });
    const r = entry === 'validator' ? validateAttemptGraph(value, source.context)
      : entry === 'snapshot' ? snapshotAttemptGraph(value, source.context)
        : adaptAttemptGraduation({ graph: value, retained: retained(source.state) }, source, scope);
    assert.equal(entry === 'adapter' ? r.status === 'rejected' : r.valid === false, true);
    assert.equal(reads, 0); assert.equal(Object.hasOwn(r, 'graph'), false);
  });
}

test('P3 collects independent non-JSON paths without exposing partial snapshot', () => {
  const f = attemptFixture();
  f.graph.attempts[0].plan.contribution.value = undefined;
  f.graph.attempts[1].plan.contribution.value = NaN;
  for (const invoke of [validateAttemptGraph, snapshotAttemptGraph]) {
    const r = invoke(f.graph, f.context);
    assert.equal(r.valid, false);
    assert.deepEqual(r.issues.map(({ code, path }) => ({ code, path })), [
      { code: 'non_json_value', path: '/attempts/0/plan/contribution/value' },
      { code: 'non_json_value', path: '/attempts/1/plan/contribution/value' },
    ]);
    assert.equal(Object.hasOwn(r, 'graph'), false);
  }
});
test('P2 editing certified workspace bounds native clone calls independently of row count', () => {
  const f = attemptFixture();
  for (const n of [10, 100]) {
    const graph = { attempts: Array.from({ length: n }, (_, i) => f.makeAttempt(2000 + i)), ownedRecords: [], removals: [] };
    const w = createWorkspace(graph, f.context), native = globalThis.structuredClone;
    let calls = 0, result;
    try {
      globalThis.structuredClone = (...args) => { calls++; return native(...args); };
      result = applyCommand(w, { kind: 'edit', attemptId: graph.attempts[0].id,
        operationId: newOperationId(), changes: { originalTitle: 'edited' } }, f.context);
    } finally { globalThis.structuredClone = native; }
    assert.ok(calls < 100, `${n} rows: ${calls} clones`);
    assert.equal(result.graph.attempts[0].originalTitle, 'edited');
    assert.equal(w.graph.attempts[0].originalTitle, graph.attempts[0].originalTitle);
  }
});

test('certified snapshots remain detached and are revalidated in each context', () => {
  const f = attemptFixture(), first = snapshotAttemptGraph(f.graph, f.context);
  assert.equal(first.valid, true);
  const second = snapshotAttemptGraph(first.graph, f.context);
  assert.equal(second.valid, true);
  const refs = new Set();
  const visit = (v, fn) => { if (v && typeof v === 'object') { fn(v); Object.values(v).forEach(x => visit(x, fn)); } };
  visit(first.graph, v => refs.add(v));
  visit(second.graph, v => { assert.equal(refs.has(v), false); assert.equal(Object.isFrozen(v), true); });
  const context = { ...f.context, officialStudyRecordIds: [] };
  const changed = structuredClone(first.graph);
  changed.attempts[0].method = { value: 'media', source: 'official_detail', evidence: { kind: 'official_detail', studyRecordId: 'official-detail' } };
  const certified = snapshotAttemptGraph(changed, f.context);
  assert.equal(certified.valid, true);
  assert.equal(snapshotAttemptGraph(certified.graph, context).valid, false);
  let reads = 0;
  const proxy = new Proxy(first.graph, { ownKeys(target) { reads++; return Reflect.ownKeys(target); } });
  assert.equal(snapshotAttemptGraph(proxy, f.context).valid, false);
  assert.ok(reads > 0);
  const forged = structuredClone(first.graph);
  Object.defineProperty(forged.attempts[0], 'originalTitle', { get() { throw new Error('getter'); }, enumerable: true });
  Object.freeze(forged);
  assert.equal(snapshotAttemptGraph(forged, f.context).valid, false);
});
test('multiple diagnostics never resume native cloning after a late getter trap', () => {
  const f = attemptFixture(); let reads = 0;
  f.graph.attempts[0].plan.contribution.value = undefined;
  f.graph.attempts[1].plan.contribution.value = NaN;
  f.graph.ownedRecords = new Proxy([], { ownKeys(target) {
    Object.defineProperty(f.graph.attempts[0], 'originalTitle', { get() { reads++; return 'unsafe'; }, enumerable: true });
    return Reflect.ownKeys(target);
  } });
  const r = snapshotAttemptGraph(f.graph, f.context);
  assert.equal(r.valid, false); assert.equal(reads, 0);
  assert.equal(Object.hasOwn(r, 'graph'), false);
  assert.ok(r.issues.some(i => i.path === '/attempts/1/plan/contribution/value'));
});
test('unexpected native clone implementation errors are not input diagnostics', () => {
  const f = attemptFixture(), native = globalThis.structuredClone;
  const error = new Error('unexpected implementation failure');
  try {
    globalThis.structuredClone = () => { throw error; };
    assert.throws(() => snapshotAttemptGraph(f.graph, f.context), e => e === error);
  } finally { globalThis.structuredClone = native; }
});
