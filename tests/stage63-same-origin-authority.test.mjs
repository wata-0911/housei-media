import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { openSameOriginAuthority, SAME_ORIGIN_AUTHORITY as A } from '../src/planner/candidate2026/sameOriginAuthority.ts';
import { STORAGE_KEY as P, BACKUP_KEY as R, initialState } from '../src/planner/backup/storage.ts';
import { createPlannerBackup } from '../src/planner/backup/plannerBackup.ts';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { backupRawDigest } from '../src/planner/digest.ts';
import { isMediaSchooling } from '../src/planner/progress/mediaSchooling.ts';
import { plannerItemFromCourseSearch } from '../src/planner/planning/plannerItemState.ts';

const encoder = new TextEncoder();
const encode = s => encoder.encode(s);
const fixture = () => {
  const values = new Map();
  const writes = [];
  let fail = false, admitted = true, inspect = async () => {}, tail = Promise.resolve();
  const store = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (fail) throw new DOMException('storage full', 'QuotaExceededError');
      writes.push(key);
      assert.equal(key, A, 'newer writer may write only its own key');
      values.set(key, value);
    },
  };
  const locks = { request(_key, _options, work) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  } };
  const open = (options = {}) => openSameOriginAuthority({ store, catalog, locks,
    isAdmitted: () => admitted, checkEnvironment: () => inspect(), ...options });
  return { store, values, writes, open, deny: () => { admitted = false; },
    quota: () => { fail = true; }, useInspector: fn => { inspect = fn; } };
};
const backup = async raw => encode(JSON.stringify(await createPlannerBackup(raw, catalog)));
const completeReceipt = async (port, input) => {
  const receipt = await port.prepareRestore(input);
  let proof;
  await port.protectionFile(receipt, raw => { proof = encode(raw); });
  await port.verifyRestore(receipt, input.slice(), proof.slice());
  return { receipt, proof };
};

test('legacy migration is one A write, preserving noncanonical P and exact R; original file and protection must be reselected', async () => {
  const f = fixture();
  const old = JSON.stringify(initialState(), null, 2);
  f.values.set(P, old);
  f.values.set(R, '');
  const port = f.open();
  const original = await backup(old);
  const token = await port.prepareRestore(original);
  await assert.rejects(port.restore(token, () => true));
  await assert.rejects(port.verifyRestore(token, original, encode(token.protection)), /一致/);
  let issued;
  await port.protectionFile(token, raw => { issued = encode(raw); });
  await assert.rejects(port.verifyRestore(token, encode(' ' + new TextDecoder().decode(original)), issued), /一致/);
  assert.deepEqual(f.writes, []);
  await port.verifyRestore(token, original.slice(), issued.slice());
  const result = await port.restore(token, () => true);
  assert.equal(result.error, null);
  assert.deepEqual(f.writes, [A]);
  assert.equal(f.values.get(P), old);
  assert.equal(f.values.get(R), '');
  assert.equal(JSON.parse(result.raw).primaryRaw, old);
  await assert.rejects(port.prepareRestore(original), /旧形式/);
});

test('synchronous comparison rejects legacy writes without a storage event, including restart and restore waits', async () => {
  const f = fixture(), port = f.open(), first = await port.save(null, initialState(), () => true);
  let exported;
  await port.exportAuthority(value => { exported = value; });
  const { receipt } = await completeReceipt(port, encode(exported));
  f.useInspector(async () => { f.values.set(P, 'late original'); });
  await assert.rejects(port.restore(receipt, () => true));
  assert.equal(f.values.get(A), first.raw);
  assert.deepEqual(f.writes, [A]);
  assert.notEqual((await f.open().refresh()).error, null);
  await assert.rejects(f.open().save(first.raw, initialState(), () => true));
  let original;
  port.legacyOriginals(raw => { original = JSON.parse(raw); });
  assert.equal(original.p, 'late original');
  assert.equal(original.r, null);
});

test('retired confirmation, cancel, missing lock/admission, unknown environment and unreadable storage are closed', async t => {
  const f = fixture(), port = f.open();
  const { receipt } = await completeReceipt(port, await backup(null));
  await assert.rejects(port.restore(receipt, () => false));
  await assert.rejects(port.restore(receipt, () => true));
  const next = await completeReceipt(port, await backup(null));
  port.cancelRestore();
  await assert.rejects(port.restore(next.receipt, () => true));
  for (const options of [{ locks: undefined }, { isAdmitted: () => false }, { checkEnvironment: async () => { throw new Error('Unknown inventory'); } }]) {
    const unavailable = f.open(options);
    assert.notEqual((await unavailable.refresh()).error, null);
    await assert.rejects(unavailable.save(null, initialState(), () => true));
  }
  const unreadable = f.open({ store: { ...f.store, getItem() { throw new Error('unreadable'); } } });
  assert.notEqual((await unreadable.refresh()).error, null);
  await assert.rejects(unreadable.save(null, initialState(), () => true));
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const expired = await completeReceipt(port, await backup(null));
  t.mock.timers.setTime(15 * 60 * 1000);
  await assert.rejects(port.restore(expired.receipt, () => true));
  assert.deepEqual(f.writes, []);
});

