import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { decodeAuthorityJson, decodeBackupJson, decodeStateJson, decodeReservationCoverageJson, assertCoverageContinuation } from '../src/planner/attempts/persistence/contractDecoders.ts';
import { replayState, replayStateRule2, encodeStateRule2 } from '../src/planner/attempts/persistence/codec.ts';
import { encodeNewPlanRule2 } from '../src/planner/attempts/persistence/newPlan.ts';
import { backupDigest } from '../src/planner/backup/plannerBackupCompatibility.ts';
import { createAttemptPersistence } from '../src/planner/attempts/persistence/controller.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';

const golden = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/persistence-rule1-parent.json.gz', import.meta.url))));
const native = { policyVersion: 2, kind: 'native-v2', baselineStateSha256: null };
const legacy = { policyVersion: 2, kind: 'legacy-unproven', baselineStateSha256: golden.fixtures[0].digest };
const extra = 'c3000000-0000-4000-8000-000000009999';
const text = value => JSON.stringify(value, null, 2);
const clone = value => structuredClone(value);
const v2Empty = coverage => ({ format: 'hosei-attempt-authority', authorityVersion: 2, ...emptyAuthority(), reservationCoverage: coverage });
async function seal(body) { return { ...body, sha256: await backupDigest(body) }; }
async function reseal(value) { const { sha256, ...body } = value; void sha256; return seal(body); }
const modernCache = new Map();
async function modern(schema) {
  if (!modernCache.has(schema)) modernCache.set(schema, (async () => {
    const f = golden.fixtures.find(f => JSON.parse(f.stateRaw).schemaVersion === schema);
    const old = await replayState(JSON.parse(f.stateRaw));
    const state = schema === 23 ? await encodeStateRule2(old.source, old.state.assignments, old.base, old.workspace, old.environment.target, old.state.corrections)
      : await encodeNewPlanRule2(old.source, old.workspace);
    const replay = await replayStateRule2(state);
    return { state, replay, backup: await seal({ format: 'hosei-attempt-backup', backupVersion: 4, createdAt: '2026-11-01T00:00:00.000Z', state,
      reservedIds: [...replay.requiredReservations, extra], reservationCoverage: native }) };
  })());
  return modernCache.get(schema);
}

test('parent rule1 fixture: raw, canonical digest, every state/Workspace/reservation field unchanged for both schemas', async () => {
  assert.equal(golden.parent, '9c0780b0884a582827fb0c3126a0937ab75770fa');
  for (const f of golden.fixtures) {
    const before = clone(f), original = JSON.parse(f.stateRaw), replay = await replayState(original);
    const decoded = await decodeStateJson(f.stateRaw);
    assert.equal(decoded.raw, f.stateRaw); assert.deepEqual(decoded.value, original);
    assert.deepEqual(replay.state, original); assert.deepEqual(replay.workspace, f.workspace);
    assert.deepEqual(replay.requiredReservations, f.requiredReservations);
    assert.equal(await backupDigest(decoded.value), f.digest); assert.deepEqual(f, before);
    assert.equal(decoded.disposition.kind, 'explicit-migration-required'); assert.equal(decoded.saveAuthority, 'not-issued');
    assert.equal(original.history.issuedIds.includes('c3000000-0000-4000-8000-000000000005'), false);
  }
});

test('authority old/v2 are closed distinct shapes, preserve raw and never promote empty legacy', async () => {
  const raw = ' \n' + text(emptyAuthority()) + '\n';
  const old = await decodeAuthorityJson(raw);
  assert.equal(old.authorityKind, 'legacy'); assert.equal(old.raw, raw); assert.deepEqual(old.value, emptyAuthority());
  assert.equal(old.disposition.kind, 'explicit-migration-required');
  for (const coverage of [native, legacy]) {
    const record = v2Empty(coverage), decoded = await decodeAuthorityJson(text(record));
    assert.equal(decoded.authorityKind, 'v2'); assert.deepEqual(decoded.value, record);
    assert.equal(decoded.disposition.kind, coverage.kind === 'native-v2' ? 'native-v2-unadopted' : 'legacy-unproven');
    assert.equal(decoded.saveAuthority, 'not-issued');
  }
  const bad = [ { ...emptyAuthority(), extra: true }, { ...v2Empty(native), authorityVersion: 3 },
    { ...v2Empty(native), format: 'other' }, { ...v2Empty(native), extra: true },
    { ...emptyAuthority(), reservationCoverage: native }, { ...emptyAuthority(), revision: 1 },
    { ...emptyAuthority(), revision: -1 }, { ...emptyAuthority(), revision: 0.5 },
    { ...emptyAuthority(), issuedIds: [extra, extra] }, { ...v2Empty(native), committed: ['x'] } ];
  for (const value of bad) await assert.rejects(decodeAuthorityJson(text(value)));
  for (const raw of ['{"raw":null,"revision":0,"committed":[],"issuedIds":[],"revis\\u0069on":0}',
    '{"raw":null,"revision":-0,"committed":[],"issuedIds":[]}',
    '{"raw":null,"revision":9007199254740993,"committed":[],"issuedIds":[]}',
    '{"raw":null,"revision":1e400,"committed":[],"issuedIds":[]}']) await assert.rejects(decodeAuthorityJson(raw));
});

