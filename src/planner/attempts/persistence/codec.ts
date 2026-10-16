import { backupDigest } from '../../backup/plannerBackupCompatibility';
import { sameAttemptData, validateAttemptGraph } from '../validation';
import { checkMigrationAssignmentStructure, validateMigrationAssignments } from '../migration/assignments';
import { freeze, type IdAssignments, type MigrationTarget, type SourceArchive } from '../migration/contracts';
import { prepareMigrationEnvironment, decodeMigrationSource, parseMigrationJson } from '../migration/source';
import { verifyMigrationPreservation } from '../migration/preview';
import { buildMigrationTarget } from '../migration/transform';
import { applyCommand, createWorkspace, type Workspace } from '../workbench/operations';
import { STATE_FORMAT, STATE_VERSION, PERSISTENCE_RULE, exactKeys, type AttemptState23, type SourceEvidence, type CorrectionEvidence } from './contracts';
import { checkFreshCommandIds, checkSourceTodoIds, idTail, sourceUuids, unionReservations, validateReservations } from './identity';

export function sourceEvidence(source: SourceArchive): SourceEvidence {
  return structuredClone({ kind: source.kind, schemaVersion: 22, raw: source.raw, rawSha256: source.rawSha256,
    stateSha256: source.stateSha256, catalog: source.sourceCatalog, catalogSha256: source.sourceCatalogSha256,
    catalogSemanticSha256: source.sourceCatalogSemanticSha256, catalogMetadata: source.catalogMetadata,
    rawFiles: source.rawFiles, rawFileSha256: source.rawFileSha256, compatibilityVersion: 1 });
}
export function assignmentIds(table: IdAssignments): string[] {
  return [...table.reservedIds, ...table.attempts.flatMap(a => [a.attemptId, a.operationId]), ...table.records.map(r => r.recordId)];
}
export function issuedIds(table: IdAssignments, workspace: Workspace, corrections: CorrectionEvidence[]): string[] {
  return [...new Set([...corrections.flatMap(c => assignmentIds(c.originalAssignments)), ...assignmentIds(table),
    ...workspace.receipts.flatMap(c => [c.operationId, ...(c.kind === 'add' ? [c.attempt.id] : c.kind === 'add_record' ? [c.record.id] : [])]),
    ...workspace.usedTodoIds])];
}
export async function encodeState(source: SourceArchive, table: IdAssignments, base: MigrationTarget, workspace: Workspace,
  catalog: AttemptState23['catalog'], corrections: CorrectionEvidence[] = []): Promise<AttemptState23> {
  return freeze({ format: STATE_FORMAT, schemaVersion: STATE_VERSION, rule: PERSISTENCE_RULE, binding: structuredClone(base.binding),
    source: sourceEvidence(source), corrections: structuredClone(corrections), catalog: structuredClone(catalog), catalogSha256: await backupDigest(catalog),
    assignments: structuredClone(table), ledger: structuredClone(base.ledger), graph: structuredClone(workspace.graph), retained: structuredClone(base.retained),
    history: { commands: structuredClone(workspace.receipts), issuedIds: issuedIds(table, workspace, corrections), usedTodoIds: [...workspace.usedTodoIds] },
    verification: { sourceRoundTrip: true, graphSha256: await backupDigest(workspace.graph), retainedSha256: await backupDigest(base.retained), masterSha256: await backupDigest(source.context.catalog) } });
}
export function requireLiveMigration(source: SourceArchive, table: IdAssignments, target: MigrationTarget): void {
  validateMigrationAssignments(source, table, table.reservedIds);
  const result = verifyMigrationPreservation(source, table, target, table.reservedIds);
  if (result.status !== 'ready') throw new Error(`migration_not_ready: ${JSON.stringify(result.diagnostics)}`);
}
/** Integrity replay, NOT issuer authentication. Callers separately require either
 * a local checkpoint (reload) or explicit adoption of a validated portable backup.
 * Never registers a copied table in YI-04's WeakSet. */
