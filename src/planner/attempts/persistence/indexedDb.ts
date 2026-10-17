import { emptyAuthority, type AtomicAttemptStore, type AuthorityRecord } from './contracts';

const DATABASE = 'hosei-yi06-isolated-v1';
const STORE = 'authority';
// Fixed isolated database. Reads never initialize it; first commit creates the
// store AND current record in the same versionchange transaction.
export function createIndexedDbAttemptStore(factory: IDBFactory): AtomicAttemptStore {
  return {
    async read() {
      if (!factory.databases) throw new Error('database_inventory_unavailable');
      const existing = (await factory.databases()).find(db => db.name === DATABASE);
      if (!existing) return emptyAuthority();
      if (existing.version !== 1) throw new Error('unsupported_authority_version');
      return new Promise<AuthorityRecord>((resolve, reject) => {
        const req = factory.open(DATABASE, 1);
        let stopped = false;
        req.onupgradeneeded = () => { req.transaction!.abort(); };
        req.onerror = () => reject(req.error ?? new Error('read_open_failed'));
        req.onblocked = () => { stopped = true; reject(new Error('database_blocked')); };
        req.onsuccess = () => {
          const db = req.result; db.onversionchange = () => db.close();
          if (stopped) { db.close(); return; }
          try {
            const tx = db.transaction(STORE, 'readonly'), get = tx.objectStore(STORE).get('current');
            let value: AuthorityRecord;
            get.onsuccess = () => { value = get.result ?? emptyAuthority(); };
            tx.oncomplete = () => { db.close(); resolve(value); };
            tx.onabort = () => { db.close(); reject(tx.error ?? new Error('read_aborted')); };
          } catch (error) { db.close(); reject(error); }
        };
      });
    },
    async commit(expected, next) {
      return new Promise<void>((resolve, reject) => {
        const req = factory.open(DATABASE, 1);
        let failure: Error | null = null, upgraded = false, stopped = false;
        function write(tx: IDBTransaction, bucket: IDBObjectStore, close: () => void) {
          const get = bucket.get('current');
          get.onsuccess = () => {
            const current: AuthorityRecord = get.result ?? emptyAuthority();
            if (current.raw !== expected.raw || current.revision !== expected.revision
              || JSON.stringify(current.committed) !== JSON.stringify(expected.committed)
              || JSON.stringify(current.issuedIds) !== JSON.stringify(expected.issuedIds)) {
              failure = new Error('stale_commit'); tx.abort(); return;
            }
            try { bucket.put(next, 'current'); }
            catch (error) { failure = error instanceof Error ? error : new Error(String(error)); tx.abort(); }
          };
          tx.onerror = () => { failure ??= tx.error; };
          tx.onabort = () => { close(); reject(failure ?? tx.error ?? new Error('commit_aborted')); };
          // For initialization, open.onsuccess fires only after this transaction
          // commits. Existing databases resolve on this transaction's completion.
          if (!upgraded) tx.oncomplete = () => { close(); resolve(); };
        }
        req.onblocked = () => { stopped = true; reject(new Error('database_blocked')); };
        req.onupgradeneeded = () => {
          upgraded = true;
          if (stopped) { req.transaction!.abort(); return; }
          const db = req.result;
          try { write(req.transaction!, db.createObjectStore(STORE), () => db.close()); }
          catch (error) { failure = error instanceof Error ? error : new Error(String(error)); req.transaction!.abort(); }
        };
        req.onerror = () => reject(failure ?? req.error ?? new Error('commit_open_failed'));
        req.onsuccess = () => {
          const db = req.result; db.onversionchange = () => db.close();
          if (stopped) { db.close(); return; }
          if (upgraded) { db.close(); resolve(); return; }
          try {
            const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
            write(tx, tx.objectStore(STORE), () => db.close());
          } catch (error) { db.close(); reject(error); }
        };
      });
    },
  };
}
