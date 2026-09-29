import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { createDevelopmentManifest, loadPlannerTargets, renderTargetConfig } from '../../../scripts/planner-targets.mjs';

await import('../planner-target-config.js');
await import('../planner-target.js');
await import('../handoff-store.js');
const handoff = globalThis.HoseiPlannerHandoffStore;
const targets = globalThis.HoseiPlannerTarget;
const token = '11111111-1111-4111-8111-111111111111';
const targetConfig = await loadPlannerTargets();
const prodOrigin = targetConfig.prod.origin;
const devOrigin = targetConfig.dev.origin;
const fixedDevOrigin = 'https://dev.hosei-tsukyo-media.com';
const targetScript = readFileSync(new URL('../planner-target.js', import.meta.url), 'utf8');
const handoffScript = readFileSync(new URL('../handoff-store.js', import.meta.url), 'utf8');
const popupScript = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const storage = () => {
  const values = new Map();
  return { values, async set(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); }, async get(key) { return { [key]: values.get(key) }; }, async remove(key) { values.delete(key); } };
};

function runtimeFromGeneratedConfig(keys) {
  const context = { URL };
  context.globalThis = context;
  vm.runInNewContext(renderTargetConfig(targetConfig, keys), context);
  vm.runInNewContext(targetScript, context);
  vm.runInNewContext(handoffScript, context);
  return context;
}

function popupTargetLabels(context) {
  const nodes = new Map();
  const actions = { append: (...buttons) => buttons.forEach(button => nodes.set(button.id, button)) };
  for (const id of ['read', 'result', 'status', 'count', 'courses', 'copy', 'download']) {
    nodes.set(id, { addEventListener() {}, replaceChildren() {} });
  }
  nodes.set('planner-actions', actions);
  context.document = {
    getElementById: id => nodes.get(id),
    createElement: () => ({ addEventListener() {} }),
  };
  context.chrome = {};
  vm.runInNewContext(popupScript, context);
  return [...nodes.entries()]
    .filter(([id, button]) => id.startsWith('planner-') && typeof button.textContent === 'string')
    .map(([, button]) => button.textContent);
}

test('stores a one-time transfer and creates a production URL containing only its token', async () => {
  targets.configure(['prod']);
  const session = storage(); const payload = { courses: [{ rawName: '成績JSONはURLに含めない' }] };
  const stored = await handoff.store(session, { token, importData: payload, now: 1000 });
  assert.equal(stored.ok, true); assert.equal(stored.entry.expiresAt, 1000 + handoff.TTL_MS);
  const url = handoff.plannerUrl(token);
  assert.equal(url, `${prodOrigin}/planner#hosei-import=11111111-1111-4111-8111-111111111111`);
  assert.equal(url.includes(JSON.stringify(payload)), false);
});

test('generated production runtime config enables only production and rejects the dev URL', () => {
  const context = runtimeFromGeneratedConfig(['prod']);
  assert.deepEqual(Array.from(context.HoseiPlannerTarget.enabled(), target => target.key), ['prod']);
  assert.throws(() => context.HoseiPlannerHandoffStore.plannerUrl(token, 'dev'), /Unauthorized Planner target/);
});

test('generated development runtime config enables both targets without manual configuration', () => {
  const context = runtimeFromGeneratedConfig(['prod', 'dev']);
  assert.equal(devOrigin, fixedDevOrigin);
  assert.deepEqual(Array.from(context.HoseiPlannerTarget.enabled(), target => target.key), ['prod', 'dev']);
  assert.deepEqual(popupTargetLabels(context), ['Plannerで確認', 'Planner(dev)で確認']);
  assert.equal(
    context.HoseiPlannerHandoffStore.plannerUrl(token, 'dev'),
    `${fixedDevOrigin}/planner#hosei-import=11111111-1111-4111-8111-111111111111`,
  );
});

test('returns a live payload only to the exact planner route and deletes it before a second read', async () => {
  targets.configure(['prod']);
  const session = storage(); await handoff.store(session, { token, importData: { schemaVersion: 1 }, now: 1000 });
  const first = await handoff.read(session, { token, senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1001 });
  assert.deepEqual(first, { ok: true, importData: { schemaVersion: 1 } }); assert.equal(session.values.has(handoff.keyFor(token)), false);
  assert.deepEqual(await handoff.read(session, { token, senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1002 }), { ok: false, reason: 'not_found' });
});

