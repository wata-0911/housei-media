import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isHoseiGradeImportV1, diagnoseHoseiGradeImportV1 } from '../../src/planner/gradeImportContract.ts';
import { importPreview } from '../../src/planner/gradeImportApply.ts';
import { serializeGradeImport } from '../serialize.ts';
import GradeImportPanel from '../../src/components/planner/GradeImportPanel.tsx';

const extension = readFileSync(new URL('../../extension/hosei-planner-import/parser/extractor.js', import.meta.url), 'utf8');
const artifact = JSON.parse(readFileSync(new URL('../../src/generated/gradeImportBookmarklet.json', import.meta.url), 'utf8'));
const code = decodeURIComponent(artifact.bookmarklet.slice('javascript:'.length));
const capturedAt = '2026-10-04T00:00:00.000Z';
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [capturedAt])); } }
const cells = (name, overrides = {}) => Array.from({ length: 24 }, (_, i) => overrides[i] ?? (i === 1 ? name : ''));
const logic = cells('論理学', { 2: '4', 5: '4', 7: '○26/06/01', 8: '×2026/06/15', 9: '*確認中', 10: '保留', 11: '2026年7月1日', 12: '*4', 13: 'A', 16: '2026/02/30' });
const fixture = () => Array.from({ length: 8 }, (_, group) => [
  cells(`***区分${group}`),
  ...Array.from({ length: 4 }, (_, i) => group === 0 && i === 0 ? logic : cells(`科目${group * 4 + i}`, { 2: '4', 5: '4' })),
]).flat();
const domRow = row => ({ querySelectorAll(selector) {
  assert.equal(selector, 'td');
  // Super Tables adds this extra physical cell: 25 physical -> 24 logical.
  return [{ textContent: '除外すべきラベル', classList: { contains: name => name === 'line_y_label' } },
    ...row.map(textContent => ({ textContent, classList: { contains: () => false } }))];
} });
const table = rows => ({ querySelectorAll(selector) {
  assert.equal(selector, 'tr.column_even, tr.column_odd');
  return rows.map(domRow);
} });
function harness(tables = [[], [], fixture(), fixture()], { clipboard = 'success', fallback = true, hostname = 'www.tsukyo.hosei.ac.jp', protocol = 'https:' } = {}) {
  const copied = [], alerts = [], diagnostics = [], fields = [], events = [];
  const body = { append(field) { fields.push(field); events.push('append'); } };
  const document = {
    body,
    activeElement: { focus() { events.push('restore-focus'); } },
    getSelection: () => ({ rangeCount: 1, getRangeAt: () => ({ cloneRange: () => ({}) }), removeAllRanges() { events.push('clear-selection'); }, addRange() { events.push('restore-selection'); } }),
    querySelectorAll(selector) { assert.equal(selector, 'table[id="seisekiTabele110"]'); return tables.map(table); },
    createElement(tag) {
      assert.equal(tag, 'textarea');
      return { style: {}, setAttribute() {}, focus() {}, select() {}, remove() { events.push('remove'); } };
    },
    execCommand(command) {
      assert.equal(command, 'copy'); events.push('fallback');
      if (fallback === 'throw') throw new Error('denied');
      if (fallback) copied.push(fields.at(-1).value);
      return fallback;
    },
    get cookie() { throw new Error('must not read cookie'); },
    get documentElement() { throw new Error('must not read full HTML'); },
  };
  const navigator = clipboard === 'missing' ? {} : { clipboard: { async writeText(text) {
    if (clipboard === 'denied') throw new Error('denied');
    copied.push(text);
  } } };
  const context = vm.createContext({ document, navigator, location: { hostname, protocol }, Date: FixedDate,
    alert: message => alerts.push(message), console: { info: (_, value) => diagnostics.push(value) },
  });
  return { context, copied, alerts, diagnostics, events, fields };
}
const plain = value => JSON.parse(JSON.stringify(value));
function extract(h) { vm.runInContext(extension, h.context); return plain(h.context.HoseiPlannerGradeExtractor.extractCurrentDocument()); }
async function run(h) {
  assert.equal(vm.runInContext(code, h.context), undefined, 'javascript completion cannot replace the page');
  await new Promise(resolve => setImmediate(resolve));
  return h;
}

