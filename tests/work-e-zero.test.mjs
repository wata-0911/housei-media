import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importedCoursesAfterPatch } from '../src/planner/gradeImport/mediaConfirmation.ts';
const row = JSON.parse(readFileSync(new URL('./fixtures/work-e-zero/zero-lexeme.json', import.meta.url))).importedCourseAchievements[0];
test('numeric zero in either direction and identical NaN are no-ops', () => {
  for (const [before, after] of [[-0, 0], [0, -0], [NaN, NaN]]) {
    const owner = { ...row, earnedCreditsTotal: before };
    assert.equal(importedCoursesAfterPatch([owner], owner.id, { earnedCreditsTotal: after }), null);
    assert.ok(Object.is(owner.earnedCreditsTotal, before));
  }
});
test('null, undefined, zero and string zero remain distinct', () => {
  for (const before of [null, undefined, 0, '0']) for (const after of [null, undefined, 0, '0']) {
    const owner = { ...row, earnedCreditsTotal: before };
    const result = importedCoursesAfterPatch([owner], owner.id, { earnedCreditsTotal: after });
    if (before === after) assert.equal(result, null);
    else assert.deepEqual(result, [{ ...owner, earnedCreditsTotal: after }]);
  }
});
