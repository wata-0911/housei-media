import test from 'node:test';
import assert from 'node:assert/strict';
import { applyImport, importPreview, revalidateImportIdentity } from '../src/planner/gradeImportApply.ts';
import { initialState, saveState, loadState, STORAGE_KEY, BACKUP_KEY } from '../src/planner/storage.ts';
import { catalog } from '../src/planner/catalog.ts';
import { validateState } from '../src/planner/validation.ts';
import { createPlannerBackup, parsePlannerBackup } from '../src/planner/plannerBackup.ts';
import { restorePlannerBackup } from '../src/planner/plannerBackupStorage.ts';
import { plannerItemFromCourseSearch } from '../src/planner/plannerItemState.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GradeImportPreviewUnit, GradeImportApplyActions } from '../src/components/planner/GradeImportPanel.tsx';

const numeric = value => ({ raw: value === null ? '' : String(value), value });
const emptySlot = () => ({ rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null });
function fixture(date = '2020-07-01', earned = 4) {
  return { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-12T00:00:00.000Z', courses: [{
    rawName: '論理学', categoryRaw: '人文', compositionCredits: numeric(4), earnedCredits: numeric(earned),
    schoolingCredits: numeric(null), recognizedExemption: numeric(null), additionalEnrollment: numeric(null),
    reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
    creditExam: { rawDate: date?.replaceAll('-', '/') ?? '', date, rawCredits: '4', credits: 4, rawGrade: 'A', grade: 'A', pendingMarker: false },
    schoolings: [emptySlot(), emptySlot()],
  }] };
}
const preview = (data, state, offerings = []) => importPreview(data, offerings, state.importedStudyRecords, state.importedCourseAchievements);
const imported = (data = fixture()) => applyImport(initialState(), importPreview(data, []), []);

test('identity P1: a different exam year cannot overwrite official 4 credits with 2', () => {
  const before = imported();
  const units = preview(fixture('2021-07-01', 2), before);
  const after = applyImport(before, units, []);
  assert.equal(after.importedCourseAchievements[0].earnedCreditsTotal, 4);
  assert.equal(after, before);
  assert.ok(units.every(unit => !unit.selected && unit.sourceIdentityConflict));
});

test('identity P1: matching fingerprint without dated evidence cannot authorize aggregate changes', () => {
  const before = imported(fixture(null));
  const units = preview(fixture(null, 2), before);
  assert.equal(units[0].sourceCourse.fingerprint, before.importedCourseAchievements[0].fingerprint);
  assert.equal(applyImport(before, units, []), before);
  assert.ok(units.every(unit => unit.sourceIdentityConflict && !unit.selected));
});

function assertHeld(before, data) {
  const snapshot = structuredClone(before);
  const units = preview(data, before, catalog.offerings);
  assert.ok(units.every(unit => unit.sourceIdentityConflict && !unit.selected && !unit.sourceDuplicate && unit.sourceExistingId === null));
  assert.ok(revalidateImportIdentity(before, units).every(unit => unit.sourceIdentityReason === 'preview-held'));
  assert.equal(applyImport(before, units, catalog.offerings), before);
  // Forge selection AND clear preview flags: current-state identity still rejects.
  const forced = units.map(unit => ({ ...unit, selected: true, sourceIdentityConflict: false, sourceYearConflict: false }));
  assert.ok(revalidateImportIdentity(before, forced).every(unit => unit.sourceIdentityReason === 'unproven-source-identity'));
  assert.equal(applyImport(before, forced, catalog.offerings), before);
  assert.deepEqual(before, snapshot);
  return units;
}

for (const date of ['2020-08-01', '2021-07-01', null]) test(`identity: changed/missing exam ${date} is held even with equal totals`, () => {
  assertHeld(imported(), fixture(date));
});

test('identity: changed report dates without explicit schooling year are held', () => {
  const data = fixture(null);
  data.courses[0].reports[0] = { raw: '○2020/07/01', date: '2020-07-01', status: 'passed' };
  const before = imported(data);
  data.courses[0].reports[0] = { raw: '○2021/07/01', date: '2021-07-01', status: 'passed' };
  assertHeld(before, data);
});

