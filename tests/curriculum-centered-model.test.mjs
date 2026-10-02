import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalog } from '../src/planner/catalog.ts';
import { generateCurriculumCatalog } from '../src/planner/curriculumGeneration.ts';
import { deriveCurriculumCourseView } from '../src/planner/curriculumCourseView.ts';
import { plannerItemsWithoutOfficialEarned } from '../src/planner/officialCourseCredits.ts';
import { plannerItemFromCourseSearch } from '../src/planner/plannerItemState.ts';
import { initialState } from '../src/planner/storage.ts';

const economics = catalog.curriculum.courses.find(course => course.canonicalName === '経済学');
const openings = catalog.offerings.filter(offering => offering.curriculumCourseId === economics.id);
const correspondence = openings.find(offering => offering.method === 'correspondence');
const schooling = openings.find(offering => offering.method === 'schooling' && offering.credits === 2);
const item = (offering, status = 'planned', patch = {}) => ({ ...plannerItemFromCourseSearch(offering.id), status, ...patch });
const official = (patch = {}) => ({
  id: 'official-economics', fingerprint: 'source-row', source: 'hosei_import', rawName: '経済学', categoryRaw: '社会',
  capturedAt: '2026-10-02T00:00:00Z', earnedCreditsTotal: 4, schoolingCreditsTotal: 2, compositionCredits: 4,
  recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source',
  curriculumCourseId: economics.id, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [economics.id],
  offeringMatch: 'unmatched', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched',
  candidateOfferingIds: [], ...patch,
});
const detail = (patch = {}) => ({
  id: 'historical-detail', fingerprint: 'component', source: 'hosei_import', sourceCourseId: 'official-economics',
  rawName: '経済学', offeringId: null, match: 'unmatched', method: 'schooling', academicYear: 2025,
  yearSource: 'source', rawYear: '25', term: '冬期', rawTerm: '冬期', date: '2026-02-01', credits: 2, grade: 'A', ...patch,
});
const derive = (patch = {}, context = catalog) => deriveCurriculumCourseView({ ...initialState(), ...patch }, context);

test('Course view retains correspondence and schooling as two attempts under the exact curriculum identity', () => {
  const result = derive({ items: [item(correspondence), item(schooling)] });
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].curriculumCourse.id, economics.id);
  assert.deepEqual(result.courses[0].attempts.map(attempt => attempt.plannerItem.offeringId), [correspondence.id, schooling.id]);
  assert.deepEqual(result.courses[0].attempts.map(attempt => attempt.offering.method), ['correspondence', 'schooling']);
});

test('exact official identity is visible with no annual or legacy Course identity; historical details stay on its parent', () => {
  const row = official(); const record = detail();
  const result = derive({ importedCourseAchievements: [row], importedStudyRecords: [record] }, { ...catalog, offerings: [] });
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].earnedCredits, 4);
  assert.equal(result.courses[0].completion, 'complete');
  assert.deepEqual(result.courses[0].attempts, []);
  assert.equal(result.courses[0].officialAchievements[0].achievement, row);
  assert.deepEqual(result.courses[0].officialAchievements[0].studyRecords, [record]);
  assert.equal(record.offeringId, null); assert.equal(record.academicYear, 2025);
  assert.deepEqual(result.unresolved, []);
});

test('components cannot manufacture or increase an official aggregate', () => {
  for (const earnedCreditsTotal of [4, 0, null]) {
    const result = derive({ importedCourseAchievements: [official({ earnedCreditsTotal })], importedStudyRecords: [detail({ credits: 100 })] });
    assert.equal(result.courses[0].earnedCredits, earnedCreditsTotal ?? 0);
    assert.equal(result.courses[0].completion, earnedCreditsTotal === null ? 'unknown' : earnedCreditsTotal === 0 ? 'incomplete' : 'complete');
    assert.equal(result.courses[0].officialAchievements[0].studyRecords[0].credits, 100);
  }
});

test('official4 plus a source-linked earned attempt remains4 while retaining the attempt', () => {
  const result = derive({ items: [item(correspondence, 'earned', { importedSourceCourseId: 'official-economics' })], importedCourseAchievements: [official()] });
  const course = result.courses[0];
  assert.equal(course.earnedCredits, 4); assert.equal(course.projectedCredits, 4);
  assert.equal(course.attempts.length, 1);
  assert.equal(course.officialAchievements.length, 1);
  assert.equal(course.attempts[0].officialEarnedPreferred, true); assert.equal(course.attempts[0].earnedContribution, 0);
});

test('official4 plus independent manual earned2 retains6 and excess2; graduation inputs retain official priority', () => {
  const attempts = [item(schooling, 'earned')]; const rows = [official()];
  const course = derive({ items: attempts, importedCourseAchievements: rows }).courses[0];
  assert.equal(course.earnedCredits, 6); assert.equal(course.earnedExcessCredits, 2);
  assert.equal(course.attempts[0].earnedContribution, 2); assert.equal(course.attempts[0].officialEarnedPreferred, false);
  assert.deepEqual(plannerItemsWithoutOfficialEarned(attempts, new Map(catalog.offerings.map(o => [o.id, o])), rows, catalog), []);
});

