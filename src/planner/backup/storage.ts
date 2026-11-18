import type { GraduationProfile, PlannerCatalog, PlannerState } from '../plannerCatalog';
import { validateState } from '../validation';
import { repairImportedAchievements } from '../gradeImport/importedAchievementRepair';
import { graduationProfileValidationError, initialGraduationProfile, MAX_GENERAL_RECOGNIZED_CREDITS_2026, MAX_OPEN_UNIVERSITY_RECOGNIZED_CREDITS_2026, MAX_RECOGNIZED_CREDITS_2026, recognizedCreditBreakdownTotal, schoolingRecognitionCap } from '../graduation/graduationProfile';
import { migrateCurriculumState } from '../catalog/curriculumMigration';
import { normalizeThesisProgressState } from '../graduation/thesisSelection';
import { recoverImportedAnnualMatches } from '../catalog/curriculumIdentityValidation';
import { backupRawDigest } from './plannerBackupCompatibility';
import { createPlannerBackupProtection, inspectPlannerBackupProtection } from './plannerBackupProtection';

import { STORAGE_KEY, BACKUP_KEY, withPlannerWriteLock, type PlannerWriteLocks } from './storagePrimitives';
import { assertLegacyWriteAllowed, requireBrowserWriteLock } from './legacyWriteFence';
export { STORAGE_KEY, BACKUP_KEY, PLANNER_WRITE_LOCK, withPlannerWriteLock, type PlannerWriteLocks } from './storagePrimitives';
export const initialState = (): PlannerState => ({ schemaVersion: 22, selectedScopeId: null, thesisSelection: 'undecided', thesisProgressByScope: {}, thesisGuidanceByScope: {}, items: [], publicCourses: [], todos: [], mediaSchoolingProgress: {}, courseEvaluations: {}, correspondenceProgress: {}, importedStudyRecords: [], importedCourseAchievements: [], importedCourseUserMeta: {}, graduationProfile: initialGraduationProfile() });
// Historical/missing applicability is not consent to the new-user default.
const restoredGraduationProfile = (): GraduationProfile => ({ ...initialGraduationProfile(), curriculumApplicability: 'unknown' });
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export type LoadResult = { state: PlannerState; raw: string | null; error: string | null; recognitionWarning?: string | null; recoveredRecognitionRaw?: GraduationProfile | null; invalidRecognitionPaths?: string[] };

function recognitionPaths(raw: unknown, recovered: unknown, prefix = 'recognizedCredits'): string[] {
  if (Object.is(raw, recovered)) return [];
  if (Array.isArray(raw) || Array.isArray(recovered)) return JSON.stringify(raw) === JSON.stringify(recovered) ? [] : [prefix];
  if (!raw || !recovered || typeof raw !== 'object' || typeof recovered !== 'object') return [prefix];
  const keys = new Set([...Object.keys(raw as object), ...Object.keys(recovered as object)]);
  return [...keys].flatMap(key => recognitionPaths((raw as Record<string, unknown>)[key], (recovered as Record<string, unknown>)[key], `${prefix}.${key}`));
}

