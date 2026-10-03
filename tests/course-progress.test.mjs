import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { economicsGradeCells } from './fixtures/economics-grade-row.mjs';
import { isHoseiGradeImportV1 } from '../src/planner/gradeImportContract.ts';
import { ImportedManagementRows } from '../src/components/planner/ImportedAchievements.tsx';
import PlannedCourseList from '../src/components/planner/PlannedCourseList.tsx';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { catalog, offeringsById } from '../src/planner/catalog.ts';
import { deriveCurriculumCourseProgress, curriculumOfferingAdvisories, COMPLETED_COURSE_ADVISORY, MEDIA_REPEAT_ADVISORY } from '../src/planner/curriculumCourseProgress.ts';
import { plannerItemsWithoutOfficialEarned } from '../src/planner/officialCourseCredits.ts';
import { applyImport, importedEarnedCreditsTotal, importPreview } from '../src/planner/gradeImportApply.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { deriveImportedAchievements } from '../src/planner/importedAchievementCalculations.ts';
import { plannerItemFromCourseSearch, updatePlannerItem } from '../src/planner/plannerItemState.ts';
import { initialState, loadState, saveState, STORAGE_KEY } from '../src/planner/storage.ts';
import { validateState } from '../src/planner/validation.ts';
import { removePlannerItem, restorePlannerItem } from '../src/planner/removeUndo.ts';
import { annualCreditLimitReferences, createCreditClassifier, groupAnnualPlan, isCreditCategory, summarizeCategories } from '../src/planner/annualPlan.ts';
import { createUnifiedCourseRows } from '../src/planner/unifiedCourseView.ts';
import { searchOfferings, summarizeCredits } from '../src/planner/calculations.ts';
import CreditSummary from '../src/components/planner/CreditSummary.tsx';
import CategorySummary from '../src/components/planner/CategorySummary.tsx';
import AnnualCreditLimitNotice from '../src/components/planner/AnnualCreditLimitNotice.tsx';
import { CorrespondenceDetails } from '../src/components/planner/CorrespondenceProgress.tsx';
import { correspondenceCreditResult, effectiveCorrespondenceProgress, progressForCorrespondence, setReportGrade, setReportStatus } from '../src/planner/correspondenceProgress.ts';
import { effectiveRequiredReportsFor, requirementsByOfferingId } from '../src/planner/correspondenceRequirements.ts';
import { progressSummaryForOffering } from '../src/planner/planTable.ts';
import CourseSearch from '../src/components/planner/CourseSearch.tsx';
import CourseProgress from '../src/components/planner/CurriculumCourseProgress.tsx';
import { plannerExportCsv, plannerExportPresentation } from '../src/planner/plannerExport.ts';
import PlannerExportActions from '../src/components/planner/PlannerExportActions.tsx';

function fixture() {
  const base = catalog.offerings.find(offering => offering.method === 'correspondence' && offering.credits === 4 && offering.curriculumCourseId
    && catalog.curriculum.courses.find(course => course.id === offering.curriculumCourseId)?.curriculumCredits === 4);
  const course = { ...catalog.curriculum.courses.find(course => course.id === base.curriculumCourseId), canonicalName: '進捗検証科目' };
  const offerings = catalog.offerings.slice(0, 3).map((offering, index) => ({ ...base, id: offering.id, name: course.canonicalName,
    credits: index === 2 ? 4 : 2, method: index === 2 ? 'correspondence' : 'schooling', period: index === 0 ? '夏期' : '冬期' }));
  const curriculum = { ...catalog.curriculum, courses: [course], offeringRelations: offerings.map(offering => ({ offeringId: offering.id, curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id] })) };
  return { ...catalog, offerings, curriculum, requirements: [], course };
}
const item = (offering, status = 'planned') => ({ ...plannerItemFromCourseSearch(offering.id), status });
function official(f, credits = 2, patch = {}) {
  return { id: 'official-row', fingerprint: 'official-source', source: 'hosei_import', rawName: f.course.canonicalName, categoryRaw: null,
    capturedAt: '2026-10-02T00:00:00Z', earnedCreditsTotal: credits, schoolingCreditsTotal: credits, compositionCredits: 4,
    recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source',
    curriculumCourseId: f.course.id, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [f.course.id],
    offeringMatch: 'unmatched', courseId: f.offerings[0].courseId, selectedOfferingId: null, selectionSource: 'none', match: 'exact_unique',
    candidateOfferingIds: [], ...patch };
}
const progress = (f, items, rows = []) => deriveCurriculumCourseProgress(items, f, rows).courses[0];