test('identity: exact JSON and capture-only changes remain whole-state no-ops', () => {
  const before = imported();
  for (const capturedAt of ['2026-10-12T00:00:00.000Z', '2035-02-01T00:00:00.000Z']) {
    const data = { ...fixture(), capturedAt };
    assert.equal(applyImport(before, preview(data, before), []), before);
  }
});

test('identity: a dated result refresh updates one component and preserves manual ownership', () => {
  const before = imported();
  const offering = catalog.offerings.find(row => row.name === '論理学' && row.method === 'correspondence');
  assert.ok(offering);
  Object.assign(before.importedCourseAchievements[0], { selectionSource: 'manual', selectedOfferingId: offering.id, courseId: offering.courseId,
    academicYear: 2019, yearSource: 'manual', match: 'exact_unique', candidateOfferingIds: [offering.id] });
  before.items.push({ ...plannerItemFromCourseSearch(offering.id), status: 'in_progress', plannedYear: 2028 });
  before.courseEvaluations[offering.id] = { offeringId: offering.id, finalGrade: 'B', reportGrade: null, schoolingGrade: null };
  before.correspondenceProgress[offering.id] = { offeringId: offering.id, requiredReports: 2, reports: [{ reportNumber: 1, status: 'passed', grade: 'A' }], examGrade: 'S' };
  before.importedCourseUserMeta[before.importedCourseAchievements[0].id] = { lifecycleStatus: 'in_progress', plannedYear: 2028, plannedTerm: '後期', studyYear: 3 };
  const snapshot = structuredClone(before);
  assertHeld(before, fixture('2021-07-01', 2));
  const data = fixture('2020-07-01', 2);
  data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S';
  const units = preview(data, before);
  assert.ok(units.every(unit => !unit.sourceIdentityConflict && unit.selected));
  const after = applyImport(before, units, []);
  assert.equal(after.importedCourseAchievements.length, 1);
  assert.equal(after.importedCourseAchievements[0].earnedCreditsTotal, 2);
  for (const key of ['id', 'academicYear', 'yearSource', 'selectionSource', 'selectedOfferingId', 'courseId']) {
    assert.equal(after.importedCourseAchievements[0][key], before.importedCourseAchievements[0][key]);
  }
  assert.equal(after.importedStudyRecords.length, 1);
  assert.equal(after.importedStudyRecords[0].id, before.importedStudyRecords[0].id);
  assert.equal(after.importedStudyRecords[0].grade, 'S');
  for (const key of ['items', 'courseEvaluations', 'correspondenceProgress', 'importedCourseUserMeta']) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(before, snapshot);
  assert.equal(validateState(after, catalog), true);
});

test('identity: nonduplicate schooling component is added while official totals remain independent', () => {
  const before = imported();
  const data = fixture();
  data.courses[0].schoolings[0] = { ...emptySlot(), rawTerm: '夏', term: '夏', rawDate: '2020/08/01', date: '2020-08-01', rawCredits: '2', credits: 2, rawGrade: 'B', grade: 'B' };
  const after = applyImport(before, preview(data, before), []);
  assert.equal(after.importedCourseAchievements.length, 1);
  assert.equal(after.importedCourseAchievements[0].earnedCreditsTotal, 4);
  assert.equal(after.importedCourseAchievements[0].schoolingCreditsTotal, null);
  assert.deepEqual(after.importedStudyRecords.map(row => row.method), ['correspondence', 'schooling']);
  assert.deepEqual(after.importedStudyRecords[0], before.importedStudyRecords[0]);
  assert.equal(applyImport(after, preview(data, after), []), after);
});

test('identity: a dated schooling result refresh retains its slot and official row', () => {
  const data = fixture(null);
  data.courses[0].creditExam = { rawDate: '', date: null, rawCredits: '', credits: null, rawGrade: '', grade: null, pendingMarker: false };
  data.courses[0].schoolings[0] = { ...emptySlot(), rawYear: '20', year: '20', rawTerm: '夏', term: '夏', rawDate: '2020/08/01', date: '2020-08-01', rawCredits: '2', credits: 2, rawGrade: 'B', grade: 'B' };
  const before = imported(data);
  data.courses[0].schoolings[0].rawGrade = 'A'; data.courses[0].schoolings[0].grade = 'A';
  const after = applyImport(before, preview(data, before), []);
  assert.equal(after.importedCourseAchievements.length, 1);
  assert.equal(after.importedStudyRecords.length, 1);
  assert.equal(after.importedStudyRecords[0].id, before.importedStudyRecords[0].id);
  assert.equal(after.importedStudyRecords[0].grade, 'A');
  assert.equal(after.importedCourseAchievements[0].earnedCreditsTotal, 4);
});

