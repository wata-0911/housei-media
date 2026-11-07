import { calculateRecordedCredits } from '../graduation/recordedCalculation';
import { backupRawDigest } from '../../backup/plannerBackupCompatibility';
import { STORAGE_KEY, BACKUP_KEY } from '../../backup/storagePrimitives';
import { createAttemptPersistence, type PersistenceHandle, type PersistencePreview } from '../persistence/controller';
import { createAuthorityIndexedDbStore } from '../persistence/authorityIndexedDb';
import { SessionIdentityAllocator } from '../persistence/sessionIds';
import { referencedUuids, unionReservations } from '../persistence/identity';
import { sameAttemptData } from '../validation';
import { parseAttemptGraphJson } from '../jsonInput';
import { createInstitutionalSearchAdapter } from '../../institutional/search';
import { CURRENT_CURRICULUM_SEARCH_TARGET } from '../../institutional/currentSearch';
import { makeSearchAttempt } from '../workbench/searchBridge';
import { admissionProblem } from './admission';
import { emptyLegacySnapshot, inspectAuthorityAdmission, readLegacySnapshot, sameLegacySnapshot,
  sameLegacySource, unavailableAdmission, type AuthorityAdmission, type LegacySnapshot } from './authorityAdmission';
import { decodeMigrationSource, type prepareMigrationEnvironment } from '../migration/source';
import { inspectMigrationInput, inspectAttemptBackupInput } from './migrationInput';
import { requireAttemptAuthority } from '../persistence/authorityFormat';
import { freeze } from '../migration/contracts';
import type { Attempt, AttemptId, AttemptOperationId, AttemptOwnedRecord, OwnedRecordId } from '../types';
import type { AtomicAttemptStore, AuthorityRecord } from '../persistence/contracts';
import type { PlannerWriteLocks } from '../../backup/storage';
import { withPlannerWriteLock } from '../../backup/storagePrimitives';
import type { Command, Workspace } from '../workbench/operations';

const requireId = (id: unknown) => { if (typeof id !== 'string') throw new Error('primitive_id_required'); };
const parse = (raw: string) => {
  if (typeof raw !== 'string' || raw.length > 1024 * 1024) throw new Error('input_limit');
  return parseAttemptGraphJson(raw);
};
function record(raw: string, keys: string[]): Record<string, unknown> {
  const value = parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error('input_fields');
  return value as Record<string, unknown>;
}
/** Validate the complete primitive edit before any identity is issued. */
function editInput(input: Record<string, unknown>) {
  const { plannedYear, method, status } = input;
  if (Object.keys(input).length !== 3 || !(plannedYear === null ||
    (typeof plannedYear === 'number' && Number.isInteger(plannedYear) && plannedYear >= 1000 && plannedYear <= 9999))
    || !['unknown', 'correspondence', 'schooling', 'media'].includes(method as string)
    || !['planned', 'in_progress', 'waiting', 'earned', 'failed', 'dropped'].includes(status as string)) throw new Error('invalid_edit_input');
  return { plannedYear: plannedYear as number | null, method: method as Attempt['method']['value'],
    status: status as NonNullable<Attempt['plan']>['status'] };
}
/** Thin host over #196. Only primitive JSON crosses the public edit boundary.
 * No caller graph, handle, command, coverage or Offering is accepted. */