test('CAS has one winner; same-state undo and protected restore use new ids; quota leaves bytes intact', async () => {
  const f = fixture(), a = f.open(), b = f.open();
  const [winner, late] = await Promise.allSettled([a.save(null, initialState(), () => true), b.save(null, initialState(), () => true)]);
  assert.equal(winner.status, 'fulfilled');
  assert.equal(late.status, 'rejected');
  const saved = winner.value;
  const undo = await a.save(saved.raw, initialState(), () => true);
  assert.notEqual(JSON.parse(saved.raw).generation, JSON.parse(undo.raw).generation);
  let output;
  await a.exportAuthority(raw => { output = raw; });
  const checked = await completeReceipt(a, encode(output));
  const restored = await a.restore(checked.receipt, () => true);
  assert.notEqual(JSON.parse(restored.raw).generation, JSON.parse(undo.raw).generation);
  f.quota();
  await assert.rejects(a.save(restored.raw, initialState(), () => true), { name: 'QuotaExceededError' });
  assert.equal(f.values.get(A), restored.raw);
  assert.deepEqual(f.writes, [A, A, A]);
});

test('malformed A is not repaired or overwritten, raw hold export keeps the bytes', async () => {
  const f = fixture();
  f.values.set(A, '{"unexpected":true}');
  const port = f.open();
  assert.notEqual((await port.refresh()).error, null);
  await assert.rejects(port.save(f.values.get(A), initialState(), () => true));
  let original;
  port.authorityOriginal(text => { original = text; });
  assert.equal(original, f.values.get(A));
  assert.deepEqual(f.writes, []);
});

test('plan ownership creates and retains a UUID and rejects reallocation on altered identity', async () => {
  const f = fixture(), port = f.open(), offering = catalog.offerings.find(isMediaSchooling);
  assert.ok(offering);
  const next = { ...initialState(), items: [plannerItemFromCourseSearch(offering.id)] };
  const first = await port.save(null, next, () => true);
  const edit = { offeringId: offering.id, sourceId: null, progress: { offeringId: offering.id, totalLessons: 14,
    lessons: [{ lesson: 1, videoCompleted: true, testCompleted: true }], assessments: [] } };
  const second = await port.save(first.raw, next, () => true, edit);
  const third = await port.save(second.raw, next, () => true, edit);
  assert.equal(JSON.parse(second.raw).tracks[0].id, JSON.parse(third.raw).tracks[0].id);
  assert.deepEqual(third.state.mediaSchoolingProgress, {});
  assert.deepEqual(third.progress[offering.id], edit.progress);
  await assert.rejects(port.save(third.raw, { ...next, items: [{ ...next.items[0], plannedYear: 2027 }] }, () => true));
  assert.equal(f.values.get(A), third.raw);
});

test('legacy offering-keyed progress is retained without enrolling it under a guessed UUID', async () => {
  const f = fixture();
  const offering = catalog.offerings.find(isMediaSchooling);
  const existing = { ...initialState(), items: [plannerItemFromCourseSearch(offering.id)],
    mediaSchoolingProgress: { [offering.id]: { offeringId: offering.id, totalLessons: 14,
      lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }], assessments: [] } } };
  const old = JSON.stringify(existing);
  f.values.set(P, old);
  const port = f.open();
  const { receipt } = await completeReceipt(port, await backup(old));
  const migrated = await port.restore(receipt, () => true);
  await assert.rejects(port.save(migrated.raw, existing, () => true, { offeringId: offering.id, sourceId: null,
    progress: existing.mediaSchoolingProgress[offering.id] }), /履修回/);
  assert.equal(f.values.get(P), old);
  assert.deepEqual(JSON.parse(f.values.get(A)).tracks, []);
  assert.deepEqual(f.writes, [A]);
});

const ordinaryOffering = '0432dfc2-8a48-498d-b754-f030b480f571';
async function ordinaryDevBackup() {
  const raw = gunzipSync(await readFile(new URL('./fixtures/planner-release/ordinary-dev.json.gz', import.meta.url)));
  assert.equal(createHash('sha256').update(raw).digest('hex'), '55dbb1ff7dc5d0adcb8136ce7572be53d7559e22aa65ce2d867b9b0460848648');
  return raw;
}

