import { backupDigest } from '../../backup/plannerBackupCompatibility';
import { freeze } from '../migration/contracts';
import { parseMigrationJson } from '../migration/source';
import { replayState, replayStateRule2 } from './codec';
import { BACKUP_FORMAT, exactKeys, type AuthorityRecord, type AttemptBackup, type NewPlanBackup } from './contracts';
import { requireReservations, validateReservations } from './identity';
import { requireRule2Reservations } from './identityFold';
import { AUTHORITY_FORMAT, AUTHORITY_VERSION, RULE2_BACKUP_VERSION,
  type AuthorityV2, type AttemptBackupV4, type ContentValidated,
  type ReservationCoverage, type UnqualifiedDisposition } from './versionedContracts';

const sha256 = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const migrationRequired = (): UnqualifiedDisposition => ({ kind: 'explicit-migration-required' });
function disposition(coverage: ReservationCoverage): UnqualifiedDisposition {
  return coverage.kind === 'native-v2' ? { kind: 'native-v2-unadopted' }
    : { kind: 'legacy-unproven', baselineStateSha256: coverage.baselineStateSha256 };
}
function validated<T>(raw: string, value: T, status: UnqualifiedDisposition): ContentValidated<T> {
  return freeze({ verification: 'content-validated', raw, value, disposition: status, saveAuthority: 'not-issued' });
}
function parse(raw: string): unknown {
  if (typeof raw !== 'string') throw new Error('json_input_type');
  // The existing strict parser rejects decoded duplicate keys, -0, nonfinite
  // and unsafe integer values. Keep the exact input; never normalize its text.
  return parseMigrationJson(raw);
}
function decodeReservationCoverage(value: unknown): ReservationCoverage {
  exactKeys(value, ['policyVersion', 'kind', 'baselineStateSha256'], 'reservation_coverage');
  if (value.policyVersion !== 2
    || !(value.kind === 'native-v2' && value.baselineStateSha256 === null
      || value.kind === 'legacy-unproven' && sha256(value.baselineStateSha256))) throw new Error('reservation_coverage_invalid');
  return freeze(structuredClone(value)) as ReservationCoverage;
}
export function decodeReservationCoverageJson(raw: string): ReservationCoverage {
  return decodeReservationCoverage(parse(raw));
}
/** Restriction only; does not execute migration, adopt a file or issue trust.
 * An old four-field record is represented by the explicit legacy-authority tag. */
export function assertCoverageContinuation(previous: ReservationCoverage | 'legacy-authority', next: ReservationCoverage): void {
  const checked = decodeReservationCoverage(next);
  if (previous === 'legacy-authority') {
    if (checked.kind !== 'legacy-unproven') throw new Error('coverage_implicit_promotion');
    return;
  }
  const prior = decodeReservationCoverage(previous);
  if (prior.kind === 'legacy-unproven'
    && (checked.kind !== 'legacy-unproven' || checked.baselineStateSha256 !== prior.baselineStateSha256)) throw new Error('coverage_implicit_promotion');
}

async function replayVersioned(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('unsupported_persistence_version');
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 23 && state.schemaVersion !== 24) throw new Error('unsupported_persistence_version');
  exactKeys(state.rule, ['id', 'version'], 'persistence_rule');
  const id = state.schemaVersion === 23 ? 'yi-06:replay' : 'yi-new-plan:replay';
  if (state.rule.id !== id) throw new Error('unsupported_persistence_version');
  if (state.rule.version === 1) return { ruleVersion: 1 as const, replay: await replayState(value) };
  if (state.rule.version === 2) return { ruleVersion: 2 as const, replay: await replayStateRule2(value) };
  throw new Error('unsupported_persistence_version');
}
/** Full integrity only. No source/Workspace/handle or issuance qualification escapes. */
export async function decodeStateJson(raw: string) {
  const result = await replayVersioned(parse(raw));
  return validated(raw, result.replay.state, result.ruleVersion === 1 ? migrationRequired() : { kind: 'coverage-unestablished' });
}

export type DecodedAuthority =
  | (ContentValidated<AuthorityRecord> & { authorityKind: 'legacy' })
  | (ContentValidated<AuthorityV2> & { authorityKind: 'v2' });
