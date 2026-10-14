import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { deriveOfficialGraduationFacts, officialFactCreditState } from '../src/planner/graduation/officialGraduationFacts.ts';
import { calculateGraduationProgress } from '../src/planner/graduation/graduationProgress.ts';
import { deriveOfficialRepeatableEvidence } from '../src/planner/graduation/officialRepeatableEvidence.ts';
import { validateState } from '../src/planner/validation.ts';
import { REPEATABLE_CREDIT_RULES } from '../src/planner/graduation/repeatableRules.ts';
import { saveState, loadState, STORAGE_KEY } from '../src/planner/backup/storage.ts';
import { createPlannerBackup, parsePlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { restorePlannerBackup } from '../src/planner/backup/plannerBackupStorage.ts';
import { plannerItemFromCourseSearch } from '../src/planner/planning/plannerItemState.ts';
import { importFingerprint } from '../src/planner/gradeImport/gradeImportApply.ts';
import { importedGraduationNotices } from '../src/planner/gradeImport/importedGraduationNotices.ts';
import { repeatProfile, numeric, nativeRow, payload, repeatedPayload, importRepeated, slot, auditConflictPayload, nonzeroAggregateBoundaryPayload, sameIdNativeLegacyConflict, completeRowMismatchPayload } from './fixtures/official-repeatable.mjs';
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
  assert.equal(total(progress(state)).earned, null);
  assert.equal(total(progress(state)).status, 'unknown');
  assert.equal(schooling(progress(state)).earned, null);
  assert.equal(schooling(progress(state)).status, 'unknown');
});

for (const variant of ['year unknown', 'date unknown', 'grade D', 'old snapshot', 'missing component']) test(`native 総合特講 ${variant} cannot bypass held proof through H19`, () => {
  const data = payload([nativeRow('総合特講', [2025])]), slot = data.courses[0].schoolings[0];
  if (variant === 'year unknown') { slot.year = null; slot.rawYear = ''; }
  if (variant === 'date unknown') { slot.date = null; slot.rawDate = ''; }
  if (variant === 'grade D') { slot.grade = 'D'; slot.rawGrade = 'D'; }
  const state = importRepeated(data);
  if (variant === 'old snapshot') state.importedStudyRecords.push({ ...state.importedStudyRecords[0], id: 'old', grade: 'D' });
  if (variant === 'missing component') state.importedStudyRecords = [];
  assertHeld(state);
  const p = progress(state);
  assert.equal(total(p).earned, null);
  assert.equal(schooling(p).earned, null);
  assert.equal(schooling(p).status, 'unknown');
});

// Independent audit R1/R2: conflict cases fail at c2d305f; definite-zero controls pass.
function assertAuditConflict(state, missingReason, name = '政治学') {
  const f = assertHeld(state, 'repeatable_aggregate_conflict');
  assert.ok(f.facts[0].diagnostics.includes(missingReason));
  assert.equal(officialFactCreditState(f.facts[0]).allZero, false);
  assert.equal(officialFactCreditState(f.facts[0]).hasUnknown, true);
  const p = progress(state);
  assert.equal(total(p).earned, null);
  assert.equal(total(p).status, 'unknown');
  assert.equal(schooling(p).earned, null);
  assert.equal(schooling(p).status, 'unknown');
  const lawS = p.cards.find(c => c.requirementId === 'professional-law-schooling');
  assert.equal(lawS.earned, 0, 'held detail must not add2 to professional S');
  if (name === '政治学') assert.equal(lawS.status, 'unknown');
  const notice = p.importedWarnings.find(w => w.kind === 'allocation_held');
  assert.ok(notice?.reason.includes('一致しません'), JSON.stringify(p.importedWarnings));
  assert.deepEqual(p.importedWarnings, importedGraduationNotices(f, state.importedCourseAchievements, state.importedStudyRecords));
  return f;
}
const auditMissingReasons = { 'R1 S null': 'repeatable_aggregate_unknown', 'R1 composition null': 'repeatable_source_unconfirmed', 'R2 year absent': 'repeatable_attempt_unconfirmed' };
for (const name of ['政治学', '総合特講']) for (const [kind, reason] of Object.entries(auditMissingReasons)) test(`audit ${kind}/${name}: missing evidence cannot erase an aggregate conflict`, () => {
  const state = importRepeated(auditConflictPayload(kind, name)), before = structuredClone(state);
  assertAuditConflict(state, reason, name);
  assert.deepEqual(state, before, 'diagnostics must leave official source and aggregate untouched');
});

