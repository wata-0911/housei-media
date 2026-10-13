import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog.ts';
import { deriveOfficialGraduationFacts, officialFactCreditState } from '../src/planner/officialGraduationFacts.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { REPEATABLE_CREDIT_RULES } from '../src/planner/repeatableRules.ts';
import { saveState, loadState, STORAGE_KEY } from '../src/planner/storage.ts';
import { createPlannerBackup, parsePlannerBackup } from '../src/planner/plannerBackup.ts';
import { restorePlannerBackup } from '../src/planner/plannerBackupStorage.ts';
import { plannerItemFromCourseSearch } from '../src/planner/plannerItemState.ts';
import { importFingerprint } from '../src/planner/gradeImportApply.ts';
import { importedGraduationNotices } from '../src/planner/importedGraduationNotices.ts';
import { repeatProfile, numeric, nativeRow, payload, repeatedPayload, importRepeated, slot } from './fixtures/official-repeatable.mjs';
const program = department => catalog.programs.find(p => p.department === department);
const facts = (state, department = '法律学科', input = catalog, profile = repeatProfile) => deriveOfficialGraduationFacts(state.importedCourseAchievements, state.importedStudyRecords, input, program(department).scopeId, profile);
const progress = (state, department = '法律学科', input = catalog) => calculateGraduationProgress(state.items, input, program(department).scopeId, [], 'not_selected', state.importedStudyRecords, state.importedCourseAchievements, repeatProfile);
const total = p => p.referenceProgress.find(r => r.id === 'overall-reference-progress');
const schooling = p => p.referenceProgress.find(r => r.id === 'schooling-reference-progress');
const assertHeld = (state, reason, department = '法律学科', input = catalog, profile = repeatProfile) => {
  const f = facts(state, department, input, profile);
  assert.equal(f.allocations.length, 0);
  assert.equal(f.facts[0].allocation.kind, 'unknown');
  if (reason) assert.ok(f.facts[0].diagnostics.includes(reason), f.facts[0].diagnostics.join());
  return f;
};

for (const [department, family, limit, times] of REPEATABLE_CREDIT_RULES) {
  const name = family === '歴史資料学' ? '歴史資料学1〜6' : family;
  for (const count of [...new Set([1, 2, times, times + 1])]) test(`official repeats: ${department}/${name} ${count} independent years, cap ${times}/${limit}`, () => {
    const state = importRepeated(repeatedPayload(name, count)), before = structuredClone(state);
    assert.equal(state.importedCourseAchievements.length, count);
    const f = facts(state, department), a = f.allocations[0];
    assert.equal(f.allocations.length, 1, JSON.stringify(f.facts));
    assert.deepEqual([a.credits, a.completedCredits, a.schoolingCredits], Array(3).fill(Math.min(count * 2, limit)));
    assert.deepEqual([a.fact.repeatableEvidence.earnedTotal, a.fact.repeatableEvidence.attempts.length, a.fact.repeatableEvidence.excessCredits], [count * 2, count, Math.max(0, count * 2 - limit)]);
    assert.equal(a.fact.earnedCreditsTotal, count === 1 ? 2 : null, 'do not manufacture a multi-row aggregate');
    assert.equal(a.fact.sourceRows.length, count);
    const p = progress(state, department);
    assert.equal(total(p).earned, Math.min(count * 2, limit));
    assert.equal(schooling(p).earned, Math.min(count * 2, limit));
    if (department === '法律学科') assert.equal(p.cards.find(c => c.requirementId === 'professional-law-schooling').earned, family === '総合特講' ? 0 : Math.min(count * 2, limit, 8));
    const repeats = p.cards.flatMap(c => c.repeatableCourses ?? []).filter(r => r.label === family);
    if (repeats.length) for (const r of repeats) assert.deepEqual([r.earned, r.counted, r.courses], [count * 2, Math.min(count * 2, limit), count]);
    if (count > times) assert.ok(p.importedWarnings.some(w => w.kind === 'repeatable_limit' && w.reason.includes('他区分へ算入しません')));
    assert.deepEqual(state, before);
    assert.deepEqual(facts({ ...state, importedCourseAchievements: [...state.importedCourseAchievements].reverse(), importedStudyRecords: [...state.importedStudyRecords].reverse() }, department), f);
  });
}

