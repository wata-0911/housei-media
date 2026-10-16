import type { PlannerCatalog } from '../../plannerCatalog';
import type { AttemptGraph } from '../types';
import type { Binding, IdAssignments, MigrationTarget, RetainedState, SourceArchive } from '../migration/contracts';
import type { Command } from '../workbench/operations';

export const STATE_FORMAT = 'hosei-attempt-state';
export const STATE_VERSION = 23;
export const BACKUP_FORMAT = 'hosei-attempt-backup';
export const BACKUP_VERSION = 1;
export const PERSISTENCE_RULE = { id: 'yi-06:replay', version: 1 } as const;
// Explicit evidence representation; runtime context and decoder capabilities are never serialized.
export type SourceEvidence = {
  kind: SourceArchive['kind']; schemaVersion: 22; raw: string; rawSha256: string; stateSha256: string;
  catalog: PlannerCatalog; catalogSha256: string; catalogSemanticSha256: string; catalogMetadata: unknown;
  rawFiles: Record<string, string>; rawFileSha256: Record<string, string>; compatibilityVersion: 1;
};
export type CorrectionEvidence = {
  originalRaw: string; proposedRaw: string; offeringId: string; assessmentId: string;
  oldDate: string; newDate: string | null; originalAssignments: IdAssignments;
};
export type AttemptState23 = {
  format: typeof STATE_FORMAT; schemaVersion: typeof STATE_VERSION;
  rule: typeof PERSISTENCE_RULE; binding: Binding;
  source: SourceEvidence; corrections: CorrectionEvidence[];
  catalog: PlannerCatalog; catalogSha256: string;
  assignments: IdAssignments; ledger: MigrationTarget['ledger'];
  graph: AttemptGraph; retained: RetainedState;
  history: { commands: Command[]; issuedIds: string[]; usedTodoIds: string[] };
  verification: { sourceRoundTrip: true; graphSha256: string; retainedSha256: string; masterSha256: string };
};
export type AttemptBackup = {
  format: typeof BACKUP_FORMAT; backupVersion: typeof BACKUP_VERSION; createdAt: string;
  state: AttemptState23; sha256: string;
};
// This is PRIVATE host metadata, never an importable backup/state format. The
// database is the trust boundary, not a hash claimed by an input JSON file.
export type AuthorityRecord = { raw: string | null; revision: number; committed: string[]; issuedIds: string[] };
export type ReadSnapshot = AuthorityRecord;
export interface AtomicAttemptStore {
  read(): Promise<ReadSnapshot>;
  // One atomic transaction compares both raw and authority revision, then writes
  // the state and its witness together. On failure neither changes.
  commit(expected: ReadSnapshot, next: AuthorityRecord): Promise<void>;
}
export const emptyAuthority = (): AuthorityRecord => ({ raw: null, revision: 0, committed: [], issuedIds: [] });
export function exactKeys(value: unknown, keys: readonly string[], name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(`${name}_shape`);
}