function recoverRecognitionProfile(profile: GraduationProfile): GraduationProfile | null {
  const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!object(profile) || !object(profile.recognizedCredits)) return null;
  const credits = profile.recognizedCredits;
  if (!object(credits.general) || !object(credits.foreignLanguage) || !object(credits.physicalEducation) || !Array.isArray(credits.professionalCourses)) return null;
  const modes = ['unknown', 'none', 'recognized', 'exempt'];
  const numeric = (value: unknown) => value === null || typeof value === 'number';
  const safe = (value: number | null, max: number) => value !== null && (!Number.isFinite(value) || value < 0 || value > max) ? null : value;
  if (!numeric(credits.totalCredits) || !numeric(credits.schoolingEquivalentCredits) || !numeric(credits.openUniversityCredits)) return null;
  for (const field of ['humanities', 'social', 'natural'] as const) {
    const row = credits.general[field];
    if (!object(row) || !modes.includes(row.mode as string) || !numeric(row.credits)) return null;
  }
  const foreign = credits.foreignLanguage;
  const physical = credits.physicalEducation;
  if (!modes.includes(foreign.mode) || !numeric(foreign.credits) || !numeric(foreign.schoolingEquivalentCredits)
    || !['english', 'german', 'french', 'unknown'].includes(foreign.language)
    || !modes.includes(physical.mode) || !numeric(physical.credits)) return null;
  if (credits.professionalCourses.some(row => !object(row) || typeof row.id !== 'string' || typeof row.name !== 'string'
    || (row.offeringId !== null && typeof row.offeringId !== 'string')
    || (row.courseId !== null && typeof row.courseId !== 'string')
    || (row.mappingId !== null && typeof row.mappingId !== 'string') || typeof row.credits !== 'number')) return null;

  const repaired: GraduationProfile = structuredClone(profile);
  const target = repaired.recognizedCredits;
  target.totalCredits = safe(credits.totalCredits, MAX_RECOGNIZED_CREDITS_2026);
  target.schoolingEquivalentCredits = safe(credits.schoolingEquivalentCredits, schoolingRecognitionCap(profile));
  target.openUniversityCredits = safe(credits.openUniversityCredits, MAX_OPEN_UNIVERSITY_RECOGNIZED_CREDITS_2026);
  for (const field of ['humanities', 'social', 'natural'] as const) {
    const row = target.general[field];
    row.credits = safe(row.credits, MAX_GENERAL_RECOGNIZED_CREDITS_2026);
    if (row.mode !== 'recognized') row.credits = null;
  }
  target.foreignLanguage.credits = safe(foreign.credits, 4);
  target.foreignLanguage.schoolingEquivalentCredits = safe(foreign.schoolingEquivalentCredits, 2);
  if (foreign.mode !== 'recognized') {
    target.foreignLanguage.credits = null;
    target.foreignLanguage.language = 'unknown';
    target.foreignLanguage.schoolingEquivalentCredits = null;
  } else if (target.foreignLanguage.credits === null || (target.foreignLanguage.schoolingEquivalentCredits ?? 0) > target.foreignLanguage.credits) {
    target.foreignLanguage.schoolingEquivalentCredits = null;
  }
  target.physicalEducation.credits = physical.mode === 'recognized' ? safe(physical.credits, 2) : null;
  target.professionalCourses = credits.professionalCourses.filter(row => Number.isFinite(row.credits) && row.credits >= 0 && row.credits <= MAX_RECOGNIZED_CREDITS_2026);

  const generalRows = [target.general.humanities, target.general.social, target.general.natural];
  let generalTotal = generalRows.reduce((sum, row) => sum + (row.mode === 'recognized' ? row.credits ?? 0 : 0), 0) + (target.openUniversityCredits ?? 0);
  for (const row of [...generalRows].reverse()) {
    if (generalTotal <= MAX_GENERAL_RECOGNIZED_CREDITS_2026) break;
    if (row.mode === 'recognized' && row.credits !== null) { generalTotal -= row.credits; row.credits = null; }
  }
  for (let index = target.professionalCourses.length - 1; index >= 0 && recognizedCreditBreakdownTotal(target) > MAX_RECOGNIZED_CREDITS_2026; index -= 1) {
    target.professionalCourses.splice(index, 1);
  }
  const detail = recognizedCreditBreakdownTotal(target);
  if (target.totalCredits !== null && target.totalCredits < detail) target.totalCredits = null;
  if (target.totalCredits !== null && target.schoolingEquivalentCredits !== null && target.schoolingEquivalentCredits > target.totalCredits) target.schoolingEquivalentCredits = null;
  return graduationProfileValidationError(repaired) === null ? repaired : null;
}