export async function replayState(value: unknown) {
  exactKeys(value, ['format', 'schemaVersion', 'rule', 'binding', 'source', 'corrections', 'catalog', 'catalogSha256', 'assignments', 'ledger', 'graph', 'retained', 'history', 'verification'], 'state');
  if (value.format !== STATE_FORMAT || value.schemaVersion !== STATE_VERSION || !sameAttemptData(value.rule, PERSISTENCE_RULE)) throw new Error('unsupported_persistence_version');
  const state = value as unknown as AttemptState23;
  exactKeys(state.source, ['kind', 'schemaVersion', 'raw', 'rawSha256', 'stateSha256', 'catalog', 'catalogSha256', 'catalogSemanticSha256', 'catalogMetadata', 'rawFiles', 'rawFileSha256', 'compatibilityVersion'], 'source_evidence');
  exactKeys(state.history, ['commands', 'issuedIds', 'usedTodoIds'], 'history');
  if (!Array.isArray(state.history.commands) || !Array.isArray(state.corrections)) throw new Error('history_shape');
  const environment = await prepareMigrationEnvironment(state.source.rawFiles, state.catalog);
  const decoded = await decodeMigrationSource(state.source.raw, environment, state.source.catalog);
  if (decoded.status !== 'decoded') throw new Error(`source_revalidation: ${JSON.stringify(decoded.diagnostics)}`);
  const source = decoded.source;
  if (!sameAttemptData(state.source, sourceEvidence(source))) throw new Error('source_evidence_mismatch');
  checkSourceTodoIds(source);
  validateReservations(state.assignments.reservedIds);
  unionReservations(state.assignments.reservedIds, [...sourceUuids(source)]);
  checkMigrationAssignmentStructure(source, state.assignments, state.assignments.reservedIds);
  // Only the initial source target is reconstructed with YI-04. Edited graphs
  // are verified by ordered YI-05 replay, NOT original-source equality.
  const base = buildMigrationTarget(source, state.assignments);
  let workspace = createWorkspace(base.graph, source.context);
  const occupied = sourceUuids(source);
  for (const id of assignmentIds(state.assignments)) occupied.add(idTail(id));
  for (const command of state.history.commands) {
    const freshIds = checkFreshCommandIds(command, occupied);
    const next = applyCommand(workspace, command, source.context);
    if (next === workspace) throw new Error('duplicate_receipt');
    freshIds.forEach(id => occupied.add(idTail(id))); workspace = next;
  }
  for (let i = 0; i < state.corrections.length; i++) {
    const c = state.corrections[i];
    exactKeys(c, ['originalRaw', 'proposedRaw', 'offeringId', 'assessmentId', 'oldDate', 'newDate', 'originalAssignments'], 'correction');
    if (c.proposedRaw !== (state.corrections[i + 1]?.originalRaw ?? source.raw)) throw new Error('correction_chain');
    const original = await decodeMigrationSource(c.originalRaw, environment, state.source.catalog);
    if (original.status !== 'decoded') throw new Error('correction_original');
    checkSourceTodoIds(original.source);
    validateReservations(c.originalAssignments.reservedIds);
    unionReservations(c.originalAssignments.reservedIds, [...sourceUuids(original.source)]);
    checkMigrationAssignmentStructure(original.source, c.originalAssignments, c.originalAssignments.reservedIds);
    const originalTarget = buildMigrationTarget(original.source, c.originalAssignments);
    const issues = validateAttemptGraph(originalTarget.graph, original.source.context).issues;
    if (!issues.some(issue => issue.code === 'assessment_date')) throw new Error('correction_not_held');
    const raw = parseMigrationJson(c.originalRaw) as Record<string, unknown>;
    const oldState = ('format' in raw ? raw.state : raw) as SourceArchive['state'];
    const assessment = oldState.mediaSchoolingProgress[c.offeringId]?.assessments.find(a => a.id === c.assessmentId);
    if (!assessment || assessment.scheduledDate !== c.oldDate) throw new Error('correction_binding');
    if (c.newDate !== null) {
      const date = new Date(`${c.newDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.newDate) || c.newDate.startsWith('0000') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== c.newDate) throw new Error('assessment_date');
    }
    assessment.scheduledDate = c.newDate;
    if (JSON.stringify(raw, null, 2) !== c.proposedRaw) throw new Error('correction_other_field_changed');
    const nextTable = state.corrections[i + 1]?.originalAssignments ?? state.assignments;
    if (assignmentIds(c.originalAssignments).some(id => !nextTable.reservedIds.includes(id))) throw new Error('correction_assignment_history');
  }
  // Includes unused reservations and IDs from earlier date-correction tables.
  unionReservations(issuedIds(state.assignments, workspace, state.corrections));
  const expected = await encodeState(source, state.assignments, base, workspace, environment.target, state.corrections);
  if (!sameAttemptData(state, expected)) throw new Error('state_replay_mismatch');
  return { state: expected, workspace, source, base, environment };
}
