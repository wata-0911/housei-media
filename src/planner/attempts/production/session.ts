import { calculateRecordedCredits } from '../graduation/recordedCalculation';
import { backupRawDigest } from '../../backup/plannerBackupCompatibility';
import { STORAGE_KEY, BACKUP_KEY } from '../../backup/storagePrimitives';
import { createAttemptPersistence, type PersistenceHandle, type PersistencePreview } from '../persistence/controller';
import { createIndexedDbAttemptStore } from '../persistence/indexedDb';
import { SessionIdentityAllocator } from '../persistence/sessionIds';
import { referencedUuids, unionReservations } from '../persistence/identity';
import { sameAttemptData } from '../validation';
import { parseAttemptGraphJson } from '../jsonInput';
import { createInstitutionalSearchAdapter } from '../../institutional/search';
import { CURRENT_CURRICULUM_SEARCH_TARGET } from '../../institutional/currentSearch';
import { makeSearchAttempt } from '../workbench/searchBridge';
import { admissionProblem } from './admission';
import type { Attempt, AttemptId, AttemptOperationId, AttemptOwnedRecord, OwnedRecordId } from '../types';
import type { AtomicAttemptStore, AuthorityRecord } from '../persistence/contracts';
import type { PlannerWriteLocks } from '../../backup/storage';
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
export function createPlannerAttemptSession(store: AtomicAttemptStore, locks: PlannerWriteLocks | undefined) {
  const allocator = new SessionIdentityAllocator();
  let handle: PersistenceHandle | null = null, workspace: Workspace | null = null;
  let commands: Command[] = [], generation = 0, pending = false, reloadRequired = false;
  let saving: { written: AuthorityRecord | null; readback: AuthorityRecord | null; readingBack: boolean } | null = null;
  const proposals = new WeakMap<object, { generation: number; preview: PersistencePreview }>();
  const api = createAttemptPersistence({
    async read() {
      const current = structuredClone(await store.read());
      allocator.restrict(current.issuedIds);
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
      // Host reservations only add restrictions. Keep the historical #196
      // controller byte-pinned and never mutate its private expected snapshot.
      const restricted = { ...next, issuedIds: unionReservations(next.issuedIds, allocator.canonicalReservations()) };
      if (new TextEncoder().encode(JSON.stringify(restricted)).byteLength > 32 * 1024 * 1024)
        throw new Error('capacity_limit: host reservation envelope exceeds 33554432 bytes');
      const written = structuredClone(restricted);
      await store.commit(expected, restricted);
      attempt.written = written;
    },
  }, locks, async () => (await import('./migrationEnvironment')).loadProductionMigrationEnvironment());
  function current() { if (!handle || !workspace || pending || reloadRequired) throw new Error('session_not_editable'); return { handle, workspace }; }
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
      protectionRaw: JSON.stringify({ previousRaw: preview.previousRaw, sourceRaw: preview.sourceRaw }), generation,
      schemaVersion: preview.handle.state.schemaVersion, officialRows: preview.handle.state.retained.importedCourseAchievements.length });
    proposals.set(value, { generation, preview }); return value;
  }
  return {
    async prepareMigration(raw: string) { return exclusive(async () => {
      if (reloadRequired) throw new Error('session_requires_reload');
      parse(raw); // representation preflight only; preserve original bytes for #196.
      return proposal(await api.prepareMigration(await api.inspectLegacy(raw)));
    }); },
    async load() { return exclusive(async () => {
      // Accepted load linearizes here, before the first store read. Revocation
      // survives every failure; no old preview can restore operation authority.
      generation++; reloadRequired = true;
      handle = null; workspace = null; commands = [];
      const h = await api.load();
      if (h) requireSupportedHistory(h);
      return adopt(h);
    }); },
    view: () => Object.freeze({ graph: workspace?.graph ?? null, committedState: handle?.state ?? null,
      source: handle?.source ?? null, unsavedCommandCount: commands.length, graduationCheckComplete: false as const }),
    graph: () => workspace?.graph ?? null,
    source: () => handle?.source ?? null,
    async prepareSave() { return exclusive(async () => {
      if (reloadRequired) throw new Error('session_requires_reload');
      let preview: PersistencePreview;
      if (handle) preview = await api.prepareEdits(handle, commands);
      else {
        preview = await api.prepareNewPlan();
        if (preview.previousRaw !== null) throw new Error('existing_attempt_plan_requires_reload');
      }
      return proposal(preview);
    }); },
    async save(proposal: object, confirmed: boolean) { return exclusive(async () => {
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
        const committed = await api.commit(p.preview, true, p.preview.previousRaw, p.preview.sourceRaw);
        // The atomic store contains additional host burns. Reload through the
        // pinned verifier before adopting authority for the next CAS.
        attempt.readingBack = true;
        const reloaded = await api.load();
        attempt.readingBack = false;
        if (!reloaded || !attempt.written || !attempt.readback
          || !sameAttemptData(attempt.readback, attempt.written)
          || !sameAttemptData(reloaded.state, committed.state)) throw new Error('save_readback_conflict');
        requireSupportedHistory(reloaded);
        return adopt(reloaded);
      }
      catch (error) { reloadRequired = true; throw error; }
      finally { saving = null; }
    }); },
    // Do not let an unrelated protection read impersonate the verifier's read.
    protectCurrent: () => exclusive(() => api.protectCurrent()),
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
export const createBrowserPlannerAttemptSession = () => createPlannerAttemptSession(createIndexedDbAttemptStore(indexedDB), navigator.locks);

/** Exact raw protection; no decode, normalization, write or migration. */
export async function protectLegacyPlannerRaw(storage: Pick<Storage, 'getItem'>) {
  const primaryRaw = storage.getItem(STORAGE_KEY), recoveryRaw = storage.getItem(BACKUP_KEY);
  return JSON.stringify({ format: 'hosei-planner-raw-protection', protectionVersion: 1, primaryRaw, recoveryRaw,
    primarySha256: primaryRaw === null ? null : await backupRawDigest(primaryRaw),
    recoverySha256: recoveryRaw === null ? null : await backupRawDigest(recoveryRaw) });
}
