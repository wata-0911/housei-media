import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { catalog, catalog2026Adapter, courseRegistry2026, offeringsById } from '../src/planner/catalog.ts';
import { bridgeEvidence2026, CATALOG_2026_MANIFEST, CURRICULUM_2026_REF, createCourseRegistry, courseAllowsAutoLink, offeringRef2026, resolve2026Offering } from '../src/planner/catalogFoundation.ts';
import { addEnrollment, createPlanIntent, enrollmentForIntent, enrollmentFromLegacy, foundationPlanRows, migrateV21ToV22, offeringReference, pinOfferingRecords, removeEnrollment } from '../src/planner/plannerFoundation.ts';
import { initialState, loadState, saveState, saveRecoveredState, recoverState, STORAGE_KEY, BACKUP_KEY } from '../src/planner/storage.ts';
import { validateLegacyState, validateState } from '../src/planner/validation.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { summarizeCredits } from '../src/planner/calculations.ts';
import { guidanceEligibilityCreditResult } from '../src/planner/thesisGuidance.ts';
import { isMediaSchooling, progressFor } from '../src/planner/mediaSchooling.ts';
import { progressForCorrespondence } from '../src/planner/correspondenceProgress.ts';
import { applyImport } from '../src/planner/gradeImportApply.ts';
import { annualCreditLimitReferences } from '../src/planner/annualPlan.ts';

const id = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const matched = catalog.offerings.find(o => o.resolutionStatus === 'matched' && o.courseId !== null
  && catalog.offerings.some(other => other.id !== o.id && other.courseId === o.courseId));
const media = catalog.offerings.find(isMediaSchooling);
const correspondence = catalog.offerings.find(o => o.method === 'correspondence');
const legacyItem = (offeringId = matched.id, status = 'planned') => ({ offeringId, status, plannedYear: 2026, plannedTerm: null, studyYear: null, earnedOrder: null });
const enrollment = (offeringId = matched.id, status = 'planned') => enrollmentFromLegacy(legacyItem(offeringId, status), catalog);
const intent = (overrides = {}) => ({ id: id(1), courseId: matched.courseId, targetAcademicYear: 2027, plannedYear: 2027, preferredTerm: null, studyYear: 2, scopeId: null, curriculumVersionId: null, status: 'planned', reference: null, ...overrides });
function v21(overrides = {}) {
  const { planIntents: _intents, offeringCatalogRefs: _pins, ...state } = initialState();
  return { ...state, schemaVersion: 21, ...overrides };
}
function memoryStore(raw = null) {
  const values = new Map(raw === null ? [] : [[STORAGE_KEY, raw]]);
  const writes = [];
  return { writes, getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push([key, value]); values.set(key, value); } };
}
function achievement(overrides = {}) {
  return { id: 'official-row', fingerprint: 'original-fingerprint', source: 'hosei_import', rawName: matched.name,
    categoryRaw: null, capturedAt: '', earnedCreditsTotal: 2, schoolingCreditsTotal: null, compositionCredits: 2,
    recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source', courseId: null,
    selectedOfferingId: matched.id, selectionSource: 'manual', match: 'ambiguous', candidateOfferingIds: [matched.id, 'unknown-original-import-reference'], ...overrides };
}
const projectItems = items => items.map(({ courseId: _course, courseIdentityResolution: _resolution, planIntentId: _intent, offeringRef: _ref, linkDecision: _decision, ...legacy }) => legacy);