function extractedEconomics(slot = 0) {
  const cells = economicsGradeCells(slot);
  const row = { querySelectorAll: () => cells.map(textContent => ({ textContent, classList: { contains: () => false } })) };
  const table = { querySelectorAll: () => [row] };
  const context = { document: { querySelectorAll: () => [table] } };
  runInNewContext(readFileSync(new URL('../extension/hosei-planner-import/parser/extractor.js', import.meta.url), 'utf8'), context);
  return JSON.parse(JSON.stringify(context.HoseiPlannerGradeExtractor.extractCurrentDocument().value));
}
function economicsOfferings() {
  const correspondence = catalog.offerings.find(o => o.name === '経済学' && o.method === 'correspondence' && o.credits === 4);
  const winter = catalog.offerings.find(o => o.name === '経済学（冬期スクーリング）' && o.method === 'schooling' && o.credits === 2);
  assert.ok(correspondence); assert.ok(winter); return [correspondence, winter];
}
function withoutCorrespondence(data) {
  data.courses[0].reports = data.courses[0].reports.map(() => ({ raw: '', status: 'none', date: null }));
  data.courses[0].creditExam = { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false };
  return data;
}
test('Stage B source: actual Economics retains Course exact and official4 without auto-selecting the correspondence opening', () => {
  const offerings = economicsOfferings(); const preview = importPreview(extractedEconomics(), offerings);
  const row = preview[0].sourceCourse;
  assert.deepEqual([row.selectedOfferingId, row.selectionSource, row.offeringMatch], [null, 'none', 'ambiguous']);
  assert.equal(row.courseId, offerings[0].courseId); assert.equal(row.curriculumCourseId, offerings[0].curriculumCourseId);
  assert.equal(row.curriculumMatch, 'exact_unique'); assert.equal(row.earnedCreditsTotal, 4);
  const next = applyImport(initialState(), preview, offerings);
  assert.equal(next.importedCourseAchievements[0].selectedOfferingId, null);
  assert.deepEqual(next.items, [], 'completed source with unsafe aggregate attribution adds no planned fallback');
  const html = renderToStaticMarkup(createElement(ImportedManagementRows, { records: next.importedStudyRecords, courseRows: next.importedCourseAchievements, offerings, disabled: false, onChange: () => {}, onChangeCourse: () => {}, onDelete: () => {} }));
  assert.match(html, /2026開講: 未特定/); assert.match(html, /開講照合: 要確認/);
  assert.doesNotMatch(html, /2026開講: 経済学/); assert.doesNotMatch(html, /自動照合/);
});
test('Stage B source: a truly single safe correspondence opening can be auto-selected', () => {
  const offerings = economicsOfferings(); const data = extractedEconomics();
  data.courses[0].schoolings[0] = data.courses[0].schoolings[1];
  const row = importPreview(data, offerings)[0].sourceCourse;
  assert.deepEqual([row.selectedOfferingId, row.selectionSource, row.offeringMatch], [offerings[0].id, 'auto', 'exact_unique']);
});
test('Stage B source: two schooling slots resolving to the same safe opening can be auto-selected', () => {
  const [, winter] = economicsOfferings(); const offerings = [{ ...winter, name: '経済学' }];
  const data = withoutCorrespondence(extractedEconomics()); data.courses[0].schoolings[1] = { ...data.courses[0].schoolings[0] };
  const row = importPreview(data, offerings)[0].sourceCourse;
  assert.deepEqual([row.selectedOfferingId, row.selectionSource, row.offeringMatch], [winter.id, 'auto', 'exact_unique']);
});
for (const scenario of ['two-safe', 'ambiguous', 'historical-current', 'unsafe-resolution', 'unsafe-course-id']) test(`Stage B source: ${scenario} component evidence prevents automatic opening identity`, () => {
  const [corr, winter] = economicsOfferings(); const school = { ...winter, name: corr.name }; let offerings = [corr, school];
  let data = extractedEconomics();
  if (scenario === 'ambiguous') offerings.push({ ...school, id: 'another-school' });
  if (scenario === 'historical-current') {
    data = withoutCorrespondence(data); data.courses[0].schoolings[1] = { ...data.courses[0].schoolings[0], rawYear: '2025', year: '2025', rawDate: '2026/02/01', date: '2026-02-01' }; offerings = [school];
  }
  if (scenario === 'unsafe-resolution' || scenario === 'unsafe-course-id') {
    data = withoutCorrespondence(data); offerings = [{ ...school, ...(scenario === 'unsafe-resolution' ? { resolutionStatus: 'manual_review' } : { courseId: null }) }];
  }
  const units = importPreview(data, offerings); const row = units[0].sourceCourse;
  assert.deepEqual([row.selectedOfferingId, row.selectionSource, row.offeringMatch], [null, 'none', 'ambiguous']);
  assert.equal(row.earnedCreditsTotal, 4);
  const deselected = applyImport(initialState(), units.map(u => ({ ...u, selected: u.id === units[0].id })), offerings);
  assert.equal(deselected.importedCourseAchievements[0].selectedOfferingId, null);
});
test('Stage B source: entirely historical or absent candidates remain unmatched with no automatic opening', () => {
  const [, winter] = economicsOfferings(); const data = withoutCorrespondence(extractedEconomics());
  Object.assign(data.courses[0].schoolings[0], { rawYear: '2025', year: '2025', rawDate: '2026/02/01', date: '2026-02-01' });
  for (const offerings of [[], [{ ...winter, name: '経済学' }]]) {
    const row = importPreview(data, offerings)[0].sourceCourse;
    assert.deepEqual([row.selectedOfferingId, row.selectionSource, row.offeringMatch], [null, 'none', 'unmatched']);
  }
});
test('Stage B source: reimport preserves a manual opening selection independently of the new automatic evidence', () => {
  const offerings = economicsOfferings(); const data = extractedEconomics(); const saved = applyImport(initialState(), importPreview(data, offerings), offerings);
  const manual = { ...saved.importedCourseAchievements[0], selectedOfferingId: offerings[1].id, selectionSource: 'manual', offeringMatch: 'exact_unique' };
  const before = { ...saved, importedCourseAchievements: [manual] };
  const changed = structuredClone(data); Object.assign(changed.courses[0].schoolings[0], { rawGrade: 'A+', grade: 'A+' });
  const units = importPreview(changed, offerings, before.importedStudyRecords, before.importedCourseAchievements);
  assert.equal(units[0].sourceCourse.selectedOfferingId, null);
  const next = applyImport(before, units, offerings); const row = next.importedCourseAchievements[0];
  assert.deepEqual([row.selectedOfferingId, row.selectionSource, row.offeringMatch], [offerings[1].id, 'manual', 'exact_unique']);
  assert.equal(row.id, manual.id); assert.equal(row.earnedCreditsTotal, 4); assert.equal(row.curriculumCourseId, manual.curriculumCourseId);
  assert.equal(next.importedStudyRecords.length, 2); assert.equal(next.importedStudyRecords[1].grade, 'A+');
  assert.equal(next.schemaVersion, 22); assert.equal(validateState(next, catalog), true);
  const values = new Map(); const store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  saveState(store, next, null, catalog); assert.deepEqual(loadState(store, catalog).state, next);
});
function unifiedImportHtml(state, offerings = catalog.offerings) {
  const map = new Map(offerings.map(o => [o.id, o])); const noop = () => {};
  return renderToStaticMarkup(createElement(PlannedCourseList, {
    classify: createCreditClassifier(catalog, null), unifiedRows: createUnifiedCourseRows(state.items, state.importedCourseAchievements, map, state.importedCourseUserMeta, state.importedStudyRecords),
    publicCourses: [], offerings: map, correspondenceProgress: {}, mediaProgress: {}, evaluations: {}, importedUserMeta: {}, disabled: false,
    onChange: noop, onRemove: noop, onChangePublicCourse: noop, onRemovePublicCourse: noop, onChangeEvaluation: noop, onChangeCorrespondence: noop, onChangeImportedMeta: noop, onOpenMedia: noop,
  }));
}
for (const unresolved of ['unmatched', 'ambiguous']) for (const deselect of [false, true]) for (const credits of [2, 4]) test(`P2 import: ${unresolved} schooling blocks source-linked earned even when deselected=${deselect}, earned=${credits}/4`, () => {
  const [corr, winter] = economicsOfferings(); const school = { ...winter, name: corr.name };
  const offerings = unresolved === 'unmatched' ? [corr, winter] : [corr, school, { ...school, id: 'another-school' }];
  const data = extractedEconomics(); data.courses[0].earnedCredits = { raw: String(credits), value: credits }; const preview = importPreview(data, offerings);
  assert.equal(preview[1].match, unresolved);
  const next = applyImport(initialState(), preview.map(u => ({ ...u, selected: !deselect || u.method !== 'schooling' })), offerings);
  assert.equal(next.items.length, credits === 4 ? 0 : 1);
  if (credits < 4) { assert.equal(next.items[0].status, 'planned'); assert.equal('importedSourceCourseId' in next.items[0], false); }
  assert.equal(importedEarnedCreditsTotal(next.importedCourseAchievements), credits);
  assert.equal(next.importedCourseAchievements[0].curriculumMatch, 'exact_unique');
  assert.equal(deriveCurriculumCourseProgress(next.items, catalog, next.importedCourseAchievements).courses.find(c => c.curriculumCourseId === corr.curriculumCourseId).earnedCredits, credits);
});
for (const credits of [2, 4]) test(`P2 import: unresolved sourceDuplicate backfill respects completion ${credits}/4`, () => {
  const offerings = economicsOfferings(); const data = extractedEconomics(); data.courses[0].earnedCredits = { raw: String(credits), value: credits };
  const imported = applyImport(initialState(), importPreview(data, offerings), offerings);
  const before = { ...imported, items: [] }; const preview = importPreview(data, offerings, before.importedStudyRecords, before.importedCourseAchievements);
  assert.ok(preview.every(u => u.sourceDuplicate && !u.selected));
  const after = applyImport(before, preview, offerings);
  assert.equal(after.items.length, credits === 4 ? 0 : 1);
  if (credits < 4) { assert.equal(after.items[0].status, 'planned'); assert.equal(after.items[0].importedSourceCourseId, undefined); }
  else assert.equal(after, before, 'completed duplicate is a whole-state no-op');
  assert.equal(after.importedStudyRecords, before.importedStudyRecords); assert.equal(after.importedCourseAchievements, before.importedCourseAchievements);
});
test('P2 import: a truly single safe correspondence component still permits earned', () => {
  const [corr] = economicsOfferings(); const data = extractedEconomics();
  data.courses[0].schoolings[0] = data.courses[0].schoolings[1];
  const next = applyImport(initialState(), importPreview(data, [corr]), [corr]);
  assert.equal(next.items[0].status, 'earned'); assert.equal(next.items[0].importedSourceCourseId, next.importedCourseAchievements[0].id);
});
for (const coalesced of [false, true]) test(`P2 import: Unified plan includes unmatched winter detail with the official row (coalesced=${coalesced})`, () => {
  const offerings = economicsOfferings(); const map = new Map(offerings.map(o => [o.id, o]));
  const saved = applyImport(initialState(), importPreview(extractedEconomics(), offerings), offerings);
  const state = { ...saved, items: coalesced ? [item(offerings[0])] : [] }; const snapshot = structuredClone(state);
  const rows = createUnifiedCourseRows(state.items, state.importedCourseAchievements, map, {}, state.importedStudyRecords);
  assert.equal(rows.length, 1); assert.deepEqual(rows[0].importedStudyRecords, state.importedStudyRecords);
  const html = unifiedImportHtml(state, offerings);
  assert.ok((html.match(/成績表の履修内訳/g) ?? []).length >= 2, 'desktop and mobile retain source details');
  assert.match(html, /通信/); assert.match(html, /スクーリング/); assert.match(html, /2026年度/); assert.match(html, /冬期/); assert.match(html, /2単位/); assert.match(html, /評価: A/); assert.match(html, /照合先: 未特定/);
  assert.match(html, /リポート/); assert.match(html, /単位修得試験/); assert.match(html, /修得済み（成績表）/);
  assert.deepEqual(state, snapshot);
});
test('P2 import: multiple planner Offerings group components only with the separate official row', () => {
  const [corr, winter] = economicsOfferings(); const school = { ...winter, name: corr.name }; const offerings = [corr, school];
  const imported = applyImport(initialState(), importPreview(extractedEconomics(), offerings), offerings);
  assert.deepEqual(imported.items, [], 'completed multi-Offering source never manufactures attempts');
  const next = { ...imported, items: offerings.map(offering => item(offering)) };
  const rows = createUnifiedCourseRows(next.items, next.importedCourseAchievements, new Map(offerings.map(o => [o.id, o])), {}, next.importedStudyRecords);
  assert.equal(rows.length, 3); assert.ok(rows.filter(r => r.plannerItem).every(r => r.importedStudyRecords.length === 0));
  assert.equal(rows.find(r => r.source === 'imported').importedStudyRecords.length, 2);
  assert.match(unifiedImportHtml(next, offerings), /2026開講と照合済み/);
  assert.equal(importedEarnedCreditsTotal(next.importedCourseAchievements), 4);
  for (const p of catalog.programs.filter(p => p.department)) {
    const baseline = calculateGraduationProgress([], catalog, p.scopeId, [], 'undecided', [], next.importedCourseAchievements);
    const actual = calculateGraduationProgress(next.items, { ...catalog, offerings }, p.scopeId, [], 'undecided', next.importedStudyRecords, next.importedCourseAchievements);
    assert.deepEqual(actual.cards.map(c => c.earned), baseline.cards.map(c => c.earned)); assert.equal(actual.graduationCheckComplete, false);
  }
});
test('P2 import: historical schooling is retained in Unified plan without a 2026 PlannerItem or verified association', () => {
  const [, winter] = economicsOfferings(); const offerings = [{ ...winter, name: '経済学' }]; const data = extractedEconomics();
  data.courses[0].reports = data.courses[0].reports.map(() => ({ raw: '', status: 'none', date: null }));
  data.courses[0].creditExam = { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false };
  Object.assign(data.courses[0].schoolings[0], { rawYear: '2025', year: '2025', rawDate: '2026/02/01', date: '2026-02-01' });
  const next = applyImport(initialState(), importPreview(data, offerings), offerings);
  assert.deepEqual(next.items, []); assert.equal(next.importedStudyRecords.length, 1); assert.equal(next.importedStudyRecords[0].academicYear, 2025);
  assert.equal(next.importedCourseAchievements[0].selectedOfferingId, null);
  const html = unifiedImportHtml(next, offerings); assert.match(html, /2025年度/); assert.match(html, /冬期/); assert.doesNotMatch(html, /2026開講と照合済み/);
  const legacy = { ...next, importedStudyRecords: next.importedStudyRecords.map(r => ({ ...r, offeringId: winter.id, match: 'exact_unique' })) };
  assert.doesNotMatch(unifiedImportHtml(legacy, offerings), /2026開講と照合済み/);
});
test('P2 import: a historical correspondence exam never becomes a current catalog attempt', () => {
  const [corr] = economicsOfferings(); const data = extractedEconomics();
  data.courses[0].schoolings[0] = data.courses[0].schoolings[1];
  data.courses[0].reports = data.courses[0].reports.map(r => ({ ...r, date: r.date ? '2025-06-01' : null }));
  Object.assign(data.courses[0].creditExam, { rawDate: '2025/07/01', date: '2025-07-01' });
  const next = applyImport(initialState(), importPreview(data, [corr]), [corr]);
  assert.deepEqual(next.items, []); assert.equal(next.importedStudyRecords[0].offeringId, null);
  assert.equal(next.importedCourseAchievements[0].selectedOfferingId, null);
  assert.equal(importedEarnedCreditsTotal(next.importedCourseAchievements), 4);
  assert.match(unifiedImportHtml(next, [corr]), /2025年度/);
});
for (const credits of [2, 4]) test(`P2 import: unresolved correspondence blocks safe schooling aggregate attribution at ${credits}/4`, () => {
  const [corr, winter] = economicsOfferings(); const offerings = [{ ...winter, name: corr.name }];
  const data = extractedEconomics(); data.courses[0].earnedCredits = { raw: String(credits), value: credits };
  const next = applyImport(initialState(), importPreview(data, offerings), offerings);
  assert.equal(next.items.length, credits === 4 ? 0 : 1);
  if (credits < 4) { assert.equal(next.items[0].status, 'planned'); assert.equal(next.items[0].importedSourceCourseId, undefined); }
  assert.equal(next.importedStudyRecords.length, 2); assert.equal(importedEarnedCreditsTotal(next.importedCourseAchievements), credits);
});
test('P2 import: legacy or orphan source details are shown without inferring an official aggregate', () => {
  const offerings = economicsOfferings(); const saved = applyImport(initialState(), importPreview(extractedEconomics(), offerings), offerings);
  const state = { ...initialState(), importedStudyRecords: saved.importedStudyRecords.map(({ sourceCourseId, ...r }) => r) };
  const rows = createUnifiedCourseRows([], [], new Map(offerings.map(o => [o.id, o])), {}, state.importedStudyRecords);
  assert.equal(rows.length, 2); assert.equal(rows.flatMap(r => r.importedStudyRecords).length, 2);
  assert.match(unifiedImportHtml(state, offerings), /公式科目行との対応未確認/); assert.match(unifiedImportHtml(state, offerings), /冬期/);
});
test('P2 import: reimport same source and schooling slot updates grade losslessly instead of appending', () => {
  for (const slot of [0, 1]) {
    const offerings = economicsOfferings(); const data = extractedEconomics(slot);
    const before = applyImport(initialState(), importPreview(data, offerings), offerings); const snapshot = structuredClone(before);
    const changed = structuredClone(data); Object.assign(changed.courses[0].schoolings[slot], { rawGrade: 'A+', grade: 'A+' });
    const preview = importPreview(changed, offerings, before.importedStudyRecords, before.importedCourseAchievements);
    assert.equal(applyImport(before, preview.map(u => ({ ...u, selected: false })), offerings), before);
    const next = applyImport(before, preview, offerings);
    assert.equal(next.importedStudyRecords.length, 2);
    assert.equal(next.importedStudyRecords[0], before.importedStudyRecords[0]);
    assert.equal(next.importedStudyRecords[1].id, before.importedStudyRecords[1].id);
    assert.equal(next.importedStudyRecords[1].grade, 'A+'); assert.equal(next.importedStudyRecords[1].sourceCourseId, before.importedCourseAchievements[0].id);
    assert.equal(importedEarnedCreditsTotal(next.importedCourseAchievements), 4); assert.deepEqual(before, snapshot);
    assert.equal(applyImport(next, importPreview(changed, offerings, next.importedStudyRecords, next.importedCourseAchievements), offerings), next);
    const removed = { ...next, importedStudyRecords: [next.importedStudyRecords[0]] };
    assert.equal(applyImport(removed, importPreview(changed, offerings, removed.importedStudyRecords, removed.importedCourseAchievements), offerings), removed);
    const values = new Map(); const store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
    const raw = saveState(store, next, null, catalog); assert.deepEqual(loadState(store, catalog).state, next);
    saveState(store, before, raw, catalog); assert.deepEqual(loadState(store, catalog).state, snapshot); assert.equal(next.schemaVersion, 22);
  }
});
test('P2 import: uncertain or competing component identity never overwrites an old record', () => {
  const offerings = economicsOfferings(); const data = extractedEconomics(); const saved = applyImport(initialState(), importPreview(data, offerings), offerings);
  const changed = structuredClone(data); Object.assign(changed.courses[0].schoolings[0], { rawGrade: 'A+', grade: 'A+' });
  for (const records of [saved.importedStudyRecords.map(r => r.method === 'schooling' ? { ...r, fingerprint: 'legacy-unknown-slot' } : r), [...saved.importedStudyRecords, { ...saved.importedStudyRecords[1], id: 'competing-detail' }]]) {
    const before = { ...saved, importedStudyRecords: records };
    const next = applyImport(before, importPreview(changed, offerings, records, before.importedCourseAchievements), offerings);
    assert.ok(next.importedStudyRecords.some(r => r.id === records[1].id && r.grade === 'A'));
    assert.equal(next.importedStudyRecords.length, records.length + 1);
  }
});
test('P2 import: grade refresh preserves component association and other native slots', () => {
  const [corr, winter] = economicsOfferings(); const offerings = [corr, { ...winter, name: corr.name }]; const data = extractedEconomics();
  data.courses[0].schoolings[1] = { ...data.courses[0].schoolings[0] };
  const saved = applyImport(initialState(), importPreview(data, offerings), offerings);
  const before = { ...saved, importedStudyRecords: saved.importedStudyRecords.map(r => r.method === 'schooling' ? { ...r, yearSource: 'manual', term: '確認済みの冬期' } : r) };
  const changed = structuredClone(data); Object.assign(changed.courses[0].schoolings[1], { rawGrade: 'A+', grade: 'A+' });
  const next = applyImport(before, importPreview(changed, offerings, before.importedStudyRecords, before.importedCourseAchievements), offerings);
  assert.equal(next.importedStudyRecords.length, 3); assert.equal(next.importedStudyRecords[1], before.importedStudyRecords[1]);
  assert.equal(next.importedStudyRecords[2].id, before.importedStudyRecords[2].id); assert.equal(next.importedStudyRecords[2].grade, 'A+');
  assert.deepEqual([next.importedStudyRecords[2].offeringId, next.importedStudyRecords[2].term, next.importedStudyRecords[2].yearSource], [winter.id, '確認済みの冬期', 'manual']);
});
for (const ambiguous of [false, true]) test(`winter import: extractor through contract/preview/apply/display retains both components (ambiguous=${ambiguous})`, () => {
  const [correspondence, winter] = economicsOfferings();
  // Controlled fixture names test matching separately from the actual decorated catalog name.
  const school = { ...winter, name: '経済学' };
  const offerings = ambiguous ? [correspondence, school, { ...school, id: 'fixture-other-schooling' }] : [correspondence, school];
  for (const slot of [0, 1]) {
    const data = extractedEconomics(slot); const snapshot = structuredClone(data);
    assert.equal(isHoseiGradeImportV1(data), true); assert.deepEqual(data, snapshot);
    const preview = importPreview(data, offerings);
    assert.deepEqual(preview.map(u => u.method), ['correspondence', 'schooling']);
    const schooling = preview[1]; assert.equal(schooling.term, '冬期'); assert.equal(schooling.credits, 2); assert.equal(schooling.grade, 'A');
    assert.equal(schooling.match, ambiguous ? 'ambiguous' : 'exact_unique');
    const state = applyImport(initialState(), preview, offerings);
    assert.deepEqual(state.importedStudyRecords.map(r => r.method), ['correspondence', 'schooling']);
    assert.equal(state.importedStudyRecords[1].term, '冬期'); assert.equal(state.importedStudyRecords[1].credits, 2);
    assert.equal(state.importedStudyRecords[1].offeringId, ambiguous ? null : winter.id);
    assert.equal(state.importedCourseAchievements.length, 1); assert.equal(state.importedCourseAchievements[0].earnedCreditsTotal, 4);
    assert.deepEqual(state.items, [], 'completed source retains both details without allocating its aggregate to either Offering');
    assert.equal(deriveCurriculumCourseProgress(state.items, catalog, state.importedCourseAchievements).courses.find(c => c.curriculumCourseId === correspondence.curriculumCourseId).earnedCredits, 4);
    const map = new Map(offerings.map(o => [o.id, o]));
    assert.ok(createUnifiedCourseRows(state.items, state.importedCourseAchievements, map).some(r => r.importedAchievements.length));
    const html = renderToStaticMarkup(createElement(ImportedManagementRows, { records: state.importedStudyRecords, courseRows: state.importedCourseAchievements, offerings, disabled: false, onChange: () => {}, onChangeCourse: () => {}, onDelete: () => {} }));
    assert.match(html, /— 通信/); assert.match(html, /— スクーリング/); assert.match(html, /value="冬期"/);
    const values = new Map(); const store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
    const fixtureCatalog = { ...catalog, offerings };
    saveState(store, state, null, fixtureCatalog); assert.deepEqual(loadState(store, fixtureCatalog).state, state);
  }
});
test('winter reimport: new schooling details are selectable even when an existing source aggregate is unchanged', () => {
  const offerings = economicsOfferings(); const data = extractedEconomics();
  const incomplete = structuredClone(data);
  incomplete.courses[0].schoolings = [incomplete.courses[0].schoolings[1], incomplete.courses[0].schoolings[1]];
  const before = applyImport(initialState(), importPreview(incomplete, offerings), offerings); const snapshot = structuredClone(before);
  assert.equal(before.importedStudyRecords.length, 1);
  const preview = importPreview(data, offerings, before.importedStudyRecords, before.importedCourseAchievements);
  assert.equal(preview[1].duplicate, false); assert.equal(preview[1].sourceExistingId, before.importedCourseAchievements[0].id);
  assert.equal(preview[1].sourceDuplicate, false); assert.equal(preview[1].selected, true);
  assert.equal(applyImport(before, preview.map(u => ({ ...u, selected: false })), offerings), before);
  const next = applyImport(before, preview, offerings);
  assert.equal(next.importedStudyRecords.length, 2); assert.equal(next.importedStudyRecords[1].method, 'schooling');
  assert.equal(next.importedStudyRecords[1].sourceCourseId, before.importedCourseAchievements[0].id);
  assert.equal(next.importedCourseAchievements.length, 1); assert.equal(importedEarnedCreditsTotal(next.importedCourseAchievements), 4);
  assert.deepEqual(before, snapshot);
  const again = importPreview(data, offerings, next.importedStudyRecords, next.importedCourseAchievements);
  assert.equal(applyImport(next, again, offerings), next);
  const intentionallyRemoved = { ...next, importedStudyRecords: next.importedStudyRecords.slice(0, 1) };
  assert.equal(applyImport(intentionallyRemoved, importPreview(data, offerings, intentionallyRemoved.importedStudyRecords, intentionallyRemoved.importedCourseAchievements), offerings), intentionallyRemoved);
});
test('winter actual catalog: the decorated Offering is unmatched, but the source schooling record remains visible', () => {
  const data = extractedEconomics(); const preview = importPreview(data, catalog.offerings);
  assert.equal(preview[1].match, 'unmatched'); assert.equal(preview[1].offeringId, null);
  const state = applyImport(initialState(), preview, catalog.offerings);
  assert.equal(state.importedStudyRecords.length, 2);
  assert.equal(state.importedStudyRecords[1].method, 'schooling'); assert.equal(state.importedStudyRecords[1].term, '冬期');
  const html = renderToStaticMarkup(createElement(ImportedManagementRows, { records: state.importedStudyRecords, courseRows: state.importedCourseAchievements, offerings: catalog.offerings, disabled: false, onChange: () => {}, onChangeCourse: () => {}, onDelete: () => {} }));
  assert.match(html, /— スクーリング/); assert.match(html, /value="冬期"/);
});
test('communication split2: Economics report1 passed and exam S use an effective 1-report requirement', () => {
  const [o] = economicsOfferings(); const i = { ...item(o), courseCreditContribution: 2 };
  const saved = { ...setReportGrade(progressForCorrespondence(o, {}), 1, 'A'), examGrade: 'S' };
  assert.equal(progressSummaryForOffering(i, o, { [o.id]: saved }, {}), 'リポート 1/1・試験 S');
  const html = renderToStaticMarkup(createElement(CorrespondenceDetails, { item: i, offering: o, saved, disabled: false, onChange: () => {}, onChangeItem: () => {} }));
  assert.match(html, /必要リポート: 1件/); assert.match(html, /通信学習分: 単位修得条件達成/);
  assert.doesNotMatch(html, /リポート 2<select/);
});
test('communication method UI: four-credit correspondence offers methods and a schooling advisory without a hard block', () => {
  const [o] = economicsOfferings(); const i = { ...item(o), courseCreditContribution: 2 };
  const html = renderToStaticMarkup(createElement(CorrespondenceDetails, { item: i, offering: o, saved: progressForCorrespondence(o, {}), disabled: false, onChange: () => {}, onChangeItem: () => {} }));
  assert.match(html, /この通信学習の修得方法/); assert.match(html, /通信学習で4単位修得/); assert.match(html, /スクーリング2単位 \+ 通信学習2単位/);
  assert.match(html, /スクーリング2単位修得後に2単位試験を受験する方式です/);
  assert.doesNotMatch(html, /<select[^>]*disabled=""/);
});
test('communication full4: explicit4 retains the full two-report requirement without inferring split2 from grades', () => {
  const [o] = economicsOfferings(); const full = { ...item(o), courseCreditContribution: 4 }; const unset = item(o);
  const saved = { ...setReportGrade(progressForCorrespondence(o, {}), 1, 'A'), examGrade: 'S' }; const snapshot = structuredClone(saved);
  for (const i of [full, unset]) {
    const effective = effectiveCorrespondenceProgress(i, o, saved);
    assert.equal(effective.requiredReports, 2); assert.equal(correspondenceCreditResult(effective).creditEarned, false);
    assert.equal(progressSummaryForOffering(i, o, { [o.id]: saved }, {}), 'リポート 1/2・試験 S');
  }
  assert.equal(full.courseCreditContribution, 4); assert.equal('courseCreditContribution' in unset, false);
  assert.equal(full.status, 'planned'); assert.deepEqual(saved, snapshot);
});
test('communication verified full4 reports: split2 requires the first two and retains the other records', () => {
  const [base] = economicsOfferings(); const o = { ...base, id: 'verified-four-report-fixture' };
  requirementsByOfferingId[o.id] = { requiredReports: 4, sourcePage: 31, sourceLabel: 'synthetic verified four-topic requirement' };
  try {
    const i = { ...item(o), courseCreditContribution: 2 };
    const saved = { ...setReportGrade(setReportGrade(progressForCorrespondence(o, {}), 1, 'A'), 2, 'S'), examGrade: 'S' };
    const effective = effectiveCorrespondenceProgress(i, o, saved);
    assert.equal(effective.requiredReports, 2); assert.equal(correspondenceCreditResult(effective).creditEarned, true);
    assert.equal(effective.reports, saved.reports); assert.equal(saved.requiredReports, 4); assert.equal(saved.reports.length, 4);
    const full = effectiveCorrespondenceProgress({ ...i, courseCreditContribution: 4 }, o, saved);
    assert.equal(full.requiredReports, 4); assert.equal(correspondenceCreditResult(full).creditEarned, false);
    const html = renderToStaticMarkup(createElement(CorrespondenceDetails, { item: i, offering: o, saved, disabled: false, onChange: () => {}, onChangeItem: () => {} }));
    assert.match(html, /必要リポート: 2件/); assert.doesNotMatch(html, /リポート [34]<select/);
  } finally { delete requirementsByOfferingId[o.id]; }
});
test('communication split2: unknown, odd and unsupported full requirements remain pending', () => {
  const [base] = economicsOfferings(); const i = { ...item(base), courseCreditContribution: 2 };
  for (const count of [null, 1, 3, 5, 6]) {
    const source = count === null ? null : { requiredReports: count, sourcePage: 31, sourceLabel: 'synthetic source' };
    assert.equal(effectiveRequiredReportsFor(i, base, source), null);
  }
  assert.equal(effectiveRequiredReportsFor(i, base, { requiredReports: 2, sourcePage: 31, sourceLabel: 'verified2' }), 1);
  assert.equal(effectiveRequiredReportsFor(i, base, { requiredReports: 4, sourcePage: 31, sourceLabel: 'verified4' }), 2);
  const unknown = { ...base, id: 'unverified-communication-fixture' };
  const saved = { ...progressForCorrespondence(base, {}), offeringId: unknown.id, examGrade: 'S' };
  const effective = effectiveCorrespondenceProgress({ ...i, offeringId: unknown.id }, unknown, saved);
  assert.equal(effective.requiredReports, null); assert.equal(correspondenceCreditResult(effective).creditEarned, null);
  assert.equal(effective.reports, saved.reports, 'a saved number does not prove a source-backed split requirement');
});
test('communication method transitions retain extra reports through edit, reload, delete/undo and clearing', () => {
  const [o] = economicsOfferings();
  const saved = { ...setReportStatus(setReportGrade(progressForCorrespondence(o, {}), 2, 'B'), 1, 'submitted'), examGrade: 'A' };
  let state = { ...initialState(), items: [{ ...item(o), courseCreditContribution: 2 }], correspondenceProgress: { [o.id]: saved } };
  const extra = structuredClone(saved.reports[1]); const storeValues = new Map(); const store = { getItem: k => storeValues.get(k) ?? null, setItem: (k, v) => storeValues.set(k, v) };
  let raw = null;
  for (const credits of [2, 4, 2]) {
    state = { ...state, items: updatePlannerItem(state.items, o.id, { courseCreditContribution: credits }) };
    const edited = setReportGrade(state.correspondenceProgress[o.id], 1, 'S');
    state = { ...state, correspondenceProgress: { [o.id]: edited } };
    assert.equal(edited.requiredReports, 2); assert.deepEqual(edited.reports[1], extra);
    assert.equal(effectiveCorrespondenceProgress(state.items[0], o, edited).requiredReports, credits === 2 ? 1 : 2);
    raw = saveState(store, state, raw, catalog); assert.deepEqual(loadState(store, catalog).state, state);
    const html = renderToStaticMarkup(createElement(CorrespondenceDetails, { item: state.items[0], offering: o, saved: edited, disabled: false, onChange: () => {}, onChangeItem: () => {} }));
    if (credits === 4) assert.match(html, /リポート 2<select/); else assert.doesNotMatch(html, /リポート 2<select/);
  }
  const beforeDelete = structuredClone(state); const removed = removePlannerItem(state.items, o.id);
  const deleted = { ...state, items: [] }; raw = saveState(store, deleted, raw, catalog);
  const restored = { ...deleted, items: restorePlannerItem(deleted.items, removed) }; saveState(store, restored, raw, catalog);
  assert.deepEqual(loadState(store, catalog).state, beforeDelete); assert.equal(restored.schemaVersion, 22);
  const cleared = updatePlannerItem(restored.items, o.id, { courseCreditContribution: undefined });
  assert.equal('courseCreditContribution' in cleared[0], false);
  assert.equal(effectiveCorrespondenceProgress(cleared[0], o, saved).requiredReports, 2);
});
test('communication Economics: split2 + earned schooling2 completes4, full4 retains excess2 and summaries/export agree', () => {
  const [o, schooling] = economicsOfferings(); const map = new Map(catalog.offerings.map(o => [o.id, o]));
  const split = { ...item(o, 'earned'), courseCreditContribution: 2 }; const items = [item(schooling, 'earned'), split];
  const course = deriveCurriculumCourseProgress(items, catalog).courses.find(c => c.curriculumCourseId === o.curriculumCourseId);
  assert.deepEqual([course.earnedCredits, course.projectedCredits, course.earnedExcessCredits], [4, 4, 0]);
  assert.equal(summarizeCredits(items, map).earned, 4);
  assert.equal(summarizeCategories(items, catalog, null).reduce((sum, r) => sum + r.earned, 0), 4);
  assert.equal(annualCreditLimitReferences(items, map)[0].correspondenceCredits, 2);
  const full = deriveCurriculumCourseProgress([items[0], { ...split, courseCreditContribution: 4 }], catalog).courses.find(c => c.curriculumCourseId === o.curriculumCourseId);
  assert.deepEqual([full.earnedCredits, full.earnedExcessCredits], [6, 2]);
  const saved = { ...setReportGrade(progressForCorrespondence(o, {}), 1, 'A'), examGrade: 'S' };
  const state = { ...initialState(), items, correspondenceProgress: { [o.id]: saved } };
  const exported = plannerExportPresentation(state, catalog).rows.find(row => row.title === o.name);
  assert.deepEqual([exported.requiredReports, exported.passedReports, exported.correspondenceResult], [1, 1, '単位修得条件達成']);
  assert.deepEqual(exported.courseCreditContribution, 2); assert.equal(saved.requiredReports, 2);
});