test('one aggregate with two source-year slots contributes two completions; row year may be null', () => {
  const state = importRepeated(payload([nativeRow('政治学', [2024, 2025])]));
  assert.equal(state.importedCourseAchievements[0].academicYear, null);
  const a = facts(state).allocations[0];
  assert.equal(a.credits, 4); assert.equal(a.fact.repeatableEvidence.attempts.length, 2);
  assert.equal(total(progress(state)).earned, 4);
});

test('same data reimport and repeated same ID/native slot are idempotent', () => {
  const data = repeatedPayload('政治学', 2), state = importRepeated(data);
  const again = importRepeated({ ...data, capturedAt: '2026-10-14T00:00:00.000Z' }, state);
  assert.deepEqual(again, state); assert.deepEqual(facts(again), facts(state));
  const repeated = { ...state, importedCourseAchievements: [...state.importedCourseAchievements, structuredClone(state.importedCourseAchievements[0])], importedStudyRecords: [...state.importedStudyRecords, structuredClone(state.importedStudyRecords[0])] };
  assert.deepEqual(facts(repeated), facts(state));
  repeated.importedStudyRecords.at(-1).id = 'duplicate-native-slot';
  assert.equal(facts(repeated).allocations[0].credits, 4);
  assert.equal(facts(repeated).allocations[0].fact.repeatableEvidence.attempts.length, 2);
});

for (const variant of ['same row slots', 'same year distinct terms', 'duplicate official rows', 'overlapping row subsets']) test(`independence hold: ${variant}`, () => {
  let data;
  if (variant === 'same row slots') data = payload([nativeRow('政治学', [2025, 2025])]);
  if (variant === 'same year distinct terms') { data = payload([nativeRow('政治学', [2025, 2025])]); data.courses[0].schoolings[1] = { ...slot(2025, '2025-12-01'), rawTerm: '冬', term: '冬' }; }
  if (variant === 'duplicate official rows') data = payload([nativeRow('政治学', [2025]), nativeRow('政治学', [2025])]);
  if (variant === 'overlapping row subsets') data = payload([nativeRow('政治学', [2024, 2025]), nativeRow('政治学', [2025])]);
  const state = importRepeated(data);
  assertHeld(state);
  assert.equal(total(progress(state)).status, 'unknown');
});

for (const value of [null, 0, 1, 2, 3, 6]) test(`aggregate ${value} cannot replace the two complete S2 details`, () => {
  const data = payload([nativeRow('政治学', [2024, 2025])]);
  data.courses[0].earnedCredits = numeric(value);
  const state = importRepeated(data), f = assertHeld(state, value === null ? 'repeatable_aggregate_unknown' : 'repeatable_aggregate_conflict');
  assert.equal(f.facts[0].earnedCreditsTotal, value);
  assert.equal(officialFactCreditState(f.facts[0]).allZero, false);
  assert.equal(total(progress(state)).status, 'unknown');
  assert.ok(importedGraduationNotices(f, state.importedCourseAchievements, state.importedStudyRecords)[0].reason.includes(value === null ? '不明' : '一致しません'));
});

