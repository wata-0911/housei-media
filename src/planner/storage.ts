import type { GraduationProfile, PlannerCatalog, PlannerState } from './plannerCatalog';
import { validateState } from './validation';
import { repairImportedAchievements } from './importedAchievementRepair';
import { graduationProfileValidationError, initialGraduationProfile, MAX_GENERAL_RECOGNIZED_CREDITS_2026, MAX_RECOGNIZED_CREDITS_2026, recognizedCreditBreakdownTotal, schoolingRecognitionCap } from './graduationProfile';
import { normalizeThesisProgressState } from './thesisSelection';

export const STORAGE_KEY = 'hosei-planner:v1';
export const BACKUP_KEY = `${STORAGE_KEY}:recovery`;
export const initialState = (): PlannerState => ({ schemaVersion: 19, selectedScopeId: null, thesisSelection: 'undecided', thesisProgressByScope: {}, items: [], publicCourses: [], todos: [], mediaSchoolingProgress: {}, courseEvaluations: {}, correspondenceProgress: {}, importedStudyRecords: [], importedCourseAchievements: [], importedCourseUserMeta: {}, graduationProfile: initialGraduationProfile() });
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
  if (!numeric(credits.totalCredits) || !numeric(credits.schoolingEquivalentCredits)) return null;
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
  let generalTotal = generalRows.reduce((sum, row) => sum + (row.mode === 'recognized' ? row.credits ?? 0 : 0), 0);
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
    const state = normalizeThesisProgressState(migrateState(parsed, catalog) as PlannerState, catalog);
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
  if (v5.schemaVersion !== 5 && v5.schemaVersion !== 6 && v5.schemaVersion !== 7 && v5.schemaVersion !== 8 && v5.schemaVersion !== 9 && v5.schemaVersion !== 10 && v5.schemaVersion !== 11 && v5.schemaVersion !== 12 && v5.schemaVersion !== 13 && v5.schemaVersion !== 14 && v5.schemaVersion !== 15 && v5.schemaVersion !== 16 && v5.schemaVersion !== 17 && v5.schemaVersion !== 18 && v5.schemaVersion !== 19) return value;
  const v6 = v5.schemaVersion === 5 ? { ...v5, schemaVersion: 6, courseEvaluations: {} } : v5;
  const v7 = v6.schemaVersion === 6 ? { ...v6, schemaVersion: 7, correspondenceProgress: {} } : v6;
  // v9 component records intentionally have no reconstructed course aggregate.
  // They remain visible, but cannot be used as graduation achievements.
  if (v7.schemaVersion === 19) return v7;
  if (v7.schemaVersion === 18) {
    const prior = typeof v7.graduationProfile === 'object' && v7.graduationProfile !== null ? v7.graduationProfile as Record<string, unknown> : {};
    const recognized = typeof prior.recognizedCredits === 'object' && prior.recognizedCredits !== null ? prior.recognizedCredits as Record<string, unknown> : {};
    return { ...v7, schemaVersion: 19, graduationProfile: { ...initialGraduationProfile(), ...prior, admissionType: prior.admissionType === 'transfer' ? 'other_transfer' : prior.admissionType, recognizedCredits: { ...initialGraduationProfile().recognizedCredits, ...recognized } } };
  }
  if (v7.schemaVersion === 17) return { ...v7, schemaVersion: 19, thesisProgressByScope: typeof v7.selectedScopeId === 'string' ? { [v7.selectedScopeId]: { selection: v7.thesisSelection === 'selected' || v7.thesisSelection === 'not_selected' ? v7.thesisSelection : 'undecided', status: 'not_started' } } : {} };
  if (v7.schemaVersion === 16) return { ...v7, schemaVersion: 19, thesisProgressByScope: {} };
  const legacyThesisProgress = typeof v7.selectedScopeId === 'string' ? { [v7.selectedScopeId]: { selection: v7.thesisSelection === 'selected' || v7.thesisSelection === 'not_selected' ? v7.thesisSelection : 'undecided', status: 'not_started' } } : {};
  if (v7.schemaVersion === 15) return { ...v7, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, graduationProfile: initialGraduationProfile() };
  if (v7.schemaVersion === 14) return { ...v7, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedCourseUserMeta: {}, graduationProfile: initialGraduationProfile() };
  if (v7.schemaVersion === 13) return { ...repairImportedAchievements({ ...v7, schemaVersion: 14 } as unknown as PlannerState, catalog).state, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedCourseUserMeta: {}, graduationProfile: initialGraduationProfile() };
  if (v7.schemaVersion === 12) return { ...repairImportedAchievements({ ...v7, schemaVersion: 14 } as unknown as PlannerState, catalog).state, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedCourseUserMeta: {}, graduationProfile: initialGraduationProfile() };
  if (v7.schemaVersion === 11) return { ...repairImportedAchievements({ ...v7, schemaVersion: 14, importedCourseAchievements: Array.isArray(v7.importedCourseAchievements) ? v7.importedCourseAchievements.map(row => typeof row === 'object' && row !== null && !Array.isArray(row) ? { ...row as Record<string, unknown>, selectionSource: (row as Record<string, unknown>).selectedOfferingId ? 'auto' : 'none' } : row) : [] } as unknown as PlannerState, catalog).state, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedCourseUserMeta: {}, graduationProfile: initialGraduationProfile() };
  if (v7.schemaVersion === 10) {
    const records = Array.isArray(v7.importedStudyRecords) ? v7.importedStudyRecords as Record<string, unknown>[] : [];
    const rows = new Map<string, Record<string, unknown>>();
    for (const record of records) {
      const id = typeof record.sourceCourseId === 'string' ? record.sourceCourseId : null;
      if (!id || rows.has(id) || typeof record.earnedCreditsTotal !== 'number') continue;
      rows.set(id, { id, fingerprint: `migrated:${id}`, source: 'hosei_import', rawName: record.rawName, categoryRaw: null, capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : '', earnedCreditsTotal: record.earnedCreditsTotal, schoolingCreditsTotal: record.schoolingCreditsTotal ?? null, compositionCredits: record.compositionCredits ?? null, recognizedExemption: record.recognizedExemption ?? null, additionalEnrollment: record.additionalEnrollment ?? null, academicYear: record.academicYear ?? null, yearSource: record.yearSource ?? 'unknown', courseId: null, selectedOfferingId: record.offeringId ?? null, match: record.match ?? 'unmatched', candidateOfferingIds: [] });
    }
    return { ...repairImportedAchievements({ ...v7, schemaVersion: 14, importedStudyRecords: records, importedCourseAchievements: [...rows.values()].map(row => ({ ...row, selectionSource: row.selectedOfferingId ? 'auto' : 'none' })) } as unknown as PlannerState, catalog).state, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedCourseUserMeta: {}, graduationProfile: initialGraduationProfile() };
  }
  if (v7.schemaVersion === 9) return { ...v7, schemaVersion: 19, thesisProgressByScope: legacyThesisProgress, importedStudyRecords: Array.isArray(v7.importedStudyRecords) ? v7.importedStudyRecords : [], importedCourseAchievements: [], importedCourseUserMeta: {}, graduationProfile: initialGraduationProfile() };
  if (v7.schemaVersion === 8) return {
    ...v7,
    schemaVersion: 19,
    thesisProgressByScope: legacyThesisProgress,
    importedStudyRecords: [],
    importedCourseAchievements: [],
    importedCourseUserMeta: {},
    graduationProfile: initialGraduationProfile(),
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
    graduationProfile: initialGraduationProfile(),
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

export function recoverState(store: Store, expectedRaw: string, catalog: PlannerCatalog): string {
  if (store.getItem(STORAGE_KEY) !== expectedRaw) throw new Error('保存データが変更されました。再読み込みしてください。');
  // Keep the exact original bytes; if backup fails, do not reset the primary key.
  store.setItem(BACKUP_KEY, expectedRaw);
  return saveState(store, initialState(), expectedRaw, catalog);
}