/** A submitted record's checkpoint is a consistency witness, never host trust. */
export async function decodeAuthorityJson(raw: string): Promise<DecodedAuthority> {
  const value = parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('authority_shape');
  const record = value as Record<string, unknown>, v2 = Object.hasOwn(record, 'authorityVersion') || Object.hasOwn(record, 'format') || Object.hasOwn(record, 'reservationCoverage');
  exactKeys(record, ['raw', 'revision', 'committed', 'issuedIds', ...(v2 ? ['format', 'authorityVersion', 'reservationCoverage'] : [])], 'authority');
  if (v2 && (record.format !== AUTHORITY_FORMAT || record.authorityVersion !== AUTHORITY_VERSION)) throw new Error('unsupported_authority_version');
  const coverage = v2 ? decodeReservationCoverage(record.reservationCoverage) : undefined;
  if (!(record.raw === null || typeof record.raw === 'string') || !Number.isSafeInteger(record.revision) || (record.revision as number) < 0
    || !Array.isArray(record.committed) || record.committed.some(id => !sha256(id)) || new Set(record.committed).size !== record.committed.length) throw new Error('authority_corrupt');
  validateReservations(record.issuedIds);
  const issuedIds = record.issuedIds;
  if (record.revision === 0 ? record.raw !== null || record.committed.length !== 0 || record.issuedIds.length !== 0
    : record.raw === null || record.committed.length === 0) throw new Error('authority_corrupt');
  if (record.raw !== null) {
    const result = await replayVersioned(parse(record.raw));
    if (result.ruleVersion !== (v2 ? 2 : 1)) throw new Error('authority_rule_mismatch');
    if (!record.committed.includes(await backupDigest(result.replay.state))) throw new Error('authority_checkpoint_missing');
    if (v2) requireRule2Reservations(record.issuedIds, result.replay.requiredReservations);
    // Preserve the old checkpoint read contract (not all old R1 was persisted).
    else if (result.replay.state.history.issuedIds.some(id => !issuedIds.includes(id))) throw new Error('issuance_history_missing');
  }
  if (coverage) return freeze({ ...validated(raw, record as unknown as AuthorityV2, disposition(coverage)), authorityKind: 'v2' });
  return freeze({ ...validated(raw, record as unknown as AuthorityRecord, migrationRequired()), authorityKind: 'legacy' });
}

type LegacyBackup = (Omit<AttemptBackup, 'backupVersion' | 'reservedIds'> & { backupVersion: 1 })
  | AttemptBackup | NewPlanBackup;
export type DecodedBackup =
  | (ContentValidated<LegacyBackup> & { backupKind: 'legacy'; hostCheckpoint: 'required' | 'adoption-required' })
  | (ContentValidated<AttemptBackupV4> & { backupKind: 'v4'; hostCheckpoint: 'adoption-required' });
/** Closed envelope + digest + full ordered replay + complete reservations.
 * v1 still needs a trusted host checkpoint, unavailable to this pure decoder. */
export async function decodeBackupJson(raw: string): Promise<DecodedBackup> {
  const value = parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('backup_shape');
  const backup = value as Record<string, unknown>, version = backup.backupVersion;
  if (backup.format !== BACKUP_FORMAT || ![1, 2, 3, RULE2_BACKUP_VERSION].includes(version as number)) throw new Error('unsupported_backup');
  const v4 = version === RULE2_BACKUP_VERSION;
  exactKeys(backup, ['format', 'backupVersion', 'createdAt', 'state', 'sha256', ...(version !== 1 ? ['reservedIds'] : []), ...(v4 ? ['reservationCoverage'] : [])], 'backup');
  const coverage = v4 ? decodeReservationCoverage(backup.reservationCoverage) : undefined;
  if (typeof backup.createdAt !== 'string' || !Number.isFinite(Date.parse(backup.createdAt)) || new Date(backup.createdAt).toISOString() !== backup.createdAt) throw new Error('backup_date');
  const { sha256: digest, ...body } = backup;
  if (!sha256(digest) || digest !== await backupDigest(body)) throw new Error('backup_digest');
  const state = backup.state as { schemaVersion?: unknown; rule?: { version?: unknown } } | null;
  if (!state || (!v4 && state.schemaVersion !== (version === 3 ? 24 : 23))
    || state.rule?.version !== (v4 ? 2 : 1)) throw new Error('backup_source_version_mismatch');
  const result = await replayVersioned(state);
  if (v4) {
    requireRule2Reservations(backup.reservedIds, result.replay.requiredReservations);
    return freeze({ ...validated(raw, backup as unknown as AttemptBackupV4, disposition(coverage!)), backupKind: 'v4', hostCheckpoint: 'adoption-required' });
  }
  if (version !== 1) requireReservations(backup.reservedIds, result.replay.requiredReservations);
  return freeze({ ...validated(raw, backup as unknown as LegacyBackup, migrationRequired()), backupKind: 'legacy', hostCheckpoint: version === 1 ? 'required' : 'adoption-required' });
}