test('audit R1: all earned0 rows are checked even after an earlier incomplete row, in either order', () => {
  const data = auditConflictPayload('R1 S null');
  const incomplete = nativeRow('政治学', []); incomplete.earnedCredits = numeric(0); incomplete.schoolingCredits = numeric(null);
  data.courses.unshift(incomplete);
  const state = importRepeated(data);
  // Ensure the incomplete source is visited first by the existing stable ID sort.
  for (const [i, row] of state.importedCourseAchievements.entries()) {
    const oldId = row.id; row.id = `audit-row-${i}`;
    for (const record of state.importedStudyRecords.filter(r => r.sourceCourseId === oldId)) record.sourceCourseId = row.id;
  }
  const course = catalog.curriculum.courses.find(c => c.id === state.importedCourseAchievements[0].curriculumCourseId);
  const mapping = catalog.mappings.find(m => course.mappingIds.includes(m.mappingId) && m.scopeId === program('法律学科').scopeId);
  const proof = deriveOfficialRepeatableEvidence(state.importedCourseAchievements, state.importedStudyRecords, course, mapping, catalog, repeatProfile);
  assert.equal(proof.kind, 'held'); assert.ok(proof.diagnostics.includes('repeatable_aggregate_conflict'));
  const first = assertAuditConflict(state, 'repeatable_aggregate_unknown');
  const reverse = { ...state, importedCourseAchievements: [...state.importedCourseAchievements].reverse(), importedStudyRecords: [...state.importedStudyRecords].reverse() };
  assert.deepEqual(assertAuditConflict(reverse, 'repeatable_aggregate_unknown'), first);
  assert.deepEqual(progress(reverse), progress(state));
  assert.deepEqual(deriveOfficialRepeatableEvidence(reverse.importedCourseAchievements, reverse.importedStudyRecords, course, mapping, catalog, repeatProfile), proof);
});

for (const composition of [2, null]) test(`audit R1/R2 control: explicit0 and D with missing year, composition ${composition} remain definite0`, () => {
  const data = auditConflictPayload('R2 year absent'), row = data.courses[0];
  row.earnedCredits = numeric(0); row.compositionCredits = numeric(composition);
  row.schoolings[0].rawGrade = 'D'; row.schoolings[0].grade = 'D';
  const state = importRepeated(data), f = facts(state), p = progress(state);
  assert.deepEqual(officialFactCreditState(f.facts[0]), { allZero: true, hasPositive: false, hasUnknown: false });
  assert.equal(f.facts[0].diagnostics.includes('repeatable_aggregate_conflict'), false);
  assert.equal(total(p).earned, 0); assert.notEqual(total(p).status, 'unknown');
  assert.equal(schooling(p).earned, 0); assert.notEqual(schooling(p).status, 'unknown');
  const lawS = p.cards.find(c => c.requirementId === 'professional-law-schooling');
  assert.equal(lawS.earned, 0); assert.notEqual(lawS.status, 'unknown');
  assert.deepEqual(p.importedWarnings, []);
});

for (const kind of ['R1 S null', 'R2 year absent']) test(`audit ${kind}: save, reload and identical reimport retain source and unknown`, () => {
  const data = auditConflictPayload(kind), state = importRepeated(data), values = new Map();
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  saveState(store, state, null, catalog);
  const loaded = loadState(store, catalog); assert.equal(loaded.error, null); assert.equal(loaded.state.schemaVersion, 22);
  const again = importRepeated({ ...data, capturedAt: '2026-10-14T06:00:00.000Z' }, loaded.state);
  assert.deepEqual(again, loaded.state);
  assert.deepEqual(again.importedCourseAchievements, state.importedCourseAchievements);
  assert.deepEqual(again.importedStudyRecords, state.importedStudyRecords);
  assertAuditConflict(again, auditMissingReasons[kind]);
});