test('generated extension and self-contained bookmarklet produce identical contract and diagnostics for 4 tables / 40 rows / 32 courses', async () => {
  const expected = extract(harness());
  const h = await run(harness());
  assert.equal(h.copied.length, 1);
  const payload = JSON.parse(h.copied[0]);
  assert.deepEqual(payload, expected.value);
  assert.deepEqual(plain(h.diagnostics[0]), expected.diagnostics);
  assert.equal(payload.courses.length, 32);
  assert.equal(payload.courses[0].rawName, '論理学');
  assert.equal(payload.capturedAt, capturedAt);
  assert.equal(payload.courses[0].categoryRaw, '***区分0');
  assert.equal(payload.courses[4].categoryRaw, '***区分1');
  assert.deepEqual(expected.diagnostics.tieCandidateIndexes, [2, 3]);
  assert.deepEqual(expected.diagnostics.tableCandidates.map(x => x.valid24RowCount), [0, 0, 40, 40]);
  assert.match(h.alerts[0], /32科目.*\n同数の候補テーブルが2個/);
  assert.match(h.alerts[0], /コピーしました/);
  assert.equal(h.context.HoseiPlannerGradeExtractor, undefined, 'bookmarklet never uses extension isolated-world global');
});

test('serialized output starts with object, has numeric version 1 and Array courses, and passes the Planner validator', async () => {
  const h = await run(harness());
  assert.equal(h.copied[0][0], '{');
  const payload = JSON.parse(h.copied[0]);
  assert.equal(payload.schemaVersion, 1);
  assert.ok(Array.isArray(payload.courses));
  assert.ok(isHoseiGradeImportV1(payload));
  assert.ok(Array.isArray(JSON.parse(serializeGradeImport(payload)).courses));
  assert.deepEqual(Object.keys(payload).sort(), ['capturedAt', 'courses', 'schemaVersion', 'source']);
  assert.equal(h.copied[0].includes('diagnostics'), false);
});

test('self-check rejects double-stringified courses and invalid nested fields before transport', () => {
  const payload = extract(harness()).value;
  for (const invalid of [{ ...payload, courses: JSON.stringify(payload.courses) }, { ...payload, schemaVersion: 2 }, { ...payload, courses: [{}] }, JSON.stringify(payload)]) {
    assert.throws(() => serializeGradeImport(invalid));
  }
  // Validate the final serialized object again, not just the input object.
  assert.throws(() => serializeGradeImport({ ...payload, toJSON: () => ({ ...payload, courses: '[]' }) }));
});

test('24-cell filtering and category inheritance survive physical label cells', async () => {
  const h = await run(harness([[cells('***一般教育'), logic.slice(0, 23), [...logic, 'extra'], cells(''), logic]]));
  const payload = JSON.parse(h.copied[0]);
  assert.equal(payload.courses.length, 1);
  assert.equal(payload.courses[0].categoryRaw, '***一般教育');
});

test('date formats, report markers, invalid dates and pending numeric marker retain parser semantics', () => {
  const h = harness(); extract(h); const api = h.context.HoseiPlannerGradeExtractor;
  for (const input of ['26/06/01', '2026/06/01', '2026年6月1日']) assert.equal(api.date(input), '2026-06-01');
  for (const input of ['2026/02/30', '2026/13/01', '2026/00/01', '2026/01/00', '', 'unknown']) assert.equal(api.date(input), null);
  assert.deepEqual(['○26/06/01', '×26/06/01', '*', '', 'unknown'].map(x => api.report(x).status), ['passed', 'resubmit', 'processing', 'none', 'unknown']);
  const course = plain(api.extractRows([logic]))[0];
  assert.equal(course.creditExam.credits, 4);
  assert.equal(course.creditExam.pendingMarker, true);
  assert.equal(course.schoolings[0].date, null);
});

