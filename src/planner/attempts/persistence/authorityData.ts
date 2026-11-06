import { sameAttemptData } from '../validation';

/** JSON diagnostics cannot preserve structured-clone object identity. Reject
 * both cycles and sibling aliases without changing the historical comparator. */
export function isAuthorityJsonTree(value: unknown): boolean {
  if (!sameAttemptData(value, value)) return false;
  const seen = new Set<object>(), pending: unknown[] = [value];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) return false;
    seen.add(node);
    for (const child of Object.values(node)) pending.push(child);
  }
  return true;
}