test('v22: migration preserves six statuses, all schedules/order and does not reinterpret 2027', () => {
  const statuses = ['planned', 'in_progress', 'waiting', 'earned', 'failed', 'dropped'];
  const sourceItems = catalog.offerings.slice(0, 6).map((o, i) => ({ ...legacyItem(o.id, statuses[i]), plannedYear: i % 2 === 0 ? null : 2027, plannedTerm: i % 2 === 0 ? null : '春休み（旧入力）', studyYear: i % 2 === 0 ? null : 4 }));
  const seminar = catalog.offerings.find(o => /^史学演習（/.test(o.name) && !sourceItems.some(item => item.offeringId === o.id));
  sourceItems.push({ ...legacyItem(seminar.id, 'earned'), earnedOrder: 1 });
  const before = v21({ items: sourceItems });
  assert.equal(validateLegacyState(before, catalog), true);
  const raw = JSON.stringify(before);
  const store = memoryStore(raw);
  const result = loadState(store, catalog);
  assert.equal(result.error, null);
  assert.equal(result.state.schemaVersion, 22);
  assert.deepEqual(projectItems(result.state.items), sourceItems);
  assert.deepEqual(result.state.planIntents, []);
  assert.deepEqual(store.writes, []);
  assert.equal(store.getItem(STORAGE_KEY), raw);
  assert.deepEqual(loadState(store, catalog).state, result.state, 'deterministic migration');
  for (const item of result.state.items) {
    assert.equal(item.planIntentId, null); assert.equal(item.linkDecision, null);
    assert.deepEqual(item.offeringRef, offeringRef2026(item.offeringId));
  }
});

test('v22: v21 remaining fields, map keys, orphan/import manual choices and profile extensions are lossless', () => {
  const scope = catalog.programs.find(p => p.department === '地理学科').scopeId;
  const base = v21();
  const before = v21({ selectedScopeId: scope, items: [legacyItem(matched.id, 'earned')],
    publicCourses: [{ id: id(10), title: '公開科目 原文', status: 'waiting', plannedYear: 2028, plannedTerm: '独自期', studyYear: 4, finalGrade: null, credits: 2 }],
    todos: [{ id: id(11), offeringId: media.id, text: '保存されたtodo', done: false }],
    mediaSchoolingProgress: { [media.id]: { ...progressFor(media.id, {}), lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }] } },
    courseEvaluations: { [media.id]: { offeringId: media.id, finalGrade: 'A', reportGrade: null, schoolingGrade: 'B' } },
    correspondenceProgress: { [correspondence.id]: progressForCorrespondence(correspondence, {}) },
    importedCourseAchievements: [achievement()],
    importedStudyRecords: [{ id: 'raw-component', fingerprint: 'raw-fingerprint', source: 'hosei_import', rawName: '元名称', offeringId: media.id, match: 'unmatched', method: 'schooling', academicYear: null, yearSource: 'unknown', rawYear: null, term: null, rawTerm: null, date: null, credits: null, grade: null, sourceCourseId: 'original-disconnected-row' }],
    importedCourseUserMeta: { 'official-row': { lifecycleStatus: 'waiting', plannedYear: 2027, plannedTerm: '独自期', studyYear: 4 } },
    thesisSelection: 'selected', thesisProgressByScope: { [scope]: { selection: 'selected', status: 'in_progress' } },
    thesisGuidanceByScope: { [scope]: { steps: { first: { status: 'passed', passedOn: '2026-01-01' } }, geographyReportSubmitted: true } },
    graduationProfile: { ...base.graduationProfile, admissionYear: 2026, currentStudyYear: 4, admissionType: 'other_transfer', curriculumApplicability: 'current_2026', originalExtension: { note: '保持' },
      recognizedCredits: { ...base.graduationProfile.recognizedCredits, totalCredits: 10, openUniversityCredits: 10, originalExtension: ['保持'] } },
  });
  assert.equal(validateLegacyState(before, catalog), true);
  const result = loadState(memoryStore(JSON.stringify(before)), catalog);
  assert.equal(result.error, null);
  for (const [key, value] of Object.entries(before)) {
    if (key === 'schemaVersion') continue;
    assert.deepEqual(key === 'items' ? projectItems(result.state.items) : result.state[key], value, key);
  }
  assert.equal(result.state.offeringCatalogRefs[matched.id], undefined, 'active binding not indexed');
  for (const orphan of [media.id, correspondence.id].filter(value => value !== matched.id)) assert.deepEqual(result.state.offeringCatalogRefs[orphan], { academicYear: 2026, revisionId: CATALOG_2026_MANIFEST.revisionId });
  assert.equal(result.state.offeringCatalogRefs['unknown-original-import-reference'], undefined);
  assert.deepEqual(result.state.importedCourseAchievements, before.importedCourseAchievements, 'no re-match/repair/coalescing');
  assert.equal(result.state.items.length, 1, 'no items generated from imported grades');
});

