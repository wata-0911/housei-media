import { sameAttemptData } from '../validation';
import { bindingFor, freeze, pointer, type AttemptSlot, type RecordSlot, type IdAssignments, type SourceArchive } from './contracts';
import { requireDecoded } from './source';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function sourceSlots(source: SourceArchive): { attempts: AttemptSlot[]; records: RecordSlot[] } {
  const s = source.state;
  const attempts: AttemptSlot[] = s.items.map((item, itemIndex) => ({ key: `item:${item.offeringId}`, offeringId: item.offeringId, itemIndex }));
  const records: RecordSlot[] = [];
  for (const [collection, kind] of [['mediaSchoolingProgress', 'media'], ['correspondenceProgress', 'correspondence'], ['courseEvaluations', 'evaluation']] as const) {
    for (const [key, payload] of Object.entries(s[collection])) {
      if (key !== payload.offeringId) throw new Error('owner_key_conflict');
      records.push({ key: `/${collection}/${pointer(key)}`, kind, sourceCollection: collection, sourceKey: key, offeringId: payload.offeringId });
    }
  }
  s.todos.forEach((todo, i) => records.push({ key: `/todos/${i}`, kind: 'todo', sourceCollection: 'todos', sourceKey: String(i), offeringId: todo.offeringId }));
  const seen = new Set(attempts.map(a => a.offeringId));
  for (const record of records) {
    if (record.offeringId !== null && !seen.has(record.offeringId)) {
      seen.add(record.offeringId);
      attempts.push({ key: `orphan:${record.offeringId}`, offeringId: record.offeringId, itemIndex: null });
    }
  }
  return { attempts, records };
}
function occupiedUuids(source: SourceArchive, reservedIds: readonly string[]): Set<string> {
  const result = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') { const tail = value.split(':').at(-1)!; if (uuid.test(tail)) result.add(tail); }
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { visit(key); visit(child); }
  };
  visit(source.state); visit(source.sourceCatalog); visit(source.context.catalog); visit(reservedIds);
  return result;
}

const issued = new WeakSet<object>();

/** Structural checks ONLY. This does not grant issuance trust or register a handle.
 * YI-06 uses this for integrity replay. Its controller separately requires a
 * local checkpoint or explicit adoption of a fully validated portable backup. */
export function checkMigrationAssignmentStructure(source: SourceArchive, table: IdAssignments, reservedIds: readonly string[] = []): void {
  requireDecoded(source);
  const slots = sourceSlots(source);
  if (!sameAttemptData(Object.keys(table).sort(), ['attempts', 'binding', 'records', 'reservedIds'])
    || !sameAttemptData(table.binding, bindingFor(source)) || !sameAttemptData(table.reservedIds, reservedIds)
    || !Array.isArray(table.attempts) || !Array.isArray(table.records)) throw new Error('assignment_binding');
  const attempts = table.attempts.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'attemptId' && key !== 'operationId')));
  const records = table.records.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'recordId')));
  if (!sameAttemptData(attempts, slots.attempts) || !sameAttemptData(records, slots.records)) throw new Error('assignment_coverage');
  const occupied = occupiedUuids(source, reservedIds);
  const check = (id: string, prefix: string) => {
    if (typeof id !== 'string' || !id.startsWith(prefix) || !uuid.test(id.slice(prefix.length))) throw new Error('assignment_id_format');
    const bare = id.slice(prefix.length);
    if (occupied.has(bare)) throw new Error('assignment_uuid_collision');
    occupied.add(bare);
  };
  table.attempts.forEach(a => { check(a.attemptId, 'hosei:attempt:'); check(a.operationId, 'hosei:attempt-op:'); });
  table.records.forEach(r => check(r.recordId, 'hosei:owned:'));
}

/** Only this session's immutable issued table is accepted. A JSON copy is not an
 * issuance receipt. YI-06 reload/portable recovery has a separate trust boundary. */
export function validateMigrationAssignments(source: SourceArchive, table: IdAssignments, reservedIds: readonly string[] = []): void {
  checkMigrationAssignmentStructure(source, table, reservedIds);
  if (!issued.has(table)) throw new Error('unverified_assignment_history');
}

/** ONLY issuance boundary. Re-preview must pass the returned table (or existing).
 * Do not call without existing for a retry. No storage, clocks or derived IDs. */
export function prepareMigrationIds(source: SourceArchive, reservedIds: readonly string[] = [], existing?: IdAssignments): IdAssignments {
  requireDecoded(source);
  if (existing) { validateMigrationAssignments(source, existing, reservedIds); return existing; }
  const slots = sourceSlots(source);
  const table: IdAssignments = { binding: bindingFor(source), reservedIds: [...reservedIds],
    attempts: slots.attempts.map(slot => ({ ...slot, attemptId: `hosei:attempt:${crypto.randomUUID()}`, operationId: `hosei:attempt-op:${crypto.randomUUID()}` })),
    records: slots.records.map(slot => ({ ...slot, recordId: `hosei:owned:${crypto.randomUUID()}` })) };
  checkMigrationAssignmentStructure(source, table, reservedIds); freeze(table); issued.add(table); return table;
}
