import { backupDigest, backupRawDigest } from '../../backup/plannerBackupCompatibility';
import { withPlannerWriteLock, type PlannerWriteLocks } from '../../backup/storage';
import { parseMigrationJson, prepareMigrationEnvironment, decodeMigrationSource } from '../migration/source';
import { prepareMigrationIds } from '../migration/assignments';
import { previewMigration } from '../migration/preview';
import { freeze, type IdAssignments, type SourceArchive, type MigrationTarget } from '../migration/contracts';
import { dateCorrectionProposal, type DateCorrection, type MigrationSession } from '../workbench/migrationSession';
import { applyCommand, createWorkspace, type Command, type Workspace } from '../workbench/operations';
import { sameAttemptData } from '../validation';
import { assignmentIds, issuedIds, encodeState, replayState, requireLiveMigration } from './codec';
import { BACKUP_FORMAT, BACKUP_VERSION, NEW_BACKUP_VERSION, exactKeys, type AtomicAttemptStore, type AttemptState, type PersistenceSource, type NewPlanSource, type AuthorityRecord, type CorrectionEvidence } from './contracts';
import { createNewPlanSource, emptyNewPlanWorkspace, encodeNewPlan, newPlanIssuedIds } from './newPlan';
import { catalogUuids, checkFreshCommandIds, idTail, referencedUuids, requireReservations, sourceUuids, unionReservations, validateReservations } from './identity';

export type PersistenceHandle = { state: AttemptState; workspace: Workspace; source: PersistenceSource };
type Recovery = { raw: string; rawSha256: string; reservedIds: string[]; portable: boolean };
export type PortableConsent = { acceptedBackupRawSha256: string; protectedBackupRaw: string };
export type PersistencePreview = { handle: PersistenceHandle; bytes: number; previousRaw: string | null; sourceRaw: string; action: 'new-plan' | 'migration' | 'edit' | 'restore'; recovery: Recovery | null };
type Origin = { kind: 'migration'; source: SourceArchive; base: MigrationTarget; table: IdAssignments; corrections: CorrectionEvidence[] }
  | { kind: 'new-plan'; source: NewPlanSource };
type PrivateHandle = Origin & { expected: AuthorityRecord; fresh: boolean; recovery?: Recovery };
type Replay = Awaited<ReturnType<typeof replayState>>;
function replayOrigin(r: Replay): Origin {
  if ('environment' in r) return { kind: 'migration', source: r.source, base: r.base, table: r.state.assignments, corrections: r.state.corrections };
  return { kind: 'new-plan', source: r.source };
}
const sourceProtection = (source: PersistenceSource) => source.kind === 'new-plan' ? JSON.stringify(source.evidence) : source.raw;
// New source evidence contains shared document references, no learner identities.
const stateReferences = (source: PersistenceSource) => source.kind === 'new-plan' ? new Set<string>() : referencedUuids(source.state);
type Environment = Awaited<ReturnType<typeof prepareMigrationEnvironment>>;
// Trusted factory dependencies only; reservations restrict IDs, never grant trust.
type MigrationIdReservations = { issued: (id: string) => void; reserved: () => readonly string[];
  // Trusted, synchronous validation only. Never supplied through Worker RPC.
  beforeCommand?: (workspace: Workspace, command: Command) => void };
const utf8Bytes = (raw: string) => new TextEncoder().encode(raw).byteLength;
function validateAuthority(record: AuthorityRecord) {
  exactKeys(record, ['raw', 'revision', 'committed', 'issuedIds'], 'authority');
  if (!(record.raw === null || typeof record.raw === 'string') || !Number.isSafeInteger(record.revision) || record.revision < 0
    || !Array.isArray(record.committed) || record.committed.some(s => typeof s !== 'string' || !/^[a-f0-9]{64}$/.test(s))
    || !Array.isArray(record.issuedIds) || record.issuedIds.some(s => typeof s !== 'string')
    || new Set(record.committed).size !== record.committed.length || new Set(record.issuedIds).size !== record.issuedIds.length) throw new Error('authority_corrupt');
  validateReservations(record.issuedIds);
  if (record.revision > 0 && (record.raw === null || record.committed.length === 0)) throw new Error('authority_corrupt');
  if (record.revision === 0 && (record.raw !== null || record.committed.length || record.issuedIds.length)) throw new Error('authority_corrupt');
}
/** Reload requires a host checkpoint. Portable recovery instead requires complete
 * integrity validation plus separate explicit adoption of the selected file.
 * Neither a hash nor user consent authenticates its issuer. */
