import type { EvidenceSubmission } from './evidenceTypes';

/** Read each descriptor once into owned plain data. Later reflection traps may
 * mutate caller objects, but cannot change values already captured here.
 * No original object is passed to structuredClone, JSON.stringify or a getter.
 * Proxy traps can still run during reflection; this does not suppress their effects. */
export function snapshotEvidenceSubmissions(value: unknown): EvidenceSubmission[] {
  const invalid = (): never => { throw new Error('non_json_submission'); };
  const recordKeys = ['attemptId', 'kind', 'sourceRefs', 'sourceRevisionId'];
  const probeKey = {};
  // These intrinsic brand checks do not read caller properties. In particular,
  // a Map with Object.prototype must not silently lose its entries in a snapshot.
  const brands: Array<(value: object) => unknown> = [
    v => Map.prototype.has.call(v, probeKey), v => Set.prototype.has.call(v, probeKey),
    v => WeakMap.prototype.has.call(v, probeKey), v => WeakSet.prototype.has.call(v, probeKey),
    v => Date.prototype.getTime.call(v), v => Number.prototype.valueOf.call(v),
    v => String.prototype.valueOf.call(v), v => Boolean.prototype.valueOf.call(v),
    v => BigInt.prototype.valueOf.call(v), v => Symbol.prototype.valueOf.call(v),
    ...[Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!,
      ...(typeof SharedArrayBuffer === 'function' ? [Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')!.get!] : []),
      Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get!].map(get => (v: object) => get.call(v)),
  ];
  function descriptors(v: unknown, array: boolean): Record<string, PropertyDescriptor> {
    if (!v || typeof v !== 'object' || Array.isArray(v) !== array) return invalid();
    const proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return invalid();
    if (!array) {
      if (ArrayBuffer.isView(v)) return invalid();
      for (const brand of brands) {
        let branded = false;
        try { brand(v); branded = true; } catch { /* Wrong built-in receiver: expected for plain data. */ }
        if (branded) return invalid();
      }
    }
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
  return array(value, entry => {
    const d = descriptors(entry, false);
    if (Object.keys(d).sort().join(',') !== recordKeys.join(',')) return invalid();
    return { attemptId: string(d.attemptId.value), kind: string(d.kind.value),
      sourceRevisionId: string(d.sourceRevisionId.value), sourceRefs: array(d.sourceRefs.value, string) };
  });
}
