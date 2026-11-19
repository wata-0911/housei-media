import { readBrowserAuthorityInventory } from '../attempts/persistence/authorityInventory';
import { BACKUP_KEY, STORAGE_KEY } from '../backup/storagePrimitives';

export function createBootPreflight(store: Pick<Storage, 'getItem'>, workers: ServiceWorkerContainer | undefined) {
  const listeners = new Set<() => void>();
  let blocked = false;

  function hold() {
    if (blocked) return;
    blocked = true;
    listeners.forEach(notify => notify());
  }

  // A change in controller invalidates this document even if it later returns to null.
  workers?.addEventListener('controllerchange', hold);

  function checkLocal() {
    try {
      if (blocked || !workers || workers.controller !== null
        || store.getItem(STORAGE_KEY) !== null || store.getItem(BACKUP_KEY) !== null) {
        throw new Error('Planner origin is not clear');
      }
    } catch (error) {
      hold();
      throw error;
    }
  }

  async function check() {
    try {
      checkLocal();
      const registrations = await workers?.getRegistrations();
      if (!Array.isArray(registrations) || registrations.length !== 0) {
        throw new Error('Service Worker isolation is not confirmed');
      }
      const inventory = await readBrowserAuthorityInventory();
      if (inventory.status !== 'ABSENT') throw new Error('IndexedDB isolation is not confirmed');
      checkLocal();
    } catch (error) {
      hold();
      throw error;
    }
  }

  return {
    check, checkLocal,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (blocked) listener();
      return () => { listeners.delete(listener); };
    },
  };
}

export type BootPreflight = ReturnType<typeof createBootPreflight>;
