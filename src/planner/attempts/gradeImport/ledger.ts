import { checkDecimalRoundTrips, NumericPrecisionError } from './decimalPolicy';
import { decodeGradeSourceArchive, type GradeSourceArchive, type DeepReadonly } from './sourceArchive';
import type { HoseiGradeImportCourse, HoseiGradeImportReport, HoseiGradeImportExam, HoseiGradeImportSchooling } from '../../gradeImport/gradeImportContract';
import { parseAttemptGraphJson, AttemptJsonInputError } from '../jsonInput';
import { canonicalBackupJson as canonical, backupDigest } from '../../digest';

export const LEDGER_FORMAT = 'hosei-g01b-ledger-prototype' as const;
export const JOURNAL_FORMAT = 'hosei-g01b-journal-prototype' as const;
export const VERSION = '0.1.0-prototype' as const; // not N/B/A/U
export const LIMITS = Object.freeze({ jsonBytes: 8 * 1024 * 1024, events: 128, ids: 20000 });
export type Role = 'operation' | 'snapshot' | 'achievement' | 'observation' | 'revision'
  | 'detail' | 'detail-observation' | 'detail-revision' | 'association';
export type Id<R extends Role> = `hosei:g01b-${R}:${string}`;
export type DetailAssignment = { observationId: Id<'detail-observation'>; detailId: Id<'detail'>;
  revisionId: Id<'detail-revision'>; previousRevisionId: Id<'detail-revision'> | null };
export type RowAssignment = { observationId: Id<'observation'>; achievementId: Id<'achievement'>;
  revisionId: Id<'revision'>; previousRevisionId: Id<'revision'> | null; details: DetailAssignment[] };
type Header = { operationId: Id<'operation'>; expectedTipSha256: string | null };
export type Operation = Header & (
  | { kind: 'import_snapshot'; snapshotId: Id<'snapshot'>; archive: GradeSourceArchive; rows: RowAssignment[] }
  | { kind: 'activate_revision'; achievementId: Id<'achievement'>; revisionId: Id<'revision'>;
      expectedActiveRevisionId: Id<'revision'> | null; confirmation: { kind: 'explicit-selection'; reason: string } }
  | { kind: 'associate_unverified'; associationId: Id<'association'>; achievementId: Id<'achievement'>;
      revisionId: Id<'revision'>; attemptId: `hosei:attempt:${string}` }
);
export type Entry = { operation: Operation; previousSha256: string | null; payloadSha256: string; eventSha256: string };
export type Journal = { format: typeof JOURNAL_FORMAT; contractVersion: typeof VERSION; seedReservedIds: string[]; entries: Entry[] };
export type DetailKind = 'report' | 'credit_exam' | 'schooling';
export type View = {
  snapshots: { id: string; archive: GradeSourceArchive; rows: RowAssignment[] }[];
  observations: { id: string; snapshotId: string; rowIndex: number; detailObservationIds: string[] }[];
  achievements: { id: string; revisionIds: string[]; activeRevisionId: string | null }[];
  revisions: { id: string; achievementId: string; observationId: string; previousRevisionId: string | null; record: HoseiGradeImportCourse }[];
  detailObservations: { id: string; rowObservationId: string; kind: DetailKind; index: number }[];
  details: { id: string; achievementId: string; kind: DetailKind; index: number; revisionIds: string[] }[];
  detailRevisions: { id: string; detailId: string; observationId: string; previousRevisionId: string | null;
    record: HoseiGradeImportReport | HoseiGradeImportExam | HoseiGradeImportSchooling }[];
  associations: { id: string; achievementId: string; revisionId: string; attemptId: string; status: 'unverified' }[];
};
export type Ledger = { format: typeof LEDGER_FORMAT; contractVersion: typeof VERSION; journal: Journal;
  view: View; issuedIds: string[]; reservedIds: string[]; tipSha256: string | null };
export type IdFloor = { issuedIds: string[]; reservedIds: string[] };
export type Failure = 'numeric_precision' | 'input_type' | 'invalid_json' | 'resource_limit' | 'shape' | 'version'
  | 'id_shape' | 'id_collision' | 'operation_conflict' | 'duplicate_event' | 'stale_tip'
  | 'payload_digest' | 'event_digest' | 'snapshot_conflict' | 'snapshot_already_observed'
  | 'incomplete_snapshot' | 'revision_predecessor' | 'detail_owner' | 'reference'
  | 'stale_active' | 'state_mismatch' | 'reservation_shrink' | 'issuance_shrink' | 'floor_inconsistent';