test('audit P1: confirmed ordinary dev backup resumes at 1/14 and saves 2/14 with stable UUID and source', async () => {
  const original = await ordinaryDevBackup();
  const sourceState = JSON.parse(original.toString()).state;
  const f = fixture();
  const originalP = JSON.stringify(sourceState, null, 2);
  const originalR = 'retained recovery original';
  f.values.set(P, originalP);
  f.values.set(R, originalR);
  const port = f.open();
  const { receipt, proof } = await completeReceipt(port, original);
  const protectedFile = proof.slice();
  const restored = await port.restore(receipt, () => true);
  const unclaimed = JSON.parse(restored.raw);
  assert.equal(unclaimed.version, 2);
  assert.deepEqual(unclaimed.tracks, []);
  assert.equal(unclaimed.primaryRaw, originalP);
  const review = restored.legacyProgressReviews?.find(value => value.offeringId === ordinaryOffering);
  assert.ok(review, 'a restored single unlinked personal plan must offer explicit carry-forward');
  assert.equal(review.year, 2026);
  const progress = restored.progress[ordinaryOffering];
  assert.equal(progress.totalLessons, 14);
  assert.equal(progress.lessons.filter(lesson => lesson.videoCompleted).length, 1);
  await assert.rejects(port.save(restored.raw, restored.state, () => true,
    { offeringId: ordinaryOffering, sourceId: null, progress }), /履修回/);
  await assert.rejects(port.save(restored.raw, restored.state, () => false, { legacyReview: review }));
  assert.equal(f.values.get(A), restored.raw);
  assert.deepEqual(f.writes, [A]);

  const claimed = await port.save(restored.raw, restored.state, () => true, { legacyReview: review });
  const envelope = JSON.parse(claimed.raw);
  const [track] = envelope.tracks;
  assert.equal(envelope.version, 4);
  assert.equal(envelope.primaryRaw, unclaimed.primaryRaw);
  assert.deepEqual(track.progress, progress);
  assert.deepEqual(claimed.legacyProgressReviews, []);
  assert.deepEqual(claimed.claimedLegacyOfferingIds, [ordinaryOffering]);
  await assert.rejects(port.save(claimed.raw, claimed.state, () => true, { legacyReview: review }), /引継ぎ/);
  const updated = { ...progress, lessons: [...progress.lessons, { lesson: 2, videoCompleted: true, testCompleted: false }] };
  await port.save(claimed.raw, claimed.state, () => true, { offeringId: ordinaryOffering, sourceId: null, progress: updated });
  const reload = f.open();
  const current = await reload.refresh();
  assert.equal(current.error, null);
  assert.deepEqual(current.progress[ordinaryOffering], updated);
  assert.deepEqual(current.state.mediaSchoolingProgress[ordinaryOffering], progress);
  assert.equal(JSON.parse(current.raw).tracks[0].id, track.id);
  assert.equal(JSON.parse(current.raw).primaryRaw, unclaimed.primaryRaw);

  let exported;
  await reload.exportAuthority(value => { exported = JSON.parse(value); });
  assert.equal(exported.format, 'hosei-planner:2026:portable:v4');
  const modified = JSON.parse(exported.envelope);
  modified.tracks[0].legacyOriginal += ' ';
  const modifiedRaw = JSON.stringify(modified);
  await assert.rejects(reload.prepareRestore(encode(JSON.stringify({ ...exported, envelope: modifiedRaw }))), /原文/);
  await assert.rejects(reload.prepareRestore(encode(JSON.stringify({
    ...exported, envelope: modifiedRaw, sha256: await backupRawDigest(modifiedRaw),
  }))), /原文/);
  await assert.rejects(reload.prepareRestore(original), /旧形式/);
  assert.deepEqual(f.writes, [A, A, A]);
  assert.equal(f.store.getItem(P), originalP);
  assert.equal(f.store.getItem(R), originalR);
  assert.equal(f.values.get(A), current.raw);
  assert.deepEqual(proof, protectedFile);
  assert.deepEqual(original, await ordinaryDevBackup());

  const destination = fixture().open();
  const imported = await completeReceipt(destination, encode(JSON.stringify(exported)));
  const roundtrip = await destination.restore(imported.receipt, () => true);
  assert.deepEqual(roundtrip.progress[ordinaryOffering], updated);
  assert.deepEqual(JSON.parse(roundtrip.raw).tracks, JSON.parse(current.raw).tracks);
  assert.equal(JSON.parse(roundtrip.raw).primaryRaw, unclaimed.primaryRaw);
});

test('legacy carry-forward is unavailable for a conflicting, missing, different-year, or imported owner', async () => {
  const original = JSON.parse((await ordinaryDevBackup()).toString()).state;
  const [plan] = original.items;
  const variants = [
    [{ ...plan, plannedYear: 2027 }],
    [{ ...plan, status: 'waiting' }],
    [{ ...plan, plannedTerm: '前期' }],
    [{ ...plan, importedSourceCourseId: crypto.randomUUID() }],
    [],
    [plan, { ...plan, plannedYear: 2027 }],
  ];
  for (const items of variants) {
    const f = fixture();
    // Simulate an already restored candidate, including invalid duplicate and dangling inputs.
    const raw = JSON.stringify({ generation: crypto.randomUUID(), legacy: { p: null, r: null },
      primaryRaw: JSON.stringify({ ...original, items }), version: 2, tracks: [] });
    f.values.set(A, raw);
    const port = f.open();
    const view = await port.refresh();
    assert.deepEqual(view.legacyProgressReviews ?? [], []);
    await assert.rejects(port.save(raw, { ...original, items }, () => true, { legacyReview: {
      offeringId: ordinaryOffering, year: 2026, owner: 'claimed owner', original: '{}',
    } }));
    assert.deepEqual(f.writes, []);
    assert.equal(f.values.get(A), raw);
  }
});

