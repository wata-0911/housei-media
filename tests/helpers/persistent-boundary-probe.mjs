import { createPersistentAttemptSession } from '../../src/planner/attempts/persistence/persistentSession.ts';
import { createIndexedDbAttemptStore } from '../../src/planner/attempts/persistence/indexedDb.ts';
import { prepareMigrationEnvironment } from '../../src/planner/attempts/migration/source.ts';
import { createNewPlanSource, emptyNewPlanWorkspace, encodeNewPlanRule2 } from '../../src/planner/attempts/persistence/newPlan.ts';
import { replayStateRule2 } from '../../src/planner/attempts/persistence/codec.ts';
import { backupDigest } from '../../src/planner/backup/plannerBackupCompatibility.ts';
import { makeAttempt } from '../../src/planner/attempts/workbench/catalogView.ts';

const store = createIndexedDbAttemptStore(indexedDB);
const log = [];
let writeKind = 'product', mintCount = 0, fixture24, environmentA, environmentB;
const put = IDBObjectStore.prototype.put, random = crypto.randomUUID.bind(crypto);
IDBObjectStore.prototype.put = function (...args) {
  log.push({ kind: writeKind, mode: this.transaction.mode });
  return put.apply(this, args);
};
crypto.randomUUID = () => { mintCount++; return random(); };
const outcome = async fn => {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e.message, cause: e.cause?.message }; }
};
const confirmation = p => ({ confirmed: true, protectedRaw: p.previousRaw, protectedSourceRaw: p.sourceRaw });
const counts = () => ({ productPuts: log.filter(x => x.kind === 'product').length, injectedPuts: log.filter(x => x.kind === 'fault').length });
async function seed(record, kind = 'fixture') {
  writeKind = kind;
  try {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('hosei-yi06-isolated-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('authority');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('authority', 'readwrite');
        tx.objectStore('authority').put(record, 'current');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  } finally { writeKind = 'product'; }
}
async function valid24() {
  if (!fixture24) {
    const source = await createNewPlanSource(), state = await encodeNewPlanRule2(source, emptyNewPlanWorkspace(source));
    fixture24 = { format: 'hosei-attempt-authority', authorityVersion: 2,
      reservationCoverage: { policyVersion: 2, kind: 'native-v2', baselineStateSha256: null },
      raw: JSON.stringify(state), revision: 1, committed: [await backupDigest(state)], issuedIds: (await replayStateRule2(state)).requiredReservations };
  }
  return structuredClone(fixture24);
}
const corruptions = {
  'root-undefined': r => { r.unexpected = undefined; },
  'coverage-undefined': r => { r.reservationCoverage.unexpected = undefined; },
  NaN: r => { r.reservationCoverage.baselineStateSha256 = NaN; },
  Infinity: r => { r.reservationCoverage.baselineStateSha256 = Infinity; },
  'invalid-Date': r => { r.reservationCoverage.baselineStateSha256 = new Date(NaN); },
  'boxed-String': r => { r.raw = new String(r.raw); },
};
function witness(r) {
  const b = r.reservationCoverage.baselineStateSha256;
  return { rootExtra: Object.hasOwn(r, 'unexpected'), coverageExtra: Object.hasOwn(r.reservationCoverage, 'unexpected'),
    baselineType: typeof b, baselineTag: Object.prototype.toString.call(b), baselineNaN: Number.isNaN(b), baselineInfinity: b === Infinity,
    invalidDate: b instanceof Date && Number.isNaN(b.getTime()), rawType: typeof r.raw, rawTag: Object.prototype.toString.call(r.raw), revision: r.revision };
}
export async function malformed(name) {
  const valid = await valid24(), bad = structuredClone(valid); corruptions[name](bad); await seed(bad); log.length = 0;
  const before = witness(await store.read()), api = createPersistentAttemptSession(store, navigator.locks), startMints = mintCount;
  const loaded = await outcome(() => api.load()), h = loaded.ok ? loaded.value : {};
  const identity = await outcome(() => api.identities(h).newOperationId()), backup = await outcome(() => api.createBackup(h));
  const newPlan = await outcome(() => api.prepareNewPlan());
  const directCAS = await outcome(() => store.commit(valid, { ...valid, revision: 2 }));
  const protection = await outcome(() => api.protectCurrent());
  return { before, after: witness(await store.read()), loaded: { ok: loaded.ok, error: loaded.error, saveStatus: loaded.value?.saveStatus },
    identity: { ok: identity.ok, error: identity.error }, backup: { ok: backup.ok, error: backup.error }, newPlan: { ok: newPlan.ok, error: newPlan.error },
    directCAS, protection, mints: mintCount - startMints, ...counts() };
}
export async function postcommitCorruption(name) {
  await seed(await valid24()); log.length = 0; let storeCommits = 0;
  const wrapped = { read: () => store.read(), commit: async (e, n) => {
    storeCommits++; await store.commit(e, n); const bad = structuredClone(n); corruptions[name](bad); await seed(bad, 'fault');
  } };
  const api = createPersistentAttemptSession(wrapped, navigator.locks), h = await api.load(), p = await api.prepareEdits(h, []);
  const result = await outcome(() => api.commit(p, confirmation(p))), retry = await outcome(() => api.commit(p, confirmation(p)));
  const backup = await outcome(() => api.createBackup(h)), reloaded = await outcome(() => api.load());
  return { result: { ok: result.ok, error: result.error, cause: result.cause }, retry, backup: { ok: backup.ok, error: backup.error }, reloaded: { ok: reloaded.ok, error: reloaded.error },
    storeCommits, after: witness(await store.read()), ...counts() };
}
export async function positive24() {
  await seed(await valid24()); log.length = 0;
  const api = createPersistentAttemptSession(store, navigator.locks), h = await api.load(), ids = api.identities(h);
  const attempt = makeAttempt(h.source.context.catalog, { title: 'F02 positive', courseId: null, placementId: null,
    plan: { status: 'planned', plannedYear: null, plannedTerm: null, studyYear: null, earnedOrder: null }, method: 'media', note: '' }, ids.newAttemptIds());
  const command = { kind: 'add', operationId: attempt.creationOperationId, attempt }, p = await api.prepareEdits(h, [command]);
  const result = await api.commit(p, confirmation(p)), backup = JSON.parse(await api.createBackup(result)), record = await store.read();
  return { revision: record.revision, status: result.saveStatus, attempts: result.state.graph.attempts.length, backupVersion: backup.backupVersion,
    backupStateEqual: JSON.stringify(backup.state) === JSON.stringify(result.state), reserved: [attempt.id, command.operationId].every(id => record.issuedIds.includes(id)), ...counts() };
}
export async function environmentCase(fixture, mode) {
  const state = JSON.parse(fixture.raw);
  if (!environmentA) {
    environmentA = await prepareMigrationEnvironment(state.source.rawFiles, state.catalog);
    const target = structuredClone(state.catalog); target.programs[0].displayName += ' [independent audit environment B]';
    environmentB = await prepareMigrationEnvironment(state.source.rawFiles, target);
  }
  await seed(fixture); log.length = 0;
  let calls = 0, commitCalls = 0, phase = 'preview', current = environmentA, providerMode = 'stable', commits = 0;
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  const provider = async () => {
    calls++; if (phase === 'commit') commitCalls++;
    if (providerMode === 'reject') throw Error('environment_provider_rejected');
    if (providerMode === 'delay') { enter(); return delayed; }
    if (mode === 'during-validation' && phase === 'commit' && commitCalls === 2) queueMicrotask(() => { current = environmentB; });
    return current;
  };
  const wrapped = { read: () => store.read(), commit: async (e, n) => {
    commits++; await store.commit(e, n);
    if (mode === 'post-reject') providerMode = 'reject';
    if (mode === 'post-change') current = environmentB;
  } };
  const api = createPersistentAttemptSession(wrapped, navigator.locks, mode === 'static' ? environmentA : provider);
  const p = await api.previewLegacyMigration();
  if ('status' in p) throw Error('unexpected held fixture');
  const restored = structuredClone(p.handle.state); restored.rule.version = state.rule.version; restored.history.issuedIds = state.history.issuedIds;
  const baseline = await backupDigest(state), invariant = { baseline: p.handle.coverage.baselineStateSha256, expectedBaseline: baseline,
    allOtherValuesEqual: JSON.stringify(restored) === JSON.stringify(state) };
  const previewCalls = calls; phase = 'commit';
  if (mode === 'before-change') current = environmentB;
  if (mode === 'provider-reject') providerMode = 'reject';
  let releaseLock, lock, waiting;
  if (mode === 'lock-change') {
    let acquired; const ready = new Promise(r => { acquired = r; });
    lock = navigator.locks.request('hosei-planner:v1:write', () => new Promise(resolve => { releaseLock = resolve; acquired(); })); await ready;
  }
  if (mode === 'provider-delay') providerMode = 'delay';
  let settled = false;
  const task = outcome(() => api.commit(p, confirmation(p))).then(r => { settled = true; return r; });
  if (mode === 'lock-change') {
    await new Promise(r => setTimeout(r, 20)); waiting = { settled, callsSincePreview: calls - previewCalls, ...counts() };
    current = environmentB; releaseLock(); await lock;
  }
  if (mode === 'provider-delay') {
    await entered; waiting = { settled, revision: (await store.read()).revision, ...counts() }; release(environmentB);
  }
  const result = await task, saved = await store.read();
  const retry = !result.ok ? await outcome(() => api.commit(p, confirmation(p))) : undefined;
  const restrictions = {};
  if (result.ok) for (const [name, fn] of Object.entries({ identities: () => api.identities(result.value), edits: () => api.prepareEdits(result.value, []), newPlan: () => api.prepareNewPlan() })) restrictions[name] = await outcome(fn);
  const savedState = JSON.parse(saved.raw), savedRestored = structuredClone(savedState); savedRestored.rule.version = state.rule.version; savedRestored.history.issuedIds = state.history.issuedIds;
  return { mode, previewCalls, providerCalls: calls, commitCalls, commits, invariant, waiting,
    result: { ok: result.ok, error: result.error, cause: result.cause, saveStatus: result.value?.saveStatus }, retry,
    revisionBefore: fixture.revision, revisionAfter: saved.revision, rawUnchanged: fixture.raw === saved.raw, savedRule: savedState.rule.version,
    savedCoverage: saved.reservationCoverage, allSavedOtherValuesEqual: JSON.stringify(savedRestored) === JSON.stringify(state), restrictions, ...counts() };
}

export async function environmentFields(fixture) {
  const state=JSON.parse(fixture.raw), a=await prepareMigrationEnvironment(state.source.rawFiles,state.catalog);
  let current=a;await seed(fixture);log.length=0;
  const api=createPersistentAttemptSession(store,navigator.locks,async()=>current), p=await api.previewLegacyMigration(), results=[];
  for(const field of ['origin','rawFiles','catalog','legacyArchive']){
    const next=structuredClone(a);
    if(field==='origin')next.origin.programs[0].displayName+=' changed';
    else if(field==='rawFiles')next.rawFiles[Object.keys(next.rawFiles)[0]]+=' ';
    else next[field].unexpected='changed';
    current=next;const result=await outcome(()=>api.commit(p,confirmation(p)));
    results.push({field,result,revision:(await store.read()).revision,...counts()});
  }
  current=a;const result=await api.commit(p,confirmation(p));
  return {results,finalStatus:result.saveStatus,finalRevision:(await store.read()).revision,...counts()};
}
