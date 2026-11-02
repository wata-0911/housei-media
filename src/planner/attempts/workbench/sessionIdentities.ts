import { SessionIdentityAllocator, type IdentityPrefix } from '../persistence/sessionIds';
import { analyzeCommandIdentities, checkIntroducedIdentities, type IdentityRole } from '../persistence/commandIdentities';
import { referencedUuids } from '../persistence/identity';
import type { AttemptId, AttemptOperationId, OwnedRecordId } from '../types';
import type { Command, Workspace } from './operations';

export type WorkbenchIdentities = {
  newOperationId(): AttemptOperationId;
  newRecordId(): OwnedRecordId;
  newAttemptIds(): { id: AttemptId; creationOperationId: AttemptOperationId };
  newTodoId(): string;
  newAssessmentId(): string;
};
/** Trusted local ownership only, never a controller capability. No UUID factory
 * or caller reservation list is accepted by the facade. The persistence owner
 * supplies verified values; the standalone owner supplies memory-only values. */
export function createWorkbenchIdentityOwner(values: () => unknown, scope: () => unknown = () => undefined) {
  const allocator = new SessionIdentityAllocator();
  const tickets = new Map<string, { before: Set<string>; role: IdentityRole; scope: unknown; command?: Command; fingerprint?: string }>();
  function mint(prefix: IdentityPrefix, role: IdentityRole) {
    const before = allocator.snapshot(values()), occupied = new Set(before);
    const id = allocator.mint(occupied, prefix);
    tickets.set(id, { before, role, scope: scope() }); // allocator burned synchronously before returning here
    return id;
  }
  const ids: WorkbenchIdentities = Object.freeze({
    newOperationId: () => mint('hosei:attempt-op:', 'operation') as AttemptOperationId,
    newRecordId: () => mint('hosei:owned:', 'owned') as OwnedRecordId,
    newAttemptIds: () => ({ id: mint('hosei:attempt:', 'attempt') as AttemptId, creationOperationId: mint('hosei:attempt-op:', 'operation') as AttemptOperationId }),
    newTodoId: () => mint('', 'todo'),
    newAssessmentId: () => mint('', 'assessment'),
  });
  function check(workspace: Workspace, command: Command, expectedScope?: unknown) {
    const delta = analyzeCommandIdentities(workspace, command), fingerprint = JSON.stringify(command);
    // Real prestate, no graph application. A burn alone is not an introduction ticket.
    checkIntroducedIdentities(delta.introduced, referencedUuids(workspace));
    for (const occurrence of delta.introduced) {
      const ticket = tickets.get(occurrence.canonicalId);
      if (!ticket || ticket.scope !== expectedScope || ticket.role !== occurrence.role || ticket.command && (ticket.command !== command || ticket.fingerprint !== fingerprint)) throw new Error('untracked_session_identity');
      checkIntroducedIdentities([occurrence], ticket.before);
    }
    for (const occurrence of delta.introduced) Object.assign(tickets.get(occurrence.canonicalId)!, { command, fingerprint });
  }
  return { ids, check, restrict: (ids: readonly string[]) => allocator.restrict(ids),
    reservations: () => allocator.canonicalReservations() };
}