test('same-name History curriculum identities remain separate with their own official rows', () => {
  const courses = catalog.curriculum.courses.filter(course => course.canonicalName === '日本史概説');
  assert.equal(courses.length, 2);
  const rows = courses.map((course, index) => official({ id: `history-${index}`, rawName: course.canonicalName,
    curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id], compositionCredits: course.curriculumCredits, earnedCreditsTotal: 2 }));
  const result = derive({ importedCourseAchievements: rows });
  assert.equal(result.courses.length, 2); assert.equal(new Set(result.courses.map(course => course.curriculumCourse.id)).size, 2);
  assert.ok(result.courses.every(course => course.earnedCredits === 2 && course.officialAchievements.length === 1));
});

test('ambiguous official identity remains unresolved with all candidates, metadata and unmatched components', () => {
  const candidates = catalog.curriculum.courses.filter(course => course.canonicalName === '日本史概説').map(course => course.id);
  const row = official({ rawName: '日本史概説', curriculumCourseId: null, curriculumMatch: 'ambiguous', candidateCurriculumCourseIds: candidates });
  const meta = { lifecycleStatus: 'waiting', plannedYear: null, plannedTerm: null, studyYear: 2 };
  const result = derive({ importedCourseAchievements: [row], importedStudyRecords: [detail()], importedCourseUserMeta: { [row.id]: meta } });
  assert.deepEqual(result.courses, []); assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].kind, 'official');
  assert.equal(result.unresolved[0].official.achievement, row);
  assert.deepEqual(result.unresolved[0].official.achievement.candidateCurriculumCourseIds, candidates);
  assert.equal(result.unresolved[0].official.userMeta, meta);
  assert.equal(result.unresolved[0].official.displayStatus, 'earned_imported');
  assert.equal(result.unresolved[0].official.studyRecords.length, 1);
});

test('ambiguous and missing Offerings retain full unresolved attempts and saved progress', () => {
  const ambiguous = catalog.offerings.find(offering => !offering.curriculumCourseId);
  const missing = item({ id: 'absent-historical-offering' }, 'failed');
  const evaluation = { offeringId: missing.offeringId, finalGrade: 'D', reportGrade: null, schoolingGrade: null };
  const result = derive({ items: [item(ambiguous), missing], courseEvaluations: { [missing.offeringId]: evaluation } });
  assert.deepEqual(result.courses, []); assert.equal(result.unresolved.length, 2);
  assert.equal(result.unresolved[0].attempt.offering, ambiguous);
  assert.equal(result.unresolved[1].attempt.plannerItem, missing);
  assert.equal(result.unresolved[1].attempt.offering, null);
  assert.equal(result.unresolved[1].attempt.evaluation, evaluation);
});

test('orphans remain details, including missing parent and absent parent id; no name regrouping', () => {
  const records = [detail(), detail({ id: 'orphan', sourceCourseId: 'missing-parent' }), detail({ id: 'legacy', sourceCourseId: undefined })];
  const result = derive({ importedCourseAchievements: [official()], importedStudyRecords: records });
  assert.deepEqual(result.courses[0].officialAchievements[0].studyRecords, [records[0]]);
  assert.deepEqual(result.orphanStudyRecords, records.slice(1));
  assert.equal(result.courses[0].earnedCredits, 4);
});

test('repeatable Course keeps official16 with separate earned2 and never applies an ordinary completion cap', () => {
  const course = catalog.curriculum.courses.find(course => course.canonicalName === '基礎特講');
  const offering = catalog.offerings.find(o => o.curriculumCourseId === course.id);
  assert.ok(offering);
  const row = official({ curriculumCourseId: course.id, candidateCurriculumCourseIds: [course.id], rawName: course.canonicalName, earnedCreditsTotal: 16 });
  const result = derive({ importedCourseAchievements: [row], items: [item(offering, 'earned', { courseCreditContribution: 2 })] });
  assert.equal(result.courses[0].earnedCredits, 18);
  assert.equal(result.courses[0].completion, 'repeatable'); assert.equal(result.courses[0].projectedCompletion, 'repeatable');
  assert.equal(result.courses[0].earnedExcessCredits, 0);
  assert.equal(result.courses[0].attempts.length, 1); assert.equal(result.courses[0].officialAchievements.length, 1);
});

