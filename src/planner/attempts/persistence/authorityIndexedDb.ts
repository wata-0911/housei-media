import { emptyAuthority, type AtomicAttemptStore, type AuthorityRecord } from './contracts';
import { requireAttemptAuthority } from './authorityFormat';
import { sameAttemptData } from '../validation';
import { isAuthorityJsonTree } from './authorityData';
import { freeze } from '../migration/contracts';
import { missingHistory } from './reservationBudget';

const DATABASE = 'hosei-yi06-isolated-v1';
const STORE = 'authority';
// Fixed isolated database. Reads never initialize it; first commit creates the
// store AND current record in the same versionchange transaction.
export function createAuthorityIndexedDbStore(factory: IDBFactory): AtomicAttemptStore & { protectOriginal(): Promise<string>; commit(expected: AuthorityRecord, next: AuthorityRecord, beforePut?: () => void): Promise<void> } {
    async function readOriginal(): Promise<{ exists: false } | { exists: true; value: unknown; keyExists: boolean }> {
      if (!factory.databases) throw new Error('database_inventory_unavailable');
      const existing = (await factory.databases()).find(db => db.name === DATABASE);
      if (!existing) return { exists: false };
      if (existing.version !== 1) throw new Error('unsupported_authority_version');
      return new Promise((resolve, reject) => {
        const req = factory.open(DATABASE, 1);
        let stopped = false;
        req.onupgradeneeded = () => { req.transaction!.abort(); };
        req.onerror = () => reject(req.error ?? new Error('read_open_failed'));
        req.onblocked = () => { stopped = true; reject(new Error('database_blocked')); };
        req.onsuccess = () => {
          const db = req.result; db.onversionchange = () => db.close();
          if (stopped) { db.close(); return; }
          try {
            const tx = db.transaction(STORE, 'readonly'), bucket = tx.objectStore(STORE);
            const get = bucket.get('current'), key = bucket.getKey('current');
            tx.oncomplete = () => { db.close(); resolve({ exists: true, value: get.result, keyExists: key.result !== undefined }); };
            tx.onabort = () => { db.close(); reject(tx.error ?? new Error('read_aborted')); };
          } catch (error) { db.close(); reject(error); }
        };
      });
    }
  return {
    async protectOriginal() {
      // Preserve foreign string bytes too. This is diagnostic protection, never
      // an Attempt backup and never permission to import/reset the host registry.
      const original = await readOriginal();
      // stored undefined has an explicit tag below; nested undefined, Map,
      // Date, non-finite numbers, extended arrays, etc. have no lossless JSON.
      if (original.exists && original.value !== undefined && !isAuthorityJsonTree(original.value))
        throw new Error('protection_unrepresentable: original remains in IndexedDB');
      return JSON.stringify({ format: 'hosei-authority-record-protection', protectionVersion: 1,
        database: DATABASE, store: STORE, key: 'current', ...original,
        ...(original.exists && original.value === undefined ? { valueType: 'undefined' } : {}) });
    },
    async read() {
      const original = await readOriginal();
      if (!original.exists) return emptyAuthority();
      if (!original.keyExists) throw new Error('authority_record_missing');
      requireAttemptAuthority(original.value);
      return original.value;
    },
    async commit(expected, next, beforePut: () => void = () => {}) {
      // Inspect originals before clone can erase unknown properties or aliases.
      requireAttemptAuthority(expected); requireAttemptAuthority(next);
      const expectedSnapshot = freeze(structuredClone(expected));
      const nextSnapshot = freeze(structuredClone(next));
      requireAttemptAuthority(expectedSnapshot); requireAttemptAuthority(nextSnapshot);
      if (nextSnapshot.revision !== expectedSnapshot.revision + 1 || nextSnapshot.raw === null
        || missingHistory(expectedSnapshot.committed, nextSnapshot.committed).length
        || missingHistory(expectedSnapshot.issuedIds, nextSnapshot.issuedIds).length)
        throw new Error('authority_history_regression');
      return new Promise<void>((resolve, reject) => {
        const req = factory.open(DATABASE, 1);
        let failure: Error | null = null, upgraded = false, stopped = false;
        function write(tx: IDBTransaction, bucket: IDBObjectStore, close: () => void) {
          const get = bucket.get('current'), key = bucket.getKey('current');
          key.onsuccess = () => {
            let current: AuthorityRecord;
            try {
              if (key.result === undefined && !upgraded) throw new Error('authority_record_missing');
              current = key.result === undefined ? emptyAuthority() : get.result;
              requireAttemptAuthority(current);
            } catch {
              // Foreign/missing current cannot match a verified Attempt
              // expectation. Keep the existing CAS error contract; read()
              // supplies the specific format diagnosis without any write.
              failure = new Error('stale_commit'); tx.abort(); return;
            }
            if (!sameAttemptData(current, expectedSnapshot)) {
              failure = new Error('stale_commit'); tx.abort(); return;
            }
            try {
              // Synchronous host check inside BOTH transaction kinds. Nothing
              // asynchronous may run between this check and scheduling put.
              // Caller-owned objects may change while open/transaction waits.
              // They can only cancel this call, never change its CAS or put.
              requireAttemptAuthority(expected); requireAttemptAuthority(next);
              if (!sameAttemptData(expected, expectedSnapshot) || !sameAttemptData(next, nextSnapshot))
                throw new Error('authority_input_changed');
              beforePut(); bucket.put(nextSnapshot, 'current');
            }
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
