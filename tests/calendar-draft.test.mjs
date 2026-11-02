import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import draftApi from '../api/calendar-draft.ts';
import authApi from '../api/calendar-auth.ts';
import { decodeDraftPng, MAX_BRIDGE_BYTES, MAX_PNG_BYTES, parseDraftMetadata } from '../server/calendar-draft-image.ts';

const userId = 'U' + 'a'.repeat(32);
const config = {
  LINE_LOGIN_CHANNEL_ID: 'test-channel', LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'test-bot-token', LINE_APPROVAL_GROUP_ID: 'test-group',
  GAS_CALENDAR_DRAFT_WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec', GAS_CALENDAR_DRAFT_SECRET: 'test-bridge-secret',
};
const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
let calls;
beforeEach(() => { Object.assign(process.env, config); calls = []; });
afterEach(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(config)) { if (key in originalEnv) process.env[key] = originalEnv[key]; else delete process.env[key]; } });
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, -4)), b.length - 4); return b; }
const header = Buffer.from([0,0,0,1,0,0,0,1,8,6,0,0,0]);
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,255,0,0,255]))), chunk('IEND', Buffer.alloc(0))]);
const valid = () => ({ ok: true, yearMonth: '2026-11', generatedAt: '2026-11-02T12:00:00+09:00', mimeType: 'image/png', imageBase64: png.toString('base64') });
function request(body = { idToken: 'raw-id-token' }, method = 'POST') { return new Request('https://app.test/api/calendar-draft', { method, ...(method === 'POST' ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) }); }
function mock({ verifyStatus = 200, memberStatus = 200, verified = {}, member = {}, bridge = valid(), bridgeResponse, fail } = {}) {
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url); calls.push({ url: href, init });
    if (href.includes('/oauth2/')) { if (fail === 'verify') throw new Error('network'); return Response.json({ iss: 'https://access.line.me', aud: config.LINE_LOGIN_CHANNEL_ID, exp: Date.now()/1000 + 600, sub: userId, name: 'Test', ...verified }, { status: verifyStatus }); }
    if (href.includes('/v2/bot/')) { if (fail === 'membership') throw new Error('network'); return Response.json({ userId, ...member }, { status: memberStatus }); }
    if (fail === 'bridge') throw new Error('network');
    return bridgeResponse ? bridgeResponse() : Response.json(bridge);
  };
}
function gasCalls() { return calls.filter(c => c.url.startsWith('https://script.')); }
async function failure(options, status, code) { mock(options); const response = await draftApi.fetch(request()); assert.equal(response.status, status); assert.notEqual(response.headers.get('content-type'), 'image/png'); assert.match(response.headers.get('cache-control'), /no-store/); if (code) assert.equal((await response.json()).code, code); return response; }