export function loadState(store: Store, catalog: PlannerCatalog): LoadResult {
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
    if (raw === null) return { state: initialState(), raw, error: null };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
      || !Number.isInteger((parsed as Record<string, unknown>).schemaVersion)
      || (parsed as Record<string, unknown>).schemaVersion as number < 1
      || (parsed as Record<string, unknown>).schemaVersion as number > 22) throw new Error('Unsupported schema');
    const migrated = migrateState(parsed, catalog) as Record<string, unknown>;
    // v21 adds explicit Open University recognition while preserving every
    // preceding state field and recognition-recovery shadow.
    // Wrap every earlier result before the additive v22 curriculum migration,
    // so no recognition/import shadow is lost.
    const curriculumState = migrateCurriculumState(normalizeThesisProgressState((migrated.schemaVersion === 21 || migrated.schemaVersion === 22 ? migrated : {
      ...migrated, schemaVersion: 21, thesisGuidanceByScope: {},
      graduationProfile: { ...restoredGraduationProfile(), ...(migrated.graduationProfile as object), recognizedCredits: { ...restoredGraduationProfile().recognizedCredits, ...((migrated.graduationProfile as Record<string, unknown> | undefined)?.recognizedCredits as object) } },
    }) as PlannerState, catalog), catalog);
    const state = migrated.schemaVersion === 22 ? recoverImportedAnnualMatches(curriculumState, catalog) : curriculumState;
    const profile = recoverRecognitionProfile((state as PlannerState).graduationProfile);
    if (!profile) throw new Error('Invalid recognition structure');
    if (!validateState(state, catalog)) {
      // A later validation tightening must not lock otherwise-safe planner data.
      // Keep the raw bytes for optimistic-save protection, but hold only the
      // invalid recognition profile out of calculation until the user re-enters it.
      const recovered = { ...(state as PlannerState), graduationProfile: profile };
      if (!validateState(recovered, catalog)) throw new Error('Invalid state');
      return { state: recovered, raw, error: null, recognitionWarning: '保存済みの認定情報に無効な値があります。確認・修正してください。', recoveredRecognitionRaw: (state as PlannerState).graduationProfile, invalidRecognitionPaths: recognitionPaths((state as PlannerState).graduationProfile.recognizedCredits, profile.recognizedCredits) };
    }
    return { state, raw, error: null };
  } catch {
    return { state: initialState(), raw, error: '保存データを読み込めません。形式・バージョン・科目参照・重複、またはブラウザの保存設定を確認してください。元データは上書きしていません。' };
  }
}

