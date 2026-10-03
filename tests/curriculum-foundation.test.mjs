import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalog } from '../src/planner/catalog.ts';
import { curriculumCatalog, attachCurriculumCatalog } from '../src/planner/curriculumCatalog.ts';
import { generateCurriculumCatalog } from '../src/planner/curriculumGeneration.ts';
import { matchImportedCurriculumCourse, curriculumMatchForOfferingSelection } from '../src/planner/curriculumImportMatch.ts';
import { importPreview, applyImport } from '../src/planner/gradeImportApply.ts';
import { migrateCurriculumState } from '../src/planner/curriculumMigration.ts';
import { validImportedCurriculumIdentity } from '../src/planner/curriculumIdentityValidation.ts';
import { initialState, loadState, saveState, saveRecoveredState, STORAGE_KEY } from '../src/planner/storage.ts';
import { validateCatalog, validateState } from '../src/planner/validation.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { applyManualMappingOverrides } from '../src/planner/manualMappingOverrides.ts';
import { initialGraduationProfile } from '../src/planner/graduationProfile.ts';
import { previewDirectGradeHandoff } from '../src/planner/directGradeHandoff.ts';
import { ImportedManagementRows } from '../src/components/planner/ImportedAchievements.tsx';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const sourceRows = read('../scripts/inputs/curriculum-rows-2026.json').rows;
const equivalences = read('../scripts/inputs/curriculum-equivalences-2026.json').groups;
const rawCatalog = read('../src/data/planner_catalog_2026.json');
function store(raw) { const values = new Map([[STORAGE_KEY, raw]]); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }
const source = (mapping, canonicalName) => {
  const { source, scopeId, ...row } = mapping;
  assert.ok(scopeId);
  return { ...row, canonicalName, sourcePage: source.page };
};
function fixture({ distinct = false, displayVariants = false } = {}) {
  const base = { ...catalog.mappings[0], curriculumCredits: 4, category: '専門教育', schoolingOnly: false, mediaOnly: false };
  const maps = [base, { ...base, mappingId: catalog.mappings[1].mappingId, scopeId: catalog.mappings[1].scopeId }];
  const real = catalog.offerings.find(offering => offering.courseId && offering.resolutionStatus === 'matched');
  const ids = catalog.offerings.slice(0, 2).map(offering => offering.id);
  const offerings = ids.map((id, index) => ({ ...real, id, credits: 2, method: 'schooling', name: displayVariants ? `制度科目［${index + 1}］［表計算］` : '制度科目', mappingIds: distinct ? [maps[index].mappingId] : maps.map(mapping => mapping.mappingId) }));
  const input = { ...catalog, curriculum: undefined, mappings: maps, offerings };
  const rows = maps.map(mapping => source(mapping, '制度科目'));
  const groups = distinct ? [] : [{ id: `curriculum:${maps[0].mappingId}`, mappingIds: maps.map(mapping => mapping.mappingId), evidenceOfferingIds: ids, reason: 'Fixture explicit shared official row relation' }];
  const curriculum = generateCurriculumCatalog(input, rows, groups);
  const enriched = attachCurriculumCatalog(input, curriculum);
  return { ...enriched, rows, groups, context: { curriculum, mappings: maps } };
}
function importCourse(rawName, patch = {}) {
  const empty = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null };
  return { rawName, categoryRaw: '専門教育', compositionCredits: { raw: '4', value: 4 }, additionalEnrollment: { raw: '', value: null }, recognizedExemption: { raw: '', value: null }, earnedCredits: { raw: '2', value: 2 }, schoolingCredits: { raw: '2', value: 2 }, reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })), creditExam: { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false }, schoolings: [{ ...empty, rawYear: '26', year: '26', rawTerm: '前期', term: '前期', rawCredits: '2', credits: 2, rawGrade: 'A', grade: 'A' }, empty], ...patch };
}
const importData = course => ({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-02T00:00:00.000Z', courses: [course] });
const preview = (f, course = importCourse('制度科目')) => importPreview(importData(course), f.offerings, [], [], f.context);
const japaneseHistoryCourseId = 'curriculum:db2833b3-2a18-4059-85e7-beeaae2d3107';
const japaneseHistoryOfferingIds = ['2c368dad-a33c-4cbc-8a15-295a82cf36e2', 'a2b30fc5-0819-4d03-9301-eec9ddacb8a1'];
const japaneseHistoryState = () => applyImport(initialState(), preview(catalog, importCourse('日本史概説')), catalog.offerings);
const withoutCurriculumMatch = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['curriculumCourseId', 'curriculumMatch', 'candidateCurriculumCourseIds', 'offeringMatch'].includes(key)));
function legacyJapaneseHistoryState(patch = {}) {
  const state = japaneseHistoryState();
  const row = state.importedCourseAchievements[0];
  return { ...state, schemaVersion: 21, importedCourseAchievements: [{ ...withoutCurriculumMatch(row), ...patch }] };
}

