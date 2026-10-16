import type { Attempt, AttemptGraph, AttemptId, AttemptOperationId, AttemptOwnedRecord, AttemptValidationContext, OwnedRecordId } from '../types';
import { sameAttemptData, validateAttemptGraph } from '../validation';
import { validateAttemptPlanTransition } from '../planTransition';
import { freeze } from '../migration/contracts';

export type AttemptEdit = Pick<Attempt, 'originalTitle' | 'plan' | 'method' | 'identity' | 'placement'>;
export type Command = { operationId: AttemptOperationId } & (
  | { kind: 'add'; attempt: Attempt }
  | { kind: 'edit'; attemptId: AttemptId; changes: Partial<AttemptEdit> }
  | { kind: 'remove'; attemptId: AttemptId }
  | { kind: 'undo'; attemptId: AttemptId; removalOperationId: AttemptOperationId }
  | { kind: 'add_record'; record: AttemptOwnedRecord }
  | { kind: 'edit_payload'; recordId: OwnedRecordId; payload: AttemptOwnedRecord['payload'] }
  | { kind: 'assign_todo'; recordId: OwnedRecordId; owner: AttemptOwnedRecord['owner']; expectedOwner: AttemptOwnedRecord['owner'] }
  | { kind: 'delete_todo'; recordId: OwnedRecordId }
);
export type Workspace = { graph: AttemptGraph; receipts: Command[]; usedTodoIds: string[] };
export const newOperationId = (): AttemptOperationId => `hosei:attempt-op:${crypto.randomUUID()}`;
export const newRecordId = (): OwnedRecordId => `hosei:owned:${crypto.randomUUID()}`;
export const newAttemptIds = () => ({ id: `hosei:attempt:${crypto.randomUUID()}` as AttemptId, creationOperationId: newOperationId() });
function requireValid(graph: unknown, context: AttemptValidationContext): asserts graph is AttemptGraph {
  const checked = validateAttemptGraph(graph, context);
  if (!checked.valid) throw new Error(checked.issues.map(i => `${i.code}: ${i.message}`).join('\n'));
}
export function createWorkspace(graph: AttemptGraph, context: AttemptValidationContext): Workspace {
  requireValid(graph, context);
  return freeze({ graph: structuredClone(graph), receipts: [], usedTodoIds: graph.ownedRecords.filter(r => r.kind === 'todo').map(r => r.payload.id) });
}
function keys(value: object, allowed: string[]) {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error('unknown_operation_field');
}
const commandKeys: Record<Command['kind'], string[]> = {
  add: ['attempt'], edit: ['attemptId', 'changes'], remove: ['attemptId'], undo: ['attemptId', 'removalOperationId'],
  add_record: ['record'], edit_payload: ['recordId', 'payload'], assign_todo: ['recordId', 'owner', 'expectedOwner'], delete_todo: ['recordId'],
};
/** Transaction over an isolated graph. No storage, Offering lookup, calculation or migration comparison.
 * Receipts preserve the ORIGINAL request even after subsequent edits/deletions. */
