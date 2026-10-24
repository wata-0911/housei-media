import type { EvidenceSubmission } from './evidenceTypes';

/** Untrusted submissions enter only as primitive JSON text. No coercion,
 * stringify, reviver, reflection or clone of caller-owned submission objects.
 * Browser reflection cannot generally prove absence of Proxy/internal slots. */
export function snapshotEvidenceSubmissions(value: unknown): EvidenceSubmission[] {
  const invalid = (): never => { throw new Error('non_json_submission'); };
  if (typeof value !== 'string') return invalid();
  const parsed: unknown = JSON.parse(value);
  const recordKeys = ['attemptId', 'kind', 'sourceRefs', 'sourceRevisionId'];
  function descriptors(v: unknown, array: boolean): Record<string, PropertyDescriptor> {
    if (!v || typeof v !== 'object' || Array.isArray(v) !== array) return invalid();
    const result: Record<string, PropertyDescriptor> = Object.create(null);
    for (const key of Reflect.ownKeys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== 'string' || !d || !('value' in d) || (!d.enumerable && !(array && key === 'length'))) return invalid();
      Object.defineProperty(result, key, { value: d, enumerable: true });
    }
    return result;
  }
  function array<T>(v: unknown, element: (value: unknown) => T): T[] {
    const d = descriptors(v, true), keys = Object.keys(d), length = d.length?.value;
    if (!Number.isInteger(length) || length < 0 || length > 0xffffffff || keys.length !== length + 1
      || keys.some(k => k !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= length))) return invalid();
    // Length/key checks precede allocation; even a huge sparse input is rejected.
    return Array.from({ length }, (_, i) => element(d[String(i)].value));
  }
  function string(v: unknown): string { return typeof v === 'string' ? v : invalid(); }
  return array(parsed, entry => {
    const d = descriptors(entry, false);
    if (Object.keys(d).sort().join(',') !== recordKeys.join(',')) return invalid();
    return { attemptId: string(d.attemptId.value), kind: string(d.kind.value),
      sourceRevisionId: string(d.sourceRevisionId.value), sourceRefs: array(d.sourceRefs.value, string) };
  });
}
