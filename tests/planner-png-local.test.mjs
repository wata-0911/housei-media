import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preparePngData } from '../src/planner/exports/pngExport.ts';

const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=';
const dataUrl = 'data:image/png;base64,' + data;

test('decodes the renderer PNG locally without fetch', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('PNG generation must not fetch'));
  const { dataUrl: returnedUrl, blob } = await preparePngData({}, async () => dataUrl);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(returnedUrl, dataUrl);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(data, 'base64'));
});

test('rejects network URLs, empty PNG data, and other MIME types without reading them', async () => {
  for (const value of ['https://example.invalid/a.png', 'data:image/png;base64,', 'data:image/jpeg;base64,' + data]) {
    await assert.rejects(preparePngData({}, async () => value), /Invalid PNG/);
  }
});

test('keeps the injected reader contract', async () => {
  const customBlob = new Blob([Buffer.from(data, 'base64')], { type: 'image/png' });
  const result = await preparePngData({}, async () => dataUrl, async url => {
    assert.equal(url, dataUrl);
    return { ok: true, blob: async () => customBlob };
  });
  assert.equal(result.blob, customBlob);
});