test('coverage exact policy/kind/baseline contract; no legacy promotion or baseline laundering', () => {
  for (const valid of [native, legacy]) assert.deepEqual(decodeReservationCoverageJson(text(valid)), valid);
  for (const bad of [null, {}, { ...native, extra: true }, { ...native, policyVersion: 1 }, { ...native, kind: 'native' },
    { ...native, baselineStateSha256: legacy.baselineStateSha256 }, { ...legacy, baselineStateSha256: null },
    ...['', 'A'.repeat(64), 'a'.repeat(63), 0].map(baselineStateSha256 => ({ ...legacy, baselineStateSha256 }))]) {
    assert.throws(() => decodeReservationCoverageJson(text(bad)));
  }
  assert.throws(() => decodeReservationCoverageJson('{"policyVersion":2,"kind":"native-v2","baselineStateSha256":null,"kind":"legacy-unproven"}'), /duplicate_json_key/);
  assert.throws(() => assertCoverageContinuation('legacy-authority', native), /implicit_promotion/);
  assert.throws(() => assertCoverageContinuation(legacy, native), /implicit_promotion/);
  assert.throws(() => assertCoverageContinuation(legacy, { ...legacy, baselineStateSha256: 'a'.repeat(64) }), /implicit_promotion/);
  assert.doesNotThrow(() => assertCoverageContinuation('legacy-authority', legacy));
  assert.doesNotThrow(() => assertCoverageContinuation(legacy, legacy));
  assert.doesNotThrow(() => assertCoverageContinuation(native, legacy));
});

test('schema23/24 rule2 dispatch preserves full state; standalone state has no coverage or save qualification', async () => {
  for (const schema of [23, 24]) {
    const { state } = await modern(schema), raw = text(state), result = await decodeStateJson(raw);
    assert.deepEqual(result.value, state); assert.equal(result.raw, raw);
    assert.equal(result.disposition.kind, 'coverage-unestablished'); assert.equal(result.saveAuthority, 'not-issued');
    await assert.rejects(replayState(state), /unsupported/);
    for (const mutate of [s => s.rule.id = schema === 23 ? 'yi-new-plan:replay' : 'yi-06:replay', s => s.rule.version = 3,
      s => s.rule.extra = true, s => s.schemaVersion = 25, s => s.extra = true]) {
      const bad = clone(state); mutate(bad); await assert.rejects(decodeStateJson(text(bad)));
    }
  }
});

test('backup v4 both schemas: full body, reservations, native and legacy coverage, repeat decode without mutation', async () => {
  for (const schema of [23, 24]) {
    const { backup } = await modern(schema);
    for (const coverage of [native, legacy]) {
      const envelope = await reseal({ ...backup, reservationCoverage: coverage }), raw = text(envelope);
      const a = await decodeBackupJson(raw), b = await decodeBackupJson(raw);
      assert.deepEqual(a, b); assert.deepEqual(a.value, envelope); assert.equal(a.raw, raw);
      assert.equal(a.backupKind, 'v4'); assert.equal(a.hostCheckpoint, 'adoption-required');
      assert.equal(a.saveAuthority, 'not-issued'); assert.equal(a.disposition.kind, coverage.kind === 'native-v2' ? 'native-v2-unadopted' : 'legacy-unproven');
      assert.ok(a.value.reservedIds.includes(extra));
    }
    const missingNested = await reseal({ ...backup, reservedIds: backup.reservedIds.filter(id => id !== 'c3000000-0000-4000-8000-000000000005') });
    await assert.rejects(decodeBackupJson(text(missingNested)), /reservations_missing/);
  }
});

test('backup v4 rejects digest/coverage tamper, recomputed malformed coverage, R2 gaps, canonical aliases and invalid H2', async () => {
  const { backup } = await modern(24);
  for (const mutate of [b => b.sha256 = '0'.repeat(64), b => b.reservationCoverage = legacy,
    b => b.createdAt = '2026-11-02T00:00:00.000Z', b => b.reservedIds.pop(), b => b.state.graph.attempts[0].originalTitle = '改変']) {
    const bad = clone(backup); mutate(bad); await assert.rejects(decodeBackupJson(text(bad)), /backup_digest/);
  }
  for (const mutate of [b => b.reservedIds.shift(), b => b.reservedIds.push(b.reservedIds[0]),
    b => b.reservedIds[0] = b.reservedIds[0].split(':').at(-1),
    b => b.state.history.issuedIds.reverse(), b => b.state.history.issuedIds.pop(),
    b => b.state.history.commands.push(b.state.history.commands[0]), b => b.state.rule.version = 1,
    b => b.reservationCoverage.baselineStateSha256 = 'a'.repeat(64), b => b.backupVersion = 5,
    b => b.createdAt = '2026-11-01', b => b.extra = true]) {
    const bad = clone(backup); mutate(bad); await assert.rejects(decodeBackupJson(text(await reseal(bad))));
  }
  await assert.rejects(decodeBackupJson(text(backup).replace('"backupVersion": 4', '"backupVersion": 4,"backupVersion": 4')), /duplicate_json_key/);
  await assert.rejects(decodeStateJson(text(backup.state).replace('"completed": false', '"completed": false,"completed": false')), /duplicate_json_key/);
  // Rehashing a structurally valid alternate coverage declaration is not issuer
  // authentication: it remains unadopted, never a host save credential.
  const rehashed = await decodeBackupJson(text(await reseal({ ...backup, reservationCoverage: legacy })));
  assert.equal(rehashed.disposition.kind, 'legacy-unproven'); assert.equal(rehashed.saveAuthority, 'not-issued');
});

