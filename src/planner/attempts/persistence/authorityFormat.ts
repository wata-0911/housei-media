import { exactKeys, STATE_FORMAT, type AuthorityRecord } from './contracts';
import { isAuthorityJsonTree } from './authorityData';
import { validateReservations } from './identity';
import { inspectAuthorityInput } from './jsonLexemes';

/** Cheap infrastructure format guard, not checkpoint or replay authentication.
 * G03 stores a string at the same key; never treat it (or stored null/undefined)
 * as an empty Attempt authority. Full validation remains in persistence.load. */
export function requireAttemptAuthority(value: unknown): asserts value is AuthorityRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('unsupported_authority_record');
  // Reject non-data properties, sparse/extended arrays and non-plain objects
  // before cloning or JSON serialization can hide any of their information.
  if (!isAuthorityJsonTree(value)) throw new Error('authority_corrupt');
  exactKeys(value, ['raw', 'revision', 'committed', 'issuedIds'], 'authority');
  const v = value as AuthorityRecord;
  if (!Number.isSafeInteger(v.revision) || v.revision < 0 || !Array.isArray(v.committed) || !Array.isArray(v.issuedIds)
    || v.committed.some(s => typeof s !== 'string' || !/^[a-f0-9]{64}$/.test(s))
    || v.issuedIds.some(s => typeof s !== 'string')
    || new Set(v.committed).size !== v.committed.length || new Set(v.issuedIds).size !== v.issuedIds.length) throw new Error('authority_corrupt');
  try { validateReservations(v.issuedIds); }
  catch { throw new Error('authority_reservation_invalid'); }
  if (v.raw === null) {
    if (v.revision !== 0 || v.committed.length || v.issuedIds.length) throw new Error('authority_corrupt');
    return;
  }
  if (typeof v.raw !== 'string' || v.revision === 0 || !v.committed.length) throw new Error('authority_corrupt');
  let state: { format?: unknown; schemaVersion?: unknown } | null;
  try { inspectAuthorityInput(v.raw); state = JSON.parse(v.raw); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('unsupported_attempt_format'); throw error; }
  if (!state || state.format !== STATE_FORMAT || ![23, 24].includes(state.schemaVersion as number)) throw new Error('unsupported_attempt_format');
}
