import type { PlannerCatalog, PlannerState } from '../../plannerCatalog';
import type { AttemptGraph, AttemptValidationContext } from '../types';

export const RULE = { id: 'yi-04:state22-attempt', version: 1 } as const;
export type Diagnostic = { code: string; path: string; message: string; original?: unknown };
export type SourceArchive = {
  kind: 'local-v22' | 'backup-v1' | 'backup-v2';
  raw: string; rawSha256: string; stateSha256: string;
  state: PlannerState; sourceCatalog: PlannerCatalog; sourceCatalogSha256: string;
  sourceCatalogSemanticSha256: string; catalogMetadata: unknown;
  rawFiles: Record<string, string>; rawFileSha256: Record<string, string>;
  compatibilityVersion: 1; rule: typeof RULE;
  context: AttemptValidationContext;
};
export type DecodeResult =
  | { status: 'decoded'; source: SourceArchive; diagnostics: [] }
  | { status: 'held' | 'rejected'; raw: string; diagnostics: Diagnostic[] };
export type Binding = {
  rawSha256: string; stateSha256: string; sourceCatalogSha256: string;
  sourceKind: SourceArchive['kind']; rule: typeof RULE;
};
export type AttemptSlot = { key: string; offeringId: string; itemIndex: number | null };
export type RecordSlot = {
  key: string; kind: 'media' | 'correspondence' | 'evaluation' | 'todo';
  sourceCollection: 'mediaSchoolingProgress' | 'correspondenceProgress' | 'courseEvaluations' | 'todos';
  sourceKey: string; offeringId: string | null;
};
export type IdAssignments = {
  binding: Binding; reservedIds: string[];
  attempts: (AttemptSlot & { attemptId: `hosei:attempt:${string}`; operationId: `hosei:attempt-op:${string}` })[];
  records: (RecordSlot & { recordId: `hosei:owned:${string}` })[];
};
export type RetainedState = Omit<PlannerState, 'items' | 'todos' | 'mediaSchoolingProgress' | 'correspondenceProgress' | 'courseEvaluations'>;
export type MigrationTarget = {
  binding: Binding; graph: AttemptGraph; retained: RetainedState;
  ledger: {
    attempts: IdAssignments['attempts']; records: IdAssignments['records'];
    fields: { sourcePath: string; targetPath: string }[];
  };
};
export type PreviewResult =
  | { status: 'ready'; target: MigrationTarget; diagnostics: []; checks: { fields: number; attempts: number; records: number; exactRoundTrip: true; deterministic: true } }
  | { status: 'held' | 'rejected'; candidate: MigrationTarget | null; diagnostics: Diagnostic[] };

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
export const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
export const bindingFor = (s: SourceArchive): Binding => ({ rawSha256: s.rawSha256, stateSha256: s.stateSha256,
  sourceCatalogSha256: s.sourceCatalogSha256, sourceKind: s.kind, rule: { ...RULE } });