// Source coverage includes rows with no annual offering; names and credits do not come from an opening.
test('curriculum: all 502 official source rows generate a deterministic complete master', () => {
  const generated = generateCurriculumCatalog(applyManualMappingOverrides(rawCatalog), sourceRows, equivalences);
  assert.deepEqual(generated, curriculumCatalog);
  assert.deepEqual(generateCurriculumCatalog(applyManualMappingOverrides(rawCatalog), [...sourceRows].reverse(), [...equivalences].reverse()), generated);
  assert.equal(generated.courses.length, 321);
  assert.equal(new Set(generated.courses.map(course => course.id)).size, 321);
  assert.equal(new Set(generated.courses.flatMap(course => course.mappingIds)).size, 502);
  assert.equal(validateCatalog(catalog), true);
  for (const row of sourceRows) {
    const matches = generated.courses.filter(course => course.mappingIds.includes(row.mappingId));
    assert.equal(matches.length, 1);
    assert.equal(matches[0].canonicalName, row.canonicalName);
    assert.equal(matches[0].curriculumCredits, row.curriculumCredits);
  }
  assert.ok(sourceRows.some(row => !catalog.offerings.some(offering => offering.mappingIds.includes(row.mappingId))));
});

test('curriculum: explicit equivalence shares one course across scopes and differently named openings', () => {
  const f = fixture({ displayVariants: true });
  assert.equal(f.curriculum.courses.length, 1);
  assert.equal(f.curriculum.courses[0].scopeIds.length, 2);
  assert.equal(new Set(f.offerings.map(offering => offering.curriculumCourseId)).size, 1);
  assert.notEqual(f.offerings[0].name, f.offerings[1].name);
  assert.equal(f.curriculum.courses[0].canonicalName, '制度科目');
  const reversed = generateCurriculumCatalog(f, [...f.rows].reverse(), [{ ...f.groups[0], mappingIds: [...f.groups[0].mappingIds].reverse() }]);
  assert.deepEqual(reversed.courses, f.curriculum.courses, 'explicit group identity is stable across row order');
  for (const offering of f.offerings) {
    assert.equal(offering.credits, 2);
    assert.equal(f.curriculum.courses[0].curriculumCredits, 4);
  }
});

test('curriculum: exact same names without an explicit row relation remain distinct identities', () => {
  const f = fixture({ distinct: true });
  assert.equal(f.curriculum.courses.length, 2);
  assert.notEqual(f.offerings[0].curriculumCourseId, f.offerings[1].curriculumCourseId);
  const result = matchImportedCurriculumCourse(importCourse('制度科目'), f.offerings, f.curriculum, f.mappings);
  assert.equal(result.curriculumMatch, 'ambiguous');
  assert.equal(result.curriculumCourseId, null);
  assert.equal(result.candidateCurriculumCourseIds.length, 2);
});

test('curriculum: similar numbered names are never merged by normalization', () => {
  const f = fixture({ distinct: true });
  const rows = f.rows.map((row, i) => ({ ...row, canonicalName: `英語[${i + 1}]` }));
  const master = generateCurriculumCatalog(f, rows, []);
  assert.equal(master.courses.length, 2);
  assert.equal(matchImportedCurriculumCourse(importCourse('英語'), [], master, f.mappings).curriculumMatch, 'unmatched');
  const exact = matchImportedCurriculumCourse(importCourse('英語[1]'), [], master, f.mappings);
  assert.equal(exact.curriculumMatch, 'exact_unique');
  assert.equal(master.courses.find(course => course.id === exact.curriculumCourseId).canonicalName, '英語[1]');
});

test('curriculum: group evidence and source metadata cannot be silently guessed or changed', () => {
  const f = fixture();
  assert.throws(() => generateCurriculumCatalog(f, f.rows.map((row, index) => index === 0 ? { ...row, curriculumCredits: 2 } : row), f.groups), /source differs/);
  assert.throws(() => generateCurriculumCatalog(f, f.rows.map((row, index) => index === 0 ? { ...row, canonicalName: '別科目' } : row), f.groups), /Incompatible/);
  assert.throws(() => generateCurriculumCatalog(f, f.rows, [{ ...f.groups[0], evidenceOfferingIds: [] }]), /evidence/);
  assert.throws(() => attachCurriculumCatalog(f, { ...f.curriculum, offeringRelations: [] }), /coverage/);
});

test('curriculum: unresolved annual mappings retain statuses and never acquire an identity from their names', () => {
  for (const raw of rawCatalog.offerings.filter(offering => offering.resolutionStatus !== 'matched')) {
    const current = catalog.offerings.find(offering => offering.id === raw.id);
    if (current.resolutionStatus === 'matched') continue; // Existing approved override, independently retained.
    assert.equal(current.resolutionStatus, raw.resolutionStatus);
    assert.deepEqual(current.mappingIds, raw.mappingIds);
    assert.equal(current.curriculumCourseId, null);
  }
  assert.equal(catalog.offerings.length, 686);
  assert.equal(catalog.metadata.graduationCheckComplete, false);
});

test('import: course exact / annual opening ambiguous retains official facts and creates no planner item', () => {
  const f = fixture();
  const data = importData(importCourse('制度科目'));
  for (const offerings of [f.offerings, [...f.offerings].reverse()]) {
    const units = importPreview(data, offerings, [], [], f.context);
    const row = units[0].sourceCourse;
    assert.equal(row.curriculumMatch, 'exact_unique');
    assert.equal(row.curriculumCourseId, f.curriculum.courses[0].id);
    assert.equal(row.offeringMatch, 'ambiguous');
    assert.equal(row.selectedOfferingId, null);
    assert.equal(units[0].offeringId, null);
    const next = applyImport(initialState(), units, offerings);
    assert.equal(next.items.length, 0);
    assert.equal(next.importedStudyRecords.length, 1);
    assert.equal(next.importedStudyRecords[0].credits, 2);
    assert.equal(next.importedStudyRecords[0].grade, 'A');
    assert.equal(next.importedCourseAchievements[0].earnedCreditsTotal, 2);
    assert.equal(next.importedCourseAchievements[0].compositionCredits, 4);
    assert.equal(validateState(next, f), true);
  }
});