for (const clipboard of ['denied', 'missing']) test(`clipboard ${clipboard}: local fallback copies the same validated JSON and cleans up`, async () => {
  const h = await run(harness(undefined, { clipboard }));
  assert.deepEqual(JSON.parse(h.copied[0]), extract(harness()).value);
  assert.match(h.alerts[0], /コピーしました/);
  assert.deepEqual(h.events, ['append', 'fallback', 'remove', 'restore-focus', 'clear-selection', 'restore-selection']);
});
for (const fallback of [false, 'throw']) test(`both copy methods fail (${fallback}): explicit failure, no false success, temporary field removed`, async () => {
  const h = await run(harness(undefined, { clipboard: 'denied', fallback }));
  assert.equal(h.copied.length, 0);
  assert.match(h.alerts[0], /32科目/);
  assert.match(h.alerts[0], /コピーに失敗/);
  assert.ok(h.events.includes('remove'));
});
for (const [tables, message] of [[[], /成績表が見つかりません/], [[[cells('***カテゴリ')]], /科目行が見つかりません/]]) test(`missing table/course rows reports explicit error: ${message}`, async () => {
  const h = await run(harness(tables));
  assert.match(h.alerts[0], message);
  assert.equal(h.copied.length, 0);
});

test('unsupported origins stop before reading DOM or copying', async () => {
  for (const options of [{ hostname: 'hosei.ac.jp.example.com' }, { hostname: 'evil-hosei.ac.jp' }, { protocol: 'http:' }]) {
    const h = harness(undefined, options);
    h.context.document.querySelectorAll = () => assert.fail('must not read this document');
    await run(h); assert.match(h.alerts[0], /ログイン/); assert.equal(h.copied.length, 0);
  }
});

test('invalid generated contract aborts before clipboard', async () => {
  // An overflowing numeric value is not finite, so the shared contract validator rejects it.
  const h = await run(harness([[cells('科目', { 2: '9'.repeat(400) })]]));
  assert.equal(h.copied.length, 0);
  assert.match(h.alerts[0], /形式検証に失敗/);
});

