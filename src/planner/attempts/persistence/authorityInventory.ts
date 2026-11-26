/** Read-only, current-document database-name diagnostic.
 * This is not an authority reader, write permission, or a cross-tab lease.
 * No production save/restore/recover path imports this isolated candidate.
 */
export const AUTHORITY_DATABASE_NAME = 'hosei-yi06-isolated-v1' as const;

export type AuthorityInventory = Readonly<
  | { status: 'ABSENT'; scope: 'current-document' }
  | { status: 'PRESENT'; scope: 'current-document' }
  | { status: 'UNKNOWN'; scope: 'current-document'; reason: 'no_window' | 'opaque_origin' | 'factory_unavailable' | 'api_unavailable' | 'inventory_failed' | 'incomplete_inventory' }
>;

const absent = (): AuthorityInventory => ({ status: 'ABSENT', scope: 'current-document' });
const present = (): AuthorityInventory => ({ status: 'PRESENT', scope: 'current-document' });
const unknown = (reason: Extract<AuthorityInventory, { status: 'UNKNOWN' }>['reason']): AuthorityInventory =>
  ({ status: 'UNKNOWN', scope: 'current-document', reason });

/** The browser wrapper takes its factory from this document only. Node tests
 * install an explicit fake window; there is no browser memory fallback. */
export async function readBrowserAuthorityInventory(): Promise<AuthorityInventory> {
  if (typeof window === 'undefined') return unknown('no_window');
  try {
    if (window.location.origin === 'null') return unknown('opaque_origin');
  } catch { return unknown('opaque_origin'); }

  let factory: IDBFactory;
  try { factory = window.indexedDB; }
  catch { return unknown('factory_unavailable'); }
  if (!factory) return unknown('factory_unavailable');
  let listDatabases: IDBFactory['databases'];
  try { listDatabases = factory.databases; }
  catch { return unknown('api_unavailable'); }
  if (typeof listDatabases !== 'function') return unknown('api_unavailable');

  let rows: IDBDatabaseInfo[];
  try { rows = await listDatabases.call(factory); }
  catch { return unknown('inventory_failed'); }
  if (!Array.isArray(rows)) return unknown('incomplete_inventory');

  let incomplete = false;
  try {
    for (const row of rows) {
      if (!row || typeof row.name !== 'string') { incomplete = true; continue; }
      if (row.name === AUTHORITY_DATABASE_NAME) return present();
    }
  } catch { return unknown('incomplete_inventory'); }
  return incomplete ? unknown('incomplete_inventory') : absent();
}
