import { withPlannerWriteLock, type PlannerWriteLocks } from '../../backup/storagePrimitives';
import { HostIdentityOwner } from './identity';
import { createNativeHostStore } from './nativeStore';
import { HostError, fail, type Environment, type FrozenRecord, type Grant, type Receipt } from './contracts';
import { environment, checkEnvironment, equal, json, parse, freeze, createHost, decodeHost, sourceContext, rawDigest,
  digest, confirmationTargets, receiptFor, appendHost } from './codec';
import type { Decision } from '../gradeImport/adoption';

declare const handleBrand: unique symbol, previewBrand: unique symbol, preparedBrand: unique symbol, proposalBrand: unique symbol;
export type NativeHandle = { readonly [handleBrand]: true; readonly snapshotJson: string };
export type HostPreview = { readonly [previewBrand]: true; readonly displayJson: string };
export type PreparedIntent = { readonly [preparedBrand]: true; readonly targetsJson: string; readonly issuedIds: readonly string[] };
export type Proposal = { readonly [proposalBrand]: true; readonly decisionJson: string };
/** Trusted infrastructure arguments. Never accept a caller-provided store, plan,
 * UUID allocator, floor, record or environment JSON as a qualified session. */
export function createGradeImportHost(factory: IDBFactory, locks: PlannerWriteLocks | undefined,
  origin: string, environmentProvider: () => Environment = () => environment(origin)) {
  const store = createNativeHostStore(factory), owner = new HostIdentityOwner();
  const handles = new WeakMap<NativeHandle, { raw: string; record: FrozenRecord }>();
  type Context = Awaited<ReturnType<typeof sourceContext>>;
  const previews = new WeakMap<HostPreview, { handle: NativeHandle; context: Context }>();
  type Intent = { handle: NativeHandle; context: Context; grant: Grant; ticket: object; epoch: number; targetsJson: string };
  const intents = new WeakMap<PreparedIntent, Intent>();
  const sealedReceipts = new WeakMap<Intent, Receipt>();
  const proposals = new WeakMap<Proposal, { intent: Intent; receipt: Receipt; planJson: string; ledgerRaw: string }>();
  let stopped = false, busy = false, epoch = 0, active: PreparedIntent | null = null;
  let issuedHandle = false;
  const initialEnvironment = environment(origin);
  const alive = () => { if (stopped) fail('session_stopped'); };
  function sample() {
    try {
      const e = environmentProvider();
      checkEnvironment(e);
      if (!equal(e, initialEnvironment)) fail('stale');
      return e;
    } catch (e) { stopped = true; throw e; }
  }
  function current(h: NativeHandle) { alive(); const v = handles.get(h); if (!v) fail('unqualified'); return v; }
  function barrier(n: number) { alive(); if (n !== epoch) fail('cancelled'); sample(); }
  function issue(raw: string, record: FrozenRecord): NativeHandle {
    owner.restrict(record);
    const h = Object.freeze({ snapshotJson: raw }) as NativeHandle; handles.set(h, { raw, record }); issuedHandle = true; return h;
  }
  async function strictRead() {
    try {
      const data = await store.read();
      if (!data.exists) {
        if (issuedHandle) fail('stale');
        return null;
      }
      if (!data.keyExists || typeof data.value !== 'string') fail('invalid_host');
      const record = await decodeHost(data.value);
      if (!equal(record.environment, sample())) { stopped = true; fail('stale'); }
      return { raw: data.value, record };
    } catch (e) {
      // Observed native read/integrity failure revokes existing live authority.
      // Preserve the first diagnosis; restored bytes cannot revive old tickets.
      if (issuedHandle) stopped = true;
      throw e;
    }
  }
  async function fresh(h: NativeHandle) {
    const expected = current(h), read = await strictRead();
    if (!read || read.raw !== expected.raw) { stopped = true; fail('stale'); }
    return read;
  }
  async function exclusive<T>(action: () => Promise<T>) {
    alive(); if (busy) fail('unqualified'); busy = true;
    try { return await withPlannerWriteLock(action, locks, true); } finally { busy = false; }
  }
  async function write(expected: string | null, next: FrozenRecord, n: number) {
    barrier(n); const raw = json(next);
    try {
      if (expected === null) await store.initialize(raw); else await store.cas(expected, raw);
    } catch (e) {
      // Terminal IDB abort is known-not-committed. Any unexpected post-submit
      // exception is unknown, never automatically retried or compensated.
      if (e instanceof HostError && ['aborted', 'stale', 'existing_database', 'database_blocked', 'storage_unavailable', 'database_missing', 'database_inventory_unavailable'].includes(e.code)) {
        if (e.code === 'stale' || issuedHandle && e.code !== 'aborted') stopped = true;
        throw e;
      }
      stopped = true; fail('outcome_unknown');
    }
    try {
      barrier(n); const read = await strictRead(); barrier(n);
      if (!read || read.raw !== raw || !equal(read.record, next)) fail('outcome_unknown');
      return issue(read.raw, read.record);
    } catch { stopped = true; fail('outcome_unknown'); }
  }
  return {
    async load(): Promise<NativeHandle | null> {
      const n = epoch;
      return exclusive(async () => { barrier(n); const r = await strictRead(); barrier(n); return r ? issue(r.raw, r.record) : null; });
    },
    async initialize(): Promise<NativeHandle> {
      const n = epoch;
      return exclusive(async () => {
        barrier(n);
        if (issuedHandle) { await strictRead(); fail('existing_database'); }
        if ((await store.read()).exists) fail('existing_database'); barrier(n);
        const host = await createHost(crypto.randomUUID(), sample()); barrier(n);
        return write(null, host, n);
      });
    },
    async preview(h: NativeHandle, sourceRaw: unknown): Promise<HostPreview> {
      const n = epoch, c = await sourceContext(sourceRaw, current(h).record); barrier(n);
      const p = Object.freeze({ displayJson: c.previewRaw }) as HostPreview;
      previews.set(p, { handle: h, context: c }); return p;
    },
    async prepare(p: HostPreview, activate: boolean): Promise<PreparedIntent> {
      alive(); if (typeof activate !== 'boolean') fail('input_type');
      if (active) fail('unqualified'); const v = previews.get(p); if (!v) fail('unqualified');
      const n = epoch;
      return exclusive(async () => {
        barrier(n); const r = await fresh(v.handle); barrier(n);
        const c = await sourceContext(v.context.archive.raw, r.record);
        if (!equal(c, v.context)) fail('stale'); barrier(n);
        const minted = owner.mint(r.record, activate);
        const grant: Grant = { intentId: minted.ids[0], ids: minted.ids, selection: minted.selection, allocation: minted.allocation,
          archiveSha256: await rawDigest(c.archiveRaw), previewSha256: c.preview.previewSha256, ledgerSha256: await rawDigest(c.ledgerRaw),
          floorSha256: await rawDigest(c.floorRaw), environment: sample() };
        const targets = await confirmationTargets(c, grant);
        const next = await appendHost(r.record, { kind: 'reserve', grant }); barrier(n);
        const h = await write(r.raw, next, n); barrier(n);
        const result = Object.freeze({ targetsJson: json(targets), issuedIds: owner.published(minted.ticket, minted.ids) }) as PreparedIntent;
        intents.set(result, { handle: h, context: c, grant: freeze(grant) as Grant, ticket: minted.ticket, epoch: n, targetsJson: json(targets) });
        active = result; return result;
      });
    },
    async confirm(prepared: PreparedIntent, confirmationJson: unknown): Promise<Proposal> {
      alive(); const i = intents.get(prepared); if (!i || active !== prepared) fail('unqualified'); barrier(i.epoch);
      const decision: Decision = { selection: i.grant.selection, allocation: i.grant.allocation, confirmation: parse(confirmationJson) as Decision['confirmation'] };
      const result = await receiptFor(i.context, i.grant, decision); barrier(i.epoch);
      const sealed = sealedReceipts.get(i);
      if (sealed && !equal(sealed, result.receipt)) fail('receipt_conflict');
      sealedReceipts.set(i, freeze(result.receipt) as Receipt);
      const p = Object.freeze({ decisionJson: json(decision) }) as Proposal;
      proposals.set(p, { intent: i, receipt: freeze(result.receipt) as Receipt, planJson: json(result.plan), ledgerRaw: json(result.plan.resultLedger) });
      return p;
    },
    async commit(p: Proposal) {
      alive(); const v = proposals.get(p); if (!v) fail('unqualified');
      proposals.delete(p); const i = v.intent; barrier(i.epoch);
      return exclusive(async () => {
        barrier(i.epoch); const r = await fresh(i.handle); barrier(i.epoch);
        if (!active || intents.get(active) !== i) fail('unqualified');
        owner.verify(i.ticket, i.grant.ids);
        const storedGrant = r.record.events.find(e => e.body.kind === 'reserve' && e.body.grant.intentId === i.grant.intentId);
        if (!storedGrant || storedGrant.body.kind !== 'reserve' || !equal(storedGrant.body.grant, i.grant)) fail('id_ticket');
        // Compare receipt bindings before interpreting any bare operation as no-op.
        for (const op of v.receipt.operations) if (r.record.authority.opReceipts.some(x => x.operationId === op.operationId)) fail('receipt_conflict');
        const c = await sourceContext(i.context.archive.raw, r.record);
        if (!equal(c, i.context)) fail('stale');
        const targets = await confirmationTargets(c, i.grant);
        if (json(targets) !== i.targetsJson) fail('stale');
        const checked = await receiptFor(c, i.grant, v.receipt.decision);
        if (!equal(checked.receipt, v.receipt) || json(checked.plan) !== v.planJson || json(checked.plan.resultLedger) !== v.ledgerRaw) fail('stale');
        const next = await appendHost(r.record, { kind: 'adopt', receipt: v.receipt }, v.ledgerRaw); barrier(i.epoch);
        const handle = await write(r.raw, next, i.epoch); active = null;
        return Object.freeze({ handle, receiptJson: json(v.receipt), outcomeJson: json(next.outcomes[0]) });
      });
    },
    /** Read-only acknowledgment after restart, never a stale preview re-plan. */
    async acknowledge(h: NativeHandle, receiptJson: unknown) {
      alive();
      const requested = parse(receiptJson), n = epoch;
      return exclusive(async () => {
        barrier(n); const r = await fresh(h); barrier(n);
        const receipt = r.record.receipts.find(x => equal(x, requested));
        if (!receipt) fail('receipt_conflict');
        const sha = await digest(receipt), result = r.record.outcomes.find(x => x.receiptSha256 === sha);
        if (!result) fail('invalid_host'); barrier(n);
        return json(result);
      });
    },
    /** No writes. A fresh controller is required after unknown outcome. */
    async recover(h: NativeHandle, requestJson: unknown) {
      alive();
      const request = parse(requestJson), n = epoch;
      return exclusive(async () => {
        barrier(n); const r = await fresh(h); barrier(n);
        if (!request || typeof request !== 'object' || Array.isArray(request)) fail('shape');
        const q = request as Record<string, unknown>;
        if (Object.keys(q).sort().join(',') !== 'grantId,receipt' || typeof q.grantId !== 'string') fail('shape');
        if (q.receipt !== null) {
          const receipt = r.record.receipts.find(x => equal(x, q.receipt));
          if (!receipt || receipt.grantId !== q.grantId) fail('receipt_conflict');
          return freeze({ status: 'already_committed', outcome: r.record.outcomes.find(o => o.receiptSha256 === r.record.authority.opReceipts.find(p => p.operationId === receipt.operations[0].operationId)?.receiptSha256)! });
        }
        if (r.record.receipts.some(x => x.grantId === q.grantId)) fail('receipt_conflict');
        if (!r.record.events.some(x => x.body.kind === 'reserve' && x.body.grant.intentId === q.grantId)) fail('id_ticket');
        return Object.freeze({ status: 'not_adopted_burn_retained' });
      });
    },
    cancel() { epoch++; active = null; },
    isStopped() { return stopped; },
  };
}