test('annual official: linked correspondence Offering4 and official2 agree across all four credit views', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o]));
  const row = official(f, 2, { categoryRaw: '専門教育' });
  const items = [{ ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id }];
  const snapshot = structuredClone({ items, row }); const scope = f.programs.find(p => !p.isCommon).scopeId;
  const derived = deriveImportedAchievements([], map, items, [row], f, scope);
  const summary = summarizeCredits(derived.plannerItems, map);
  const categories = summarizeCategories(derived.plannerItems, f, scope, [], derived.categoryItems, derived.categoryOfferings, derived.categoryOverrides);
  assert.equal(progress(f, items, [row]).earnedCredits, 2);
  assert.equal(summary.earned + importedEarnedCreditsTotal([row]), 2);
  assert.equal(summary.earned, 0, 'source-linked earned is excluded from plan-only credits');
  assert.equal(categories.find(row => row.category === '専門教育').earned, 2);
  assert.equal(annualCreditLimitReferences(items, map, [row])[0].correspondenceCredits, 2);
  const html = renderToStaticMarkup(createElement(CreditSummary, { summary, importedEarnedCredits: importedEarnedCreditsTotal([row]) }));
  assert.match(html, /成績表の修得済み<\/p><p[^>]*>2<span/);
  assert.deepEqual({ items, row }, snapshot); assert.equal('courseCreditContribution' in items[0], false);
  assert.equal(initialState().schemaVersion, 22);
  for (const program of f.programs.filter(p => !p.isCommon)) {
    const run = items => calculateGraduationProgress(items, f, program.scopeId, [], 'undecided', [], [row]);
    assert.deepEqual(run(items), run([])); assert.equal(run(items).graduationCheckComplete, false);
  }
});
for (const credits of [4, 0]) test(`annual official: source-linked official${credits} is authoritative even over explicit metadata`, () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o])); const row = official(f, credits);
  for (const explicit of [undefined, 0, 2, 4]) {
    const linked = { ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id, ...(explicit === undefined ? {} : { courseCreditContribution: explicit }) };
    assert.equal(annualCreditLimitReferences([linked], map, [row])[0].correspondenceCredits, credits);
    assert.equal(linked.courseCreditContribution, explicit);
  }
});
test('annual official: official null remains unknown even with explicit2 and known schooling2', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o])); const row = official(f, null);
  for (const explicit of [undefined, 2]) {
    const linked = { ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id, ...(explicit === undefined ? {} : { courseCreditContribution: explicit }) };
    const items = [linked, item(f.offerings[0])]; const snapshot = structuredClone({ items, row });
    const annual = annualCreditLimitReferences(items, map, [row])[0];
    assert.deepEqual(annual, { year: 2026, correspondenceCredits: 0, unknownCorrespondenceItems: 1, schoolingRegistrationCredits: 2, knownTotalCredits: 2, exceedsOfficial49: false });
    assert.deepEqual({ items, row }, snapshot);
  }
});
test('annual official UI: a null-only correspondence year is visible as unknown, not confirmed zero or four', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o])); const row = official(f, null);
  const rows = annualCreditLimitReferences([{ ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id }], map, [row]);
  assert.equal(rows.length, 1); assert.equal(rows[0].unknownCorrespondenceItems, 1); assert.equal(rows[0].knownTotalCredits, 0);
  const html = renderToStaticMarkup(createElement(AnnualCreditLimitNotice, { rows }));
  assert.match(html, /通信 既知0単位（未確定1件）/);
  assert.match(html, /既知合計だけでは49単位以内か確認できません/);
  assert.doesNotMatch(html, /通信 4単位|通信 0単位/);
});
test('annual official: only earned source-linked correspondence uses the matching official row', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o])); const row = official(f, 0);
  for (const status of ['planned', 'in_progress', 'waiting', 'failed', 'dropped']) {
    const linked = { ...item(f.offerings[2], status), importedSourceCourseId: row.id, courseCreditContribution: 2 };
    assert.equal(annualCreditLimitReferences([linked], map, [row])[0].correspondenceCredits, 2, status);
    delete linked.courseCreditContribution;
    assert.equal(annualCreditLimitReferences([linked], map, [row])[0].correspondenceCredits, 4, status);
  }
  for (const extra of [{}, { importedSourceCourseId: 'different-source' }]) {
    const unlinked = { ...item(f.offerings[2], 'earned'), ...extra };
    assert.equal(annualCreditLimitReferences([unlinked], map, [row])[0].correspondenceCredits, 4);
    assert.equal(annualCreditLimitReferences([{ ...unlinked, courseCreditContribution: 2 }], map, [row])[0].correspondenceCredits, 2);
  }
});
test('annual official: schooling registration ignores source-linked official and explicit contribution', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o]));
  for (const credits of [null, 0, 2, 4]) for (const explicit of [undefined, 0, 1, 2]) {
    const row = official(f, credits);
    const linked = { ...item(f.offerings[0], 'earned'), importedSourceCourseId: row.id, ...(explicit === undefined ? {} : { courseCreditContribution: explicit }) };
    const annual = annualCreditLimitReferences([linked], map, [row])[0];
    assert.equal(annual.schoolingRegistrationCredits, 2); assert.equal(annual.knownTotalCredits, 2);
    assert.equal(annual.unknownCorrespondenceItems, 0);
  }
});
test('annual official: 49-credit boundary uses official2/4/0 and retains unknown separately', () => {
  const f = fixture(); const schools = Array.from({ length: 24 }, (_, index) => ({ ...f.offerings[0], id: `official-annual-school-${index}`, credits: index === 0 ? 1 : 2 }));
  const map = new Map([...schools, f.offerings[2]].map(o => [o.id, o])); const linked = { ...item(f.offerings[2], 'earned'), importedSourceCourseId: 'official-row' };
  const items = [...schools.map(o => item(o)), linked];
  for (const [credits, total, exceeds, unknown] of [[2, 49, false, 0], [4, 51, true, 0], [0, 47, false, 0], [null, 47, false, 1]]) {
    const annual = annualCreditLimitReferences(items, map, [official(f, credits)])[0];
    assert.deepEqual([annual.knownTotalCredits, annual.exceedsOfficial49, annual.unknownCorrespondenceItems], [total, exceeds, unknown]);
  }
});
test('annual official: known over49 still warns when another correspondence contribution is unknown', () => {
  const f = fixture(); const schooling = { ...f.offerings[0], credits: 50 }; const map = new Map([schooling, f.offerings[2]].map(o => [o.id, o]));
  const row = official(f, null); const items = [item(schooling), { ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id }];
  const rows = annualCreditLimitReferences(items, map, [row]);
  assert.equal(rows[0].knownTotalCredits, 50); assert.equal(rows[0].exceedsOfficial49, true); assert.equal(rows[0].unknownCorrespondenceItems, 1);
  const html = renderToStaticMarkup(createElement(AnnualCreditLimitNotice, { rows }));
  assert.match(html, /49単位を超える見込み/); assert.match(html, /未確定1件/);
});