test('legacy carry-forward rechecks current consent, capability, raw and generation inside the shared lock', async () => {
  for (const change of ['cancel', 'lock absent', 'access', 'raw', 'generation', 'owner', 'original']) {
    const f = fixture();
    const active = f.open();
    const { receipt } = await completeReceipt(active, await ordinaryDevBackup());
    const restored = await active.restore(receipt, () => true);
    const [review] = restored.legacyProgressReviews;
    let accepted = true;
    const port = change === 'lock absent' ? f.open({ locks: undefined }) : active;
    if (change === 'owner') await assert.rejects(port.save(restored.raw, restored.state, () => true,
      { legacyReview: { ...review, owner: 'different owner' } }), /引継ぎ/);
    else if (change === 'original') await assert.rejects(port.save(restored.raw, restored.state, () => true,
      { legacyReview: { ...review, original: '{}' } }), /引継ぎ/);
    else {
      f.useInspector(async () => {
        if (change === 'cancel') accepted = false;
        if (change === 'access') f.deny();
        if (change === 'raw') f.values.set(R, 'external original');
        if (change === 'generation') f.values.set(A, JSON.stringify({ ...JSON.parse(restored.raw), generation: crypto.randomUUID() }));
      });
      await assert.rejects(port.save(restored.raw, restored.state, () => accepted, { legacyReview: review }));
    }
    assert.deepEqual(f.writes, [A]);
    if (change !== 'generation') assert.equal(f.values.get(A), restored.raw);
    assert.equal(f.store.getItem(P), null);
  }
});

const importedOffering = '04ff86ca-33da-4030-ae9e-6090938ddf7b';
const importedSource = '1f40ecf9-47f5-49e0-8115-9db1af9043d8';
const importedRecord = '7b69af41-0802-4bdc-bc29-adc526f53928';
async function ordinaryImportBackup() {
  const raw = gunzipSync(await readFile(new URL('./fixtures/planner-release/ordinary-dev-import.json.gz', import.meta.url)));
  assert.equal(createHash('sha256').update(raw).digest('hex'), '703d3cfc72af2bc8a0d5fac2903fc7b5c814608c9536072655af244b107a900a');
  return raw;
}
const importEdit = progress => ({ offeringId: null, recordId: importedRecord, sourceId: importedSource, progress, approveV3: true });
const importTestTwo = { lesson: 2, videoCompleted: false, testCompleted: true };