// Nonzero aggregates: one explicit passed S2 is a known lower bound, never an allocation budget.
for (const name of ['政治学', '総合特講']) for (const caseId of ['A', 'B', 'C', 'D', 'E']) test(`nonzero boundary ${caseId}/${name}: aggregate diagnosis, hold and source authority`, () => {
  const data = nonzeroAggregateBoundaryPayload(caseId, name), state = importRepeated(data), before = structuredClone(state);
  const row = state.importedCourseAchievements[0], record = state.importedStudyRecords[0];
  assert.equal(row.earnedCreditsTotal, data.courses[0].earnedCredits.value);
  assert.equal(row.schoolingCreditsTotal, data.courses[0].schoolingCredits.value);
  assert.equal(record.rawYear, null); assert.equal(record.credits, 2);
  assert.equal(record.grade, caseId === 'E' ? 'D' : 'A');
  const f = facts(state), fact = f.facts[0], creditState = officialFactCreditState(fact), p = progress(state);
  assert.equal(f.allocations.length, 0, 'unknown source year never authorizes a repeat completion');
  const conflict = caseId === 'A' || caseId === 'B';
  assert.equal(fact.diagnostics.includes('repeatable_aggregate_conflict'), conflict);
  assert.equal(fact.diagnostics.includes(caseId === 'D' ? 'repeatable_aggregate_unknown' : 'repeatable_attempt_unconfirmed'), true);
  assert.deepEqual(creditState, { allZero: caseId === 'E', hasPositive: caseId !== 'E', hasUnknown: conflict });
  const notices = importedGraduationNotices(f, state.importedCourseAchievements, state.importedStudyRecords);
  assert.deepEqual(p.importedWarnings, notices);
  if (caseId === 'E') {
    assert.equal(total(p).earned, 0); assert.notEqual(total(p).status, 'unknown');
    assert.equal(schooling(p).earned, 0); assert.notEqual(schooling(p).status, 'unknown');
    assert.deepEqual(notices, []);
  } else {
    assert.equal(total(p).earned, null); assert.equal(total(p).status, 'unknown');
    assert.equal(schooling(p).earned, null); assert.equal(schooling(p).status, 'unknown');
    assert.equal(notices.length, 1); assert.equal(notices[0].kind, 'allocation_held');
    assert.equal(notices[0].reason.includes('一致しません'), conflict);
    assert.ok(notices[0].reason.includes(caseId === 'D' ? '不明' : '独立した修得回を確認できません'));
  }
  const lawS = p.cards.find(c => c.requirementId === 'professional-law-schooling');
  assert.equal(lawS.earned, 0, 'neither the detail nor H19/H43 may add2');
  if (name === '政治学') assert.equal(lawS.status === 'unknown', caseId !== 'E');
  else assert.notEqual(lawS.status, 'unknown', 'Law general lecture remains outside professional S8');
  assert.deepEqual(state, before, 'diagnosis must preserve source aggregate, fingerprint, raw year and detail');
});

for (const name of ['政治学', '総合特講']) test(`nonzero boundary multiple rows/${name}: later contradiction survives an earlier year hold and reversal`, () => {
  const first = nonzeroAggregateBoundaryPayload('C', name), later = nonzeroAggregateBoundaryPayload('A', name);
  // Both rows have unknown source years; different source dates alone cannot prove independent attempts.
  later.courses[0].schoolings[0].rawDate = '2025/09/01'; later.courses[0].schoolings[0].date = '2025-09-01';
  const state = importRepeated(payload([...first.courses, ...later.courses]));
  assert.equal(state.importedCourseAchievements.length, 2);
  for (const [i, row] of state.importedCourseAchievements.entries()) {
    const oldId = row.id; row.id = `nonzero-row-${i}`;
    for (const record of state.importedStudyRecords.filter(r => r.sourceCourseId === oldId)) record.sourceCourseId = row.id;
  }
  const course = catalog.curriculum.courses.find(c => c.id === state.importedCourseAchievements[0].curriculumCourseId);
  const mapping = catalog.mappings.find(m => course.mappingIds.includes(m.mappingId) && m.scopeId === program('法律学科').scopeId);
  const proof = deriveOfficialRepeatableEvidence(state.importedCourseAchievements, state.importedStudyRecords, course, mapping, catalog, repeatProfile);
  assert.equal(proof.kind, 'held');
  assert.ok(proof.diagnostics.includes('repeatable_attempt_unconfirmed'));
  assert.ok(proof.diagnostics.includes('repeatable_aggregate_conflict'));
  const f = assertAuditConflict(state, 'repeatable_attempt_unconfirmed', name);
  const reverse = { ...state, importedCourseAchievements: [...state.importedCourseAchievements].reverse(), importedStudyRecords: [...state.importedStudyRecords].reverse() };
  assert.deepEqual(deriveOfficialRepeatableEvidence(reverse.importedCourseAchievements, reverse.importedStudyRecords, course, mapping, catalog, repeatProfile), proof);
  assert.deepEqual(assertAuditConflict(reverse, 'repeatable_attempt_unconfirmed', name), f);
  assert.deepEqual(progress(reverse), progress(state));
});