for (const variant of ['year unknown', 'date unknown', 'invalid date', 'inconsistent year', 'grade D', 'grade null', 'pending credits', 'S aggregate null', 'S aggregate zero', 'S aggregate partial', 'one detail missing', 'old snapshot', 'unknown fingerprint', 'partial component', 'extra correspondence', 'exemption', 'additional']) test(`evidence held: ${variant}`, () => {
  const data = payload([nativeRow('政治学', [2025])]), row = data.courses[0], s = row.schoolings[0];
  if (variant === 'year unknown') { s.year = null; s.rawYear = ''; }
  if (variant === 'date unknown') { s.date = null; s.rawDate = ''; }
  if (variant === 'inconsistent year') { s.rawYear = '2024'; s.year = '2024'; }
  if (variant.startsWith('grade ')) { s.grade = variant === 'grade D' ? 'D' : null; s.rawGrade = s.grade ?? ''; }
  if (variant === 'pending credits') s.rawCredits = '*2';
  if (variant.startsWith('S aggregate')) row.schoolingCredits = numeric(variant.endsWith('null') ? null : variant.endsWith('zero') ? 0 : 1);
  if (variant === 'partial component') { s.credits = 1; s.rawCredits = '1'; }
  if (variant === 'extra correspondence') row.creditExam = { rawDate: '2025/06/01', date: '2025-06-01', rawCredits: '2', credits: 2, rawGrade: 'A', grade: 'A', pendingMarker: false };
  if (variant === 'exemption') row.recognizedExemption = numeric(2);
  if (variant === 'additional') row.additionalEnrollment = numeric(2);
  const state = importRepeated(data);
  if (variant === 'one detail missing') state.importedStudyRecords = [];
  if (variant === 'old snapshot') state.importedStudyRecords.push({ ...state.importedStudyRecords[0], id: 'old', grade: 'D' });
  if (variant === 'unknown fingerprint') state.importedCourseAchievements[0].fingerprint = 'legacy';
  if (variant === 'invalid date') { state.importedStudyRecords[0].date = '2025-02-30'; state.importedStudyRecords[0].fingerprint = `${importFingerprint(state.importedStudyRecords[0])}:0`; }
  assertHeld(state);
});

for (const field of ['earnedCreditsTotal', 'schoolingCreditsTotal', 'fingerprint', 'curriculumCourseId']) test(`contradictory same source ID: ${field}`, () => {
  const state = importRepeated(repeatedPayload('政治学', 1)), copy = structuredClone(state.importedCourseAchievements[0]);
  copy[field] = field.endsWith('Total') ? 0 : 'different';
  state.importedCourseAchievements.unshift(copy);
  assertHeld(state, 'repeatable_source_conflict');
});

for (const variant of ['ambiguous', 'no identity', 'legacy course', 'unknown applicability', 'mapping conflict', 'mapping owner', 'unknown composition']) test(`identity/scope held: ${variant}`, () => {
  const state = importRepeated(repeatedPayload('政治学', 1)); let input = catalog, profile = repeatProfile;
  if (variant === 'ambiguous') { state.importedCourseAchievements[0].curriculumMatch = 'ambiguous'; state.importedCourseAchievements[0].curriculumCourseId = null; }
  if (variant === 'no identity') state.importedCourseAchievements[0].curriculumCourseId = null;
  if (variant === 'legacy course') profile = { ...profile, curriculumApplicability: 'legacy_or_transition' };
  if (variant === 'unknown applicability') profile = { ...profile, curriculumApplicability: 'unknown' };
  if (variant === 'unknown composition') state.importedCourseAchievements[0].compositionCredits = null;
  if (variant.startsWith('mapping ')) {
    input = structuredClone(catalog); const c = input.curriculum.courses.find(c => c.id === state.importedCourseAchievements[0].curriculumCourseId);
    if (variant === 'mapping owner') input.curriculum.courses.find(x => x.id !== c.id).mappingIds.push(c.mappingIds[0]);
    else { const m = { ...input.mappings.find(m => m.mappingId === c.mappingIds[0]), mappingId: 'conflict', requirementType: '必修' }; input.mappings.push(m); c.mappingIds.push(m.mappingId); }
  }
  assertHeld(state, null, '法律学科', input, profile);
});

for (const [name, department] of [['経済学演習', '経済学科'], ['経営学演習', '商業学科']]) test(`${name} never aliases current 演習`, () => {
  const state = importRepeated(repeatedPayload(name, 1)); assertHeld(state, 'curriculum_identity_unresolved', department);
  const exact = importRepeated(repeatedPayload('演習', 1)).importedCourseAchievements[0];
  Object.assign(state.importedCourseAchievements[0], { curriculumCourseId: exact.curriculumCourseId, curriculumMatch: exact.curriculumMatch, candidateCurriculumCourseIds: exact.candidateCurriculumCourseIds });
  assertHeld(state, 'repeatable_source_unconfirmed', department);
});

