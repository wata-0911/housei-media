import { sameAttemptData } from '../validation';
/** Compare the entire record, including closed key shape and coverage. This is
 * synchronous so it may run inside a live IndexedDB transaction. */
export function sameAuthoritySnapshot(current: unknown, expected: unknown): boolean {
  return sameAttemptData(current, expected);
}