test('contribution summaries: schooling earned2 plus correspondence explicit2 agree with CourseProgress4', () => {
  const f = fixture(); const items = [item(f.offerings[0], 'earned'), { ...item(f.offerings[2], 'earned'), courseCreditContribution: 2 }];
  const summary = summarizeCredits(items, new Map(f.offerings.map(o => [o.id, o])));
  assert.equal(progress(f, items).earnedCredits, 4);
  assert.deepEqual(summary, { earned: 4, in_progress: 0, planned: 0, unknownCreditItems: 0 });
  const html = renderToStaticMarkup(createElement(CreditSummary, { summary }));
  assert.match(html, /修得済み（計画のみ）<\/p><p[^>]*>4<span/);
});
test('contribution summaries: the mapped category counts the same earned4', () => {
  const f = fixture(); const items = [item(f.offerings[0], 'earned'), { ...item(f.offerings[2], 'earned'), courseCreditContribution: 2 }];
  const scope = f.programs.find(p => !p.isCommon && isCreditCategory(createCreditClassifier(f, p.scopeId)(f.offerings[0])))?.scopeId;
  assert.ok(scope);
  const category = createCreditClassifier(f, scope)(f.offerings[0]);
  const rows = summarizeCategories(items, f, scope);
  const row = rows.find(row => row.category === category);
  assert.deepEqual([row.count, row.earned, row.in_progress, row.planned], [2, 4, 0, 0]);
  assert.equal(rows.reduce((sum, row) => sum + row.earned, 0), 4);
  const html = renderToStaticMarkup(createElement(CategorySummary, { rows }));
  assert.match(html, /<dt>修得済み<\/dt><dd>4単位<\/dd>/);
});
for (const status of ['planned', 'in_progress']) test(`contribution summaries: correspondence ${status} explicit2 uses2`, () => {
  const f = fixture(); const items = [{ ...item(f.offerings[2], status), courseCreditContribution: 2 }];
  assert.equal(summarizeCredits(items, new Map(f.offerings.map(o => [o.id, o])))[status], 2);
  const rows = summarizeCategories(items, f, f.programs.find(p => !p.isCommon).scopeId);
  assert.equal(rows.reduce((sum, row) => sum + row[status], 0), 2);
});
test('contribution summaries: waiting, failed and dropped keep their existing summary status policy', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o]));
  for (const status of ['waiting', 'failed', 'dropped']) {
    assert.deepEqual(summarizeCredits([{ ...item(f.offerings[2], status), courseCreditContribution: 2 }], map),
      { earned: 0, in_progress: 0, planned: 0, unknownCreditItems: 0 });
  }
});
test('annual contribution: correspondence explicit2 plus schooling registration2 totals4', () => {
  const f = fixture(); const items = [item(f.offerings[0], 'earned'), { ...item(f.offerings[2], 'earned'), courseCreditContribution: 2 }];
  const map = new Map(f.offerings.map(o => [o.id, o]));
  assert.deepEqual(annualCreditLimitReferences(items, map), [{ year: 2026, correspondenceCredits: 2, unknownCorrespondenceItems: 0, schoolingRegistrationCredits: 2, knownTotalCredits: 4, exceedsOfficial49: false }]);
});
test('annual contribution: correspondence explicit4 remains4', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o]));
  assert.equal(annualCreditLimitReferences([{ ...item(f.offerings[2]), courseCreditContribution: 4 }], map)[0].correspondenceCredits, 4);
});
test('annual contribution: the 49-credit reference uses explicit correspondence without capping totals', () => {
  const f = fixture(); const schools = Array.from({ length: 24 }, (_, index) => ({ ...f.offerings[0], id: `annual-schooling-${index}` }));
  const map = new Map([...schools, f.offerings[2]].map(o => [o.id, o]));
  const items = schools.map(o => item(o));
  const run = credits => annualCreditLimitReferences([...items, { ...item(f.offerings[2]), courseCreditContribution: credits }], map)[0];
  assert.deepEqual(run(2), { year: 2026, correspondenceCredits: 2, unknownCorrespondenceItems: 0, schoolingRegistrationCredits: 48, knownTotalCredits: 50, exceedsOfficial49: true });
  assert.deepEqual(run(0), { year: 2026, correspondenceCredits: 0, unknownCorrespondenceItems: 0, schoolingRegistrationCredits: 48, knownTotalCredits: 48, exceedsOfficial49: false });
});
test('annual contribution: schooling always uses Offering registration credits despite smaller contribution', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o]));
  const items = [{ ...item(f.offerings[0], 'earned'), courseCreditContribution: 1 }];
  assert.equal(summarizeCredits(items, map).earned, 1);
  assert.deepEqual(annualCreditLimitReferences(items, map)[0], { year: 2026, correspondenceCredits: 0, unknownCorrespondenceItems: 0, schoolingRegistrationCredits: 2, knownTotalCredits: 2, exceedsOfficial49: false });
});
test('contribution summaries and annual reference: absent metadata keeps legacy Offering credits', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o]));
  const items = [item(f.offerings[0], 'earned'), item(f.offerings[2], 'earned')];
  assert.equal(summarizeCredits(items, map).earned, 6);
  assert.deepEqual(annualCreditLimitReferences(items, map)[0], { year: 2026, correspondenceCredits: 4, unknownCorrespondenceItems: 0, schoolingRegistrationCredits: 2, knownTotalCredits: 6, exceedsOfficial49: false });
});
test('contribution summaries and annual reference: explicit zero does not fall back to Offering credits', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o]));
  const items = [{ ...item(f.offerings[2], 'earned'), courseCreditContribution: 0 }];
  assert.equal(summarizeCredits(items, map).earned, 0);
  assert.equal(annualCreditLimitReferences(items, map)[0].correspondenceCredits, 0);
});
test('contribution summaries: source-linked metadata cannot override official4 or double count it', () => {
  const f = fixture(); const map = new Map(f.offerings.map(o => [o.id, o]));
  const row = official(f, 4, { categoryRaw: '専門教育' });
  const items = [{ ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id, courseCreditContribution: 2 }];
  const scope = f.programs.find(p => !p.isCommon).scopeId;
  const derived = deriveImportedAchievements([], map, items, [row], f, scope);
  assert.equal(progress(f, items, [row]).earnedCredits, 4);
  assert.equal(summarizeCredits(derived.plannerItems, map).earned, 0);
  const merged = new Map([...f.offerings, ...derived.offerings].map(o => [o.id, o]));
  assert.equal(summarizeCredits([...derived.plannerItems, ...derived.items], merged).earned, 4);
  const categories = summarizeCategories(derived.plannerItems, f, scope, [], derived.categoryItems, derived.categoryOfferings, derived.categoryOverrides);
  assert.equal(categories.find(row => row.category === '専門教育').earned, 4);
  for (const program of f.programs.filter(p => !p.isCommon)) {
    const run = items => calculateGraduationProgress(items, f, program.scopeId, [], 'undecided', [], [row]);
    assert.deepEqual(run(items), run([])); assert.equal(run(items).graduationCheckComplete, false);
  }
});