test('no Offering needed for 法律学演習; no synthetic items or openings', () => {
  const state = importRepeated(repeatedPayload('法律学演習', 4));
  assert.equal(state.items.length, 0);
  const input = { ...catalog, offerings: [] };
  assert.equal(facts(state, '法律学科', input).allocations[0].credits, 8);
  assert.equal(total(progress(state, '法律学科', input)).earned, 8);
  assert.equal(catalog.offerings.filter(o => o.curriculumCourseId === state.importedCourseAchievements[0].curriculumCourseId).length, 0);
});

for (const status of ['earned', 'planned', 'in_progress', 'waiting']) test(`official priority vs manual ${status}`, () => {
  const state = importRepeated(repeatedPayload('政治学', 2));
  const o = catalog.offerings.find(o => o.curriculumCourseId === state.importedCourseAchievements[0].curriculumCourseId && o.resolutionStatus === 'matched');
  state.items = [{ ...plannerItemFromCourseSearch(o.id), status }];
  const p = progress(state);
  assert.equal(total(p).earned, 4);
  assert.equal(p.cards.find(c => c.requirementId === 'professional-law-elective').normalEarned, 4);
  assert.equal(schooling(p).earned, 4);
  assert.equal(state.items[0].status, status);
});

test('import, save, reload, backup restore preserve source, metadata, schema22 and graduation result', async () => {
  const state = importRepeated(repeatedPayload('政治学', 3));
  state.selectedScopeId = program('法律学科').scopeId;
  state.graduationProfile = repeatProfile;
  const values = new Map(); const store = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
  const raw = saveState(store, state, null, catalog), loaded = loadState(store, catalog);
  assert.equal(loaded.error, null); assert.equal(loaded.state.schemaVersion, 22);
  const text = JSON.stringify(await createPlannerBackup(raw, catalog));
  const parsed = await parsePlannerBackup(text, catalog);
  const restored = await restorePlannerBackup(store, text, raw, catalog, { request: async (_name, _options, cb) => cb() });
  for (const candidate of [loaded.state, parsed.state, restored.state]) {
    assert.deepEqual(candidate.importedCourseAchievements, state.importedCourseAchievements);
    assert.deepEqual(candidate.importedStudyRecords, state.importedStudyRecords);
    assert.deepEqual(progress(candidate), progress(state));
  }
  assert.equal(store.getItem(STORAGE_KEY), restored.raw);
});

test('one unknown or inconsistent official row holds the entire repeat family without partial guessing', () => {
  const state = importRepeated(repeatedPayload('政治学', 2));
  state.importedCourseAchievements[1].earnedCreditsTotal = null;
  assertHeld(state, 'repeatable_aggregate_unknown'); assert.equal(total(progress(state)).status, 'unknown');
});

test('future plan date / capturedAt / editable year never establishes independence', () => {
  const data = payload([nativeRow('政治学', [2025, 2025])]), state = importRepeated(data);
  state.importedStudyRecords[1].academicYear = 2026; state.importedStudyRecords[1].yearSource = 'manual';
  state.importedStudyRecords[1].term = '冬'; state.importedStudyRecords[1].capturedAt = '2027-10-13T00:00:00Z';
  assertHeld(state, 'repeatable_attempt_overlap');
});

test('other department and geography special transfers remain outside repeat release', () => {
  const law = importRepeated(repeatedPayload('政治学', 1));
  assert.equal(facts(law, '経済学科').allocations.length, 0);
  for (const name of ['地誌学特講', '人文地理学演習', '自然地理学特講']) {
    const state = importRepeated(repeatedPayload(name, 1)); assert.equal(facts(state, '地理学科').allocations.length, 0);
  }
});