test('import: exact course and opening retain safe auto-registration and no final-grade inference', () => {
  const f = fixture();
  const offerings = [f.offerings[0]];
  const units = importPreview(importData(importCourse('制度科目')), offerings, [], [], f.context);
  const next = applyImport(initialState(), units, offerings);
  assert.equal(units[0].sourceCourse.curriculumMatch, 'exact_unique');
  assert.equal(units[0].sourceCourse.offeringMatch, 'exact_unique');
  assert.equal(units[0].sourceCourse.selectedOfferingId, offerings[0].id);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].status, 'earned');
  assert.equal(next.items[0].importedSourceCourseId, next.importedCourseAchievements[0].id);
  assert.equal(next.items[0].plannedYear, 2026);
  assert.equal(next.items[0].plannedTerm, '前期');
  assert.deepEqual(next.courseEvaluations, {});
});

test('import: canonical curriculum matching works without any annual opening or component detail', () => {
  const f = fixture();
  const course = importCourse('制度科目', { schoolings: [importCourse('').schoolings[1], importCourse('').schoolings[1]] });
  const units = importPreview(importData(course), [], [], [], f.context);
  assert.equal(units[0].courseOnly, true);
  assert.equal(units[0].sourceCourse.curriculumMatch, 'exact_unique');
  assert.equal(units[0].sourceCourse.offeringMatch, 'unmatched');
  const next = applyImport(initialState(), units, []);
  assert.equal(next.importedCourseAchievements.length, 1);
  assert.equal(next.importedCourseAchievements[0].earnedCreditsTotal, 2);
  assert.equal(next.importedStudyRecords.length, 0);
  assert.equal(next.items.length, 0);
});

test('import: safe annual aliases use explicit relations; delivery suffixes never create a course identity', () => {
  const f = fixture({ displayVariants: true });
  const match = matchImportedCurriculumCourse(importCourse(f.offerings[0].name), f.offerings, f.curriculum, f.mappings);
  assert.equal(match.curriculumCourseId, f.curriculum.courses[0].id);
  const unsafe = f.offerings.map(offering => ({ ...offering, curriculumCourseId: null }));
  assert.equal(matchImportedCurriculumCourse(importCourse(f.offerings[0].name), unsafe, f.curriculum, f.mappings).curriculumMatch, 'unmatched');
});

test('import: ambiguous institutional courses and unmatched names keep source facts', () => {
  for (const name of ['制度科目', '存在しない科目']) {
    const f = fixture({ distinct: true });
    const next = applyImport(initialState(), preview(f, importCourse(name)), f.offerings);
    const row = next.importedCourseAchievements[0];
    assert.equal(row.curriculumCourseId, null);
    assert.equal(row.curriculumMatch, name === '制度科目' ? 'ambiguous' : 'unmatched');
    assert.equal(row.rawName, name);
    assert.equal(row.earnedCreditsTotal, 2);
    assert.equal(row.compositionCredits, 4);
    assert.equal(next.importedStudyRecords[0].grade, 'A');
    assert.equal(next.items.length, 0);
  }
});

test('import: official composition credits and categories constrain course matching, not offering credits', () => {
  const f = fixture();
  assert.equal(matchImportedCurriculumCourse(importCourse('制度科目'), f.offerings, f.curriculum, f.mappings).curriculumMatch, 'exact_unique');
  assert.equal(matchImportedCurriculumCourse(importCourse('制度科目', { compositionCredits: { raw: '2', value: 2 } }), f.offerings, f.curriculum, f.mappings).curriculumMatch, 'unmatched');
  assert.equal(matchImportedCurriculumCourse(importCourse('制度科目', { categoryRaw: '外国語' }), f.offerings, f.curriculum, f.mappings).curriculumMatch, 'unmatched');
});

test('migration: v21 retains every source fact, manual choice, component and user metadata through save/reload', () => {
  const f = fixture();
  const next = applyImport(initialState(), preview(f), f.offerings);
  const row = next.importedCourseAchievements[0];
  const { curriculumCourseId, curriculumMatch, candidateCurriculumCourseIds, offeringMatch, ...old } = row;
  assert.ok(curriculumCourseId && curriculumMatch && candidateCurriculumCourseIds && offeringMatch);
  const manual = { ...old, selectedOfferingId: f.offerings[1].id, selectionSource: 'manual' };
  const legacy = { ...next, schemaVersion: 21, importedCourseAchievements: [manual], importedCourseUserMeta: { [old.id]: { lifecycleStatus: 'waiting', plannedYear: 2027, plannedTerm: '自由入力', studyYear: 3 } } };
  const raw = JSON.stringify(legacy); const memory = store(raw);
  const loaded = loadState(memory, f);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.schemaVersion, 22);
  assert.equal(memory.getItem(STORAGE_KEY), raw, 'load does not write');
  for (const [key, value] of Object.entries(legacy)) {
    if (key !== 'schemaVersion' && key !== 'importedCourseAchievements') assert.deepEqual(loaded.state[key], value);
  }
  for (const [key, value] of Object.entries(manual)) assert.deepEqual(loaded.state.importedCourseAchievements[0][key], value, key);
  assert.equal(loaded.state.importedCourseAchievements[0].curriculumCourseId, f.curriculum.courses[0].id);
  assert.equal(loaded.state.importedCourseAchievements[0].offeringMatch, 'exact_unique');
  const saved = saveState(memory, loaded.state, raw, f);
  assert.deepEqual(loadState(memory, f).state, loaded.state);
  assert.equal(memory.getItem(STORAGE_KEY), saved);
});

