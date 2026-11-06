import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importedCoursesAfterPatch } from '../src/planner/gradeImport/mediaConfirmation.ts';
const read = name => JSON.parse(readFileSync(new URL('./fixtures/work-e-three/' + name + '.json', import.meta.url)));
const duplicate = read('duplicate-owner').importedCourseAchievements;
const [row] = read('history-mixed').importedCourseAchievements;
const apply = patch => importedCoursesAfterPatch([row], row.id, patch);

test('missing and duplicate owners reject all updates in either order without mutation', () => {
  const raw = JSON.stringify(duplicate);
  for (const rows of [duplicate, [...duplicate].reverse()]) {
    assert.equal(importedCoursesAfterPatch(rows, rows[0].id, { selectionSource: 'manual' }), null);
  }
  assert.equal(importedCoursesAfterPatch([], row.id, { selectionSource: 'manual' }), null);
  assert.equal(JSON.stringify(duplicate), raw);
});

test('scalar and array value equality reject a fresh but equivalent patch', () => {
  assert.equal(apply({}), null);
  assert.equal(apply({ selectionSource: row.selectionSource, academicYear: row.academicYear }), null);
  assert.equal(apply({ candidateOfferingIds: [...row.candidateOfferingIds],
    candidateCurriculumCourseIds: [...row.candidateCurriculumCourseIds] }), null);
  assert.equal(apply({ candidateOfferingIds: [...row.candidateOfferingIds], match: row.match }), null);
});

test('ID arrays preserve the distinction between order, element, length and undefined', () => {
  for (const key of ['candidateOfferingIds', 'candidateCurriculumCourseIds']) {
    const original = { ...row, [key]: ['a', 'b'] };
    for (const ids of [['b', 'a'], ['a', 'c'], ['a'], [], ['a', 'b', 'c'], undefined]) {
      const patch = { [key]: ids };
      const result = importedCoursesAfterPatch([original], original.id, patch);
      assert.deepEqual(result, [{ ...original, ...patch }]);
    }
    const absent = { ...row };
    delete absent[key];
    assert.equal(importedCoursesAfterPatch([absent], absent.id, { [key]: undefined }), null);
    assert.deepEqual(importedCoursesAfterPatch([absent], absent.id, { [key]: [] }), [{ ...absent, [key]: [] }]);
  }
});

test('a real scalar change replaces exactly one unique row and preserves every other field', () => {
  const other = { ...row, id: 'other-original' };
  const before = { ...row, academicYear: null };
  const rows = [before, other];
  for (const year of [undefined, 0, 2024]) {
    const result = importedCoursesAfterPatch(rows, row.id, { academicYear: year });
    assert.deepEqual(result, [{ ...before, academicYear: year }, other]);
    assert.equal(result[1], other);
    assert.equal(rows[0].academicYear, null);
  }
});