/** Preserve all prior planner data while adding fields introduced by each state version. */
function migrateState(value: unknown, catalog: PlannerCatalog): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const state = value as Record<string, unknown>;
  if (state.schemaVersion === 22) return state;
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
  if (v5.schemaVersion !== 5 && v5.schemaVersion !== 6 && v5.schemaVersion !== 7 && v5.schemaVersion !== 8 && v5.schemaVersion !== 9 && v5.schemaVersion !== 10 && v5.schemaVersion !== 11 && v5.schemaVersion !== 12 && v5.schemaVersion !== 13 && v5.schemaVersion !== 14 && v5.schemaVersion !== 15 && v5.schemaVersion !== 16 && v5.schemaVersion !== 17 && v5.schemaVersion !== 18 && v5.schemaVersion !== 19 && v5.schemaVersion !== 20 && v5.schemaVersion !== 21) return value;
  const v6 = v5.schemaVersion === 5 ? { ...v5, schemaVersion: 6, courseEvaluations: {} } : v5;
  const v7 = v6.schemaVersion === 6 ? { ...v6, schemaVersion: 7, correspondenceProgress: {} } : v6;
  // v9 component records intentionally have no reconstructed course aggregate.
  // They remain visible, but cannot be used as graduation achievements.
  if (v7.schemaVersion === 21) return v7;
  if (v7.schemaVersion === 20) {
    const prior = typeof v7.graduationProfile === 'object' && v7.graduationProfile !== null ? v7.graduationProfile as Record<string, unknown> : {};
    const recognized = typeof prior.recognizedCredits === 'object' && prior.recognizedCredits !== null ? prior.recognizedCredits as Record<string, unknown> : {};
    return { ...v7, schemaVersion: 21, graduationProfile: { ...restoredGraduationProfile(), ...prior, recognizedCredits: { ...restoredGraduationProfile().recognizedCredits, ...recognized, openUniversityCredits: null } } };
  }
  if (v7.schemaVersion === 19) return { ...v7, schemaVersion: 20, thesisGuidanceByScope: {}, graduationProfile: { ...restoredGraduationProfile(), ...(v7.graduationProfile as object) } };
  if (v7.schemaVersion === 18) {
    const prior = typeof v7.graduationProfile === 'object' && v7.graduationProfile !== null ? v7.graduationProfile as Record<string, unknown> : {};
    const recognized = typeof prior.recognizedCredits === 'object' && prior.recognizedCredits !== null ? prior.recognizedCredits as Record<string, unknown> : {};
    return { ...v7, schemaVersion: 19, graduationProfile: { ...restoredGraduationProfile(), ...prior, admissionType: prior.admissionType === 'transfer' ? 'other_transfer' : prior.admissionType, recognizedCredits: { ...restoredGraduationProfile().recognizedCredits, ...recognized } } };
  }
  if (v7.schemaVersion === 17) return { ...v7, schemaVersion: 19, thesisProgressByScope: typeof v7.selectedScopeId === 'string' ? { [v7.selectedScopeId]: { selection: v7.thesisSelection === 'selected' || v7.thesisSelection === 'not_selected' ? v7.thesisSelection : 'undecided', status: 'not_started' } } : {} };
  if (v7.schemaVersion === 16) return { ...v7, schemaVersion: 19, thesisProgressByScope: {} };
  const legacyThesisProgress = typeof v7.selectedScopeId === 'string' ? { [v7.selectedScopeId]: { selection: v7.thesisSelection === 'selected' || v7.thesisSelection === 'not_selected' ? v7.thesisSelection : 'undecided', status: 'not_started' } } : {};
  if (v7.schemaVersion === 15) return { ...v7, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, graduationProfile: restoredGraduationProfile() };
  if (v7.schemaVersion === 14) return { ...v7, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedCourseUserMeta: {}, graduationProfile: restoredGraduationProfile() };
  if (v7.schemaVersion === 13) return { ...repairImportedAchievements({ ...v7, schemaVersion: 14 } as unknown as PlannerState, catalog).state, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedCourseUserMeta: {}, graduationProfile: restoredGraduationProfile() };
  if (v7.schemaVersion === 12) return { ...repairImportedAchievements({ ...v7, schemaVersion: 14 } as unknown as PlannerState, catalog).state, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedCourseUserMeta: {}, graduationProfile: restoredGraduationProfile() };
  if (v7.schemaVersion === 11) return { ...repairImportedAchievements({ ...v7, schemaVersion: 14, importedCourseAchievements: Array.isArray(v7.importedCourseAchievements) ? v7.importedCourseAchievements.map(row => typeof row === 'object' && row !== null && !Array.isArray(row) ? { ...row as Record<string, unknown>, selectionSource: (row as Record<string, unknown>).selectedOfferingId ? 'auto' : 'none' } : row) : [] } as unknown as PlannerState, catalog).state, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedCourseUserMeta: {}, graduationProfile: restoredGraduationProfile() };
  if (v7.schemaVersion === 10) {
    const records = Array.isArray(v7.importedStudyRecords) ? v7.importedStudyRecords as Record<string, unknown>[] : [];
    const rows = new Map<string, Record<string, unknown>>();
    for (const record of records) {
      const id = typeof record.sourceCourseId === 'string' ? record.sourceCourseId : null;
      if (!id || rows.has(id) || typeof record.earnedCreditsTotal !== 'number') continue;
      rows.set(id, { id, fingerprint: `migrated:${id}`, source: 'hosei_import', rawName: record.rawName, categoryRaw: null, capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : '', earnedCreditsTotal: record.earnedCreditsTotal, schoolingCreditsTotal: record.schoolingCreditsTotal ?? null, compositionCredits: record.compositionCredits ?? null, recognizedExemption: record.recognizedExemption ?? null, additionalEnrollment: record.additionalEnrollment ?? null, academicYear: record.academicYear ?? null, yearSource: record.yearSource ?? 'unknown', courseId: null, selectedOfferingId: record.offeringId ?? null, match: record.match ?? 'unmatched', candidateOfferingIds: [] });
    }
    return { ...repairImportedAchievements({ ...v7, schemaVersion: 14, importedStudyRecords: records, importedCourseAchievements: [...rows.values()].map(row => ({ ...row, selectionSource: row.selectedOfferingId ? 'auto' : 'none' })) } as unknown as PlannerState, catalog).state, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedCourseUserMeta: {}, graduationProfile: restoredGraduationProfile() };
  }
  if (v7.schemaVersion === 9) return { ...v7, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedStudyRecords: Array.isArray(v7.importedStudyRecords) ? v7.importedStudyRecords : [], importedCourseAchievements: [], importedCourseUserMeta: {}, graduationProfile: restoredGraduationProfile() };
  if (v7.schemaVersion === 8) return {
    ...v7,
    schemaVersion: 19,
    thesisProgressByScope: legacyThesisProgress,
    importedStudyRecords: [],
    importedCourseAchievements: [],
    importedCourseUserMeta: {},
    graduationProfile: restoredGraduationProfile(),
    mediaSchoolingProgress: typeof v7.mediaSchoolingProgress === 'object' && v7.mediaSchoolingProgress !== null && !Array.isArray(v7.mediaSchoolingProgress)
      ? Object.fromEntries(Object.entries(v7.mediaSchoolingProgress).map(([id, progress]) => [id, typeof progress === 'object' && progress !== null && !Array.isArray(progress) ? { ...progress as Record<string, unknown>, assessments: [] } : progress]))
      : v7.mediaSchoolingProgress,
  };
  if (v7.schemaVersion !== 7) return value;
  // Keep all existing records and intentionally leave finalGrade empty: legacy
  // report/schooling grades represent different assessment stages.
  return {
    ...v7,
    schemaVersion: 19,
    thesisProgressByScope: legacyThesisProgress,
    items: (v7.items as unknown[]).map(item => typeof item === 'object' && item !== null && !Array.isArray(item)
      ? { ...item as Record<string, unknown>, studyYear: null } : item),
    publicCourses: Array.isArray(v7.publicCourses) ? v7.publicCourses.map(course => typeof course === 'object' && course !== null && !Array.isArray(course)
      ? { ...course as Record<string, unknown>, studyYear: null, finalGrade: null } : course) : v7.publicCourses,
    courseEvaluations: typeof v7.courseEvaluations === 'object' && v7.courseEvaluations !== null && !Array.isArray(v7.courseEvaluations)
      ? Object.fromEntries(Object.entries(v7.courseEvaluations).map(([id, evaluation]) => [id, typeof evaluation === 'object' && evaluation !== null && !Array.isArray(evaluation) ? { ...evaluation as Record<string, unknown>, finalGrade: null } : evaluation]))
      : v7.courseEvaluations,
    importedStudyRecords: [],
    importedCourseAchievements: [],
    importedCourseUserMeta: {},
    graduationProfile: restoredGraduationProfile(),
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

/** Preserve uncorrected invalid recognition fields during unrelated saves. */
export function saveStateWithRecognitionShadow(store: Store, state: PlannerState, expectedRaw: string | null, catalog: PlannerCatalog, shadow: GraduationProfile, paths: string[]): string {
  if (!validateState(state, catalog)) throw new Error('保存データの形式が不正です。');
  if (store.getItem(STORAGE_KEY) !== expectedRaw) throw new Error('別の画面で保存データが変更されました。再読み込みしてください。');
  const profile = structuredClone(state.graduationProfile) as GraduationProfile;
  for (const path of paths) {
    const keys = path.split('.'); let target = profile as unknown as Record<string, unknown>; const source = shadow as unknown as Record<string, unknown>;
    for (let index = 0; index < keys.length - 1; index += 1) target = target[keys[index]] as Record<string, unknown>;
    const value = keys.reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, source);
    target[keys[keys.length - 1]] = value;
  }
  const raw = JSON.stringify({ ...state, graduationProfile: profile });
  store.setItem(STORAGE_KEY, raw);
  return raw;
}