type MigrationEnvironment = Awaited<ReturnType<typeof prepareMigrationEnvironment>>;
type SessionOptions = {
  /** Browser default reads the actual origin. Memory hosts have no legacy store.
   * A worker without localStorage must supply an explicit host reader. */
  readLegacy?: () => LegacySnapshot;
  migrationEnvironment?: () => Promise<MigrationEnvironment>;
  protectAuthority?: () => Promise<string>;
};
export function createPlannerAttemptSession(store: AtomicAttemptStore & { commit(expected: AuthorityRecord, next: AuthorityRecord, beforePut?: () => void): Promise<void> }, locks: PlannerWriteLocks | undefined, options: SessionOptions = {}) {
  const readLegacy = options.readLegacy ?? (() => {
    if (typeof window !== 'undefined') return readLegacySnapshot(window.localStorage);
    if (typeof indexedDB !== 'undefined') throw new Error('legacy_reader_required');
    return emptyLegacySnapshot();
  });
  let environmentTask: Promise<MigrationEnvironment> | undefined;
  const environment = () => environmentTask ??= (options.migrationEnvironment
    ? options.migrationEnvironment() : import('./migrationEnvironment').then(m => m.loadProductionMigrationEnvironment()));
  const decodeLegacy = async (raw: string) => {
    const env = await environment();
    try { inspectMigrationInput(raw); }
    catch (error) {
      if (!(error instanceof SyntaxError)) return { status: 'held' as const, raw,
        diagnostics: [{code: 'source_precision_or_resource', path: '', message: String(error)}] };
    }
    return decodeMigrationSource(raw, env, env.origin);
  };
  const allocator = new SessionIdentityAllocator();
  let handle: PersistenceHandle | null = null, workspace: Workspace | null = null;
  let commands: Command[] = [], generation = 0, pending = false, reloadRequired = false;
  let admission: AuthorityAdmission | null = null, legacyExpected: LegacySnapshot | null = null;
  let knownRecord: AuthorityRecord | null = null;
  let observedRecord: AuthorityRecord | null = null, lastRead: AuthorityRecord | null = null, readFence: AuthorityRecord | null = null;
  let saving: { written: AuthorityRecord | null; readback: AuthorityRecord | null; readingBack: boolean } | null = null;
  const proposals = new WeakMap<object, { generation: number; preview: PersistencePreview }>();
  const api = createAttemptPersistence({
    async read() {
      let current: AuthorityRecord;
      try {
        const original = await store.read(); requireAttemptAuthority(original);
        current = structuredClone(original);
        // Explicit reload may adopt a newer plan/checkpoint, but cannot erase
        // host history this session already witnessed. Keep this across load()
        // failures too; a missing rollback tombstone is not repaired by reload.
        const missing = knownRecord?.issuedIds.filter(id => !current.issuedIds.includes(id)) ?? [];
        if (knownRecord && (current.revision < knownRecord.revision
          || knownRecord.committed.some(digest => !current.committed.includes(digest))
          || missing.length
          || (current.revision === knownRecord.revision && !sameAttemptData(current, knownRecord))))
          throw new Error(`stale_authority_history_requires_review: missing_known_reservations=${missing.length}`);
        if (readFence && !sameAttemptData(current, readFence)) throw new Error('stale_authority_requires_reload');
      } catch (error) { revoke(error); throw error; }
      lastRead = structuredClone(current);
      if (saving?.readingBack) {
        if (saving.readback) throw new Error('save_readback_conflict');
        // This exact snapshot is returned to the pinned verifier. No extra
        // authority read may stand in for the snapshot it actually verifies.
        saving.readback = structuredClone(current);
      }
      return current;
    },
    async commit(expected, next) {
      const attempt = saving;
      if (!attempt || attempt.written) throw new Error('save_attempt_required');
      // Called UNDER the persistence controller's shared Web Lock, immediately
      // before atomic IDB CAS. Neither legacy key is ever written here.
      requireLegacyUnchanged();
      // Host reservations only add restrictions. Keep the historical #196
      // controller byte-pinned and never mutate its private expected snapshot.
      const restricted = { ...next, issuedIds: unionReservations(next.issuedIds, allocator.canonicalReservations()) };
      if (new TextEncoder().encode(JSON.stringify(restricted)).byteLength > 32 * 1024 * 1024)
        throw new Error('capacity_limit: host reservation envelope exceeds 33554432 bytes');
      // The exact serialized candidate must survive the NEXT load's pinned
      // parser, witness and replay before it can become durable authority.
      // Inspecting source.raw or the pre-serialization state cannot prove this.
      const written = freeze(structuredClone(restricted));
      try {
        const verifier = createAttemptPersistence({ read: async () => written,
          commit: async () => { throw new Error('candidate_verifier_readonly'); } }, undefined, environment);
        const loaded = await verifier.load();
        if (!loaded || !sameAttemptData(loaded.state, JSON.parse(written.raw!)))
          throw new Error('candidate_roundtrip_mismatch');
      } catch (error) {
        throw new Error('authority_unreadable_before_put: ' + String(error));
      }
      // Validation contains asynchronous digest/replay work. Recheck legacy
      // here; native CAS and the synchronous beforePut still fence actual put.
      requireLegacyUnchanged();
      await store.commit(expected, written, requireLegacyUnchanged);
      attempt.written = written;
    },
  }, locks, environment);
  function rememberVerified(record: AuthorityRecord) {
    // Knowledge survives failures of permissions/admission. Call only AFTER a
    // complete witness/replay, never from raw reads or optimistic writes.
    allocator.restrict(record.issuedIds);
    knownRecord = structuredClone(record);
  }
  function revoke(error: unknown) {
    reloadRequired = true; generation++; admission = unavailableAdmission(error);
  }
  async function boundToObserved<T>(run: () => Promise<T>): Promise<T> {
    if (!observedRecord) throw new Error('session_requires_reload');
    readFence = structuredClone(observedRecord);
    try { return await run(); } finally { readFence = null; }
  }
  async function verifyDestination() {
    // Fully witness/replay the destination, even for a known rollback checkpoint.
    // Every later controller read remains fenced to this same four-field record.
    try {
      const h = await api.load(); rememberVerified(lastRead!); if (h) requireSupportedHistory(h); return h;
    } catch (error) { revoke(error); throw error; }
  }
  function requireLegacyUnchanged() {
    try {
      if (!legacyExpected || !sameLegacySnapshot(legacyExpected, readLegacy())) throw new Error('legacy_changed_requires_reload');
    } catch (error) { reloadRequired = true; generation++; admission = unavailableAdmission(error); throw error; }
  }
  async function observe() {
    try {
      const legacy = Object.freeze({ ...readLegacy() });
      const h = await api.load();
      rememberVerified(lastRead!);
      if (h) requireSupportedHistory(h);
      const status = await inspectAuthorityAdmission(legacy, h, decodeLegacy);
      if (!sameLegacySnapshot(legacy, readLegacy())) throw new Error('legacy_changed_requires_reload');
      legacyExpected = legacy; admission = status; observedRecord = structuredClone(lastRead!);
      return h;
    } catch (error) { reloadRequired = true; admission = unavailableAdmission(error); throw error; }
  }
  function current() {
    if (!handle || !workspace || pending || reloadRequired || !admission?.canEdit) throw new Error('session_not_editable');
    requireLegacyUnchanged(); return { handle, workspace };
  }
  function mint(prefix: '' | 'hosei:attempt:' | 'hosei:attempt-op:' | 'hosei:owned:') {
    const { handle, workspace } = current();
    return allocator.mint(allocator.snapshot([handle.source, handle.state, workspace]), prefix);
  }
  const operation = () => mint('hosei:attempt-op:') as AttemptOperationId;
  function dispatch(command: Command) {
    const h = current(); workspace = api.dispatch(h.handle, h.workspace, command); commands.push(command); generation++;
    return workspace.graph;
  }
  async function exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (pending) throw new Error('operation_pending'); pending = true;
    try { return await run(); } finally { pending = false; }
  }
  function adopt(h: PersistenceHandle | null) { reloadRequired = false; handle = h; workspace = h?.workspace ?? null; commands = []; generation++; return workspace?.graph ?? null; }
  function requireSupportedHistory(h: PersistenceHandle) {
    if (h.source.kind !== 'new-plan') inspectMigrationInput(h.source.raw);
    if (h.state.schemaVersion === 23) for (const correction of h.state.corrections) {
      inspectMigrationInput(correction.originalRaw); inspectMigrationInput(correction.proposedRaw);
    }
    // Rule1 reservations alone do not prove ordered nested-ID issuance, even
    // when a UUID happens to occur elsewhere in the host's reservation set.
    const payloads = [...h.workspace.graph.ownedRecords.filter(r=>r.kind==='media').map(r=>r.payload),
      ...h.state.history.commands.flatMap(c => c.kind==='add_record'&&c.record.kind==='media' ? [c.record.payload]
        : c.kind==='edit_payload'&&'assessments' in c.payload ? [c.payload] : [])];
    const nested = payloads.flatMap(p => 'assessments' in p ? p.assessments.map(a=>a.id) : []);
    if (nested.some(id => referencedUuids(id).size)) throw new Error('nested_identity_history_requires_review');
  }
  function proposal(preview: PersistencePreview) {
    requireSupportedHistory(preview.handle);
    if (preview.action === 'migration' && preview.previousRaw !== null) throw new Error('existing_attempt_plan_requires_reload');
    const value = Object.freeze({ action: preview.action, bytes: preview.bytes, graph: preview.handle.workspace.graph,
      protectionRaw: JSON.stringify({ previousAuthority: observedRecord, previousRaw: preview.previousRaw, sourceRaw: preview.sourceRaw, legacy: legacyExpected,
        ...(preview.recovery ? { backupRaw: preview.recovery.raw } : {}) }), generation,
      adoptionSha256: preview.recovery?.portable ? preview.recovery.rawSha256 : null,
      schemaVersion: preview.handle.state.schemaVersion, officialRows: preview.handle.state.retained.importedCourseAchievements.length });
    proposals.set(value, { generation, preview }); return value;
  }
  return {
    async prepareMigration(raw: string) { return exclusive(async () => {
      if (reloadRequired) throw new Error('session_requires_reload');
      const stamp = ++generation; // Selection invalidates every older confirmation.
      if (!admission) await observe();
      requireLegacyUnchanged();
      if (!admission?.canMigrate && !admission?.canCreate) throw new Error('authority_migration_blocked');
      inspectMigrationInput(raw); // Independent file policy; original bytes survive.
      return boundToObserved(async () => {
        await verifyDestination();
        const preview = await api.prepareMigration(await api.inspectLegacy(raw));
        if (legacyExpected?.primaryRaw !== null && legacyExpected?.primaryRaw !== undefined) {
          const decoded = await decodeLegacy(legacyExpected.primaryRaw);
          if (decoded.status !== 'decoded' || preview.handle.source.kind === 'new-plan'
            || !sameLegacySource(decoded.source, preview.handle.source)) throw new Error('migration_source_conflict');
        }
        requireLegacyUnchanged();
        if (stamp !== generation) throw new Error('stale_preview');
        return proposal(preview);
      });
    }); },
    invalidatePreviews() { generation++; },
    async load() { return exclusive(async () => {
      // Accepted load linearizes here, before the first store read. Revocation
      // survives every failure; no old preview can restore operation authority.
      generation++; reloadRequired = true;
      handle = null; workspace = null; commands = [];
      try {
        const h = await observe();
        return adopt(h);
      } catch (error) { admission = unavailableAdmission(error); throw error; }
    }); },
    view: () => Object.freeze({ graph: workspace?.graph ?? null, committedState: handle?.state ?? null,
      source: handle?.source ?? null, unsavedCommandCount: commands.length, graduationCheckComplete: false as const }),
    graph: () => workspace?.graph ?? null,
    source: () => handle?.source ?? null,
    admission: () => admission,
    /** Export a verified committed snapshot only, under the same writer lock.
     * Raw protection remains available when normal backup validation fails. */
    async createBackup() { return exclusive(async () => {
      if (!handle || reloadRequired || commands.length) throw new Error('saved_snapshot_required');
      requireLegacyUnchanged();
      return withPlannerWriteLock(async () => {
        return boundToObserved(async () => {
          const saved = await verifyDestination();
          if (!saved) throw new Error('stale_backup_requires_reload');
          const raw = await api.createBackup(saved);
          // Detect a non-cooperating writer between the export's internal read
          // and its asynchronous digest/replay work. Never issue a stale file.
          await verifyDestination(); requireLegacyUnchanged(); return raw;
        });
      }, locks, true).catch(error => {
        if (error instanceof Error && /^stale_authority_/.test(error.message))
          error = new Error('stale_backup_requires_reload');
        reloadRequired = true; admission = unavailableAdmission(error); throw error;
      });
    }); },
    /** Contract for a later restore UI. Selection is read only; portable source
     * adoption is separate from ordinary save confirmation. Never restores LS. */
    async prepareRestore(raw: string) { return exclusive(async () => {
      if (reloadRequired) throw new Error('session_requires_reload');
      const stamp = ++generation;
      inspectAttemptBackupInput(raw);
      if (!admission) await observe();
      requireLegacyUnchanged();
      if (!admission?.canCreate && !admission?.canEdit && !admission?.canMigrate) throw new Error('authority_restore_blocked');
      return boundToObserved(async () => {
        await verifyDestination();
        const preview = await api.inspectBackup(raw);
        const incoming = await inspectAuthorityAdmission(legacyExpected!, preview.handle, decodeLegacy);
        requireLegacyUnchanged();
        if (!incoming.canEdit) throw new Error('restore_source_conflict');
        if (stamp !== generation) throw new Error('stale_preview');
        return proposal(preview);
      });
    }); },
    async prepareSave() { return exclusive(async () => {
      // Sibling previews of the same unchanged draft remain valid until a save
      // attempt consumes them all. Destination failures still revoke generation
      // in read(); selecting a migration/restore file has its own generation.
      const stamp = generation;
      if (reloadRequired) throw new Error('session_requires_reload');
      if (!admission) {
        if (await observe()) throw new Error('existing_attempt_plan_requires_reload');
      }
      requireLegacyUnchanged();
      if (handle ? !admission?.canEdit : !admission?.canCreate) throw new Error('authority_save_blocked');
      return boundToObserved(async () => {
        let preview: PersistencePreview;
        if (handle) preview = await api.prepareEdits(handle, commands);
        else {
          preview = await api.prepareNewPlan();
          if (preview.previousRaw !== null) throw new Error('existing_attempt_plan_requires_reload');
        }
        if (stamp !== generation) throw new Error('stale_preview');
        return proposal(preview);
      });
    }); },
    async save(proposal: object, confirmed: boolean, adoptedBackupSha256?: string) { return exclusive(async () => {
      const p = proposals.get(proposal);
      if (!p || p.generation !== generation) throw new Error('stale_preview');
      if (reloadRequired) throw new Error('session_requires_reload');
      if (!confirmed) throw new Error('explicit_confirmation_required');
      // A save attempt consumes all previews, including failures with an unknown
      // transaction outcome. Reconcile through load before issuing another edit.
      proposals.delete(proposal); generation++;
      const attempt = { written: null, readback: null, readingBack: false } as NonNullable<typeof saving>;
      saving = attempt;
      try {
        const recovery = p.preview.recovery;
        const consent = recovery?.portable && adoptedBackupSha256 === recovery.rawSha256
          ? { acceptedBackupRawSha256: adoptedBackupSha256, protectedBackupRaw: recovery.raw } : undefined;
        const committed = await api.commit(p.preview, true, p.preview.previousRaw, p.preview.sourceRaw, consent);
        // The atomic store contains additional host burns. Reload through the
        // pinned verifier before adopting authority for the next CAS.
        attempt.readingBack = true;
        const reloaded = await api.load();
        attempt.readingBack = false;
        if (!reloaded || !attempt.written || !attempt.readback
          || !sameAttemptData(attempt.readback, attempt.written)
          || !sameAttemptData(reloaded.state, committed.state)) throw new Error('save_readback_conflict');
        rememberVerified(attempt.readback);
        requireSupportedHistory(reloaded);
        requireLegacyUnchanged();
        admission = await inspectAuthorityAdmission(legacyExpected!, reloaded, decodeLegacy);
        requireLegacyUnchanged();
        if (!admission.canEdit) throw new Error('save_authority_conflict');
        observedRecord = structuredClone(attempt.readback);
        return adopt(reloaded);
      }
      catch (error) { reloadRequired = true; admission = unavailableAdmission(error); throw error; }
      finally { saving = null; }
    }); },
    // Do not let an unrelated protection read impersonate the verifier's read.
    protectCurrent: () => exclusive(() => options.protectAuthority ? options.protectAuthority() : api.protectCurrent()),
    add(placementId: string, inputJson: string) {
      requireId(placementId);
      const h = current(), input = editInput(record(inputJson, ['plannedYear', 'method', 'status']));
      const result = createInstitutionalSearchAdapter(h.handle.source.context.catalog, CURRENT_CURRICULUM_SEARCH_TARGET).search({scope:{kind:'all'}});
      const selection = result.rows.find(row => row.placement.id === placementId);
      if (!selection) throw new Error('unknown_placement');
      const problem = admissionProblem(selection, input.method);
      if (problem) throw new Error(problem);
      const attempt = makeSearchAttempt(h.handle.source.context.catalog, selection, {
        plan: { plannedYear: input.plannedYear as number | null, status: input.status as NonNullable<Attempt['plan']>['status'], plannedTerm: null, studyYear: null, earnedOrder: null },
        method: input.method as Attempt['method']['value'], note: '本人希望',
      }, { id: mint('hosei:attempt:') as AttemptId, creationOperationId: operation() });
      return dispatch({kind:'add',operationId:attempt.creationOperationId,attempt});
    },
    update(attemptId: AttemptId, inputJson: string) {
      requireId(attemptId);
      const h = current(), input = editInput(record(inputJson, ['plannedYear','method','status'])), a = h.workspace.graph.attempts.find(a=>a.id===attemptId);
      if (!a?.plan) throw new Error('unknown_active_attempt');
      if (a.membership.kind !== 'active') throw new Error('restore_before_edit');
      const changingMethod = input.method !== a.method.value;
      if (changingMethod) {
        const catalog = h.handle.source.context.catalog;
        const placementIds = new Set([...a.placement.candidatePlacementIds, ...(a.placement.ref ? [a.placement.ref.placementId] : [])]);
        if (!placementIds.size) throw new Error('method_change_requires_catalog_admission');
        for (const id of placementIds) {
          const placement = catalog.placements.find(p => p.id === id);
          if (!placement) throw new Error('unknown_placement');
          const institutionalCourse = catalog.institutionalCourses.find(c => c.id === placement.institutionalCourseId) ?? null;
          const problem = admissionProblem({ placement, institutionalCourse }, input.method);
          if (problem) throw new Error(problem);
        }
      }
      const changes: Partial<Pick<Attempt, 'plan' | 'method'>> = {
        plan: { ...a.plan, plannedYear: input.plannedYear, status: input.status },
      };
      // Retaining a legacy value must retain its full provenance, not recast it
      // as newly admitted learner intent. Only an actual method change replaces it.
      if (changingMethod) changes.method = { value: input.method, source: 'learner', evidence: { kind: 'learner', note: '本人希望' } };
      return dispatch({ kind: 'edit', operationId: operation(), attemptId, changes });
    },
    /** Learner quantity only. Preserve official rows, provenance and all other plan fields. */
    recordContribution(attemptId: AttemptId, inputJson: string) {
      requireId(attemptId);
      const h = current(), input = record(inputJson, ['value']);
      if (Object.keys(input).length !== 1 || !(input.value === null || (typeof input.value === 'number'
        && Number.isFinite(input.value) && input.value >= 0 && input.value <= Number.MAX_SAFE_INTEGER
        && !Object.is(input.value, -0)))) throw new Error('invalid_recorded_quantity');
      const a = h.workspace.graph.attempts.find(a => a.id === attemptId);
      if (!a?.plan || a.membership.kind !== 'active') throw new Error('unknown_active_attempt');
      return dispatch({ kind: 'edit', operationId: operation(), attemptId, changes: {
        plan: { ...a.plan, contribution: a.plan.contribution
          ? { ...a.plan.contribution, value: input.value as number | null }
          : { value: input.value as number | null, source: 'learner', note: '本人入力（公式成績ではありません）' } },
      } });
    },
    /** Only this session's validated, saved source/graph can cross the calculation seam. */
    async calculate(scopeId: string) {
      requireId(scopeId);
      const h = current(), stamp = generation;
      if (commands.length) throw new Error('saved_snapshot_required');
      const result = await calculateRecordedCredits(JSON.stringify(h.workspace.graph), h.handle.source, scopeId);
      if (stamp !== generation || reloadRequired || pending) throw new Error('stale_calculation');
      return result;
    },
    progress(attemptId: AttemptId, kind: 'media'|'correspondence'|'evaluation', payloadJson: string) {
      requireId(attemptId);
      if (!['media','correspondence','evaluation'].includes(kind)) throw new Error('unsupported_progress_kind');
      const payload = parse(payloadJson) as AttemptOwnedRecord['payload'];
      const previous = current().workspace.graph.ownedRecords.find(r=>r.kind===kind&&r.owner?.kind==='attempt'&&r.owner.attemptId===attemptId);
      if (kind === 'media') {
        const next = payload as Extract<AttemptOwnedRecord,{kind:'media'}>['payload'];
        const known = previous?.kind==='media' ? previous.payload.assessments.map(a=>a.id) : [];
        if (!Array.isArray(next.assessments) || next.assessments.some(a=>!known.includes(a.id))) throw new Error('new_assessment_requires_identity_contract');
      }
      return previous ? dispatch({kind:'edit_payload',operationId:operation(),recordId:previous.id,payload})
        : dispatch({kind:'add_record',operationId:operation(),record:{id:mint('hosei:owned:') as OwnedRecordId,kind,owner:{kind:'attempt',attemptId},payload} as AttemptOwnedRecord});
    },
    remove(attemptId: AttemptId) { requireId(attemptId); return dispatch({kind:'remove',operationId:operation(),attemptId}); },
    undo(attemptId: AttemptId) {
      requireId(attemptId);
      const a = current().workspace.graph.attempts.find(a=>a.id===attemptId);
      if (a?.membership.kind!=='detached'||!a.membership.deletionOperationId) throw new Error('unknown_removal');
      return dispatch({kind:'undo',operationId:operation(),attemptId,removalOperationId:a.membership.deletionOperationId});
    },
  };
}
export const createBrowserPlannerAttemptSession = () => {
  const store = createAuthorityIndexedDbStore(indexedDB);
  return createPlannerAttemptSession(store, navigator.locks, {
    readLegacy: () => readLegacySnapshot(localStorage), protectAuthority: () => store.protectOriginal(),
  });
};

/** Exact raw protection; no decode, normalization, write or migration. */
export async function protectLegacyPlannerRaw(storage: Pick<Storage, 'getItem'>) {
  const primaryRaw = storage.getItem(STORAGE_KEY), recoveryRaw = storage.getItem(BACKUP_KEY);
  return JSON.stringify({ format: 'hosei-planner-raw-protection', protectionVersion: 1, primaryRaw, recoveryRaw,
    primarySha256: primaryRaw === null ? null : await backupRawDigest(primaryRaw),
    recoverySha256: recoveryRaw === null ? null : await backupRawDigest(recoveryRaw) });
}
