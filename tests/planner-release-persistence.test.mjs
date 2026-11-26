import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { transform } from 'esbuild';
import { openSameOriginAuthority, sameOriginImportedRows, SAME_ORIGIN_AUTHORITY as A } from '../src/planner/candidate2026/sameOriginAuthority.ts';
import { initialState, STORAGE_KEY as P, BACKUP_KEY as R } from '../src/planner/backup/storage.ts';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { isMediaSchooling } from '../src/planner/progress/mediaSchooling.ts';
import { createPlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { applyImport, importPreview } from '../src/planner/gradeImport/gradeImportApply.ts';

// Execute the pinned old authority code against the unchanged shared helpers.
async function openOldAuthority(name, digest) {
  const bytes = await readFile(new URL('./fixtures/planner-release/' + name, import.meta.url));
  const source = name.endsWith('.gz') ? gunzipSync(bytes) : bytes;
  assert.equal(createHash('sha256').update(source).digest('hex'), digest);
  const writerDirectory = new URL('../src/planner/candidate2026/', import.meta.url);
  const { code } = await transform(source.toString(), { loader: 'ts', format: 'esm' });
  const rebased = code.replace(/from "([.][^"]+)"/g, (_, specifier) => {
    const url = new URL(specifier, writerDirectory);
    if (!url.pathname.endsWith('.mjs')) url.pathname += '.ts';
    return 'from ' + JSON.stringify(url.href);
  });
  return (await import('data:text/javascript;base64,' + Buffer.from(rebased).toString('base64'))).openSameOriginAuthority;
}
const openV2 = await openOldAuthority('authority-v2.ts.txt', '7ae505621778a9bbb24c4b1b6a6761f3be5aac372417448b02d62e3182f6058d');
const encode = input => new TextEncoder().encode(input);
const empty = { rawYear: '', year: null, rawTerm: '', term: null, rawDate: '', date: null, rawCredits: '', credits: null, rawGrade: '', grade: null };
const numeric = value => ({ raw: value === null ? '' : String(value), value });
const data = { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-11-23T00:00:00Z', courses: [{
  rawName: '経営学特講（合成未照合）', categoryRaw: null, compositionCredits: numeric(4), earnedCredits: numeric(1),
  schoolingCredits: numeric(0), recognizedExemption: numeric(null), additionalEnrollment: numeric(null),
  reports: Array.from({ length: 4 }, () => ({ raw: '', status: 'none', date: null })),
  creditExam: { rawDate: '', date: null, rawCredits: '', credits: null, rawGrade: '', grade: null, pendingMarker: false },
  schoolings: [{ ...empty, rawYear: '2026', year: '2026', rawTerm: 'メ', term: 'メ' }, empty],
}] };
const isCurrent = () => true;
function storeFixture() {
  const values = new Map(), writes = [];
  let tail = Promise.resolve();
  const options = {
    store: { getItem: key => values.get(key) ?? null, setItem: (key, raw) => { writes.push(key); values.set(key, raw); } },
    catalog, isAdmitted: () => true, checkEnvironment: async () => {},
    locks: { request(_name, _options, run) { const next = tail.then(run); tail = next.catch(() => {}); return next; } },
  };
  return { values, writes, open: (factory = openSameOriginAuthority) => factory(options) };
}
const exportBackup = async port => {
  let text;
  await port.exportAuthority(value => { text = value; });
  return text;
};
async function restore(port, text) {
  const input = encode(text);
  const receipt = await port.prepareRestore(input);
  let proof;
  await port.protectionFile(receipt, raw => { proof = encode(raw); });
  await assert.rejects(port.verifyRestore(receipt, input, encode(new TextDecoder().decode(proof) + ' ')));
  await port.verifyRestore(receipt, input, proof);
  return port.restore(receipt, isCurrent);
}
function ingest(state, input) {
  return applyImport(state, importPreview(input, catalog.offerings, state.importedStudyRecords, state.importedCourseAchievements), catalog.offerings);
}

