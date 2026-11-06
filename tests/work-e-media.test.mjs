import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mediaCells, mediaInput } from './fixtures/work-e-media.mjs';
import { importPreview, applyImport } from '../src/planner/gradeImport/gradeImportApply.ts';
import { officialMediaAchievements } from '../src/planner/gradeImport/officialMediaAchievements.ts';
import { deriveImportedAchievements } from '../src/planner/gradeImport/importedAchievementCalculations.ts';
import { deriveOfficialGraduationFacts } from '../src/planner/graduation/officialGraduationFacts.ts';
import { initialState, saveState, loadState } from '../src/planner/backup/storage.ts';
import { createPlannerBackup, parsePlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { isMediaSchooling } from '../src/planner/progress/mediaSchooling.ts';
import MediaSchoolingProgress from '../src/components/planner/progress/MediaSchoolingProgress.tsx';
import { preview } from './fixtures/migration-fixture.mjs';
import { encodeState, replayState } from '../src/planner/attempts/persistence/codec.ts';
import { createWorkspace } from '../src/planner/attempts/workbench/operations.ts';
import { adaptAttemptGraduation } from '../src/planner/attempts/graduation/adapter.ts';

const imported = (rows, offerings = []) => applyImport(initialState(), importPreview(mediaInput(rows), offerings), offerings);
const media = (s, c = catalog) => officialMediaAchievements(s.importedCourseAchievements, s.importedStudyRecords, c);
const scope = catalog.programs.find(p => !p.isCommon).scopeId;
const facts = s => deriveOfficialGraduationFacts(s.importedCourseAchievements, s.importedStudyRecords, catalog, scope, s.graduationProfile);
function html(rows) {
  return renderToStaticMarkup(createElement(MediaSchoolingProgress, { items: [], offerings: new Map(), progress: {}, officialAchievements: rows,
    importedAchievements: [], importedManaged: [], importedPending: [], disabled: false, onChange() {}, onResolveImportedMedia() {} }));
}
for (const name of ['健康・スポーツ科学概論', '経営学特講', '過年度の未登録科目']) test(`original メ survives no Offering: ${name}`, () => {
  const s = imported([mediaCells(name)]), before = JSON.stringify(s), rows = media(s, { ...catalog, offerings: [] });
  assert.equal(s.importedStudyRecords[0].rawTerm, 'メ'); assert.equal(s.importedStudyRecords[0].offeringId, null);
  assert.equal(rows.length, 1); assert.equal(rows[0].rawName, name);
  assert.equal(rows[0].records[0].academicYear, 2024); assert.match(html(rows), /成績表由来/);
  assert.equal(JSON.stringify(s), before);
});
for (const term of ['メディア', '前期メディア', '後期メディア', ' メ ', 'ﾒ']) test(`whole raw term accepted: ${term}`, () => {
  assert.equal(media(imported([mediaCells('方式試験', term)])).length, 1);
});
for (const term of ['', '夏', '冬', '春', '秋', '週', '地', '通', 'ゴ', '資', 'メモ', '非メディア', '前期メディア予定', 'メ ディア']) test(`unknown/non-Media term is not Media: ${term}`, () => {
  const s = imported([mediaCells('メディアという科目名', term)]);
  assert.equal(media(s).length, 0);
  assert.equal(s.importedStudyRecords.length, 1);
});
test('mutable term, year and match cannot overwrite original slots; both slots and mixed methods stay separate', () => {
  const cells = mediaCells('混合科目'); ['2023', '夏', '', '2', 'S'].forEach((v, i) => { cells[19 + i] = v; });
  Object.assign(cells, { 7: '○23/01/01', 11: '2023/02/01', 12: '2', 13: 'S' });
  const s = imported([cells]);
  s.importedStudyRecords.forEach(r => { r.term = '冬'; r.academicYear = 2039; });
  const row = media(s)[0]; assert.equal(row.records.length, 1); assert.equal(row.records[0].rawTerm, 'メ'); assert.equal(row.records[0].rawYear, '2024');
  const normal = imported([mediaCells('別科目', '夏')]); normal.importedStudyRecords[0].term = 'メ'; assert.equal(media(normal).length, 0);
  // Retained original slots remain inspectable even when details were removed.
  s.importedStudyRecords = []; assert.equal(media(s)[0].records[0].rawTerm, 'メ');
});
test('old source without native fingerprint uses only linked raw schooling term, never course name or edited term', () => {
  const s = imported([mediaCells('旧形式')]); const r = s.importedCourseAchievements[0]; r.fingerprint = 'legacy';
  assert.equal(media(s).length, 1);
  s.importedStudyRecords[0].rawTerm = null; s.importedStudyRecords[0].term = 'メ'; assert.equal(media(s).length, 0);
});
test('confirmed source Media and unresolved progress association coexist; intentional selector remains available', () => {
  const s = imported([mediaCells('進捗の照合先を確認する科目')]), rows = media(s);
  const opening = catalog.offerings.find(isMediaSchooling);
  const markup = renderToStaticMarkup(createElement(MediaSchoolingProgress, { items: [], offerings: new Map(), progress: {}, officialAchievements: rows,
    importedAchievements: [], importedManaged: [], importedPending: [{ sourceCourseId: rows[0].sourceCourseId, rawName: rows[0].rawName, candidates: [opening], canConfirmOffering: s.importedCourseAchievements.some(row => row.id === rows[0].sourceCourseId) }],
    disabled: false, onChange() {}, onResolveImportedMedia() {} }));
  assert.match(markup, /成績表由来のメディア記録/);
  assert.match(markup, /<select/); assert.match(markup, /成績表由来の方式表示とは別の操作/);
  assert.equal(media(s).length, 1);
});
test('same-name different institutional identities remain ambiguous/unmatched/conflicting, never guessed', () => {
  const s = imported([mediaCells('経営学特講')]), row = s.importedCourseAchievements[0];
  const ids = catalog.curriculum.courses.slice(0, 2).map(c => c.id);
  Object.assign(row, { curriculumCourseId: null, curriculumMatch: 'ambiguous', candidateCurriculumCourseIds: ids, offeringMatch: 'unmatched' });
  assert.equal(media(s)[0].identity, 'ambiguous'); assert.equal(facts(s).allocations.length, 0); assert.match(html(media(s)), /卒業算入は保留/);
  Object.assign(row, { curriculumMatch: 'unmatched', candidateCurriculumCourseIds: [] }); assert.equal(media(s)[0].identity, 'unmatched');
  Object.assign(row, { curriculumCourseId: ids[0], curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: ids }); assert.equal(media(s)[0].identity, 'conflict');
  assert.equal(facts(s).allocations.length, 0);
});
for (const earned of ['', '0', '2']) test(`official unknown/zero/positive quantities retain exact meaning: '${earned}'`, () => {
  const s = imported([mediaCells('単位不明の原記録', 'メ', '2024', earned)]), rows = media(s);
  assert.equal(rows.length, 1); assert.equal(rows[0].earnedCreditsTotal, earned === '' ? null : Number(earned));
  assert.match(html(rows), earned === '' ? /修得単位: 不明/ : new RegExp(`修得単位: ${earned}単位`));
  assert.equal(facts(s).allocations.length, 0);
});
test('current matched Media remains visible once, with original identity, progress and source ownership untouched', () => {
  const offering = catalog.offerings.find(o => isMediaSchooling(o) && o.courseId && o.curriculumCourseId && catalog.curriculum.courses.find(c => c.id === o.curriculumCourseId)?.curriculumCredits === 2);
  assert.ok(offering);
  const s = imported([mediaCells(offering.name, 'メ', '2026')], [offering]);
  assert.equal(s.importedStudyRecords[0].offeringId, offering.id);
  assert.equal(media(s)[0].identity, 'curriculum_only', 'legacy exact matching never asserts an audited institutional association');
  const before = JSON.stringify(s); assert.equal(media(s).length, 1); assert.equal(JSON.stringify(s), before);
});
test('repeat import, formal schema22 save/load and backup retain original IDs, quantities and method', async () => {
  const data = mediaInput(), s = applyImport(initialState(), importPreview(data, []), []);
  const again = applyImport(s, importPreview(data, [], s.importedStudyRecords, s.importedCourseAchievements), []);
  assert.deepEqual(again, s);
  let raw = null; const store = { getItem: () => raw, setItem: (_k, v) => { raw = v; } };
  saveState(store, s, null, catalog); const loaded = loadState(store, catalog); assert.equal(loaded.error, null); assert.deepEqual(loaded.state, s);
  const b = await createPlannerBackup(raw, catalog), restored = await parsePlannerBackup(JSON.stringify(b), catalog);
  assert.deepEqual(restored.state, s); assert.deepEqual(media(restored.state), media(s));
});
test('schema23 replay retains original raw, official records, all history and identity holds; schema24 is tested by existing new-plan suite', async () => {
  const s = imported([mediaCells('未照合の過年度科目')]);
  const x = await preview(s); assert.equal(x.result.status, 'ready');
  const state = await encodeState(x.source, x.table, x.result.target, createWorkspace(x.result.target.graph, x.source.context), x.source.sourceCatalog);
  const raw = JSON.stringify(state); const replay = await replayState(JSON.parse(raw));
  assert.equal(state.schemaVersion, 23); assert.deepEqual(replay.state, state);
  assert.equal(state.source.raw, x.source.raw);
  assert.deepEqual(state.retained.importedCourseAchievements, s.importedCourseAchievements);
  assert.deepEqual(state.retained.importedStudyRecords, s.importedStudyRecords);
  assert.deepEqual(officialMediaAchievements(state.retained.importedCourseAchievements, state.retained.importedStudyRecords, catalog), media(s));
});
test('official/learner overlap and graduation results are identical before and after presentation', async () => {
  const offering = catalog.offerings.find(o => isMediaSchooling(o) && o.curriculumCourseId && o.courseId && catalog.curriculum.courses.find(c => c.id === o.curriculumCourseId)?.curriculumCredits === 2);
  const s = imported([mediaCells(offering.name, 'メ', '2026')], [offering]);
  const source = s.importedCourseAchievements[0];
  s.items = [{ offeringId: offering.id, status: 'earned', importedSourceCourseId: source.id, plannedYear: 2026, plannedTerm: null, studyYear: null, earnedOrder: null }];
  const x = await preview(s); assert.equal(x.result.status, 'ready');
  const input = { graph: x.result.target.graph, retained: x.result.target.retained };
  const before = adaptAttemptGraduation(input, x.source, scope);
  assert.equal(before.status, 'adapted');
  assert.equal(before.attempts[0].decisions.ordinary.value, 0);
  media(s); assert.deepEqual(adaptAttemptGraduation(input, x.source, scope), before);
  assert.equal(deriveImportedAchievements(s.importedStudyRecords, new Map([[offering.id, offering]]), s.items, s.importedCourseAchievements, catalog).plannerItems.length, 0);
});