export function applyCommand(workspace: Workspace, input: Command, context: AttemptValidationContext): Workspace {
  const command = structuredClone(input);
  if (!commandKeys[command.kind]) throw new Error('unknown_operation');
  keys(command, ['kind', 'operationId', ...commandKeys[command.kind]]);
  if (!/^hosei:attempt-op:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(command.operationId)) throw new Error('invalid_operation_id');
  const receipt = workspace.receipts.find(r => r.operationId === command.operationId);
  if (receipt) {
    if (!sameAttemptData(receipt, command)) throw new Error('operation_replay_conflict');
    return workspace;
  }
  requireValid(workspace.graph, context);
  // All new operation IDs share the UUID collision boundary with existing entities.
  const uuid = command.operationId.split(':').at(-1)!;
  const occupied: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === 'string') occupied.push(v.split(':').at(-1)!);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(workspace); collect(context.catalog); collect(context.legacyArchive);
  if (occupied.includes(uuid)) throw new Error('operation_collision');
  const graph = structuredClone(workspace.graph);
  const findAttempt = (id: AttemptId) => {
    const a = graph.attempts.find(a => a.id === id);
    if (!a) throw new Error('unknown_attempt');
    return a;
  };
  const findRecord = (id: OwnedRecordId) => {
    const r = graph.ownedRecords.find(r => r.id === id);
    if (!r) throw new Error('unknown_record');
    return r;
  };
  switch (command.kind) {
    case 'add': {
      if (command.attempt.creationOperationId !== command.operationId || command.attempt.membership.kind !== 'active') throw new Error('invalid_creation');
      if (command.attempt.method.source !== 'learner' || command.attempt.actualYear.source !== 'unknown' || command.attempt.applicability.status !== 'unknown' || command.attempt.plan?.importedSourceCourseId) throw new Error('new_attempt_learner_only');
      if (occupied.includes(command.attempt.id.split(':').at(-1)!)) throw new Error('attempt_id_reused');
      graph.attempts.push(command.attempt); break;
    }
    case 'edit': {
      keys(command.changes, ['originalTitle', 'plan', 'method', 'identity', 'placement']);
      const a = findAttempt(command.attemptId);
      if (a.membership.kind !== 'active') throw new Error('restore_before_edit');
      // Official/legacy method contexts may only be retained or explicitly replaced by learner intent.
      if (command.changes.method && !sameAttemptData(command.changes.method, a.method)
        && command.changes.method.source !== 'learner') throw new Error('learner_method_only');
      if (command.changes.plan && command.changes.plan.importedSourceCourseId !== a.plan?.importedSourceCourseId) throw new Error('official_link_immutable');
      Object.assign(a, command.changes); break;
    }
    case 'remove': {
      const a = findAttempt(command.attemptId);
      if (a.membership.kind !== 'active') throw new Error('already_detached');
      graph.removals.push({ operationId: command.operationId, attemptSnapshot: structuredClone(a),
        previousPosition: graph.attempts.filter(a => a.membership.kind === 'active').findIndex(a => a.id === command.attemptId) });
      a.membership = { kind: 'detached', reason: 'plan_deleted', deletionOperationId: command.operationId }; break;
    }
    case 'undo': {
      const ticket = graph.removals.find(r => r.operationId === command.removalOperationId && r.attemptSnapshot.id === command.attemptId);
      if (!ticket) throw new Error('unknown_removal');
      const remaining = graph.attempts.filter(a => a.id !== command.attemptId);
      const active = remaining.filter(a => a.membership.kind === 'active');
      if (ticket.previousPosition > active.length) throw new Error('undo_position_conflict: 先に後続の削除をUndoしてください');
      const position = ticket.previousPosition === active.length ? remaining.length : remaining.findIndex(a => a.id === active[ticket.previousPosition].id);
      remaining.splice(position, 0, structuredClone(ticket.attemptSnapshot)); graph.attempts = remaining;
      graph.removals = graph.removals.filter(r => r !== ticket); break;
    }
    case 'add_record': {
      if (command.record.id.split(':').at(-1) === uuid || occupied.includes(command.record.id.split(':').at(-1)!)) throw new Error('record_id_reused');
      if (command.record.kind === 'todo' && workspace.usedTodoIds.includes(command.record.payload.id)) throw new Error('todo_id_reused');
      graph.ownedRecords.push(command.record); break;
    }
    case 'edit_payload': {
      const r = findRecord(command.recordId);
      if (r.kind === 'todo' && (!('id' in command.payload) || command.payload.id !== r.payload.id)) throw new Error('todo_id_immutable');
      // Preserve every existing nested progress row and its identifier. Reducing a count cannot discard rows.
      if (r.kind === 'media') {
        const p = command.payload as Extract<AttemptOwnedRecord, { kind: 'media' }>['payload'];
        if (!Array.isArray(p.lessons) || !Array.isArray(p.assessments)
          || r.payload.lessons.some(l => !p.lessons.some(n => n.lesson === l.lesson))
          || r.payload.assessments.some(a => !p.assessments.some(n => n.id === a.id))) throw new Error('progress_row_lost');
      }
      if (r.kind === 'correspondence') {
        const p = command.payload as Extract<AttemptOwnedRecord, { kind: 'correspondence' }>['payload'];
        if (!Array.isArray(p.reports) || r.payload.reports.some(r => !p.reports.some(n => n.reportNumber === r.reportNumber))) throw new Error('progress_row_lost');
        if (Object.hasOwn(r.payload, 'calligraphyBatchStatus') && !Object.hasOwn(p, 'calligraphyBatchStatus')) throw new Error('progress_field_lost');
      }
      r.payload = command.payload; break;
    }
    case 'assign_todo': {
      const r = findRecord(command.recordId);
      if (r.kind !== 'todo') throw new Error('todo_owner_only');
      if (!sameAttemptData(r.owner, command.expectedOwner)) throw new Error('stale_owner');
      r.owner = command.owner; break;
    }
    case 'delete_todo': {
      if (findRecord(command.recordId).kind !== 'todo') throw new Error('todo_only');
      graph.ownedRecords = graph.ownedRecords.filter(r => r.id !== command.recordId); break;
    }
  }
  requireValid(graph, context);
  if (command.kind === 'remove' || command.kind === 'undo') {
    const result = validateAttemptPlanTransition(workspace.graph, graph, context, {
      kind: command.kind === 'remove' ? 'delete_plan' : 'undo_plan', attemptId: command.attemptId,
      operationId: command.kind === 'remove' ? command.operationId : command.removalOperationId,
    });
    if (!result.valid) throw new Error(result.issues.map(i => i.code).join(', '));
  }
  return freeze({ graph, receipts: [...workspace.receipts, command], usedTodoIds: command.kind === 'add_record' && command.record.kind === 'todo' ? [...workspace.usedTodoIds, command.record.payload.id] : [...workspace.usedTodoIds] });
}
