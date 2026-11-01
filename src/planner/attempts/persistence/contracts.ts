import type { PlannerCatalog } from '../../plannerCatalog';
import type { AttemptGraph, AttemptValidationContext } from '../types';
import type { Binding, IdAssignments, MigrationTarget, RetainedState, SourceArchive } from '../migration/contracts';
import type { Command } from '../workbench/operations';

export const STATE_FORMAT = 'hosei-attempt-state';
export const STATE_VERSION = 23;
export const BACKUP_FORMAT = 'hosei-attempt-backup';
export const BACKUP_VERSION = 2;
export const NEW_BACKUP_VERSION = 3;
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
// schema23 remains migration-only. New plans use an explicitly different schema.
export const NEW_STATE_VERSION = 24;
export const NEW_PERSISTENCE_RULE = { id: 'yi-new-plan:replay', version: 1 } as const;
export type NewPlanEvidence = {
  origin: 'new-plan'; initializationVersion: 1;
  curriculumVersionId: string; sourceRevisionId: string; sourceDigest: string; masterSha256: string;
};
export type NewPlanSource = { kind: 'new-plan'; evidence: NewPlanEvidence; context: AttemptValidationContext };
export type PersistenceSource = SourceArchive | NewPlanSource;
export type NewPlanRetained = {
  importedCourseAchievements: []; importedStudyRecords: [];
  applicability: 'unknown'; scopeId: null; graduationEvaluation: 'not_evaluated';
  graduationCheckComplete: false; sourceLinksReverified: false;
};
export type AttemptState24 = {
  format: typeof STATE_FORMAT; schemaVersion: typeof NEW_STATE_VERSION; rule: typeof NEW_PERSISTENCE_RULE;
  source: NewPlanEvidence; graph: AttemptGraph; retained: NewPlanRetained;
  history: AttemptState23['history'];
  verification: { graphSha256: string; retainedSha256: string };
};
export type AttemptState = AttemptState23 | AttemptState24;
export type AttemptBackup = {
  format: typeof BACKUP_FORMAT; backupVersion: typeof BACKUP_VERSION; createdAt: string;
  state: AttemptState23; reservedIds: string[]; sha256: string;
};
export type NewPlanBackup = Omit<AttemptBackup, 'backupVersion' | 'state'> & { backupVersion: typeof NEW_BACKUP_VERSION; state: AttemptState24 };
// The host checkpoint registry is never imported. Validated backup reservations
// may only add restrictions after explicit adoption; a file hash is not authority.
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

// Pure rule2 codecs are opt-in. Existing controller/backup types remain rule1.
export const PERSISTENCE_RULE2 = { id: 'yi-06:replay', version: 2 } as const;
export const NEW_PERSISTENCE_RULE2 = { id: 'yi-new-plan:replay', version: 2 } as const;
export type AttemptState23Rule2 = Omit<AttemptState23, 'rule'> & { rule: typeof PERSISTENCE_RULE2 };
export type AttemptState24Rule2 = Omit<AttemptState24, 'rule'> & { rule: typeof NEW_PERSISTENCE_RULE2 };
export type AttemptStateRule2 = AttemptState23Rule2 | AttemptState24Rule2;