test('only fresh independent authorization can obtain binary PNG and paired safe metadata', async () => {
  mock(); const response = await draftApi.fetch(request({ idToken: 'raw-id-token', fileId: 'ignored', yearMonth: '1999-01' }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-calendar-year-month'), '2026-11'); assert.equal(response.headers.get('x-calendar-generated-at'), '2026-11-02T03:00:00.000Z');
  assert.equal(response.headers.get('cache-control'), 'no-store, private'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png); assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(gasCalls()[0].init.body), { action: 'get_current_draft', secret: config.GAS_CALENDAR_DRAFT_SECRET });
  assert.equal(gasCalls()[0].init.redirect, 'manual'); assert.ok(calls.every(c => !c.url.includes('token') && !c.url.includes('secret')));
  assert.equal(new URLSearchParams(calls[0].init.body).get('id_token'), 'raw-id-token');
});
for (const [name, body] of [['missing', {}], ['empty', { idToken: '' }], ['oversized', { idToken: 'a'.repeat(8193) }], ['wrong type', { idToken: 1 }]]) test(`${name} token never calls LINE or GAS`, async () => { mock(); const response = await draftApi.fetch(request(body)); assert.equal(response.status, 400); assert.equal(calls.length, 0); });
for (const [name, options, status] of [
  ['invalid token', { verifyStatus: 400 }, 401], ['expired token', { verified: { exp: 1 } }, 401], ['wrong audience', { verified: { aud: 'other' } }, 401],
  ['wrong issuer', { verified: { iss: 'other' } }, 401], ['bad subject', { verified: { sub: 'other' } }, 401], ['verify outage', { fail: 'verify' }, 502],
  ['nonmember', { memberStatus: 404 }, 403], ['membership outage', { memberStatus: 503 }, 502], ['membership network error', { fail: 'membership' }, 502], ['mismatched member', { member: { userId: 'other' } }, 502],
]) test(`${name} never calls GAS or returns PNG`, async () => { await failure(options, status); assert.equal(gasCalls().length, 0); });
test('prior successful calendar-auth does not authorize later draft access', async () => { mock(); assert.equal((await authApi.fetch(request())).status, 200); mock({ memberStatus: 404 }); await failure({ memberStatus: 404 }, 403); assert.equal(gasCalls().length, 0); assert.equal(calls.filter(c => c.url.includes('/oauth2/')).length, 2); });
test('missing LINE config and non-POST preserve calendar-auth behavior and never call GAS', async () => { mock(); delete process.env.LINE_LOGIN_CHANNEL_ID; assert.equal((await draftApi.fetch(request())).status, 503); assert.equal((await authApi.fetch(request())).status, 503); assert.equal((await draftApi.fetch(request(undefined, 'GET'))).status, 405); assert.equal(calls.length, 0); });
test('auth success body and method rejection stay compatible', async () => { mock(); const response = await authApi.fetch(request()); assert.deepEqual(await response.json(), { authorized: true, displayName: 'Test' }); const method = await authApi.fetch(request(undefined, 'GET')); assert.equal(method.headers.get('Allow'), 'POST'); assert.equal(method.headers.get('cache-control'), 'no-store'); });
for (const key of ['GAS_CALENDAR_DRAFT_WEB_APP_URL', 'GAS_CALENDAR_DRAFT_SECRET']) test(`missing ${key} safely fails after auth`, async () => { mock(); delete process.env[key]; const response = await draftApi.fetch(request()); assert.equal(response.status, 503); assert.equal((await response.json()).code, 'server_config'); assert.equal(gasCalls().length, 0); });
for (const value of ['https://evil.test/exec', 'http://script.google.com/macros/s/test/exec', 'https://script.google.com/macros/s/test/exec?secret=bad', 'https://user:pass@script.google.com/macros/s/test/exec']) test('untrusted configured URL rejected', async () => { process.env.GAS_CALENDAR_DRAFT_WEB_APP_URL = value; await failure({}, 503, 'server_config'); assert.equal(gasCalls().length, 0); });
for (const [error, status, code] of [['unauthorized', 502, 'draft_bridge_auth'], ['draft_not_ready', 404, 'draft_not_ready'], ['invalid_request',502,'draft_upstream'], ['invalid_file_type',502,'draft_upstream'], ['file_too_large',502,'draft_upstream'], ['storage_error',502,'draft_upstream']]) test(`HTTP200 bridge error ${error} is not success or LINE nonmember`, async () => { await failure({ bridge: { ok: false, error } }, status, code); });
for (const [name, bridge] of [
  ['not ok', { ...valid(), ok: undefined }], ['wrong MIME', { ...valid(), mimeType: 'image/jpeg' }], ['bad month', { ...valid(), yearMonth: '2026-13' }],
  ['unsafe metadata', { ...valid(), generatedAt: 'a\r\nb: c' }], ['invalid date', { ...valid(), generatedAt: '2026-02-30T00:00:00Z' }], ['missing date', { ...valid(), generatedAt: undefined }],
  ['invalid base64', { ...valid(), imageBase64: '====' }], ['whitespace base64', { ...valid(), imageBase64: png.toString('base64')+'\n' }], ['nonPNG', { ...valid(), imageBase64: Buffer.from('not a PNG').toString('base64') }],
  ['signature only', { ...valid(), imageBase64: png.subarray(0,8).toString('base64') }], ['CRC corruption', { ...valid(), imageBase64: Buffer.from(png).fill(0,29,33).toString('base64') }],
  ['oversized PNG', { ...valid(), imageBase64: Buffer.alloc(MAX_PNG_BYTES + 1).toString('base64') }],
]) test(`reject ${name}`, async () => { await failure({ bridge }, 502, 'draft_invalid_response'); });
test('historical empty generatedAt stays explicitly unknown, never invented', async () => { mock({ bridge: { ...valid(), generatedAt: '' } }); const response = await draftApi.fetch(request()); assert.equal(response.status,200); assert.equal(response.headers.get('X-Calendar-Generated-At'),''); });
for (const [name, response] of [
  ['HTML', () => new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } })],
  ['bad JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } })],
  ['nonobject JSON', () => Response.json(null)],
  ['declared oversize', () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_BRIDGE_BYTES + 1) } })],
  ['streamed oversize', () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_BRIDGE_BYTES+1)); c.close(); } }), { headers: { 'Content-Type': 'application/json' } })],
]) test(`reject ${name} upstream safely`, async () => { await failure({ bridgeResponse: response },502,'draft_invalid_response'); });
test('upstream HTTP failure not mistaken for no draft', async () => { await failure({ bridgeResponse: () => new Response('no',{status:500}) },502,'draft_upstream'); });
test('upstream transport failure does not leak internal details', async () => { const response = await failure({fail:'bridge'},502,'draft_invalid_response'); assert.ok(!JSON.stringify(response).includes(config.GAS_CALENDAR_DRAFT_SECRET)); });
test('timeout is distinct and bounded', async () => { const original = AbortSignal.timeout; AbortSignal.timeout = () => AbortSignal.abort(); try { mock({ bridgeResponse: () => { throw new DOMException('timeout','TimeoutError'); } }); const response = await draftApi.fetch(request()); assert.equal(response.status,504); assert.equal((await response.json()).code,'draft_timeout'); } finally { AbortSignal.timeout = original; } });
test('GAS redirect GET contains no secret or auth headers', async () => { mock(); const base = globalThis.fetch; globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://script.google.com/')) { calls.push({url:String(url),init}); return new Response(null,{status:302,headers:{Location:'https://script.googleusercontent.com/macros/echo?user_content_key=test'}}); } return base(url,init); }; const response=await draftApi.fetch(request()); assert.equal(response.status,200); const redirect=gasCalls()[1]; assert.equal(redirect.init.method,'GET'); assert.equal(redirect.init.body,undefined); assert.equal(redirect.init.headers,undefined); });
test('redirect to arbitrary host rejected without following it', async () => { await failure({bridgeResponse:()=>new Response(null,{status:302,headers:{Location:'https://evil.test'}})},502,'draft_invalid_response'); assert.equal(gasCalls().length,1); });
test('strict decoder and metadata helpers reject unsafe values', () => { assert.deepEqual(decodeDraftPng(png.toString('base64')),png); assert.throws(()=>decodeDraftPng('AB==')); assert.throws(()=>parseDraftMetadata('2026-01','2026-02-30T00:00:00Z')); });
test('approval and revision controls stay unconditionally disabled; requests use raw token', () => { const source=readFileSync(new URL('../src/pages/CalendarApprovePage.tsx',import.meta.url),'utf8'); assert.match(source,/const idToken = liff.getIDToken\(\)/); assert.match(source,/await loadDraft\(idToken\)/); for (const label of ['修正が必要','この画像を承認']) assert.match(source,new RegExp('<button[^>]*\\bdisabled\\b[^>]*>\\s*'+label)); assert.match(source,/URL.revokeObjectURL\(previewUrl\)/); assert.match(source,/controller.abort\(\)/); });
test('truncated chunks, invalid zlib and decompression beyond IHDR dimensions are rejected', () => {
  assert.throws(()=>decodeDraftPng(png.subarray(0,png.length-2).toString('base64')));
  for(const raw of [Buffer.from('not zlib'),deflateSync(Buffer.alloc(100)),Buffer.concat([deflateSync(Buffer.from([0,255,0,0,255])),Buffer.from('trailing')])]) {
    const candidate=Buffer.concat([png.subarray(0,33),chunk('IDAT',raw),chunk('IEND',Buffer.alloc(0))]);
    assert.throws(()=>decodeDraftPng(candidate.toString('base64')));
  }
});
test('malformed JSON request is rejected before any upstream request',async()=>{mock();const response=await draftApi.fetch(new Request('https://app.test/api/calendar-draft',{method:'POST',body:'{'}));assert.equal(response.status,400);assert.equal(calls.length,0);});
test('all LINE and GAS requests explicitly prohibit caching',async()=>{mock();await draftApi.fetch(request());assert.ok(calls.every(c=>c.init.cache==='no-store'));});
for (const [options, expected] of [[{verifyStatus:400},'line_token_invalid'],[{verifyStatus:503},'line_verification_unavailable'],[{fail:'verify'},'line_verification_unavailable'],[{memberStatus:404},'line_nonmember'],[{memberStatus:503},'line_membership_unavailable'],[{fail:'membership'},'line_membership_unavailable'],[{member:{userId:'other'}},'line_membership_unavailable']]) test(`auth provenance ${expected} is safe and propagated to draft without GAS`,async()=>{mock(options);const response=await draftApi.fetch(request());assert.equal((await response.json()).code,expected);assert.equal(gasCalls().length,0);});
test('auth config and invalid input have safe distinct codes, with original statuses',async()=>{mock();assert.equal((await authApi.fetch(request({}))).status,400);assert.equal((await (await authApi.fetch(request({}))).json()).code,'auth_invalid_request');delete process.env.LINE_LOGIN_CHANNEL_ID;const response=await authApi.fetch(request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'auth_server_config',error:'認証サーバーの設定が不足しています'});});
