import { fail } from './contracts';

declare global {
  interface ImportMeta {
    readonly __G03_EXPORTER_STAMP__?: unknown;
    readonly __G03_EXPORTER_TEST__?: boolean;
  }
}

/** Compile-time literals only. No caller option, env lookup, Git, network or
 * import-time work. Unbundled imports deliberately cannot export B1. This is
 * build provenance, never authentication of an inspected backup's producer. */
export function requireExporterRevision(): string {
  const stamp = import.meta.__G03_EXPORTER_STAMP__;
  if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) return fail('revision_unavailable');
  const s = stamp as Record<string, unknown>;
  if (Object.keys(s).length !== 2 || typeof s.revision !== 'string' || !/^[a-f0-9]{40}$/.test(s.revision)) {
    return fail('revision_unavailable');
  }
  if (import.meta.__G03_EXPORTER_TEST__ === true) {
    if (s.source !== 'test-only') return fail('revision_unavailable');
  } else if (import.meta.__G03_EXPORTER_TEST__ !== false || s.source !== 'clean-git') return fail('revision_unavailable');
  return s.revision;
}
