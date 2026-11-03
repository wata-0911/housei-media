import { verifyImportPreview, type ImportPreview, type Candidate } from './preview';
import { appendOperation, verifyLedgerState, type Ledger, type Operation, type RowAssignment, type Id } from './ledger';
import { checkDecimalRoundTrips, NumericPrecisionError } from './decimalPolicy';
import { parseAttemptGraphJson, AttemptJsonInputError } from '../jsonInput';
import { canonicalBackupJson as canonical, backupDigest } from '../../digest';
import type { DeepReadonly, GradeSourceArchive } from './sourceArchive';

export const VERSION = '0.1.0-prototype' as const; // no N/B/A/U allocation
export const FORMAT = 'hosei-g02b-adoption-plan-prototype' as const;
export const LIMITS = Object.freeze({ jsonBytes: 8 * 1024 * 1024 });
export type Failure = 'input_type' | 'invalid_json' | 'resource_limit' | 'shape' | 'confirmation_required'
  | 'candidate_outside_preview' | 'historical_candidate' | 'decision_kind_mismatch' | 'snapshot_target_conflict'
  | 'many_to_one' | 'confirmation_mismatch' | 'allocation_shape' | 'invariant_failed' | 'plan_mismatch';
export class AdoptionError extends Error { constructor(readonly code: Failure) { super(code); this.name = 'AdoptionError'; } }
function fail(code: Failure): never { throw new AdoptionError(code); }
export type CandidateRef = { achievementId: string; revisionId: string; observationId: string };
export type Choice = { rowIndex: number; action: 'new' | 'reimport' | 'correction' | 'reuse_snapshot'; candidate: CandidateRef | null; activate: boolean };
export type Selection = { targetSnapshotId: string; rows: Choice[] };
export type Confirmation = { selectionSha256: string; confirmed: true; rows: { rowIndex: number; targetDigest: string; confirmed: true; reason: string }[] };
export type Allocation = {
  mode: 'explicit-test-only-untrusted'; importOperationId: string;
  rows: { rowIndex: number; achievementId: string | null; observationId: string; revisionId: string;
    details: { detailId: string | null; observationId: string; revisionId: string }[] }[];
  activations: { rowIndex: number; operationId: string }[];
};
export type Decision = { selection: Selection; confirmation: Confirmation; allocation: Allocation };
export type Targets = { selection: Selection; selectionSha256: string; previewSha256: string; binding: ImportPreview['binding'];
  rows: { rowIndex: number; targetDigest: string }[]; saveAuthority: 'not-issued' };