test('migration: unsafe old course crosswalk is held without using its automatic representative', () => {
  const f = fixture({ distinct: true });
  const row = preview(f)[0].sourceCourse;
  const old = { ...row, selectedOfferingId: f.offerings[0].id, selectionSource: 'auto' };
  const result = migrateCurriculumState({ ...initialState(), schemaVersion: 21, importedCourseAchievements: [old] }, f);
  assert.equal(result.importedCourseAchievements[0].curriculumCourseId, null);
  assert.equal(result.importedCourseAchievements[0].curriculumMatch, 'ambiguous');
  assert.equal(result.importedCourseAchievements[0].candidateCurriculumCourseIds.length, 2);
  assert.equal(result.importedCourseAchievements[0].selectedOfferingId, old.selectedOfferingId);
  assert.equal(result.importedCourseAchievements[0].rawName, old.rawName);
  assert.equal(result.importedCourseAchievements[0].earnedCreditsTotal, 2);
  assert.equal(result.importedCourseAchievements[0].offeringMatch, 'ambiguous');
  assert.equal(validateState(result, f), true);
  const memory = store(null);
  saveState(memory, result, null, f);
  assert.deepEqual(loadState(memory, f).state, result);
});

test('migration: unknown old course ID does not acquire identity from a similar name', () => {
  const f = fixture(); const row = { ...preview(f)[0].sourceCourse, courseId: 'unknown-legacy', selectedOfferingId: f.offerings[0].id, selectionSource: 'auto' };
  const result = migrateCurriculumState({ ...initialState(), schemaVersion: 21, importedCourseAchievements: [row] }, f);
  assert.equal(result.importedCourseAchievements[0].curriculumCourseId, null);
  assert.equal(result.importedCourseAchievements[0].courseId, 'unknown-legacy');
  assert.equal(result.importedCourseAchievements[0].selectedOfferingId, row.selectedOfferingId);
});

test('migration: recognition recovery shadow survives v21 upgrade, unrelated save and reload', () => {
  const legacy = { ...initialState(), schemaVersion: 21 };
  legacy.graduationProfile.recognizedCredits.totalCredits = 1000;
  const raw = JSON.stringify(legacy); const memory = store(raw);
  const loaded = loadState(memory, catalog);
  assert.equal(loaded.error, null);
  assert.ok(loaded.recognitionWarning);
  assert.equal(loaded.state.schemaVersion, 22);
  const saved = saveRecoveredState(memory, { ...loaded.state, items: [{ offeringId: catalog.offerings[0].id, status: 'planned', plannedYear: 2026, plannedTerm: null, studyYear: null, earnedOrder: null }] }, loaded, catalog);
  assert.equal(JSON.parse(saved.raw).graduationProfile.recognizedCredits.totalCredits, 1000);
  assert.ok(loadState(memory, catalog).recognitionWarning);
});

test('persistence: partial or contradictory new match fields are rejected with raw bytes retained', () => {
  const f = fixture(); const state = applyImport(initialState(), preview(f), f.offerings);
  const row = state.importedCourseAchievements[0];
  for (const bad of [{ ...row, curriculumCourseId: 'unknown-curriculum' }, { ...row, curriculumMatch: 'ambiguous' }, { ...row, curriculumCourseId: null, curriculumMatch: 'exact_unique' }, { ...row, candidateCurriculumCourseIds: undefined }]) {
    const value = { ...state, importedCourseAchievements: [bad] };
    assert.equal(validateState(value, f), false);
    const raw = JSON.stringify(value); const memory = store(raw);
    assert.ok(loadState(memory, f).error);
    assert.equal(memory.getItem(STORAGE_KEY), raw);
  }
});

test('identity validation: exact opening requires an existing selected opening', () => {
  const f = fixture(); const row = preview(f)[0].sourceCourse;
  for (const selectedOfferingId of [null, 'nonexistent-offering']) {
    const bad = { ...row, selectedOfferingId, offeringMatch: 'exact_unique' };
    assert.equal(validImportedCurriculumIdentity(bad, f), false);
    const state = { ...initialState(), importedCourseAchievements: [bad] };
    assert.equal(validateState(state, f), false);
    const raw = JSON.stringify(state); const memory = store(raw);
    assert.throws(() => saveState(memory, state, raw, f));
    assert.ok(loadState(memory, f).error);
    assert.equal(memory.getItem(STORAGE_KEY), raw);
  }
});

test('identity validation: Course A cannot be saved with an exact opening of Course B', () => {
  const f = fixture({ distinct: true }); const row = preview(f)[0].sourceCourse;
  const courseA = f.offerings[0].curriculumCourseId;
  const bad = { ...row, selectedOfferingId: f.offerings[1].id, offeringMatch: 'exact_unique', curriculumMatch: 'exact_unique', curriculumCourseId: courseA, candidateCurriculumCourseIds: [courseA] };
  assert.notEqual(courseA, f.offerings[1].curriculumCourseId);
  assert.equal(validImportedCurriculumIdentity(bad, f), false);
  assert.equal(validateState({ ...initialState(), importedCourseAchievements: [bad] }, f), false);
});