for (const resolution of ['matched_course', 'matched_null', 'manual_review', 'outside_mapping_scope', 'registry_missing']) {
  test(`v22: safe identity backfill ${resolution}`, () => {
    let offering = { ...matched };
    let courses = catalog.courses;
    if (resolution === 'matched_null') offering.courseId = null;
    if (resolution === 'manual_review' || resolution === 'outside_mapping_scope') offering.resolutionStatus = resolution;
    if (resolution === 'registry_missing') courses = courses.filter(course => course.id !== matched.courseId);
    const fixture = { ...catalog, courses, offerings: catalog.offerings.map(o => o.id === offering.id ? offering : o) };
    const before = v21({ items: [{ ...legacyItem(offering.id), plannedYear: 2027 }] });
    const next = migrateV21ToV22(before, fixture);
    assert.equal(next.items[0].courseId, resolution === 'matched_course' ? matched.courseId : null);
    assert.equal(next.items[0].courseIdentityResolution, resolution === 'matched_course' ? 'catalog_provisional' : 'unresolved');
    assert.equal(next.items[0].offeringId, offering.id);
    assert.equal(next.items[0].plannedYear, 2027);
    assert.equal(next.items[0].offeringRef.academicYear, 2026);
    assert.equal(validateState(next, fixture), true);
    assert.deepEqual(next.planIntents, []);
  });
}

test('v22: immutable adapter preserves raw facts, effective overrides and exact existing IDs', () => {
  const raw = JSON.parse(readFileSync(new URL('../src/data/planner_catalog_2026.json', import.meta.url), 'utf8'));
  assert.deepEqual(catalog2026Adapter.rawSnapshot, raw);
  assert.deepEqual(catalog2026Adapter.effectiveView, catalog);
  assert.equal(catalog2026Adapter.manifest.provenance, 'versioned_application_identifier');
  assert.deepEqual(catalog2026Adapter.effectiveView.offerings.map(o => o.id), raw.offerings.map(o => o.id));
  assert.ok(Object.isFrozen(catalog2026Adapter.rawSnapshot.offerings[0]));
  assert.throws(() => { catalog2026Adapter.rawSnapshot.offerings[0].name = '書換不可'; }, TypeError);
  const changed = catalog.offerings.find(o => JSON.stringify(o) !== JSON.stringify(raw.offerings.find(r => r.id === o.id)));
  assert.ok(changed, 'real runtime overrides remain distinguishable');
  assert.deepEqual(catalog2026Adapter.resolve(offeringRef2026(changed.id)), changed);
  assert.equal(resolve2026Offering(catalog, { ...offeringRef2026(matched.id), academicYear: 2027 }), undefined);
  assert.equal(resolve2026Offering(catalog, { ...offeringRef2026(matched.id), revisionId: 'latest' }), undefined);
});

test('v22: CourseRegistry preserves all existing provisional identities without name-generated Courses', () => {
  assert.equal(courseRegistry2026.size, 209);
  assert.deepEqual([...courseRegistry2026.values()], catalog.courses);
  assert.ok([...courseRegistry2026.values()].every(course => course.identityStatus === 'provisional'));
  assert.equal(courseRegistry2026.set, undefined, 'immutable registry API');
  assert.throws(() => { courseRegistry2026.get(matched.courseId).identityStatus = 'verified'; }, TypeError);
  const nullOffering = catalog.offerings.find(o => o.courseId === null);
  const originalIds = [...courseRegistry2026.keys()];
  assert.throws(() => createPlanIntent(intent({ courseId: nullOffering.courseId }), courseRegistry2026));
  assert.throws(() => createPlanIntent(intent({ courseId: id(99) }), courseRegistry2026));
  assert.throws(() => createPlanIntent(intent({ courseId: nullOffering.name }), courseRegistry2026));
  assert.deepEqual([...courseRegistry2026.keys()], originalIds, 'name matching does not create identity');
  assert.equal(validateState({ ...initialState(), items: [enrollment(nullOffering.id)] }, catalog), true, 'annual null identity remains usable');
});