export function recognitionPathValue(profile: GraduationProfile, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, profile);
}

/** A save only resolves paths whose recovered value the user actually changed. */
export function saveRecoveredState(store: Store, next: PlannerState, previous: LoadResult, catalog: PlannerCatalog): LoadResult {
  const remaining = (previous.invalidRecognitionPaths ?? []).filter(path => {
    const before = recognitionPathValue(previous.state.graduationProfile, path);
    const after = recognitionPathValue(next.graduationProfile, path);
    return Object.is(before, after) || JSON.stringify(before) === JSON.stringify(after);
  });
  const raw = previous.recoveredRecognitionRaw && remaining.length
    ? saveStateWithRecognitionShadow(store, next, previous.raw, catalog, previous.recoveredRecognitionRaw, remaining)
    : saveState(store, next, previous.raw, catalog);
  return { state: next, raw, error: null, recognitionWarning: remaining.length ? previous.recognitionWarning : null,
    recoveredRecognitionRaw: remaining.length ? previous.recoveredRecognitionRaw : null, invalidRecognitionPaths: remaining };
}

export class PlannerOldRecoveryProtectionRequired extends Error {
  constructor() { super('既存の退避原文を保存済み保護ファイルで照合してから初期化してください。'); this.name = 'PlannerOldRecoveryProtectionRequired'; }
}