test('2+2: schooling earned2 plus correspondence explicit2 completes4 without excess', () => {
  const f = fixture(); const p = progress(f, [item(f.offerings[0], 'earned'), { ...item(f.offerings[2], 'earned'), courseCreditContribution: 2 }]);
  assert.deepEqual([p.earnedCredits, p.projectedCredits, p.completion, p.projectedCompletion, p.earnedExcessCredits, p.projectedExcessCredits], [4, 4, 'complete', 'complete', 0, 0]);
  assert.deepEqual(p.attempts.map(attempt => attempt.earnedContribution), [2, 2]);
});
test('2+2: correspondence explicit4 alone completes4; explicit independent6 retains excess2', () => {
  const f = fixture(); const correspondence = { ...item(f.offerings[2], 'earned'), courseCreditContribution: 4 };
  const alone = progress(f, [correspondence]);
  assert.deepEqual([alone.earnedCredits, alone.completion, alone.earnedExcessCredits], [4, 'complete', 0]);
  const p = progress(f, [item(f.offerings[0], 'earned'), correspondence]);
  assert.deepEqual([p.earnedCredits, p.projectedCredits, p.earnedExcessCredits, p.projectedExcessCredits], [6, 6, 2, 2]);
  assert.equal(summarizeCredits([item(f.offerings[0], 'earned'), correspondence], new Map(f.offerings.map(o => [o.id, o]))).earned, 6);
});
for (const status of ['planned', 'in_progress', 'waiting']) test(`2+2: ${status} explicit2 projects4 then earned explicit2 remains4`, () => {
  const f = fixture(); const correspondence = { ...item(f.offerings[2], status), courseCreditContribution: 2 };
  for (const officialSource of [false, true]) {
    const rows = officialSource ? [official(f)] : [];
    const items = officialSource ? [correspondence] : [item(f.offerings[0], 'earned'), correspondence];
    const p = progress(f, items, rows);
    assert.deepEqual([p.earnedCredits, p.projectedCredits, p.projectedCompletion, p.projectedExcessCredits], [2, 4, 'complete', 0]);
    const changed = updatePlannerItem(items, correspondence.offeringId, { status: 'earned' });
    assert.equal(changed.at(-1).courseCreditContribution, 2);
    const earned = progress(f, changed, rows);
    assert.deepEqual([earned.earnedCredits, earned.projectedCredits, earned.completion, earned.earnedExcessCredits], [4, 4, 'complete', 0]);
  }
});
for (const status of ['failed', 'dropped']) test(`2+2: ${status} explicit contribution remains0`, () => {
  const f = fixture(); const p = progress(f, [item(f.offerings[0], 'earned'), { ...item(f.offerings[2], status), courseCreditContribution: 2 }]);
  assert.deepEqual([p.earnedCredits, p.projectedCredits, p.completion], [2, 2, 'incomplete']);
  assert.deepEqual([p.attempts[1].earnedContribution, p.attempts[1].projectedContribution], [0, 0]);
});
test('2+2: official aggregate owns source-linked earned even with explicit override', () => {
  const f = fixture();
  for (const credits of [null, 0, 2, 4]) {
    const row = official(f, credits);
    const p = progress(f, [{ ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id, courseCreditContribution: 2 }], [row]);
    assert.deepEqual([p.earnedCredits, p.projectedCredits], [credits ?? 0, credits ?? 0]);
    assert.equal(p.attempts[0].earnedContribution, 0);
  }
});
test('2+2: separate explicit earned2 adds to official2 in CourseProgress while graduation retains official priority', () => {
  const f = fixture(); const row = official(f); const items = [{ ...item(f.offerings[2], 'earned'), courseCreditContribution: 2 }];
  assert.equal(progress(f, items, [row]).earnedCredits, 4);
  for (const program of catalog.programs.filter(program => !program.isCommon)) {
    const run = items => calculateGraduationProgress(items, f, program.scopeId, [], 'undecided', [], [row]);
    assert.deepEqual(run(items), run([])); assert.equal(run(items).graduationCheckComplete, false);
  }
});
test('2+2: contribution validation rejects invalid bounds without imposing a CurriculumCourse cap', () => {
  const f = fixture(); const o = f.offerings[2]; const state = credits => ({ ...initialState(), items: [{ ...item(o), courseCreditContribution: credits }] });
  for (const credits of [-1, 5, NaN, Infinity, -Infinity, null, '2']) assert.equal(validateState(state(credits), f), false, String(credits));
  for (const credits of [0, 2, 4]) assert.equal(validateState(state(credits), f), true, String(credits));
  f.course.curriculumCredits = 2;
  assert.equal(validateState(state(4), f), true, 'course target is not a per-attempt input bound');
  const unknown = { ...f, offerings: f.offerings.map(offering => offering.id === o.id ? { ...offering, credits: null } : offering) };
  assert.equal(validateState(state(2), unknown), false, 'an unknown Offering cannot supply a safe upper bound');
  assert.equal(validateState({ ...initialState(), items: [item(o)] }, unknown), true);
});
test('2+2: explicit zero overrides Offering credits without affecting repeatable policy', () => {
  const f = fixture(); const p = progress(f, [{ ...item(f.offerings[2], 'earned'), courseCreditContribution: 0 }]);
  assert.deepEqual([p.earnedCredits, p.projectedCredits, p.completion], [0, 0, 'incomplete']);
  const course = catalog.curriculum.courses.find(course => course.canonicalName === '基礎特講');
  const offering = catalog.offerings.find(offering => offering.curriculumCourseId === course.id && offering.credits > 0);
  const repeatable = deriveCurriculumCourseProgress([{ ...item(offering, 'earned'), courseCreditContribution: offering.credits }], catalog).courses[0];
  assert.equal(repeatable.completion, 'repeatable'); assert.equal(repeatable.warnings.includes(COMPLETED_COURSE_ADVISORY), false);
});
test('2+2: v22 metadata survives edit, save/reload, delete/undo and full import undo; clearing restores the legacy default', () => {
  const f = fixture(); const o = f.offerings[2];
  const state = { ...initialState(), items: [item(f.offerings[0], 'earned'), { ...item(o), courseCreditContribution: 2 }] };
  const snapshot = structuredClone(state); const values = new Map();
  const store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const raw = saveState(store, state, null, f);
  assert.deepEqual(loadState(store, f).state, state); assert.equal(state.schemaVersion, 22);
  const removed = removePlannerItem(state.items, o.id);
  const deleted = { ...state, items: state.items.slice(0, 1) };
  const deletedRaw = saveState(store, deleted, raw, f);
  const restored = { ...deleted, items: restorePlannerItem(deleted.items, removed) };
  const restoredRaw = saveState(store, restored, deletedRaw, f);
  assert.deepEqual(loadState(store, f).state, state);
  const imported = applyImport(restored, importPreview(importData(f.course.canonicalName, 2), [o], [], [], { curriculum: f.curriculum, mappings: f.mappings }), [o]);
  assert.equal(imported.items[1].courseCreditContribution, 2);
  const importedRaw = saveState(store, imported, restoredRaw, f);
  saveState(store, snapshot, importedRaw, f);
  assert.deepEqual(loadState(store, f).state, snapshot);
  const cleared = updatePlannerItem(state.items, o.id, { courseCreditContribution: undefined });
  assert.equal('courseCreditContribution' in cleared[1], false);
  assert.equal(progress(f, cleared).projectedCredits, 6);
  const legacy = { ...state, items: cleared };
  saveState(store, legacy, values.get(STORAGE_KEY), f);
  assert.equal(loadState(store, f).error, null); assert.deepEqual(loadState(store, f).state, legacy);
  assert.deepEqual(state, snapshot, 'no lifecycle path mutates the undo snapshot');
});
test('2+2: annual correspondence uses explicit contribution, unified rows retain metadata, exports distinguish explicit contribution', () => {
  const f = fixture(); const i = { ...item(f.offerings[2]), courseCreditContribution: 2 }; const state = { ...initialState(), items: [i] };
  const map = new Map(f.offerings.map(offering => [offering.id, offering]));
  assert.equal(annualCreditLimitReferences(state.items, map)[0].knownTotalCredits, 2);
  assert.equal(groupAnnualPlan(state.items, map)[0].groups[0].items[0], i);
  assert.equal(createUnifiedCourseRows(state.items, [], map)[0].plannerItem.courseCreditContribution, 2);
  const exported = plannerExportPresentation(state, f);
  assert.equal(exported.rows[0].credits, 4); assert.equal(exported.rows[0].courseCreditContribution, 2);
  const csv = plannerExportCsv(exported);
  assert.match(csv, /科目進捗への寄与単位（明示）/); assert.ok(csv.endsWith(',2'));
  const html = renderToStaticMarkup(createElement(PlannerExportActions, { presentation: exported }));
  assert.match(html, /科目進捗への寄与: 2単位/);
});
test('2+2 UI: only exact four-credit correspondence exposes a manual 2/4 selector without guessing', () => {
  const f = fixture(); const items = [item(f.offerings[0], 'earned'), item(f.offerings[2])];
  const render = (f, items, rows = [], props = {}) => renderToStaticMarkup(createElement(CourseProgress, {
    progress: deriveCurriculumCourseProgress(items, f, rows), catalog: f, onChange: () => {}, ...props,
  }));
  const html = render(f, items);
  assert.equal((html.match(/<select /g) ?? []).length, 1);
  assert.match(html, /value="" selected="">未設定（開講の4単位を使用）/);
  assert.match(html, /value="split2">スクーリング2単位 \+ 通信学習2単位/); assert.match(html, /value="full4">通信学習で4単位修得/);
  assert.match(html, /この通信学習の修得方法/);
  const chosen = render(f, [items[0], { ...items[1], courseCreditContribution: 2 }]);
  assert.match(chosen, /value="split2" selected=""/); assert.match(chosen, /予定込み 4 \/ 4/); assert.doesNotMatch(chosen, /超過候補/);
  assert.match(render(f, items, [], { disabled: true }), /<select[^>]*disabled=""/);
  assert.doesNotMatch(render(f, items, [], { onChange: undefined }), /<select /);
  assert.doesNotMatch(render(f, [items[0]]), /<select /);
  const twoCredit = { ...f, curriculum: { ...f.curriculum, courses: [{ ...f.course, curriculumCredits: 2 }] } };
  assert.doesNotMatch(render(twoCredit, items), /<select /);
  const ambiguous = { ...f, offerings: f.offerings.map(offering => ({ ...offering, curriculumCourseId: null })) };
  assert.doesNotMatch(render(ambiguous, items), /<select /);
  const row = official(f, 4);
  const linked = { ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id, courseCreditContribution: 2 };
  const linkedHtml = render(f, [linked], [row]);
  assert.doesNotMatch(linkedHtml, /<select /); assert.match(linkedHtml, /修得単位は公式集計を優先/);
});
test('2+2 UI: actual Economics schooling2 and correspondence explicit2 display completed4 with no excess', () => {
  const course = catalog.curriculum.courses.find(course => course.canonicalName === '経済学' && course.curriculumCredits === 4
    && catalog.offerings.some(offering => offering.curriculumCourseId === course.id && offering.method === 'schooling' && offering.credits === 2)
    && catalog.offerings.some(offering => offering.curriculumCourseId === course.id && offering.method === 'correspondence' && offering.credits === 4));
  assert.ok(course);
  const schooling = catalog.offerings.find(offering => offering.curriculumCourseId === course.id && offering.method === 'schooling' && offering.credits === 2);
  const correspondence = catalog.offerings.find(offering => offering.curriculumCourseId === course.id && offering.method === 'correspondence' && offering.credits === 4);
  const result = deriveCurriculumCourseProgress([item(schooling, 'earned'), { ...item(correspondence, 'earned'), courseCreditContribution: 2 }], catalog);
  assert.equal(result.courses[0].earnedCredits, 4); assert.equal(result.courses[0].earnedExcessCredits, 0);
  const html = renderToStaticMarkup(createElement(CourseProgress, { progress: result, catalog, onChange: () => {} }));
  assert.match(html, /修得済み 4 \/ 4/); assert.match(html, /予定込み 4 \/ 4/); assert.doesNotMatch(html, /超過候補/);
});