test('empty authority starts in v3; unlinked native media saves and restores without migration consent', async () => {
  const fixture = storeFixture();
  const port = fixture.open();
  const empty = await port.refresh();
  assert.equal(empty.raw, null);
  assert.equal(empty.needsIndependentUpgrade, false);
  const sport = { ...data.courses[0], rawName: '健康・スポーツ科学概論［スポーツコーチングの基礎］(後期メディア)',
    earnedCredits: numeric(0), schoolings: [{ ...data.courses[0].schoolings[0], rawTerm: '後期メディア', term: '後期メディア' }, data.courses[0].schoolings[1]] };
  const next = ingest(empty.state, { ...data, courses: [sport] });
  const [{ row, record }] = sameOriginImportedRows(next, new Map(catalog.offerings.map(o => [o.id, o])), []).independent;
  assert.equal(row.courseId, null);
  assert.equal(row.selectedOfferingId, null);
  assert.equal(next.importedCourseUserMeta[row.id].lifecycleStatus, 'in_progress');
  const plan = await port.save(null, next, isCurrent);
  assert.equal(JSON.parse(plan.raw).version, 3);
  assert.equal(plan.needsIndependentUpgrade, false);
  const progress = { totalLessons: 14, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: true }], assessments: [] };
  const media = await port.save(plan.raw, plan.state, isCurrent, {
    offeringId: null, sourceId: row.id, recordId: record.id, approveV3: false, progress,
  });
  assert.equal(JSON.parse(media.raw).primaryRaw, JSON.parse(plan.raw).primaryRaw);
  const [track] = JSON.parse(media.raw).tracks;
  assert.equal(track.offeringId, null);
  assert.equal(track.owner, record.id);
  assert.deepEqual((await fixture.open().refresh()).independentProgress[record.id], progress);
  const restored = await restore(storeFixture().open(), await exportBackup(port));
  assert.deepEqual(JSON.parse(restored.raw).tracks, [track]);
  assert.equal(restored.needsIndependentUpgrade, false);
  assert.deepEqual(fixture.writes, [A, A]);
  assert.equal(fixture.values.has(P), false);
  assert.equal(fixture.values.has(R), false);
});