test('identity validation: exact opening with its matching curriculum singleton survives persistence', () => {
  const f = fixture(); const row = preview(f)[0].sourceCourse;
  const matched = { ...row, ...curriculumMatchForOfferingSelection(row, f.offerings[0], f.curriculum), selectedOfferingId: f.offerings[0].id, selectionSource: 'manual' };
  assert.equal(validImportedCurriculumIdentity(matched, f), true);
  for (const patch of [
    { curriculumCourseId: null, curriculumMatch: 'unmatched', candidateCurriculumCourseIds: [] },
    { curriculumCourseId: null, curriculumMatch: 'ambiguous' },
    { candidateCurriculumCourseIds: [] },
    { candidateCurriculumCourseIds: [matched.curriculumCourseId, matched.curriculumCourseId] },
  ]) assert.equal(validImportedCurriculumIdentity({ ...matched, ...patch }, f), false);
  const state = { ...initialState(), importedCourseAchievements: [matched] }; const memory = store(null);
  assert.equal(validateState(state, f), true);
  saveState(memory, state, null, f);
  assert.deepEqual(loadState(memory, f).state, state);
});

test('identity validation: manual ambiguous curriculum relation requires the complete generated candidate set', () => {
  const f = fixture({ distinct: true });
  const input = { ...f, offerings: f.offerings.map(offering => ({ ...offering, mappingIds: f.mappings.map(mapping => mapping.mappingId) })) };
  const curriculum = generateCurriculumCatalog(input, f.rows, []);
  const ambiguous = attachCurriculumCatalog(input, curriculum);
  const offering = ambiguous.offerings[0]; const row = preview(f)[0].sourceCourse;
  const matched = { ...row, ...curriculumMatchForOfferingSelection(row, offering, curriculum), selectedOfferingId: offering.id, selectionSource: 'manual' };
  const ids = matched.candidateCurriculumCourseIds;
  assert.equal(ids.length, 2);
  assert.equal(offering.curriculumCourseId, null);
  for (const candidateCurriculumCourseIds of [ids, [...ids].reverse()]) {
    const state = { ...initialState(), importedCourseAchievements: [{ ...matched, candidateCurriculumCourseIds }] };
    assert.equal(validateState(state, ambiguous), true);
    const memory = store(null); saveState(memory, state, null, ambiguous);
    assert.deepEqual(loadState(memory, ambiguous).state, state);
  }
  for (const patch of [
    { candidateCurriculumCourseIds: [ids[0]] },
    { candidateCurriculumCourseIds: [ids[0], ids[0]] },
    { candidateCurriculumCourseIds: [...ids, 'nonexistent-course'] },
    { curriculumMatch: 'unmatched', candidateCurriculumCourseIds: [] },
  ]) assert.equal(validImportedCurriculumIdentity({ ...matched, ...patch }, ambiguous), false);
  for (const curriculumCourseId of ids) {
    assert.equal(validImportedCurriculumIdentity({ ...matched, curriculumCourseId, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [curriculumCourseId] }, ambiguous), true, 'independent Stage A may safely identify an official candidate');
  }
});

test('identity validation: exact unresolved/outside openings cannot invent a curriculum identity', () => {
  const row = preview(fixture())[0].sourceCourse;
  for (const status of ['manual_review', 'outside_mapping_scope']) {
    const offering = catalog.offerings.find(candidate => candidate.resolutionStatus === status);
    assert.ok(offering);
    assert.equal(offering.curriculumCourseId, null);
    const matched = { ...row, ...curriculumMatchForOfferingSelection({}, offering, catalog.curriculum), selectedOfferingId: offering.id, selectionSource: 'manual' };
    assert.equal(validImportedCurriculumIdentity(matched, catalog), true);
    const id = catalog.curriculum.courses[0].id;
    assert.equal(validImportedCurriculumIdentity({ ...matched, curriculumCourseId: id, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [id] }, catalog), false);
    assert.equal(validImportedCurriculumIdentity({ ...matched, curriculumMatch: 'ambiguous', candidateCurriculumCourseIds: [id] }, catalog), false);
  }
});