test('course progress A: official exact earned2 with unknown opening plus planned2 gives earned2/projected4', () => {
  const f = fixture(); const row = official(f); const p = progress(f, [item(f.offerings[0])], [row]);
  assert.deepEqual([p.earnedCredits, p.projectedCredits, p.remainingCredits, p.completion, p.projectedCompletion], [2, 4, 2, 'incomplete', 'complete']);
  assert.equal(p.officialAchievements[0].selectedOfferingId, null);
});
test('CourseProgress retains separate earned attempts after planned2 becomes earned2; graduation keeps official priority', () => {
  const f = fixture(); const row = official(f, 2, { selectedOfferingId: f.offerings[0].id, offeringMatch: 'exact_unique', candidateOfferingIds: [f.offerings[0].id] });
  const items = [item(f.offerings[1])];
  const planned = progress(f, items, [row]);
  assert.deepEqual([planned.earnedCredits, planned.projectedCredits], [2, 4]);
  const changed = updatePlannerItem(items, items[0].offeringId, { status: 'earned' });
  const earned = progress(f, changed, [row]);
  assert.deepEqual([earned.earnedCredits, earned.projectedCredits, earned.completion, earned.projectedCompletion], [4, 4, 'complete', 'complete']);
  assert.equal(earned.attempts[0].earnedContribution, 2);
  assert.equal(earned.attempts[0].officialEarnedPreferred, false);
  assert.ok(earned.warnings.some(warning => warning.includes('成績表の再取込')));
  assert.deepEqual(plannerItemsWithoutOfficialEarned(changed, new Map(f.offerings.map(o => [o.id, o])), [row], f), []);
  for (const program of catalog.programs.filter(program => !program.isCommon)) {
    const run = items => calculateGraduationProgress(items, f, program.scopeId, [], 'undecided', [], [row]);
    assert.deepEqual(run(changed), run([]), program.department);
    assert.equal(run(changed).graduationCheckComplete, false);
  }
});
test('course progress B: two different earned2 offerings complete a four-credit course', () => {
  const f = fixture(); const items = f.offerings.slice(0, 2).map(o => item(o, 'earned')); const p = progress(f, items);
  assert.deepEqual([p.earnedCredits, p.projectedCredits, p.completion, p.attempts.length], [4, 4, 'complete', 2]);
  assert.equal(validateState({ ...initialState(), items }, f), true);
});
test('course progress C: correspondence earned4 completes a four-credit course', () => {
  const f = fixture(); const p = progress(f, [item(f.offerings[2], 'earned')]);
  assert.deepEqual([p.earnedCredits, p.completion, p.remainingCredits], [4, 'complete', 0]);
});
test('course progress D: only schooling earned2 remains incomplete', () => {
  const f = fixture(); const p = progress(f, [item(f.offerings[0], 'earned')]);
  assert.deepEqual([p.earnedCredits, p.projectedCredits, p.completion, p.projectedCompletion], [2, 2, 'incomplete', 'incomplete']);
});
test('official4 plus source-linked earned4 remains4 without a duplicate attempt contribution', () => {
  const f = fixture(); const row = official(f, 4);
  const p = progress(f, [{ ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id }], [row]);
  assert.equal(p.earnedCredits, 4); assert.equal(p.projectedCredits, 4);
  assert.ok(p.attempts.every(attempt => attempt.officialEarnedPreferred && attempt.earnedContribution === 0));
});
test('partial official aggregate2 never turns a four-credit earned auto item into four earned credits', () => {
  const f = fixture(); const row = official(f); const auto = { ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id };
  const p = progress(f, [auto, item(f.offerings[0])], [row]);
  assert.deepEqual([p.earnedCredits, p.projectedCredits], [2, 4]);
  assert.deepEqual([progress(f, [auto], [row]).earnedCredits, progress(f, [auto], [row]).projectedCredits], [2, 2]);
  const derived = deriveImportedAchievements([], new Map(f.offerings.map(o => [o.id, o])), [auto], [row], f);
  assert.equal(derived.plannerItems.length, 0);
  assert.equal(derived.offerings[0].credits, 2);
});
for (const status of ['planned', 'in_progress', 'waiting', 'failed', 'dropped']) test(`course progress: ${status} projected contribution`, () => {
  const f = fixture(); const p = progress(f, [item(f.offerings[0], status)], [official(f)]);
  assert.equal(p.earnedCredits, 2); assert.equal(p.projectedCredits, ['failed', 'dropped'].includes(status) ? 2 : 4);
});
test('ambiguous Offering remains in planner, annual and unified views without Course aggregation', () => {
  const f = fixture(); f.offerings[0].curriculumCourseId = null;
  f.curriculum.offeringRelations[0] = { offeringId: f.offerings[0].id, curriculumCourseId: null, candidateCurriculumCourseIds: [f.course.id, 'other-course'] };
  const items = [item(f.offerings[0], 'earned')]; const map = new Map(f.offerings.map(o => [o.id, o]));
  const result = deriveCurriculumCourseProgress(items, f);
  assert.equal(result.courses.length, 0); assert.match(result.unassigned[0].reason, /一意に判定できません/);
  assert.equal(groupAnnualPlan(items, map)[0].groups[0].items.length, 1);
  assert.equal(createUnifiedCourseRows(items, [], map).length, 1);
  const exact = deriveCurriculumCourseProgress(items, f, [official(f)]);
  assert.equal(exact.courses[0].earnedCredits, 2); assert.equal(exact.courses[0].attempts.length, 0);
});
test('different Offering identities remain editable, removable and restorable; same offering stays unique', () => {
  const f = fixture(); const items = f.offerings.slice(0, 2).map(o => item(o));
  const changed = updatePlannerItem(items, items[0].offeringId, { status: 'earned' });
  assert.equal(changed[1], items[1]);
  const removed = removePlannerItem(changed, items[0].offeringId);
  assert.deepEqual(restorePlannerItem(changed.slice(1), removed), changed);
  assert.equal(restorePlannerItem(changed, removed), null);
  assert.equal(validateState({ ...initialState(), items: [items[0], items[0]] }, f), false);
  assert.equal(searchOfferings(f.offerings, f.course.canonicalName).length, 3);
});
test('search retains both additional offerings after partial or full completion, with advisory only', () => {
  const f = fixture();
  for (const credits of [2, 4]) {
    const row = official(f, credits);
    const result = deriveCurriculumCourseProgress([{ ...item(f.offerings[0], 'earned'), importedSourceCourseId: row.id }], f, [row]);
    const html = renderToStaticMarkup(createElement(CourseSearch, { catalog: f, classify: createCreditClassifier(f, null), selectedScopeId: null,
      offerings: f.offerings, addedIds: new Set([f.offerings[0].id]), disabled: false, curriculumProgress: result, onAdd: () => {}, onAddPublicCourse: () => {} }));
    assert.equal((html.match(/>計画に追加<\/button>/g) ?? []).length, 2, 'two other offerings remain selectable');
    assert.equal((html.match(/>追加済み<\/button>/g) ?? []).length, 1);
    assert.equal(html.includes(COMPLETED_COURSE_ADVISORY), credits === 4);
  }
});
test('over-completion retains uncapped6 and reports2 excess candidates without invalidating credits', () => {
  const f = fixture(); const result = deriveCurriculumCourseProgress([item(f.offerings[0], 'earned'), item(f.offerings[2], 'earned')], f);
  const p = result.courses[0]; assert.deepEqual([p.earnedCredits, p.earnedExcessCredits, p.projectedExcessCredits, p.completion], [6, 2, 2, 'complete']);
  const html = renderToStaticMarkup(createElement(CourseProgress, { progress: result, catalog: f }));
  assert.match(html, /修得済み 4 \/ 4/); assert.match(html, /\+2単位 超過候補/);
});
test('unknown composition and unknown active offering credits never assert incomplete or complete', () => {
  const f = fixture(); f.course.curriculumCredits = null;
  assert.equal(progress(f, [item(f.offerings[2], 'earned')]).completion, 'unknown');
  f.course.curriculumCredits = 4; f.offerings[0].credits = null;
  const p = progress(f, [item(f.offerings[0], 'earned')]);
  assert.equal(p.completion, 'unknown'); assert.equal(p.remainingCredits, null); assert.equal(p.projectedCompletion, 'unknown');
});
test('official null or zero remains authoritative after an associated item was marked earned', () => {
  const f = fixture();
  for (const credits of [null, 0]) {
    const row = official(f, credits); const p = progress(f, [{ ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id }], [row]);
    assert.equal(p.earnedCredits, 0); assert.equal(p.completion, credits === null ? 'unknown' : 'incomplete');
  }
});
test('known repeatable institutional courses never receive the generic completed-Course advisory', () => {
  const names = ['基礎特講', '政治学', '法律学演習', '法律学特講', '総合特講', '経済学特講', '経営学特講', '史学演習', '歴史資料学', '（他学部・他学科公開科目）'];
  for (const name of names) {
    const course = catalog.curriculum.courses.find(course => course.canonicalName === name || (name === '史学演習' && /^史学演習[1-4]$/.test(course.canonicalName)) || (name === '歴史資料学' && course.canonicalName === '歴史資料学1〜6'));
    assert.ok(course, name);
    const f = { ...catalog, course };
    const p = deriveCurriculumCourseProgress([], f, [official(f, 16)]).courses[0];
    assert.equal(p.completion, 'repeatable', name); assert.equal(p.warnings.includes(COMPLETED_COURSE_ADVISORY), false, name);
  }
});
test('Media re-add advisory cites phone guidance and leaves the opening selectable, including after failure', () => {
  const f = fixture(); f.offerings[0].deliveryCategory = '前期メディア'; f.offerings[1].deliveryCategory = '後期メディア';
  const p = deriveCurriculumCourseProgress([item(f.offerings[0], 'failed')], f);
  assert.deepEqual(curriculumOfferingAdvisories(f.offerings[1], p), [MEDIA_REPEAT_ADVISORY]);
  assert.equal(searchOfferings(f.offerings, 'メディア').length, 2);
  assert.equal(curriculumOfferingAdvisories(f.offerings[2], p).includes(MEDIA_REPEAT_ADVISORY), false);
});
test('same-name History CurriculumCourses retain their official identities and independent totals', () => {
  const courses = catalog.curriculum.courses.filter(course => course.canonicalName === '日本史概説');
  assert.ok(courses.length > 1);
  const rows = courses.map((course, index) => official({ course, offerings: [catalog.offerings[0]] }, 2, { id: `history-${index}` }));
  const p = deriveCurriculumCourseProgress([], catalog, rows);
  assert.equal(p.courses.length, courses.length); assert.equal(new Set(p.courses.map(course => course.curriculumCourseId)).size, courses.length);
  assert.ok(p.courses.every(course => course.earnedCredits === 2));
});