test('v2 stays read-only on boot; consented v3 preserves source and original strings; old writers fail closed', async () => {
  const fixture = storeFixture();
  const old = fixture.open(openV2);
  const initial = await old.refresh();
  const next = ingest(initial.state, data);
  const source = next.importedCourseAchievements[0];
  const record = next.importedStudyRecords.find(row => row.sourceCourseId === source.id);
  assert.equal(source.courseId, null);
  assert.deepEqual(source.candidateOfferingIds, []);
  assert.equal(next.importedCourseUserMeta[source.id].lifecycleStatus, 'in_progress');
  const previous = await old.save(initial.raw, next, isCurrent);
  const editor = fixture.open();
  assert.equal((await editor.refresh()).raw, previous.raw);
  assert.equal(editor.view().needsIndependentUpgrade, true);
  assert.deepEqual(fixture.writes, [A]);
  const oldBackup = await exportBackup(editor);
  assert.equal(JSON.parse(previous.raw).version, 2);
  assert.equal(JSON.parse(oldBackup).format, 'hosei-planner:2026:portable:v2');
  const oldLoaded = fixture.open(openV2);
  assert.equal((await oldLoaded.refresh()).error, null);
  const update = { offeringId: null, sourceId: source.id, recordId: record.id, approveV3: false,
    progress: { totalLessons: 14, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }], assessments: [] } };
  await assert.rejects(editor.save(previous.raw, next, isCurrent, update), /保存形式/);
  assert.deepEqual(fixture.writes, [A]);
  const migrated = await editor.save(previous.raw, next, isCurrent, { ...update, approveV3: true });
  const state = JSON.parse(migrated.raw);
  assert.equal(state.version, 3);
  assert.equal(state.primaryRaw, JSON.parse(previous.raw).primaryRaw);
  const [track] = state.tracks;
  assert.equal(track.offeringId, null);
  assert.equal(track.owner, record.id);
  assert.deepEqual(fixture.writes, [A, A]);
  assert.equal(fixture.values.get(P), undefined);
  assert.equal(fixture.values.get(R), undefined);
  await assert.rejects(oldLoaded.save(previous.raw, next, isCurrent));
  assert.ok((await old.refresh()).error);
  assert.ok((await fixture.open(openV2).refresh()).error);
  assert.deepEqual(fixture.writes, [A, A]);

  const reopened = fixture.open();
  assert.equal((await reopened.refresh()).raw, migrated.raw);
  assert.deepEqual(fixture.writes, [A, A]);
  const afterMeta = { ...next, importedCourseUserMeta: {
    ...next.importedCourseUserMeta, [source.id]: { ...next.importedCourseUserMeta[source.id], lifecycleStatus: null },
  } };
  const reimported = ingest(afterMeta, { ...data, courses: [...data.courses, { ...data.courses[0], rawName: '合成追加行' }] });
  const saved = await reopened.save(migrated.raw, reimported, isCurrent);
  assert.equal(saved.state.importedCourseUserMeta[source.id].lifecycleStatus, null);
  assert.deepEqual(JSON.parse(saved.raw).tracks, [track]);
  assert.deepEqual(saved.state.importedCourseAchievements.find(row => row.id === source.id), source);
  const newBackup = await exportBackup(reopened);
  assert.equal(JSON.parse(newBackup).format, 'hosei-planner:2026:portable:v3');
  for (const text of [oldBackup, newBackup]) {
    const clean = storeFixture();
    const restored = await restore(clean.open(), text);
    const exported = JSON.parse(JSON.parse(text).envelope);
    assert.equal(JSON.parse(restored.raw).primaryRaw, exported.primaryRaw);
    assert.deepEqual(JSON.parse(restored.raw).tracks, exported.tracks);
    assert.deepEqual(clean.writes, [A]);
  }
  await assert.rejects(reopened.prepareRestore(encode(oldBackup)), /履修回が一致/);
  const forged = JSON.parse(newBackup);
  forged.envelope += ' ';
  await assert.rejects(reopened.prepareRestore(encode(JSON.stringify(forged))), /保存形式/);
  assert.equal((await reopened.refresh()).raw, saved.raw);
  assert.deepEqual(fixture.writes, [A, A, A]);
});

test('ordinary portable v2 imports keep legacy P/R bytes and never initialize existing personal state', async () => {
  const fixture = storeFixture();
  const old = JSON.stringify(initialState(), null, 2);
  fixture.values.set(P, old);
  fixture.values.set(R, '');
  const port = fixture.open();
  const restored = await restore(port, JSON.stringify(await createPlannerBackup(old, catalog)));
  assert.equal(JSON.parse(restored.raw).version, 2);
  assert.equal(JSON.parse(restored.raw).primaryRaw, old);
  assert.equal(fixture.values.get(P), old);
  assert.equal(fixture.values.get(R), '');
  assert.deepEqual(fixture.writes, [A]);
});


test('native media evidence is keyed to the official row for unlinked, automatic and manual matches', () => {
  const next = ingest(initialState(), data);
  const source = next.importedCourseAchievements[0];
  const record = next.importedStudyRecords.find(row => row.sourceCourseId === source.id);
  const offerings = new Map(catalog.offerings.map(row => [row.id, row]));
  const offering = catalog.offerings.find(isMediaSchooling);
  assert.ok(offering);
  for (const selectionSource of ['none', 'auto', 'manual']) {
    const selected = selectionSource === 'none' ? source : {
      ...source, selectedOfferingId: offering.id, selectionSource, courseId: offering.courseId,
    };
    const selectedState = { ...next, importedCourseAchievements: [selected] };
    const result = sameOriginImportedRows(selectedState, offerings, []);
    assert.deepEqual(result.independent.map(({ row, record }) => [row.id, record.id]), [[source.id, record.id]]);
    assert.equal(result.managed.media.length, 0);
    assert.deepEqual(sameOriginImportedRows(selectedState, offerings, [source.id]).independent, []);
  }
});