export type AdoptionPlan = {
  format: typeof FORMAT; contractVersion: typeof VERSION; binding: ImportPreview['binding']; previewSha256: string;
  decision: Decision; decisionSha256: string; operations: Operation[]; resultLedger: DeepReadonly<Ledger>;
  beforeLedgerSha256: string; afterLedgerSha256: string;
  checks: { allFieldsReplayed: true; oldRevisionsPreserved: true; reservationsMonotone: true; noPartialPublication: true };
  authorization: { kind: 'memory-only-operation-plan'; canCommit: false; saveAuthority: 'not-issued';
    idIssuance: 'not-certified'; burn: 'not-performed'; floorAuthenticity: 'not-certified' };
  planSha256: string;
};
function parse(input: unknown): unknown {
  if (typeof input !== 'string') fail('input_type');
  if (input.length > LIMITS.jsonBytes || new TextEncoder().encode(input).byteLength > LIMITS.jsonBytes) fail('resource_limit');
  try { const v = parseAttemptGraphJson(input); checkDecimalRoundTrips(input); return v; }
  catch (e) {
    if (e instanceof AttemptJsonInputError) fail(e.code === 'resource_limit' ? 'resource_limit' : 'invalid_json');
    if (e instanceof NumericPrecisionError) fail('invalid_json');
    throw e;
  }
}
function keys(v: unknown, fields: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== [...fields].sort().join(',')) fail('shape');
}
function freeze<T>(v: T): DeepReadonly<T> { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v as DeepReadonly<T>; }
function copy<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
function equal(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
function snapshotId(v: unknown) { if (typeof v !== 'string' || !new RegExp(`^hosei:g01b-snapshot:${uuid}$`).test(v)) fail('shape'); }
function text(v: unknown) { if (typeof v !== 'string' || !v.trim()) fail('shape'); }
function hash(v: unknown) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail('shape'); }
async function context(p: unknown, a: unknown, l: unknown, f: unknown) {
  // G02a must recompute the displayed candidate set, whole binding and all fields.
  const preview = await verifyImportPreview(p, a, l, f);
  const ledger = await verifyLedgerState(l, f);
  return { preview, ledger };
}
function selected(row: DeepReadonly<ImportPreview['rows'][number]>, choice: Choice): DeepReadonly<Candidate> | null {
  if (choice.candidate === null) return null;
  const found = row.candidates.find(c => c.achievementId === choice.candidate!.achievementId && c.revisionId === choice.candidate!.revisionId && c.observationId === choice.candidate!.observationId);
  if (!found) fail('candidate_outside_preview'); return found;
}
function selection(input: unknown, p: DeepReadonly<ImportPreview>, ledger: DeepReadonly<Ledger>): Selection {
  keys(input, ['targetSnapshotId', 'rows']); snapshotId(input.targetSnapshotId);
  if (!Array.isArray(input.rows) || input.rows.length !== p.rows.length) fail('shape');
  const same = p.snapshotStatus === 'same_snapshot';
  if (same ? !p.matchingSnapshotIds.includes(input.targetSnapshotId as string) : ledger.view.snapshots.some(s => s.id === input.targetSnapshotId)) fail('snapshot_target_conflict');
  const used = new Set<string>();
  input.rows.forEach((v, i) => {
    keys(v, ['rowIndex', 'action', 'candidate', 'activate']);
    if (v.rowIndex !== i || typeof v.activate !== 'boolean' || !['new', 'reimport', 'correction', 'reuse_snapshot'].includes(v.action as string)) fail('shape');
    if (v.candidate !== null) { keys(v.candidate, ['achievementId', 'revisionId', 'observationId']); Object.values(v.candidate).forEach(text); }
    const c = v as unknown as Choice, row = p.rows[i], candidate = selected(row, c);
    if (c.action === 'new') {
      if (same || c.candidate !== null) fail('decision_kind_mismatch');
    } else {
      if (!candidate) fail('candidate_outside_preview');
      if (same !== (c.action === 'reuse_snapshot')) fail('decision_kind_mismatch');
      if (c.action !== 'reuse_snapshot' && !candidate.isLatest || c.activate && !candidate.isLatest) fail('historical_candidate');
      if (c.action === 'reimport' && !candidate.sameRecord || c.action === 'correction' && candidate.sameRecord) fail('decision_kind_mismatch');
      if (!same && used.has(candidate.achievementId)) fail('many_to_one'); used.add(candidate.achievementId);
    }
  });
  return input as unknown as Selection;
}
async function targets(p: DeepReadonly<ImportPreview>, s: Selection): Promise<Targets> {
  const selectionSha256 = await backupDigest(s), rows: Targets['rows'] = [];
  for (const choice of s.rows) rows.push({ rowIndex: choice.rowIndex, targetDigest: await backupDigest({
    domain: 'g02b-explicit-row-choice/prototype', version: VERSION, selectionSha256,
    previewSha256: p.previewSha256, binding: p.binding, targetSnapshotId: s.targetSnapshotId,
    choice, rowPreview: p.rows[choice.rowIndex],
  }) });
  return { selection: s, selectionSha256, previewSha256: p.previewSha256, binding: copy(p.binding), rows, saveAuthority: 'not-issued' };
}
/** Describe the exact confirmation targets. No confirmed flag, IDs or credentials are minted. */
export async function prepareConfirmation(previewJson: unknown, archiveJson: unknown, ledgerJson: unknown, floorJson: unknown, selectionJson: unknown): Promise<DeepReadonly<Targets>> {
  const { preview, ledger } = await context(previewJson, archiveJson, ledgerJson, floorJson);
  const s = selection(parse(selectionJson), preview, ledger), result = await targets(preview, s);
  const parsed = parse(JSON.stringify(result)); if (!equal(parsed, result)) fail('invalid_json'); return freeze(result);
}
function confirmation(v: unknown, expected: Targets): asserts v is Confirmation {
  keys(v, ['selectionSha256', 'confirmed', 'rows']); hash(v.selectionSha256);
  if (v.confirmed !== true) fail('confirmation_required');
  if (v.selectionSha256 !== expected.selectionSha256 || !Array.isArray(v.rows) || v.rows.length !== expected.rows.length) fail('confirmation_mismatch');
  v.rows.forEach((r, i) => {
    keys(r, ['rowIndex', 'targetDigest', 'confirmed', 'reason']); hash(r.targetDigest); text(r.reason);
    if (r.confirmed !== true) fail('confirmation_required');
    if (r.rowIndex !== i || r.targetDigest !== expected.rows[i].targetDigest) fail('confirmation_mismatch');
  });
}
function allocation(v: unknown, s: Selection, same: boolean): asserts v is Allocation {
  keys(v, ['mode', 'importOperationId', 'rows', 'activations']);
  if (v.mode !== 'explicit-test-only-untrusted') fail('allocation_shape'); text(v.importOperationId);
  if (!Array.isArray(v.rows) || v.rows.length !== (same ? 0 : s.rows.length) || !Array.isArray(v.activations)) fail('allocation_shape');
  v.rows.forEach((r, i) => {
    keys(r, ['rowIndex', 'achievementId', 'observationId', 'revisionId', 'details']);
    if (r.rowIndex !== i) fail('allocation_shape'); text(r.observationId); text(r.revisionId);
    if (s.rows[i].action === 'new') text(r.achievementId); else if (r.achievementId !== null) fail('allocation_shape');
    if (!Array.isArray(r.details) || r.details.length !== 7) fail('allocation_shape');
    r.details.forEach(d => {
      keys(d, ['detailId', 'observationId', 'revisionId']); text(d.observationId); text(d.revisionId);
      if (s.rows[i].action === 'new') text(d.detailId); else if (d.detailId !== null) fail('allocation_shape');
    });
  });
  const active = s.rows.filter(r => r.activate);
  if (v.activations.length !== active.length) fail('allocation_shape');
  v.activations.forEach((a, i) => { keys(a, ['rowIndex', 'operationId']); if (a.rowIndex !== active[i].rowIndex) fail('allocation_shape'); text(a.operationId); });
}
function preserved(before: DeepReadonly<Ledger>, after: DeepReadonly<Ledger>, s: Selection, assignments: RowAssignment[]) {
  const prefix = (a: readonly unknown[], b: readonly unknown[]) => equal(a, b.slice(0, a.length));
  if (!prefix(before.journal.entries, after.journal.entries) || !prefix(before.issuedIds, after.issuedIds) || !prefix(before.reservedIds, after.reservedIds)) fail('invariant_failed');
  for (const key of ['snapshots', 'observations', 'revisions', 'detailObservations', 'detailRevisions'] as const) if (!prefix(before.view[key], after.view[key])) fail('invariant_failed');
  if (!equal(before.view.associations, after.view.associations)) fail('invariant_failed');
  const heads = new Map<string, string>(s.rows.filter(c => c.activate).map(c => [assignments[c.rowIndex].achievementId, assignments[c.rowIndex].revisionId]));
  for (const a of after.view.achievements) {
    const old = before.view.achievements.find(x => x.id === a.id);
    if (old && !prefix(old.revisionIds, a.revisionIds)) fail('invariant_failed');
    if (a.activeRevisionId !== (heads.get(a.id) ?? old?.activeRevisionId ?? null)) fail('invariant_failed');
  }
  for (const d of before.view.details) {
    const found = after.view.details.find(x => x.id === d.id);
    if (!found || found.achievementId !== d.achievementId || found.kind !== d.kind || found.index !== d.index || !prefix(d.revisionIds, found.revisionIds)) fail('invariant_failed');
  }
}
/** Build ordinary G01b operations, evaluating the entire batch privately. Caller-supplied
 * test IDs are structural input only, not certified issuance/burn/save authorization. */