test('attempt progress/evaluation are joined by Offering id without generating official attempt progress', () => {
  const communication = { offeringId: correspondence.id, requiredReports: 1, reports: [], examGrade: 'S' };
  const mediaOpening = catalog.offerings.find(o => o.curriculumCourseId && o.method === 'schooling' && o.deliveryCategory === '前期メディア');
  assert.ok(mediaOpening);
  const media = { offeringId: mediaOpening.id, totalLessons: 10, lessons: [], assessments: [] };
  const evaluation = { offeringId: mediaOpening.id, finalGrade: 'A', reportGrade: null, schoolingGrade: 'A' };
  const result = derive({ items: [item(correspondence), item(mediaOpening)], importedCourseAchievements: [official()],
    correspondenceProgress: { [correspondence.id]: communication }, mediaSchoolingProgress: { [mediaOpening.id]: media }, courseEvaluations: { [mediaOpening.id]: evaluation } });
  const attempts = result.courses.flatMap(course => course.attempts);
  assert.equal(attempts.find(a => a.offering.id === correspondence.id).progress.correspondence, communication);
  assert.equal(attempts.find(a => a.offering.id === correspondence.id).progress.mediaSchooling, null);
  assert.equal(attempts.find(a => a.offering.id === mediaOpening.id).progress.mediaSchooling, media);
  assert.equal(attempts.find(a => a.offering.id === mediaOpening.id).evaluation, evaluation);
  assert.equal('progress' in result.courses.find(c => c.curriculumCourse.id === economics.id).officialAchievements[0], false);
});

test('contradictory source link does not move an official row into the attempt Course or manufacture earned credit', () => {
  const otherCourse = catalog.curriculum.courses.find(course => course.id !== economics.id);
  const row = official({ curriculumCourseId: otherCourse.id, candidateCurriculumCourseIds: [otherCourse.id] });
  const result = derive({ items: [item(correspondence, 'earned', { importedSourceCourseId: row.id })], importedCourseAchievements: [row] });
  const economicsView = result.courses.find(course => course.curriculumCourse.id === economics.id);
  assert.equal(economicsView.earnedCredits, 0); assert.equal(economicsView.completion, 'unknown');
  assert.deepEqual(economicsView.officialAchievements, []);
  assert.ok(economicsView.warnings.length > 0);
  assert.equal(result.courses.find(course => course.curriculumCourse.id === otherCourse.id).officialAchievements[0].achievement, row);
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(deepFreeze);
  }
  return value;
}
test('projection does not mutate deeply frozen state/catalog or create persistent derived fields', () => {
  const state = deepFreeze({ ...initialState(), items: [item(correspondence)], importedCourseAchievements: [official()], importedStudyRecords: [detail(), detail({ id: 'orphan', sourceCourseId: undefined })] });
  const context = deepFreeze(structuredClone(catalog));
  const beforeState = structuredClone(state); const beforeCatalog = structuredClone(context);
  assert.deepEqual(deriveCurriculumCourseView(state, context), deriveCurriculumCourseView(state, context));
  assert.deepEqual(state, beforeState); assert.deepEqual(context, beforeCatalog);
  assert.equal(state.schemaVersion, 22); assert.equal(context.metadata.graduationCheckComplete, false);
  assert.equal('courses' in state, false);
});

const sourceRows = JSON.parse(readFileSync(new URL('../scripts/inputs/curriculum-rows-2026.json', import.meta.url))).rows;
const groups = JSON.parse(readFileSync(new URL('../scripts/inputs/curriculum-equivalences-2026.json', import.meta.url))).groups;

test('identity characterization: changing annual Offering ids/year alone does not change curriculum IDs with pinned mappings/ledger', () => {
  // Synthetic generator probe only: not an official 2027 dataset or supported runtime catalog.
  const ids = new Map(catalog.offerings.map(offering => [offering.id, `probe-2027:${offering.id}`]));
  const future = { ...catalog, academicYear: 2027, offerings: catalog.offerings.map(offering => ({ ...offering, academicYear: 2027, id: ids.get(offering.id) })) };
  const ledger = groups.map(group => ({ ...group, evidenceOfferingIds: group.evidenceOfferingIds.map(id => ids.get(id)) }));
  const generated = generateCurriculumCatalog(future, sourceRows, ledger);
  assert.deepEqual(generated.courses, catalog.curriculum.courses);
  assert.ok(generated.offeringRelations.every(relation => relation.offeringId.startsWith('probe-2027:')));
});

test('identity characterization: reminting a source mapping changes singleton Course id despite the same name/subject code', () => {
  const course = catalog.curriculum.courses.find(course => course.mappingIds.length === 1 && catalog.offerings.some(o => o.mappingIds.includes(course.mappingIds[0])));
  const mapping = catalog.mappings.find(mapping => mapping.mappingId === course.mappingIds[0]);
  const row = sourceRows.find(row => row.mappingId === mapping.mappingId);
  const opening = catalog.offerings.find(o => o.mappingIds.includes(mapping.mappingId));
  const before = generateCurriculumCatalog({ ...catalog, mappings: [mapping], offerings: [{ ...opening, mappingIds: [mapping.mappingId] }] }, [row], []);
  const newId = 'source-row-reminted';
  const after = generateCurriculumCatalog({ ...catalog, mappings: [{ ...mapping, mappingId: newId }], offerings: [{ ...opening, mappingIds: [newId] }] }, [{ ...row, mappingId: newId }], []);
  assert.equal(before.courses[0].canonicalName, after.courses[0].canonicalName);
  assert.equal(after.courses[0].id, `curriculum:${newId}`);
  assert.notEqual(before.courses[0].id, after.courses[0].id);
});