test('Law conditional partial2 graduation count remains separate from incomplete2/4 Course progress', () => {
  const law = catalog.programs.find(program => program.department === '法律学科');
  const mappings = catalog.mappings.slice(0, 9).map((mapping, index) => ({ ...mapping, scopeId: law.scopeId,
    category: '専門教育', field: null, requirementType: index === 8 ? '選択' : '選択必修', curriculumCredits: 4 }));
  const courses = mappings.map((mapping, index) => ({ id: `curriculum:${mapping.mappingId}`, canonicalName: `法律進捗${index}`,
    curriculumCredits: 4, mappingIds: [mapping.mappingId], scopeIds: [law.scopeId] }));
  const offerings = catalog.offerings.slice(0, 9).map((offering, index) => ({ ...offering, courseId: `law-legacy-${index}`,
    curriculumCourseId: courses[index].id, name: courses[index].canonicalName, resolutionStatus: 'matched',
    credits: index === 8 ? 2 : 4, method: index === 8 ? 'schooling' : 'correspondence', mappingIds: [mappings[index].mappingId] }));
  const f = { ...catalog, mappings, offerings, curriculum: { ...catalog.curriculum, courses } };
  const items = offerings.map(o => item(o, 'earned'));
  const p = deriveCurriculumCourseProgress(items, f, [], law.scopeId).courses.find(course => course.curriculumCourseId === courses[8].id);
  assert.deepEqual([p.earnedCredits, p.completion], [2, 'incomplete']);
  const beforePrerequisite = calculateGraduationProgress([items[8]], f, law.scopeId, [], 'not_selected');
  assert.equal(beforePrerequisite.cards.find(card => card.requirementId === 'professional-law-elective').earned, 0);
  const qualified = calculateGraduationProgress(items, f, law.scopeId, [], 'not_selected');
  assert.equal(qualified.cards.find(card => card.requirementId === 'professional-law-required-elective').earned, 32);
  assert.equal(qualified.cards.find(card => card.requirementId === 'professional-law-elective').earned, 2);
  assert.equal(qualified.graduationCheckComplete, false);
});

test('an unresolved official source linked to an earned auto item cannot manufacture Course credit', () => {
  const f = fixture(); const row = official(f, 2, { curriculumCourseId: null, curriculumMatch: 'unmatched', candidateCurriculumCourseIds: [] });
  const result = deriveCurriculumCourseProgress([{ ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id }], f, [row]);
  assert.equal(result.unassigned.length, 1);
  assert.equal(result.courses[0].earnedCredits, 0);
  assert.equal(result.courses[0].completion, 'unknown');
});

