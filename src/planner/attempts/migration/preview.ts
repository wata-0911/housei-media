import type { PlannerItem, PlannerState } from '../../plannerCatalog';
import { sameAttemptData, validateAttemptGraph } from '../validation';
import { validateMigrationAssignments } from './assignments';
import { buildMigrationTarget } from './transform';
import { freeze, type Diagnostic, type IdAssignments, type MigrationTarget, type PreviewResult, type SourceArchive } from './contracts';

/** Reconstruct from the TARGET, not by returning archived source.state. */
function reconstruct(target: MigrationTarget): PlannerState {
  const attempts = new Map(target.graph.attempts.map(a => [a.id, a]));
  const records = new Map(target.graph.ownedRecords.map(r => [r.id, r]));
  const state: PlannerState = { ...structuredClone(target.retained), items: [], todos: [], mediaSchoolingProgress: {}, correspondenceProgress: {}, courseEvaluations: {} };
  for (const edge of target.ledger.attempts) {
    if (edge.itemIndex === null) continue;
    const attempt = attempts.get(edge.attemptId)!;
    const { contribution, ...plan } = attempt.plan!;
    const item: PlannerItem = { offeringId: attempt.legacyRefs[0].oldId, ...structuredClone(plan),
      ...(Object.hasOwn(attempt.plan!, 'contribution') ? { courseCreditContribution: contribution!.value as number } : {}) };
    if (edge.itemIndex !== state.items.length) throw new Error('item_order');
    state.items.push(item);
  }
  for (const edge of target.ledger.records) {
    const record = records.get(edge.recordId)!;
    const offeringId = record.owner?.kind === 'attempt' ? attempts.get(record.owner.attemptId)!.legacyRefs[0].oldId : null;
    const payload = { ...structuredClone(record.payload), offeringId };
    if (edge.sourceCollection === 'todos') state.todos.push(payload as PlannerState['todos'][number]);
    else {
      // Map key and internal Offering ref are independent source fields.
      Object.defineProperty(state[edge.sourceCollection], edge.sourceKey, { value: payload, enumerable: true, configurable: true, writable: true });
    }
  }
  return state;
}
function at(value: unknown, path: string): unknown {
  return path.split('/').slice(1).reduce<unknown>((v, key) => (v as Record<string, unknown>)[key.replace(/~1/g, '/').replace(/~0/g, '~')], value);
}
function result(source: SourceArchive, table: IdAssignments, target: MigrationTarget, reserved: readonly string[]): PreviewResult {
  validateMigrationAssignments(source, table, reserved);
  const expected = buildMigrationTarget(source, table);
  const diagnostics: Diagnostic[] = [];
  if (!sameAttemptData(target, expected)) diagnostics.push({ code: 'target_correspondence', path: '', message: 'Target differs from the fixed source/rule/assignment correspondence; no edited candidate is accepted' });
  const validated = validateAttemptGraph(target.graph, source.context);
  for (const issue of validated.issues) {
    let original: unknown;
    if (issue.code === 'assessment_date') {
      const recordIndex = target.graph.ownedRecords.findIndex(r => issue.path.startsWith(`/ownedRecords/${r.id}/assessments/`));
      const edge = table.records[recordIndex];
      const progress = source.state.mediaSchoolingProgress[edge.sourceKey];
      const assessment = progress.assessments.find(a => issue.path === `/ownedRecords/${edge.recordId}/assessments/${a.id}`);
      original = { sourcePath: edge.key, offeringId: edge.offeringId, owner: target.graph.ownedRecords[recordIndex].owner,
        assessment: structuredClone(assessment), payload: structuredClone(progress) };
    }
    diagnostics.push({ ...issue, ...(original === undefined ? {} : { original }) });
  }
  // Each mapped field has its own value equality check, including null and nested arrays.
  for (const field of expected.ledger.fields) {
    if (!sameAttemptData(at(source.state, field.sourcePath), at(target, field.targetPath))) {
      diagnostics.push({ code: 'field_preservation', path: field.sourcePath, message: `Value/omission/order differs at ${field.targetPath}` });
    }
  }
  const projection = reconstruct(target);
  if (!sameAttemptData(source.state, projection)) diagnostics.push({ code: 'roundtrip_preservation', path: '', message: 'Source field/value/omission/order/owner/quantity changed in target → legacy projection' });
  const repeated = buildMigrationTarget(source, table);
  if (!sameAttemptData(target, repeated)) diagnostics.push({ code: 'deterministic_result', path: '', message: 'Re-execution differs' });
  if (diagnostics.length) return freeze({ status: 'held', candidate: target, diagnostics });
  return freeze({ status: 'ready', target, diagnostics: [], checks: { fields: expected.ledger.fields.length,
    attempts: expected.graph.attempts.length, records: expected.graph.ownedRecords.length, exactRoundTrip: true, deterministic: true } });
}

/** Randomness/storage/clock-free transform of a decoded source and fixed table.
 * ready means read-only representation verified, never permission to persist. */
export function previewMigration(source: SourceArchive, table: IdAssignments, reservedIds: readonly string[] = []): PreviewResult {
  try {
    validateMigrationAssignments(source, table, reservedIds);
    return result(source, table, buildMigrationTarget(source, table), reservedIds);
  } catch (e) { return { status: 'rejected', candidate: null, diagnostics: [{ code: 'migration_contract', path: '', message: e instanceof Error ? e.message : 'Invalid migration input' }] }; }
}

/** Audit externally edited/proposed targets against the original source and table. */
export function verifyMigrationPreservation(source: SourceArchive, table: IdAssignments, proposed: MigrationTarget, reservedIds: readonly string[] = []): PreviewResult {
  try { return result(source, table, structuredClone(proposed), reservedIds); }
  catch (e) { return { status: 'rejected', candidate: null, diagnostics: [{ code: 'preservation_contract', path: '', message: e instanceof Error ? e.message : 'Invalid target' }] }; }
}

/** Read-only adapter for OLD consumers. Always revalidate, retain original catalog,
 * never invent Offerings, merge graph records into source maps, or accept a held target. */
export function projectLegacyState(source: SourceArchive, table: IdAssignments, target: MigrationTarget, reservedIds: readonly string[] = []) {
  const checked = verifyMigrationPreservation(source, table, target, reservedIds);
  if (checked.status !== 'ready') throw new Error('legacy_projection_requires_ready');
  return freeze({ state: reconstruct(checked.target), catalog: structuredClone(source.sourceCatalog) });
}