test('v22: provisional and independently verified registry Courses permit future intents, but provisional is not auto-linkable', () => {
  assert.deepEqual(createPlanIntent(intent(), courseRegistry2026), intent());
  assert.equal(courseAllowsAutoLink(courseRegistry2026, matched.courseId), false);
  const fixtureRegistry = createCourseRegistry([{ ...catalog.courses.find(c => c.id === matched.courseId), identityStatus: 'verified' }]);
  assert.deepEqual(createPlanIntent(intent(), fixtureRegistry), intent());
  assert.equal(courseAllowsAutoLink(fixtureRegistry, matched.courseId), true);
  assert.equal(courseAllowsAutoLink(fixtureRegistry, id(99)), false);
  assert.equal(courseRegistry2026.get(matched.courseId).identityStatus, 'provisional', 'no production promotion');
});

for (const field of ['offeringId', 'catalogRef', 'linkDecision', 'linked']) {
  test(`v22: PlanIntent rejects persisted binding field ${field}`, () => {
    const bad = intent({ [field]: field === 'linked' ? false : matched.id });
    assert.equal(validateState({ ...initialState(), planIntents: [bad] }, catalog), false);
    assert.throws(() => createPlanIntent(bad, courseRegistry2026));
  });
}

test('v22: intent IDs, years, status, study year, registered Course and past references are validated', () => {
  const valid = { ...initialState(), planIntents: [intent()] };
  assert.equal(validateState(valid, catalog), true);
  assert.equal(enrollmentForIntent(valid, id(1)), undefined, 'link state is derived');
  for (const overrides of [
    { id: 'not-uuid' }, { courseId: null }, { courseId: id(99) }, { targetAcademicYear: 2027.5 }, { targetAcademicYear: 999 },
    { plannedYear: '2027' }, { plannedYear: 10000 }, { studyYear: 0 }, { studyYear: 5 }, { status: 'earned' },
    { reference: { catalog: { academicYear: 2027, revisionId: 'nonexistent' }, offeringIds: [matched.id] } },
  ]) assert.equal(validateState({ ...valid, planIntents: [intent(overrides)] }, catalog), false, JSON.stringify(overrides));
  assert.equal(validateState({ ...valid, planIntents: [intent(), intent()] }, catalog), false);
  assert.equal(validateState({ ...valid, planIntents: [intent({ plannedYear: null, studyYear: null, status: 'dropped' })] }, catalog), true);
});

function boundState() {
  const scopeId = catalog.programs.find(program => bridgeEvidence2026(catalog, matched, program.scopeId) !== null).scopeId;
  const planIntent = intent({ targetAcademicYear: 2026, scopeId, curriculumVersionId: 'current_2026' });
  const item = { ...enrollment(), planIntentId: planIntent.id,
    linkDecision: { source: 'manual', scopeId, curriculumRef: { ...CURRICULUM_2026_REF }, bridgeDigest: bridgeEvidence2026(catalog, matched, scopeId), acceptedChangeCodes: [] } };
  return { ...initialState(), planIntents: [planIntent], items: [item] };
}

test('v22: Enrollment alone stores canonical binding and reviewed context; global context changes do not corrupt it', () => {
  const state = boundState();
  assert.equal(validateState(state, catalog), true);
  assert.equal(enrollmentForIntent(state, id(1)), state.items[0]);
  assert.deepEqual(offeringReference(state, matched.id), state.items[0].offeringRef);
  assert.equal('offeringId' in state.planIntents[0], false);
  assert.equal('linkDecision' in state.planIntents[0], false);
  assert.deepEqual(state.offeringCatalogRefs, {});
  const otherScope = catalog.programs.find(p => p.scopeId !== state.items[0].linkDecision.scopeId).scopeId;
  assert.equal(validateState({ ...state, selectedScopeId: otherScope, graduationProfile: { ...state.graduationProfile, curriculumApplicability: 'legacy_or_transition' } }, catalog), true);
  assert.deepEqual(state.items[0].linkDecision.curriculumRef, CURRICULUM_2026_REF);
});

