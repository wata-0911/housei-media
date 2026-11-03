import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { previewImport, verifyImportPreview, PreviewError } from '../../src/planner/attempts/gradeImport/preview.ts';
// Golden full values were captured from the unchanged pre-R01 creator.
// Keep only inert test data in this repository, not a second runtime implementation.
const golden = JSON.parse(readFileSync(new URL('./fixtures/r01-prior-values.json', import.meta.url), 'utf8'));
async function beforePreview(...args) {
 const key = createHash('sha256').update(JSON.stringify(args)).digest('hex');
 assert.ok(Object.hasOwn(golden, key), 'exact reference inputs must exist');
 return structuredClone(golden[key]);
}

import { createGradeSourceArchive, decodeGradeSourceArchive } from '../../src/planner/attempts/gradeImport/sourceArchive.ts';
import { createLedger, appendOperation, verifyLedgerState } from '../../src/planner/attempts/gradeImport/ledger.ts';
import { parseAttemptGraphJson, ATTEMPT_GRAPH_JSON_LIMITS, AttemptJsonInputError } from '../../src/planner/attempts/jsonInput.ts';
const json = JSON.stringify;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/r01-depth-inputs.json', import.meta.url), 'utf8'));
const summary = [];
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : json(value), 'utf8').digest('hex');
const capacity = e => e instanceof PreviewError && e.code === 'resource_limit' && e.message === 'resource_limit';
function nested(n, arrays = false) { let v = 0; for (let i = 0; i < n; i++) v = arrays ? [v] : { next: v }; return v; }
function containerDepth(value) {
  let maximum = -1; const stack = [[value, 0]];
  while (stack.length) {
    const [v, d] = stack.pop(); if (!v || typeof v !== 'object') continue;
    maximum = Math.max(maximum, d); for (const x of Object.values(v)) if (x && typeof x === 'object') stack.push([x, d + 1]);
  }
  return maximum;
}
const rawTemplate = JSON.parse(fixture.archive.raw);
function source(row, metadata = {}) { return json({ ...rawTemplate, courses: [row], ...metadata }); }
function plainRow() { const r = structuredClone(rawTemplate.courses[0]); delete r.unknown; return r; }
let serial = 0xa00000; // fixture-only, independent of course/year/name
const id = role => `hosei:g01b-${role}:00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, '0')}`;
async function scenario(kind, depth) {
  const oldRow = plainRow(), newRow = plainRow(); const oldMeta = {}, newMeta = {};
  switch (kind) {
    case 'row-add': newRow.unknown = nested(depth); break;
    case 'row-remove': oldRow.unknown = nested(depth); break;
    case 'metadata-add': newMeta.unknown = nested(depth); break;
    case 'metadata-remove': oldMeta.unknown = nested(depth); break;
    case 'object-to-primitive': oldRow.unknown = nested(depth); newRow.unknown = 0; break;
    case 'primitive-to-object': oldRow.unknown = 0; newRow.unknown = nested(depth); break;
    case 'array-add': newRow.unknown = nested(depth, true); break;
    case 'array-element-change': oldRow.unknown = ['keep', 0]; newRow.unknown = ['keep', nested(depth)]; break;
    default: throw Error('bad fixture kind');
  }
  const oldRaw = source(oldRow, oldMeta), newRaw = source(newRow, newMeta);
  const oldArchive = await createGradeSourceArchive(oldRaw), archive = await createGradeSourceArchive(newRaw), empty = await createLedger();
  const operation = { kind: 'import_snapshot', operationId: id('operation'), expectedTipSha256: null, snapshotId: id('snapshot'), archive: oldArchive,
    rows: [{ observationId: id('observation'), achievementId: id('achievement'), revisionId: id('revision'), previousRevisionId: null,
      details: Array.from({ length: 7 }, () => ({ observationId: id('detail-observation'), detailId: id('detail'), revisionId: id('detail-revision'), previousRevisionId: null })) }] };
  const imported = await appendOperation(json(empty), json(operation));
  // Give the existing quantity an active revision, so refusal also checks active-state preservation.
  const selection = { kind: 'activate_revision', operationId: id('operation'), expectedTipSha256: imported.tipSha256, achievementId: operation.rows[0].achievementId,
    revisionId: operation.rows[0].revisionId, expectedActiveRevisionId: null, confirmation: { kind: 'explicit-selection', reason: 'synthetic baseline' } };
  const ledger = await appendOperation(json(imported), json(selection));
  const floor = { issuedIds: ledger.issuedIds, reservedIds: ledger.reservedIds };
  return { archive, ledger, floor, args: [archive, ledger, floor].map(json), oldRaw, newRaw };
}

test('R-01 exact unmodified independent inputs: 1504-byte archive is valid, generation now refuses as resource_limit', async () => {
  const args = [fixture.archive, fixture.ledger, fixture.floor].map(json), hashes = args.map(sha);
  assert.equal(Buffer.byteLength(fixture.archive.raw), 1504);
  assert.equal(Buffer.byteLength(json(fixture.preview)), 7955);
  assert.deepEqual(await decodeGradeSourceArchive(args[0]), fixture.archive);
  assert.deepEqual(await verifyLedgerState(args[1], args[2]), fixture.ledger);
  await assert.rejects(previewImport(...args), capacity);
  assert.deepEqual(args.map(sha), hashes); assert.deepEqual([fixture.archive, fixture.ledger, fixture.floor].map(json), args);
  summary.push({ case: 'exact-independent-input', rawBytes: 1504, formerPreviewBytes: 7955, result: 'generation-resource_limit' });
});

