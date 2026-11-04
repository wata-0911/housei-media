import { DATABASE, STORE, KEY, HostError, fail } from '../contracts';

/** Creation only. Never opens an existing transaction for replacement. Callers
 * hold the common Lock; the synchronous barrier runs at the actual put fence.
 * Existing host nativeStore/verifiers are deliberately unchanged. */
export async function createRestoredHost(factory: IDBFactory, raw: string, beforeSubmit: () => void): Promise<void> {
  if (!factory.databases) fail('database_inventory_unavailable');
  if ((await factory.databases()).some(d => d.name === DATABASE)) fail('existing_database');
  beforeSubmit();
  return new Promise<void>((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    let upgraded = false, abandoned = false, submitted = false, completed = false;
    let diagnosis: unknown;
    request.onblocked = () => { abandoned = true; reject(new HostError('database_blocked')); };
    request.onupgradeneeded = event => {
      const tx = request.transaction!;
      // Install terminal handlers before any object store/put can throw.
      tx.onabort = () => { reject(diagnosis ?? new HostError('aborted')); };
      tx.oncomplete = () => { completed = true; };
      if (abandoned || event.oldVersion !== 0) {
        diagnosis = new HostError('existing_database'); tx.abort(); return;
      }
      upgraded = true;
      try {
        beforeSubmit();
        const store = request.result.createObjectStore(STORE);
        beforeSubmit();
        store.put(raw, KEY); submitted = true;
      } catch (e) {
        // A synchronous put exception is known-not-committed only after abort.
        diagnosis = e instanceof HostError ? e : new HostError('aborted');
        try { tx.abort(); } catch { diagnosis = new HostError('outcome_unknown'); reject(diagnosis); }
      }
    };
    request.onerror = () => reject(diagnosis ?? new HostError('aborted'));
    request.onsuccess = () => {
      try {
        request.result.close();
        if (abandoned || !upgraded) reject(new HostError('existing_database'));
        else if (!submitted || !completed) reject(new HostError('outcome_unknown'));
        else resolve();
      } catch { reject(new HostError('outcome_unknown')); }
    };
  });
}
