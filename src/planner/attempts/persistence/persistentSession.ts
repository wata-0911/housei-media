import { backupDigest, backupRawDigest } from '../../backup/plannerBackupCompatibility';
import { withPlannerWriteLock, type PlannerWriteLocks } from '../../backup/storage';
import { freeze } from '../migration/contracts';
import { parseMigrationJson, type prepareMigrationEnvironment } from '../migration/source';
import { sameAttemptData } from '../validation';
import { applyCommand, type Command, type Workspace } from '../workbench/operations';
import { createWorkbenchIdentityOwner } from '../workbench/sessionIdentities';
import { replayState, replayStateRule2, encodeStateRule2 } from './codec';
import { assertCoverageContinuation, decodeAuthorityJson, decodeBackupJson } from './contractDecoders';
import { exactKeys, type AtomicAttemptStore, type AuthorityRecord, type AttemptState, type AttemptStateRule2, type PersistenceSource } from './contracts';
import { catalogUuids, idTail, referencedUuids, unionReservations } from './identity';
import { type ReservationCoverage, type AuthorityV2, AUTHORITY_FORMAT, AUTHORITY_VERSION } from './versionedContracts';
import { previewLegacyRule2Migration } from './legacyPreview';
import { createNewPlanSource, emptyNewPlanWorkspace, encodeNewPlanRule2 } from './newPlan';
import { sameAuthoritySnapshot } from './authoritySnapshot';

type Host = AuthorityRecord | AuthorityV2;
type Coverage = ReservationCoverage | 'legacy-authority';
type Environment = Awaited<ReturnType<typeof prepareMigrationEnvironment>>;
type Rule2Replay = Awaited<ReturnType<typeof replayStateRule2>>;
export type PersistentHandle = Readonly<{ state: AttemptState | AttemptStateRule2; workspace: Workspace; source: PersistenceSource;
  coverage: Coverage; saveStatus: 'native-v2-save-authorized' | 'legacy-unproven' | 'explicit-migration-required' | 'unconfirmed-recovery' }>;
export type PersistentPreview = Readonly<{ handle: PersistentHandle; action: 'new-plan' | 'edit' | 'migration' | 'restore';
  previousAuthority: Host; previousRaw: string | null; sourceRaw: string; bytes: number; backupRaw: string | null; backupRawSha256: string | null;
  migration?: Awaited<ReturnType<typeof previewLegacyRule2Migration>> }>;
declare const controllerInspection: unique symbol;
export type BackupInspection = Readonly<{ readonly [controllerInspection]: true; verification: 'content-validated'; saveAuthority: 'not-issued';
  backupKind: 'legacy' | 'v4'; raw: string; migration?: Awaited<ReturnType<typeof previewLegacyRule2Migration>> }>;
export type PersistentConfirmation = { confirmed: boolean; protectedRaw?: string | null; protectedSourceRaw?: string;
  acceptedBackupRawSha256?: string; protectedBackupRaw?: string };
type Detail = { expected: Host; coverage: Coverage; editable: boolean };
type Proposal = { expected: Host; state: AttemptStateRule2; coverage: ReservationCoverage; reserved: string[]; base: PersistentHandle;
  backupRaw: string | null; migrationRaw?: string };
const native: ReservationCoverage = { policyVersion: 2, kind: 'native-v2', baselineStateSha256: null };
const protectionSource = (source: PersistenceSource) => source.kind === 'new-plan' ? JSON.stringify(source.evidence) : source.raw;
const bytes = (raw: string) => new TextEncoder().encode(raw).byteLength;
const coverageOf = (host: Host): Coverage => 'authorityVersion' in host ? host.reservationCoverage : 'legacy-authority';

/** Trusted synchronous host controller. Neither a decoded value, caller coverage,
 * reservation array nor copied handle/preview can enter its private registries.
 * The old rule1 controller and preview Worker remain separate. */
