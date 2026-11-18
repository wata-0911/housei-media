import test from 'node:test';
import assert from 'node:assert/strict';
import { applyImport, importPreview, revalidateImportIdentity } from '../src/planner/gradeImport/gradeImportApply.ts';
import { initialState, saveState, loadState, STORAGE_KEY, BACKUP_KEY } from '../src/planner/backup/storage.ts';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { validateState } from '../src/planner/validation.ts';
import { createPlannerBackup, parsePlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { restorePlannerBackup } from '../src/planner/backup/plannerBackupStorage.ts';
import { plannerItemFromCourseSearch } from '../src/planner/planning/plannerItemState.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GradeImportPreviewUnit, GradeImportApplyActions } from '../src/components/planner/gradeImport/GradeImportPanel.tsx';
import ImportedStudyRecordEditor from '../src/components/planner/gradeImport/ImportedStudyRecordEditor.tsx';
import { ImportedManagementRows } from '../src/components/planner/gradeImport/ImportedAchievements.tsx';
import { deriveImportedAchievements } from '../src/planner/gradeImport/importedAchievementCalculations.ts';

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

function splitFixture() {
  const data = fixture();
  Object.assign(data.courses[0].creditExam, { rawCredits: '2', credits: 2 });
  data.courses[0].schoolingCredits = numeric(2);
  data.courses[0].schoolings[0] = { ...emptySlot(), rawYear: '20', year: '20', rawTerm: '夏', term: '夏', rawDate: '2020/08/01', date: '2020-08-01', rawCredits: '2', credits: 2, rawGrade: 'A', grade: 'A' };
  return data;
}
function changedSplitFixture() {
  const data = splitFixture(); data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S'; return data;
}

test('P2 partial: an unselected changed correspondence must hold the entire official source', () => {
  const before = imported(splitFixture());
  const units = preview(changedSplitFixture(), before).map(unit => ({ ...unit, selected: unit.method === 'schooling' }));
  const after = applyImport(before, units, []);
  assert.equal(after, before, 'the parent fingerprint and both independent component snapshots must remain unchanged');
});

test('P2 partial: partial attempt then full reimport must allow the legitimate official 4 to 2 correction', () => {
  const before = imported(splitFixture()); const data = changedSplitFixture();
  const partial = applyImport(before, preview(data, before).map(unit => ({ ...unit, selected: unit.method === 'schooling' })), []);
  const full = applyImport(partial, preview(data, partial), []);
  const correction = structuredClone(data); correction.courses[0].earnedCredits = numeric(2);
  const final = applyImport(full, preview(correction, full), []);
  assert.equal(final.importedCourseAchievements[0].earnedCreditsTotal, 2);
  assert.equal(final.importedStudyRecords.length, 2);
  assert.deepEqual(final.importedStudyRecords.map(record => [record.method, record.grade, record.credits]), [['correspondence', 'S', 2], ['schooling', 'A', 2]]);
});

for (const changed of ['correspondence', 'schooling', 'both']) test(`P2 partial: unchecked ${changed} refresh holds native snapshots and offers actionable UI`, () => {
  const before = imported(splitFixture()); const snapshot = structuredClone(before); const data = splitFixture();
  if (changed !== 'schooling') Object.assign(data.courses[0].creditExam, { rawGrade: 'S', grade: 'S' });
  if (changed !== 'correspondence') Object.assign(data.courses[0].schoolings[0], { rawGrade: 'S', grade: 'S' });
  const units = preview(data, before).map(unit => ({ ...unit, selected: unit.method !== (changed === 'both' ? 'correspondence' : changed) }));
  assert.ok(revalidateImportIdentity(before, units).every(unit => unit.sourceIdentityReason === 'incomplete-source-selection'));
  assert.equal(applyImport(before, units, []), before); assert.deepEqual(before, snapshot);
  const html = renderToStaticMarkup(createElement(GradeImportApplyActions, { units, plannedItems: [], offerings: [], disabled: false, onApply() {} }));
  assert.match(html, /更新が必要な保存済み内訳が選択されていない/); assert.match(html, /<button[^>]*disabled/);
  const checkbox = renderToStaticMarkup(createElement(GradeImportPreviewUnit, { unit: units[0], onChange() {} }));
  assert.doesNotMatch(checkbox, /<input[^>]*type="checkbox"[^>]*disabled/);
  const full = applyImport(before, units.map(unit => ({ ...unit, selected: true })), []);
  assert.equal(full.importedStudyRecords.length, 2);
});

for (const variant of ['omitted detail', 'forged required flag']) test(`P2 partial guard: ${variant} cannot bypass atomic selection`, () => {
  const before = imported(splitFixture()); let units = preview(changedSplitFixture(), before);
  units = variant === 'omitted detail' ? units.filter(unit => unit.method === 'schooling')
    : units.map(unit => ({ ...unit, sourceComponentUpdateRequired: false, duplicate: true, selected: unit.method === 'schooling' }));
  assert.ok(revalidateImportIdentity(before, units).every(unit => unit.sourceIdentityReason === 'incomplete-source-selection'));
  assert.equal(applyImport(before, units, []), before);
});

test('P2 partial guard: colliding proposal IDs cannot hide a required component refresh', () => {
  const before = imported(splitFixture()); const units = preview(changedSplitFixture(), before);
  units[0].selected = false; units[1].id = units[0].id;
  assert.ok(revalidateImportIdentity(before, units).every(unit => unit.sourceIdentityReason === 'inconsistent-source-group'));
  assert.equal(applyImport(before, units, []), before);
});

test('P2 partial: unchecked bounded year completion holds the source instead of abandoning the old snapshot', () => {
  const data = splitFixture(); data.courses[0].schoolings[0].rawYear = ''; data.courses[0].schoolings[0].year = null;
  const before = imported(data); const units = preview(splitFixture(), before);
  assert.equal(units.find(unit => unit.method === 'schooling').sourceComponentUpdateRequired, true);
  const partial = units.map(unit => ({ ...unit, selected: unit.method === 'correspondence' }));
  assert.ok(revalidateImportIdentity(before, partial).every(unit => unit.sourceIdentityReason === 'incomplete-source-selection'));
  assert.equal(applyImport(before, partial, []), before);
  const full = applyImport(before, units, []);
  assert.equal(full.importedStudyRecords.length, 3, 'bounded source-year history path is preserved');
  assert.equal(applyImport(full, preview(splitFixture(), full), []), full);
});

test('P2 partial: unchanged owned detail can stay unchecked during grade and aggregate refreshes', () => {
  const before = imported(splitFixture()); const data = changedSplitFixture();
  const after = applyImport(before, preview(data, before).map(unit => ({ ...unit, selected: unit.method === 'correspondence' })), []);
  assert.equal(after.importedStudyRecords[0].grade, 'S'); assert.equal(after.importedStudyRecords[1], before.importedStudyRecords[1]);
  data.courses[0].earnedCredits = numeric(2);
  const final = applyImport(after, preview(data, after).map(unit => ({ ...unit, selected: unit.method === 'schooling' })), []);
  assert.equal(final.importedCourseAchievements[0].earnedCreditsTotal, 2);
  assert.deepEqual(final.importedStudyRecords, after.importedStudyRecords);
  assert.equal(applyImport(final, preview(data, final), []), final);
});

test('P2 partial: an unchecked genuinely new slot remains optional and can later be imported safely', () => {
  const data = splitFixture(); data.courses[0].schoolings[0] = emptySlot();
  const before = imported(data); const next = splitFixture();
  const partial = applyImport(before, preview(next, before).map(unit => ({ ...unit, selected: unit.method === 'correspondence' })), []);
  assert.equal(partial.importedStudyRecords.length, 1);
  next.courses[0].earnedCredits = numeric(2);
  const final = applyImport(partial, preview(next, partial), []);
  assert.equal(final.importedCourseAchievements[0].earnedCreditsTotal, 2); assert.equal(final.importedStudyRecords.length, 2);
});

test('P2 partial: holding one source preserves manual owners and permits an unrelated import', () => {
  const before = imported(splitFixture());
  Object.assign(before.importedStudyRecords[0], { academicYear: 2019, yearSource: 'manual', term: '手動期' });
  const snapshot = structuredClone(before); const data = changedSplitFixture();
  data.courses.push({ ...structuredClone(fixture().courses[0]), rawName: '合成の別科目' });
  const units = preview(data, before).map(unit => ({ ...unit, selected: !(unit.rawName === '論理学' && unit.method === 'correspondence') }));
  const after = applyImport(before, units, []);
  assert.equal(after.importedCourseAchievements.length, 2); assert.equal(after.importedStudyRecords.length, 3);
  assert.deepEqual(after.importedCourseAchievements[0], before.importedCourseAchievements[0]);
  assert.deepEqual(after.importedStudyRecords.slice(0, 2), before.importedStudyRecords); assert.deepEqual(before, snapshot);
});

test('P2 partial persistence: full correction preserves manual context through save, reload and backup restore', async () => {
  const before = imported(splitFixture()); Object.assign(before.importedStudyRecords[0], { academicYear: 2019, yearSource: 'manual', term: '手動期' });
  const values = new Map([[BACKUP_KEY, 'original recovery bytes']]);
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const oldRaw = saveState(store, before, null, catalog);
  const data = changedSplitFixture();
  const partial = applyImport(before, preview(data, before).map(unit => ({ ...unit, selected: unit.method === 'schooling' })), []);
  assert.equal(partial, before);
  const full = applyImport(partial, preview(data, partial), []); data.courses[0].earnedCredits = numeric(2);
  const after = applyImport(full, preview(data, full), []); const raw = saveState(store, after, oldRaw, catalog);
  assert.deepEqual(loadState(store, catalog).state, after);
  const text = JSON.stringify(await createPlannerBackup(raw, catalog));
  assert.deepEqual((await parsePlannerBackup(text, catalog)).state, after);
  const restored = await restorePlannerBackup(store, text, raw, catalog, { request: async (_name, _options, callback) => callback() });
  assert.deepEqual(restored.state, after); assert.equal(store.getItem(BACKUP_KEY), 'original recovery bytes');
  assert.equal(applyImport(restored.state, preview(data, restored.state), []), restored.state);
  assert.equal(restored.state.importedStudyRecords.length, 2); assert.equal(restored.state.importedStudyRecords[0].academicYear, 2019);
});

test('P2 partial recovery: contradictory prior snapshots are held; a trusted consistent backup permits full refresh', async () => {
  const before = imported(splitFixture()); const data = changedSplitFixture();
  const broken = structuredClone(before);
  broken.importedCourseAchievements[0].fingerprint = preview(data, before)[0].sourceCourse.fingerprint;
  const values = new Map(); const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const trustedRaw = saveState(store, before, null, catalog); const backup = JSON.stringify(await createPlannerBackup(trustedRaw, catalog));
  const brokenRaw = saveState(store, broken, trustedRaw, catalog);
  assert.equal(applyImport(broken, preview(data, broken), []), broken, 'identical content must not guess a repair');
  data.courses[0].earnedCredits = numeric(2); assertComponentHeld(broken, data);
  const restored = await restorePlannerBackup(store, backup, brokenRaw, catalog, { request: async (_name, _options, callback) => callback() });
  const final = applyImport(restored.state, preview(data, restored.state), []);
  assert.equal(final.importedCourseAchievements[0].earnedCreditsTotal, 2); assert.equal(final.importedStudyRecords[0].grade, 'S');
  assert.equal(final.importedStudyRecords.length, 2);
});

test('P2 component: manual year correction does not duplicate a same-exam grade refresh', () => {
  const before = imported();
  Object.assign(before.importedStudyRecords[0], { academicYear: 2019, yearSource: 'manual', term: '手動の期' });
  const data = fixture(); data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S';
  const after = applyImport(before, preview(data, before), []);
  assert.equal(after.importedStudyRecords.length, 1);
  assert.equal(after.importedStudyRecords[0].id, before.importedStudyRecords[0].id);
  assert.equal(after.importedStudyRecords[0].academicYear, 2019);
  assert.equal(after.importedStudyRecords[0].yearSource, 'manual');
  assert.equal(after.importedStudyRecords[0].term, '手動の期');
  assert.equal(after.importedStudyRecords[0].grade, 'S');
});

test('P2 aggregate: an aggregate-only refresh presents current official 2 and identifies snapshot 4 as history', () => {
  const before = imported();
  const data = fixture('2020-07-01', 2);
  const units = preview(data, before);
  assert.equal(units[0].sourceCourse.fingerprint, before.importedCourseAchievements[0].fingerprint);
  const after = applyImport(before, units, []);
  assert.equal(after.importedCourseAchievements[0].earnedCreditsTotal, 2);
  assert.equal(after.importedStudyRecords[0].earnedCreditsTotal, 4, 'keep the original snapshot as history');
  assert.deepEqual(after.importedStudyRecords, before.importedStudyRecords);
  const html = renderToStaticMarkup(createElement(ImportedStudyRecordEditor, { record: after.importedStudyRecords[0], sourceRows: after.importedCourseAchievements, offerings: [], disabled: false, onChange() {}, onDelete() {} }));
  assert.match(html, /現在の公式集計[^<]*修得単位 2/);
  assert.match(html, /取込時の集計（履歴）[^<]*修得単位 4/);
});

for (const manualYear of [2019, null]) test(`P2 component: manual year ${manualYear} survives refresh and subsequent identical imports`, () => {
  const before = imported();
  Object.assign(before.importedStudyRecords[0], { academicYear: manualYear, yearSource: 'manual', term: '手動期' });
  const snapshot = structuredClone(before);
  assert.equal(applyImport(before, preview(fixture(), before), []), before);
  const data = fixture(); data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S';
  const after = applyImport(before, preview(data, before), []);
  assert.equal(after.importedStudyRecords.length, 1);
  assert.equal(after.importedStudyRecords[0].academicYear, manualYear);
  assert.equal(after.importedStudyRecords[0].yearSource, 'manual');
  assert.equal(applyImport(after, preview(data, after), []), after);
  assert.deepEqual(before, snapshot);
});

test('P2 component: manually corrected year cannot merge a different exam date', () => {
  const before = imported();
  Object.assign(before.importedStudyRecords[0], { academicYear: 2019, yearSource: 'manual' });
  assertHeld(before, fixture('2021-07-01'));
});

function assertComponentHeld(before, data) {
  const snapshot = structuredClone(before);
  const units = preview(data, before);
  assert.ok(units.every(unit => unit.sourceIdentityConflict && !unit.selected && unit.sourceIdentityReason === 'unproven-component-identity'));
  assert.equal(applyImport(before, units, []), before);
  const forced = units.map(unit => ({ ...unit, sourceIdentityConflict: false, sourceYearConflict: false, selected: true,
    sourceExistingId: before.importedCourseAchievements[0].id, sourceExistingSnapshot: JSON.stringify(before.importedCourseAchievements[0]) }));
  assert.ok(revalidateImportIdentity(before, forced).every(unit => unit.sourceIdentityReason === 'unproven-component-identity'));
  assert.equal(applyImport(before, forced, []), before);
  assert.deepEqual(before, snapshot);
  return units;
}

for (const variant of ['duplicate anchor', 'legacy fingerprint', 'missing parent', 'legacy capture date', 'contradictory exam date', 'contradictory prior grade']) test(`P2 component guard: ${variant} is held without updating or appending`, () => {
  const before = imported(); const record = before.importedStudyRecords[0];
  if (variant === 'duplicate anchor') before.importedStudyRecords.push({ ...record, id: 'second-component', academicYear: 2019, yearSource: 'manual' });
  if (variant === 'legacy fingerprint') record.fingerprint = 'v22-legacy-component';
  if (variant === 'missing parent') delete record.sourceCourseId;
  if (variant === 'legacy capture date') { record.date = '2026-10-12'; delete record.examDate; record.fingerprint = JSON.stringify([record.rawName, record.method, record.rawYear, record.rawTerm, record.date, record.credits, record.grade, record.reports.map(r => r.raw), record.examGrade]); }
  if (variant === 'contradictory exam date') record.examDate = '2021-07-01';
  if (variant === 'contradictory prior grade') { record.grade = 'B'; record.examGrade = 'B'; record.fingerprint = JSON.stringify([record.rawName, record.method, record.rawYear, record.rawTerm, record.date, record.credits, record.grade, record.reports.map(r => r.raw), record.examGrade]); }
  assert.equal(validateState(before, catalog), true, 'state is accepted before the identity guard is invoked');
  const data = fixture(); data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S';
  assertComponentHeld(before, data);
});

test('P2 component guard: an incoming collision cannot be made unique by deselection', () => {
  const before = imported(); const data = fixture();
  data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S';
  const units = preview(data, before);
  const conflicting = [...units, { ...units[0], id: 'competing-incoming', selected: false }];
  assert.ok(revalidateImportIdentity(before, conflicting).every(unit => unit.sourceIdentityReason === 'unproven-component-identity'));
  assert.equal(applyImport(before, conflicting, []), before);
});

test('P2 component guard: a stale duplicate flag cannot suppress a proven grade refresh', () => {
  const before = imported(); const data = fixture();
  data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S';
  const units = preview(data, before).map(unit => ({ ...unit, duplicate: true }));
  assert.ok(revalidateImportIdentity(before, units).every(unit => unit.duplicate === false));
  const after = applyImport(before, units, []);
  assert.equal(after.importedStudyRecords.length, 1); assert.equal(after.importedStudyRecords[0].grade, 'S');
});

test('P2 component guard: a stale undated fingerprint cannot authorize explicit-year addition', () => {
  const before = imported(fixture(null)); before.importedStudyRecords[0].grade = 'B';
  const data = fixture(null);
  data.courses[0].schoolings[0] = { ...emptySlot(), rawYear: '20', year: '20', rawCredits: '2', credits: 2 };
  assertComponentHeld(before, data);
});

test('P2 component: source-backed refresh preserves manual association and progress owners', () => {
  const before = imported(); const offering = catalog.offerings.find(o => o.name === '論理学' && o.method === 'correspondence');
  Object.assign(before.importedStudyRecords[0], { academicYear: 2019, yearSource: 'manual', term: '手動期', offeringId: offering.id, match: 'exact_unique' });
  before.items = [{ ...plannerItemFromCourseSearch(offering.id), status: 'waiting', plannedYear: 2028 }];
  before.courseEvaluations[offering.id] = { offeringId: offering.id, finalGrade: 'B', reportGrade: null, schoolingGrade: null };
  before.correspondenceProgress[offering.id] = { offeringId: offering.id, requiredReports: 2, reports: [{ reportNumber: 1, status: 'passed', grade: 'A' }], examGrade: 'S' };
  const snapshot = structuredClone(before); const data = fixture();
  data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S';
  const after = applyImport(before, preview(data, before), []);
  assert.equal(after.importedStudyRecords.length, 1);
  for (const field of ['id', 'offeringId', 'match', 'academicYear', 'yearSource', 'term']) assert.equal(after.importedStudyRecords[0][field], before.importedStudyRecords[0][field]);
  assert.deepEqual(after.items, before.items);
  assert.equal(after.correspondenceProgress, before.correspondenceProgress); assert.equal(after.courseEvaluations, before.courseEvaluations);
  assert.deepEqual(before, snapshot); assert.equal(validateState(after, catalog), true);
});

test('P2 component: old v22 missing examDate refreshes only from matching native date evidence', () => {
  const before = imported(); delete before.importedStudyRecords[0].examDate;
  Object.assign(before.importedStudyRecords[0], { academicYear: 2019, yearSource: 'manual' });
  const data = fixture(); data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S';
  const after = applyImport(before, preview(data, before), []);
  assert.equal(after.importedStudyRecords.length, 1); assert.equal(after.importedStudyRecords[0].academicYear, 2019);
  assert.equal(after.importedStudyRecords[0].examDate, '2020-07-01');
});

test('P2 component: schooling slots remain distinct while manual years and terms survive a grade refresh', () => {
  const data = fixture();
  data.courses[0].schoolings = [0, 1].map(() => ({ ...emptySlot(), rawYear: '20', year: '20', rawTerm: '夏', term: '夏', rawDate: '2020/08/01', date: '2020-08-01', rawCredits: '2', credits: 2, rawGrade: 'A', grade: 'A' }));
  const before = imported(data);
  Object.assign(before.importedStudyRecords[1], { academicYear: 2019, yearSource: 'manual', term: '手動期' });
  data.courses[0].schoolings[0].rawGrade = 'S'; data.courses[0].schoolings[0].grade = 'S';
  const after = applyImport(before, preview(data, before), []);
  assert.equal(after.importedStudyRecords.length, 3);
  assert.equal(after.importedStudyRecords[1].id, before.importedStudyRecords[1].id);
  assert.equal(after.importedStudyRecords[1].grade, 'S');
  assert.equal(after.importedStudyRecords[1].academicYear, 2019);
  assert.equal(after.importedStudyRecords[1].yearSource, 'manual');
  assert.equal(after.importedStudyRecords[1].term, '手動期');
  assert.deepEqual(after.importedStudyRecords[2], before.importedStudyRecords[2]);
  assert.equal(applyImport(after, preview(data, after), []), after);
});

for (const total of [null, 0, 2]) test(`P2 aggregate: current official ${total} never overwrites intrinsic credits or becomes snapshot budget`, () => {
  const before = imported(); const after = applyImport(before, preview(fixture('2020-07-01', total), before), []);
  assert.equal(after.importedCourseAchievements[0].earnedCreditsTotal, total);
  assert.deepEqual(after.importedStudyRecords, before.importedStudyRecords);
  assert.equal(after.importedStudyRecords[0].credits, 4);
  const derived = deriveImportedAchievements(after.importedStudyRecords, new Map(catalog.offerings.map(o => [o.id, o])), [], after.importedCourseAchievements, catalog);
  assert.equal(derived.categoryOfferings.reduce((sum, o) => sum + o.credits, 0), total ?? 0);
  const html = renderToStaticMarkup(createElement(ImportedManagementRows, { records: after.importedStudyRecords, courseRows: [], sourceRows: after.importedCourseAchievements, offerings: [], disabled: false, onChange() {}, onChangeCourse() {}, onDelete() {} }));
  assert.match(html, new RegExp(`現在の公式集計[^<]*修得単位 ${total ?? '不明'}`));
  assert.match(html, /取込時の集計（履歴）[^<]*修得単位 4/);
  assert.equal(applyImport(after, preview(fixture('2020-07-01', total), after), []), after);
});

for (const variant of ['absent', 'ambiguous', 'wrong name', 'wrong id']) test(`P2 aggregate presentation: ${variant} parent is never inferred from name or snapshot`, () => {
  const before = imported(); const row = before.importedCourseAchievements[0];
  const sourceRows = variant === 'absent' ? [] : variant === 'ambiguous' ? [row, { ...row }] : variant === 'wrong name' ? [{ ...row, rawName: '別科目' }] : [{ ...row, id: 'other-source' }];
  const html = renderToStaticMarkup(createElement(ImportedStudyRecordEditor, { record: before.importedStudyRecords[0], sourceRows, offerings: [], disabled: false, onChange() {}, onDelete() {} }));
  assert.doesNotMatch(html, /現在の公式集計/);
  assert.match(html, /取込時の集計（履歴）/); assert.match(html, /対応未確認/);
});

test('P2 component: a held component collision does not prevent unrelated source import', () => {
  const before = imported(); before.importedStudyRecords[0].fingerprint = 'legacy-ambiguous';
  const snapshot = structuredClone(before);
  const data = fixture(); data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S';
  data.courses.push({ ...structuredClone(fixture().courses[0]), rawName: '合成の別科目' });
  const units = preview(data, before);
  assert.ok(units.filter(u => u.rawName === '論理学').every(u => u.sourceIdentityConflict));
  const after = applyImport(before, units, []);
  assert.equal(after.importedCourseAchievements.length, 2); assert.equal(after.importedStudyRecords.length, 2);
  assert.deepEqual(after.importedCourseAchievements[0], before.importedCourseAchievements[0]);
  assert.deepEqual(after.importedStudyRecords[0], before.importedStudyRecords[0]);
  assert.deepEqual(before, snapshot);
});

for (const scenario of ['manual grade', 'aggregate only']) test(`P2 persistence: ${scenario} survives v22 reload, backup/restore and repeated import`, async () => {
  const before = imported(); Object.assign(before.importedStudyRecords[0], { academicYear: 2019, yearSource: 'manual', term: '手動期' });
  const data = scenario === 'aggregate only' ? fixture('2020-07-01', 2) : fixture();
  if (scenario === 'manual grade') { data.courses[0].creditExam.rawGrade = 'S'; data.courses[0].creditExam.grade = 'S'; }
  const values = new Map([[BACKUP_KEY, 'original recovery bytes']]);
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const oldRaw = saveState(store, before, null, catalog);
  const loadedBefore = loadState(store, catalog); assert.equal(loadedBefore.error, null);
  const after = applyImport(loadedBefore.state, preview(data, loadedBefore.state), []);
  const raw = saveState(store, after, oldRaw, catalog);
  const reloaded = loadState(store, catalog); assert.equal(reloaded.error, null); assert.deepEqual(reloaded.state, after);
  assert.equal(reloaded.state.schemaVersion, 22); assert.equal(after.importedStudyRecords.length, 1);
  assert.equal(after.importedStudyRecords[0].academicYear, 2019);
  const text = JSON.stringify(await createPlannerBackup(raw, catalog));
  assert.deepEqual((await parsePlannerBackup(text, catalog)).state, after);
  const restored = await restorePlannerBackup(store, text, raw, catalog, { request: async (_name, _options, callback) => callback() });
  assert.deepEqual(restored.state, after);
  assert.equal(store.getItem(BACKUP_KEY), 'original recovery bytes');
  assert.equal(applyImport(restored.state, preview(data, restored.state), []), restored.state);
  const html = renderToStaticMarkup(createElement(ImportedStudyRecordEditor, { record: restored.state.importedStudyRecords[0], sourceRows: restored.state.importedCourseAchievements, offerings: [], disabled: false, onChange() {}, onDelete() {} }));
  assert.match(html, /手動修正/); assert.match(html, new RegExp(`現在の公式集計[^<]*修得単位 ${scenario === 'aggregate only' ? 2 : 4}`));
});

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
