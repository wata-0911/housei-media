import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalog } from '../src/planner/catalog.ts';
import { curriculumCatalog, attachCurriculumCatalog } from '../src/planner/curriculumCatalog.ts';
import { generateCurriculumCatalog } from '../src/planner/curriculumGeneration.ts';
import { matchImportedCurriculumCourse, curriculumMatchForOfferingSelection } from '../src/planner/curriculumImportMatch.ts';
import { importPreview, applyImport } from '../src/planner/gradeImportApply.ts';
import { migrateCurriculumState } from '../src/planner/curriculumMigration.ts';
import { initialState, loadState, saveState, saveRecoveredState, STORAGE_KEY } from '../src/planner/storage.ts';
import { validateCatalog, validateState } from '../src/planner/validation.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { applyManualMappingOverrides } from '../src/planner/manualMappingOverrides.ts';
import { initialGraduationProfile } from '../src/planner/graduationProfile.ts';
import { previewDirectGradeHandoff } from '../src/planner/directGradeHandoff.ts';
import ImportedAchievements from '../src/components/planner/ImportedAchievements.tsx';
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
  assert.equal(next.items[0].status, 'planned');
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
  const html = renderToStaticMarkup(createElement(ImportedAchievements, { records: [], courseRows: [row], offerings: f.offerings, disabled: false, onChange() {}, onChangeCourse() {}, onDelete() {} }));
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
