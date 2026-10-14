import type { AttemptGraph, AttemptId, AttemptOperationId, AttemptValidationContext, AttemptValidationIssue } from './types';
import { attemptValidationResult, sameAttemptData, validateAttemptGraph } from './validation';

export type AttemptPlanTransition =
  | { kind: 'delete_plan'; attemptId: AttemptId; operationId: AttemptOperationId }
  | { kind: 'undo_plan'; attemptId: AttemptId; operationId: AttemptOperationId };

/** Pure check of a PROPOSED deletion/Undo. Does not perform CRUD or apply a migration.
 * These narrow operations may only change membership and the matching removal ticket.
 * Independent edits/migration need their own explicit validation in YI-04/05. */
export function validateAttemptPlanTransition(before: unknown, after: unknown, context: AttemptValidationContext, action: AttemptPlanTransition) {
  const previousResult = validateAttemptGraph(before, context), nextResult = validateAttemptGraph(after, context);
  const issues: AttemptValidationIssue[] = [
    ...previousResult.issues.map(i => ({ ...i, path: `/before${i.path}` })),
    ...nextResult.issues.map(i => ({ ...i, path: `/after${i.path}` })),
  ];
  if (!previousResult.valid || !nextResult.valid) return attemptValidationResult(issues);
  const previous = before as AttemptGraph, next = after as AttemptGraph;
  const error = (code: string, path: string, message: string) => { issues.push({ code, path, message }); };
  const oldById = new Map(previous.attempts.map(a => [a.id, a])), newById = new Map(next.attempts.map(a => [a.id, a]));
  const oldByOperation = new Map(previous.attempts.map(a => [a.creationOperationId, a.id]));
  for (const a of next.attempts) {
    if (oldByOperation.has(a.creationOperationId) && oldByOperation.get(a.creationOperationId) !== a.id) error('attempt_id_reassigned', `/attempts/${a.id}`, 'Creation retry/Undo must preserve the allocated Attempt ID');
    if (oldById.has(a.id) && oldById.get(a.id)?.creationOperationId !== a.creationOperationId) error('creation_operation_changed', `/attempts/${a.id}`, 'Attempt creation operation is immutable');
  }
  if (oldById.size !== newById.size || [...oldById.keys()].some(id => !newById.has(id))) error('attempt_set_changed', '/attempts', 'Plan deletion/Undo must retain every Attempt owner');
  const prior = oldById.get(action.attemptId), target = newById.get(action.attemptId);
  if (!prior || !target) error('unknown_transition_attempt', '/action', 'Transition target must exist before and after');
  for (const a of previous.attempts) {
    const b = newById.get(a.id);
    if (!b) continue;
    const expected = a.id === action.attemptId
      ? { ...a, membership: action.kind === 'delete_plan'
        ? { kind: 'detached', reason: 'plan_deleted', deletionOperationId: action.operationId } : { kind: 'active' } }
      : a;
    if (!sameAttemptData(b, expected)) error('attempt_snapshot_changed', `/attempts/${a.id}`, 'Only the selected membership may change');
  }
  // Compare by immutable resource ID, so harmless registry reordering cannot reassign a payload.
  const resources = new Map(next.ownedRecords.map(r => [r.id, r]));
  if (previous.ownedRecords.length !== next.ownedRecords.length) error('owned_records_changed', '/ownedRecords', 'Plan deletion/Undo must preserve all progress, evaluation and TODO records');
  for (const r of previous.ownedRecords) {
    const n = resources.get(r.id);
    if (!n) error('owned_record_lost', `/ownedRecords/${r.id}`, 'Plan deletion cannot discard owned data');
    else if (!sameAttemptData(r.owner, n.owner)) error('owner_reassigned', `/ownedRecords/${r.id}`, 'Progress may not move to another Attempt or guessed legacy owner');
    else if (!sameAttemptData(r, n)) error('owned_payload_changed', `/ownedRecords/${r.id}`, 'Progress/TODO/evaluation must be preserved');
  }
  const oldRemovals = new Map(previous.removals.map(r => [r.operationId, r]));
  const newRemovals = new Map(next.removals.map(r => [r.operationId, r]));
  if (action.kind === 'delete_plan') {
    const ticket = newRemovals.get(action.operationId);
    if (prior?.membership.kind !== 'active' || oldRemovals.has(action.operationId)
      || !ticket || !sameAttemptData(ticket.attemptSnapshot, prior)
      || ticket.previousPosition !== previous.attempts.filter(a => a.membership.kind === 'active').findIndex(a => a.id === action.attemptId)) error('invalid_delete_ticket', '/action', 'Deletion needs the original active ID, fields and active-plan position');
    if (newRemovals.size !== oldRemovals.size + 1) error('removal_set_changed', '/removals', 'Deletion adds exactly one Undo ticket');
    for (const [id, r] of oldRemovals) if (!sameAttemptData(r, newRemovals.get(id))) error('removal_changed', `/removals/${id}`, 'Unrelated Undo tickets must be preserved');
  } else {
    const ticket = oldRemovals.get(action.operationId);
    if (prior?.membership.kind !== 'detached' || prior.membership.reason !== 'plan_deleted'
      || prior.membership.deletionOperationId !== action.operationId || !ticket || !sameAttemptData(ticket.attemptSnapshot, target)
      || next.attempts.filter(a => a.membership.kind === 'active').findIndex(a => a.id === action.attemptId) !== ticket.previousPosition) error('invalid_undo_ticket', '/action', 'Undo must restore its original Attempt, owner and active-plan position');
    if (newRemovals.has(action.operationId) || newRemovals.size !== oldRemovals.size - 1) error('removal_set_changed', '/removals', 'Undo consumes exactly its original ticket');
    for (const [id, r] of oldRemovals) if (id !== action.operationId && !sameAttemptData(r, newRemovals.get(id))) error('removal_changed', `/removals/${id}`, 'Unrelated Undo tickets must be preserved');
  }
  return attemptValidationResult(issues);
}