function assertF1Held(state) {
  const f = assertHeld(state, 'repeatable_source_conflict');
  assert.equal(officialFactCreditState(f.facts[0]).allZero, false);
  assert.equal(officialFactCreditState(f.facts[0]).hasUnknown, true);
  const p = progress(state);
  assert.equal(total(p).earned, null); assert.equal(total(p).status, 'unknown');
  assert.equal(schooling(p).earned, null); assert.equal(schooling(p).status, 'unknown');
  const lawS = p.cards.find(c => c.requirementId === 'professional-law-schooling');
  assert.equal(lawS.earned, 0); assert.equal(lawS.status, 'unknown');
  assert.ok(p.importedWarnings.some(w => w.kind === 'allocation_held' && w.reason.includes('同じ公式行ID')));
  return f;
}
for (const earned of [0, 2]) for (const reverse of [false, true]) test(`audit F1 earned${earned} ${reverse ? 'legacy-native' : 'native-legacy'} retains source conflict`, () => {
  const state = sameIdNativeLegacyConflict(earned, reverse), before = structuredClone(state);
  assert.equal(validateState(state, catalog), true);
  const f = assertF1Held(state);
  if (!earned) assert.ok(f.facts[0].diagnostics.includes('repeatable_aggregate_conflict'));
  const flipped = { ...state, importedCourseAchievements: [...state.importedCourseAchievements].reverse() };
  assert.deepEqual(assertF1Held(flipped), f);
  assert.deepEqual(progress(flipped), progress(state)); assert.deepEqual(state, before);
});

test('audit F1 exact same-ID copies remain idempotent and never add a completion', () => {
  const original = importRepeated(repeatedPayload('政治学', 1));
  const copied = { ...original, importedCourseAchievements: [...original.importedCourseAchievements, structuredClone(original.importedCourseAchievements[0])] };
  assert.equal(validateState(copied, catalog), true);
  assert.deepEqual(facts(copied), facts(original)); assert.deepEqual(progress(copied), progress(original));
  assert.equal(facts(copied).allocations[0].credits, 2);
});
test('audit F1 different-ID independent native rows remain two verified completions', () => {
  const state = importRepeated(repeatedPayload('政治学', 2));
  assert.notEqual(state.importedCourseAchievements[0].id, state.importedCourseAchievements[1].id);
  const f = facts(state); assert.equal(f.allocations[0].credits, 4);
  assert.equal(f.allocations[0].fact.repeatableEvidence.attempts.length, 2);
  assert.equal(f.facts[0].diagnostics.includes('repeatable_source_conflict'), false);
});
for (const reverse of [false, true]) test(`audit F1 accepted duplicate ID survives save/reload, reverse=${reverse}`, () => {
  const state = sameIdNativeLegacyConflict(0, reverse), values = new Map();
  const store = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
  assert.equal(validateState(state, catalog), true); const raw = saveState(store, state, null, catalog);
  const loaded = loadState(store, catalog); assert.equal(loaded.error, null); assert.equal(loaded.state.schemaVersion, 22);
  assert.deepEqual(loaded.state.importedCourseAchievements, state.importedCourseAchievements);
  assert.deepEqual(loaded.state.importedStudyRecords, state.importedStudyRecords);
  assert.equal(store.getItem(STORAGE_KEY), raw); assertF1Held(loaded.state);
});
for (const reverse of [false, true]) test(`audit F1 manual earned cannot re-count a competing official source, reverse=${reverse}`, () => {
  const state = sameIdNativeLegacyConflict(0, reverse), courseId = state.importedCourseAchievements[0].curriculumCourseId;
  const offering = catalog.offerings.find(o => o.curriculumCourseId === courseId && o.resolutionStatus === 'matched');
  state.items = [{ ...plannerItemFromCourseSearch(offering.id), status: 'earned' }];
  assertF1Held(state); assert.equal(state.items[0].status, 'earned');
});