test('v22: duplicate/missing bindings, course/year/ref conflicts and unbound link decisions are rejected', () => {
  const state = boundState();
  const current = state.items[0];
  const otherCourse = catalog.courses.find(c => c.id !== matched.courseId);
  for (const replacement of [
    { ...current, planIntentId: id(99) }, { ...current, courseId: otherCourse.id }, { ...current, courseId: null, courseIdentityResolution: 'unresolved' },
    { ...current, offeringRef: { ...current.offeringRef, offeringId: media.id } },
    { ...current, offeringRef: { ...current.offeringRef, academicYear: 2027 } },
    { ...current, offeringRef: { ...current.offeringRef, revisionId: 'unknown' } },
    { ...current, linkDecision: null }, { ...current, planIntentId: null },
    { ...current, linkDecision: { ...current.linkDecision, source: 'auto' } },
    { ...current, linkDecision: { ...current.linkDecision, bridgeDigest: 'invented' } },
  ]) assert.equal(validateState({ ...state, items: [replacement] }, catalog), false);
  assert.equal(validateState({ ...state, items: [current, current] }, catalog), false, 'duplicate Offering claim');
  const second = catalog.offerings.find(o => o.courseId === matched.courseId && o.id !== matched.id);
  assert.ok(second);
  assert.equal(validateState({ ...state, items: [current, { ...enrollment(second.id), planIntentId: id(1), linkDecision: current.linkDecision }] }, catalog), false, 'two Enrollments per intent');
  assert.equal(validateState({ ...state, planIntents: [intent({ targetAcademicYear: 2027 })] }, catalog), false);
  assert.equal(validateState({ ...state, planIntents: [intent({ targetAcademicYear: 2026, status: 'dropped' })] }, catalog), false);
});

for (const status of ['planned', 'in_progress', 'waiting', 'earned', 'failed', 'dropped']) {
  test(`v22: ${status} annual Enrollment requires Offering identity`, () => {
    const item = enrollment(matched.id, status);
    assert.equal(validateState({ ...initialState(), items: [item] }, catalog), true);
    assert.equal(validateState({ ...initialState(), items: [{ ...item, offeringRef: null }] }, catalog), false);
  });
}

test('v22: delete/reload/Undo/re-add keep orphan progress/evaluation/todo revision, not active binding index', () => {
  const item = enrollment(media.id);
  const before = { ...initialState(), items: [item],
    mediaSchoolingProgress: { [media.id]: progressFor(media.id, {}) },
    courseEvaluations: { [media.id]: { offeringId: media.id, finalGrade: 'A', reportGrade: null, schoolingGrade: null } },
    todos: [{ id: id(10), offeringId: media.id, text: '保持', done: false }] };
  const removed = removeEnrollment(before, media.id);
  assert.deepEqual(removed.mediaSchoolingProgress, before.mediaSchoolingProgress);
  assert.deepEqual(removed.courseEvaluations, before.courseEvaluations);
  assert.deepEqual(offeringReference(removed, media.id), item.offeringRef);
  assert.equal(validateState(removed, catalog), true);
  const store = memoryStore();
  saveState(store, removed, null, catalog);
  const reloaded = loadState(store, catalog);
  assert.equal(reloaded.error, null);
  assert.deepEqual(offeringReference(reloaded.state, media.id), item.offeringRef);
  const undo = addEnrollment(reloaded.state, item, catalog, 0);
  assert.deepEqual(undo, before);
  const readd = addEnrollment(reloaded.state, enrollment(media.id), catalog);
  assert.deepEqual(readd.offeringCatalogRefs, {});
  assert.deepEqual(readd.mediaSchoolingProgress, before.mediaSchoolingProgress);
  assert.throws(() => addEnrollment(reloaded.state, { ...item, offeringRef: { ...item.offeringRef, revisionId: 'new-revision' } }, catalog), /revision mismatch/);
  assert.equal(validateState({ ...before, offeringCatalogRefs: removed.offeringCatalogRefs }, catalog), false, 'index cannot duplicate active reference');
  const missing = { ...removed, offeringCatalogRefs: {} };
  assert.equal(validateState(missing, catalog), false, 'orphan cannot lose pin');
  assert.equal(offeringReference(missing, media.id), undefined, 'no latest fallback');
});

test('v22: new offering-keyed orphan records get pins in the same explicit save; retained pins never drift', () => {
  const state = { ...initialState(), courseEvaluations: { [media.id]: { offeringId: media.id, finalGrade: null, reportGrade: null, schoolingGrade: null } } };
  const pinned = pinOfferingRecords(state, catalog);
  assert.equal(validateState(pinned, catalog), true);
  assert.deepEqual(offeringReference(pinned, media.id), offeringRef2026(media.id));
  const drift = { ...pinned, offeringCatalogRefs: { [media.id]: { academicYear: 2026, revisionId: 'unknown-original' } } };
  assert.deepEqual(pinOfferingRecords(drift, catalog).offeringCatalogRefs, drift.offeringCatalogRefs, 'invalid pin is not silently repaired');
  assert.equal(validateState(drift, catalog), false);
});

