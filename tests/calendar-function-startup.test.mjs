import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

// Deliberately no tsx loader: import only the generated production JavaScript graph.
const root = process.env.CALENDAR_FUNCTION_ARTIFACT_ROOT;
assert.ok(root, 'Set CALENDAR_FUNCTION_ARTIFACT_ROOT to official builder output');
const nodeMajor = process.versions.node.split('.')[0];
assert.ok(['22', '24'].includes(nodeMajor), 'Run the artifact contract with Node 22 or 24');
assert.ok(!process.execArgv.some(arg => /tsx|loader|--import/.test(arg)), 'Do not install a source loader');
const config = {
  CALENDAR_LOCAL_TEST_MODE: 'true',
  GAS_CALENDAR_APPROVAL_SECRET: 'dummy-approval-secret-with-more-than-thirty-two-characters',
  LINE_LOGIN_CHANNEL_ID: 'dummy-channel',
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'dummy-bot-token',
  LINE_APPROVAL_GROUP_ID: 'dummy-group',
  GAS_CALENDAR_DRAFT_WEB_APP_URL: 'https://script.google.com/macros/s/dummy-deployment/exec',
  GAS_CALENDAR_DRAFT_SECRET: 'dummy-secret',
};
const originalFetch = globalThis.fetch;
const deploymentKeys = ['VERCEL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'VERCEL_GIT_REPO_OWNER', 'VERCEL_GIT_REPO_SLUG', 'VERCEL_PROJECT_ID', 'CALENDAR_APPROVAL_DEV_PROJECT_ID', 'CALENDAR_APPROVAL_ENABLED', 'NODE_ENV'];
const originalEnv = Object.fromEntries([...Object.keys(config), ...deploymentKeys].map(key => [key, process.env[key]]));
let calls;
beforeEach(() => {
  for (const key of deploymentKeys) delete process.env[key];
  Object.assign(process.env, config);
  calls = [];
  globalThis.fetch = async () => { throw new Error('Unexpected outbound request'); };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
async function load(name) {
  const directory = resolve(root, `api/calendar-${name}.func`);
  const manifest = JSON.parse(await readFile(resolve(directory, '.vc-config.json'), 'utf8'));
  assert.equal(manifest.runtime, `nodejs${nodeMajor}.x`, 'Artifact runtime must match the executing Node major');
  assert.equal(manifest.handler, `api/calendar-${name}.js`);
  assert.equal(JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')).type, 'module');
  await readFile(resolve(directory, 'server/calendar-authorization.js'));
  if (name === 'draft') await readFile(resolve(directory, 'server/calendar-draft-image.js'));
  const module = await import(pathToFileURL(resolve(directory, manifest.handler)).href);
  assert.equal(typeof module.default.fetch, 'function');
  return module.default;
}
const request = (body, method = 'POST') => new Request('https://app.test/api/calendar', {
  method, ...(method === 'POST' ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});
const userId = `U${'a'.repeat(32)}`;
function stub({ invalidToken = false, nonmember = false, bridge } = {}) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === 'https://api.line.me/oauth2/v2.1/verify') {
      return Response.json({ iss: 'https://access.line.me', aud: config.LINE_LOGIN_CHANNEL_ID, exp: Date.now() / 1000 + 600, sub: userId, name: 'Dummy member' }, { status: invalidToken ? 400 : 200 });
    }
    if (String(url) === `https://api.line.me/v2/bot/group/dummy-group/member/${userId}`) {
      return Response.json({ userId }, { status: nonmember ? 404 : 200 });
    }
    assert.equal(String(url), config.GAS_CALENDAR_DRAFT_WEB_APP_URL, 'Unknown upstream target');
    return Response.json(bridge);
  };
}
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, -4)), b.length - 4); return b; }
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
  chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0)),
]);
const draft = () => ({ ok: true, mimeType: 'image/png', yearMonth: '2026-11', generatedAt: '2026-11-02T12:00:00+09:00', imageBase64: png.toString('base64') });
for (const name of ['auth', 'draft', 'approve']) {
  test(`${name}: emitted JS loads and GET returns 405 without any outbound call`, async () => {
    const response = await (await load(name)).fetch(request(undefined, 'GET'));
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'POST');
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await response.json(), { error: 'Method not allowed' });
  });
  test(`${name}: empty POST returns 400 with dummy config without any outbound call`, async () => {
    const response = await (await load(name)).fetch(request({}));
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'auth_invalid_request');
  });
  test(`${name}: invalid token fails closed before membership or GAS`, async () => {
    stub({ invalidToken: true });
    const response = await (await load(name)).fetch(request({ idToken: 'dummy-id-token' }));
    assert.equal(response.status, 401); assert.equal((await response.json()).code, 'line_token_invalid');
    assert.equal(calls.length, 1);
  });
  test(`${name}: nonmember fails closed before GAS`, async () => {
    stub({ nonmember: true });
    const response = await (await load(name)).fetch(request({ idToken: 'dummy-id-token' }));
    assert.equal(response.status, 403); assert.equal((await response.json()).code, 'line_nonmember');
    assert.equal(calls.length, 2);
  });
}
test('auth: verified member preserves successful response', async () => {
  stub(); const response = await (await load('auth')).fetch(request({ idToken: 'dummy-id-token' }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { authorized: true, displayName: 'Dummy member' });
  assert.equal(calls.length, 2);
});
test('draft: fresh authorization returns exact PNG bytes and normalized metadata', async () => {
  stub({ bridge: draft() }); const response = await (await load('draft')).fetch(request({ idToken: 'dummy-id-token' }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(response.headers.get('x-calendar-year-month'), '2026-11');
  assert.equal(response.headers.get('x-calendar-generated-at'), '2026-11-02T03:00:00.000Z');
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[2].init.body), { action: 'get_current_draft', secret: config.GAS_CALENDAR_DRAFT_SECRET, includeApprovalBinding: true });
  assert.ok(calls.every(call => call.init.cache === 'no-store'));
});
test('draft: corrupt PNG is rejected after independent fresh authorization', async () => {
  stub({ bridge: { ...draft(), imageBase64: png.subarray(0, 8).toString('base64') } });
  const response = await (await load('draft')).fetch(request({ idToken: 'dummy-id-token' }));
  assert.equal(response.status, 502); assert.equal((await response.json()).code, 'draft_invalid_response');
  assert.equal(calls.length, 3);
});

test('approve: emitted JS validates signed preview, independently authorizes, and preserves exact target ACK',async()=>{
  const { createHmac } = await import('node:crypto');
  const target={yearMonth:'2026-11',fileId:'MOCK_FILE_ONLY_0001',generatedAt:'2026-11-01T01:00:00.000Z',revision:'100',draftId:'00000000-0000-4000-8000-000000000001',imageSha256:'a'.repeat(64)};
  const payload=Buffer.from(JSON.stringify({domain:'calendar-preview:v1',target,userId,expiresAt:Date.now()+600000})).toString('base64url');
  const key=createHmac('sha256',config.GAS_CALENDAR_APPROVAL_SECRET).update('calendar-preview-receipt-key:v1').digest();
  const previewReceipt=payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');
  stub({bridge:{ok:true,code:'APPROVED',status:'approved',...target,approvedAt:'2026-11-03T01:00:00.000Z'}});
  const response=await (await load('approve')).fetch(request({idToken:'dummy-id-token',draftId:target.draftId,revision:target.revision,imageSha256:target.imageSha256,previewReceipt}));
  assert.equal(response.status,200);assert.equal((await response.json()).code,'APPROVED');assert.equal(calls.length,3);
  assert.deepEqual(JSON.parse(calls[2].init.body),{action:'approve_current_draft_v1',secret:config.GAS_CALENDAR_APPROVAL_SECRET,actor:{userId},target});
});


const productionDev={VERCEL:'1',VERCEL_ENV:'production',CALENDAR_APPROVAL_ENABLED:'true',VERCEL_GIT_COMMIT_REF:'dev',VERCEL_PROJECT_ID:'dummy-dev-project',CALENDAR_APPROVAL_DEV_PROJECT_ID:'dummy-dev-project',VERCEL_GIT_REPO_OWNER:'wata-0911',VERCEL_GIT_REPO_SLUG:'housei-media'};
for(const name of ['auth','draft','approve']){
  for(const vercelEnv of [undefined,'','preview','development','unknown'])test(`${name}: emitted runtime denies VERCEL_ENV=${String(vercelEnv)} despite all enabled dev conditions`,async()=>{
    Object.assign(process.env,productionDev);if(vercelEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=vercelEnv;
    const response=await (await load(name)).fetch(request({idToken:'dummy-id-token'}));assert.equal(response.status,404);assert.deepEqual(await response.json(),{ok:false,code:'calendar_unavailable'});assert.equal(calls.length,0);
  });
  test(`${name}: emitted runtime denies main even with production and matching enabled project`,async()=>{
    Object.assign(process.env,productionDev,{VERCEL_GIT_COMMIT_REF:'main'});const response=await (await load(name)).fetch(request({idToken:'dummy-id-token'}));assert.equal(response.status,404);assert.equal(calls.length,0);
  });
  test(`${name}: emitted runtime permits exact production dev gate then validates request`,async()=>{
    Object.assign(process.env,productionDev);const response=await (await load(name)).fetch(request({}));assert.equal(response.status,400);assert.equal((await response.json()).code,'auth_invalid_request');assert.equal(calls.length,0);
  });
}