export function createAttemptPersistence(store: AtomicAttemptStore, locks: PlannerWriteLocks | undefined, environmentInput?: Environment | (() => Promise<Environment>), maxRecordBytes = 32 * 1024 * 1024, migrationIds?: MigrationIdReservations) {
  if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes <= 0) throw new Error('capacity_policy');
  const beforeCommand = migrationIds?.beforeCommand;
  let environmentTask: Promise<Environment> | undefined;
  async function migrationEnvironment() {
    if (!environmentInput) throw new Error('migration_environment_required');
    return typeof environmentInput === 'function' ? environmentTask ??= environmentInput() : environmentInput;
  }
  const handles = new WeakMap<PersistenceHandle, PrivateHandle>();
  const previews = new WeakSet<PersistencePreview>();
  const sessions = new WeakMap<MigrationSession, { expected: AuthorityRecord; corrections: CorrectionEvidence[] }>();
  const sessionIssuedIds = new Map<string, string>();
  function migrationIdSink(source: SourceArchive, reservedIds: readonly string[]) {
    // Preserve the canonical spelling of an already occupied UUID (including a
    // bare source reference). A rejected namespace alias must not poison replay.
    const known = new Map([...sourceUuids(source)].map(id => [id, id]));
    reservedIds.forEach(id => known.set(idTail(id), id));
    return (id: string) => {
      const tail = idTail(id);
      if (!sessionIssuedIds.has(tail)) sessionIssuedIds.set(tail, known.get(tail) ?? id);
      migrationIds?.issued(id);
    };
  }
  function migrationReservations(previous: readonly string[]): string[] {
    // Snapshot before minting. Deduplicate restriction aliases by bare UUID;
    // never mutate this table's validation input from the issuance callback.
    const ids = new Map(previous.map(id => [idTail(id), id]));
    for (const id of [...sessionIssuedIds.values(), ...(migrationIds?.reserved() ?? [])]) {
      if (!ids.has(idTail(id))) ids.set(idTail(id), id);
    }
    return [...ids.values()];
  }
  const inspected = new Map<string, Promise<MigrationSession>>();
  const confirmedDates = new WeakMap<DateCorrection, Promise<MigrationSession>>();
  const corrections = new WeakSet<DateCorrection>();
  async function read() { const record = await store.read(); validateAuthority(record); return freeze(structuredClone(record)); }
  function requireHandle(handle: PersistenceHandle) {
    const detail = handles.get(handle); if (!detail) throw new Error('unverified_assignment_history'); return detail;
  }
  async function witness(state: unknown, authority: AuthorityRecord) {
    const digest = await backupDigest(state);
    if (!authority.committed.includes(digest)) throw new Error('unverified_assignment_history: このブラウザの確定保存履歴がありません。原文を保護してください。');
    const replay = await validateState(state);
    if (replay.state.history.issuedIds.some(id => !authority.issuedIds.includes(id))) throw new Error('issuance_history_missing');
    return replay;
  }
  async function validateState(state: unknown) {
    const replay = await replayState(state);
    if ('environment' in replay) {
      const environment = await migrationEnvironment();
      if (!sameAttemptData(replay.environment.target, environment.target)
        || !sameAttemptData(replay.environment.rawFiles, environment.rawFiles)
        || !sameAttemptData(replay.environment.catalog, environment.catalog)) throw new Error('target_catalog_changed');
    }
    return replay;
  }
  async function checkReplacement(state: AttemptState, source: PersistenceSource, reserved: string[], expected: AuthorityRecord) {
    // Known checkpoints can roll back, but permanent reservations survive.
    unionReservations(expected.issuedIds, reserved);
    if (expected.committed.includes(await backupDigest(state))) return;
    const occupied = new Set(expected.issuedIds.map(idTail));
    const sharedCatalog = new Set<string>(), incomingReferences = stateReferences(source);
    if (expected.raw !== null) {
      const current = await witness(parseMigrationJson(expected.raw), expected);
      stateReferences(current.source).forEach(id => occupied.add(id));
      const incomingCatalog = catalogUuids(source);
      catalogUuids(current.source).forEach(id => { if (incomingCatalog.has(id)) sharedCatalog.add(id); });
    }
    // Identical bare catalog references are shared restrictions, not newly issued
    // identities. State references and cross-namespace aliases still conflict.
    if (reserved.some(id => occupied.has(idTail(id))
      && !(sharedCatalog.has(id) && !incomingReferences.has(id)))) throw new Error('recovery_host_collision: 未知の履歴が既存IDと重なります。空の隔離環境で復旧してください。');
  }
  async function makeHandle(workspace: Workspace, detail: PrivateHandle): Promise<PersistenceHandle> {
    const state = detail.kind === 'new-plan' ? await encodeNewPlan(detail.source, workspace)
      : await encodeState(detail.source, detail.table, detail.base, workspace, (await migrationEnvironment()).target, detail.corrections);
    const handle = freeze({ state, workspace, source: detail.source }); handles.set(handle, detail); return handle;
  }
  async function prepareNewPlan() {
    const expected = await read(), source = await createNewPlanSource();
    const handle = await makeHandle(emptyNewPlanWorkspace(source), { kind: 'new-plan', source, expected, fresh: true });
    return preview(handle, 'new-plan');
  }
  async function protectCurrent() {
    const { raw } = await store.read();
    if (raw !== null && typeof raw !== 'string') throw new Error('unreadable_original');
    return JSON.stringify({ format: 'hosei-yi06-protection', protectionVersion: 1, currentRaw: raw, sha256: raw === null ? null : await backupRawDigest(raw) });
  }
  async function load(): Promise<PersistenceHandle | null> {
    const expected = await read(); if (expected.raw === null) return null;
    const r = await witness(parseMigrationJson(expected.raw), expected);
    return makeHandle(r.workspace, { ...replayOrigin(r), expected, fresh: false });
  }
  async function inspectLegacy(raw: string): Promise<MigrationSession> {
    const environment = await migrationEnvironment();
    const expected = await read();
    const cacheKey = `${expected.revision}:${raw}`;
    if (inspected.has(cacheKey)) return inspected.get(cacheKey)!;
    const task = (async () => {
    const decoded = await decodeMigrationSource(raw, environment, environment.origin);
    const reservedIds = migrationReservations(expected.issuedIds);
    const table = decoded.status === 'decoded' ? prepareMigrationIds(decoded.source, reservedIds, undefined, migrationIdSink(decoded.source, reservedIds)) : null;
    const preview = decoded.status === 'decoded' && table ? previewMigration(decoded.source, table, reservedIds) : null;
    const session = freeze({ raw, decoded, table, preview, reservedIds }); sessions.set(session, { expected, corrections: [] }); return session;
    })(); inspected.set(cacheKey, task);
    try { return await task; } catch (e) { inspected.delete(cacheKey); throw e; }
  }
  async function proposeDate(session: MigrationSession, offeringId: string, assessmentId: string, newDate: string | null) {
    if (!sessions.has(session)) throw new Error('unknown_migration_session');
    const proposal = dateCorrectionProposal(session, offeringId, assessmentId, newDate);
    corrections.add(proposal); return proposal;
  }
  async function confirmDate(session: MigrationSession, proposal: DateCorrection, confirmed: boolean): Promise<MigrationSession> {
    const previous = sessions.get(session);
    if (!previous || !corrections.has(proposal) || proposal.original.raw !== session.raw || !session.table || !confirmed) throw new Error('explicit_correction_confirmation_required');
    const environment = await migrationEnvironment();
    const originalTable = session.table;
    if (confirmedDates.has(proposal)) return confirmedDates.get(proposal)!;
    const task = (async () => {
    const decoded = await decodeMigrationSource(proposal.proposedRaw, environment, environment.origin);
    const reservedIds = migrationReservations([...session.reservedIds, ...assignmentIds(originalTable)]);
    const table = decoded.status === 'decoded' ? prepareMigrationIds(decoded.source, reservedIds, undefined, migrationIdSink(decoded.source, reservedIds)) : null;
    const preview = decoded.status === 'decoded' && table ? previewMigration(decoded.source, table, reservedIds) : null;
    const next = freeze({ raw: proposal.proposedRaw, decoded, table, preview, reservedIds });
    const evidence: CorrectionEvidence = { originalRaw: session.raw, proposedRaw: proposal.proposedRaw, offeringId: proposal.offeringId,
      assessmentId: proposal.assessmentId, oldDate: proposal.oldDate, newDate: proposal.newDate, originalAssignments: originalTable };
    sessions.set(next, { ...previous, corrections: [...previous.corrections, evidence] }); return next;
    })(); confirmedDates.set(proposal, task); return task;
  }
  // Read-only qualification probe: never constructs or upgrades credentials.
  function assertPreview(proposed: PersistencePreview): void {
    if (!previews.has(proposed)) throw new Error('unknown_persistence_preview');
    requireHandle(proposed.handle);
  }
  async function preview(handle: PersistenceHandle, action: PersistencePreview['action']): Promise<PersistencePreview> {
    const detail = requireHandle(handle);
    const result = freeze({ handle, action, previousRaw: detail.expected.raw, sourceRaw: sourceProtection(handle.source), recovery: detail.recovery ?? null,
      bytes: utf8Bytes(JSON.stringify(handle.state)) }); previews.add(result); return result;
  }
  async function prepareMigration(session: MigrationSession) {
    const saved = sessions.get(session);
    if (!saved || session.decoded.status !== 'decoded' || !session.table || session.preview?.status !== 'ready') throw new Error('migration_not_ready');
    const source = session.decoded.source, base = session.preview.target;
    requireLiveMigration(source, session.table, base);
    const handle = await makeHandle(createWorkspace(base.graph, source.context), { kind: 'migration', source,
      expected: saved.expected, base, table: session.table, corrections: saved.corrections, fresh: true });
    return preview(handle, 'migration');
  }
  function dispatch(handle: PersistenceHandle, workspace: Workspace, command: Command) {
    const detail = requireHandle(handle);
    if (detail.recovery) throw new Error('unconfirmed_recovery');
    // A rollback/restore cannot make IDs from later committed checkpoints reusable.
    if (!workspace.receipts.some(c => c.operationId === command.operationId)) {
      const occupied = sourceUuids(handle.source);
      [...detail.expected.issuedIds, ...sessionIssuedIds.values(), ...(detail.kind === 'new-plan' ? newPlanIssuedIds(workspace) : issuedIds(detail.table, workspace, detail.corrections))].forEach(id => occupied.add(idTail(id)));
      checkFreshCommandIds(command, occupied);
      // requireHandle/recovery and legacy freshness checks precede this hook.
      // The next line outside this block remains the sole graph application.
      beforeCommand?.(workspace, command);
    }
    return applyCommand(workspace, command, handle.source.context);
  }
  async function prepareEdits(handle: PersistenceHandle, commands: readonly Command[]) {
    const detail = requireHandle(handle); let workspace = handle.workspace;
    if (detail.recovery) throw new Error('unconfirmed_recovery');
    for (const command of commands) workspace = dispatch(handle, workspace, command);
    return preview(await makeHandle(workspace, detail), 'edit');
  }
  async function createBackup(handle: PersistenceHandle, createdAt = new Date().toISOString()) {
    const detail = requireHandle(handle);
    if (detail.recovery) throw new Error('unconfirmed_recovery');
    const state = handle.state, sha256 = await backupDigest(state);
    // Backups represent committed states only, never an uncommitted draft.
    const current = await read();
    if (!detail.expected.committed.includes(sha256) || !current.committed.includes(sha256)) throw new Error('backup_requires_committed_state');
    if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) throw new Error('backup_date');
    const replay = await validateState(state);
    const reservedIds = unionReservations(current.issuedIds, replay.requiredReservations);
    const body = { format: BACKUP_FORMAT, backupVersion: state.schemaVersion === 24 ? NEW_BACKUP_VERSION : BACKUP_VERSION, createdAt, state, reservedIds } as const;
    const backup = { ...body, sha256: await backupDigest(body) };
    return JSON.stringify(backup);
  }
  async function inspectBackup(raw: string) {
    const parsed = parseMigrationJson(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('unsupported_backup');
    const value = parsed as Record<string, unknown>;
    exactKeys(value, ['format', 'backupVersion', 'createdAt', 'state', 'sha256', ...((value.backupVersion === 2 || value.backupVersion === NEW_BACKUP_VERSION) ? ['reservedIds'] : [])], 'backup');
    if (value.format !== BACKUP_FORMAT || ![1, BACKUP_VERSION, NEW_BACKUP_VERSION].includes(value.backupVersion as number)) throw new Error('unsupported_backup: Attempt backup v1/v2/v3のみ。旧Planner backupは明示移行へ、protectionは原文保護専用です。');
    const schemaVersion = (value.state as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (schemaVersion !== (value.backupVersion === NEW_BACKUP_VERSION ? 24 : 23)) throw new Error('backup_source_version_mismatch');
    if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) throw new Error('backup_date');
    const { sha256, ...body } = value;
    if (sha256 !== await backupDigest(body)) throw new Error('backup_digest');
    if (value.backupVersion === BACKUP_VERSION) {
      // Necessary catalog subset only: reject missing restrictions cheaply.
      // A passing preflight still requires the complete source/history replay.
      const environment = await migrationEnvironment();
      const state = value.state as { source?: { catalog?: unknown } } | null;
      requireReservations(value.reservedIds, [...referencedUuids([state?.source?.catalog, environment.catalog])]);
    }
    const expected = await read();
    // v1 omitted the host's rollback tombstones. Do not infer missing history.
    const r = value.backupVersion === 1 ? await witness(value.state, expected) : await validateState(value.state);
    const reserved = value.backupVersion === 1 ? unionReservations(expected.issuedIds, r.state.history.issuedIds) : value.reservedIds;
    const required = (value.backupVersion === 2 || value.backupVersion === NEW_BACKUP_VERSION) ? r.requiredReservations : r.state.history.issuedIds;
    requireReservations(reserved, required);
    unionReservations(reserved, r.requiredReservations);
    await checkReplacement(r.state, r.source, reserved, expected);
    const recovery: Recovery = { raw, rawSha256: await backupRawDigest(raw), reservedIds: reserved,
      portable: !expected.committed.includes(await backupDigest(r.state)) || reserved.some(id => !expected.issuedIds.includes(id)) };
    const handle = await makeHandle(r.workspace, { ...replayOrigin(r), expected, fresh: false, recovery });
    return preview(handle, 'restore');
  }
  async function commit(proposed: PersistencePreview, confirmed: boolean, protectedRaw: string | null, protectedSourceRaw: string, consent?: PortableConsent) {
    if (!previews.has(proposed) || !confirmed) throw new Error('explicit_confirmation_required');
    const handle = proposed.handle, detail = requireHandle(handle);
    if (protectedRaw !== detail.expected.raw || protectedSourceRaw !== sourceProtection(handle.source)) throw new Error('original_protection_required');
    if (detail.recovery?.portable && (consent?.acceptedBackupRawSha256 !== detail.recovery.rawSha256
      || consent.protectedBackupRaw !== detail.recovery.raw)) throw new Error('portable_adoption_and_protection_required');
    // Re-decode raw6/catalog/source, replay all commands and validate every field.
    if (detail.recovery) {
      if (proposed.action !== 'restore') throw new Error('unconfirmed_recovery');
      await checkReplacement(handle.state, handle.source, detail.recovery.reservedIds, detail.expected);
    } else if (detail.fresh) {
      if (detail.kind === 'migration') requireLiveMigration(detail.source, detail.table, detail.base);
    } else await witness(handle.state, detail.expected).catch(async error => {
      // An edit candidate is not committed yet; authenticate the unchanged base
      // checkpoint, then derive the candidate by its recorded ordered commands.
      if (proposed.action !== 'edit' || detail.expected.raw === null) throw error;
      const previous = await witness(parseMigrationJson(detail.expected.raw), detail.expected);
      if ((previous.state.schemaVersion === 23 && handle.state.schemaVersion === 23
        && !sameAttemptData(previous.state.assignments, handle.state.assignments))
        || previous.state.schemaVersion !== handle.state.schemaVersion || !sameAttemptData(previous.state.source, handle.state.source)
        || !sameAttemptData(previous.state.history.commands, handle.state.history.commands.slice(0, previous.state.history.commands.length))) throw new Error('history_fork');
    });
    const replay = await validateState(handle.state);
    const raw = JSON.stringify(replay.state), digest = await backupDigest(replay.state);
    const next: AuthorityRecord = { raw, revision: detail.expected.revision + 1,
      committed: [...new Set([...detail.expected.committed, digest])], issuedIds: unionReservations(detail.expected.issuedIds, [...sessionIssuedIds.values()], replay.requiredReservations, detail.recovery?.reservedIds ?? []) };
    validateAuthority(next);
    if (utf8Bytes(JSON.stringify(next)) > maxRecordBytes) throw new Error(`capacity_limit: ${maxRecordBytes} bytes。archiveは省略しません。`);
    // Same lock as legacy Planner. IDB adds atomic CAS + one-record put; no
    // localStorage split, no repair write, no rollback. Await transaction success.
    await withPlannerWriteLock(() => store.commit(detail.expected, next), locks, true);
    const loaded = freeze({ state: replay.state, workspace: replay.workspace, source: replay.source });
    handles.set(loaded, { ...detail, expected: freeze(next), fresh: false, recovery: undefined });
    previews.delete(proposed);
    return loaded;
  }
  return { assertPreview, load, protectCurrent, prepareNewPlan, inspectLegacy, proposeDate, confirmDate, prepareMigration, dispatch, prepareEdits, createBackup, inspectBackup, commit };
}
