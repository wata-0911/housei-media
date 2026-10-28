import { emptyAuthority, type AuthorityRecord } from './contracts';
const DATABASE = 'hosei-yi06-isolated-v1';
const STORE = 'authority';
// Mechanically extracted reader; inventory first, never initializes storage.
export async function readIndexedDbAuthority(factory: IDBFactory): Promise<AuthorityRecord> {
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
    }