test('v22: schema lock rejects v23+, malformed extra data and valid v22 round-trips without load writes', () => {
  const state = { ...initialState(), items: [enrollment()], planIntents: [intent()] };
  const store = memoryStore();
  const raw = saveState(store, state, null, catalog);
  const result = loadState(store, catalog);
  assert.equal(result.error, null); assert.deepEqual(result.state, state); assert.equal(result.raw, raw);
  assert.equal(store.writes.length, 1, 'load must not write');
  for (const schemaVersion of [23, 100, 22.5]) {
    const rawFuture = JSON.stringify({ ...state, schemaVersion });
    const future = memoryStore(rawFuture);
    assert.notEqual(loadState(future, catalog).error, null);
    assert.equal(future.getItem(STORAGE_KEY), rawFuture); assert.deepEqual(future.writes, []);
    assert.equal(validateState({ ...state, schemaVersion }, catalog), false);
  }
  const corrupt = JSON.stringify({ ...v21(), unknownStateField: 'do not drop' });
  assert.notEqual(loadState(memoryStore(corrupt), catalog).error, null);
});

test('v22: invalid Open University raw 11 survives migration, unrelated intent saves, reload and resolves only on own repair', () => {
  const base = v21();
  const legacy = { ...base, graduationProfile: { ...base.graduationProfile, recognizedCredits: { ...base.graduationProfile.recognizedCredits, openUniversityCredits: 11 } } };
  const originalRaw = JSON.stringify(legacy);
  const store = memoryStore(originalRaw);
  let loaded = loadState(store, catalog);
  assert.equal(loaded.error, null); assert.equal(loaded.state.schemaVersion, 22);
  assert.equal(loaded.state.graduationProfile.recognizedCredits.openUniversityCredits, null);
  assert.deepEqual(loaded.invalidRecognitionPaths, ['recognizedCredits.openUniversityCredits']);
  assert.deepEqual(store.writes, []);
  loaded = saveRecoveredState(store, { ...loaded.state, planIntents: [intent()] }, loaded, catalog);
  assert.equal(JSON.parse(store.getItem(STORAGE_KEY)).schemaVersion, 22);
  assert.equal(JSON.parse(store.getItem(STORAGE_KEY)).graduationProfile.recognizedCredits.openUniversityCredits, 11);
  assert.ok(loaded.recognitionWarning);
  loaded = loadState(store, catalog);
  assert.equal(loaded.state.planIntents.length, 1); assert.ok(loaded.recognitionWarning);
  loaded = saveRecoveredState(store, { ...loaded.state, graduationProfile: { ...loaded.state.graduationProfile, admissionYear: 2027 } }, loaded, catalog);
  assert.equal(JSON.parse(store.getItem(STORAGE_KEY)).graduationProfile.recognizedCredits.openUniversityCredits, 11);
  loaded = saveRecoveredState(store, { ...loaded.state, graduationProfile: { ...loaded.state.graduationProfile, recognizedCredits: { ...loaded.state.graduationProfile.recognizedCredits, openUniversityCredits: 10 } } }, loaded, catalog);
  assert.equal(loaded.recognitionWarning, null);
  assert.deepEqual(loaded.invalidRecognitionPaths, []);
  assert.equal(loadState(store, catalog).state.graduationProfile.recognizedCredits.openUniversityCredits, 10);
});

test('v22: optimistic concurrency, backup bytes and failed backup semantics are unchanged', () => {
  const original = JSON.stringify(v21({ items: [legacyItem()] }));
  const store = memoryStore(original);
  const loaded = loadState(store, catalog);
  store.setItem(STORAGE_KEY, 'another-tab');
  assert.throws(() => saveState(store, loaded.state, loaded.raw, catalog), /別の画面/);
  assert.throws(() => recoverState(store, loaded.raw, catalog), /保存データが変更/);
  assert.equal(store.getItem(STORAGE_KEY), 'another-tab');
  const fresh = memoryStore(original);
  recoverState(fresh, original, catalog);
  assert.equal(fresh.getItem(BACKUP_KEY), original);
  assert.equal(JSON.parse(fresh.getItem(STORAGE_KEY)).schemaVersion, 22);
  const failed = memoryStore(original);
  const writer = failed.setItem;
  failed.setItem = (key, value) => { if (key === BACKUP_KEY) throw new Error('quota'); writer(key, value); };
  assert.throws(() => recoverState(failed, original, catalog), /quota/);
  assert.equal(failed.getItem(STORAGE_KEY), original);
});

