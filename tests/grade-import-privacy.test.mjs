import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { catalog } from '../src/planner/catalog.ts';
import { isHoseiGradeImportV1, parseHoseiGradeImportV1 } from '../src/planner/gradeImportContract.ts';
import { importPreview, applyImport, importedEarnedCreditsTotal } from '../src/planner/gradeImportApply.ts';
import { previewDirectGradeHandoff } from '../src/planner/directGradeHandoff.ts';
import { initialState, saveState, STORAGE_KEY } from '../src/planner/storage.ts';
import { validateState } from '../src/planner/validation.ts';
import { serializeGradeImport } from '../bookmarklet/serialize.ts';

const sentinels = ['AUDIT_SYNTHETIC_STUDENT_ID', 'AUDIT_SYNTHETIC_NAME'];
const numericKeys = ['compositionCredits', 'additionalEnrollment', 'recognizedExemption', 'earnedCredits', 'schoolingCredits'];
const fixture = () => structuredClone(JSON.parse(readFileSync(new URL('../bookmarklet/tests/fixtures/extraction-741e780.json', import.meta.url), 'utf8')).outcomes.normal32.value);
const keys = (object, expected) => assert.deepEqual(Object.keys(object).sort(), [...expected].sort());
function assertShape(payload) {
  keys(payload, ['schemaVersion', 'source', 'capturedAt', 'courses']);
  for (const course of payload.courses) {
    keys(course, ['rawName', 'categoryRaw', ...numericKeys, 'reports', 'creditExam', 'schoolings']);
    for (const key of numericKeys) keys(course[key], ['raw', 'value']);
    assert.equal(course.reports.length, 4);
    for (const report of course.reports) keys(report, ['raw', 'status', 'date']);
    keys(course.creditExam, ['rawDate', 'rawCredits', 'rawGrade', 'date', 'credits', 'grade', 'pendingMarker']);
    assert.equal(course.schoolings.length, 2);
    for (const slot of course.schoolings) keys(slot, ['rawYear', 'rawTerm', 'rawDate', 'rawCredits', 'rawGrade', 'year', 'term', 'date', 'credits', 'grade']);
  }
}
function contaminate(payload) {
  const mark = object => Object.assign(object, { studentId: sentinels[0], studentName: sentinels[1], extra: { private: sentinels } });
  mark(payload);
  for (const course of payload.courses) {
    mark(course);
    numericKeys.forEach(key => mark(course[key]));
    course.reports.forEach(mark);
    mark(course.creditExam);
    course.schoolings.forEach(mark);
  }
  return payload;
}
function assertNoPrivateData(value) {
  if (!value || typeof value !== 'object') { assert.ok(!sentinels.includes(value)); return; }
  for (const [key, entry] of Object.entries(value)) {
    assert.ok(!['studentId', 'studentName', 'extra'].includes(key), key);
    assertNoPrivateData(entry);
  }
  for (const sentinel of sentinels) assert.equal(JSON.stringify(value).includes(sentinel), false);
}
function assertSaved(units, expected) {
  assert.ok(units.length > 0);
  assertNoPrivateData(units);
  const correspondence = units.find(unit => unit.reports);
  assert.ok(correspondence);
  for (const report of correspondence.reports) keys(report, ['raw', 'status', 'date']);
  const state = applyImport(initialState(), units, catalog.offerings);
  assert.equal(state.schemaVersion, 22);
  assert.equal(validateState(state, catalog), true);
  assert.equal(state.importedCourseAchievements.length, expected.courses.length);
  assert.equal(importedEarnedCreditsTotal(state.importedCourseAchievements), expected.courses.reduce((sum, course) => sum + (course.earnedCredits.value ?? 0), 0));
  assert.deepEqual(state.importedStudyRecords.find(record => record.reports).reports, correspondence.reports);
  assertNoPrivateData(state);
  const values = new Map();
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const raw = saveState(store, state, null, catalog);
  assert.equal(values.get(STORAGE_KEY), raw);
  assert.deepEqual(JSON.parse(raw), state);
  assertNoPrivateData(JSON.parse(raw));
}

