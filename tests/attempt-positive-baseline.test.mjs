import { compareFieldCorrected, compareCompletion } from './fixtures/work-b-field-baseline.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { legacyCases, calculateState, calculateCompletion, snapshotValue } from './fixtures/yi07-graduation.mjs';
const baseline = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/yi07-legacy-baseline.json.gz', import.meta.url))));
const cases = legacyCases();
assert.equal(cases.length, 192);
assert.equal(new Set(cases.map(c => c.scopeId)).size, 8);
for (const c of cases) test(`Work B existing engine full output baseline: ${c.name}`, () => {
  const expected = baseline.cases.find(b => b.name === c.name);
  assert.ok(expected);
  compareFieldCorrected(snapshotValue(calculateState(c.state, c.scopeId)), expected.output, c.name);
  compareCompletion(snapshotValue(calculateCompletion(c.state, c.scopeId)), expected.completionOutput, c.name);
});
