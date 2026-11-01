import type { PersistenceSource } from './contracts';
import { pointer, type IdAssignments, type SourceArchive } from '../migration/contracts';
import type { Command, Workspace } from '../workbench/operations';
import { sameAttemptData } from '../validation';
import { idTail, referencedUuids, sourceUuids, validateReservations } from './identity';
import { analyzeCommandIdentities, advanceCommandIdentities, identityOccurrence, recordIdentities, type IdentityOccurrence } from './commandIdentities';

export const assignmentRestrictions = (table: IdAssignments): string[] => [
  ...table.reservedIds, ...table.attempts.flatMap(a => [a.attemptId, a.operationId]), ...table.records.map(r => r.recordId),
];
/** Rule2 only. Restriction aliases are explicit references; declarations must
 * prove role + original row. Never use tail dedup to validate declarations. */
export class CanonicalReservations {
  private restrictions = new Map<string, string>();
  private declarations = new Map<string, { key: string; occurrence: IdentityOccurrence }>();
  declare(o: IdentityOccurrence, original: string): void {
    if (!o.uuidTail) return; // inherited non-UUID identity stays verbatim
    const previous = this.declarations.get(o.uuidTail);
    if (previous && (previous.key !== original || previous.occurrence.canonicalId !== o.canonicalId || previous.occurrence.role !== o.role)) throw new Error('identity_declaration_collision');
    this.declarations.set(o.uuidTail, { key: original, occurrence: o });
  }
  restrict(ids: readonly string[]): void {
    for (const id of ids) {
      validateReservations([id]);
      const tail = idTail(id), previous = this.restrictions.get(tail);
      if (previous && previous !== id) throw new Error('reservation_canonical_mismatch');
      this.restrictions.set(tail, id);
    }
  }
  references(ids: Iterable<string>): void {
    for (const id of ids) if (!this.restrictions.has(idTail(id))) this.restrict([idTail(id)]);
  }
  values(): string[] { return [...this.restrictions.values()]; }
}
/** Full canonical coverage check, separate from rule1 requireReservations. */
export function requireRule2Reservations(reserved: unknown, required: string[]): asserts reserved is string[] {
  validateReservations(reserved); const canonical = new CanonicalReservations(); canonical.restrict(reserved); canonical.restrict(required);
  if (required.some(id => !reserved.includes(id))) throw new Error('backup_reservations_missing');
}
function declareSource(registry: CanonicalReservations, source: SourceArchive): void {
  // These are declarations in the original state, unlike catalog/reference UUIDs.
  // Correction chains may repeat the same original path, role and identifier.
  const catalogReferences = referencedUuids([source.sourceCatalog, source.context.catalog]);
  const walk = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const next = `${path}/${pointer(key)}`;
      if (key === 'id' && typeof child === 'string') {
        const role = path.startsWith('/mediaSchoolingProgress/') && path.includes('/assessments/') ? 'assessment' : path.startsWith('/todos/') ? 'todo' : 'reference';
        const o = identityOccurrence(child, role, next);
        if (o.uuidTail && catalogReferences.has(o.uuidTail)) throw new Error('source_identity_reference_collision');
        registry.declare(o, `source:${next}`);
      } else walk(child, next);
    }
  };
  walk(source.state, '');
}
export type IdentityFoldSeed = { source: PersistenceSource; initial: Workspace; tables?: readonly IdAssignments[]; previousSources?: readonly SourceArchive[] };
/** Sole H2/R2 model. Call only with independently decoded sources/validated tables.
 * Each command is applied once in receipt order; every collision check uses Wbefore. */
export function foldCommandIdentities(seed: IdentityFoldSeed, commands: readonly Command[], structuralValues: unknown = []) {
  const { source, initial } = seed, previous = seed.previousSources ?? [], tables = seed.tables ?? [];
  const canonical = new CanonicalReservations();
  for (const s of [...previous, ...(source.kind === 'new-plan' ? [] : [source])]) declareSource(canonical, s);
  const occupied = new Set([...sourceUuids(source), ...previous.flatMap(s => [...sourceUuids(s)])]);
  const history = new CanonicalReservations();
  for (const table of tables) {
    // Actual assignment declarations must be fresh against ALL source epochs.
    const declarations = [...table.attempts.flatMap(a => [identityOccurrence(a.attemptId, 'attempt', a.key), identityOccurrence(a.operationId, 'operation', a.key)]),
      ...table.records.map(r => identityOccurrence(r.recordId, 'owned', r.key, r.recordId))];
    for (const o of declarations) {
      if (occupied.has(o.uuidTail!)) throw new Error('assignment_uuid_collision');
      canonical.declare(o, `assignment:${o.canonicalId}`);
    }
    history.restrict(assignmentRestrictions(table));
    for (const id of assignmentRestrictions(table)) occupied.add(idTail(id));
  }
  // Initial payload identities are source references, not fresh issuance events.
  // Validate their declaration correspondence through the source/table mapping.
  for (const r of initial.graph.ownedRecords) {
    for (const o of recordIdentities(r, '/initial').slice(1)) {
      if (source.kind === 'new-plan') throw new Error('new_plan_initial_identity');
      const slot = tables.at(-1)?.records.find(slot => slot.recordId === r.id);
      if (!slot) throw new Error('initial_identity_unproven');
      const path = o.role === 'todo' ? `${slot.key}/id` : `${slot.key}/assessments/${r.kind === 'media' ? r.payload.assessments.findIndex(a => a.id === o.canonicalId) : -1}/id`;
      canonical.declare(o, `source:${path}`);
    }
  }
  let workspace = initial;
  const events: ReturnType<typeof analyzeCommandIdentities>[] = [];
  for (const command of commands) {
    const step = advanceCommandIdentities(workspace, command, source.context, occupied);
    if (step.status === 'invalid-transition') throw step.error;
    const { workspace: next, delta, ids } = step;
    for (const o of delta.introduced) canonical.declare(o, `receipt:${command.operationId}:${o.path}`);
    history.restrict(ids); events.push(delta); workspace = next;
  }
  // Initial TODO chronology is appended after receipts, with first canonical use.
  history.restrict(workspace.usedTodoIds);
  canonical.restrict(history.values());
  canonical.references(sourceUuids(source));
  for (const s of previous) canonical.references(sourceUuids(s));
  canonical.references(referencedUuids([structuralValues, workspace]));
  return { workspace, events, issuedIds: history.values(), requiredReservations: canonical.values() };
}
export function requireFoldWorkspace(actual: Workspace, expected: Workspace): void {
  if (!sameAttemptData(actual, expected)) throw new Error('identity_workspace_mismatch');
}
