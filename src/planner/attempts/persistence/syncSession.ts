import { createAttemptPersistence, type PersistenceHandle, type PersistencePreview } from './controller';
import { decodeAuthorityJson } from './contractDecoders';
import { replayState } from './codec';
import { createWorkbenchIdentityOwner } from '../workbench/sessionIdentities';
import type { Command, Workspace } from '../workbench/operations';

/** Synchronous UI session. Only this controller's real handles may mint IDs.
 * No new persistence semantics: storage/commit/export remain the old controller.
 * Session burns deliberately do NOT enter its persisted authority (PR4). */
export function createSynchronousAttemptSession(...args: [Parameters<typeof createAttemptPersistence>[0], Parameters<typeof createAttemptPersistence>[1], Parameters<typeof createAttemptPersistence>[2]?, Parameters<typeof createAttemptPersistence>[3]?]) {
  const [store, locks, environment, maxBytes] = args;
  const live = new WeakMap<PersistenceHandle, Workspace>();
  let active: PersistenceHandle | undefined;
  let checkingHandle: PersistenceHandle | undefined;
  const owner = createWorkbenchIdentityOwner(() => {
    if (!active || !live.has(active)) throw new Error('unverified_identity_handle');
    return [active.source, active.state, live.get(active)];
  }, () => active);
  const controller = createAttemptPersistence({
    async read() {
      // Capture and validate THIS read before importing restrictions. Concurrent
      // operations may finish in any order; none can replace another's snapshot.
      const snapshot = structuredClone(await store.read());
      const checked = await decodeAuthorityJson(JSON.stringify(snapshot));
      if (checked.authorityKind !== 'legacy') throw new Error('unsupported_authority_version');
      owner.restrict(checked.value.issuedIds);
      // This is only a monotonic restriction, never a handle/save qualification.
      // The controller still performs its own source/environment and trust checks.
      return checked.value;
    },
    commit: (expected, next) => store.commit(expected, next),
  }, locks, environment, maxBytes, { issued: id => owner.restrict([id]), reserved: () => owner.reservations(), beforeCommand: (workspace, command) => owner.check(workspace, command, checkingHandle) });
  async function handle(h: PersistenceHandle) {
    const replay = await replayState(h.state);
    owner.restrict(replay.requiredReservations); live.set(h, h.workspace); return h;
  }
  async function preview(p: PersistencePreview) { await handle(p.handle); return p; }
  return { ...controller,
    async load() { const h = await controller.load(); return h ? handle(h) : null; },
    async prepareNewPlan() { return preview(await controller.prepareNewPlan()); },
    async prepareMigration(...a: Parameters<typeof controller.prepareMigration>) { return preview(await controller.prepareMigration(...a)); },
    async inspectBackup(...a: Parameters<typeof controller.inspectBackup>) { return preview(await controller.inspectBackup(...a)); },
    async prepareEdits(...a: Parameters<typeof controller.prepareEdits>) { checkingHandle = a[0]; return preview(await controller.prepareEdits(...a)); },
    async commit(...a: Parameters<typeof controller.commit>) { return handle(await controller.commit(...a)); },
    dispatch(h: PersistenceHandle, workspace: Workspace, command: Command) {
      if (!live.has(h) || live.get(h) !== workspace) throw new Error('unverified_identity_workspace');
      checkingHandle = h;
      const next = controller.dispatch(h, workspace, command); live.set(h, next); return next;
    },
    identities(h: PersistenceHandle) {
      if (!live.has(h)) throw new Error('unverified_identity_handle');
      // Each facade stays tied to its verified handle, even across other forms.
      return Object.freeze(Object.fromEntries(Object.entries(owner.ids).map(([key, mint]) => [key, () => { active = h; return mint(); }]))) as typeof owner.ids;
    },
  };
}
