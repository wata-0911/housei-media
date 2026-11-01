import type { AuthorityRecord, AttemptStateRule2 } from './contracts';

// Additive contracts only. The existing controller/store still use rule1 types.
export const AUTHORITY_FORMAT = 'hosei-attempt-authority';
export const AUTHORITY_VERSION = 2;
export const RULE2_BACKUP_VERSION = 4;
export type ReservationCoverage =
  | { policyVersion: 2; kind: 'native-v2'; baselineStateSha256: null }
  | { policyVersion: 2; kind: 'legacy-unproven'; baselineStateSha256: string };
export type AuthorityV2 = AuthorityRecord & {
  format: typeof AUTHORITY_FORMAT; authorityVersion: typeof AUTHORITY_VERSION;
  reservationCoverage: ReservationCoverage;
};
export type AttemptBackupV4 = {
  format: 'hosei-attempt-backup'; backupVersion: typeof RULE2_BACKUP_VERSION;
  createdAt: string; state: AttemptStateRule2; reservedIds: string[];
  reservationCoverage: ReservationCoverage; sha256: string;
};

// Content validation, migration, coverage and host authorization are different
// states. In particular, a native declaration in a file is still unadopted.
export type UnqualifiedDisposition =
  | { kind: 'coverage-unestablished' }
  | { kind: 'explicit-migration-required' }
  | { kind: 'legacy-unproven'; baselineStateSha256: string }
  | { kind: 'native-v2-unadopted' };
export type ContentValidated<T> = Readonly<{
  verification: 'content-validated'; raw: string; value: T;
  disposition: UnqualifiedDisposition; saveAuthority: 'not-issued';
}>;
// Type-only future host capability. This PR has no issuer or runtime constructor.
declare const normalSaveAuthority: unique symbol;
export type NativeSaveAuthority = Readonly<{
  kind: 'native-v2-save-authorized'; readonly [normalSaveAuthority]: true;
}>;