test('real catalog: 日本史概説 Stage A exact survives ambiguous opening selection, save/reload and clearing', () => {
  const state = japaneseHistoryState(); const row = state.importedCourseAchievements[0];
  const offering = catalog.offerings.find(value => value.id === japaneseHistoryOfferingIds[0]);
  const relation = catalog.curriculum.offeringRelations.find(value => value.offeringId === offering.id);
  assert.equal(row.curriculumCourseId, japaneseHistoryCourseId);
  assert.equal(row.curriculumMatch, 'exact_unique');
  assert.equal(row.compositionCredits, 4);
  assert.equal(offering.curriculumCourseId, null);
  assert.equal(relation.candidateCurriculumCourseIds.length, 2);
  assert.ok(relation.candidateCurriculumCourseIds.includes(japaneseHistoryCourseId));
  const selected = { ...row, ...curriculumMatchForOfferingSelection(row, offering, catalog.curriculum), selectedOfferingId: offering.id, selectionSource: 'manual', courseId: offering.courseId, match: 'ambiguous' };
  assert.equal(selected.curriculumCourseId, japaneseHistoryCourseId);
  assert.equal(selected.curriculumMatch, 'exact_unique');
  assert.deepEqual(selected.candidateCurriculumCourseIds, [japaneseHistoryCourseId]);
  assert.equal(selected.offeringMatch, 'exact_unique');
  const selectedState = { ...state, importedCourseAchievements: [selected] }; const memory = store(null);
  assert.equal(validateState(selectedState, catalog), true);
  const raw = saveState(memory, selectedState, null, catalog);
  const loaded = loadState(memory, catalog);
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.state, selectedState);
  const reloaded = loaded.state.importedCourseAchievements[0];
  const cleared = { ...reloaded, ...curriculumMatchForOfferingSelection(reloaded, undefined, catalog.curriculum), selectedOfferingId: null, selectionSource: 'none', courseId: null, match: 'unmatched' };
  assert.equal(cleared.curriculumCourseId, japaneseHistoryCourseId);
  assert.equal(cleared.curriculumMatch, 'exact_unique');
  assert.equal(cleared.offeringMatch, 'unmatched');
  const clearedState = { ...loaded.state, importedCourseAchievements: [cleared] };
  saveState(memory, clearedState, raw, catalog);
  assert.deepEqual(loadState(memory, catalog).state, clearedState);
  for (const [key, value] of Object.entries(row)) {
    if (!['selectedOfferingId', 'selectionSource', 'courseId', 'match', 'offeringMatch'].includes(key)) assert.deepEqual(cleared[key], value, key);
  }
  assert.deepEqual(clearedState.importedStudyRecords, state.importedStudyRecords);
  assert.deepEqual(clearedState.items, state.items);
});

test('real catalog: an incompatible unique or ambiguous opening never silently overwrites Stage A', () => {
  const state = japaneseHistoryState(); const row = state.importedCourseAchievements[0];
  const incompatible = catalog.offerings.filter(offering => {
    const relation = catalog.curriculum.offeringRelations.find(value => value.offeringId === offering.id);
    return relation.candidateCurriculumCourseIds.length > 0 && !relation.candidateCurriculumCourseIds.includes(row.curriculumCourseId);
  });
  const unique = incompatible.find(offering => offering.curriculumCourseId);
  const ambiguous = incompatible.find(offering => !offering.curriculumCourseId);
  assert.ok(unique && ambiguous);
  const memory = store(null); const raw = saveState(memory, state, null, catalog);
  for (const offering of [unique, ambiguous]) {
    const proposed = { ...row, ...curriculumMatchForOfferingSelection(row, offering, catalog.curriculum), selectedOfferingId: offering.id, selectionSource: 'manual' };
    assert.equal(proposed.curriculumCourseId, row.curriculumCourseId);
    assert.equal(proposed.curriculumMatch, 'exact_unique');
    assert.deepEqual(proposed.candidateCurriculumCourseIds, row.candidateCurriculumCourseIds);
    assert.equal(validImportedCurriculumIdentity(proposed, catalog), false);
    assert.throws(() => saveState(memory, { ...state, importedCourseAchievements: [proposed] }, raw, catalog));
    assert.equal(memory.getItem(STORAGE_KEY), raw);
    assert.deepEqual(loadState(memory, catalog).state, state);
  }
});

test('real catalog migration: v21 null course retains both ambiguous offering curriculum candidates losslessly', () => {
  const legacy = legacyJapaneseHistoryState({ courseId: null, candidateOfferingIds: japaneseHistoryOfferingIds });
  const raw = JSON.stringify(legacy); const memory = store(raw);
  const loaded = loadState(memory, catalog);
  assert.equal(loaded.error, null);
  const row = loaded.state.importedCourseAchievements[0];
  assert.equal(row.curriculumCourseId, null);
  assert.equal(row.curriculumMatch, 'ambiguous');
  assert.deepEqual(row.candidateCurriculumCourseIds, catalog.curriculum.offeringRelations.find(value => value.offeringId === japaneseHistoryOfferingIds[0]).candidateCurriculumCourseIds);
  for (const [key, value] of Object.entries(legacy.importedCourseAchievements[0])) assert.deepEqual(row[key], value, key);
  assert.deepEqual(loaded.state.importedStudyRecords, legacy.importedStudyRecords);
  assert.equal(memory.getItem(STORAGE_KEY), raw);
  saveState(memory, loaded.state, raw, catalog);
  assert.deepEqual(loadState(memory, catalog).state, loaded.state);
});

test('real catalog migration: manual ambiguous selection retains generated candidates even without annual candidates', () => {
  const legacy = legacyJapaneseHistoryState({ courseId: null, selectedOfferingId: japaneseHistoryOfferingIds[0], selectionSource: 'manual', candidateOfferingIds: [] });
  const migrated = migrateCurriculumState(legacy, catalog); const row = migrated.importedCourseAchievements[0];
  assert.equal(row.curriculumCourseId, null);
  assert.equal(row.curriculumMatch, 'ambiguous');
  assert.equal(row.offeringMatch, 'exact_unique');
  assert.deepEqual(row.candidateCurriculumCourseIds, catalog.curriculum.offeringRelations.find(value => value.offeringId === row.selectedOfferingId).candidateCurriculumCourseIds);
  for (const [key, value] of Object.entries(legacy.importedCourseAchievements[0])) assert.deepEqual(row[key], value, key);
  const memory = store(JSON.stringify(legacy)); const loaded = loadState(memory, catalog);
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.state, migrated);
  saveState(memory, migrated, loaded.raw, catalog);
  assert.deepEqual(loadState(memory, catalog).state, migrated);
});