function recoverStateObserved(store: Store, expectedRaw: string, catalog: PlannerCatalog, onPartial?: (previousRecoveryRaw: string | null) => void, protectedPreviousRecovery = false): string {
  if (store.getItem(STORAGE_KEY) !== expectedRaw) throw new Error('保存データが変更されました。再読み込みしてください。');
  const previousRecoveryRaw = store.getItem(BACKUP_KEY);
  // The old R is irretrievable after overwrite unless a saved external copy has
  // been read back. All public first-entry calls must stop before either write.
  if (previousRecoveryRaw !== null && !protectedPreviousRecovery) throw new PlannerOldRecoveryProtectionRequired();
  // Keep the exact original bytes; if backup fails, do not reset the primary key.
  store.setItem(BACKUP_KEY, expectedRaw);
  try { return saveState(store, initialState(), expectedRaw, catalog); }
  catch (error) {
    onPartial?.(previousRecoveryRaw);
    throw error; // Preserve the exact legacy exception object, including DOMException.
  }
}

/** Synchronous callers retain their original return and exception contract. */
export function recoverState(store: Store, expectedRaw: string, catalog: PlannerCatalog): string {
  return recoverStateObserved(store, expectedRaw, catalog);
}

type RetryRecord = {
  id: string; primary: string | null; recovery: string | null;
  protectionText: string; protected: boolean; token: string | null; consumed: boolean;
};
type PartialRecovery = { previousRecoveryRaw: string | null; record: RetryRecord | null };
type InitialProtectionRecord = RetryRecord;
const initialProtections = new WeakMap<Store, InitialProtectionRecord>();
// Document-local only. A reload or a nonparticipating old tab is outside this guarantee.
const partialRecoveries = new WeakMap<Store, PartialRecovery>();
const retryRequired = () => new Error('退避後に本体の初期化が失敗しました。両原文を読戻して保護し、新しい確認から再試行してください。');
const staleRetry = () => new Error('保護対象の原文が変わりました。再度読戻しと保護を行ってください。');
const consumedRetry = () => new Error('この復旧操作は使用済みです。新しい読戻しからやり直してください。');

export function plannerRecoveryRetryRequired(store: Store): boolean { return partialRecoveries.has(store); }

/** Read both keys under the shared lock, then prepare a file outside either key. */
export async function preparePlannerRecoveryRetry(store: Store, expectedPrimary: string, catalog: PlannerCatalog, locks: PlannerWriteLocks | undefined): Promise<{
  id: string; text: string; primarySha256: string | null; recoverySha256: string | null;
  priorRecoverySha256: string | null; primaryBytes: number; recoveryBytes: number;
}> {
  const captured = await withPlannerWriteLock(() => {
    const phase = partialRecoveries.get(store);
    if (!phase) throw new Error('再試行が必要な復旧操作はありません。');
    phase.record = null; // Invalidate any earlier presentation before an asynchronous step.
    const primary = store.getItem(STORAGE_KEY), recovery = store.getItem(BACKUP_KEY);
    if (primary !== expectedPrimary) throw staleRetry();
    return { phase, primary, recovery, previousRecoveryRaw: phase.previousRecoveryRaw };
  }, locks, true);
  const protection = await createPlannerBackupProtection(captured.primary, captured.recovery, catalog);
  const priorRecoverySha256 = captured.previousRecoveryRaw === null ? null : await backupRawDigest(captured.previousRecoveryRaw);
  const text = JSON.stringify({ format: 'hosei-planner-recovery-retry-protection', version: 1,
    current: protection, priorRecoveryRaw: captured.previousRecoveryRaw, priorRecoverySha256 }, null, 2);
  const id = crypto.randomUUID();
  await withPlannerWriteLock(() => {
    if (partialRecoveries.get(store) !== captured.phase
      || store.getItem(STORAGE_KEY) !== captured.primary || store.getItem(BACKUP_KEY) !== captured.recovery) throw staleRetry();
    captured.phase.record = { id, primary: captured.primary, recovery: captured.recovery, protectionText: text, protected: false, token: null, consumed: false };
  }, locks, true);
  return { id, text, primarySha256: protection.primarySha256, recoverySha256: protection.recoverySha256,
    priorRecoverySha256, primaryBytes: captured.primary?.length ?? 0, recoveryBytes: captured.recovery?.length ?? 0 };
}

