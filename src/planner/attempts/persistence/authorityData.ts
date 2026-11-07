import { sameAttemptData } from '../validation';

/** JSON diagnostics cannot preserve structured-clone object identity. Reject
 * both cycles and sibling aliases without changing the historical comparator. */
export function isAuthorityJsonTree(value: unknown): boolean {
  const seen = new Set<object>(), pending: unknown[] = [value];
  // Reject graph sharing BEFORE the historical tree comparator can revisit
  // every path in a DAG. Descriptors avoid invoking getters or normalizing data.
  try {
    while (pending.length) {
      const node = pending.pop();
      if (!node || typeof node !== 'object') continue;
      // Reject known non-JSON types BEFORE ownKeys can enumerate millions of
      // TypedArray indexes. Match the unchanged historical prototype policy.
      const prototype = Object.getPrototypeOf(node);
      if (Array.isArray(node) ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null) return false;
      if (seen.has(node)) return false;
      seen.add(node);
      for (const key of Reflect.ownKeys(node)) {
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor || !('value' in descriptor)) return false;
        pending.push(descriptor.value);
      }
    }
  } catch { return false; }
  return sameAttemptData(value, value);
}