test('migration: unknown annual candidates retain only known curriculum evidence and prevent exact promotion', () => {
  const f = fixture(); const row = preview(f)[0].sourceCourse;
  for (const candidateOfferingIds of [[f.offerings[0].id, 'unknown-offering'], ['unknown-offering']]) {
    const legacy = { ...initialState(), schemaVersion: 21, importedCourseAchievements: [{ ...withoutCurriculumMatch(row), courseId: null, selectedOfferingId: null, candidateOfferingIds }] };
    const result = migrateCurriculumState(legacy, f).importedCourseAchievements[0];
    assert.equal(result.curriculumCourseId, null);
    assert.equal(result.curriculumMatch, candidateOfferingIds.length === 2 ? 'ambiguous' : 'unmatched');
    assert.deepEqual(result.candidateCurriculumCourseIds, candidateOfferingIds.length === 2 ? [f.curriculum.courses[0].id] : []);
    assert.deepEqual(result.candidateOfferingIds, candidateOfferingIds);
  }
  for (const selectionSource of ['auto', 'manual']) {
    const legacy = legacyJapaneseHistoryState({ courseId: null, selectedOfferingId: japaneseHistoryOfferingIds[0], selectionSource, candidateOfferingIds: [japaneseHistoryOfferingIds[1], 'unknown-offering'] });
    const migrated = migrateCurriculumState(legacy, catalog);
    const result = migrated.importedCourseAchievements[0];
    assert.equal(result.curriculumMatch, 'ambiguous');
    assert.equal(result.curriculumCourseId, null);
    assert.equal(result.candidateCurriculumCourseIds.length, 2);
    assert.equal(result.offeringMatch, selectionSource === 'manual' ? 'exact_unique' : 'ambiguous');
    assert.equal(validateState(migrated, catalog), true);
    for (const [key, value] of Object.entries(legacy.importedCourseAchievements[0])) assert.deepEqual(result[key], value, key);
  }
  const unknownManual = legacyJapaneseHistoryState({ courseId: null, selectedOfferingId: 'unknown-offering', selectionSource: 'manual', candidateOfferingIds: [japaneseHistoryOfferingIds[0], 'unknown-offering'] });
  const retained = migrateCurriculumState(unknownManual, catalog).importedCourseAchievements[0];
  assert.equal(retained.curriculumCourseId, null);
  assert.equal(retained.curriculumMatch, 'ambiguous');
  assert.equal(retained.offeringMatch, 'ambiguous');
  assert.equal(retained.selectedOfferingId, 'unknown-offering');
  assert.deepEqual(retained.candidateCurriculumCourseIds, catalog.curriculum.offeringRelations.find(value => value.offeringId === japaneseHistoryOfferingIds[0]).candidateCurriculumCourseIds);
});

test('migration: safe legacy crosswalk survives a compatible ambiguous manual relation; conflicts remain reviewable', () => {
  const f = fixture({ distinct: true }); const row = preview(f)[0].sourceCourse;
  const [courseA, courseB] = f.offerings.map(offering => offering.curriculumCourseId);
  const selectedOfferingId = f.offerings[1].id;
  const generate = mappingIds => {
    const input = { ...f, offerings: f.offerings.map(offering => offering.id === selectedOfferingId ? { ...offering, courseId: null, mappingIds } : offering) };
    return attachCurriculumCatalog(input, generateCurriculumCatalog(input, f.rows, []));
  };
  const compatible = generate(f.mappings.map(mapping => mapping.mappingId));
  const crosswalk = compatible.curriculum.legacyCourseRelations.find(relation => relation.legacyCourseId === row.courseId);
  assert.equal(crosswalk.curriculumCourseId, courseA);
  assert.deepEqual(compatible.curriculum.offeringRelations.find(relation => relation.offeringId === selectedOfferingId).candidateCurriculumCourseIds, [courseA, courseB].sort());
  const legacy = { ...initialState(), schemaVersion: 21, importedCourseAchievements: [{ ...withoutCurriculumMatch(row), selectedOfferingId, selectionSource: 'manual' }] };
  const migrated = migrateCurriculumState(legacy, compatible); const retained = migrated.importedCourseAchievements[0];
  assert.equal(retained.curriculumCourseId, courseA);
  assert.equal(retained.curriculumMatch, 'exact_unique');
  assert.deepEqual(retained.candidateCurriculumCourseIds, [courseA]);
  assert.equal(retained.offeringMatch, 'exact_unique');
  assert.equal(validateState(migrated, compatible), true);
  const conflict = generate([f.mappings[1].mappingId]);
  const unresolved = migrateCurriculumState(legacy, conflict); const saved = unresolved.importedCourseAchievements[0];
  assert.equal(saved.curriculumCourseId, courseA);
  assert.equal(saved.curriculumMatch, 'exact_unique');
  assert.equal(saved.offeringMatch, 'ambiguous');
  assert.equal(saved.selectedOfferingId, selectedOfferingId);
  assert.equal(validateState(unresolved, conflict), true);
  for (const [key, value] of Object.entries(legacy.importedCourseAchievements[0])) assert.deepEqual(saved[key], value, key);
});