test('identity: same dated report status can refresh with an unchanged exam anchor', () => {
  const data = fixture();
  data.courses[0].reports[0] = { raw: '△2020/06/01', date: '2020-06-01', status: 'processing' };
  const before = imported(data);
  data.courses[0].reports[0] = { raw: '○2020/06/01', date: '2020-06-01', status: 'passed' };
  const after = applyImport(before, preview(data, before), []);
  assert.equal(after.importedStudyRecords.length, 1);
  assert.equal(after.importedStudyRecords[0].reports[0].status, 'passed');
});

test('identity: dated pending exam can finalize with unchanged numeric component credits', () => {
  const data = fixture('2020-07-01', 0);
  Object.assign(data.courses[0].creditExam, { rawCredits: '*4', rawGrade: '', grade: null, pendingMarker: true });
  const before = imported(data);
  const after = applyImport(before, preview(fixture(), before), []);
  assert.equal(after.importedCourseAchievements.length, 1);
  assert.equal(after.importedCourseAchievements[0].earnedCreditsTotal, 4);
  assert.equal(after.importedStudyRecords.length, 1);
  assert.equal(after.importedStudyRecords[0].id, before.importedStudyRecords[0].id);
  assert.equal(after.importedStudyRecords[0].grade, 'A');
});

for (const field of ['examDate', 'date']) test(`identity apply guard: contradictory ${field} cannot attach another date to a proven source`, () => {
  const before = imported();
  const units = preview(fixture('2020-07-01', 2), before);
  units[0][field] = '2021-07-01';
  assert.ok(revalidateImportIdentity(before, units).every(unit => unit.sourceIdentityReason === 'contradictory-component-date'));
  assert.equal(applyImport(before, units, []), before);
});

test('identity: contract-valid raw/parsed date contradiction is held in preview', () => {
  const before = imported(); const data = fixture('2020-07-01', 2);
  data.courses[0].creditExam.date = '2021-07-01';
  const units = preview(data, before);
  assert.ok(units.every(unit => unit.sourceIdentityConflict && unit.sourceIdentityReason === 'contradictory-component-date'));
  assert.equal(applyImport(before, units, []), before);
});

test('identity: an impossible raw date is not an update anchor', () => {
  const data = fixture(null); data.courses[0].creditExam.rawDate = '2020/02/31';
  const before = imported(data);
  data.courses[0].earnedCredits = numeric(2);
  assertHeld(before, data);
});

for (const variant of ['saved multiple', 'incoming multiple', 'different category', 'different method', 'different composition', 'legacy fingerprint']) {
  test(`identity: ${variant} does not justify a name-based update/addition`, () => {
    const first = fixture();
    if (variant === 'saved multiple') first.courses.push(fixture('2019-07-01').courses[0]);
    const before = imported(first);
    const data = fixture('2020-07-01', 2);
    if (variant === 'incoming multiple') data.courses.push(structuredClone(data.courses[0]));
    if (variant === 'different category') data.courses[0].categoryRaw = '専門';
    if (variant === 'different composition') data.courses[0].compositionCredits = numeric(2);
    if (variant === 'legacy fingerprint') before.importedCourseAchievements[0].fingerprint = 'legacy-source';
    if (variant === 'different method') {
      data.courses[0].creditExam = { rawDate: '', date: null, rawCredits: '', credits: null, rawGrade: '', grade: null, pendingMarker: false };
      data.courses[0].schoolings[0] = { ...emptySlot(), rawDate: '2020/07/01', date: '2020-07-01', rawCredits: '4', credits: 4 };
    }
    assertHeld(before, data);
  });
}

test('identity: scope/catalog identity cannot authorize a changed historical row', () => {
  const before = imported();
  for (const scope of catalog.programs.filter(row => !row.isCommon)) {
    const scoped = { ...before, selectedScopeId: scope.scopeId };
    assertHeld(scoped, fixture('2021-07-01', 2));
  }
});