export function createPersistentAttemptSession(store: AtomicAttemptStore, locks: PlannerWriteLocks | undefined,
  environmentInput?: Environment | (() => Promise<Environment>), maxRecordBytes = 32 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes <= 0) throw new Error('capacity_policy');
  const handles = new WeakMap<PersistentHandle, Detail>(), live = new WeakMap<PersistentHandle, Workspace>();
  const proposals = new WeakMap<PersistentPreview, Proposal>();
  const inspections = new WeakMap<BackupInspection, { expected: Host; decoded: Awaited<ReturnType<typeof decodeBackupJson>> }>();
  const committing = new WeakSet<PersistentPreview>();
  let active: PersistentHandle | undefined;
  const owner = createWorkbenchIdentityOwner(() => active ? [active.source, active.state, live.get(active)] : [], () => active);
  async function validateEnvironment(replay: Awaited<ReturnType<typeof replayState>> | Rule2Replay) {
    if ('environment' in replay) {
      if (!environmentInput) throw new Error('migration_environment_required');
      // Dynamic providers are sampled afresh at every validation, including
      // after Lock acquisition and immediately before the atomic store call.
      const environment = typeof environmentInput === 'function' ? await environmentInput() : environmentInput;
      if (!sameAttemptData(replay.environment, environment)) throw new Error('target_catalog_changed');
    }
    return replay;
  }
  async function rule2(state: unknown) { const r = await replayStateRule2(state); await validateEnvironment(r); return r; }
  async function read(): Promise<Host> {
    // Snapshot before awaiting validation; restrictions only accumulate after a
    // complete validation of THIS read. Rescue never passes through this path.
    const original: unknown = await store.read();
    // This comparator inspects descriptors recursively without invoking getters.
    // Validate BEFORE structuredClone/JSON can discard or normalize information.
    if (!sameAuthoritySnapshot(original, original)) throw new Error('authority_record_invalid');
    const versioned = original !== null && typeof original === 'object'
      && ['format', 'authorityVersion', 'reservationCoverage'].some(key => Object.hasOwn(original, key));
    exactKeys(original, ['raw', 'revision', 'committed', 'issuedIds', ...(versioned ? ['format', 'authorityVersion', 'reservationCoverage'] : [])], 'authority');
    if (versioned) exactKeys(original.reservationCoverage, ['policyVersion', 'kind', 'baselineStateSha256'], 'reservation_coverage');
    const snapshot = structuredClone(original);
    const checked = await decodeAuthorityJson(JSON.stringify(snapshot));
    if (!sameAuthoritySnapshot(snapshot, checked.value)) throw new Error('authority_record_invalid');
    if (checked.value.raw !== null) {
      const state = parseMigrationJson(checked.value.raw);
      await validateEnvironment(checked.authorityKind === 'v2' ? await replayStateRule2(state) : await replayState(state));
    }
    owner.restrict(checked.value.issuedIds);
    return checked.value;
  }
  function requireHandle(h: PersistentHandle) {
    const d = handles.get(h); if (!d) throw new Error('unverified_persistent_handle'); return d;
  }
  function editable(h: PersistentHandle) {
    const d = requireHandle(h);
    if (h.saveStatus === 'unconfirmed-recovery') throw new Error('unconfirmed_recovery');
    if (!d.editable || d.coverage === 'legacy-authority' || d.coverage.kind !== 'native-v2') throw new Error('legacy_normal_save_blocked');
    return d;
  }
  function handle(r: Awaited<ReturnType<typeof replayState>> | Rule2Replay, expected: Host, coverage: Coverage, canEdit: boolean, recovery = false): PersistentHandle {
    owner.restrict(r.requiredReservations);
    const h: PersistentHandle = freeze({ state: r.state, workspace: r.workspace, source: r.source, coverage,
      saveStatus: recovery ? 'unconfirmed-recovery' : coverage === 'legacy-authority' ? 'explicit-migration-required'
        : coverage.kind === 'legacy-unproven' ? 'legacy-unproven' : 'native-v2-save-authorized' });
    handles.set(h, { expected, coverage, editable: canEdit }); live.set(h, r.workspace); return h;
  }
  async function loadHost(expected: Host) {
    if (expected.raw === null) return null;
    const coverage = coverageOf(expected), r = coverage === 'legacy-authority'
      ? await replayState(parseMigrationJson(expected.raw)) : await rule2(parseMigrationJson(expected.raw));
    await validateEnvironment(r);
    return handle(r, expected, coverage, coverage !== 'legacy-authority' && coverage.kind === 'native-v2');
  }
  async function load() { return loadHost(await read()); }
  async function protectCurrent() {
    const { raw } = await store.read();
    if (raw !== null && typeof raw !== 'string') throw new Error('unreadable_original');
    return JSON.stringify({ format: 'hosei-yi06-protection', protectionVersion: 1, currentRaw: raw,
      sha256: raw === null ? null : await backupRawDigest(raw) });
  }
  async function proposal(h: PersistentHandle, action: PersistentPreview['action'], state: AttemptStateRule2,
    coverage: ReservationCoverage, reserved: string[] = [], backupRaw: string | null = null,
    migration?: Awaited<ReturnType<typeof previewLegacyRule2Migration>>) {
    const d = requireHandle(h);
    const p: PersistentPreview = freeze({ handle: h, action, previousAuthority: d.expected, previousRaw: d.expected.raw, sourceRaw: protectionSource(h.source),
      bytes: bytes(JSON.stringify(state)), backupRaw, backupRawSha256: backupRaw === null ? null : await backupRawDigest(backupRaw),
      ...(migration ? { migration } : {}) });
    proposals.set(p, { expected: d.expected, state, coverage, reserved, base: h, backupRaw,
      ...(migration ? { migrationRaw: d.expected.raw! } : {}) }); return p;
  }
  async function prepareNewPlan() {
    const expected = await read(), coverage = coverageOf(expected);
    if (expected.raw !== null && (coverage === 'legacy-authority' || coverage.kind !== 'native-v2')
      || coverage !== 'legacy-authority' && coverage.kind !== 'native-v2') throw new Error('legacy_normal_save_blocked');
    const source = await createNewPlanSource(), state = await encodeNewPlanRule2(source, emptyNewPlanWorkspace(source));
    const h = handle(await rule2(state), expected, native, true); return proposal(h, 'new-plan', state, native);
  }
  async function previewLegacyMigration() {
    const expected = await read();
    if ('authorityVersion' in expected || expected.raw === null) throw new Error('legacy_authority_required');
    const migration = await previewLegacyRule2Migration(expected.raw);
    if (migration.status !== 'preview') return freeze({ status: 'held' as const, migration, saveAuthority: 'not-issued' as const });
    const r = await rule2(migration.candidate), h = handle(r, expected, migration.reservationCoverage, false);
    return proposal(h, 'migration', r.state, migration.reservationCoverage, [], null, migration);
  }
  function identities(h: PersistentHandle) {
    editable(h);
    return Object.freeze(Object.fromEntries(Object.entries(owner.ids).map(([key, mint]) => [key, () => { editable(h); active = h; return mint(); }]))) as typeof owner.ids;
  }
  function apply(h: PersistentHandle, workspace: Workspace, command: Command) {
    editable(h);
    // Retry of the identical recorded request is still checked by applyCommand.
    if (!workspace.receipts.some(c => c.operationId === command.operationId)) owner.check(workspace, command, h);
    return applyCommand(workspace, command, h.source.context);
  }
  function dispatch(h: PersistentHandle, workspace: Workspace, command: Command) {
    if (live.get(h) !== workspace) throw new Error('unverified_identity_workspace');
    const next = apply(h, workspace, command); live.set(h, next); return next;
  }
  async function prepareEdits(h: PersistentHandle, commands: readonly Command[]) {
    const d = editable(h); let workspace = h.workspace;
    for (const c of commands) workspace = apply(h, workspace, c);
    const r = await rule2(h.state);
    const state = 'environment' in r
      ? await encodeStateRule2(r.source, r.state.assignments, r.base, workspace, r.environment.target, r.state.corrections)
      : await encodeNewPlanRule2(r.source, workspace);
    const candidate = handle(await rule2(state), d.expected, d.coverage, true);
    return proposal(candidate, 'edit', state, d.coverage as ReservationCoverage);
  }
  async function replacement(state: AttemptStateRule2, source: PersistenceSource, reserved: string[], expected: Host) {
    unionReservations(expected.issuedIds, reserved);
    if (expected.committed.includes(await backupDigest(state))) return;
    const occupied = new Set(expected.issuedIds.map(idTail)), incoming = source.kind === 'new-plan' ? new Set<string>() : referencedUuids(source.state);
    const shared = new Set<string>();
    if (expected.raw !== null) {
      const current = await loadHost(expected); if (!current) throw new Error('authority_corrupt');
      if (current.source.kind !== 'new-plan') referencedUuids(current.source.state).forEach(id => occupied.add(id));
      const catalog = catalogUuids(source); catalogUuids(current.source).forEach(id => { if (catalog.has(id)) shared.add(id); });
    }
    if (reserved.some(id => occupied.has(idTail(id)) && !(shared.has(id) && !incoming.has(id)))) throw new Error('recovery_host_collision');
  }
  async function inspectBackup(raw: string): Promise<BackupInspection> {
    const decoded = await decodeBackupJson(raw), expected = await read();
    if (decoded.backupKind === 'legacy') {
      if (decoded.value.backupVersion === 1 && !expected.committed.includes(await backupDigest(decoded.value.state))) throw new Error('unverified_assignment_history');
      await validateEnvironment(await replayState(decoded.value.state));
      const migration = await previewLegacyRule2Migration(JSON.stringify(decoded.value.state));
      const i = freeze({ verification: 'content-validated' as const, saveAuthority: 'not-issued' as const, backupKind: 'legacy' as const, raw, migration }) as BackupInspection;
      inspections.set(i, { expected, decoded }); return i;
    }
    const r = await rule2(decoded.value.state);
    assertCoverageContinuation(coverageOf(expected) === 'legacy-authority' && expected.raw === null ? decoded.value.reservationCoverage : coverageOf(expected), decoded.value.reservationCoverage);
    await replacement(r.state, r.source, decoded.value.reservedIds, expected);
    const i = freeze({ verification: 'content-validated' as const, saveAuthority: 'not-issued' as const, backupKind: 'v4' as const, raw }) as BackupInspection;
    inspections.set(i, { expected, decoded }); return i;
  }
  async function prepareRestore(i: BackupInspection) {
    const saved = inspections.get(i); if (!saved) throw new Error('unverified_backup_inspection');
    if (saved.decoded.backupKind !== 'v4') throw new Error('legacy_backup_explicit_migration_required');
    const current = await read(); if (!sameAuthoritySnapshot(current, saved.expected)) throw new Error('stale_preview');
    const b = saved.decoded.value, h = handle(await rule2(b.state), saved.expected, b.reservationCoverage, false, true);
    return proposal(h, 'restore', b.state, b.reservationCoverage, b.reservedIds, i.raw);
  }
  async function createBackup(h: PersistentHandle, createdAt = new Date().toISOString()) {
    const d = requireHandle(h); if (h.saveStatus === 'unconfirmed-recovery') throw new Error('unconfirmed_recovery');
    if (d.coverage === 'legacy-authority') throw new Error('legacy_backup_use_rule1_controller');
    const current = await read(), coverage = coverageOf(current), digest = await backupDigest(h.state);
    if (coverage === 'legacy-authority' || !d.expected.committed.includes(digest) || !current.committed.includes(digest)) throw new Error('backup_requires_committed_state');
    // A host downgrade must be represented in exports of older handles as well.
    assertCoverageContinuation(d.coverage, coverage);
    const r = await rule2(h.state), reservedIds = unionReservations(current.issuedIds, r.requiredReservations);
    const body = { format: 'hosei-attempt-backup' as const, backupVersion: 4 as const, createdAt, state: r.state, reservedIds, reservationCoverage: coverage };
    const raw = JSON.stringify({ ...body, sha256: await backupDigest(body) }); await decodeBackupJson(raw); return raw;
  }
  async function commit(p: PersistentPreview, confirmation: PersistentConfirmation) {
    const saved = proposals.get(p);
    if (!saved || !confirmation?.confirmed) throw new Error('explicit_confirmation_required');
    if (committing.has(p)) throw new Error('commit_in_progress');
    if (confirmation.protectedRaw !== saved.expected.raw || confirmation.protectedSourceRaw !== p.sourceRaw) throw new Error('original_protection_required');
    if (saved.backupRaw !== null && (confirmation.acceptedBackupRawSha256 !== p.backupRawSha256 || confirmation.protectedBackupRaw !== saved.backupRaw)) throw new Error('portable_adoption_and_protection_required');
    committing.add(p);
    try {
      return await withPlannerWriteLock(async () => {
        const current = await read(); if (!sameAuthoritySnapshot(current, saved.expected)) throw new Error('stale_commit');
        if (saved.migrationRaw !== undefined) {
          const migration = await previewLegacyRule2Migration(saved.migrationRaw);
          if (migration.status !== 'preview' || !sameAttemptData(migration.candidate, saved.state)
            || !sameAttemptData(migration.reservationCoverage, saved.coverage)) throw new Error('migration_changed');
        }
        if (saved.backupRaw !== null) {
          const backup = await decodeBackupJson(saved.backupRaw);
          if (backup.backupKind !== 'v4' || !sameAttemptData(backup.value.state, saved.state)
            || !sameAttemptData(backup.value.reservationCoverage, saved.coverage) || !sameAttemptData(backup.value.reservedIds, saved.reserved)) throw new Error('backup_changed');
          await replacement(saved.state, p.handle.source, saved.reserved, current);
        }
        const previousCoverage = coverageOf(current);
        if (!(current.raw === null && previousCoverage === 'legacy-authority')) assertCoverageContinuation(previousCoverage, saved.coverage);
        const r = await rule2(saved.state), digest = await backupDigest(r.state);
        const next: AuthorityV2 = { format: AUTHORITY_FORMAT, authorityVersion: AUTHORITY_VERSION, reservationCoverage: saved.coverage,
          raw: JSON.stringify(r.state), revision: current.revision + 1, committed: [...new Set([...current.committed, digest])],
          issuedIds: unionReservations(current.issuedIds, r.requiredReservations, saved.reserved, owner.reservations()) };
        await decodeAuthorityJson(JSON.stringify(next));
        if (bytes(JSON.stringify(next)) > maxRecordBytes) throw new Error('capacity_limit');
        // Last external-environment sample: after full candidate validation and
        // while holding the common Lock, before store.commit can perform a put.
        await validateEnvironment(r);
        await store.commit(current, next);
        // Success is only published after atomic completion AND strict reread.
        // Failure here is unknown, never a rollback or automatic retry.
        try {
          const persisted = await read(); if (!sameAuthoritySnapshot(persisted, next)) throw new Error('postcommit_authority_changed');
          const result = await loadHost(persisted); if (!result) throw new Error('missing_committed_state');
          proposals.delete(p); return result;
        } catch (error) { proposals.delete(p); throw new Error('commit_outcome_unknown', { cause: error }); }
      }, locks, true);
    } finally { committing.delete(p); }
  }
  return { load, protectCurrent, prepareNewPlan, previewLegacyMigration, identities, dispatch, prepareEdits,
    inspectBackup, prepareRestore, createBackup, commit };
}
