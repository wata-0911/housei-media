import type { PlannerCatalog } from './plannerCatalog';
import { parsePlannerBackup } from './plannerBackup';
import { STORAGE_KEY, withPlannerWriteLock, type LoadResult, type PlannerWriteLocks } from './storage';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** Revalidate the original preview text, then replace only the primary key once.
 * localStorage setItem is atomic on failure. Never touch the old recovery key,
 * run applyImport/migration, or attempt a rollback that could clobber another tab. */
export async function restorePlannerBackup(store: Store, text: string, expectedRaw: string | null, catalog: PlannerCatalog, locks: PlannerWriteLocks | undefined): Promise<LoadResult> {
  const backup = await parsePlannerBackup(text, catalog);
  const raw = JSON.stringify(backup.state);
  return withPlannerWriteLock(() => {
    if (store.getItem(STORAGE_KEY) !== expectedRaw) throw new Error('プレビュー後に保存データが変更されました。再読み込みして、もう一度ファイルを選択してください。');
    store.setItem(STORAGE_KEY, raw);
    return { state: backup.state, raw, error: null };
  }, locks, true);
}