test('audit imported P1: video 1 and test 2 share the existing detail and one UUID after reload and portable restore', async () => {
  const original = await ordinaryImportBackup();
  const expected = JSON.parse(original.toString()).state;
  const p = JSON.stringify(expected, null, 2);
  const r = 'retained recovery original';
  const f = fixture();
  f.values.set(P, p);
  f.values.set(R, r);
  const port = f.open();
  const { receipt, proof } = await completeReceipt(port, original);
  const protectedBytes = proof.slice();
  const restored = await port.restore(receipt, () => true);
  assert.equal(JSON.parse(restored.raw).primaryRaw, p);
  assert.equal(JSON.parse(restored.raw).version, 2);
  assert.deepEqual(JSON.parse(restored.raw).tracks, []);
  assert.equal(restored.progress[importedOffering].lessons[0].lesson, 1);
  const review = restored.legacyProgressReviews?.find(candidate => candidate.offeringId === importedOffering);
  assert.ok(review?.imported, 'the audited single imported detail must have a carry-forward review');
  assert.equal(review.year, 2026);
  assert.equal(review.owner, importedRecord);
  assert.equal(review.imported.sourceId, importedSource);
  assert.equal(review.imported.term, '後期メディア');
  const withoutClaim = { totalLessons: 14, lessons: [importTestTwo], assessments: [] };
  await assert.rejects(port.save(restored.raw, restored.state, () => true, importEdit(withoutClaim)));
  await assert.rejects(port.save(restored.raw, restored.state, () => false, { legacyReview: review }));
  assert.deepEqual(f.writes, [A]);

  const claimed = await port.save(restored.raw, restored.state, () => true, { legacyReview: review });
  const envelope = JSON.parse(claimed.raw);
  const [track] = envelope.tracks;
  assert.equal(envelope.version, 5);
  assert.equal(envelope.primaryRaw, p);
  assert.equal(track.owner, importedRecord);
  assert.equal(track.sourceId, importedSource);
  assert.deepEqual(track.progress, { totalLessons: 14, lessons: [{ lesson: 1, videoCompleted: true, testCompleted: false }], assessments: [] });
  assert.deepEqual(claimed.legacyProgressReviews, []);
  await assert.rejects(port.save(claimed.raw, claimed.state, () => true, { legacyReview: review }));
  const progress = { ...track.progress, lessons: [...track.progress.lessons, importTestTwo] };
  const updated = await port.save(claimed.raw, claimed.state, () => true, importEdit(progress));
  const restarted = f.open();
  const reopened = await restarted.refresh();
  assert.equal(reopened.raw, updated.raw);
  assert.deepEqual(reopened.independentProgress[importedRecord], progress);
  assert.equal(JSON.parse(reopened.raw).tracks[0].id, track.id);
  assert.equal(JSON.parse(reopened.raw).primaryRaw, p);
  assert.deepEqual(reopened.state, expected);
  assert.equal(f.values.get(P), p);
  assert.equal(f.values.get(R), r);
  assert.deepEqual(f.writes, [A, A, A]);
  assert.deepEqual(proof, protectedBytes);
  assert.deepEqual(original, await ordinaryImportBackup());

  let exported;
  await restarted.exportAuthority(text => { exported = JSON.parse(text); });
  assert.equal(exported.format, 'hosei-planner:2026:portable:v5');
  const clean = fixture();
  const reader = clean.open();
  const { receipt: portable } = await completeReceipt(reader, encode(JSON.stringify(exported)));
  const roundtrip = await reader.restore(portable, () => true);
  assert.equal(JSON.parse(roundtrip.raw).primaryRaw, p);
  assert.deepEqual(JSON.parse(roundtrip.raw).tracks, JSON.parse(updated.raw).tracks);
  assert.deepEqual(roundtrip.independentProgress[importedRecord], progress);
  assert.deepEqual(clean.writes, [A]);
});

test('imported carry-forward holds missing, conflicting and mismatched attempts without overwriting either progress', async t => {
  const original = JSON.parse((await ordinaryImportBackup()).toString()).state;
  const changeRow = (state, edit) => Object.assign(state.importedCourseAchievements[0], edit);
  const changeRecord = (state, edit) => Object.assign(state.importedStudyRecords[0], edit);
  const variants = [
    ['offering missing', state => changeRecord(state, { offeringId: null })],
    ['raw year differs', state => changeRecord(state, { rawYear: '2027' })],
    ['raw term differs', state => changeRecord(state, { rawTerm: '前期メディア', term: '前期メディア' })],
    ['other official source', state => changeRecord(state, { sourceCourseId: crypto.randomUUID() })],
    ['more than one detail', state => state.importedStudyRecords.push({
      ...state.importedStudyRecords[0], id: crypto.randomUUID(), fingerprint: 'synthetic second detail',
    })],
    ['more than one source', state => state.importedCourseAchievements.push({
      ...state.importedCourseAchievements[0], id: crypto.randomUUID(), fingerprint: 'synthetic second source',
    })],
    ['selection missing', state => changeRow(state, { selectedOfferingId: null, selectionSource: 'none', candidateOfferingIds: [] })],
    ['active unlinked plan', state => { state.items[0].status = 'in_progress'; }],
    ['different user period', state => { state.importedCourseUserMeta[importedSource].plannedTerm = '前期'; }],
    ['different user year', state => { state.importedCourseUserMeta[importedSource].plannedYear = 2027; }],
  ];
  for (const [label, mutate] of variants) await t.test(label, async () => {
    const state = structuredClone(original);
    mutate(state);
    const f = fixture();
    const raw = JSON.stringify({ generation: crypto.randomUUID(), legacy: { p: null, r: null },
      primaryRaw: JSON.stringify(state), version: 2, tracks: [] });
    f.values.set(A, raw);
    const port = f.open();
    const view = await port.refresh();
    assert.deepEqual(view.legacyProgressReviews ?? [], []);
    await assert.rejects(port.save(raw, state, () => true, { legacyReview: {
      offeringId: importedOffering, year: 2026, owner: importedRecord, original: '{}',
    } }));
    await assert.rejects(port.save(raw, state, () => true,
      importEdit({ totalLessons: 14, lessons: [importTestTwo], assessments: [] })));
    assert.equal(f.values.get(A), raw);
    assert.deepEqual(f.writes, []);
  });

  const f = fixture();
  const standalone = { id: crypto.randomUUID(), offeringId: null, sourceId: importedSource, owner: importedRecord,
    progress: { totalLessons: 14, lessons: [importTestTwo], assessments: [] } };
  const existing = JSON.stringify({ generation: crypto.randomUUID(), legacy: { p: null, r: null },
    primaryRaw: JSON.stringify(original), version: 3, tracks: [standalone] });
  f.values.set(A, existing);
  const port = f.open(), view = await port.refresh();
  assert.equal(view.error, null);
  assert.deepEqual(view.legacyProgressReviews, []);
  assert.deepEqual(view.heldIndependentRecordIds, [importedRecord]);
  assert.deepEqual(view.independentProgress[importedRecord], standalone.progress);
  assert.deepEqual(view.progress[importedOffering], original.mediaSchoolingProgress[importedOffering]);
  await assert.rejects(port.save(existing, original, () => true, importEdit(standalone.progress)), /履修回/);
  assert.equal(f.values.get(A), existing);
  assert.deepEqual(f.writes, []);
});

