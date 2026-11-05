import { withPlannerWriteLock, STORAGE_KEY, BACKUP_KEY, type PlannerWriteLocks } from '../../../backup/storagePrimitives';
import { DATABASE, STORE, KEY, HostError, fail, type NativeRead } from '../contracts';
import { createNativeHostStore } from '../nativeStore';
import { decodeNativeRecord } from '../dispatch';
import { environment as v1Environment, equal, digest, freeze, json } from '../codec';
import { environment as v2Environment } from '../codecV2';
import { inspectBackupBytes, packBackup, readSelectedFile } from './codec';
import { parseBackupJson, keys } from './json';
import { fail as backupFail } from './contracts';
import { createRestoredHost } from './restoreStore';

declare const intentBrand: unique symbol, proposalBrand: unique symbol;
export type RestoreIntent = { readonly [intentBrand]: true; readonly targetsJson: string; readonly targetSha256: string };
export type RestoreProposal = { readonly [proposalBrand]: true; readonly confirmationJson: string };
type Environment = { origin: string; database: typeof DATABASE; store: typeof STORE; key: typeof KEY };
type Observation = { exists: false } | { exists: true; raw: string };
type Confirmation = { targetSha256: string; confirmed: true; reason: string };

/** Infrastructure arguments are supplied by trusted assembly for ONE storage
 * bucket. Neither file contents nor public integrity results can construct live
 * qualification. This internal API is not connected to production UI. */