/** A downloaded link is insufficient: the user must reselect the saved file. */
export async function verifyPlannerRecoveryRetryProtection(store: Store, id: string, selectedText: string, locks: PlannerWriteLocks | undefined): Promise<void> {
  const value: unknown = JSON.parse(selectedText);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('保護ファイルの形式が不正です。');
  const envelope = value as Record<string, unknown>;
  if (Object.keys(envelope).sort().join(',') !== 'current,format,priorRecoveryRaw,priorRecoverySha256,version'
    || envelope.format !== 'hosei-planner-recovery-retry-protection' || envelope.version !== 1) throw new Error('再試行用保護ファイルではありません。');
  await inspectPlannerBackupProtection(JSON.stringify(envelope.current));
  if (envelope.priorRecoveryRaw !== null && typeof envelope.priorRecoveryRaw !== 'string') throw new Error('旧退避原文が不正です。');
  if (envelope.priorRecoverySha256 !== (envelope.priorRecoveryRaw === null ? null : await backupRawDigest(envelope.priorRecoveryRaw))) throw new Error('旧退避原文のSHAが一致しません。');
  await withPlannerWriteLock(() => {
    const phase = partialRecoveries.get(store), record = phase?.record;
    if (!record || record.id !== id || record.consumed || record.token || record.protectionText !== selectedText) throw staleRetry();
    if (store.getItem(STORAGE_KEY) !== record.primary || store.getItem(BACKUP_KEY) !== record.recovery) {
      phase!.record = null; throw staleRetry();
    }
    record.protected = true;
  }, locks, true);
}

/** Called only after an affirmative UI response to this exact presentation. */
export function confirmPlannerRecoveryRetry(store: Store, id: string, locks: PlannerWriteLocks | undefined): Promise<string> {
  return withPlannerWriteLock(() => {
    const phase = partialRecoveries.get(store), record = phase?.record;
    if (!record || record.id !== id || !record.protected || record.token || record.consumed) throw staleRetry();
    if (store.getItem(STORAGE_KEY) !== record.primary || store.getItem(BACKUP_KEY) !== record.recovery) {
      phase!.record = null; throw staleRetry();
    }
    return record.token = crypto.randomUUID();
  }, locks, true);
}

export async function executePlannerRecoveryRetry(store: Store, id: string, token: string, catalog: PlannerCatalog, locks: PlannerWriteLocks | undefined, isCurrent?: () => boolean): Promise<string> {
  return withPlannerWriteLock(async () => {
    const phase = partialRecoveries.get(store), record = phase?.record;
    if (!record || record.id !== id || record.token !== token || record.consumed) throw consumedRetry();
    if (typeof window !== 'undefined') await assertLegacyWriteAllowed(store, record.primary, record.recovery);
    if (partialRecoveries.get(store) !== phase || phase.record !== record || record.token !== token || record.consumed) throw consumedRetry();
    if (!record.protected || store.getItem(STORAGE_KEY) !== record.primary || store.getItem(BACKUP_KEY) !== record.recovery) {
      phase!.record = null; throw staleRetry();
    }
    if (isCurrent && !isCurrent()) { phase!.record = null; throw staleRetry(); }
    if (record.primary === null) throw staleRetry();
    record.consumed = true; // Consume before the first R/P write, inside the sole lock.
    phase!.record = null;
    // Either write failure retains the phase and requires a fresh readback/file.
    const raw = recoverStateObserved(store, record.primary, catalog, undefined, true);
    partialRecoveries.delete(store);
    return raw;
  }, locks, true);
}

export async function savePlannerState(store: Store, next: PlannerState, previous: LoadResult, catalog: PlannerCatalog, locks: PlannerWriteLocks | undefined, beforeWrite?: () => void): Promise<LoadResult> {
  requireBrowserWriteLock(locks);
  const recoveryRaw = store.getItem(BACKUP_KEY);
  return withPlannerWriteLock(async () => {
    if (typeof window !== 'undefined') await assertLegacyWriteAllowed(store, previous.raw, recoveryRaw);
    beforeWrite?.();
    return saveRecoveredState(store, next, previous, catalog);
  }, locks);
}

export async function recoverPlannerState(store: Store, expectedRaw: string, catalog: PlannerCatalog, locks: PlannerWriteLocks | undefined, isCurrent?: () => boolean): Promise<string> {
  requireBrowserWriteLock(locks);
  const recoveryRaw = store.getItem(BACKUP_KEY);
  return withPlannerWriteLock(async () => {
    if (partialRecoveries.has(store)) throw retryRequired();
    if (typeof window !== 'undefined') await assertLegacyWriteAllowed(store, expectedRaw, recoveryRaw);
    if (partialRecoveries.has(store)) throw retryRequired();
    // The UI may have left this document while inventory waited inside the lock.
    // Check its captured operation immediately before recoverStateObserved's first R write.
    if (isCurrent && !isCurrent()) throw staleRetry();
    return recoverStateObserved(store, expectedRaw, catalog, previousRecoveryRaw => {
      partialRecoveries.set(store, { previousRecoveryRaw, record: null });
    });
  }, locks);
}