test('artifact has no network, remote code, navigation transport, persistent storage or private-page readers', () => {
  assert.match(artifact.bookmarklet, /^javascript:/);
  assert.doesNotMatch(artifact.bookmarklet, /[\r\n#]/);
  assert.doesNotMatch(code, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|eval|Function|Image|Worker|SharedWorker)\b|import\s*\(|createElement\(["'](?:script|img|iframe|link)|\.src\s*=|\.href\s*=|postMessage|window\.open|location\.(?:assign|replace|href|search|hash)|localStorage|sessionStorage|\.cookie\b|innerHTML|outerHTML/);
});

test('existing importPreview yields exactly the same preview from clipboard JSON and extension JSON', async t => {
  const expected = extract(harness()).value;
  const actual = JSON.parse((await run(harness())).copied[0]);
  let nextId = 0;
  t.mock.method(globalThis.crypto, 'randomUUID', () => `fixture-id-${nextId++}`);
  const actualPreview = importPreview(actual, []);
  nextId = 0;
  assert.deepEqual(actualPreview, importPreview(expected, []));
});

test('Planner renders generated Bookmarklet code as inert text with the existing JSON import UI and no unpublished Chrome extension guidance', () => {
  const html = renderToStaticMarkup(createElement(GradeImportPanel, { offerings: [], plannedItems: [], existing: [], disabled: false, onApply: () => true }));
  assert.match(html, /Bookmarkletのコードをコピー/);
  assert.doesNotMatch(html, /Chrome拡張/);
  assert.match(html, /読み込み・検証/);
  assert.match(html, /手動コピー用コード/);
  assert.doesNotMatch(html, /href="javascript:|<script/);
  assert.ok(html.includes(artifact.bookmarklet.replaceAll('&', '&amp;').replaceAll("'", '&#x27;')));
});

const secret = 'PRIVATE_SENTINEL_course_grade_ID_cookie_html';
const privateError = () => { throw new Error(secret); };
function assertPrivate(h) {
  // Inspect all notification/log arguments, not just the visible message.
  assert.doesNotMatch(JSON.stringify([h.alerts, h.diagnostics]), new RegExp(secret));
  for (const logged of h.diagnostics) {
    assert.deepEqual(Object.keys(logged).sort(), ['selectedCandidateIndex', 'tableCandidates', 'tieCandidateIndexes']);
    for (const candidate of logged.tableCandidates) assert.deepEqual(Object.keys(candidate).sort(), ['categoryRowCount', 'courseRowCount', 'index', 'rowCount', 'valid24RowCount']);
  }
}

test('extract exception has a distinct fixed code and never logs exception data', async () => {
  const h = harness(); h.context.document.querySelectorAll = privateError;
  await run(h);
  assert.match(h.alerts[0], /GI_EXTRACT_EXCEPTION/);
  assert.equal(h.copied.length, 0); assertPrivate(h);
});

test('contract rejection identifies only course index, static field path and category', async () => {
  const h = await run(harness([[cells(secret, { 2: '9'.repeat(400) })]]));
  assert.match(h.alerts[0], /GI_CONTRACT_INVALID/);
  assert.match(h.alerts[0], /course index: 0 \/ field: courses\[0\]\.compositionCredits.value \/ category: non_finite/);
  assert.equal(h.copied.length, 0); assertPrivate(h);
});

test('contract validator exception has a distinct code with no original error', async () => {
  const h = harness();
  // Own Date subclass avoids patching the shared test runner Date.parse.
  vm.runInContext(`Date = class extends Date { static parse() { throw new Error('${secret}'); } };`, h.context);
  await run(h);
  assert.match(h.alerts[0], /GI_CONTRACT_EXCEPTION/);
  assert.equal(h.copied.length, 0); assertPrivate(h);
});

for (const [setup, expected] of [
  [`JSON.stringify = () => { throw new Error('${secret}'); };`, 'GI_SERIALIZE_ENCODE'],
  [`JSON.parse = () => { throw new Error('${secret}'); };`, 'GI_SERIALIZE_PARSE'],
  [`JSON.stringify = () => '{"schemaVersion":1,"source":"hosei_web_learning_grade_table","capturedAt":"2026-10-04T00:00:00Z","courses":"${secret}"}';`, 'GI_SERIALIZE_FINAL'],
]) test(`serialization stage identifies ${expected} without leaking page-provided errors or values`, async () => {
  const h = harness(); vm.runInContext(setup, h.context);
  await run(h);
  assert.match(h.alerts[0], new RegExp(expected));
  assert.equal(h.copied.length, 0); assertPrivate(h);
  if (expected === 'GI_SERIALIZE_FINAL') assert.match(h.alerts[0], /field: courses \/ category: type/);
});

test('serializer input rejection exposes fixed code and structural issue only', () => {
  assert.throws(() => serializeGradeImport({ ...extract(harness()).value, courses: secret }), error => {
    assert.equal(error.code, 'GI_SERIALIZE_INPUT');
    assert.deepEqual(error.issue, { courseIndex: null, fieldPath: 'courses', category: 'type' });
    assert.equal(error.cause, undefined); assert.doesNotMatch(String(error), new RegExp(secret));
    return true;
  });
});

for (const target of ['Array', 'Object']) test(`page-world ${target}.prototype.toJSON cannot corrupt our serialization or get changed by it`, async () => {
  const h = harness();
  vm.runInContext(`Object.defineProperty(${target}.prototype, 'toJSON', {value: function(){throw new Error('${secret}');}, writable: false, configurable: false});`, h.context);
  const original = vm.runInContext(`${target}.prototype.toJSON`, h.context);
  await run(h);
  assert.equal(h.copied.length, 1);
  const payload = JSON.parse(h.copied[0]);
  assert.ok(isHoseiGradeImportV1(payload));
  assert.ok(Array.isArray(payload.courses));
  assert.ok(Array.isArray(payload.courses[0].reports));
  assert.ok(Array.isArray(payload.courses[0].schoolings));
  assert.deepEqual(payload, extract(harness()).value);
  assert.equal(vm.runInContext(`${target}.prototype.toJSON`, h.context), original);
  assert.match(h.alerts[0], /コピーしました/);
  assert.doesNotMatch(h.alerts.join(''), new RegExp(secret));
});

test('legacy array JSON-text hook reproduces double-stringification, while final bookmarklet keeps all arrays', async () => {
  const h = harness();
  vm.runInContext(`Array.prototype.toJSON = function(){return '[]'};`, h.context);
  assert.equal(vm.runInContext(`typeof JSON.parse(JSON.stringify({courses:[]})).courses`, h.context), 'string');
  await run(h);
  const payload = JSON.parse(h.copied[0]);
  assert.equal(payload.courses.length, 32); assert.ok(isHoseiGradeImportV1(payload));
});

for (const [clipboard, expected] of [['denied', 'GI_CLIPBOARD_PRIMARY_FAILED'], ['missing', 'GI_CLIPBOARD_PRIMARY_UNAVAILABLE']]) test(`primary clipboard ${clipboard} is distinguishable even when fallback succeeds`, async () => {
  const h = await run(harness([[cells(secret)]], { clipboard }));
  assert.match(h.alerts[0], new RegExp(expected));
  assert.match(h.alerts[0], /コピーしました/);
  assertPrivate(h);
});

test('primary rejection and fallback failure both retain stage codes with no original exception', async () => {
  const h = harness([[cells(secret)]], { clipboard: 'denied' });
  h.context.document.execCommand = privateError;
  await run(h);
  assert.match(h.alerts[0], /GI_CLIPBOARD_PRIMARY_FAILED/);
  assert.match(h.alerts[0], /GI_CLIPBOARD_FALLBACK_FAILED/);
  assert.match(h.alerts[0], /コピーに失敗/);
  assert.equal(h.copied.length, 0); assertPrivate(h);
});

for (const step of ['activeElement', 'getSelection', 'getRangeAt', 'cloneRange']) test(`fallback snapshot ${step} failure cannot prevent a local copy`, async () => {
  const h = harness([[cells(secret)]], { clipboard: 'denied' });
  if (step === 'activeElement') Object.defineProperty(h.context.document, step, { get: privateError });
  if (step === 'getSelection') h.context.document.getSelection = privateError;
  if (step === 'getRangeAt') h.context.document.getSelection = () => ({ rangeCount: 1, getRangeAt: privateError });
  if (step === 'cloneRange') h.context.document.getSelection = () => ({ rangeCount: 1, getRangeAt: () => ({ cloneRange: privateError }) });
  await run(h);
  assert.equal(h.copied.length, 1);
  assert.match(h.alerts[0], /コピーしました/);
  assert.match(h.alerts[0], /GI_CLIPBOARD_FALLBACK_SNAPSHOT/); assertPrivate(h);
});

for (const step of ['createElement', 'append', 'select']) test(`fallback setup ${step} exception is contained and classified`, async () => {
  const h = harness([[cells(secret)]], { clipboard: 'denied' });
  if (step === 'createElement') h.context.document.createElement = privateError;
  if (step === 'append') h.context.document.body.append = privateError;
  if (step === 'select') {
    const create = h.context.document.createElement;
    h.context.document.createElement = tag => ({ ...create(tag), select: privateError });
  }
  await run(h);
  assert.match(h.alerts[0], /GI_CLIPBOARD_FALLBACK_FAILED/);
  assert.equal(h.copied.length, 0); assertPrivate(h);
});

for (const [step, expected] of [['clear', 'CLEAR'], ['remove', 'REMOVE'], ['focus', 'FOCUS'], ['removeAllRanges', 'SELECTION'], ['addRange', 'SELECTION']]) test(`fallback finally ${step} exception does not overwrite a successful copy`, async () => {
  const h = harness([[cells(secret)]], { clipboard: 'denied' });
  const doc = h.context.document;
  if (step === 'focus') doc.activeElement.focus = privateError;
  if (['clear', 'remove'].includes(step)) {
    const create = doc.createElement;
    doc.createElement = tag => {
      const field = create(tag);
      if (step === 'remove') {
        field.remove = privateError;
        field.parentNode = { removeChild: element => { assert.equal(element, field); h.events.push('remove-via-parent'); } };
      } else {
        let value;
        Object.defineProperty(field, 'value', { get: () => value, set: text => { if (text === '') privateError(); value = text; } });
      }
      return field;
    };
  }
  if (['removeAllRanges', 'addRange'].includes(step)) {
    const selection = doc.getSelection(); selection[step] = privateError; doc.getSelection = () => selection;
  }
  await run(h);
  assert.equal(h.copied.length, 1);
  assert.match(h.alerts[0], /コピーしました/);
  assert.doesNotMatch(h.alerts[0], /コピーしていません/);
  assert.match(h.alerts[0], new RegExp(`GI_CLIPBOARD_FALLBACK_${expected}`));
  if (step === 'remove') { assert.equal(h.fields[0].value, ''); assert.ok(h.events.includes('remove-via-parent')); }
  assertPrivate(h);
});

test('fallback cleanup errors cannot mask an unsuccessful copy either', async () => {
  const h = harness([[cells(secret)]], { clipboard: 'denied', fallback: false });
  h.context.document.activeElement.focus = privateError;
  await run(h);
  assert.equal(h.copied.length, 0);
  assert.match(h.alerts[0], /コピーに失敗/);
  assert.match(h.alerts[0], /GI_CLIPBOARD_FALLBACK_FAILED/);
  assert.match(h.alerts[0], /GI_CLIPBOARD_FALLBACK_FOCUS/); assertPrivate(h);
});

test('console failure does not interfere with copying and alert failure does not reject the runner', async () => {
  const h = harness(); h.context.console.info = privateError;
  await run(h); assert.equal(h.copied.length, 1);
  const brokenAlert = harness(); brokenAlert.context.alert = privateError;
  await run(brokenAlert); assert.equal(brokenAlert.copied.length, 1);
});

test('diagnostic field paths are schema literals and never copy invalid values or property names', () => {
  const payload = extract(harness()).value;
  const mutations = [
    [x => { x.courses[0].rawName = ''; }, 'rawName', 'empty'],
    [x => { x.courses[0].creditExam.date = secret; }, 'creditExam.date', 'date'],
    [x => { x.courses[0].creditExam.credits = -1; }, 'creditExam.credits', 'negative'],
    [x => { x.courses[0].reports[2].status = secret; }, 'reports[2].status', 'value'],
    [x => { x.courses[0].schoolings[1].credits = Infinity; }, 'schoolings[1].credits', 'non_finite'],
    [x => { x.courses[0].schoolings[0].rawYear = { [secret]: secret }; }, 'schoolings[0].rawYear', 'type'],
    [x => { x.courses[0].reports.pop(); }, 'reports', 'length'],
  ];
  for (const [mutate, path, category] of mutations) {
    const copy = structuredClone(payload); mutate(copy);
    assert.equal(isHoseiGradeImportV1(copy), false);
    assert.deepEqual(diagnoseHoseiGradeImportV1(copy), { courseIndex: 0, fieldPath: `courses[0].${path}`, category });
    assert.doesNotMatch(JSON.stringify(diagnoseHoseiGradeImportV1(copy)), new RegExp(secret));
  }
  assert.equal(diagnoseHoseiGradeImportV1(payload), null);
});

test('real-world-style unrecognized cell text remains raw + null, without weakening validator', () => {
  const h = harness(); extract(h);
  const samples = ['', '　', '—', '認定', '履修中', '４', '4単位', '1,000', '*4', '○', '×', '保留', '2024/02/29', '2025/02/29', '99/12/31'];
  for (const raw of samples) {
    const row = cells('合成監査');
    for (let i = 2; i < 24; i++) row[i] = raw;
    const payload = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt, courses: plain(h.context.HoseiPlannerGradeExtractor.extractRows([row])) };
    assert.ok(isHoseiGradeImportV1(payload));
    assert.equal(diagnoseHoseiGradeImportV1(payload), null);
  }
});