for (const [variant, reason] of [['wrong id', 'invalid-source-reference'], ['missing id', 'stale-source-reference'], ['missing snapshot', 'stale-source-reference'], ['stale state', 'stale-source-reference'], ['mixed source', 'inconsistent-source-group'], ['wrong parent', 'inconsistent-source-group']]) {
  test(`identity apply guard: ${variant} is rejected by the identity guard itself`, () => {
    const before = imported();
    let units = preview(fixture('2020-07-01', 2), before);
    assert.ok(units.every(unit => unit.selected && !unit.sourceIdentityConflict));
    if (variant === 'wrong id') units[0].sourceExistingId = 'not-the-source';
    if (variant === 'missing id') units[0].sourceExistingId = null;
    if (variant === 'missing snapshot') delete units[0].sourceExistingSnapshot;
    if (variant === 'stale state') before.importedCourseAchievements[0].earnedCreditsTotal = 3;
    if (variant === 'wrong parent') units[0].sourceCourseId = 'not-the-parent';
    if (variant === 'mixed source') units = [...units, { ...units[0], sourceCourse: { ...units[0].sourceCourse, earnedCreditsTotal: 3 } }];
    assert.equal(validateState(before, catalog), true);
    assert.ok(revalidateImportIdentity(before, units).every(unit => unit.sourceIdentityReason === reason));
    assert.equal(applyImport(before, units, catalog.offerings), before);
  });
}

test('identity apply guard: a stale new-row preview cannot duplicate or roll back official credits', () => {
  const units = importPreview(fixture(), []);
  const saved = applyImport(initialState(), units, []);
  assert.equal(applyImport(saved, units, []), saved);
  const newer = applyImport(saved, preview(fixture('2020-07-01', 2), saved), []);
  assert.ok(revalidateImportIdentity(newer, units).every(unit => unit.sourceIdentityReason === 'stale-source-reference'));
  assert.equal(applyImport(newer, units, []), newer);
});

test('identity: held UI disables selection and apply and explains preserved official values', () => {
  const units = assertHeld(imported(), fixture('2021-07-01', 2));
  const html = renderToStaticMarkup(createElement(GradeImportPreviewUnit, { unit: units[0], onChange() {} }));
  assert.match(html, /要確認/); assert.match(html, /公式単位や元の記録は変更しません/);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*disabled=""/);
  const actions = renderToStaticMarkup(createElement(GradeImportApplyActions, { units: units.map(unit => ({ ...unit, selected: true })), plannedItems: [], offerings: catalog.offerings, disabled: false, onApply() {} }));
  assert.match(actions, /<button[^>]*disabled=""/);
});

for (const total of [null, 0, 4]) test(`identity persistence: v22 save/reload, reimport/save and backup/restore preserve ${total}`, async () => {
  const data = fixture('2020-07-01', total);
  const before = imported(data);
  const values = new Map([[BACKUP_KEY, 'original recovery bytes']]);
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const raw = saveState(store, before, null, catalog);
  const loaded = loadState(store, catalog);
  assert.equal(loaded.error, null); assert.deepEqual(loaded.state, before);
  assert.equal(loaded.state.schemaVersion, 22);
  assertHeld(loaded.state, fixture('2021-07-01', 2));
  const noOp = applyImport(loaded.state, preview(data, loaded.state), []);
  assert.equal(noOp, loaded.state);
  assert.equal(saveState(store, noOp, raw, catalog), raw);
  assert.equal(store.getItem(STORAGE_KEY), raw);
  const text = JSON.stringify(await createPlannerBackup(raw, catalog));
  assert.deepEqual((await parsePlannerBackup(text, catalog)).state, before);
  const restored = await restorePlannerBackup(store, text, raw, catalog, { request: async (_name, _options, callback) => callback() });
  assert.deepEqual(restored.state, before);
  assert.equal(store.getItem(BACKUP_KEY), 'original recovery bytes');
  assert.equal(applyImport(restored.state, preview(data, restored.state), []), restored.state);
  assertHeld(restored.state, fixture('2021-07-01', 2));
  values.set(STORAGE_KEY, 'another tab original');
  assert.throws(() => saveState(store, before, raw, catalog), /別の画面/);
  await assert.rejects(restorePlannerBackup(store, text, raw, catalog, { request: async (_name, _options, callback) => callback() }), /変更/);
  assert.equal(store.getItem(STORAGE_KEY), 'another tab original');
});