export async function planAdoption(previewJson: unknown, archiveJson: unknown, ledgerJson: unknown, floorJson: unknown, decisionJson: unknown): Promise<DeepReadonly<AdoptionPlan>> {
  const { preview, ledger: before } = await context(previewJson, archiveJson, ledgerJson, floorJson);
  const request = parse(decisionJson); keys(request, ['selection', 'confirmation', 'allocation']);
  const s = selection(request.selection, preview, before), expected = await targets(preview, s);
  confirmation(request.confirmation, expected); allocation(request.allocation, s, preview.snapshotStatus === 'same_snapshot');
  const confirm = request.confirmation, ids = request.allocation;
  let rows: RowAssignment[];
  if (preview.snapshotStatus === 'same_snapshot') {
    rows = copy(before.view.snapshots.find(x => x.id === s.targetSnapshotId)!.rows) as RowAssignment[];
  } else rows = s.rows.map((choice, i) => {
    const fresh = ids.rows[i], candidate = selected(preview.rows[i], choice);
    const prior = candidate ? before.view.snapshots.find(x => x.id === candidate.sourceRef.snapshotId)!.rows[candidate.sourceRef.rowIndex] : null;
    return { observationId: fresh.observationId as Id<'observation'>, achievementId: (prior?.achievementId ?? fresh.achievementId!) as Id<'achievement'>,
      revisionId: fresh.revisionId as Id<'revision'>, previousRevisionId: prior?.revisionId ?? null,
      details: fresh.details.map((d, j) => ({ observationId: d.observationId as Id<'detail-observation'>, detailId: (prior?.details[j].detailId ?? d.detailId!) as Id<'detail'>,
        revisionId: d.revisionId as Id<'detail-revision'>, previousRevisionId: prior?.details[j].revisionId ?? null })) };
  });
  const operations: Operation[] = [{ kind: 'import_snapshot', operationId: ids.importOperationId as Id<'operation'>, expectedTipSha256: before.tipSha256,
    snapshotId: s.targetSnapshotId as Id<'snapshot'>, archive: copy(preview.sourceArchive) as GradeSourceArchive, rows }];
  // No progress/result callback: a later failure cannot publish an earlier candidate state.
  let state = await appendOperation(JSON.stringify(before), JSON.stringify(operations[0]), floorJson);
  for (const a of ids.activations) {
    const r = rows[a.rowIndex], reason = canonical({ domain: 'g02b-confirmation-description/prototype', selectionSha256: expected.selectionSha256,
      previewSha256: preview.previewSha256, targetDigest: expected.rows[a.rowIndex].targetDigest, reason: confirm.rows[a.rowIndex].reason });
    const op: Operation = { kind: 'activate_revision', operationId: a.operationId as Id<'operation'>, expectedTipSha256: state.tipSha256,
      achievementId: r.achievementId, revisionId: r.revisionId, expectedActiveRevisionId: state.view.achievements.find(x => x.id === r.achievementId)!.activeRevisionId as Id<'revision'> | null,
      confirmation: { kind: 'explicit-selection', reason } };
    state = await appendOperation(JSON.stringify(state), JSON.stringify(op), floorJson); operations.push(op);
  }
  state = await verifyLedgerState(JSON.stringify(state), JSON.stringify({ issuedIds: before.issuedIds, reservedIds: before.reservedIds }));
  preserved(before, state, s, rows);
  const decision = request as unknown as Decision;
  const body = { format: FORMAT, contractVersion: VERSION, binding: copy(preview.binding), previewSha256: preview.previewSha256,
    decision, decisionSha256: await backupDigest(decision), operations, resultLedger: state,
    beforeLedgerSha256: await backupDigest(before), afterLedgerSha256: await backupDigest(state),
    checks: { allFieldsReplayed: true as const, oldRevisionsPreserved: true as const, reservationsMonotone: true as const, noPartialPublication: true as const },
    authorization: { kind: 'memory-only-operation-plan' as const, canCommit: false as const, saveAuthority: 'not-issued' as const, idIssuance: 'not-certified' as const,
      burn: 'not-performed' as const, floorAuthenticity: 'not-certified' as const } };
  const result = { ...body, planSha256: await backupDigest(body) };
  if (!equal(parse(JSON.stringify(result)), result)) fail('invalid_json'); return freeze(result);
}
/** Rebuild the whole plan with original current context; display JSON/digests never grant trust. */
export async function verifyAdoptionPlan(planJson: unknown, previewJson: unknown, archiveJson: unknown, ledgerJson: unknown, floorJson: unknown, decisionJson: unknown): Promise<DeepReadonly<AdoptionPlan>> {
  const supplied = parse(planJson), expected = await planAdoption(previewJson, archiveJson, ledgerJson, floorJson, decisionJson);
  if (!equal(supplied, expected)) fail('plan_mismatch'); return expected;
}
