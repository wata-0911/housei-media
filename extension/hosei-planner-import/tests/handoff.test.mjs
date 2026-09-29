import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

await import('../planner-target.js');
await import('../handoff-store.js');
const handoff = globalThis.HoseiPlannerHandoffStore;
const token = '11111111-1111-4111-8111-111111111111';
const storage = () => {
  const values = new Map();
  return { values, async set(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); }, async get(key) { return { [key]: values.get(key) }; }, async remove(key) { values.delete(key); } };
};

test('stores a one-time transfer and creates a URL containing only its token', async () => {
  const session = storage(); const payload = { courses: [{ rawName: '成績JSONはURLに含めない' }] };
  const stored = await handoff.store(session, { token, importData: payload, now: 1000 });
  assert.equal(stored.ok, true); assert.equal(stored.entry.expiresAt, 1000 + handoff.TTL_MS);
  const url = handoff.plannerUrl(token);
  assert.equal(url, 'https://hosei-tsukyo-media.com/planner#hosei-import=11111111-1111-4111-8111-111111111111');
  assert.equal(url.includes(JSON.stringify(payload)), false);
});

test('returns a live payload only to the exact planner route and deletes it before a second read', async () => {
  const session = storage(); await handoff.store(session, { token, importData: { schemaVersion: 1 }, now: 1000 });
  const first = await handoff.read(session, { token, senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1001 });
  assert.deepEqual(first, { ok: true, importData: { schemaVersion: 1 } }); assert.equal(session.values.has(handoff.keyFor(token)), false);
  assert.deepEqual(await handoff.read(session, { token, senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1002 }), { ok: false, reason: 'not_found' });
});

test('authorizes the exact planner pathname, including fragments, but rejects other routes and origins', async () => {
  const cases = [
    ['https://hosei-tsukyo-media.com/planner', true],
    ['https://hosei-tsukyo-media.com/other', false],
    ['https://hosei-tsukyo-media.com/planner/test', false],
    ['https://hosei-tsukyo-media.com/planner#hosei-import=example', true],
    ['https://evil.example/planner', false],
  ];
  for (const [senderUrl, allowed] of cases) {
    const session = storage(); await handoff.store(session, { token, importData: { schemaVersion: 1 }, now: 1000 });
    const result = await handoff.read(session, { token, senderUrl, now: 1001 });
    if (allowed) assert.deepEqual(result, { ok: true, importData: { schemaVersion: 1 } });
    else assert.deepEqual(result, { ok: false, reason: 'unauthorized_origin' });
  }
});

test('rejects expired, mismatched, and unauthorized handoff reads without leaking data', async () => {
  const session = storage(); await handoff.store(session, { token, importData: { secret: 'grade' }, now: 1000 });
  assert.deepEqual(await handoff.read(session, { token, senderUrl: 'https://evil.example/planner', now: 1001 }), { ok: false, reason: 'unauthorized_origin' });
  assert.equal(session.values.has(handoff.keyFor(token)), true);
  assert.deepEqual(await handoff.read(session, { token: '22222222-2222-4222-8222-222222222222', senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1001 }), { ok: false, reason: 'not_found' });
  assert.deepEqual(await handoff.read(session, { token, senderUrl: 'https://hosei-tsukyo-media.com/planner', now: 1000 + handoff.TTL_MS }), { ok: false, reason: 'expired' });
  assert.equal(session.values.has(handoff.keyFor(token)), false);
});

test('manifest asks only for the audited origin and never requests broad or credential permissions', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://hosei-tsukyo-media.com/*']);
  assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false);
  for (const permission of ['cookies', 'history', 'webRequest', 'tabs']) assert.equal(manifest.permissions.includes(permission), false);
});

test('popup retains copy and download fallbacks beside the direct handoff action', () => {
  const popup = readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
  assert.match(popup, /id="planner"/); assert.match(popup, /id="copy"/); assert.match(popup, /id="download"/);
  assert.match(script, /navigator\.clipboard\.writeText/); assert.match(script, /hosei-grade-import-v1\.json/);
});
