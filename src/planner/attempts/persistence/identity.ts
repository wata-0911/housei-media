import type { SourceArchive } from '../migration/contracts';
import type { Command } from '../workbench/operations';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const bareUuid = new RegExp(`^${uuid}$`);
const reservation = new RegExp(`^(?:hosei:(?:attempt|attempt-op|owned):)?${uuid}$`);
export const idTail = (id: string) => id.split(':').at(-1)!;

/** References may repeat. New identities may never reuse any referenced UUID. */
export function referencedUuids(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === 'string' && bareUuid.test(idTail(v))) ids.add(idTail(v));
    else if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) { visit(key); visit(child); }
  };
  visit(value); return ids;
}
export function sourceUuids(source: SourceArchive): Set<string> {
  return new Set([...referencedUuids(source.state), ...catalogUuids(source)]);
}
export function catalogUuids(source: SourceArchive): Set<string> {
  return referencedUuids([source.sourceCatalog, source.context.catalog]);
}
/** Complete backup/commit minimum, computed only after integrity replay.
 * Replayed history includes initial assignments, every receipt, deleted TODOs,
 * unused reservations and all earlier correction assignments. Catalog/source
 * references from every decoded correction source are restrictions as well. */
export function requiredReservations(source: SourceArchive, historyIds: string[], previousSources: readonly SourceArchive[] = []): string[] {
  return unionReservations(historyIds, [...sourceUuids(source)], ...previousSources.map(previous => [...sourceUuids(previous)]));
}
export function checkSourceTodoIds(source: SourceArchive): void {
  const withoutTodoIds = { ...source.state, todos: source.state.todos.map(todo => {
    const { id, ...rest } = todo; void id; return rest;
  }) };
  const otherIds = referencedUuids([withoutTodoIds, source.sourceCatalog, source.context.catalog]);
  const todoIds = source.state.todos.map(todo => todo.id);
  if (new Set(todoIds).size !== todoIds.length || todoIds.some(id => otherIds.has(id))) throw new Error('source_todo_uuid_collision');
}
/** Reservations are restrictions, not evidence of who generated an ID. */
export function validateReservations(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !reservation.test(id))
    || new Set(value.map(idTail)).size !== value.length) throw new Error('reservation_uuid_collision_or_shape');
}
export function unionReservations(...groups: readonly string[][]): string[] {
  const ids = [...new Set(groups.flat())]; validateReservations(ids); return ids;
}
export function requireReservations(reserved: unknown, required: string[]): asserts reserved is string[] {
  validateReservations(reserved);
  unionReservations(reserved, required);
  if (required.some(id => !reserved.includes(id))) throw new Error('backup_reservations_missing');
}
export function newCommandIds(command: Command): string[] {
  return [command.operationId, ...(command.kind === 'add' ? [command.attempt.id]
    : command.kind === 'add_record' ? [command.record.id, ...(command.record.kind === 'todo' ? [command.record.payload.id] : [])] : [])];
}
export function checkFreshCommandIds(command: Command, occupied: ReadonlySet<string>): string[] {
  const ids = newCommandIds(command);
  if (ids.every(id => typeof id === 'string') && new Set(ids.map(idTail)).size !== ids.length) throw new Error('historical_id_reused');
  validateReservations(ids);
  if (ids.some(id => occupied.has(idTail(id)))) throw new Error('historical_id_reused');
  return ids;
}
