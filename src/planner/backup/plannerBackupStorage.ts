import type { PlannerCatalog } from '../plannerCatalog';
import { parsePlannerBackup } from './plannerBackup';
import { STORAGE_KEY, BACKUP_KEY, withPlannerWriteLock, type LoadResult, type PlannerWriteLocks } from './storage';
import { assertLegacyWriteAllowed } from './legacyWriteFence';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** Revalidate the original preview text, then replace only the primary key once.
 * localStorage setItem is atomic on failure. Never touch the old recovery key,
 * run applyImport/migration, or attempt a rollback that could clobber another tab. */
export async function restorePlannerBackup(store: Store, text: string, expectedRaw: string | null, catalog: PlannerCatalog, locks: PlannerWriteLocks | undefined): Promise<LoadResult> {
  return restorePlannerBackupWithIntent(store, text, expectedRaw, catalog, locks, () => true);
}

/** UI-only entry: the operation must still own its preview and consent when the
 * existing lock reaches the first write. The public five-argument API remains unchanged. */
export async function restorePlannerBackupWithIntent(store: Store, text: string, expectedRaw: string | null, catalog: PlannerCatalog, locks: PlannerWriteLocks | undefined, isCurrent: () => boolean, snapshot?: { recoveryRaw: string | null }): Promise<LoadResult> {
  const recoveryRaw = snapshot ? snapshot.recoveryRaw : store.getItem(BACKUP_KEY);
  const backup = await parsePlannerBackup(text, catalog);
  const raw = JSON.stringify(backup.state);
  return withPlannerWriteLock(async () => {
    if (typeof window !== 'undefined') await assertLegacyWriteAllowed(store, expectedRaw, recoveryRaw);
    if (store.getItem(STORAGE_KEY) !== expectedRaw) throw new Error('プレビュー後に保存データが変更されました。再読み込みして、もう一度ファイルを選択してください。');
    if (snapshot && store.getItem(BACKUP_KEY) !== recoveryRaw) throw new Error('保護対象の退避データが変更されました。もう一度ファイルを選択してください。');
    if (!isCurrent()) throw new Error('復元操作が失効しました。ファイルを選び直して、もう一度確認してください。');
    store.setItem(STORAGE_KEY, raw);
    return { state: backup.state, raw, error: null };
  }, locks, true);
}
