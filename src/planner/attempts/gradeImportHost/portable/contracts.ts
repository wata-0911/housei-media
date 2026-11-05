/** Dedicated B1 contract. Neither an Attempt backup version nor a host policy. */
export const FORMAT = 'hosei-grade-import-host-backup';
export const POLICY = 'g03-full-host-snapshot/v1';
export const EXPORTER = 'g03-backup/v1';
export const LIMITS = Object.freeze({ fileBytes: 24 * 1024 * 1024, metadataBytes: 64 * 1024,
  depth: 8, containers: 128, fields: 1024, values: 4096, totalStringBytes: 23 * 1024 * 1024,
  codeUnits: 8 * 1024 * 1024, payloadChars: 22_369_624 });
export type Summary = { hostVersion: 1 | 2; hostId: string; origin: string;
  baseProvenance: 'native-v1-upgrade' | 'native-v2-empty' | null; verifierId: string;
  authorityGeneration: number; eventTipSha256: string | null; ledgerRawSha256: string;
  reservationsSha256: string; floorSha256: string; grantCount: number; receiptCount: number; operationCount: number };
export type Backup = { format: typeof FORMAT; backupVersion: 1; policy: typeof POLICY; createdAt: string;
  producer: { repository: 'wata-0911/housei-media'; revision: string; exporter: typeof EXPORTER };
  record: { encoding: 'js-utf16le-base64/v1'; codeUnits: number; byteLength: number; sha256: string; payload: string };
  summary: Summary; integrity: { algorithm: 'sha256-canonical-json/v1'; sha256: string } };
export type Failure = 'input_type' | 'resource_limit' | 'invalid_json' | 'invalid_utf8' | 'shape'
  | 'unsupported_backup' | 'invalid_encoding' | 'backup_mismatch' | 'confirmation_required'
  | 'legacy_storage' | 'no_host' | 'revision_unavailable';
export class BackupError extends Error {
  constructor(readonly code: Failure) { super(code); this.name = 'GradeImportBackupError'; }
}
export function fail(code: Failure): never { throw new BackupError(code); }
