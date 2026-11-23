import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptExportCsv, attemptExportPresentation, exportPin } from '../src/planner/attempts/exports/attemptExport.ts';
import { CURRENT_CURRICULUM_SEARCH_TARGET } from '../src/planner/institutional/currentSearch.ts';

function snapshot() {
  const snapshot = { ...CURRENT_CURRICULUM_SEARCH_TARGET, schemaVersion: 24, graphSha256: 'a'.repeat(64) };
  const pin = {
    snapshot, projection: { owners: [] }, ownerInventory: { coverage: 'complete', sourcePin: snapshot, records: [] },
    retained: { importedCourseAchievements: [], importedStudyRecords: [] },
  };
  const state = { ready: true, graph: {}, dirty: false, busy: false, proposal: null,
    saved: { status: 'pinned', past: pin } };
  return { state, pin };
}

test('eligibility accepts only complete clean current pin with matching source metadata', () => {
  const { state, pin } = snapshot();
  assert.equal(exportPin(state, false), pin);
  for (const patch of [
    { ready: false }, { dirty: true }, { busy: true }, { graph: null }, { proposal: {} },
    { saved: { status: 'hold', past: pin } }, { saved: { status: 'reading', past: pin } },
    { saved: { status: 'unconnected', past: null } }, { saved: { status: 'pinned', past: null } },
  ]) assert.equal(exportPin({ ...state, ...patch }, false), null);
  assert.equal(exportPin(state, true), null);
  pin.ownerInventory.coverage = 'incomplete';
  assert.equal(exportPin(state, false), null);
  pin.ownerInventory.coverage = 'complete';
  pin.snapshot.sourceDigest = 'different';
  assert.equal(exportPin(state, false), null);
  pin.snapshot.sourceDigest = CURRENT_CURRICULUM_SEARCH_TARGET.sourceDigest;
  pin.ownerInventory.sourcePin = { ...pin.snapshot };
  assert.equal(exportPin(state, false), null);
});

test('one presentation keeps same title attempts, nulls, zeroes and provenance separate', () => {
  const { pin } = snapshot();
  function attempt(id, year, membership) {
    return { learnerOriginal: { id, originalTitle: '科目\n"同名"', plan: { plannedYear: year, status: 'planned', contribution: { value: 0 } },
      membership: { kind: membership }, method: { value: 'unknown', evidence: null },
      identity: { status: 'unmatched' }, applicability: { status: 'unknown' } } };
  }
  pin.projection.owners = [attempt('first', null, 'active'), attempt('second', 2028, 'detached')];
  pin.ownerInventory.records = [
    { id: 'r1', kind: 'evaluation', owner: { kind: 'attempt', attemptId: 'first' }, payload: { value: 0 }, provenance: null },
    { id: 'r2', kind: 'todo', owner: null, payload: { value: null }, provenance: null },
    { id: 'r3', kind: 'media', owner: { kind: 'unresolved_legacy', reason: 'unmatched' }, payload: { value: 0 }, provenance: { row: 1 } },
  ];
  pin.retained.importedCourseAchievements = [{ id: 'raw', rawName: '同名', earnedCreditsTotal: 0 }];
  pin.retained.importedStudyRecords = [{ id: 'detail', rawName: '同名', credits: null }];
  const before = structuredClone(pin);
  const output = attemptExportPresentation(pin);
  assert.deepEqual(pin, before);
  assert.equal(output.rows.length, 8);
  assert.equal(JSON.parse(output.rows[0].at(-1)).totalRows, 7);
  const csvHeader = attemptExportCsv(output).split('\r\n')[0];
  assert.equal(csvHeader.split(',')[5], '"計画状態／本人記録の種類"');
  assert.deepEqual(output.rows.slice(1, 6).map(row => row[5]), ['planned', 'planned', 'evaluation', 'todo', 'media']);
  assert.deepEqual(output.rows.slice(1, 3).map(row => row.slice(1, 6)),
    [['first', 'first', '科目\n"同名"', '未設定', 'planned'], ['second', 'second', '科目\n"同名"', '2028', 'planned']]);
  assert.match(output.rows[2][6], /削除/);
  assert.equal(JSON.parse(output.rows[1].at(-1)).plan.contribution.value, 0);
  assert.equal(JSON.parse(output.rows[3].at(-1)).payload.value, 0);
  assert.equal(output.rows[4][0], '本人記録・所有者なし');
  assert.equal(output.rows[5][0], '本人記録・所有者未照合');
  assert.equal(output.rows[6][2], '');
  assert.equal(output.rows[7][2], '');
});

test('empty data still includes the receipt and zero data rows', () => {
  const output = attemptExportPresentation(snapshot().pin);
  assert.equal(output.rows.length, 1);
  assert.equal(JSON.parse(output.rows[0].at(-1)).totalRows, 0);
});

test('CSV preserves multiline quotation and treats formula-like benign text as literals', () => {
  const csv = attemptExportCsv({ rows: [['日本語\n"引用"', '=科目名', '  +印', '@本文', '\t備考', '0', '未設定', '＝候補']] });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(csv.includes('"日本語\n""引用"""'));
  for (const value of ["'=科目名", "'  +印", "'@本文", "'\t備考", "'＝候補"]) assert.ok(csv.includes('"'+value+'"'));
  assert.ok(csv.includes('"0","未設定"'));
});