export class LedgerError extends Error {
  constructor(readonly code: Failure) { super(code); this.name = 'LedgerError'; }
}
function fail(code: Failure): never { throw new LedgerError(code); }
function parse(input: unknown): unknown {
  if (typeof input !== 'string') fail('input_type');
  if (input.length > LIMITS.jsonBytes) fail('resource_limit');
  // Avoid replacement-byte hashing of literal lone surrogates. Escaped JSON remains exact.
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = input.charCodeAt(++i); if (!(low >= 0xdc00 && low <= 0xdfff)) fail('invalid_json');
    } else if (c >= 0xdc00 && c <= 0xdfff) fail('invalid_json');
  }
  if (new TextEncoder().encode(input).byteLength > LIMITS.jsonBytes) fail('resource_limit');
  try {
    const value = parseAttemptGraphJson(input);
    checkDecimalRoundTrips(input);
    return value;
  }
  catch (error) {
    if (error instanceof NumericPrecisionError) fail('numeric_precision');
    if (error instanceof AttemptJsonInputError) fail(error.code === 'resource_limit' ? 'resource_limit' : 'invalid_json');
    throw error;
  }
}
function keys(v: unknown, expected: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== [...expected].sort().join(',')) fail('shape');
}
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuidPattern = new RegExp(`^${uuid}$`);
// Restriction-only seed/floor IDs may use older namespaces. This never grants issuance.
const anyId = new RegExp(`^(?:[a-z][a-z0-9-]*:)*${uuid}$`);
function id<R extends Role>(value: unknown, role: R): asserts value is Id<R> {
  if (typeof value !== 'string' || !new RegExp(`^hosei:g01b-${role}:${uuid}$`).test(value)) fail('id_shape');
}
function reference(value: unknown) {
  if (typeof value !== 'string' || !new RegExp(`^hosei:attempt:${uuid}$`).test(value)) fail('id_shape');
}
function nullableId(v: unknown, role: Role) { if (v !== null) id(v, role); }
function hash(v: unknown): asserts v is string { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail('shape'); }
function tip(v: unknown) { if (v !== null) hash(v); }
function idList(v: unknown): asserts v is string[] {
  if (!Array.isArray(v) || v.length > LIMITS.ids) fail('resource_limit');
  const tails = new Set<string>();
  for (const x of v) {
    if (typeof x !== 'string' || !anyId.test(x)) fail('id_shape');
    const tail = x.split(':').at(-1)!;
    if (tails.has(tail)) fail('id_collision'); tails.add(tail);
  }
}
function freeze<T>(v: T): DeepReadonly<T> {
  if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v as DeepReadonly<T>;
}
function emptyView(): View { return { snapshots: [], observations: [], achievements: [], revisions: [], detailObservations: [], details: [], detailRevisions: [], associations: [] }; }
function budget(value: unknown) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > LIMITS.jsonBytes) fail('resource_limit');
}
async function validateOperation(value: unknown): Promise<Operation> {
  if (!value || typeof value !== 'object') fail('shape');
  const v = value as Record<string, unknown>;
  const common = ['kind', 'operationId', 'expectedTipSha256'];
  if (v.kind === 'import_snapshot') {
    keys(v, [...common, 'snapshotId', 'archive', 'rows']); id(v.snapshotId, 'snapshot');
    const archive = await decodeGradeSourceArchive(JSON.stringify(v.archive));
    if (!Array.isArray(v.rows) || v.rows.length !== archive.dto.courses.length) fail('incomplete_snapshot');
    for (const row of v.rows) {
      keys(row, ['observationId', 'achievementId', 'revisionId', 'previousRevisionId', 'details']);
      id(row.observationId, 'observation'); id(row.achievementId, 'achievement'); id(row.revisionId, 'revision'); nullableId(row.previousRevisionId, 'revision');
      if (!Array.isArray(row.details) || row.details.length !== 7) fail('incomplete_snapshot');
      for (const d of row.details) {
        keys(d, ['observationId', 'detailId', 'revisionId', 'previousRevisionId']);
        id(d.observationId, 'detail-observation'); id(d.detailId, 'detail'); id(d.revisionId, 'detail-revision'); nullableId(d.previousRevisionId, 'detail-revision');
      }
    }
  } else if (v.kind === 'activate_revision') {
    keys(v, [...common, 'achievementId', 'revisionId', 'expectedActiveRevisionId', 'confirmation']);
    id(v.achievementId, 'achievement'); id(v.revisionId, 'revision'); nullableId(v.expectedActiveRevisionId, 'revision');
    keys(v.confirmation, ['kind', 'reason']);
    if (v.confirmation.kind !== 'explicit-selection' || typeof v.confirmation.reason !== 'string' || !v.confirmation.reason.trim()) fail('shape');
  } else if (v.kind === 'associate_unverified') {
    keys(v, [...common, 'associationId', 'achievementId', 'revisionId', 'attemptId']);
    id(v.associationId, 'association'); id(v.achievementId, 'achievement'); id(v.revisionId, 'revision'); reference(v.attemptId);
  } else fail('shape');
  id(v.operationId, 'operation'); tip(v.expectedTipSha256);
  return value as Operation; // only private JSON trees, never caller objects/getters
}
function apply(view: View, op: Operation, issued: string[], reserved: string[]) {
  const declarations = new Set(reserved.map(x => x.split(':').at(-1)!));
  const declare = (newId: string) => {
    const tail = newId.split(':').at(-1)!;
    if (!uuidPattern.test(tail) || declarations.has(tail)) fail('id_collision');
    declarations.add(tail); issued.push(newId); reserved.push(newId);
    if (reserved.length > LIMITS.ids) fail('resource_limit');
  };
  declare(op.operationId);
  if (op.kind === 'import_snapshot') {
    const existing = view.snapshots.find(s => s.id === op.snapshotId);
    if (existing) {
      if (canonical(existing.archive) !== canonical(op.archive) || canonical(existing.rows) !== canonical(op.rows)) fail('snapshot_conflict');
      return; // new operation receipt only; no new observations or fact IDs
    }
    if (view.snapshots.some(s => s.archive.rawSha256 === op.archive.rawSha256)) fail('snapshot_already_observed');
    declare(op.snapshotId);
    const usedAchievements = new Set<string>();
    op.rows.forEach((row, rowIndex) => {
      // Within one snapshot, distinct source rows cannot be collapsed into one logical achievement.
      if (usedAchievements.has(row.achievementId)) fail('id_collision'); usedAchievements.add(row.achievementId);
      let achievement = view.achievements.find(a => a.id === row.achievementId);
      if (achievement) {
        if (row.previousRevisionId !== achievement.revisionIds.at(-1)) fail('revision_predecessor');
      } else {
        if (row.previousRevisionId !== null) fail('revision_predecessor');
        declare(row.achievementId); achievement = { id: row.achievementId, revisionIds: [], activeRevisionId: null }; view.achievements.push(achievement);
      }
      declare(row.observationId); declare(row.revisionId);
      const record = structuredClone(op.archive.dto.courses[rowIndex]);
      const payloads = [...record.reports, record.creditExam, ...record.schoolings];
      row.details.forEach((d, j) => {
        const kind: DetailKind = j < 4 ? 'report' : j === 4 ? 'credit_exam' : 'schooling';
        const index = j < 4 ? j : j === 4 ? 0 : j - 5;
        let detail = view.details.find(x => x.id === d.detailId);
        if (detail) {
          if (detail.achievementId !== row.achievementId || detail.kind !== kind || detail.index !== index) fail('detail_owner');
          if (d.previousRevisionId !== detail.revisionIds.at(-1)) fail('revision_predecessor');
        } else {
          if (d.previousRevisionId !== null) fail('revision_predecessor');
          declare(d.detailId); detail = { id: d.detailId, achievementId: row.achievementId, kind, index, revisionIds: [] }; view.details.push(detail);
        }
        declare(d.observationId); declare(d.revisionId);
        detail.revisionIds.push(d.revisionId);
        view.detailObservations.push({ id: d.observationId, rowObservationId: row.observationId, kind, index });
        view.detailRevisions.push({ id: d.revisionId, detailId: d.detailId, observationId: d.observationId, previousRevisionId: d.previousRevisionId, record: payloads[j] });
      });
      achievement.revisionIds.push(row.revisionId);
      view.observations.push({ id: row.observationId, snapshotId: op.snapshotId, rowIndex, detailObservationIds: row.details.map(d => d.observationId) });
      view.revisions.push({ id: row.revisionId, achievementId: row.achievementId, observationId: row.observationId, previousRevisionId: row.previousRevisionId, record });
    });
    view.snapshots.push({ id: op.snapshotId, archive: structuredClone(op.archive), rows: structuredClone(op.rows) });
  } else {
    const achievement = view.achievements.find(a => a.id === op.achievementId);
    const revision = view.revisions.find(r => r.id === op.revisionId);
    if (!achievement || !revision || revision.achievementId !== achievement.id) fail('reference');
    if (op.kind === 'activate_revision') {
      if (achievement.activeRevisionId !== op.expectedActiveRevisionId) fail('stale_active');
      achievement.activeRevisionId = revision.id;
    } else {
      declare(op.associationId);
      const tail = op.attemptId.split(':').at(-1)!;
      const canonicalReference = reserved.find(x => x.split(':').at(-1) === tail);
      if (canonicalReference && canonicalReference !== op.attemptId) fail('id_collision');
      if (!canonicalReference) reserved.push(op.attemptId); // restriction/reference, NOT issuance
      if (reserved.length > LIMITS.ids) fail('resource_limit');
      view.associations.push({ id: op.associationId, achievementId: achievement.id, revisionId: revision.id, attemptId: op.attemptId, status: 'unverified' });
    }
  }
}
function enforceFloor(state: Ledger, input: unknown) {
  if (input === undefined) return;
  const floor = parse(input); keys(floor, ['issuedIds', 'reservedIds']); idList(floor.issuedIds); idList(floor.reservedIds);
  if (floor.issuedIds.some(x => !(floor.reservedIds as string[]).includes(x))) fail('floor_inconsistent');
  if (floor.reservedIds.some(x => !state.reservedIds.includes(x))) fail('reservation_shrink');
  if (floor.issuedIds.some((x, i) => state.issuedIds[i] !== x)) fail('issuance_shrink');
}
/** Fully reconstruct every view field and ID set in receipt order. Hashes prove integrity, not issuer identity. */
export async function replayJournal(input: unknown, minimumIdsJson?: unknown): Promise<DeepReadonly<Ledger>> {
  const journal = parse(input); keys(journal, ['format', 'contractVersion', 'seedReservedIds', 'entries']);
  if (journal.format !== JOURNAL_FORMAT || journal.contractVersion !== VERSION) fail('version');
  idList(journal.seedReservedIds);
  if (!Array.isArray(journal.entries) || journal.entries.length > LIMITS.events) fail('resource_limit');
  const view = emptyView(), issuedIds: string[] = [], reservedIds = [...journal.seedReservedIds];
  const seen = new Set<string>(); let previous: string | null = null;
  for (const entry of journal.entries) {
    keys(entry, ['operation', 'previousSha256', 'payloadSha256', 'eventSha256']);
    const op = await validateOperation(entry.operation); hash(entry.payloadSha256); hash(entry.eventSha256); tip(entry.previousSha256);
    if (seen.has(op.operationId)) fail('duplicate_event'); seen.add(op.operationId);
    if (op.expectedTipSha256 !== previous || entry.previousSha256 !== previous) fail('stale_tip');
    if (await backupDigest(op) !== entry.payloadSha256) fail('payload_digest');
    if (await backupDigest({ operation: op, previousSha256: previous, payloadSha256: entry.payloadSha256 }) !== entry.eventSha256) fail('event_digest');
    apply(view, op, issuedIds, reservedIds); previous = entry.eventSha256;
  }
  const state: Ledger = { format: LEDGER_FORMAT, contractVersion: VERSION, journal: journal as Journal, view, issuedIds, reservedIds, tipSha256: previous };
  enforceFloor(state, minimumIdsJson); budget(state); return freeze(state);
}
export async function createLedger(seedReservedIdsJson: unknown = '[]'): Promise<DeepReadonly<Ledger>> {
  const seedReservedIds = parse(seedReservedIdsJson); idList(seedReservedIds);
  return replayJournal(JSON.stringify({ format: JOURNAL_FORMAT, contractVersion: VERSION, seedReservedIds, entries: [] }));
}
/** Pure whole-field oracle: compares reconstructed journal + materialization + all IDs and omissions. */
export async function verifyLedgerState(input: unknown, minimumIdsJson?: unknown): Promise<DeepReadonly<Ledger>> {
  const state = parse(input); keys(state, ['format', 'contractVersion', 'journal', 'view', 'issuedIds', 'reservedIds', 'tipSha256']);
  if (state.format !== LEDGER_FORMAT || state.contractVersion !== VERSION) fail('version');
  const expected = await replayJournal(JSON.stringify(state.journal), minimumIdsJson);
  if (canonical(state) !== canonical(expected)) fail('state_mismatch');
  return expected;
}
/** Retrying identical payload is a no-op; a distinct operation appends one immutable entry. */
export async function appendOperation(stateJson: unknown, operationJson: unknown, minimumIdsJson?: unknown): Promise<DeepReadonly<Ledger>> {
  const before = await verifyLedgerState(stateJson, minimumIdsJson);
  const op = await validateOperation(parse(operationJson));
  const old = before.journal.entries.find(e => e.operation.operationId === op.operationId);
  if (old) {
    if (canonical(old.operation) !== canonical(op)) fail('operation_conflict');
    return before;
  }
  if (op.expectedTipSha256 !== before.tipSha256) fail('stale_tip');
  const body = { operation: op, previousSha256: before.tipSha256, payloadSha256: await backupDigest(op) };
  const entry = { ...body, eventSha256: await backupDigest(body) };
  const journal = { ...before.journal, entries: [...before.journal.entries, entry] };
  return replayJournal(JSON.stringify(journal), JSON.stringify({ issuedIds: before.issuedIds, reservedIds: before.reservedIds }));
}