test('explicit aggregate zero without details remains zero, null remains unknown', () => {
  for (const value of [0, null]) {
    const data = payload([nativeRow('政治学', [])]); data.courses[0].earnedCredits = numeric(value);
    const state = importRepeated(data), f = facts(state);
    assert.equal(f.facts[0].earnedCreditsTotal, value);
    assert.equal(officialFactCreditState(f.facts[0]).allZero, value === 0);
  }
});

test('conflicting detail IDs cannot represent distinct attempts', () => {
  const state = importRepeated(repeatedPayload('政治学', 2));
  state.importedStudyRecords[1].id = state.importedStudyRecords[0].id;
  assertHeld(state, 'repeatable_source_conflict');
});

test('explicit zero with retained passed source but missing imported component still holds', () => {
  const state = importRepeated(repeatedPayload('政治学', 1));
  state.importedCourseAchievements[0].earnedCreditsTotal = 0;
  state.importedCourseAchievements[0].schoolingCreditsTotal = 0;
  state.importedStudyRecords = [];
  const f = assertHeld(state, 'repeatable_aggregate_conflict');
  assert.equal(officialFactCreditState(f.facts[0]).allZero, false);
  assert.equal(total(progress(state)).status, 'unknown');
  assert.equal(schooling(progress(state)).status, 'unknown');
});

test('each Japanese literature course uses the same official general-lecture cap', () => {
  const state = importRepeated(repeatedPayload('総合特講', 9));
  for (const p of catalog.programs.filter(p => p.department === '日本文学科')) {
    const f = deriveOfficialGraduationFacts(state.importedCourseAchievements, state.importedStudyRecords, catalog, p.scopeId, repeatProfile);
    assert.equal(f.allocations[0].credits, 16);
    const result = calculateGraduationProgress([], catalog, p.scopeId, [], 'not_selected', state.importedStudyRecords, state.importedCourseAchievements, repeatProfile);
    assert.equal(total(result).earned, 16);
    const lecture = result.cards.flatMap(c => c.specialLectures ?? []).find(c => c.label === '総合特講');
    assert.deepEqual([lecture.earnedTotal, lecture.earnedCourses, lecture.counted, lecture.excess], [18, 9, 16, 2]);
  }
});

test('professional recognition holds repeats; unrelated usual official courses preserve the old path', () => {
  const state = importRepeated(repeatedPayload('政治学', 1));
  assertHeld(state, 'repeatable_recognition_overlap', '法律学科', catalog, {
    ...repeatProfile, admissionType: 'transfer_second', recognizedCredits: { ...repeatProfile.recognizedCredits, professionalCourses: [{ offeringId: catalog.offerings[0].id }] },
  });
  const usual = importRepeated(repeatedPayload('論理学', 1));
  assert.equal(facts(usual).facts[0].repeatableEvidence, undefined);
});

test('reimport refresh of one dated result does not append a completion', () => {
  const data = repeatedPayload('政治学', 1), state = importRepeated(data);
  data.courses[0].schoolings[0].grade = 'S'; data.courses[0].schoolings[0].rawGrade = 'S';
  const updated = importRepeated(data, state);
  assert.equal(updated.importedCourseAchievements.length, 1); assert.equal(updated.importedStudyRecords.length, 1);
  assert.equal(updated.importedStudyRecords[0].grade, 'S');
  assert.equal(facts(updated).allocations[0].fact.repeatableEvidence.attempts.length, 1);
  assert.equal(facts(updated).allocations[0].credits, 2);
});

for (const name of ['政治学', '総合特講']) test(`${name}: conflicting native detail cannot escape through global S fallback`, () => {
  const data = payload([nativeRow(name, [2024, 2025])]); data.courses[0].earnedCredits = numeric(2); data.courses[0].schoolingCredits = numeric(2);
  const state = importRepeated(data);
  assertHeld(state, 'repeatable_aggregate_conflict');
  assert.equal(total(progress(state)).earned, 0);
  assert.equal(schooling(progress(state)).earned, 0);
  assert.equal(schooling(progress(state)).status, 'unknown');
});