test('authorizes the exact planner pathname, including fragments, but rejects other routes and origins', async () => {
  targets.configure(['prod']);
  const cases = [
    [`${prodOrigin}/planner`, true],
    [`${prodOrigin}/planner?source=extension`, true],
    [`${prodOrigin}/other`, false],
    [`${prodOrigin}/planner/test`, false],
    [`${prodOrigin}/planner#hosei-import=example`, true],
    ['https://evil.example/planner', false],
  ];
  for (const [senderUrl, allowed] of cases) {
    const session = storage(); await handoff.store(session, { token, importData: { schemaVersion: 1 }, now: 1000 });
    const result = await handoff.read(session, { token, senderUrl, now: 1001 });
    if (allowed) assert.deepEqual(result, { ok: true, importData: { schemaVersion: 1 } });
    else assert.deepEqual(result, { ok: false, reason: 'unauthorized_origin' });
  }
});

test('dev configuration authorizes both exact Planner routes but rejects other paths and origins', async () => {
  globalThis.HoseiPlannerTargetDefinitions = Object.freeze(targetConfig);
  targets.configure(['prod', 'dev']);
  for (const [senderUrl, allowed] of [
    [`${prodOrigin}/planner`, true], [`${devOrigin}/planner`, true],
    [`${devOrigin}/other`, false], [`${devOrigin}/planner/test`, false], ['https://evil.example/planner', false],
  ]) {
    const session = storage(); await handoff.store(session, { token, importData: { schemaVersion: 1 }, now: 1000 });
    const result = await handoff.read(session, { token, senderUrl, now: 1001 });
    assert.equal(result.ok, allowed, senderUrl);
    if (!allowed) assert.equal(result.reason, 'unauthorized_origin');
  }
  targets.configure(['prod']);
});

test('rejects expired, mismatched, and unauthorized handoff reads without leaking data', async () => {
  targets.configure(['prod']);
  const session = storage(); await handoff.store(session, { token, importData: { secret: 'grade' }, now: 1000 });
  assert.deepEqual(await handoff.read(session, { token, senderUrl: 'https://evil.example/planner', now: 1001 }), { ok: false, reason: 'unauthorized_origin' });
  assert.equal(session.values.has(handoff.keyFor(token)), true);
  assert.deepEqual(await handoff.read(session, { token: '22222222-2222-4222-8222-222222222222', senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1001 }), { ok: false, reason: 'not_found' });
  assert.deepEqual(await handoff.read(session, { token, senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1000 + handoff.TTL_MS }), { ok: false, reason: 'expired' });
  assert.equal(session.values.has(handoff.keyFor(token)), false);
});

test('production manifest keeps only the audited production origin and never requests broad or credential permissions', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, [`${prodOrigin}/*`]);
  assert.equal(JSON.stringify(manifest).includes(devOrigin), false);
  assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false);
  for (const permission of ['cookies', 'history', 'webRequest', 'tabs']) assert.equal(manifest.permissions.includes(permission), false);
});

test('development manifest is generated from the target config with the same narrow permissions', () => {
  const productionManifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const manifest = createDevelopmentManifest(productionManifest, targetConfig);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, [`${prodOrigin}/*`, `${devOrigin}/*`]);
  assert.deepEqual(manifest.content_scripts[0].matches, [`${prodOrigin}/*`, `${devOrigin}/*`]);
  assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false);
  for (const permission of ['cookies', 'history', 'webRequest', 'tabs']) assert.equal(manifest.permissions.includes(permission), false);
});

test('a changed dev origin is reflected together in the generated manifest and runtime target config', () => {
  const fixtureOrigin = 'https://fixture-planner.example';
  const fixtureTargets = structuredClone(targetConfig);
  fixtureTargets.dev.origin = fixtureOrigin;
  const productionManifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const manifest = createDevelopmentManifest(productionManifest, fixtureTargets);
  const runtimeConfig = renderTargetConfig(fixtureTargets, ['prod', 'dev']);
  assert.deepEqual(manifest.host_permissions, [`${prodOrigin}/*`, `${fixtureOrigin}/*`]);
  assert.deepEqual(manifest.content_scripts[0].matches, [`${prodOrigin}/*`, `${fixtureOrigin}/*`]);
  assert.match(runtimeConfig, new RegExp(fixtureOrigin));
  assert.doesNotMatch(runtimeConfig, new RegExp(devOrigin));
  assert.match(runtimeConfig, /HoseiPlannerEnabledTargetKeys = Object\.freeze\(\["prod","dev"\]\)/);
});

test('popup retains copy and download fallbacks beside the direct handoff action', () => {
  const popup = readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
  const target = targetScript;
  assert.match(popup, /id="planner-actions"/); assert.match(popup, /id="copy"/); assert.match(popup, /id="download"/);
  assert.match(target, /HoseiPlannerTargetDefinitions/); assert.match(script, /planner-\$\{key\}/);
  assert.match(script, /navigator\.clipboard\.writeText/); assert.match(script, /hosei-grade-import-v1\.json/);
});
