import { readBrowserAuthorityInventory } from '../attempts/persistence/authorityInventory';
import { BACKUP_KEY, STORAGE_KEY, type PlannerWriteLocks } from './storagePrimitives';

type Store = Pick<Storage, 'getItem'>;

/** This guard is only for browser entry points that hold the shared exclusive
 * planner lock until their synchronous legacy write finishes. ABSENT is a
 * lease-local observation, never a durable permission or authority receipt. */
export async function assertLegacyWriteAllowed(
  store: Store, expectedPrimary: string | null, expectedRecovery: string | null,
): Promise<void> {
  const inventory = await readBrowserAuthorityInventory();
  if (inventory.status !== 'ABSENT') {
    throw new Error('新しい計画の保存領域を確認できないか、存在します。旧プランナーは閲覧のみ可能です。');
  }
  if (store.getItem(STORAGE_KEY) !== expectedPrimary || store.getItem(BACKUP_KEY) !== expectedRecovery) {
    throw new Error('別の画面で保存データまたは退避データが変更されました。再読み込みしてください。');
  }
}

/** Do not silently fall back to an uncoordinated write in a browser. */
export function requireBrowserWriteLock(locks: PlannerWriteLocks | undefined): void {
  if (typeof window !== 'undefined' && !locks) {
    throw new Error('このブラウザでは安全な保存に必要なWeb Locksを利用できません。');
  }
}