function importData(name, earned) {
  const empty = { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null };
  return { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-10-02T00:00:00Z', courses: [{ rawName: name, categoryRaw: null,
    compositionCredits: { raw: '4', value: 4 }, earnedCredits: { raw: earned === null ? '' : String(earned), value: earned }, schoolingCredits: { raw: '', value: null },
    recognizedExemption: { raw: '', value: null }, additionalEnrollment: { raw: '', value: null },
    reports: Array.from({ length: 4 }, () => ({ raw: '合格', status: 'passed', date: '2026-06-01' })),
    creditExam: { rawDate: '2026/07/01', rawCredits: '4', rawGrade: 'S', date: '2026-07-01', credits: 4, grade: 'S', pendingMarker: false }, schoolings: [empty, empty] }] };
}
function withPassingSchoolings(data) {
  const schooling = { rawYear: '26', rawTerm: '前期', rawDate: '2026/07/01', rawCredits: '2', rawGrade: 'A',
    year: '26', term: '前期', date: '2026-07-01', credits: 2, grade: 'A' };
  data.courses[0].schoolings = [schooling, { ...schooling, rawDate: '2026/08/01', date: '2026-08-01' }];
  data.courses[0].schoolingCredits = { raw: '2', value: 2 };
  return data;
}
function competingSourceData(name) {
  const data = importData(name, 2);
  data.courses = ['source A', 'source B'].map(categoryRaw => ({ ...structuredClone(data.courses[0]), categoryRaw }));
  return data;
}
for (const deselectedSource of [null, 'source A', 'source B']) test(`two official sources for one Offering stay planned when deselected source is ${deselectedSource}`, () => {
  const f = fixture(); const offerings = [f.offerings[2]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const preview = importPreview(competingSourceData(f.course.canonicalName), offerings, [], [], context);
  assert.equal(preview.length, 2);
  assert.equal(new Set(preview.map(unit => unit.sourceCourse.id)).size, 2);
  assert.ok(preview.every(unit => unit.selected && unit.match === 'exact_unique' && unit.offeringId === offerings[0].id));
  const units = preview.map(unit => ({ ...unit, selected: unit.sourceCourse.categoryRaw !== deselectedSource }));
  const next = applyImport(initialState(), units, offerings);
  assert.equal(next.items.length, 1); assert.equal(next.items[0].status, 'planned');
  assert.equal('importedSourceCourseId' in next.items[0], false);
  const selectedSources = deselectedSource === null ? ['source A', 'source B'] : ['source A', 'source B'].filter(source => source !== deselectedSource);
  assert.deepEqual(next.importedCourseAchievements.map(row => row.categoryRaw), selectedSources);
  assert.equal(next.importedStudyRecords.length, selectedSources.length);
  assert.equal(validateState(next, f), true); assert.equal(next.schemaVersion, 22);
});
for (const savedSource of ['source A', 'source B', 'both']) {
  for (const selectNewSource of savedSource === 'both' ? [false] : [false, true]) test(`competing-source backfill stays planned with ${savedSource} saved and new source selected=${selectNewSource}`, () => {
    const f = fixture(); const offerings = [f.offerings[2]];
    const context = { curriculum: f.curriculum, mappings: f.mappings };
    const data = competingSourceData(f.course.canonicalName);
    const savedData = { ...data, courses: data.courses.filter(course => savedSource === 'both' || course.categoryRaw === savedSource) };
    const imported = applyImport(initialState(), importPreview(savedData, offerings, [], [], context), offerings);
    const before = { ...imported, items: [] }; const snapshot = structuredClone(before);
    const preview = importPreview(data, offerings, before.importedStudyRecords, before.importedCourseAchievements, context);
    assert.equal(preview.length, 2);
    assert.equal(new Set(preview.map(unit => unit.sourceExistingId ?? unit.sourceCourse.id)).size, 2);
    const duplicates = preview.filter(unit => unit.sourceDuplicate);
    assert.equal(duplicates.length, savedData.courses.length);
    assert.ok(duplicates.every(unit => !unit.selected && unit.sourceExistingId !== null && unit.sourceExistingId !== unit.sourceCourse.id));
    const units = preview.map(unit => ({ ...unit, selected: !unit.sourceDuplicate && selectNewSource }));
    const next = applyImport(before, units, offerings);
    assert.equal(next.items.length, 1); assert.equal(next.items[0].status, 'planned');
    assert.equal('importedSourceCourseId' in next.items[0], false);
    assert.deepEqual(before, snapshot);
    assert.equal(next.importedCourseAchievements.length, selectNewSource ? 2 : savedData.courses.length);
    if (!selectNewSource) {
      assert.equal(next.importedCourseAchievements, before.importedCourseAchievements);
      assert.equal(next.importedStudyRecords, before.importedStudyRecords);
    }
    assert.equal(validateState(next, f), true); assert.equal(next.schemaVersion, 22);
    assert.equal(applyImport(next, units, offerings).items[0], next.items[0]);
  });
}
for (const credits of [null, 0, 2, 4]) test(`one official row with correspondence and schooling Offerings respects source completion ${credits}/4`, () => {
  const f = fixture(); const offerings = [f.offerings[2], f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const data = withPassingSchoolings(importData(f.course.canonicalName, credits));
  const next = applyImport(initialState(), importPreview(data, offerings, [], [], context), offerings);
  assert.equal(next.importedCourseAchievements.length, 1);
  assert.equal(next.items.length, credits === 4 ? 0 : 2);
  if (credits !== 4) assert.ok(next.items.every(item => item.status === 'planned' && item.importedSourceCourseId === undefined));
  assert.equal(next.importedStudyRecords.length, 3);
  const course = progress(f, next.items, next.importedCourseAchievements);
  assert.deepEqual([course.earnedCredits, course.projectedCredits], [credits ?? 0, (credits ?? 0) + (credits === 4 ? 0 : 6)]);
  assert.equal(validateState(next, f), true);
  assert.equal(applyImport(next, importPreview(data, offerings, next.importedStudyRecords, next.importedCourseAchievements, context), offerings), next);
});
for (const deselectedMethod of ['schooling', 'correspondence']) test(`deselecting ${deselectedMethod} does not attribute a multi-Offering source aggregate to the remaining item`, () => {
  const f = fixture(); const offerings = [f.offerings[2], f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const data = importData(f.course.canonicalName, 2); const emptySlot = data.courses[0].schoolings[1];
  withPassingSchoolings(data); data.courses[0].schoolings[1] = emptySlot;
  const preview = importPreview(data, offerings, [], [], context);
  assert.equal(preview.length, 2); assert.ok(preview.every(unit => unit.selected && unit.match === 'exact_unique'));
  assert.equal(new Set(preview.map(unit => unit.sourceCourse.id)).size, 1);
  const units = preview.map(unit => ({ ...unit, selected: unit.method !== deselectedMethod }));
  const next = applyImport(initialState(), units, offerings);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].offeringId, offerings.find(offering => offering.method !== deselectedMethod).id);
  assert.equal(next.items[0].status, 'planned');
  assert.equal(next.items[0].importedSourceCourseId, undefined);
  assert.equal(next.importedStudyRecords.length, 1);
  assert.equal(next.importedCourseAchievements.length, 1);
  assert.equal(progress(f, next.items, next.importedCourseAchievements).earnedCredits, 2);
  assert.equal(validateState(next, f), true);
});
for (const [earned, composition, completed] of [[2, 2, true], [6, 6, true], [6, 4, true], [2, 6, false], [4, null, false], [4, 0, false]]) test(`source completion uses source credits ${earned}/${composition}, independently of the catalog target4`, () => {
  const f = fixture(); const offerings = [f.offerings[2], f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const data = withPassingSchoolings(importData(f.course.canonicalName, earned));
  data.courses[0].compositionCredits = { raw: composition === null ? '' : String(composition), value: composition };
  const next = applyImport(initialState(), importPreview(data, offerings, [], [], context), offerings);
  assert.equal(next.items.length, completed ? 0 : 2);
  assert.equal(next.importedCourseAchievements[0].earnedCreditsTotal, earned);
  assert.equal(next.importedCourseAchievements[0].compositionCredits, composition);
  assert.equal(next.importedStudyRecords.length, 3);
  if (!completed) assert.ok(next.items.every(item => item.status === 'planned' && item.importedSourceCourseId === undefined));
});
test('deselecting every component adds neither PlannerItems nor a new official source', () => {
  const f = fixture(); const offerings = [f.offerings[2], f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const preview = importPreview(withPassingSchoolings(importData(f.course.canonicalName, 2)), offerings, [], [], context);
  const state = initialState();
  const next = applyImport(state, preview.map(unit => ({ ...unit, selected: false })), offerings);
  assert.equal(next, state);
  assert.deepEqual(next.items, []); assert.deepEqual(next.importedCourseAchievements, []); assert.deepEqual(next.importedStudyRecords, []);
});
test('deselecting one of two slots for the same Offering still permits a single source-linked earned item', () => {
  const f = fixture(); const offerings = [f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const data = withPassingSchoolings(importData(f.course.canonicalName, 2));
  data.courses[0].reports = data.courses[0].reports.map(() => ({ raw: '', status: 'none', date: null }));
  data.courses[0].creditExam = { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false };
  const preview = importPreview(data, offerings, [], [], context);
  const schoolings = preview.filter(unit => unit.method === 'schooling');
  assert.equal(schoolings.length, 2); assert.ok(schoolings.every(unit => unit.match === 'exact_unique' && unit.offeringId === offerings[0].id));
  const units = preview.map(unit => ({ ...unit, selected: unit.id === schoolings[0].id }));
  const next = applyImport(initialState(), units, offerings);
  assert.equal(next.items.length, 1); assert.equal(next.items[0].status, 'earned');
  assert.equal(next.items[0].importedSourceCourseId, next.importedCourseAchievements[0].id);
  assert.equal(next.importedStudyRecords.length, 1);
  assert.equal(progress(f, next.items, next.importedCourseAchievements).earnedCredits, 2);
});
test('a missing component of a multi-Offering source remains planned on backfill even if the other item already exists', () => {
  const f = fixture(); const offerings = [f.offerings[2], f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const data = withPassingSchoolings(importData(f.course.canonicalName, 2));
  const imported = applyImport(initialState(), importPreview(data, offerings, [], [], context), offerings);
  for (const kept of imported.items) {
    const state = { ...imported, items: [kept] };
    const restored = applyImport(state, importPreview(data, offerings, state.importedStudyRecords, state.importedCourseAchievements, context), offerings);
    assert.equal(restored.items.length, 2);
    assert.equal(restored.items[0], kept);
    assert.equal(restored.items[1].status, 'planned');
    assert.equal(restored.items[1].importedSourceCourseId, undefined);
    assert.equal(progress(f, restored.items, restored.importedCourseAchievements).earnedCredits, 2);
  }
});
test('two component slots matching one distinct Offering can still create one source-linked earned item', () => {
  const f = fixture(); const offerings = [f.offerings[0]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  const data = withPassingSchoolings(importData(f.course.canonicalName, 2));
  data.courses[0].reports = data.courses[0].reports.map(() => ({ raw: '', status: 'none', date: null }));
  data.courses[0].creditExam = { rawDate: '', rawCredits: '', rawGrade: '', date: null, credits: null, grade: null, pendingMarker: false };
  const next = applyImport(initialState(), importPreview(data, offerings, [], [], context), offerings);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].status, 'earned');
  assert.equal(next.items[0].importedSourceCourseId, next.importedCourseAchievements[0].id);
  assert.equal(progress(f, next.items, next.importedCourseAchievements).earnedCredits, 2);
});
test('auto import earned status depends only on a positive official aggregate, never passing grades/reports', () => {
  const f = fixture(); const offerings = [f.offerings[2]];
  const context = { curriculum: f.curriculum, mappings: f.mappings };
  for (const earned of [null, 0, 2, 4]) {
    const data = importData(f.course.canonicalName, earned);
    const next = applyImport(initialState(), importPreview(data, offerings, [], [], context), offerings);
    assert.equal(next.items[0].status, earned > 0 ? 'earned' : 'planned');
    assert.equal(next.items[0].importedSourceCourseId, earned > 0 ? next.importedCourseAchievements[0].id : undefined);
    assert.deepEqual(next.courseEvaluations, {}); assert.deepEqual(next.correspondenceProgress, {});
    assert.equal(progress(f, next.items, next.importedCourseAchievements).earnedCredits, earned ?? 0);
  }
});
test('v22 saves and reloads optional source association losslessly and retains progress, evaluations, todos and undo', () => {
  const f = fixture(); const row = official(f, 4); const o = f.offerings[2]; const i = { ...item(o, 'earned'), importedSourceCourseId: row.id };
  const state = { ...initialState(), items: [i, item(f.offerings[0])], importedCourseAchievements: [row],
    courseEvaluations: { [o.id]: { offeringId: o.id, finalGrade: 'A', reportGrade: null, schoolingGrade: null } },
    correspondenceProgress: { [o.id]: { offeringId: o.id, requiredReports: 2, reports: [{ reportNumber: 1, status: 'passed', grade: 'A' }], examGrade: 'S' } },
    todos: [{ id: catalog.offerings[0].id, offeringId: o.id, text: '公式結果を確認', done: false }] };
  const values = new Map(); const store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  assert.equal(validateState(state, f), true);
  const raw = saveState(store, state, null, f); const loaded = loadState(store, f);
  assert.equal(loaded.error, null); assert.deepEqual(loaded.state, state); assert.equal(loaded.state.schemaVersion, 22);
  const removed = removePlannerItem(state.items, o.id);
  const deleted = { ...state, items: state.items.filter(item => item.offeringId !== o.id) };
  const deletedRaw = saveState(store, deleted, raw, f);
  saveState(store, { ...deleted, items: restorePlannerItem(deleted.items, removed) }, deletedRaw, f);
  assert.deepEqual(loadState(store, f).state, state);
  assert.equal(values.has(STORAGE_KEY), true);
  assert.equal(validateState({ ...state, items: [{ ...i, importedSourceCourseId: 'missing-source' }] }, f), false);
  const unlinked = { ...state, items: state.items.map(({ importedSourceCourseId: _source, ...item }) => item) };
  assert.equal(validateState(unlinked, f), true, 'existing v22 records require no new metadata');
});
test('v22 reload and delete undo preserve source-linked and separate user-earned contributions', () => {
  const f = fixture(); const row = official(f, 2);
  const auto = { ...item(f.offerings[2], 'earned'), importedSourceCourseId: row.id };
  const items = updatePlannerItem([auto, item(f.offerings[0])], f.offerings[0].id, { status: 'earned' });
  const state = { ...initialState(), items, importedCourseAchievements: [row] };
  const values = new Map(); const store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  assert.equal(validateState(state, f), true);
  const raw = saveState(store, state, null, f);
  const loaded = loadState(store, f);
  assert.equal(loaded.error, null); assert.deepEqual(loaded.state, state);
  assert.deepEqual([progress(f, loaded.state.items, loaded.state.importedCourseAchievements).earnedCredits,
    progress(f, loaded.state.items, loaded.state.importedCourseAchievements).projectedCredits], [4, 4]);
  const removed = removePlannerItem(loaded.state.items, f.offerings[0].id);
  const deleted = { ...loaded.state, items: [auto] };
  const deletedRaw = saveState(store, deleted, raw, f);
  assert.equal(progress(f, loadState(store, f).state.items, [row]).earnedCredits, 2);
  const restored = { ...deleted, items: restorePlannerItem(deleted.items, removed) };
  saveState(store, restored, deletedRaw, f);
  assert.deepEqual(loadState(store, f).state, state);
  assert.equal(progress(f, restored.items, [row]).earnedCredits, 4);
});
test('all eight graduation programs retain official-only output after positive2/4 auto import; annual limits remain Offering based', () => {
  const base = catalog.offerings.find(o => o.method === 'correspondence' && o.credits === 4 && o.curriculumCourseId && o.resolutionStatus === 'matched');
  const programs = catalog.programs.filter(program => !program.isCommon); assert.equal(programs.length, 8);
  for (const earned of [2, 4]) {
    const data = importData(base.name, earned);
    const next = applyImport(initialState(), importPreview(data, [base]), [base]);
    assert.equal(next.items[0].status, 'earned');
    for (const program of programs) {
      const run = items => calculateGraduationProgress(items, catalog, program.scopeId, [], 'undecided', next.importedStudyRecords, next.importedCourseAchievements, next.graduationProfile);
      assert.deepEqual(run(next.items), run([]), `${program.displayName}: official${earned}`);
      assert.equal(run(next.items).graduationCheckComplete, false);
    }
    const withYear = next.items.map(item => ({ ...item, plannedYear: 2026 }));
    assert.equal(annualCreditLimitReferences(withYear, offeringsById)[0].knownTotalCredits, 4);
    assert.equal(plannerItemsWithoutOfficialEarned(withYear, offeringsById, next.importedCourseAchievements, catalog).length, 0);
  }
});