test('v22: acquired/annual/graduation/guidance calculations are unchanged by migration and future intents for every scope', () => {
  const old = v21({ items: catalog.offerings.slice(0, 20).map((o, i) => ({ ...legacyItem(o.id, i % 2 === 0 ? 'earned' : 'planned'), plannedYear: i % 3 === 0 ? 2027 : 2026 })) });
  const next = { ...migrateV21ToV22(old, catalog), planIntents: [intent(), intent({ id: id(2), targetAcademicYear: 2028, plannedYear: 2028 })] };
  assert.deepEqual(summarizeCredits(next.items, offeringsById), summarizeCredits(old.items, offeringsById));
  for (const program of catalog.programs) {
    const before = calculateGraduationProgress(old.items, catalog, program.scopeId, old.publicCourses, old.thesisSelection);
    const after = calculateGraduationProgress(next.items, catalog, program.scopeId, next.publicCourses, next.thesisSelection);
    assert.deepEqual(after, before, program.department);
    assert.equal(after.graduationCheckComplete, false);
    assert.deepEqual(guidanceEligibilityCreditResult({ ...next, selectedScopeId: program.scopeId }, catalog), guidanceEligibilityCreditResult({ ...old, selectedScopeId: program.scopeId }, catalog));
  }
  assert.equal(next.planIntents.length, 2);
  assert.deepEqual(next.mediaSchoolingProgress, {}); assert.deepEqual(next.courseEvaluations, {}); assert.deepEqual(next.correspondenceProgress, {});
});

test('v22: imported achievement is never auto-coalesced into future intent or converted to Enrollment', () => {
  const state = { ...initialState(), planIntents: [intent()] };
  const imported = { ...state, importedCourseAchievements: [achievement({ courseId: matched.courseId })] };
  const next = applyImport(imported, []);
  assert.deepEqual(next.planIntents, state.planIntents);
  assert.deepEqual(next.items, []);
  assert.deepEqual(next.importedCourseAchievements, imported.importedCourseAchievements);
  const pinned = pinOfferingRecords(next, catalog);
  assert.equal(validateState(pinned, catalog), true);
  assert.equal(enrollmentForIntent(pinned, id(1)), undefined);
});

test('v22: synthetic 2027 source facts cannot be resolved by the production 2026 adapter', () => {
  const synthetic = { ...matched, academicYear: 2027, id: id(20) };
  assert.equal(catalog2026Adapter.resolve({ academicYear: synthetic.academicYear, offeringId: synthetic.id, revisionId: 'test-only-2027' }), undefined);
  assert.ok(catalog.offerings.every(offering => offering.academicYear === 2026));
  assert.equal(catalog.metadata.graduationCheckComplete, false);
});

test('v22: valid recognition values are preserved, not normalized just because a migration occurred', () => {
  const base = v21();
  const profile = { ...base.graduationProfile, recognizedCredits: { ...base.graduationProfile.recognizedCredits,
    general: { ...base.graduationProfile.recognizedCredits.general, humanities: { mode: 'unknown', credits: 0 } } } };
  const before = v21({ graduationProfile: profile });
  assert.equal(validateLegacyState(before, catalog), true);
  const loaded = loadState(memoryStore(JSON.stringify(before)), catalog);
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.state.graduationProfile, profile);
  assert.equal(loaded.recognitionWarning, undefined);
  const raw = saveState(memoryStore(), loaded.state, null, catalog);
  assert.deepEqual(loadState(memoryStore(raw), catalog).state.graduationProfile, profile);
});