/** Capture the exact initial P/R before the first overwrite of a non-null R. */
export async function preparePlannerInitialProtection(store: Store, expectedPrimary: string, catalog: PlannerCatalog, locks: PlannerWriteLocks | undefined): Promise<{
  id: string; text: string; primarySha256: string | null; recoverySha256: string | null;
}> {
  const captured = await withPlannerWriteLock(() => {
    if (partialRecoveries.has(store)) throw retryRequired();
    initialProtections.delete(store);
    const primary = store.getItem(STORAGE_KEY), recovery = store.getItem(BACKUP_KEY);
    if (primary !== expectedPrimary || recovery === null) throw staleRetry();
    return { primary, recovery };
  }, locks, true);
  const protection = await createPlannerBackupProtection(captured.primary, captured.recovery, catalog);
  const text = JSON.stringify(protection, null, 2), id = crypto.randomUUID();
  await withPlannerWriteLock(() => {
    if (partialRecoveries.has(store) || store.getItem(STORAGE_KEY) !== captured.primary
      || store.getItem(BACKUP_KEY) !== captured.recovery) throw staleRetry();
    initialProtections.set(store, { id, primary: captured.primary, recovery: captured.recovery,
      protectionText: text, protected: false, token: null, consumed: false });
  }, locks, true);
  return { id, text, primarySha256: protection.primarySha256, recoverySha256: protection.recoverySha256 };
}

/** A link or download start does not authorize a write: inspect selected bytes. */
export async function verifyPlannerInitialProtection(store: Store, id: string, selectedText: string, locks: PlannerWriteLocks | undefined): Promise<void> {
  await inspectPlannerBackupProtection(selectedText);
  await withPlannerWriteLock(() => {
    const record = initialProtections.get(store);
    if (!record || record.id !== id || record.consumed || record.token || record.protectionText !== selectedText) throw staleRetry();
    if (store.getItem(STORAGE_KEY) !== record.primary || store.getItem(BACKUP_KEY) !== record.recovery) {
      initialProtections.delete(store); throw staleRetry();
    }
    record.protected = true;
  }, locks, true);
}

export function confirmPlannerInitialProtection(store: Store, id: string, locks: PlannerWriteLocks | undefined): Promise<string> {
  return withPlannerWriteLock(() => {
    const record = initialProtections.get(store);
    if (!record || record.id !== id || !record.protected || record.token || record.consumed) throw staleRetry();
    if (store.getItem(STORAGE_KEY) !== record.primary || store.getItem(BACKUP_KEY) !== record.recovery) {
      initialProtections.delete(store); throw staleRetry();
    }
    return record.token = crypto.randomUUID();
  }, locks, true);
}

export async function executePlannerInitialProtection(store: Store, id: string, token: string, catalog: PlannerCatalog, locks: PlannerWriteLocks | undefined, isCurrent?: () => boolean): Promise<string> {
  return withPlannerWriteLock(async () => {
    const record = initialProtections.get(store);
    if (!record || record.id !== id || record.token !== token || record.consumed) throw consumedRetry();
    if (typeof window !== 'undefined') await assertLegacyWriteAllowed(store, record.primary, record.recovery);
    if (initialProtections.get(store) !== record || record.token !== token || record.consumed) throw consumedRetry();
    if (!record.protected || store.getItem(STORAGE_KEY) !== record.primary || store.getItem(BACKUP_KEY) !== record.recovery) {
      initialProtections.delete(store); throw staleRetry();
    }
    if (isCurrent && !isCurrent()) { initialProtections.delete(store); throw staleRetry(); }
    if (record.primary === null || record.recovery === null) throw staleRetry();
    record.consumed = true;
    initialProtections.delete(store);
    return recoverStateObserved(store, record.primary, catalog, previousRecoveryRaw => {
      partialRecoveries.set(store, { previousRecoveryRaw, record: null });
    }, true);
  }, locks, true);
}
