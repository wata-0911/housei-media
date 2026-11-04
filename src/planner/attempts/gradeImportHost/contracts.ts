import type { Allocation, Decision, Selection } from '../gradeImport/adoption';
import type { DeepReadonly } from '../gradeImport/sourceArchive';

/** Separate host format, not a schema/backup/authority version or N/B/A/U allocation. */
export const FORMAT = 'hosei-grade-import-host' as const;
export const LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, grants: 128, ids: 20_000 });
export const DATABASE = 'hosei-yi06-isolated-v1';
export const STORE = 'authority';
export const KEY = 'current';
export const POLICY = Object.freeze({ host: 'g03-native-one-row/v1', pure: '0.1.0-prototype',
  ids: 'g03-role-uuid/v1', serializer: 'json-string-floor/v1', limits: LIMITS });
export type Environment = { origin: string; database: typeof DATABASE; store: typeof STORE; key: typeof KEY; policy: typeof POLICY };
export type Grant = { intentId: string; ids: string[]; selection: Selection; allocation: Allocation;
  archiveSha256: string; previewSha256: string; ledgerSha256: string; floorSha256: string; environment: Environment };
export type Receipt = { grantId: string; decision: Decision; archiveSha256: string; previewSha256: string;
  binding: unknown; beforeLedgerEntries: number; beforeLedgerSha256: string; floorSha256: string;
  operations: { operationId: string; payloadSha256: string }[]; afterLedgerSha256: string };
export type Outcome = { receiptSha256: string; operationIds: string[]; ledgerEntries: number; ledgerSha256: string; sequence: number };
export type EventBody = { kind: 'reserve'; grant: Grant } | { kind: 'adopt'; receipt: Receipt };
export type HostEvent = { sequence: number; previousSha256: string | null; body: EventBody; eventSha256: string };
export type HostRecord = { format: typeof FORMAT; hostVersion: 1; environment: Environment; hostId: string;
  events: HostEvent[]; ledgerRaw: string; receipts: Receipt[]; outcomes: Outcome[];
  authority: { generation: number; reservedIds: string[]; consumedGrantIds: string[];
    opReceipts: { operationId: string; receiptSha256: string }[]; tipSha256: string | null } };
export type FrozenRecord = DeepReadonly<HostRecord>;
export type HostFailure = 'input_type' | 'invalid_json' | 'shape' | 'resource_limit' | 'unsupported_policy'
  | 'invalid_host' | 'id_ticket' | 'stale' | 'receipt_conflict' | 'unqualified' | 'cancelled'
  | 'session_stopped' | 'database_missing' | 'existing_database' | 'database_inventory_unavailable'
  | 'database_blocked' | 'storage_unavailable' | 'aborted' | 'outcome_unknown';
export class HostError extends Error {
  constructor(readonly code: HostFailure) { super(code); this.name = 'GradeImportHostError'; }
}
export function fail(code: HostFailure): never { throw new HostError(code); }
export type NativeRead = { exists: false } | { exists: true; value: unknown; keyExists: boolean };
/** Infrastructure port only. The controller constructs its native adapter itself. */
export type NativeStore = { read(): Promise<NativeRead>; initialize(raw: string): Promise<void>; cas(expected: string, next: string): Promise<void> };
