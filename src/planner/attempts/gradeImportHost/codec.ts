import { createGradeSourceArchive } from '../gradeImport/sourceArchive';
import { createLedger, verifyLedgerState } from '../gradeImport/ledger';
import { previewImport, verifyImportPreview } from '../gradeImport/preview';
import { prepareConfirmation, planAdoption, verifyAdoptionPlan } from '../gradeImport/adoption';
import { checkDecimalRoundTrips } from '../gradeImport/decimalPolicy';
import { parseAttemptGraphJson, AttemptJsonInputError } from '../jsonInput';
import { canonicalBackupJson, backupDigest, backupRawDigest } from '../../digest';
import { FORMAT, POLICY, DATABASE, STORE, KEY, LIMITS, fail, type Environment, type Grant, type HostRecord,
  type FrozenRecord, type EventBody, type Receipt, type HostEvent } from './contracts';
import type { Allocation, Decision, Selection } from '../gradeImport/adoption';
import type { DeepReadonly } from '../gradeImport/sourceArchive';

export const json = JSON.stringify;
export const digest = backupDigest;
export const rawDigest = backupRawDigest;
export const equal = (a: unknown, b: unknown) => canonicalBackupJson(a) === canonicalBackupJson(b);
export function freeze<T>(v: T): DeepReadonly<T> {
  if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v as DeepReadonly<T>;
}
export function parse(raw: unknown): unknown {
  if (typeof raw !== 'string') fail('input_type');
  if (raw.length > LIMITS.bytes || new TextEncoder().encode(raw).length > LIMITS.bytes) fail('resource_limit');
  try { const v = parseAttemptGraphJson(raw); checkDecimalRoundTrips(raw); return v; }
  catch (e) { if (e instanceof AttemptJsonInputError && e.code === 'resource_limit') fail('resource_limit'); fail('invalid_json'); }
}
function keys(v: unknown, expected: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== [...expected].sort().join(',')) fail('shape');
}
function hash(v: unknown) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail('shape'); }
export const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function environment(origin: string): Environment {
  if (typeof origin !== 'string' || !/^https?:\/\//.test(origin) || new URL(origin).origin !== origin) fail('unsupported_policy');
  return { origin, database: DATABASE, store: STORE, key: KEY, policy: POLICY };
}
export function checkEnvironment(e: unknown): asserts e is Environment {
  keys(e, ['origin', 'database', 'store', 'key', 'policy']);
  if (typeof e.origin !== 'string' || !equal(e, environment(e.origin))) fail('unsupported_policy');
}
export function roleSlots(activate: boolean): string[] {
  return ['operation', 'snapshot', 'achievement', 'observation', 'revision',
    ...Array.from({ length: 7 }, () => ['detail', 'detail-observation', 'detail-revision']).flat(), ...(activate ? ['operation'] : [])];
}
export function allocation(ids: string[], activate: boolean): { selection: Selection; allocation: Allocation } {
  if (ids.length !== roleSlots(activate).length) fail('id_ticket');
  return { selection: { targetSnapshotId: ids[1], rows: [{ rowIndex: 0, action: 'new', candidate: null, activate }] },
    allocation: { mode: 'explicit-test-only-untrusted', importOperationId: ids[0],
      rows: [{ rowIndex: 0, achievementId: ids[2], observationId: ids[3], revisionId: ids[4],
        details: Array.from({ length: 7 }, (_, i) => ({ detailId: ids[5 + i * 3], observationId: ids[6 + i * 3], revisionId: ids[7 + i * 3] })) }],
      activations: activate ? [{ rowIndex: 0, operationId: ids[26] }] : [] } };
}
export async function emptyLedger(hostId: string) { return createLedger(json([hostId])); }
export async function ledgerContext(record: FrozenRecord) {
  const ledger = await verifyLedgerState(record.ledgerRaw);
  const floorRaw = json({ issuedIds: ledger.issuedIds, reservedIds: ledger.reservedIds });
  return { ledger, ledgerRaw: record.ledgerRaw, floorRaw };
}
export async function sourceContext(raw: unknown, record: FrozenRecord) {
  const archive = await createGradeSourceArchive(raw);
  if (archive.dto.courses.length !== 1 || record.receipts.length) fail('unsupported_policy');
  const c = await ledgerContext(record), archiveRaw = json(archive);
  const preview = await previewImport(archiveRaw, c.ledgerRaw, c.floorRaw);
  if (preview.snapshotStatus === 'same_snapshot') fail('unsupported_policy');
  return { ...c, archive, archiveRaw, preview, previewRaw: json(preview) };
}
export async function confirmationTargets(c: Awaited<ReturnType<typeof sourceContext>>, grant: DeepReadonly<Grant>) {
  return prepareConfirmation(c.previewRaw, c.archiveRaw, c.ledgerRaw, c.floorRaw, json(grant.selection));
}
export async function adoption(c: Awaited<ReturnType<typeof sourceContext>>, decision: DeepReadonly<Decision>) {
  await verifyImportPreview(c.previewRaw, c.archiveRaw, c.ledgerRaw, c.floorRaw);
  const p = await planAdoption(c.previewRaw, c.archiveRaw, c.ledgerRaw, c.floorRaw, json(decision));
  return verifyAdoptionPlan(json(p), c.previewRaw, c.archiveRaw, c.ledgerRaw, c.floorRaw, json(decision));
}
export async function receiptFor(c: Awaited<ReturnType<typeof sourceContext>>, grant: DeepReadonly<Grant>, decision: DeepReadonly<Decision>) {
  if (!equal(decision.selection, grant.selection) || !equal(decision.allocation, grant.allocation)) fail('id_ticket');
  const plan = await adoption(c, decision);
  const receipt: Receipt = { grantId: grant.intentId, decision: parse(json(decision)) as Decision,
    archiveSha256: await rawDigest(c.archiveRaw), previewSha256: c.preview.previewSha256, binding: c.preview.binding,
    beforeLedgerEntries: c.ledger.journal.entries.length, beforeLedgerSha256: await rawDigest(c.ledgerRaw),
    floorSha256: await rawDigest(c.floorRaw), operations: await Promise.all(plan.operations.map(async o => ({ operationId: o.operationId, payloadSha256: await digest(o) }))),
    afterLedgerSha256: await rawDigest(json(plan.resultLedger)) };
  return { receipt, plan };
}
async function genesis(hostId: string, env: Environment): Promise<HostRecord> {
  if (!uuidPattern.test(hostId)) fail('shape'); checkEnvironment(env);
  return { format: FORMAT, hostVersion: 1, environment: env, hostId, events: [], ledgerRaw: json(await emptyLedger(hostId)), receipts: [], outcomes: [],
    authority: { generation: 0, reservedIds: [hostId], consumedGrantIds: [], opReceipts: [], tipSha256: null } };
}
async function apply(r: HostRecord, event: HostEvent, finalLedgerRaw: string): Promise<void> {
  if (event.sequence !== r.events.length + 1 || event.previousSha256 !== r.authority.tipSha256) fail('invalid_host');
  const eventHash = await digest({ sequence: event.sequence, previousSha256: event.previousSha256, body: event.body });
  if (event.eventSha256 !== eventHash) fail('invalid_host');
  const body = event.body;
  if (body.kind === 'reserve') {
    keys(body, ['kind', 'grant']);
    const g = body.grant;
    keys(g, ['intentId', 'ids', 'selection', 'allocation', 'archiveSha256', 'previewSha256', 'ledgerSha256', 'floorSha256', 'environment']);
    if (r.receipts.length || r.events.filter(e => e.body.kind === 'reserve').length >= LIMITS.grants) fail('resource_limit');
    if (!Array.isArray(g.ids) || !g.selection || typeof g.selection !== 'object' || !Array.isArray(g.selection.rows) || typeof g.selection.rows[0]?.activate !== 'boolean') fail('id_ticket');
    const roles = roleSlots(g.selection.rows[0].activate), tails = new Set(r.authority.reservedIds.map(s => s.split(':').at(-1)));
    if (g.ids.length !== roles.length) fail('id_ticket');
    for (let i = 0; i < roles.length; i++) {
      const id = g.ids[i]; if (typeof id !== 'string') fail('id_ticket');
      const tail = id.split(':').at(-1)!;
      if (!uuidPattern.test(tail) || id !== `hosei:g01b-${roles[i]}:${tail}` || tails.has(tail)) fail('id_ticket');
      tails.add(tail);
    }
    const expected = allocation(g.ids, g.selection.rows[0].activate), c = await ledgerContext(r);
    if (g.intentId !== g.ids[0] || !equal(expected.selection, g.selection) || !equal(expected.allocation, g.allocation)
      || !equal(g.environment, r.environment) || g.ledgerSha256 !== await rawDigest(r.ledgerRaw) || g.floorSha256 !== await rawDigest(c.floorRaw)) fail('id_ticket');
    hash(g.archiveSha256); hash(g.previewSha256);
    r.authority.reservedIds.push(...g.ids);
    if (r.authority.reservedIds.length > LIMITS.ids) fail('resource_limit');
  } else if (body.kind === 'adopt') {
    keys(body, ['kind', 'receipt']);
    if (r.receipts.length) fail('unsupported_policy');
    const receipt = body.receipt;
    keys(receipt, ['grantId', 'decision', 'archiveSha256', 'previewSha256', 'binding', 'beforeLedgerEntries', 'beforeLedgerSha256', 'floorSha256', 'operations', 'afterLedgerSha256']);
    keys(receipt.decision, ['selection', 'confirmation', 'allocation']);
    const grantEvent = r.events.find(e => e.body.kind === 'reserve' && e.body.grant.intentId === receipt.grantId);
    if (!grantEvent || grantEvent.body.kind !== 'reserve' || r.authority.consumedGrantIds.includes(receipt.grantId)) fail('id_ticket');
    const g = grantEvent.body.grant;
    const final = await verifyLedgerState(finalLedgerRaw);
    const op = final.journal.entries[0]?.operation;
    if (!op || op.kind !== 'import_snapshot') fail('invalid_host');
    const c = await sourceContext(op.archive.raw, r);
    if (g.archiveSha256 !== await rawDigest(c.archiveRaw) || g.previewSha256 !== c.preview.previewSha256) fail('invalid_host');
    const result = await receiptFor(c, g, receipt.decision);
    if (!equal(result.receipt, receipt)) fail('invalid_host');
    r.ledgerRaw = json(result.plan.resultLedger);
    // A replayed plan is never authorization. Grant provenance belongs to this host lineage.
    if (result.plan.authorization.canCommit !== false) fail('invalid_host');
    const sha = await digest(receipt);
    for (const o of receipt.operations) {
      if (r.authority.opReceipts.some(p => p.operationId === o.operationId)) fail('receipt_conflict');
      r.authority.opReceipts.push({ operationId: o.operationId, receiptSha256: sha });
    }
    r.receipts.push(receipt); r.authority.consumedGrantIds.push(g.intentId);
    r.outcomes.push({ receiptSha256: sha, operationIds: receipt.operations.map(o => o.operationId), ledgerEntries: result.plan.resultLedger.journal.entries.length,
      ledgerSha256: receipt.afterLedgerSha256, sequence: event.sequence });
  } else fail('shape');
  r.events.push(event); r.authority.generation = event.sequence; r.authority.tipSha256 = eventHash;
}
export async function decodeHost(raw: unknown): Promise<FrozenRecord> {
  const parsed = parse(raw);
  keys(parsed, ['format', 'hostVersion', 'environment', 'hostId', 'events', 'ledgerRaw', 'receipts', 'outcomes', 'authority']);
  if (parsed.format !== FORMAT || parsed.hostVersion !== 1 || typeof parsed.hostId !== 'string' || typeof parsed.ledgerRaw !== 'string') fail('shape');
  checkEnvironment(parsed.environment);
  if (!Array.isArray(parsed.events) || parsed.events.length > LIMITS.grants + 1) fail('resource_limit');
  const r = await genesis(parsed.hostId, parsed.environment);
  for (const value of parsed.events) {
    keys(value, ['sequence', 'previousSha256', 'body', 'eventSha256']);
    if (!value.body || typeof value.body !== 'object') fail('shape');
    await apply(r, value as HostEvent, parsed.ledgerRaw);
  }
  if (!equal(r, parsed)) fail('invalid_host');
  await verifyLedgerState(r.ledgerRaw);
  return freeze(r);
}
export async function createHost(hostId: string, env: Environment) { return decodeHost(json(await genesis(hostId, env))); }
export async function appendHost(record: FrozenRecord, body: EventBody, ledgerRaw = record.ledgerRaw) {
  const base = parse(json(record)) as HostRecord;
  const eventBase = { sequence: base.events.length + 1, previousSha256: base.authority.tipSha256, body };
  const event = { ...eventBase, eventSha256: await digest(eventBase) };
  await apply(base, event, ledgerRaw);
  // Generated records must round-trip under the same complete verifier before publication.
  return decodeHost(json(base));
}