test('complete, partial and composition-unknown records can be edited when the learner selects in-progress', async () => {
  const fixture = storeFixture();
  const port = fixture.open();
  const pending = data.courses[0];
  const complete = { ...pending, rawName: '合成修得済メディア', earnedCredits: numeric(4),
    schoolings: [{ ...pending.schoolings[0], rawGrade: 'A', grade: 'A' }, empty] };
  const unknown = { ...complete, rawName: '合成構成不明メディア', compositionCredits: numeric(null),
    earnedCredits: numeric(2), schoolings: [{ ...complete.schoolings[0], rawGrade: 'B', grade: 'B' }, empty] };
  const repeated = { ...pending, schoolings: [{ ...pending.schoolings[0], rawYear: '2027', year: '2027' }, empty] };
  const input = { ...data, courses: [pending, repeated, unknown, complete] };
  const initial = ingest((await port.refresh()).state, input);
  const meta = { ...initial.importedCourseUserMeta };
  assert.deepEqual(initial.importedCourseAchievements.map(row => meta[row.id]?.lifecycleStatus ?? null),
    ['in_progress', 'in_progress', null, null]);
  for (const official of initial.importedCourseAchievements) {
    const added = { lifecycleStatus: 'in_progress', plannedYear: null, plannedTerm: null, studyYear: null };
    meta[official.id] ??= added;
  }
  const next = { ...initial, importedCourseUserMeta: meta };
  let saved = await port.save(null, next, isCurrent);
  const original = JSON.parse(saved.raw).primaryRaw;
  const offerings = new Map(catalog.offerings.map(row => [row.id, row]));
  const cases = sameOriginImportedRows(saved.state, offerings, []).independent;
  assert.equal(cases.length, 4);
  assert.deepEqual(cases.map(({ row, record }) => [row.earnedCreditsTotal, record.rawYear]),
    [[1, '2026'], [1, '2027'], [2, '2026'], [4, '2026']]);
  for (const [index, { record, row }] of cases.entries()) {
    saved = await port.save(saved.raw, saved.state, isCurrent, {
      offeringId: null, recordId: record.id, sourceId: row.id, approveV3: false,
      progress: { totalLessons: 14 + index, lessons: [], assessments: [] },
    });
  }
  const { tracks, primaryRaw } = JSON.parse(saved.raw);
  assert.equal(primaryRaw, original);
  assert.equal(new Set(tracks.map(track => track.id)).size, 4);
  assert.deepEqual(tracks.map(track => track.owner), cases.map(({ record }) => record.id));
  assert.deepEqual(tracks.map(track => track.sourceId), cases.map(({ row }) => row.id));
  assert.ok(tracks.every(track => track.offeringId === null));
  assert.deepEqual((await fixture.open().refresh()).independentProgress, saved.independentProgress);
  const reimport = ingest(saved.state, input);
  assert.deepEqual(reimport.importedCourseUserMeta, meta);
  assert.deepEqual(reimport.importedStudyRecords.map(row => row.id), initial.importedStudyRecords.map(row => row.id));
  assert.ok(fixture.writes.every(key => key === A));
});

test('automatic and manual catalog references do not determine the active UUID', () => {
  const offerId = '04ff86ca-33da-4030-ae9e-6090938ddf7b';
  const opening = catalog.offerings.find(row => row.id === offerId);
  assert.ok(isMediaSchooling(opening));
  const other = data.courses[0];
  const input = { ...data, courses: [{ ...other, rawName: opening.name, earnedCredits: numeric(0),
    schoolings: [{ ...other.schoolings[0], rawTerm: opening.deliveryCategory, term: opening.deliveryCategory }, empty] }] };
  const state = ingest(initialState(), input);
  const source = state.importedCourseAchievements[0];
  const original = state.importedStudyRecords.find(row => row.sourceCourseId === source.id);
  const offerings = new Map(catalog.offerings.map(row => [row.id, row]));
  assert.equal(source.selectionSource, 'auto');
  assert.equal(source.selectedOfferingId, opening.id);
  assert.equal(state.items.find(row => row.offeringId === opening.id)?.importedSourceCourseId, source.id);
  const resolve = next => sameOriginImportedRows(next, offerings, []).independent.map(({ record }) => record.id);
  assert.deepEqual(resolve(state), [original.id]);
  assert.deepEqual(resolve({ ...state, importedCourseAchievements: [{ ...source, selectionSource: 'manual' }] }), [original.id]);
});

