import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { legacyReservationAnalysis, previewLegacyRule2Migration, compareLegacyMigration } from '../src/planner/attempts/persistence/legacyPreview.ts';
import { decodeStateJson, assertCoverageContinuation } from '../src/planner/attempts/persistence/contractDecoders.ts';
import { replayState, replayStateRule2, encodeState } from '../src/planner/attempts/persistence/codec.ts';
import { encodeNewPlan } from '../src/planner/attempts/persistence/newPlan.ts';
import { applyCommand, createWorkspace } from '../src/planner/attempts/workbench/operations.ts';
import { emptyNewPlanWorkspace } from '../src/planner/attempts/persistence/newPlan.ts';
import { createAttemptPersistence } from '../src/planner/attempts/persistence/controller.ts';

// Frozen parent bytes are read only. Variants use old rule1 encoders, never
// regenerate the golden fixture or adjust it to the implementation under test.
const golden = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/persistence-rule1-parent.json.gz', import.meta.url))));
async function variant(f, change) {
  const old = await replayState(JSON.parse(f.stateRaw));
  const commands = structuredClone(old.state.history.commands); change(commands);
  let w = old.state.schemaVersion === 23 ? createWorkspace(old.base.graph, old.source.context) : emptyNewPlanWorkspace(old.source);
  for (const c of commands) w = applyCommand(w, c, old.source.context);
  const state = old.state.schemaVersion === 23 ? await encodeState(old.source, old.state.assignments, old.base, w, old.environment.target, old.state.corrections) : await encodeNewPlan(old.source, w);
  return JSON.stringify(state);
}
for (const f of golden.fixtures) {
  const schema = JSON.parse(f.stateRaw).schemaVersion;
  test(`${schema}: old all-value compatibility and explicit two-field preview`, async () => {
    const raw = ` \n${f.stateRaw}\n`, original = JSON.parse(raw);
    const result = await previewLegacyRule2Migration(raw);
    assert.equal(result.status, 'preview');
    assert.equal(result.analysis.raw, raw); assert.deepEqual(result.analysis.original, original);
    assert.equal(result.analysis.originalDigest, f.digest);
    assert.equal(result.analysis.legacyIntegrity, 'rule1-validated');
    assert.deepEqual((await replayState(original)).workspace, f.workspace);
    assert.equal(result.comparison.allOtherValuesEqual, true); assert.equal(result.comparison.workspaceEqual, true);
    assert.deepEqual(result.comparison.changes.map(c => c.path), ['/rule/version', '/history/issuedIds']);
    const restored = structuredClone(result.candidate); restored.rule.version = 1; restored.history.issuedIds = original.history.issuedIds;
    assert.deepEqual(restored, original);
    const next = await replayStateRule2(result.candidate);
    assert.deepEqual(next.workspace, f.workspace); assert.deepEqual(next.requiredReservations, result.analysis.r2);
    assert.deepEqual(next.state.history.issuedIds, result.analysis.h2);
    assert.ok(result.analysis.missingFromLegacyReservations.includes('c3000000-0000-4000-8000-000000000005'));
    assert.equal(result.reservationCoverage.kind, 'legacy-unproven');
    assert.equal(result.reservationCoverage.baselineStateSha256, f.digest);
    assert.equal(result.saveAuthority, 'not-issued');
    assert.throws(() => assertCoverageContinuation(result.reservationCoverage, { policyVersion: 2, kind: 'native-v2', baselineStateSha256: null }), /implicit_promotion/);
    assert.deepEqual((await decodeStateJson(raw)).value, original);
    await assert.rejects(replayState(result.candidate), /unsupported/);
  });
  test(`${schema}: every nonpermitted field mutation is rejected`, async () => {
    const preview = await previewLegacyRule2Migration(f.stateRaw), original = JSON.parse(f.stateRaw);
    for (const key of Object.keys(original)) {
      if (key === 'rule' || key === 'history') continue;
      const c = structuredClone(preview.candidate); c[key] = null;
      await assert.rejects(compareLegacyMigration(original, c), /preservation_mismatch/);
    }
    for (const change of [c => c.rule.id = 'other', c => c.history.commands.reverse(), c => c.history.usedTodoIds.push('extra'), c => c.extra = true]) {
      const c = structuredClone(preview.candidate); change(c);
      await assert.rejects(compareLegacyMigration(original, c), /preservation_mismatch/);
    }
  });
  test(`${schema}: legal old nonUUID introduction held, preserved, never minted`, async () => {
    const raw = await variant(f, cs => cs[2].payload.assessments[0].id = 'legacy-assessment');
    const result = await previewLegacyRule2Migration(raw);
    assert.equal(result.status, 'held'); assert.equal('candidate' in result, false);
    assert.equal(result.analysis.legacyIntegrity, 'rule1-validated'); assert.equal(result.analysis.raw, raw);
    assert.equal(result.analysis.prohibitedIntroductions[0].canonicalId, 'legacy-assessment');
    assert.ok(result.analysis.legalLegacyNonUuid.some(o => o.canonicalId === 'legacy-assessment'));
    assert.equal(result.analysis.blockers[0].kind, 'prohibited-rule2-introduction');
    assert.equal(result.analysis.h2, null); assert.equal(result.analysis.r2, null);
  });
  test(`${schema}: namespace collision held without rename/delete`, async () => {
    const raw = await variant(f, cs => cs[2].payload.assessments[0].id = cs[0].operationId.split(':').at(-1));
    const result = await previewLegacyRule2Migration(raw);
    assert.equal(result.status, 'held'); assert.equal('candidate' in result, false);
    assert.equal(result.analysis.blockers[0].kind, 'uuid-namespace-collision');
    assert.equal(result.analysis.raw, raw); assert.deepEqual(result.analysis.original, JSON.parse(raw));
    assert.ok(result.analysis.recoverableRestrictions.length);
  });
  test(`${schema}: missing history is never repaired or certified complete`, async () => {
    const original = JSON.parse(f.stateRaw), broken = structuredClone(original); broken.history.commands.pop();
    await assert.rejects(legacyReservationAnalysis(JSON.stringify(broken)), /replay_mismatch/);
    const valid = await previewLegacyRule2Migration(f.stateRaw);
    assert.deepEqual(valid.analysis.missingEvidence, ['legacy-host-history-completeness-unproven']);
    assert.equal(valid.reservationCoverage.kind, 'legacy-unproven');
    // A valid earlier snapshot cannot reveal a lost later payload from its SHA.
    const earlier = await variant(f, cs => cs.pop());
    const a = await previewLegacyRule2Migration(earlier);
    assert.equal(a.status, 'preview');
    assert.equal(a.analysis.r2.includes('c3000000-0000-4000-8000-000000000005'), false);
  });
}
test('preview, repeated analysis and cancellation touch no persistence, lock, RPC or UUID allocator; no controller qualification', async () => {
  const keys = ['indexedDB', 'localStorage', 'sessionStorage', 'navigator', 'Worker', 'SharedWorker', 'fetch', 'XMLHttpRequest', 'crypto'];
  const descriptors = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  // Keep digest available; UUID minting is forbidden.
  const crypto = globalThis.crypto; let accesses = 0;
  for (const k of keys) Object.defineProperty(globalThis, k, { configurable: true, get() {
    if (k === 'crypto') return { subtle: crypto.subtle, randomUUID() { accesses++; throw Error('mint'); } };
    accesses++; throw Error('side_effect');
  } });
  try {
    const controller = createAttemptPersistence({ read: async () => { accesses++; throw Error('read'); }, commit: async () => { accesses++; throw Error('write'); } }, undefined);
    for (const f of golden.fixtures) {
      const result = await previewLegacyRule2Migration(f.stateRaw);
      assert.throws(() => controller.assertPreview(result), /unknown_persistence_preview/);
      await assert.rejects(controller.commit(result, true, null, ''), /explicit_confirmation_required/);
      assert.throws(() => controller.assertPreview(result.candidate), /unknown_persistence_preview/);
      // Cancellation consists only of discarding this ordinary frozen data.
      await legacyReservationAnalysis(f.stateRaw);
    }
    assert.equal(accesses, 0);
  } finally { for (const [k, d] of descriptors) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } }
});
for (const f of golden.fixtures) {
  test(`${JSON.parse(f.stateRaw).schemaVersion}: wrong namespace nested introduction is prohibited`, async () => {
    const raw = await variant(f, cs => cs[2].payload.assessments[0].id = 'hosei:owned:c3000000-0000-4000-8000-000000000005');
    const result = await previewLegacyRule2Migration(raw);
    assert.equal(result.status, 'held');
    assert.equal(result.analysis.blockers[0].kind, 'prohibited-rule2-introduction');
    assert.equal(result.analysis.prohibitedIntroductions.length, 1);
  });
}
test('production entry bundles do not import explicit migration module', async () => {
  const { build } = await import('esbuild');
  for (const entry of ['src/main.tsx', 'src/planner/attempts/persistence/controller.ts', 'src/planner/attempts/persistence/worker/preview.worker.ts']) {
    const out = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser',
      loader: { '.svg': 'text', '.png': 'dataurl', '.woff2': 'dataurl' }, external: ['*.css'], logLevel: 'silent' });
    assert.ok(!Object.keys(out.metafile.inputs).some(p => /legacyPreview/.test(p)), entry);
  }
});
