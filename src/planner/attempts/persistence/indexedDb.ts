import { emptyAuthority, type AtomicAttemptStore, type AuthorityRecord } from './contracts';

const DATABASE = 'hosei-yi06-isolated-v1';
const STORE = 'authority';
// No configurable key/database name and no Storage/localStorage capability.
// Call only from the process-gated dev entry, on a separate localhost origin.
export function createIndexedDbAttemptStore(factory: IDBFactory): AtomicAttemptStore {
  let connection: Promise<IDBDatabase> | undefined;
  function open() {
    return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DATABASE, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('database_blocked'));
    });
  }
  return {
    async read() {
      // A preview on a fresh origin must not even create an empty database.
      if (!connection) {
        if (!factory.databases) throw new Error('database_inventory_unavailable');
        const existing = (await factory.databases()).find(db => db.name === DATABASE);
        if (!existing) return emptyAuthority();
        if (existing.version !== 1) throw new Error('unsupported_authority_version');
      }
      const db = await open();
      return new Promise<AuthorityRecord>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly'), req = tx.objectStore(STORE).get('current');
        let result: AuthorityRecord;
        req.onsuccess = () => { result = req.result ?? emptyAuthority(); };
        tx.oncomplete = () => resolve(result);
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error ?? new Error('read_aborted'));
      });
    },
    async commit(expected, next) {
      const db = await open();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' }), bucket = tx.objectStore(STORE);
        let failure: Error | null = null;
        const req = bucket.get('current');
        req.onsuccess = () => {
          const current: AuthorityRecord = req.result ?? emptyAuthority();
          if (current.raw !== expected.raw || current.revision !== expected.revision
            || JSON.stringify(current.committed) !== JSON.stringify(expected.committed)
            || JSON.stringify(current.issuedIds) !== JSON.stringify(expected.issuedIds)) {
            failure = new Error('stale_commit'); tx.abort(); return;
          }
          // Exactly one put, encompassing state, issuance tombstones and witness.
          try { bucket.put(next, 'current'); } catch (error) {
            failure = error instanceof Error ? error : new Error(String(error)); tx.abort();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => { failure ??= tx.error; };
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('commit_aborted'));
      });
    },
  };
}