test('confirmed legacy carry-forward closes the retained v2 reader and an already-open old writer', async () => {
  const input = gunzipSync(await readFile(new URL('./fixtures/planner-release/ordinary-dev.json.gz', import.meta.url))).toString('utf8');
  const fixture = storeFixture();
  const active = fixture.open();
  const restored = await restore(active, input);
  const old = fixture.open(openV2);
  assert.equal((await old.refresh()).error, null);
  const oldPortable = await exportBackup(old);
  const confirmed = await active.save(restored.raw, restored.state, isCurrent, { legacyReview: restored.legacyProgressReviews[0] });
  assert.equal(JSON.parse(confirmed.raw).version, 4);
  await assert.rejects(old.save(restored.raw, restored.state, isCurrent));
  assert.ok((await fixture.open(openV2).refresh()).error);
  await assert.rejects(fixture.open(openV2).save(confirmed.raw, restored.state, isCurrent));
  await assert.rejects(active.prepareRestore(encode(oldPortable)), /以前の保存形式/);
  const oldDestination = storeFixture();
  await assert.rejects(oldDestination.open(openV2).prepareRestore(encode(await exportBackup(active))));
  assert.deepEqual(oldDestination.writes, []);
  assert.equal(fixture.values.get(A), confirmed.raw);
  assert.deepEqual(fixture.writes, [A, A]);
});

test('v5 import claim closes the pinned v3/v4 readers and their pre-existing writers', async () => {
  const input = gunzipSync(await readFile(new URL('./fixtures/planner-release/ordinary-dev-import.json.gz', import.meta.url))).toString('utf8');
  const fixture = storeFixture();
  const active = fixture.open();
  const ordinary = await restore(active, input);
  const previousReaders = await Promise.all([
    openOldAuthority('authority-v3.ts.gz', '5172ba009ec6d8ccf938d51599ab8ddee8c767859e0c142c57f57033171ecfc6'),
    openOldAuthority('authority-v4.ts.gz', '609d71d1a72cf9f379f678dbfc0eb6370fa0aa183a8325341aad7182dd3447c4'),
  ]);
  const staleWriters = previousReaders.map(read => fixture.open(read));
  for (const stale of staleWriters) assert.equal((await stale.refresh()).error, null);
  const before = await exportBackup(active);
  const carried = await active.save(ordinary.raw, ordinary.state, isCurrent, { legacyReview: ordinary.legacyProgressReviews[0] });
  const portable = await exportBackup(active);
  const [track] = JSON.parse(carried.raw).tracks;
  assert.equal(JSON.parse(carried.raw).version, 5);
  for (const stale of staleWriters) await assert.rejects(stale.save(ordinary.raw, ordinary.state, isCurrent));
  for (const openPrevious of previousReaders) {
    const reopened = fixture.open(openPrevious);
    assert.ok((await reopened.refresh()).error);
    await assert.rejects(reopened.save(carried.raw, carried.state, isCurrent));
    const target = storeFixture();
    await assert.rejects(target.open(openPrevious).prepareRestore(encode(portable)));
    assert.deepEqual(target.writes, []);
  }
  await assert.rejects(active.prepareRestore(encode(before)), /以前の保存形式/);
  assert.equal(JSON.parse(fixture.values.get(A)).tracks[0].id, track.id);
  assert.deepEqual(fixture.writes, [A, A]);
});