function f2Proof(state) {
  const course = catalog.curriculum.courses.find(c => c.id === state.importedCourseAchievements[0].curriculumCourseId);
  const mapping = catalog.mappings.find(m => course.mappingIds.includes(m.mappingId) && m.scopeId === program('法律学科').scopeId);
  return deriveOfficialRepeatableEvidence(state.importedCourseAchievements, state.importedStudyRecords, course, mapping, catalog, repeatProfile);
}
function assertF2Held(state, conflict, yearMissing) {
  const f = assertHeld(state), proof = f2Proof(state);
  assert.equal(proof.kind, 'held'); assert.equal(f.facts[0].diagnostics.includes('repeatable_aggregate_conflict'), conflict);
  assert.equal(proof.diagnostics.includes('repeatable_aggregate_conflict'), conflict);
  if (yearMissing) {
    assert.ok(f.facts[0].diagnostics.includes('repeatable_attempt_unconfirmed'));
    assert.ok(proof.diagnostics.includes('repeatable_attempt_unconfirmed'));
  }
  const p = progress(state); assert.equal(total(p).earned, null); assert.equal(total(p).status, 'unknown');
  assert.equal(schooling(p).earned, null); assert.equal(schooling(p).status, 'unknown');
  const notice = p.importedWarnings.find(w => w.kind === 'allocation_held'); assert.ok(notice);
  assert.equal(notice.reason.includes('一致しません'), conflict);
  if (yearMissing) assert.ok(notice.reason.includes('独立した修得回を確認できません'));
  return { f, proof };
}
test('audit F2 row A alone retains year hold without claiming aggregate conflict', () => {
  assertF2Held(importRepeated(completeRowMismatchPayload(true, false)), false, true);
});
test('audit F2 row B alone proves a complete local aggregate mismatch', () => {
  assertF2Held(importRepeated(completeRowMismatchPayload(false, true)), true, false);
});
for (const idOrder of ['A-first', 'B-first']) test(`audit F2 A+B source ID order ${idOrder} retains both diagnostics and input reversal`, () => {
  const state = importRepeated(completeRowMismatchPayload());
  for (const row of state.importedCourseAchievements) {
    const oldId = row.id, isA = row.earnedCreditsTotal === 2;
    row.id = `f2-${(isA === (idOrder === 'A-first')) ? 'a' : 'z'}`;
    for (const r of state.importedStudyRecords.filter(r => r.sourceCourseId === oldId)) r.sourceCourseId = row.id;
  }
  const before = structuredClone(state), results = assertF2Held(state, true, true);
  const reverse = { ...state, importedCourseAchievements: [...state.importedCourseAchievements].reverse(), importedStudyRecords: [...state.importedStudyRecords].reverse() };
  assert.deepEqual(assertF2Held(reverse, true, true), results); assert.deepEqual(progress(reverse), progress(state));
  assert.deepEqual(state, before);
});
for (const descending of [false, true]) test(`audit F2 normal import generated UUID order descending=${descending} retains all row diagnostics`, t => {
  let n = 0;
  t.mock.method(globalThis.crypto, 'randomUUID', () => `00000000-0000-4000-8000-${(descending ? 1000 - n++ : n++).toString(16).padStart(12, '0')}`);
  const state = importRepeated(completeRowMismatchPayload());
  const [a, b] = state.importedCourseAchievements;
  assert.equal(a.earnedCreditsTotal, 2); assert.equal(b.earnedCreditsTotal, 4);
  assert.equal(a.id < b.id, !descending); assert.equal(validateState(state, catalog), true);
  assertF2Held(state, true, true);
});
for (const missing of ['year', 'date', 'component', 'opaque source', 'old snapshot', 'composition']) test(`audit F2 incomplete row B ${missing} cannot prove its total4 mismatch`, () => {
  const data = completeRowMismatchPayload(false, true), raw = data.courses[0];
  if (missing === 'year') { raw.schoolings[0].rawYear = ''; raw.schoolings[0].year = null; }
  if (missing === 'date') { raw.schoolings[0].rawDate = ''; raw.schoolings[0].date = null; }
  if (missing === 'composition') raw.compositionCredits = numeric(null);
  const state = importRepeated(data);
  if (missing === 'component') state.importedStudyRecords = [];
  if (missing === 'opaque source') state.importedCourseAchievements[0].fingerprint = 'legacy-f2-opaque';
  if (missing === 'old snapshot') state.importedStudyRecords.push({ ...state.importedStudyRecords[0], id: 'old-f2', grade: 'D' });
  assertF2Held(state, false, missing === 'year');
});

for (const reverse of [false, true]) test(`audit F1 different institutional identities under one source ID remain unresolved, reverse=${reverse}`, () => {
  const state = sameIdNativeLegacyConflict(0), otherData = payload([nativeRow('総合特講', [2023])]);
  otherData.courses[0].earnedCredits = numeric(0); otherData.courses[0].schoolingCredits = numeric(0);
  const other = importRepeated(otherData), native = state.importedCourseAchievements[0], copy = other.importedCourseAchievements[0];
  copy.id = native.id;
  state.importedCourseAchievements = reverse ? [copy, native] : [native, copy];
  state.importedStudyRecords.push(...other.importedStudyRecords.map(r => ({ ...r, sourceCourseId: native.id })));
  assert.equal(validateState(state, catalog), true);
  const f = assertF1Held(state); assert.equal(f.facts[0].curriculumCourseId, null);
  assert.equal(f.facts[0].canonicalName, null);
  const flipped = { ...state, importedCourseAchievements: [...state.importedCourseAchievements].reverse() };
  assert.deepEqual(assertF1Held(flipped), f); assert.deepEqual(progress(flipped), progress(state));
});