test('authority contents: old R1 compatibility, v2 rule2 checkpoint and complete R2, strict cross-version refusal', async () => {
  for (const schema of [23, 24]) {
    const f = golden.fixtures.find(f => JSON.parse(f.stateRaw).schemaVersion === schema);
    const old = { raw: f.stateRaw, revision: 1, committed: [f.digest], issuedIds: JSON.parse(f.stateRaw).history.issuedIds };
    assert.deepEqual((await decodeAuthorityJson(text(old))).value, old);
    const { state, replay } = await modern(schema);
    const current = { ...v2Empty(native), raw: text(state), revision: 1, committed: [await backupDigest(state)], issuedIds: replay.requiredReservations };
    assert.deepEqual((await decodeAuthorityJson(text(current))).value, current);
    await assert.rejects(decodeAuthorityJson(text({ ...current, issuedIds: current.issuedIds.slice(1) })), /reservations_missing/);
    await assert.rejects(decodeAuthorityJson(text({ ...current, committed: ['0'.repeat(64)] })), /checkpoint_missing/);
    await assert.rejects(decodeAuthorityJson(text({ ...current, raw: old.raw })), /rule_mismatch/);
    await assert.rejects(decodeAuthorityJson(text({ ...old, raw: current.raw })), /rule_mismatch/);
  }
});

test('backup v1/v2/v3 stay rule1 with old R1 minimum and host/adoption boundary', async () => {
  for (const f of golden.fixtures) {
    const state = JSON.parse(f.stateRaw), versions = state.schemaVersion === 23 ? [1, 2] : [3];
    for (const backupVersion of versions) {
      const body = { format: 'hosei-attempt-backup', backupVersion, createdAt: '2026-11-01T00:00:00.000Z', state,
        ...(backupVersion === 1 ? {} : { reservedIds: f.requiredReservations }) };
      const envelope = await seal(body), raw = text(envelope), decoded = await decodeBackupJson(raw);
      assert.equal(decoded.raw, raw); assert.deepEqual(decoded.value, envelope);
      assert.equal(decoded.disposition.kind, 'explicit-migration-required'); assert.equal(decoded.saveAuthority, 'not-issued');
      assert.equal(decoded.hostCheckpoint, backupVersion === 1 ? 'required' : 'adoption-required');
      if (backupVersion !== 1) await assert.rejects(decodeBackupJson(text(await seal({ ...body, reservedIds: body.reservedIds.slice(1) }))), /reservations_missing/);
      await assert.rejects(decodeBackupJson(text(await seal({ ...body, state: (await modern(state.schemaVersion)).state }))), /version_mismatch/);
    }
  }
});

test('decoder issues no controller capability and touches no persistence; modules remain disconnected', async () => {
  const { backup } = await modern(24);
  const descriptors = new Map(['indexedDB', 'localStorage', 'navigator'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let accesses = 0;
  for (const key of descriptors.keys()) Object.defineProperty(globalThis, key, { configurable: true, get() { accesses++; throw Error('persistence_access'); } });
  try {
    const store = { read: async () => { accesses++; throw Error('store_read'); }, commit: async () => { accesses++; throw Error('store_commit'); } };
    const controller = createAttemptPersistence(store, undefined);
    for (const decoded of [await decodeBackupJson(text(backup)), await decodeStateJson(text(backup.state)), await decodeAuthorityJson(text(v2Empty(native)))]) {
      assert.equal(decoded.saveAuthority, 'not-issued'); assert.equal('handle' in decoded, false); assert.equal('workspace' in decoded, false);
      assert.throws(() => controller.assertPreview(decoded), /unknown_persistence_preview/);
      await assert.rejects(controller.commit(decoded, true, null, ''), /explicit_confirmation_required/);
    }
    assert.equal(accesses, 0);
  } finally {
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
  for (const entry of ['src/main.tsx', 'src/planner/attempts/persistence/controller.ts', 'src/planner/attempts/persistence/worker/preview.worker.ts']) {
    const output = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser',
      loader: { '.svg': 'text', '.png': 'dataurl', '.woff2': 'dataurl' }, external: ['*.css'], logLevel: 'silent' });
    assert.ok(!Object.keys(output.metafile.inputs).some(p => /contractDecoders|versionedContracts/.test(p)), entry);
  }
});