test('imported carry-forward confirms the detail, original and authorization under the same write lock', async () => {
  const input = await ordinaryImportBackup();
  for (const change of ['owner', 'row', 'source evidence', 'original', 'cancel', 'lock absent', 'access', 'raw', 'generation', 'parallel']) {
    const f = fixture();
    const port = f.open();
    const { receipt } = await completeReceipt(port, input);
    const restored = await port.restore(receipt, () => true);
    const [review] = restored.legacyProgressReviews;
    let accepted = true;
    const writer = change === 'lock absent' ? f.open({ locks: undefined }) : port;
    const patch = change === 'owner' ? { owner: crypto.randomUUID() } : change === 'original' ? { original: '{}' } : {};
    const imported = change === 'row' ? { ...review.imported, sourceId: crypto.randomUUID() }
      : change === 'source evidence' ? { ...review.imported, recordFingerprint: 'wrong detail evidence' } : review.imported;
    const claim = { legacyReview: { ...review, ...patch, imported } };
    if (change === 'parallel') {
      const peer = f.open();
      const wins = await Promise.allSettled([port, peer].map(handle =>
        handle.save(restored.raw, restored.state, () => true, claim)));
      assert.equal(wins.filter(value => value.status === 'fulfilled').length, 1);
      assert.deepEqual(f.writes, [A, A]);
      assert.equal(JSON.parse(f.values.get(A)).tracks.length, 1);
      continue;
    }
    f.useInspector(async () => {
      if (change === 'cancel') accepted = false;
      if (change === 'access') f.deny();
      if (change === 'raw') f.values.set(R, 'external original');
      if (change === 'generation') f.values.set(A, JSON.stringify({ ...JSON.parse(restored.raw), generation: crypto.randomUUID() }));
    });
    await assert.rejects(writer.save(restored.raw, restored.state, () => accepted, claim), change);
    assert.deepEqual(f.writes, [A]);
    if (change !== 'generation') assert.equal(f.values.get(A), restored.raw);
    assert.equal(f.values.get(P), undefined);
  }
});

test('v5 copies whole progress, retains independent/v4 entries and rejects altered meaning even with a new checksum', async () => {
  const original = JSON.parse((await ordinaryImportBackup()).toString()).state;
  const personalPlan = JSON.parse((await ordinaryDevBackup()).toString()).state;
  const retainedOffering = personalPlan.items[0].offeringId;
  const f = fixture();
  const enriched = original.mediaSchoolingProgress[importedOffering];
  enriched.lessons.push({ lesson: 3, videoCompleted: false, testCompleted: true });
  enriched.assessments.push({ id: crypto.randomUUID(), type: 'midterm', label: '合成中間', scheduledDate: '2026-11-30', completed: false });
  // A different, explicitly identified offering for the same course is not an
  // additional owner of the audited Media detail.
  const otherOffering = 'ddf72fdc-c16a-4fc3-99ba-f52d4c5e1f7f';
  const otherSource = { ...original.importedCourseAchievements[0], id: crypto.randomUUID(),
    fingerprint: 'synthetic other offering', selectedOfferingId: otherOffering, candidateOfferingIds: [otherOffering] };
  const combined = { ...original, items: [...original.items, ...personalPlan.items],
    importedCourseAchievements: [...original.importedCourseAchievements, otherSource],
    mediaSchoolingProgress: { ...original.mediaSchoolingProgress, ...personalPlan.mediaSchoolingProgress } };
  const port = f.open();
  const { receipt } = await completeReceipt(port, await backup(JSON.stringify(combined)));
  const restored = await port.restore(receipt, () => true);
  const search = restored.legacyProgressReviews.find(review => review.offeringId === retainedOffering);
  const fromImport = restored.legacyProgressReviews.find(review => review.offeringId === importedOffering);
  const v4 = await port.save(restored.raw, restored.state, () => true, { legacyReview: search });
  const prior = JSON.parse(v4.raw).tracks[0];
  const v5 = await port.save(v4.raw, v4.state, () => true, { legacyReview: fromImport });
  const [searchTrack, importedTrack] = JSON.parse(v5.raw).tracks;
  assert.deepEqual(searchTrack, prior);
  const { offeringId: _id, ...independent } = enriched;
  assert.deepEqual(importedTrack.progress, independent);
  assert.deepEqual(v5.state, combined);
  assert.deepEqual(v5.progress[retainedOffering], personalPlan.mediaSchoolingProgress[retainedOffering]);
  const edits = [
    envelope => { envelope.tracks[1].legacyImport.original = '{}'; },
    envelope => { envelope.tracks[1].legacyImport.offeringId = retainedOffering; },
    envelope => { envelope.tracks[1].legacyImport.recordFingerprint = 'wrong'; },
    envelope => { envelope.tracks[1].legacyImport.sourceFingerprint = 'wrong'; },
    envelope => { envelope.tracks[1].owner = crypto.randomUUID(); },
    envelope => { envelope.tracks[1].sourceId = crypto.randomUUID(); },
    envelope => { envelope.tracks.push({ ...envelope.tracks[1], id: crypto.randomUUID() }); },
    envelope => { envelope.version = 4; },
    envelope => {
      const state = JSON.parse(envelope.primaryRaw);
      state.importedStudyRecords[0].rawTerm = '前期メディア';
      envelope.primaryRaw = JSON.stringify(state);
    },
    envelope => {
      const state = JSON.parse(envelope.primaryRaw);
      state.mediaSchoolingProgress[importedOffering].totalLessons = 13;
      envelope.primaryRaw = JSON.stringify(state);
    },
  ];
  const target = fixture();
  const reader = target.open();
  for (const mutate of edits) {
    const envelope = JSON.parse(v5.raw);
    mutate(envelope);
    const raw = JSON.stringify(envelope);
    const serialized = JSON.stringify({
      envelope: raw, format: 'hosei-planner:2026:portable:v' + envelope.version, sha256: await backupRawDigest(raw),
    });
    await assert.rejects(reader.prepareRestore(encode(serialized)), /原文|形式/);
  }
  assert.deepEqual(target.writes, []);
});

