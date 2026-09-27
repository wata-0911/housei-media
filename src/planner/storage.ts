import type { PlannerCatalog, PlannerState } from './plannerCatalog';
import { validateState } from './validation';

export const STORAGE_KEY = 'hosei-planner:v1';
export const BACKUP_KEY = `${STORAGE_KEY}:recovery`;
export const initialState = (): PlannerState => ({ schemaVersion: 2, selectedScopeId: null, items: [], todos: [] });
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export type LoadResult = { state: PlannerState; raw: string | null; error: string | null };

export function loadState(store: Store, catalog: PlannerCatalog): LoadResult {
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
    if (raw === null) return { state: initialState(), raw, error: null };
    const parsed: unknown = JSON.parse(raw);
    const state = migrateState(parsed);
    if (!validateState(state, catalog)) throw new Error('Invalid state');
    return { state, raw, error: null };
  } catch {
    return { state: initialState(), raw, error: '保存データを読み込めません。形式・バージョン・科目参照・重複、またはブラウザの保存設定を確認してください。元データは上書きしていません。' };
  }
}

/** v1 did not retain a confirmed completion order for 史学演習. Preserve all data and leave it unknown. */
function migrateState(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 1 || !Array.isArray(state.items)) return value;
  return {
    ...state,
    schemaVersion: 2,
    items: state.items.map(item => typeof item === 'object' && item !== null && !Array.isArray(item)
      ? { ...item as Record<string, unknown>, earnedOrder: null }
      : item),
  };
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