test('privacy: canonical projection removes unknown keys at every contract level without mutating input', () => {
  const clean = fixture();
  const dirty = contaminate(structuredClone(clean));
  const before = structuredClone(dirty);
  assert.equal(isHoseiGradeImportV1(dirty), true);
  const canonical = parseHoseiGradeImportV1(dirty);
  assertShape(canonical);
  assert.deepEqual(canonical, clean);
  assert.deepEqual(dirty, before);
  const detached = (actual, original) => {
    if (!actual || typeof actual !== 'object') return;
    assert.notEqual(actual, original);
    for (const key of Object.keys(actual)) detached(actual[key], original[key]);
  };
  detached(canonical, dirty);
  assertSaved(importPreview(canonical, catalog.offerings), clean);
});

for (const [name, input] of [
  ['JSON textarea', async dirty => JSON.parse(JSON.stringify(dirty))],
  ['JSON file', async dirty => JSON.parse(await new File([JSON.stringify(dirty)], 'grades.json', { type: 'application/json' }).text())],
  ['Bookmarklet JSON', async dirty => JSON.parse(serializeGradeImport(dirty))],
]) test(`privacy: ${name} crosses importPreview boundary before apply/validate/save`, async () => {
  const clean = fixture();
  const value = await input(contaminate(structuredClone(clean)));
  // Exercise the preview boundary directly: callers cannot bypass sanitization.
  const units = importPreview(value, catalog.offerings);
  value.courses[0].reports[0].raw = sentinels[1];
  assertSaved(units, clean);
});

test('privacy: direct Extension handoff returns only canonical data and preview, requiring explicit apply', () => {
  const clean = fixture();
  const result = previewDirectGradeHandoff(contaminate(structuredClone(clean)), catalog.offerings, []);
  assert.ok(result);
  assertShape(result.data);
  assert.deepEqual(result.data, clean);
  assertNoPrivateData(result);
  assertSaved(result.units, clean);
});

for (const [name, mutate] of [
  ['schema', value => { value.schemaVersion = 2; }],
  ['timestamp', value => { value.capturedAt = 'invalid'; }],
  ['missing required field', value => { delete value.courses[0].categoryRaw; }],
  ['empty name', value => { value.courses[0].rawName = ' '; }],
  ['negative numeric', value => { value.courses[0].earnedCredits.value = -1; }],
  ['nonfinite numeric', value => { value.courses[0].earnedCredits.value = Infinity; }],
  ['report length', value => { value.courses[0].reports.pop(); }],
  ['report status', value => { value.courses[0].reports[0].status = 'invalid'; }],
  ['exam date', value => { value.courses[0].creditExam.date = '2026-02-30'; }],
  ['exam grade', value => { value.courses[0].creditExam.grade = 'invalid'; }],
  ['pending marker', value => { value.courses[0].creditExam.pendingMarker = 'true'; }],
  ['schooling length', value => { value.courses[0].schoolings.pop(); }],
  ['schooling credit', value => { value.courses[0].schoolings[0].credits = -1; }],
]) test(`privacy: sanitization still rejects invalid ${name}`, () => {
  const value = contaminate(fixture());
  mutate(value);
  assert.equal(isHoseiGradeImportV1(value), false);
  assert.equal(parseHoseiGradeImportV1(value), null);
  assert.equal(previewDirectGradeHandoff(value, [], []), null);
  assert.throws(() => importPreview(value, []), /contract v1/);
});

test('privacy: valid null/zero/empty imports retain v1 values', () => {
  const clean = fixture();
  clean.courses[0].earnedCredits = { raw: '', value: null };
  clean.courses[0].schoolingCredits = { raw: '0', value: 0 };
  assert.deepEqual(parseHoseiGradeImportV1(clean), clean);
  const empty = { ...clean, courses: [] };
  assert.deepEqual(parseHoseiGradeImportV1(empty), empty);
  assert.deepEqual(importPreview(empty, []), []);
});