export function createGradeImportBackupController(factory: IDBFactory, locks: PlannerWriteLocks | undefined,
  origin: string, storage: Pick<Storage, 'getItem'>,
  environmentProvider: () => Environment = () => ({ origin, database: DATABASE, store: STORE, key: KEY })) {
  const native = createNativeHostStore(factory), environment: Environment = { origin, database: DATABASE, store: STORE, key: KEY };
  v1Environment(origin); // validate the origin without I/O
  type Selected = Awaited<ReturnType<typeof readSelectedFile>>;
  type Intent = { selected: Selected; epoch: number; observation: Observation; confirmation?: Confirmation };
  const intents = new WeakMap<RestoreIntent, Intent>(), proposals = new WeakMap<RestoreProposal, Intent>();
  let stopped = false, busy = false, epoch = 0, observed: Observation | null = null;
  const alive = () => { if (stopped) fail('session_stopped'); };
  function sample() {
    try { if (!equal(environmentProvider(), environment)) fail('stale'); }
    catch (e) { stopped = true; throw e; }
  }
  function barrier(n: number) { alive(); if (n !== epoch) fail('cancelled'); sample(); }
  function noLegacyStorage() {
    try {
      if (storage.getItem(STORAGE_KEY) !== null || storage.getItem(BACKUP_KEY) !== null) backupFail('legacy_storage');
    } catch (e) { stopped = true; throw e; }
  }
  async function exclusive<T>(action: () => Promise<T>) {
    alive(); if (busy) fail('unqualified'); busy = true;
    try { return await withPlannerWriteLock(action, locks, true); } finally { busy = false; }
  }
  async function verifyNative(data: NativeRead) {
    if (!data.exists) return null;
    if (!data.keyExists || typeof data.value !== 'string') fail('invalid_host');
    const record = await decodeNativeRecord(data.value);
    if (!equal(record.environment, record.hostVersion === 1 ? v1Environment(origin) : v2Environment(origin))) fail('stale');
    return { raw: data.value, record };
  }
  async function read(expected: Observation | null = observed) {
    try {
      const result = await verifyNative(await native.read()); sample();
      const observation: Observation = result ? { exists: true, raw: result.raw } : { exists: false };
      if (expected && !equal(expected, observation)) fail('stale');
      observed = observation;
      return { result, observation };
    } catch (e) {
      if (observed) stopped = true;
      throw e; // preserve first diagnosis, including historical decoder errors
    }
  }
  return {
    async exportBackup() {
      const n = epoch;
      return exclusive(async () => {
        barrier(n); const { result } = await read(); barrier(n);
        if (!result) backupFail('no_host');
        const bytes = await packBackup(result.raw); barrier(n);
        const checked = await inspectBackupBytes(bytes); barrier(n);
        const final = await read(); barrier(n);
        if (!final.result || final.result.raw !== checked.raw || !equal(final.result.record, checked.record)) {
          stopped = true; fail('stale');
        }
        return new File([bytes.slice().buffer], `g03-${checked.backup.summary.hostId}.json`, { type: 'application/json' });
      });
    },
    async prepareRestore(file: File): Promise<RestoreIntent> {
      alive(); const n = epoch, selected = await readSelectedFile(file); barrier(n);
      if (selected.checked.backup.summary.origin !== origin) fail('stale');
      return exclusive(async () => {
        barrier(n); noLegacyStorage();
        const current = await read(); barrier(n); noLegacyStorage();
        if (current.result && current.result.raw !== selected.checked.raw) fail('existing_database');
        const r = selected.checked.record, ledger = JSON.parse(r.ledgerRaw);
        const targets = { fileName: selected.name, fileByteLength: selected.bytes.length, fileSha256: selected.checked.fileSha256,
          recordSha256: selected.checked.backup.record.sha256, summary: selected.checked.backup.summary,
          destination: environment, disposition: current.result ? 'already_present' : 'create',
          reservations: { host: r.authority.reservedIds.length, issued: ledger.issuedIds.length, floor: ledger.reservedIds.length,
            unconsumedGrants: selected.checked.backup.summary.grantCount - r.authority.consumedGrantIds.length },
          revisions: ledger.view.revisions.map((x: { id: string; achievementId: string; record: { earnedCredits: unknown } }) =>
            ({ id: x.id, achievementId: x.achievementId, earnedCredits: x.record.earnedCredits })),
          guarantees: { localAdoption: true, issuerAuthenticated: false, completeExternalBurnsProven: false, restoreHistoryProven: false } };
        const intent = Object.freeze({ targetsJson: json(targets), targetSha256: await digest(targets) }) as RestoreIntent;
        barrier(n); intents.set(intent, { selected, epoch: n, observation: current.observation }); return intent;
      });
    },
    async confirmRestore(intent: RestoreIntent, confirmationJson: unknown): Promise<RestoreProposal> {
      alive(); const i = intents.get(intent); if (!i) fail('unqualified'); barrier(i.epoch);
      if (typeof confirmationJson !== 'string') backupFail('input_type');
      const c = parseBackupJson(confirmationJson); keys(c, ['targetSha256', 'confirmed', 'reason']);
      if (c.confirmed !== true || c.targetSha256 !== intent.targetSha256 || typeof c.reason !== 'string' || !c.reason.trim()) backupFail('confirmation_required');
      if (i.confirmation && !equal(i.confirmation, c)) fail('receipt_conflict');
      i.confirmation = freeze(c as Confirmation);
      const proposal = Object.freeze({ confirmationJson: json(c) }) as RestoreProposal;
      proposals.set(proposal, i); return proposal;
    },
    async commitRestore(proposal: RestoreProposal) {
      alive(); const i = proposals.get(proposal); if (!i || !i.confirmation) fail('unqualified');
      proposals.delete(proposal);
      return exclusive(async () => {
        barrier(i.epoch); noLegacyStorage();
        const current = await read(i.observation); barrier(i.epoch);
        const checked = await inspectBackupBytes(i.selected.bytes); barrier(i.epoch); noLegacyStorage();
        if (checked.raw !== i.selected.checked.raw || !equal(checked, i.selected.checked)) { stopped = true; fail('stale'); }
        if (current.result) {
          if (current.result.raw !== checked.raw) fail('existing_database');
          stopped = true; return Object.freeze({ status: 'already_present' as const, recordSha256: checked.backup.record.sha256 });
        }
        try {
          // The store invokes this barrier again in the actual versionchange
          // handler immediately BEFORE put, after its async inventory/open wait.
          await createRestoredHost(factory, checked.raw, () => { barrier(i.epoch); noLegacyStorage(); });
        } catch (e) {
          if (e instanceof HostError && ['aborted', 'cancelled', 'stale', 'existing_database', 'database_blocked',
            'database_inventory_unavailable'].includes(e.code)) {
            if (e.code !== 'aborted' && e.code !== 'cancelled') stopped = true;
            throw e;
          }
          stopped = true; fail('outcome_unknown');
        }
        try {
          barrier(i.epoch); noLegacyStorage();
          const final = await read({ exists: true, raw: checked.raw }); barrier(i.epoch); noLegacyStorage();
          if (!final.result || final.result.raw !== checked.raw || !equal(final.result.record, checked.record)) fail('outcome_unknown');
          stopped = true;
          return Object.freeze({ status: 'restored' as const, recordSha256: checked.backup.record.sha256 });
        } catch { stopped = true; fail('outcome_unknown'); }
      });
    },
    /** Current snapshot existence only; NOT a durable restore operation ack. */
    async queryRestore(file: File) {
      alive(); const n = epoch, selected = await readSelectedFile(file); barrier(n);
      if (selected.checked.backup.summary.origin !== origin) fail('stale');
      return exclusive(async () => {
        barrier(n);
        try {
          noLegacyStorage(); const current = await read(); barrier(n); noLegacyStorage();
          return Object.freeze({ status: !current.result ? 'not_present' as const
            : current.result.raw === selected.checked.raw ? 'already_present' as const : 'conflict_or_unresolved' as const });
        } catch (e) {
          // Cancellation/environment invalidation must never turn into a query
          // result. Corrupt/foreign/inaccessible current stays untouched.
          if (n !== epoch || e instanceof HostError && ['stale', 'cancelled', 'session_stopped'].includes(e.code)) throw e;
          stopped = true; return Object.freeze({ status: 'conflict_or_unresolved' as const });
        }
      });
    },
    cancel() { epoch++; },
    isStopped() { return stopped; },
  };
}
