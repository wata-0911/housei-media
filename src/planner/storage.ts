import type { PlannerCatalog, PlannerState } from './plannerCatalog';
import { validateState } from './validation';

export const STORAGE_KEY = 'hosei-planner:v1';
export const BACKUP_KEY = `${STORAGE_KEY}:recovery`;
export const initialState = (): PlannerState => ({ schemaVersion: 1, selectedScopeId: null, items: [], todos: [] });
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export type LoadResult = { state: PlannerState; raw: string | null; error: string | null };

export function loadState(store: Store, catalog: PlannerCatalog): LoadResult {
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
    if (raw === null) return { state: initialState(), raw, error: null };
    const parsed: unknown = JSON.parse(raw);
    if (!validateState(parsed, catalog)) throw new Error('Invalid state');
    return { state: parsed, raw, error: null };
  } catch {
    return { state: initialState(), raw, error: '保存データを読み込めません。形式・バージョン・科目参照・重複、またはブラウザの保存設定を確認してください。元データは上書きしていません。' };
  }
}

// Compare before writes so another tab's changes are not silently replaced.
export function saveState(store: Store, state: PlannerState, expectedRaw: string | null, catalog: PlannerCatalog): string {
  if (!validateState(state, catalog)) throw new Error('保存データの形式が不正です。');
  if (store.getItem(STORAGE_KEY) !== expectedRaw) throw new Error('別の画面で保存データが変更されました。再読み込みしてください。');
  const raw = JSON.stringify(state);
  store.setItem(STORAGE_KEY, raw);
  return raw;
}

export function recoverState(store: Store, expectedRaw: string, catalog: PlannerCatalog): string {
  if (store.getItem(STORAGE_KEY) !== expectedRaw) throw new Error('保存データが変更されました。再読み込みしてください。');
  // Keep the exact original bytes; if backup fails, do not reset the primary key.
  store.setItem(BACKUP_KEY, expectedRaw);
  return saveState(store, initialState(), expectedRaw, catalog);
}
