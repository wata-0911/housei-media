import { DATABASE, STORE, KEY, HostError, fail, type NativeRead, type NativeStore } from './contracts';

/** Infrastructure-only adapter. Codec/qualification belong to the controller.
 * All mutation callers must hold the common exclusive Lock. No crypto awaits
 * inside active transactions. getKey distinguishes missing from stored undefined. */
export function createNativeHostStore(factory: IDBFactory): NativeStore {
  async function inventory() {
    if (!factory.databases) fail('database_inventory_unavailable');
    const entry = (await factory.databases()).find(db => db.name === DATABASE);
    if (entry && entry.version !== 1) fail('existing_database');
    return entry;
  }
  async function openExisting(): Promise<IDBDatabase> {
    if (!await inventory()) fail('database_missing');
    return new Promise((resolve, reject) => {
      const req = factory.open(DATABASE, 1); let stopped = false;
      req.onblocked = () => { stopped = true; reject(new HostError('database_blocked')); };
      req.onupgradeneeded = () => { stopped = true; req.transaction!.abort(); };
      req.onerror = () => reject(new HostError('storage_unavailable'));
      req.onsuccess = () => {
        const db = req.result; db.onversionchange = () => db.close();
        if (stopped) { db.close(); reject(new HostError('storage_unavailable')); } else resolve(db);
      };
    });
  }
  return {
    async read() {
      if (!await inventory()) return { exists: false };
      const db = await openExisting();
      return new Promise<NativeRead>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE, 'readonly'), bucket = tx.objectStore(STORE);
          const get = bucket.get(KEY), key = bucket.getKey(KEY);
          tx.oncomplete = () => { db.close(); resolve({ exists: true, value: get.result, keyExists: key.result !== undefined }); };
          tx.onabort = () => { db.close(); reject(new HostError('storage_unavailable')); };
        } catch { db.close(); reject(new HostError('storage_unavailable')); }
      });
    },
    async initialize(raw) {
      if (typeof raw !== 'string') fail('input_type');
      if (await inventory()) fail('existing_database');
      return new Promise<void>((resolve, reject) => {
        const req = factory.open(DATABASE, 1); let upgraded = false, stopped = false, submitted = false;
        req.onblocked = () => { stopped = true; reject(new HostError('database_blocked')); };
        req.onupgradeneeded = e => {
          if (stopped || e.oldVersion !== 0) { stopped = true; req.transaction!.abort(); return; }
          upgraded = true;
          try { const bucket = req.result.createObjectStore(STORE); bucket.put(raw, KEY); submitted = true; }
          catch { req.transaction!.abort(); }
        };
        req.onerror = () => reject(new HostError('aborted'));
        req.onsuccess = () => {
          req.result.close();
          if (stopped || !upgraded) reject(new HostError('existing_database'));
          else if (!submitted) reject(new HostError('outcome_unknown'));
          else resolve();
        };
      });
    },
    async cas(expected, next) {
      if (typeof expected !== 'string' || typeof next !== 'string') fail('input_type');
      const db = await openExisting();
      return new Promise<void>((resolve, reject) => {
        let tx: IDBTransaction | undefined;
        let reason: HostError | undefined;
        function abort() {
          reason ??= new HostError('aborted');
          try { tx!.abort(); }
          catch { db.close(); reject(new HostError('outcome_unknown')); }
        }
        try {
          tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
          // Install terminal observers before issuing requests. A synchronous
          // failure after transaction creation must abort and await termination.
          tx.onabort = () => { db.close(); reject(reason ?? new HostError('aborted')); };
          tx.oncomplete = () => { db.close(); resolve(); };
          const bucket = tx.objectStore(STORE), get = bucket.get(KEY), key = bucket.getKey(KEY);
          key.onsuccess = () => {
            try {
              if (key.result === undefined || typeof get.result !== 'string' || get.result !== expected) {
                reason = new HostError('stale'); abort(); return;
              }
              bucket.put(next, KEY);
            } catch { abort(); }
          };
        } catch {
          if (!tx) { db.close(); reject(new HostError('storage_unavailable')); }
          else abort();
        }
      });
    },
  };
}