async function existingTwoTrackBackup() {
  const raw = gunzipSync(await readFile(new URL('./fixtures/planner-release/existing-two-tracks.json.gz', import.meta.url)));
  assert.equal(createHash('sha256').update(raw).digest('hex'), '161902a892c7dec665d1e151f6d2d554b2e49b854a7c574ba57f0d0f147f2923');
  return raw;
}

function independentTestFive(track) {
  return {
    offeringId: null, sourceId: track.sourceId, recordId: track.owner, approveV3: true,
    progress: { ...track.progress, lessons: [...track.progress.lessons, { lesson: 5, testCompleted: true, videoCompleted: false }] },
  };
}

test('claimed search original allows editing a different saved UUID without changing the v4 source or ownership', async () => {
  const input = await existingTwoTrackBackup();
  const original = JSON.parse(JSON.parse(input.toString()).envelope);
  const [imported, search] = original.tracks;
  const f = fixture(), active = f.open();
  const { receipt, proof } = await completeReceipt(active, input);
  const proofBytes = proof.slice();
  const restored = await active.restore(receipt, () => true);
  assert.deepEqual(restored.heldIndependentRecordIds, []);
  const draft = independentTestFive(imported);
  const updated = await active.save(restored.raw, restored.state, () => true, draft);
  const after = await f.open().refresh();
  const actual = JSON.parse(after.raw);
  assert.equal(after.raw, updated.raw);
  assert.deepEqual(after.heldIndependentRecordIds, []);
  assert.equal(actual.version, 4);
  assert.equal(actual.primaryRaw, original.primaryRaw);
  assert.deepEqual(actual.tracks, [{ ...imported, progress: draft.progress }, search]);
  assert.deepEqual(f.writes, [A, A]);
  assert.equal(f.values.has(P) || f.values.has(R), false);
  let portable;
  await active.exportAuthority(value => { portable = encode(value); });
  const target = fixture(), receiving = target.open();
  const copy = await completeReceipt(receiving, portable);
  const recovered = await receiving.restore(copy.receipt, () => true);
  assert.equal(JSON.parse(recovered.raw).primaryRaw, original.primaryRaw);
  assert.deepEqual(JSON.parse(recovered.raw).tracks, actual.tracks);
  assert.deepEqual(target.writes, [A]);
  assert.deepEqual(proof, proofBytes);
  assert.deepEqual(input, await existingTwoTrackBackup());
});