test('R-01 direct boundary 56/57/58/60/62: parser limit unchanged; accepted outputs identical and round-trip', async () => {
  assert.equal(ATTEMPT_GRAPH_JSON_LIMITS.depth, 64);
  for (const depth of [56, 57, 58, 60, 62]) {
    const root = JSON.parse(fixture.archive.raw); root.courses[0].unknown = nested(depth);
    const archive = await createGradeSourceArchive(json(root)), args = [archive, fixture.ledger, fixture.floor].map(json), before = args.map(sha);
    const prior = await beforePreview(...args), wire = json(prior), maximum = containerDepth(prior);
    assert.equal(maximum, depth + 7);
    if (depth <= 57) {
      assert.deepEqual(parseAttemptGraphJson(wire), prior);
      const p = await previewImport(...args); assert.deepEqual(p, prior);
      assert.deepEqual(await verifyImportPreview(json(p), ...args), p);
      assert.equal(p.sourceArchive.raw, archive.raw);
    } else {
      assert.throws(() => parseAttemptGraphJson(wire), e => e instanceof AttemptJsonInputError && e.code === 'resource_limit');
      await assert.rejects(previewImport(...args), capacity);
    }
    assert.deepEqual(args.map(sha), before);
    summary.push({ case: 'independent-boundary', nestedDepth: depth, maxContainerIndex: maximum, previewBytes: Buffer.byteLength(wire), result: depth <= 57 ? 'unchanged-output+roundtrip' : 'generation-resource_limit' });
  }
});

for (const kind of ['row-add', 'row-remove', 'metadata-add', 'metadata-remove', 'object-to-primitive', 'primitive-to-object', 'array-add', 'array-element-change']) {
  for (const depth of [56, 57, 58, 60]) test(`R-01 ${kind} / ${depth}: full output preflight agrees with creation and verification`, async () => {
    const s = await scenario(kind, depth), hashes = s.args.map(sha);
    // Original creator is used only as an unchanged-value oracle; fixed parser decides the existing wire boundary.
    const prior = await beforePreview(...s.args), wire = json(prior), maximum = containerDepth(prior);
    let accepted = true;
    try { parseAttemptGraphJson(wire); }
    catch (e) { assert.ok(e instanceof AttemptJsonInputError); assert.equal(e.code, 'resource_limit'); accepted = false; }
    if (accepted) {
      const created = await previewImport(...s.args); assert.deepEqual(created, prior);
      assert.deepEqual(await verifyImportPreview(json(created), ...s.args), created);
      assert.equal(created.sourceArchive.raw, s.newRaw);
      assert.deepEqual(created.sourceArchive.dto, s.archive.dto);
      assert.deepEqual(created.rows.map(r => r.record), s.archive.dto.courses);
      assert.deepEqual(created.authorization, { kind: 'preview-only', journalDeclaration: 'not-created', saveAuthority: 'not-issued', canCommit: false });
      assert.ok(Object.isFrozen(created));
    } else {
      await assert.rejects(previewImport(...s.args), capacity);
    }
    assert.deepEqual(s.args.map(sha), hashes);
    assert.equal(s.archive.raw, s.newRaw); assert.equal(s.ledger.view.snapshots[0].archive.raw, s.oldRaw);
    assert.deepEqual(await verifyLedgerState(s.args[1], s.args[2]), s.ledger);
    summary.push({ case: kind, nestedDepth: depth, maxContainerIndex: maximum, previewBytes: Buffer.byteLength(wire), result: accepted ? 'unchanged-output+roundtrip' : 'generation-resource_limit' });
  });
}

test('deep unknown input without matching candidates remains usable: no unnecessary raw truncation/refusal', async () => {
  const root = JSON.parse(fixture.archive.raw); root.courses[0].unknown = nested(62); root.unknownMetadata = nested(62);
  const a = await createGradeSourceArchive(json(root)), s = await createLedger(), floor = { issuedIds: [], reservedIds: [] };
  const args = [a, s, floor].map(json), p = await previewImport(...args);
  assert.equal(p.rows[0].resolution, 'unmatched'); assert.equal(p.sourceArchive.raw, a.raw);
  assert.deepEqual(await verifyImportPreview(json(p), ...args), p);
});

test('fixed verifier keeps numerical and duplicate-key checks; invalid submitted preview is not normalized', async () => {
  const s = await scenario('row-add', 56), p = await previewImport(...s.args);
  const duplicated = json(p).replace('{', '{"format":"fake",');
  await assert.rejects(verifyImportPreview(duplicated, ...s.args), e => e instanceof PreviewError && e.code === 'invalid_preview_json');
  const altered = json(p).replace('"rowIndex":0', '"rowIndex":1e-999');
  assert.notEqual(altered, json(p));
  await assert.rejects(verifyImportPreview(altered, ...s.args), e => e instanceof PreviewError && e.code === 'invalid_preview_json');
});

after(() => assert.deepEqual(summary, JSON.parse(readFileSync(new URL('./fixtures/r01-matrix.json', import.meta.url), 'utf8'))));
