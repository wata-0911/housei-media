import type { AttemptOwnedRecord, AttemptValidationContext } from '../types';
import { applyCommand, type Command, type Workspace } from '../workbench/operations';
import { idTail, referencedUuids, validateReservations } from './identity';

export type IdentityRole = 'operation' | 'attempt' | 'owned' | 'todo' | 'assessment' | 'reference';
export type IdentityOccurrence = { canonicalId: string; uuidTail?: string; role: IdentityRole; recordId?: string; path: string };
const prefixes = { operation: 'hosei:attempt-op:', attempt: 'hosei:attempt:', owned: 'hosei:owned:', todo: '', assessment: '' };
const bare = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function identityOccurrence(canonicalId: string, role: IdentityRole, path: string, recordId?: string): IdentityOccurrence {
  return { canonicalId, role, path, ...(recordId === undefined ? {} : { recordId }),
    ...(typeof canonicalId === 'string' && bare.test(idTail(canonicalId)) ? { uuidTail: idTail(canonicalId) } : {}) };
}
export function recordIdentities(record: AttemptOwnedRecord, path: string): IdentityOccurrence[] {
  const owned = identityOccurrence(record.id, 'owned', `${path}/id`, record.id);
  switch (record.kind) {
    case 'media': return [owned, ...record.payload.assessments.map((a, i) => identityOccurrence(a.id, 'assessment', `${path}/payload/assessments/${i}/id`, record.id))];
    case 'todo': return [owned, identityOccurrence(record.payload.id, 'todo', `${path}/payload/id`, record.id)];
    case 'correspondence': case 'evaluation': return [owned];
    default: return exhaustive(record);
  }
}
function exhaustive(value: never): never { throw new Error(`unknown_identity_kind:${String(value)}`); }
/** Prestate is mandatory. A repeated row belongs to this record, never to another
 * record with the same UUID. Shape/transition validation remains applyCommand's job. */
export function analyzeCommandIdentities(before: Workspace, command: Command) {
  const introduced = [identityOccurrence(command.operationId, 'operation', '/operationId')];
  const retained: IdentityOccurrence[] = [], updated: IdentityOccurrence[] = [], historical: IdentityOccurrence[] = [];
  const references = (value: unknown, path: string) => {
    for (const id of referencedUuids(value)) retained.push(identityOccurrence(id, 'reference', path));
  };
  const record = (id: string) => {
    const r = before.graph.ownedRecords.find(r => r.id === id);
    if (!r) throw new Error('unknown_record');
    return r;
  };
  const attempt = (id: string) => {
    const a = before.graph.attempts.find(a => a.id === id);
    if (!a) throw new Error('unknown_attempt');
    return [identityOccurrence(a.id, 'attempt', '/attemptId'), identityOccurrence(a.creationOperationId, 'operation', '/creationOperationId')];
  };
  switch (command.kind) {
    case 'add':
      introduced.push(identityOccurrence(command.attempt.id, 'attempt', '/attempt/id'));
      retained.push(identityOccurrence(command.attempt.creationOperationId, 'operation', '/attempt/creationOperationId'));
      references([command.attempt.identity, command.attempt.placement, command.attempt.legacyRefs, command.attempt.plan], '/attempt/references'); break;
    case 'edit': retained.push(...attempt(command.attemptId)); updated.push(...attempt(command.attemptId).slice(0, 1)); references(command.changes, '/changes'); break;
    case 'remove': case 'undo': {
      const ids = attempt(command.attemptId); retained.push(...ids); historical.push(...ids);
      for (const r of before.graph.ownedRecords.filter(r => r.owner?.kind === 'attempt' && r.owner.attemptId === command.attemptId)) historical.push(...recordIdentities(r, '/history/record'));
      if (command.kind === 'undo') historical.push(identityOccurrence(command.removalOperationId, 'operation', '/removalOperationId'));
      break;
    }
    case 'add_record': introduced.push(...recordIdentities(command.record, '/record')); references(command.record.owner, '/record/owner'); break;
    case 'edit_payload': {
      const r = record(command.recordId), old = recordIdentities(r, '/before/record');
      retained.push(old[0]); updated.push(old[0]);
      if (r.kind === 'media') {
        const p = command.payload as Extract<AttemptOwnedRecord, { kind: 'media' }>['payload'];
        const previous = new Set(r.payload.assessments.map(a => a.id));
        for (const [i, a] of p.assessments.entries()) {
          const occurrence = identityOccurrence(a.id, 'assessment', `/payload/assessments/${i}/id`, r.id);
          if (previous.has(a.id)) { retained.push(occurrence); updated.push(occurrence); } else introduced.push(occurrence);
        }
      } else if (r.kind === 'todo') retained.push(old[1]);
      else if (r.kind !== 'correspondence' && r.kind !== 'evaluation') exhaustive(r);
      break;
    }
    case 'assign_todo': retained.push(...recordIdentities(record(command.recordId), '/record')); updated.push(retained[0]); references([command.owner, command.expectedOwner], '/owners'); break;
    case 'delete_todo': historical.push(...recordIdentities(record(command.recordId), '/record')); retained.push(...historical); break;
    default: exhaustive(command);
  }
  return { introduced, retained, updated, historical };
}
export function checkIntroducedIdentities(introduced: readonly IdentityOccurrence[], occupied: ReadonlySet<string>): string[] {
  const ids = introduced.map(o => {
    if (o.role === 'reference' || !o.uuidTail || o.canonicalId !== prefixes[o.role] + o.uuidTail) throw new Error('identity_role_or_shape');
    return o.canonicalId;
  });
  // Check before normalization: distinct roles/records with one tail must fail.
  if (new Set(ids.map(idTail)).size !== ids.length || ids.some(id => occupied.has(idTail(id)))) throw new Error('historical_id_reused');
  validateReservations(ids); return ids;
}

/** Shared ordered step for replay and trusted live batch construction. */
export function advanceCommandIdentities(before: Workspace, command: Command, context: AttemptValidationContext, occupied: Set<string>) {
  const delta = analyzeCommandIdentities(before, command);
  for (const id of referencedUuids(before)) occupied.add(id);
  const ids = checkIntroducedIdentities(delta.introduced, occupied);
  // Return only domain-transition failure as data. The trusted Worker can let
  // its qualified controller report that failure at the existing validation
  // boundary. Freshness/identity errors above are never deferred.
  let workspace: Workspace;
  try { workspace = applyCommand(before, command, context); }
  catch (error) { return { status: 'invalid-transition' as const, error }; }
  if (workspace === before) throw new Error('duplicate_receipt');
  ids.forEach(id => occupied.add(idTail(id)));
  return { status: 'applied' as const, workspace, delta, ids };
}
