import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const guardScript = readFileSync(new URL('../capture-origin.js', import.meta.url), 'utf8');
const popupScript = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL });
vm.runInContext(guardScript, context);
const allowed = context.HoseiPlannerCaptureOrigin.isAllowed;
const cases = [
  ['https://hosei.ac.jp/grades', true],
  ['https://www.hosei.ac.jp/grades', true],
  ['https://web.hosei.ac.jp/grades', true],
  ['https://www.tsukyo.hosei.ac.jp/grades', true],
  ['http://hosei.ac.jp/grades', false],
  ['https://hosei.ac.jp.example.com/grades', false],
  ['https://evilhosei.ac.jp/grades', false],
  ['https://example.com/grades', false],
  ['https://hosei.ac.jp@example.com/grades', false],
  ['chrome://extensions/', false],
  ['file:///tmp/grades.html', false],
  ['https://example.com/#https://hosei.ac.jp/', false],
  ['not a URL', false], ['', false], [undefined, false], [null, false],
];
for (const [url, expected] of cases) test(`capture origin: ${String(url)} is ${expected ? 'allowed' : 'rejected'}`, () => {
  assert.equal(allowed(url), expected);
});

function popupHarness(tab) {
  const nodes = new Map();
  const node = () => ({ handlers: {}, addEventListener(name, callback) { this.handlers[name] = callback; }, replaceChildren() {}, append() {} });
  for (const id of ['read', 'result', 'status', 'count', 'courses', 'copy', 'download', 'planner-actions']) nodes.set(id, node());
  const calls = [];
  const copied = [];
  const state = { tab };
  const context = vm.createContext({ URL,
    document: { getElementById: id => nodes.get(id), createElement: node },
    navigator: { clipboard: { async writeText(text) { copied.push(text); } } },
    HoseiPlannerTarget: { enabled: () => [] },
    chrome: {
      tabs: { query: async () => state.tab ? [state.tab] : [] },
      scripting: { async executeScript(request) { calls.push(request); return [{ result: { ok: true, value: { courses: [] } } }]; } },
    },
  });
  vm.runInContext(guardScript, context);
  vm.runInContext(popupScript, context);
  return { nodes, calls, copied, state, read: () => nodes.get('read').handlers.click() };
}

for (const [url, expected] of cases) test(`popup ${String(url)}: guard runs before either injection`, async () => {
  const h = popupHarness({ id: 7, url });
  await h.read();
  assert.equal(h.calls.length, expected ? 2 : 0);
  assert.equal(h.nodes.get('result').hidden, !expected);
  if (expected) {
    assert.deepEqual(Array.from(h.calls[0].files), ['parser/extractor.js']);
    assert.equal(h.calls[0].target.tabId, 7);
    assert.equal(h.calls[1].target.tabId, 7);
  } else assert.match(h.nodes.get('status').textContent, /法政大学.*HTTPS/);
});

test('popup rejects missing active tab or id without injection', async () => {
  for (const tab of [undefined, { url: 'https://hosei.ac.jp/' }]) {
    const h = popupHarness(tab);
    await h.read();
    assert.equal(h.calls.length, 0);
  }
});

test('rejected read clears earlier payload so copy cannot reuse it', async () => {
  const h = popupHarness({ id: 7, url: 'https://hosei.ac.jp/grades' });
  await h.read();
  await h.nodes.get('copy').handlers.click();
  assert.equal(h.copied.length, 1);
  h.state.tab = { id: 8, url: 'https://example.com/' };
  await h.read();
  await h.nodes.get('copy').handlers.click();
  assert.equal(h.calls.length, 2);
  assert.equal(h.copied.length, 1);
  assert.equal(h.nodes.get('result').hidden, true);
});

test('popup loads the guard before its module script', () => {
  const html = readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="capture-origin.js"><\/script><script type="module" src="popup.js">/);
});
