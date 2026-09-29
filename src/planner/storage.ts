import type { PlannerCatalog, PlannerState } from './plannerCatalog';
import { validateState } from './validation';

export const STORAGE_KEY = 'hosei-planner:v1';
export const BACKUP_KEY = `${STORAGE_KEY}:recovery`;
export const initialState = (): PlannerState => ({ schemaVersion: 9, selectedScopeId: null, thesisSelection: 'undecided', items: [], publicCourses: [], todos: [], mediaSchoolingProgress: {}, courseEvaluations: {}, correspondenceProgress: {}, importedStudyRecords: [] });
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

/** Preserve all prior planner data while adding fields introduced by each state version. */
function migrateState(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const state = value as Record<string, unknown>;
  if (!Array.isArray(state.items)) return value;
  const v2 = state.schemaVersion === 1 ? {
    ...state,
    schemaVersion: 2,
    items: state.items.map(item => typeof item === 'object' && item !== null && !Array.isArray(item)
      ? { ...item as Record<string, unknown>, earnedOrder: null }
      : item),
  } : state;
  const v3 = v2.schemaVersion === 2 ? { ...v2, schemaVersion: 3, publicCourses: [] } : v2;
  const v4 = v3.schemaVersion === 3 ? { ...v3, schemaVersion: 4, thesisSelection: 'undecided' } : v3;
  const v5 = v4.schemaVersion === 4 ? { ...v4, schemaVersion: 5, mediaSchoolingProgress: {} } : v4;
  if (v5.schemaVersion !== 5 && v5.schemaVersion !== 6 && v5.schemaVersion !== 7 && v5.schemaVersion !== 8 && v5.schemaVersion !== 9) return value;
  const v6 = v5.schemaVersion === 5 ? { ...v5, schemaVersion: 6, courseEvaluations: {} } : v5;
  const v7 = v6.schemaVersion === 6 ? { ...v6, schemaVersion: 7, correspondenceProgress: {} } : v6;
  if (v7.schemaVersion === 9) return Array.isArray(v7.importedStudyRecords) ? v7 : { ...v7, importedStudyRecords: [] };
  if (v7.schemaVersion === 8) return {
    ...v7,
    schemaVersion: 9,
    importedStudyRecords: [],
    mediaSchoolingProgress: typeof v7.mediaSchoolingProgress === 'object' && v7.mediaSchoolingProgress !== null && !Array.isArray(v7.mediaSchoolingProgress)
      ? Object.fromEntries(Object.entries(v7.mediaSchoolingProgress).map(([id, progress]) => [id, typeof progress === 'object' && progress !== null && !Array.isArray(progress) ? { ...progress as Record<string, unknown>, assessments: [] } : progress]))
      : v7.mediaSchoolingProgress,
  };
  if (v7.schemaVersion !== 7) return value;
  // Keep all existing records and intentionally leave finalGrade empty: legacy
  // report/schooling grades represent different assessment stages.
  return {
    ...v7,
    schemaVersion: 9,
    items: (v7.items as unknown[]).map(item => typeof item === 'object' && item !== null && !Array.isArray(item)
      ? { ...item as Record<string, unknown>, studyYear: null } : item),
    publicCourses: Array.isArray(v7.publicCourses) ? v7.publicCourses.map(course => typeof course === 'object' && course !== null && !Array.isArray(course)
      ? { ...course as Record<string, unknown>, studyYear: null, finalGrade: null } : course) : v7.publicCourses,
    courseEvaluations: typeof v7.courseEvaluations === 'object' && v7.courseEvaluations !== null && !Array.isArray(v7.courseEvaluations)
      ? Object.fromEntries(Object.entries(v7.courseEvaluations).map(([id, evaluation]) => [id, typeof evaluation === 'object' && evaluation !== null && !Array.isArray(evaluation) ? { ...evaluation as Record<string, unknown>, finalGrade: null } : evaluation]))
      : v7.courseEvaluations,
    importedStudyRecords: [],
    mediaSchoolingProgress: typeof v7.mediaSchoolingProgress === 'object' && v7.mediaSchoolingProgress !== null && !Array.isArray(v7.mediaSchoolingProgress)
      ? Object.fromEntries(Object.entries(v7.mediaSchoolingProgress).map(([id, progress]) => [id, typeof progress === 'object' && progress !== null && !Array.isArray(progress) ? { ...progress as Record<string, unknown>, assessments: [] } : progress]))
      : v7.mediaSchoolingProgress,
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