test('claimed search exclusion never opens unresolved originals, new UUIDs or competing ownership', async t => {
  const input = await existingTwoTrackBackup();
  const original = JSON.parse(JSON.parse(input.toString()).envelope);
  const [imported, search] = original.tracks;
  const anotherOffering = '04ff86ca-33da-4030-ae9e-6090938ddf7b';
  const holds = [
    ['unclaimed original', e => { e.tracks.pop(); e.version = 3; }],
    ['another unresolved original', (_e, s) => {
      s.mediaSchoolingProgress[anotherOffering] = { ...s.mediaSchoolingProgress[search.offeringId], offeringId: anotherOffering };
    }],
    ['no preexisting detail UUID', e => { e.tracks.shift(); }],
    ['claim search no longer active', (_e, s) => { s.items[0].status = 'waiting'; }],
    ['multiple explicit candidates', (_e, s) => {
      s.importedCourseAchievements[0].candidateOfferingIds = [search.offeringId, anotherOffering];
    }],
    ['explicit detail offering conflict', (_e, s) => { s.importedStudyRecords[0].offeringId = search.offeringId; }],
  ];
  for (const [label, mutate] of holds) {
    await t.test(label, async () => {
      const envelope = structuredClone(original);
      const state = JSON.parse(envelope.primaryRaw);
      mutate(envelope, state);
      envelope.primaryRaw = JSON.stringify(state);
      const raw = JSON.stringify(envelope);
      const f = fixture();
      f.values.set(A, raw);
      const port = f.open();
      const view = await port.refresh();
      assert.equal(view.error, null);
      assert.deepEqual(view.heldIndependentRecordIds, [imported.owner]);
      const draft = independentTestFive(imported);
      const before = structuredClone(draft);
      await assert.rejects(port.save(raw, view.state, () => true, draft));
      assert.deepEqual(draft, before);
      assert.equal(f.values.get(A), raw);
      assert.equal(f.values.has(P) || f.values.has(R), false);
      assert.deepEqual(f.writes, []);
    });
  }
});

test('claimed search proof and unique ownership are required even when a portable checksum is recomputed', async t => {
  const input = await existingTwoTrackBackup();
  const original = JSON.parse(JSON.parse(input.toString()).envelope);
  const tamper = [
    ['legacy proof altered', e => { e.tracks[1].legacyOriginal += ' '; }],
    ['legacy original altered', (_e, s) => { s.mediaSchoolingProgress[s.items[0].offeringId].lessons[0].videoCompleted = false; }],
    ['owner altered', e => { e.tracks[1].owner = '[]'; }],
    ['year and recorded owner altered', (e, s) => {
      s.items[0].plannedYear = 2027;
      const owner = JSON.parse(e.tracks[1].owner);
      owner[0] = 2027;
      e.tracks[1].owner = JSON.stringify(owner);
    }],
    ['term and recorded owner altered', (e, s) => {
      s.items[0].plannedTerm = '前期';
      const owner = JSON.parse(e.tracks[1].owner);
      owner[1] = '前期';
      e.tracks[1].owner = JSON.stringify(owner);
    }],
    ['detail rebound to another row', (_e, s) => { s.importedStudyRecords[0].sourceCourseId = crypto.randomUUID(); }],
    ['shared progress UUID', e => { e.tracks[0].id = e.tracks[1].id; }],
    ['two search tracks claim one offering', e => { e.tracks.push({ ...e.tracks[1], id: crypto.randomUUID() }); }],
  ];
  for (const [label, mutate] of tamper) {
    await t.test(label, async () => {
      const candidate = structuredClone(original);
      const state = JSON.parse(candidate.primaryRaw);
      mutate(candidate, state);
      candidate.primaryRaw = JSON.stringify(state);
      const raw = JSON.stringify(candidate);
      const bytes = encode(JSON.stringify({
        format: 'hosei-planner:2026:portable:v4', envelope: raw, sha256: await backupRawDigest(raw),
      }));
      const f = fixture();
      await assert.rejects(f.open().prepareRestore(bytes));
      assert.equal(f.values.size, 0);
      assert.deepEqual(f.writes, []);
    });
  }
});

test('claimed search exclusion still holds a draft if lock, consent, old raw or generation changes', async t => {
  const input = await existingTwoTrackBackup();
  for (const change of ['no lock', 'no permission', 'raw replaced', 'generation changed', 'stale draft']) {
    await t.test(change, async () => {
      const f = fixture(), port = f.open();
      const { receipt } = await completeReceipt(port, input);
      const restored = await port.restore(receipt, () => true);
      const [target] = JSON.parse(restored.raw).tracks;
      const draft = independentTestFive(target);
      const unchanged = structuredClone(draft);
      let current = true, expected = restored.raw;
      const writer = change === 'no lock' ? f.open({ locks: undefined }) : port;
      f.useInspector(async () => {
        if (change === 'no permission') f.deny();
        if (change === 'raw replaced') f.values.set(R, 'external recovery original');
        if (change === 'generation changed') {
          expected = JSON.stringify({ ...JSON.parse(restored.raw), generation: crypto.randomUUID() });
          f.values.set(A, expected);
        }
        if (change === 'stale draft') current = false;
      });
      await assert.rejects(writer.save(restored.raw, restored.state, () => current, draft));
      assert.deepEqual(draft, unchanged);
      assert.equal(f.values.get(A), expected);
      assert.deepEqual(f.writes, [A]);
    });
  }
});
