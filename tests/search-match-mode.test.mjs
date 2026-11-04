import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchOfferings } from '../src/planner/calculations.ts';
import { catalog } from '../src/planner/catalog/catalog.ts';

const offerings = [
  { id: 'a', name: '簿記', subjectCode: 'ABC123', classCode: 'CLS1', deliveryCategory: '前期メディア', period: '前期' },
  { id: 'b', name: '簿記', subjectCode: 'ABC124' },
  { id: 'c', name: '簿記Ⅰ' }, { id: 'd', name: '簿記Ⅱ' }, { id: 'e', name: '簿記演習' },
  { id: 'f', name: ' ＡＢＣ 入門 ' },
];
const ids = (query, mode) => searchOfferings(offerings, query, mode).map(o => o.id);
test('partial default preserves field and AND searches', () => {
  assert.deepEqual(ids('簿記'), ['a', 'b', 'c', 'd', 'e']);
  for (const query of ['abc123', 'ｃｌｓ１', '前期 メディア', '簿記 ABC123']) assert.deepEqual(ids(query), ['a']);
});
test('exact compares names only and retains separate offerings', () => {
  assert.deepEqual(ids(' 簿記 ', 'exact'), ['a', 'b']);
  for (const query of ['abc123', 'CLS1', '前期', '存在しない', '簿 記']) assert.deepEqual(ids(query, 'exact'), []);
});
test('both modes normalize NFKC/case/outer spaces and show all on blank', () => {
  for (const mode of ['partial', 'exact']) {
    for (const query of ['', '　 \t ']) assert.deepEqual(searchOfferings(offerings, query, mode), offerings);
    assert.deepEqual(ids(' abc 入門 ', mode), ['f']);
  }
  assert.deepEqual(ids('ABC  入門', 'exact'), []);
});
test('real catalog exact search preserves every matching offering without mutation', () => {
  const before = JSON.stringify(catalog);
  const expected = catalog.offerings.filter(o => o.name.normalize('NFKC').trim() === '簿記');
  assert.equal(expected.length, 0); // 2026 catalog has 簿記Ⅰ/Ⅱ, no bare 簿記.
  assert.deepEqual(searchOfferings(catalog.offerings, '簿記', 'exact'), expected);
  assert.ok(searchOfferings(catalog.offerings, '簿記').length > expected.length);
  assert.equal(JSON.stringify(catalog), before);
});
