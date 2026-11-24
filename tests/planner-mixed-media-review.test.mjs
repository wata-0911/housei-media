import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { unresolvedMediaReviewDetails } from '../src/planner/gradeImport/importedAchievementCalculations.ts';

const offerings = new Map(catalog.offerings.map(offering => [offering.id, offering]));
const media = '0b6b9446-84e9-4cb8-ae25-fb8d9f0a14a7';
const normal = '4665ac74-5557-498c-85b9-39307778608c';
const name = '行政法(前期メディア)';
const source = Object.freeze({ id: 'source', rawName: name, selectedOfferingId: null, selectionSource: 'none' });
const other = Object.freeze({ ...source, id: 'other' });
const detail = (id, year, term, patch = {}) => Object.freeze({
  id, rawName: name, sourceCourseId: source.id, method: 'schooling', academicYear: year,
  rawYear: String(year), rawTerm: term, offeringId: null, match: 'unmatched', ...patch,
});
const ambiguous25 = detail('uuid-2025', 2025, '前期');
const ambiguous24 = detail('uuid-2024', 2024, '前期');
const native26 = detail('uuid-2026', 2026, '前期メディア', { offeringId: media, match: 'exact_unique' });
const project = (records, rows = [source], ids = [source.id]) =>
  unresolvedMediaReviewDetails(Object.freeze(records), Object.freeze(rows), offerings, new Set(ids));

test('mixed media keeps only the unresolved sibling UUID, never the native detail', () => {
  const records = [ambiguous25, native26];
  assert.deepEqual(project(records), [ambiguous25]);
  assert.deepEqual(project([ambiguous25, ambiguous24, native26]), [ambiguous25, ambiguous24]);
  assert.deepEqual(project([ambiguous25]), []);
  assert.deepEqual(project([native26, detail('other-native', 2025, 'メ')]), []);
  assert.deepEqual(project(records, [source], []), []);
  assert.equal(ambiguous25.offeringId, null);
  assert.equal(source.selectedOfferingId, null);
});

test('same-name different source and known non-media do not become ambiguous siblings', () => {
  const otherNative = detail('uuid-other', 2026, '前期メディア', { sourceCourseId: other.id });
  assert.deepEqual(project([ambiguous25, otherNative], [source, other], [source.id, other.id]), []);
  assert.deepEqual(project([detail('known-normal', 2026, '春期', { offeringId: normal, match: 'exact_unique' }), native26]), []);
  const differentYear = detail('different-year', 2025, '春期', { offeringId: normal, match: 'exact_unique' });
  assert.deepEqual(project([differentYear, native26]), [differentYear]);
});
