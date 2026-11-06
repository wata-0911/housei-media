import test from 'node:test';
import assert from 'node:assert/strict';
import pendingState from './fixtures/work-e-save/synthetic-pending.json' with { type: 'json' };
import orphanState from './fixtures/work-e-save/synthetic-orphan.json' with { type: 'json' };
import { catalog, offeringsById } from '../src/planner/catalog/catalog.ts';
import { deriveImportedAchievements } from '../src/planner/gradeImport/importedAchievementCalculations.ts';
import { mediaConfirmationPatch } from '../src/planner/gradeImport/mediaConfirmation.ts';

const derive = state => deriveImportedAchievements(state.importedStudyRecords, offeringsById, state.items,
  state.importedCourseAchievements, catalog, state.selectedScopeId);
const rows = pendingState.importedCourseAchievements;
const [row] = rows;
const waiting = derive(pendingState).mediaPending;
const orphan = derive(orphanState).mediaPending;
const raw = JSON.stringify(pendingState);
const request = { sourceCourseId: row.id, offeringId: waiting[0].candidates[0].id, reviewedRaw: raw };
const apply = (q, owners = rows, current = raw, candidates = waiting) => mediaConfirmationPatch(q, current, owners, candidates, []);
test('explicit media confirmation returns only the existing association fields', () => {
  for (const offering of waiting[0].candidates) {
    assert.deepEqual(apply({ ...request, offeringId: offering.id }), {
      selectedOfferingId: offering.id, courseId: row.courseId, selectionSource: 'manual', match: 'exact_unique',
    });
  }
});
test('update entry refuses missing and ambiguous owners even when the UI supplies a real offering', () => {
  assert.equal(apply(request, []), null);
  assert.equal(apply(request, [row, row]), null);
  assert.equal(apply({ ...request, sourceCourseId: orphan[0].sourceCourseId, offeringId: orphan[0].candidates[0].id },
    rows, raw, [...waiting, ...orphan]), null);
});
test('update entry refuses manual and legacy already-confirmed owners', () => {
  for (const selectionSource of ['manual', undefined]) {
    assert.equal(apply(request, [{ ...row, selectedOfferingId: request.offeringId, selectionSource }]), null);
  }
});
test('stale review, changed candidate list and another row’s offering are rejected', () => {
  assert.equal(apply(request, rows, raw + ' '), null);
  assert.equal(apply(request, rows, raw, [{ ...waiting[0], candidates: waiting[0].candidates.slice(1) }]), null);
  assert.equal(apply({ ...request, offeringId: orphan[0].candidates[0].id }, rows, raw, [...waiting, ...orphan]), null);
  assert.equal(apply({ ...request, offeringId: '' }), null);
});