test('v22: malformed recognition structure is rejected, never thrown from runtime validation or repaired', () => {
  const base = initialState();
  for (const recognizedCredits of [null, {}, { ...base.graduationProfile.recognizedCredits, professionalCourses: undefined },
    { ...base.graduationProfile.recognizedCredits, general: { humanities: null } },
    { ...base.graduationProfile.recognizedCredits, general: { ...base.graduationProfile.recognizedCredits.general, malformedExtension: null } }]) {
    const invalid = { ...base, graduationProfile: { ...base.graduationProfile, recognizedCredits } };
    assert.equal(validateState(invalid, catalog), false);
    const raw = JSON.stringify(invalid); const store = memoryStore(raw);
    assert.notEqual(loadState(store, catalog).error, null);
    assert.equal(store.getItem(STORAGE_KEY), raw); assert.deepEqual(store.writes, []);
  }
});

test('v22: annual limit advisory still groups legacy items by planned calendar year, not source year or future intent', () => {
  const before = v21({ items: [
    { ...legacyItem(matched.id), plannedYear: 2027 },
    { ...legacyItem(media.id), plannedYear: 2028 },
    { ...legacyItem(correspondence.id), plannedYear: null },
  ] });
  const next = { ...migrateV21ToV22(before, catalog), planIntents: [intent({ plannedYear: 2029, targetAcademicYear: 2029 })] };
  const advisory = annualCreditLimitReferences(next.items, offeringsById);
  assert.deepEqual(advisory, annualCreditLimitReferences(before.items, offeringsById));
  assert.deepEqual(advisory.map(row => row.year), [2027, 2028]);
  assert.ok(next.items.every(item => item.offeringRef.academicYear === 2026));
});

test('v22: correspondence orphan and invalid recognition shadow references are pinned without deleting raw rows', () => {
  const base = v21();
  const rawRow = { id: 'shadow-row', offeringId: correspondence.id, courseId: null, mappingId: null, name: correspondence.name, credits: -1 };
  const source = { ...base, correspondenceProgress: { [correspondence.id]: progressForCorrespondence(correspondence, {}) },
    graduationProfile: { ...base.graduationProfile, recognizedCredits: { ...base.graduationProfile.recognizedCredits, professionalCourses: [rawRow] } } };
  const store = memoryStore(JSON.stringify(source));
  let loaded = loadState(store, catalog);
  assert.equal(loaded.error, null);
  assert.ok(loaded.recognitionWarning);
  assert.deepEqual(loaded.state.graduationProfile.recognizedCredits.professionalCourses, []);
  assert.deepEqual(offeringReference(loaded.state, correspondence.id), offeringRef2026(correspondence.id));
  loaded = saveRecoveredState(store, { ...loaded.state, planIntents: [intent()] }, loaded, catalog);
  assert.deepEqual(JSON.parse(store.getItem(STORAGE_KEY)).graduationProfile.recognizedCredits.professionalCourses, [rawRow]);
  const added = addEnrollment(loaded.state, enrollment(correspondence.id), catalog);
  const removed = removeEnrollment(added, correspondence.id);
  assert.deepEqual(offeringReference(removed, correspondence.id), offeringRef2026(correspondence.id));
  assert.deepEqual(removed.correspondenceProgress, source.correspondenceProgress);
});

test('v22: derived plan rows read binding only from Enrollment, never merge imports or persist linked flags', () => {
  const bound = boundState();
  const future = intent({ id: id(2) });
  const state = { ...bound, planIntents: [...bound.planIntents, future], importedCourseAchievements: [achievement()] };
  const before = JSON.stringify(state);
  const rows = foundationPlanRows(state);
  assert.deepEqual(rows.map(row => row.kind), ['annual', 'course_intent', 'imported']);
  assert.equal(rows[0].intent, state.planIntents[0]);
  assert.equal(rows[0].item, state.items[0]);
  assert.equal(rows[1].intent, future);
  assert.equal(rows[2].achievement, state.importedCourseAchievements[0]);
  assert.equal(JSON.stringify(state), before, 'read model never mutates/persists state');
  const unlinked = { ...state, items: state.items.map(item => ({ ...item, planIntentId: null, linkDecision: null })) };
  assert.equal(foundationPlanRows(unlinked).filter(row => row.kind === 'course_intent').length, 2);
  assert.equal(enrollmentForIntent(unlinked, state.planIntents[0].id), undefined);
});