test('import: reimport and manual override preserve curriculum identity and learner metadata', () => {
  const f = fixture(); const data = importData(importCourse('制度科目'));
  const first = applyImport(initialState(), importPreview(data, f.offerings, [], [], f.context), f.offerings);
  const row = first.importedCourseAchievements[0];
  const edited = { ...first, importedCourseAchievements: [{ ...row, selectedOfferingId: f.offerings[1].id, selectionSource: 'manual', offeringMatch: 'exact_unique' }], importedCourseUserMeta: { [row.id]: { lifecycleStatus: 'waiting', plannedYear: 2027, plannedTerm: null, studyYear: 4 } } };
  const repeated = importPreview(data, f.offerings, edited.importedStudyRecords, edited.importedCourseAchievements, f.context);
  assert.deepEqual(applyImport(edited, repeated, f.offerings), edited);
  const updated = importData(importCourse('制度科目', { earnedCredits: { raw: '4', value: 4 } }));
  const applied = applyImport(edited, importPreview(updated, f.offerings, edited.importedStudyRecords, edited.importedCourseAchievements, f.context), f.offerings);
  assert.equal(applied.importedCourseAchievements.length, 1);
  assert.equal(applied.importedCourseAchievements[0].selectedOfferingId, f.offerings[1].id);
  assert.equal(applied.importedCourseAchievements[0].curriculumCourseId, row.curriculumCourseId);
  assert.equal(applied.importedCourseAchievements[0].earnedCreditsTotal, 4);
  assert.deepEqual(applied.importedCourseUserMeta, edited.importedCourseUserMeta);
});

test('import: direct handoff keeps institutional matching and UI distinguishes an unknown opening', () => {
  const course = curriculumCatalog.courses.find(course => course.curriculumCredits === 4);
  const data = importData(importCourse(course.canonicalName, { categoryRaw: null }));
  const handed = previewDirectGradeHandoff(data, catalog.offerings, []);
  assert.ok(handed);
  assert.ok(handed.units.every(unit => 'curriculumMatch' in unit.sourceCourse));
  const f = fixture(); const row = preview(f)[0].sourceCourse;
  const html = renderToStaticMarkup(createElement(ImportedManagementRows, { records: [], courseRows: [row], offerings: f.offerings, disabled: false, onChange() {}, onChangeCourse() {}, onDelete() {} }));
  assert.match(html, /カリキュラム科目:/);
  assert.match(html, /2026開講: 未特定/);
});

test('graduation: all eight scopes retain pre-foundation calculations across statuses, recognition and public courses', () => {
  const legacy = applyManualMappingOverrides(rawCatalog);
  const profile = { ...initialGraduationProfile(), admissionYear: 2026, admissionType: 'first_year', curriculumApplicability: 'current_2026', currentStudyYear: 4 };
  for (const program of catalog.programs.filter(program => !program.isCommon)) {
    for (const status of ['planned', 'in_progress', 'earned', 'waiting', 'failed', 'dropped']) {
      const items = catalog.offerings.map(offering => ({ offeringId: offering.id, status, plannedYear: 2026, plannedTerm: null, studyYear: 4, earnedOrder: null }));
      const publicCourses = [{ id: 'public-foundation', title: '公開科目', status, plannedYear: 2026, plannedTerm: null, studyYear: 4, finalGrade: null, credits: 2 }];
      const recognized = { ...profile, admissionType: 'other_transfer', recognizedCredits: { ...profile.recognizedCredits, totalCredits: 12, openUniversityCredits: 4 } };
      for (const candidate of [profile, recognized]) for (const thesis of ['undecided', 'selected', 'not_selected']) {
        assert.deepEqual(calculateGraduationProgress(items, catalog, program.scopeId, publicCourses, thesis, [], [], candidate), calculateGraduationProgress(items, legacy, program.scopeId, publicCourses, thesis, [], [], candidate), `${program.displayName}/${status}/${thesis}`);
      }
    }
  }
});

test('import: schooling-only evidence cannot select a correspondence opening as a representative', () => {
  const f = fixture();
  const correspondence = [{ ...f.offerings[0], method: 'correspondence' }];
  const units = importPreview(importData(importCourse('制度科目')), correspondence, [], [], f.context);
  assert.equal(units[0].sourceCourse.curriculumMatch, 'exact_unique');
  assert.equal(units[0].sourceCourse.selectedOfferingId, null);
  assert.equal(units[0].sourceCourse.offeringMatch, 'unmatched');
  assert.equal(applyImport(initialState(), units, correspondence).items.length, 0);
});


test('import: clearing an opening selection retains independent course match and manual ambiguous candidates', () => {
  const f = fixture(); const row = preview(f)[0].sourceCourse;
  const selected = curriculumMatchForOfferingSelection(row, f.offerings[0], f.curriculum);
  assert.equal(selected.offeringMatch, 'exact_unique');
  const cleared = curriculumMatchForOfferingSelection(selected, undefined, f.curriculum);
  assert.equal(cleared.curriculumCourseId, f.curriculum.courses[0].id);
  assert.equal(cleared.curriculumMatch, 'exact_unique');
  assert.equal(cleared.offeringMatch, 'unmatched');
  const multiple = fixture({ distinct: true });
  const ambiguousOffering = { ...multiple.offerings[0], curriculumCourseId: null };
  const relation = { ...multiple.curriculum, offeringRelations: [{ offeringId: ambiguousOffering.id, curriculumCourseId: null, candidateCurriculumCourseIds: multiple.curriculum.courses.map(course => course.id) }] };
  const ambiguous = curriculumMatchForOfferingSelection({}, ambiguousOffering, relation);
  assert.equal(ambiguous.curriculumMatch, 'ambiguous');
  assert.equal(ambiguous.curriculumCourseId, null);
  assert.equal(ambiguous.candidateCurriculumCourseIds.length, 2);
});
