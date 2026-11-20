import { deriveCurriculumCourseProgress } from '../planner/progress/curriculumCourseProgress';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import CourseSearch from '../components/planner/search/CourseSearch';
import CurriculumCourseList from '../components/planner/courses/CurriculumCourseList';
import { annualCreditLimitReferences, createCreditClassifier, selectablePrograms } from '../planner/planning/annualPlan';
import CreditSummary from '../components/planner/planning/CreditSummary';
import GraduationProgress from '../components/planner/graduation/GraduationProgress';
import PlannerProfileTab from '../components/planner/profile/PlannerProfileTab';
import ThesisGuidance from '../components/planner/graduation/ThesisGuidance';
import { catalog, offeringsById } from '../planner/catalog/catalog';
import { summarizeCredits } from '../planner/calculations';
import { initialState, loadState, recoverPlannerState, savePlannerState, STORAGE_KEY, plannerRecoveryRetryRequired,
  preparePlannerRecoveryRetry, verifyPlannerRecoveryRetryProtection, confirmPlannerRecoveryRetry, executePlannerRecoveryRetry,
  PlannerOldRecoveryProtectionRequired, preparePlannerInitialProtection, verifyPlannerInitialProtection,
  confirmPlannerInitialProtection, executePlannerInitialProtection, BACKUP_KEY,
  type LoadResult } from '../planner/backup/storage';

import type { ImportedCourseUserMeta, PlannerItem, PlannerState, PublicCourse } from '../planner/plannerCatalog';
import { calculateGraduationProgress } from '../planner/graduation/graduationProgress';
import { removePlannerItem, removePublicCourse, restorePlannerItem, restorePublicCourse, type RemovedPlanEntry } from '../planner/planning/removeUndo';
import { createPublicCourse, isValidPublicCourseTitle, normalizePublicCourseTitle } from '../planner/planning/publicCourses';
import { setThesisProgressForScope, shouldShowThesisGuidance, stateForScopeChange, thesisProgressForScope } from '../planner/graduation/thesisSelection';
import MediaSchoolingProgress, { type PersonalMediaStartOption, type PersonalMediaStartRequest } from '../components/planner/progress/MediaSchoolingProgress';
import PlannerBackupPanel from '../components/planner/backup/PlannerBackupPanel';
import PlannerExportActions from '../components/planner/exports/PlannerExportActions';
import { plannerExportPresentation } from '../planner/exports/plannerExport';
import GradeImportPanel from '../components/planner/gradeImport/GradeImportPanel';
import ImportedAchievements from '../components/planner/gradeImport/ImportedAchievements';
import AnnualCreditLimitNotice from '../components/planner/planning/AnnualCreditLimitNotice';
import { applyImport, importedEarnedCreditsTotal, type ImportedCourseAchievement, type ImportedStudyRecord, type ImportPreviewUnit } from '../planner/gradeImport/gradeImportApply';
import { deriveImportedAchievements, managedImportedMedia, mediaProgressAccess } from '../planner/gradeImport/importedAchievementCalculations';
import { canConfirmMedia, importedCoursesAfterPatch, mediaConfirmationPatch, type MediaConfirmation } from '../planner/gradeImport/mediaConfirmation';
import { officialMediaAchievements } from '../planner/gradeImport/officialMediaAchievements';
import { isMediaSchooling } from '../planner/progress/mediaSchooling';
import { deriveCurriculumCourseView } from '../planner/progress/curriculumCourseView';
import { plannerItemFromCourseSearch, updatePlannerItem } from '../planner/planning/plannerItemState';
import { GRADE_HANDOFF_REQUEST, gradeHandoffToken, isGradeHandoffResponse } from '../planner/gradeImport/directGradeHandoff';
import { guidanceEligibilityCredits, guidanceForScope } from '../planner/graduation/thesisGuidance';
import { missingGraduationProfilePrerequisites } from '../planner/graduation/graduationProfile';
import { useReducedMotion, motion } from 'framer-motion';
import PlannerSectionEntrance from '../components/planner/common/PlannerSectionEntrance';

function readSavedState(): LoadResult {
  try { return loadState(window.localStorage, catalog); }
  catch { return { state: initialState(), raw: null, error: 'ブラウザの保存領域を利用できません。保存設定を確認して再読み込みしてください。' }; }
}

function readRecoveryRetryRequired(): boolean {
  try { return plannerRecoveryRetryRequired(window.localStorage); }
  catch { return false; } // readSavedState owns the unavailable-storage guidance.
}

function downloadOriginal(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'hosei-planner-recovery.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PlannerPage() {
  const shouldReduceMotion = useReducedMotion();
  const location = useLocation();
  const [loaded, setLoaded] = useState(readSavedState);
  const writePending = useRef(false);
  const recoveryOperation = useRef(0);
  const [saving, setSaving] = useState(false);
  const [importEpoch, setImportEpoch] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recoveryRetryRequired, setRecoveryRetryRequired] = useState(readRecoveryRetryRequired);
  const [recoveryRetry, setRecoveryRetry] = useState<{ id: string; url: string; verified: boolean;
    primarySha256: string | null; recoverySha256: string | null; priorRecoverySha256: string | null; generation: string; } | null>(null);
  const [initialProtectionRequired, setInitialProtectionRequired] = useState(false);
  const [initialProtection, setInitialProtection] = useState<{ id: string; url: string; verified: boolean;
    primarySha256: string | null; recoverySha256: string | null; generation: string; } | null>(null);
  const [notice, setNotice] = useState('');
  const [undoItem, setUndoItem] = useState<RemovedPlanEntry | null>(null);
  const [undoImport, setUndoImport] = useState<PlannerState | null>(null);
  const [activeTab, setActiveTab] = useState<'annual' | 'media' | 'profile'>(() => ['#media', '#media-panel'].includes(location.hash) ? 'media' : 'annual');
  const [gradeImportOpen, setGradeImportOpen] = useState(() => location.hash === '#grade-import');
  const navigationKey = `${location.key}:${location.hash}`;
  const routeGeneration = useRef({ navigationKey, version: 0 });
  if (routeGeneration.current.navigationKey !== navigationKey) {
    routeGeneration.current = { navigationKey, version: routeGeneration.current.version + 1 };
  }
  const documentGeneration = `${routeGeneration.current.version}:${importEpoch}`;
  const documentGenerationRef = useRef(documentGeneration);
  documentGenerationRef.current = documentGeneration;
  useEffect(() => {
    documentGenerationRef.current = documentGeneration;
    return () => { documentGenerationRef.current = `retired:${documentGeneration}`; };
  }, [documentGeneration]);
  const mediaDocument = useRef<string | null>(null);
  const mediaStorageRevision = useRef(0);
  useLayoutEffect(() => {
    mediaDocument.current = activeTab === 'media' ? documentGeneration : null;
    return () => { mediaDocument.current = null; };
  }, [activeTab, documentGeneration]);
  const [destinationKey, setDestinationKey] = useState(navigationKey);
  // Keep ordinary initial /planner navigation/POP scroll restoration with App.
  const scrolledDestinationKey = useRef<string | null>(location.hash ? null : navigationKey);

  // A history entry is a new navigation request; local edits/tab changes are not.
  // Adjust before rendering so conditional panels/details are ready for layout.
  if (destinationKey !== navigationKey) {
    setDestinationKey(navigationKey);
    if (['#media', '#media-panel'].includes(location.hash)) setActiveTab('media');
    if (['#grade-import', '#course-query', '#graduation-progress-heading', '#planned-heading'].includes(location.hash) || !location.hash) setActiveTab('annual');
    if (location.hash === '#grade-import') setGradeImportOpen(true);
  }

  useLayoutEffect(() => {
    if (scrolledDestinationKey.current === navigationKey) return;
    const id = location.hash === '#grade-import' ? 'grade-import'
      : ['#media', '#media-panel'].includes(location.hash) ? 'media-panel'
      : ['#course-query', '#graduation-progress-heading', '#planned-heading'].includes(location.hash) ? location.hash.slice(1)
      : !location.hash ? 'planner-start' : null;
    // In particular, leave #hosei-import to the extension handoff.
    if (!id) { scrolledDestinationKey.current = navigationKey; return; }
    let target = document.getElementById(id);
    if (!target || target.matches(':disabled')) {
      // Missing profile-dependent sections and disabled inputs have a useful exit.
      setNotice('このセクションは現在利用できません。プロフィール設定や保存状態を確認してください。');
      target = document.getElementById('planner-start');
    }
    if (!target) return;
    scrolledDestinationKey.current = navigationKey;
    // Instant navigation also respects reduced motion and cannot restart on edits.
    target.style.scrollMarginTop = `${Math.max(160, (document.querySelector('header')?.getBoundingClientRect().height ?? 144) + 40)}px`;
    if (!target.matches('input, button, [tabindex]')) target.tabIndex = -1;
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
    target.focus({ preventScroll: true });
  }, [navigationKey, location.hash, activeTab, gradeImportOpen]);
  const [directImport, setDirectImport] = useState<unknown | undefined>(undefined);
  const profilePanelRef = useRef<HTMLDivElement>(null);
  const profileNavigationRequested = useRef(false);
  useEffect(() => () => { if (recoveryRetry?.url) URL.revokeObjectURL(recoveryRetry.url); }, [recoveryRetry?.url]);
  useEffect(() => () => { if (initialProtection?.url) URL.revokeObjectURL(initialProtection.url); }, [initialProtection?.url]);
  const state = loaded.state;
  const classify = createCreditClassifier(catalog, state.selectedScopeId);
  const thesisProgress = thesisProgressForScope(state, catalog, state.selectedScopeId);
  const thesisGuidance = guidanceForScope(state, state.selectedScopeId);
  const graduationProgress = calculateGraduationProgress(state.items, catalog, state.selectedScopeId, state.publicCourses, thesisProgress.selection, state.importedStudyRecords, state.importedCourseAchievements, state.graduationProfile, thesisProgress, state.correspondenceProgress);
  const importedDerived = deriveImportedAchievements(state.importedStudyRecords, offeringsById, state.items, state.importedCourseAchievements, catalog, state.selectedScopeId);
  const officialMedia = officialMediaAchievements(state.importedCourseAchievements, state.importedStudyRecords, catalog);
  const officialMediaIds = new Set(officialMedia.map(row => row.sourceCourseId));
  // Keep inferred history separate from source-confirmed media. Only an existing
  // source row can accept a manual offering choice; older selected IDs were manual.
  const sourceById = new Map(state.importedCourseAchievements.map(row => [row.id, row]));
  const canConfirmSource = (id: string) => state.importedCourseAchievements.filter(row => row.id === id).length === 1
    && canConfirmMedia(sourceById.get(id));
  const curriculumProgress = deriveCurriculumCourseProgress(state.items, catalog, state.importedCourseAchievements, state.selectedScopeId, state.importedStudyRecords, state.correspondenceProgress, state.graduationProfile);
  const managedMedia = managedImportedMedia(state.importedCourseAchievements, state.importedStudyRecords, state.importedCourseUserMeta, offeringsById);
  const mediaAccess = mediaProgressAccess(state.items, offeringsById, managedMedia);
  const curriculumCourseView = deriveCurriculumCourseView(state, catalog);
  // A grade-table total does not identify the learner's active Media attempt.
  const partialEarnedMediaSourceIds = new Set(state.importedCourseAchievements
    .filter(row => row.earnedCreditsTotal !== null && row.earnedCreditsTotal > 0 && state.importedCourseUserMeta[row.id]?.lifecycleStatus === 'in_progress')
    .map(row => row.id));
  // The legacy fallback normally runs only when the entire source table is empty.
  // In a mixed save, derive the orphan details separately for read-only display.
  const orphanDetails = sourceById.size ? state.importedStudyRecords.filter(record =>
    record.sourceCourseId && !sourceById.has(record.sourceCourseId)) : [];
  const orphanDerived = orphanDetails.length
    ? deriveImportedAchievements(orphanDetails, offeringsById, state.items, [], catalog, state.selectedScopeId)
    : null;
  const legacyMedia = [...importedDerived.media, ...(orphanDerived?.media ?? [])]
    .filter(history => !officialMediaIds.has(history.sourceCourseId))
    .map(history => ({ ...history, canConfirmOffering: canConfirmSource(history.sourceCourseId) }));
  const pendingMedia = [...importedDerived.mediaPending, ...managedMedia.pending, ...(orphanDerived?.mediaPending ?? [])]
    .map(row => ({ ...row, canConfirmOffering: canConfirmSource(row.sourceCourseId) }));
  const personalMediaStartOptions: PersonalMediaStartOption[] = state.importedCourseAchievements
    .filter(row => partialEarnedMediaSourceIds.has(row.id) && (
      (row.schoolingCreditsTotal !== null && row.schoolingCreditsTotal > 0)
      || officialMediaIds.has(row.id) || legacyMedia.some(history => history.sourceCourseId === row.id)
    ))
    .map(row => {
      const hold = (reason: string): PersonalMediaStartOption => ({ sourceCourseId: row.id, rawName: row.rawName, offering: null, status: 'hold', reason });
      if (state.importedCourseAchievements.filter(other => other.id === row.id).length !== 1) return hold('成績表の原行IDが一意ではありません。原文を保持して確認してください。');
      const ids = new Set([...row.candidateOfferingIds, ...(row.selectedOfferingId ? [row.selectedOfferingId] : [])]);
      const candidates = [...ids].map(id => offeringsById.get(id)).filter(offering => offering?.resolutionStatus === 'matched' && isMediaSchooling(offering));
      if (row.match !== 'exact_unique' || !row.courseId || candidates.length !== 1) return hold('メディアの2026年度Offeringを一意に確認できません。名称だけでは本人計画を作成しません。');
      const offering = candidates[0]!;
      if (offering.courseId !== row.courseId || !offering.period || !offering.deliveryCategory) return hold('方式・期または科目IDが一致しません。原行と候補を確認してください。');
      if (catalog.offerings.some(other => other.courseId === row.courseId && other.method === 'schooling' && !isMediaSchooling(other))) return hold('同じ科目に通常スクーリングの候補があります。方式を一意に判断できないため保留します。');
      if (state.importedCourseAchievements.some(other => other.id !== row.id && (other.selectedOfferingId === offering.id || other.candidateOfferingIds.includes(offering.id)))) return hold('複数の成績原行が同じOfferingを指します。履修回を判別できないため保留します。');
      if (mediaAccess.heldOfferingIds.has(offering.id)) return hold('複数の履修記録が同じ進捗を指すため、編集を保留しています。');
      const existingItem = state.items.find(item => item.offeringId === offering.id);
      if (existingItem) return { sourceCourseId: row.id, rawName: row.rawName, offering, status: 'existing', existingItem,
        reason: `本人計画が既にあります（計画年度：${existingItem.plannedYear ?? '未設定'}、状態：${existingItem.status}）。別履修回ならこの保存形式では追加できません。` };
      if (state.mediaSchoolingProgress[offering.id] || state.courseEvaluations[offering.id]) return hold('計画行のない本人進捗または評価が残っています。上書きせず保留します。');
      if (state.items.some(item => offeringsById.get(item.offeringId)?.courseId === offering.courseId)) return hold('同じ科目の別Offeringに本人計画があります。履修回を確認するまで追加しません。');
      return { sourceCourseId: row.id, rawName: row.rawName, offering, status: 'new',
        reason: 'この成績行と同じ履修回だとは扱いません。方式・期と本人の計画年度を選び、新しい本人計画を明示的に作成できます。' };
    });
  const exportPresentation = plannerExportPresentation(state, catalog, mediaAccess.heldOfferingIds);
  const annualLimitRows = annualCreditLimitReferences(state.items, offeringsById, state.importedCourseAchievements);
  const profileNeedsAttention = state.selectedScopeId === null || missingGraduationProfilePrerequisites(state.graduationProfile).length > 0;

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === STORAGE_KEY || event.key === BACKUP_KEY) mediaStorageRevision.current += 1;
      if (event.key === STORAGE_KEY || event.key === null) {
        setLoaded(current => ({ ...current, error: '別の画面で保存データが変更されました。再読み込みして最新の計画を確認してください。' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useLayoutEffect(() => {
    if (activeTab !== 'profile' || !profileNavigationRequested.current) return;
    const profilePanel = profilePanelRef.current;
    if (!profilePanel) return;
    profileNavigationRequested.current = false;
    profilePanel.scrollIntoView({ block: 'start' });
    profilePanel.focus({ preventScroll: true });
  }, [activeTab]);

  const openProfileFromCondition = useCallback(() => {
    profileNavigationRequested.current = true;
    setActiveTab('profile');
  }, []);

  useEffect(() => {
    const token = gradeHandoffToken(window.location.hash);
    if (!token) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window || !isGradeHandoffResponse(event.data, token)) return;
      window.removeEventListener('message', receive);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      if (!event.data.ok) { setNotice('拡張機能から成績データを受信できませんでした。JSONを保存またはコピーして取り込めます。'); return; }
      setActiveTab('annual');
      setGradeImportOpen(true);
      setDirectImport(event.data.importData);
    };
    window.addEventListener('message', receive);
    window.postMessage({ type: GRADE_HANDOFF_REQUEST, token }, window.location.origin);
    return () => window.removeEventListener('message', receive);
  }, []);

  async function commit(next: PlannerState, message: string, beforeWrite?: () => void): Promise<boolean> {
    if (loaded.error || writePending.current) return false;
    writePending.current = true; setSaving(true);
    try {
      setLoaded(await savePlannerState(window.localStorage, next, loaded, catalog, navigator.locks, beforeWrite));
      setSaveError(null);
      setNotice(message);
      return true;
    } catch (error) {
      setSaveError(`${error instanceof Error ? error.message : '保存できませんでした。'} 変更は反映していません。保存設定・空き容量を確認し、再操作してください。`);
      return false;
    } finally { writePending.current = false; setSaving(false); }
  }

  function addOffering(id: string) {
    if (state.items.some(item => item.offeringId === id)) return;
    commit({ ...state, items: [...state.items, plannerItemFromCourseSearch(id)] }, `${offeringsById.get(id)!.name}を追加・保存しました。`);
  }

  async function startPersonalMediaPlan(request: PersonalMediaStartRequest): Promise<boolean> {
    if (loaded.error || writePending.current || activeTab !== 'media' || request.reviewedRoute !== navigationKey
      || request.reviewedRaw !== loaded.raw || !Number.isInteger(request.plannedYear)
      || request.plannedYear < 1000 || request.plannedYear > 9999) return false;
    const option = personalMediaStartOptions.find(value => value.sourceCourseId === request.sourceCourseId);
    if (option?.status !== 'new' || option.offering?.id !== request.offeringId) return false;
    // The legacy save still performs its own same-lock CAS. This preflight also
    // rejects a changed source before the confirmation enters that lock.
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== request.reviewedRaw) {
        setSaveError('別の画面で保存データが変更されました。再読み込みしてから本人計画を確認してください。');
        return false;
      }
    } catch {
      setSaveError('保存原文を確認できません。保存設定を確認して再操作してください。');
      return false;
    }
    return commit({ ...state, items: [...state.items, {
      ...plannerItemFromCourseSearch(option.offering.id),
      status: 'in_progress', plannedYear: request.plannedYear, plannedTerm: option.offering.period,
    }] }, '本人のメディア計画を追加しました。公式成績との履修回の同一性は確認していません。');
  }

  function changeItem(id: string, patch: Partial<Omit<PlannerItem, 'offeringId'>>) {
    return commit({ ...state, items: updatePlannerItem(state.items, id, patch) }, '履修計画を保存しました。');
  }

  function changeMediaProgress(offeringId: string, progress: PlannerState['mediaSchoolingProgress'][string], sourceCourseId: string | null) {
    if (mediaDocument.current !== documentGeneration || progress.offeringId !== offeringId ||
      mediaAccess.owners.get(offeringId) !== sourceCourseId) return false;
    const revision = mediaStorageRevision.current;
    return commit({ ...state, mediaSchoolingProgress: { ...state.mediaSchoolingProgress, [offeringId]: progress } }, 'メディアスクーリングの進捗を保存しました。', () => {
      if (mediaDocument.current !== documentGeneration) throw new Error('進捗の編集画面が変わりました。');
      const latest = loadState(window.localStorage, catalog);
      if (latest.error || latest.raw !== loaded.raw || revision !== mediaStorageRevision.current) throw new Error('保存原文が変わりました。再読み込みしてください。');
      const live = latest.state;
      const liveManaged = managedImportedMedia(live.importedCourseAchievements, live.importedStudyRecords, live.importedCourseUserMeta, offeringsById);
      if (mediaProgressAccess(live.items, offeringsById, liveManaged).owners.get(offeringId) !== sourceCourseId) {
        throw new Error('進捗の履修回を特定できないため、編集を保留しました。');
      }
    });
  }

  function changeEvaluation(offeringId: string, evaluation: PlannerState['courseEvaluations'][string]) {
    commit({ ...state, courseEvaluations: { ...state.courseEvaluations, [offeringId]: evaluation } }, '評価記録を保存しました。履修ステータスは変更していません。');
  }
  function changeCorrespondenceProgress(offeringId: string, progress: PlannerState['correspondenceProgress'][string]) {
    commit({ ...state, correspondenceProgress: { ...state.correspondenceProgress, [offeringId]: progress } }, '通信学習の進捗を保存しました。履修ステータスは変更していません。');
  }

  function newPublicCourseId() {
    return crypto.randomUUID();
  }

  function addPublicCourse() {
    // A search click is not a choice of the student's planned year.
    const course = { ...createPublicCourse(newPublicCourseId()), plannedYear: null };
    commit({ ...state, publicCourses: [...state.publicCourses, course] }, `「${course.title}」を公開科目として追加・保存しました。`);
  }

  function changePublicCourse(id: string, patch: Partial<Omit<PublicCourse, 'id' | 'credits'>>) {
    const title = patch.title === undefined ? undefined : normalizePublicCourseTitle(patch.title);
    if (title !== undefined && !isValidPublicCourseTitle(title)) return false;
    return commit({ ...state, publicCourses: state.publicCourses.map(course => course.id === id ? { ...course, ...patch, ...(title === undefined ? {} : { title }) } : course) }, '公開科目を保存しました。');
  }

  async function removeItem(id: string) {
    const removed = removePlannerItem(state.items, id);
    if (!removed) return;
    const offering = offeringsById.get(id);
    if (await commit({ ...state, items: state.items.filter(item => item.offeringId !== id) }, `「${offering?.name ?? '科目'}」を履修計画から削除しました。`)) {
      setUndoItem({ kind: 'item', removed });
    }
  }

  async function removePublic(id: string) {
    const removed = removePublicCourse(state.publicCourses, id);
    if (!removed) return;
    if (await commit({ ...state, publicCourses: state.publicCourses.filter(course => course.id !== id) }, `「${removed.course.title}」を公開科目から削除しました。`)) setUndoItem({ kind: 'publicCourse', removed });
  }

  async function undoRemove() {
    if (!undoItem) return;
    if (undoItem.kind === 'item') {
      const restored = restorePlannerItem(state.items, undoItem.removed);
      const label = offeringsById.get(undoItem.removed.item.offeringId)?.name ?? '科目';
      if (restored === null) { setUndoItem(null); setNotice(`「${label}」はすでに履修計画へ追加されているため、元に戻しませんでした。`); return; }
      if (await commit({ ...state, items: restored }, `「${label}」を履修計画に元に戻しました。`)) setUndoItem(null);
      return;
    }
    const restored = restorePublicCourse(state.publicCourses, undoItem.removed);
    const label = undoItem.removed.course.title;
    if (restored === null) { setUndoItem(null); setNotice(`「${label}」はすでに履修計画へ追加されているため、元に戻しませんでした。`); return; }
    if (await commit({ ...state, publicCourses: restored }, `「${label}」を履修計画に元に戻しました。`)) setUndoItem(null);
  }

  async function recover() {
    let store: Storage;
    try { store = window.localStorage; } catch { setSaveError('ブラウザの保存領域を利用できません。保存設定を確認してください。'); return; }
    if (plannerRecoveryRetryRequired(store)) {
      setRecoveryRetryRequired(true);
      setSaveError('退避後の初期化が完了していません。両原文を読戻し、保存済み保護ファイルを照合してから再試行してください。');
      return;
    }
    try {
      if (store.getItem(BACKUP_KEY) !== null) {
        setInitialProtectionRequired(true);
        setSaveError('既存の退避原文を保護ファイルとして保存・再選択してから初期化してください。');
        return;
      }
    } catch { setSaveError('退避原文を確認できませんでした。保存設定を確認してください。'); return; }
    if (writePending.current) return;
    if (loaded.raw === null || !window.confirm('元の保存データをブラウザ内にバックアップし、履修計画を空にします。よろしいですか？')) return;
    const operation = ++recoveryOperation.current;
    const generation = documentGeneration;
    const isCurrent = () => documentGenerationRef.current === generation && recoveryOperation.current === operation;
    writePending.current = true; setSaving(true);
    try {
      const raw = await recoverPlannerState(store, loaded.raw, catalog, navigator.locks, isCurrent);
      if (!isCurrent()) return; // A completed write must not adopt stale UI state.
      setLoaded({ state: initialState(), raw, error: null });
      setSaveError(null);
      setUndoItem(null); setUndoImport(null); setDirectImport(undefined); setImportEpoch(epoch => epoch + 1);
      setNotice('元データをバックアップし、履修計画を初期化しました。');
    } catch (error) {
      if (!isCurrent()) return;
      if (plannerRecoveryRetryRequired(store)) setRecoveryRetryRequired(true);
      if (error instanceof PlannerOldRecoveryProtectionRequired) setInitialProtectionRequired(true);
      setSaveError('バックアップまたは初期化ができませんでした。元データをダウンロードしてから保存設定を確認してください。');
    } finally { writePending.current = false; setSaving(false); }
  }
  async function prepareInitialProtection() {
    if (loaded.raw === null || writePending.current) return;
    writePending.current = true; setSaving(true); setInitialProtection(null);
    try {
      const prepared = await preparePlannerInitialProtection(window.localStorage, loaded.raw, catalog, navigator.locks);
      if (documentGenerationRef.current !== documentGeneration) throw new Error('保護の準備中に画面の対象が変わりました。もう一度読戻してください。');
      const url = URL.createObjectURL(new Blob([prepared.text], { type: 'application/json' }));
      setInitialProtection({ id: prepared.id, url, verified: false,
        primarySha256: prepared.primarySha256, recoverySha256: prepared.recoverySha256, generation: documentGeneration });
      setSaveError(null);
    } catch (error) { setSaveError(error instanceof Error ? error.message : '旧退避原文を読戻せませんでした。'); }
    finally { writePending.current = false; setSaving(false); }
  }
  async function verifyInitialProtectionFile(file: File) {
    const id = initialProtection?.id;
    if (!id || writePending.current) return;
    writePending.current = true; setSaving(true);
    try {
      await verifyPlannerInitialProtection(window.localStorage, id, await file.text(), navigator.locks);
      if (initialProtection?.generation !== documentGenerationRef.current) throw new Error('照合中に画面の対象が変わりました。もう一度読戻してください。');
      setInitialProtection(current => current?.id === id ? { ...current, verified: true } : current);
      setSaveError(null);
    } catch (error) { setSaveError(error instanceof Error ? error.message : '保存済み保護ファイルを照合できませんでした。'); }
    finally { writePending.current = false; setSaving(false); }
  }
  async function recoverWithInitialProtection() {
    const target = initialProtection;
    if (!target?.verified || target.generation !== documentGenerationRef.current || writePending.current) return;
    if (!window.confirm(`保存済み保護ファイルで照合したP/Rを退避して初期化します。P: ${target.primarySha256} / 旧R: ${target.recoverySha256}。よろしいですか？`)) return;
    writePending.current = true; setSaving(true);
    try {
      const token = await confirmPlannerInitialProtection(window.localStorage, target.id, navigator.locks);
      const raw = await executePlannerInitialProtection(window.localStorage, target.id, token, catalog, navigator.locks,
        () => documentGenerationRef.current === target.generation);
      if (documentGenerationRef.current !== target.generation) {
        setSaveError('復旧保存は完了しましたが画面の対象が変わりました。再読み込みして最新の保存内容を確認してください。');
        return;
      }
      setLoaded({ state: initialState(), raw, error: null });
      setSaveError(null); setInitialProtectionRequired(false); setInitialProtection(null);
      setUndoItem(null); setUndoImport(null); setDirectImport(undefined); setImportEpoch(epoch => epoch + 1);
      setNotice('既存の退避原文を保護してから履修計画を初期化しました。');
    } catch (error) {
      if (plannerRecoveryRetryRequired(window.localStorage)) setRecoveryRetryRequired(true);
      setInitialProtection(null);
      setSaveError(error instanceof Error ? error.message : '初期化できませんでした。保護対象を読み直してください。');
    } finally { writePending.current = false; setSaving(false); }
  }
  async function prepareRecoveryRetry() {
    if (loaded.raw === null || writePending.current) return;
    writePending.current = true; setSaving(true); setRecoveryRetry(null);
    try {
      const prepared = await preparePlannerRecoveryRetry(window.localStorage, loaded.raw, catalog, navigator.locks);
      if (documentGenerationRef.current !== documentGeneration) throw new Error('再試行の準備中に画面の対象が変わりました。もう一度読戻してください。');
      const url = URL.createObjectURL(new Blob([prepared.text], { type: 'application/json' }));
      setRecoveryRetry({ id: prepared.id, url, verified: false, primarySha256: prepared.primarySha256,
        recoverySha256: prepared.recoverySha256, priorRecoverySha256: prepared.priorRecoverySha256, generation: documentGeneration });
      setSaveError(null);
    } catch (error) { setSaveError(error instanceof Error ? error.message : '両原文を読戻せませんでした。'); }
    finally { writePending.current = false; setSaving(false); }
  }
  async function verifyRecoveryRetryFile(file: File) {
    const id = recoveryRetry?.id;
    if (!id || writePending.current) return;
    writePending.current = true; setSaving(true);
    try {
      await verifyPlannerRecoveryRetryProtection(window.localStorage, id, await file.text(), navigator.locks);
      if (recoveryRetry?.generation !== documentGenerationRef.current) throw new Error('照合中に画面の対象が変わりました。もう一度読戻してください。');
      setRecoveryRetry(current => current?.id === id ? { ...current, verified: true } : current);
      setSaveError(null);
    } catch (error) { setSaveError(error instanceof Error ? error.message : '保存済み保護ファイルを照合できませんでした。'); }
    finally { writePending.current = false; setSaving(false); }
  }
  async function retryRecovery() {
    const target = recoveryRetry;
    if (!target?.verified || target.generation !== documentGenerationRef.current || writePending.current) return;
    const confirmed = window.confirm(`保存済み保護ファイルと照合した現在の原文で復旧を再試行します。P: ${target.primarySha256 ?? 'null'} / R: ${target.recoverySha256 ?? 'null'}。履修計画を空にします。よろしいですか？`);
    if (!confirmed) return;
    writePending.current = true; setSaving(true);
    try {
      const token = await confirmPlannerRecoveryRetry(window.localStorage, target.id, navigator.locks);
      const raw = await executePlannerRecoveryRetry(window.localStorage, target.id, token, catalog, navigator.locks,
        () => documentGenerationRef.current === target.generation);
      if (documentGenerationRef.current !== target.generation) {
        setSaveError('復旧保存は完了しましたが画面の対象が変わりました。再読み込みして最新の保存内容を確認してください。');
        return;
      }
      setLoaded({ state: initialState(), raw, error: null });
      setSaveError(null); setRecoveryRetryRequired(false); setRecoveryRetry(null);
      setUndoItem(null); setUndoImport(null); setDirectImport(undefined); setImportEpoch(epoch => epoch + 1);
      setNotice('元データを保護ファイルで照合してから再試行し、履修計画を初期化しました。');
    } catch (error) {
      setRecoveryRetry(null);
      setSaveError(error instanceof Error ? error.message : '再試行できませんでした。両原文の読戻しからやり直してください。');
    } finally { writePending.current = false; setSaving(false); }
  }
  async function applyGradeImport(units: ImportPreviewUnit[]) {
    const next = applyImport(state, units, catalog.offerings);
    const addedItems = next.items.length - state.items.length;
    const addedCourses = next.importedCourseAchievements.length - state.importedCourseAchievements.length;
    const addedRecords = next.importedStudyRecords.length - state.importedStudyRecords.length;
    const oldCourses = new Map(state.importedCourseAchievements.map(row => [row.id, row]));
    const oldRecords = new Map(state.importedStudyRecords.map(record => [record.id, record]));
    const updatedCourses = next.importedCourseAchievements.filter(row => oldCourses.has(row.id) && oldCourses.get(row.id) !== row).length;
    const updatedRecords = next.importedStudyRecords.filter(record => oldRecords.has(record.id) && oldRecords.get(record.id) !== record).length;
    if (await commit(next, `成績表行を追加${addedCourses}件・更新${updatedCourses}件、履修内訳を追加${addedRecords}件・更新${updatedRecords}件保存しました。${addedItems}科目を履修計画に仮登録しました。状態・学年・年度・時期を確認してください。`)) { setUndoImport(state); setDirectImport(undefined); return true; }
    return false;
  }
  function changeImportedAchievement(id: string, patch: Partial<ImportedStudyRecord>) { return commit({ ...state, importedStudyRecords: state.importedStudyRecords.map(record => record.id === id ? { ...record, ...patch } : record) }, '取り込んだ履修実績を保存しました。'); }
  function changeImportedCourseAchievement(id: string, patch: Partial<ImportedCourseAchievement>) {
    const rows = importedCoursesAfterPatch(state.importedCourseAchievements, id, patch);
    if (!rows) return;
    commit({ ...state, importedCourseAchievements: rows }, '成績表の科目行の照合先を保存しました。');
  }

  function resolveImportedMedia(request: MediaConfirmation) {
    if (loaded.error || writePending.current) return;
    const patch = mediaConfirmationPatch(request, loaded.raw, state.importedCourseAchievements, pendingMedia, legacyMedia);
    if (!patch) return;
    // A storage event may still be queued. The existing locked CAS also checks
    // the original bytes if another writer wins after this preflight.
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== loaded.raw) {
        setSaveError('別の画面で保存データが変更されました。再読み込みして照合先を確認してください。');
        return;
      }
    } catch {
      setSaveError('保存原文を確認できません。保存設定を確認して再操作してください。');
      return;
    }
    changeImportedCourseAchievement(request.sourceCourseId, patch);
  }
  function changeImportedUserMeta(id: string, patch: Partial<ImportedCourseUserMeta>) {
    const current = state.importedCourseUserMeta[id] ?? { lifecycleStatus: null, plannedYear: null, plannedTerm: null, studyYear: null };
    return commit({ ...state, importedCourseUserMeta: { ...state.importedCourseUserMeta, [id]: { ...current, ...patch } } }, '成績表の公式情報とは別に、履修管理情報を保存しました。');
  }
  async function deleteImportedAchievement(id: string) { const record = state.importedStudyRecords.find(value => value.id === id); if (!record) return; if (await commit({ ...state, importedStudyRecords: state.importedStudyRecords.filter(value => value.id !== id) }, `「${record.rawName}」の履修実績を削除しました。`)) setUndoImport(state); }
  async function undoGradeImport() { if (undoImport && await commit(undoImport, '取り込んだ履修実績を元に戻しました。')) setUndoImport(null); }
  const onDirectResult = useCallback(({ ok, courseCount }: { ok: boolean; courseCount?: number }) => setNotice(ok ? `拡張機能から${courseCount}科目を受信しました。内容を確認してから反映してください。` : '拡張機能から受信した成績データを検証できませんでした。反映していません。'), []);

  return <div className="bg-[#FAFAFA] text-[#1A1A1A] min-h-screen" style={{ fontFamily: '"Noto Serif JP", serif' }}>
    <section id="planner-start" tabIndex={-1} className="scroll-mt-40 md:scroll-mt-24 bg-[#002255] text-white py-12 sm:py-16 text-center px-4">
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={shouldReduceMotion ? { duration: 0, delay: 0 } : { duration: 0.3 }}
      >
        <p className="text-orange-400 text-sm tracking-[0.2em] mb-3">PLANNER</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-wider">履修計画表</h1>
        <p className="mt-4 text-sm text-white/80">学生生活の様々なことを整理しましょう</p>
      </motion.div>
    </section>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <PlannerSectionEntrance className="border-l-4 border-[#E65C00] bg-orange-50 p-4 text-sm leading-relaxed">
        {!catalog.metadata.graduationCheckComplete && <p>一部要件のみ自動判定しています。卒業可否を保証しません。</p>}
        <p className="mt-1">2026年の収録データを使用しています。計画はこのブラウザに保存されます。修得単位は公式成績の集計を優先します。制度科目の「予定込み」には計画中・履修中・結果待ちを含めます。単位数不明の件数は全状態を対象に表示します。</p>
      </PlannerSectionEntrance>
      {loaded.error && <div role="alert" className="bg-amber-50 border border-amber-300 p-4 space-y-3">
        <p>{loaded.error}</p>
        <p className="text-sm">確認が済むまで追加・変更を停止しています。</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="underline" onClick={() => window.location.reload()}>再読み込み</button>
          {loaded.raw !== null && <>
            <button type="button" className="underline" onClick={() => downloadOriginal(loaded.raw!)}>元データをダウンロード</button>
            <button type="button" className="underline" disabled={saving || recoveryRetryRequired} onClick={recover}>バックアップして初期化</button>
          </>}
        </div>
        {recoveryRetryRequired && <div className="space-y-2 border-t border-amber-300 pt-3 text-sm">
          <p>退避は完了しましたが、履修計画の初期化は失敗しました。通常の初期化は停止しています。現在の本体P・退避Rと旧退避原文を上書き対象外の保護ファイルに保存してください。</p>
          <button type="button" className="underline disabled:opacity-50" disabled={saving} onClick={prepareRecoveryRetry}>現在のP/Rを読戻して保護ファイルを準備</button>
          {recoveryRetry && <div className="space-y-2">
            <p>読戻した対象 P SHA256: {recoveryRetry.primarySha256 ?? 'null'} / R SHA256: {recoveryRetry.recoverySha256 ?? 'null'} / 旧R SHA256: {recoveryRetry.priorRecoverySha256 ?? 'null'}</p>
            <a className="underline" href={recoveryRetry.url} download="hosei-planner-recovery-retry-protection.json">保護ファイルをダウンロード</a>
            <label className="block">保存先の保護ファイルを選び、実内容を照合する
              <input type="file" accept="application/json,.json" disabled={saving} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void verifyRecoveryRetryFile(file); }} />
            </label>
            {recoveryRetry.verified && <>
              <p>選択した保護ファイルの原文・SHAと、提示したP/R・旧Rを照合しました。再試行の確認対象は上記の原文です。</p>
              <button type="button" className="underline disabled:opacity-50" disabled={saving} onClick={retryRecovery}>保護した原文を確認して再試行</button>
            </>}
          </div>}
        </div>}
        {initialProtectionRequired && !recoveryRetryRequired && <div className="space-y-2 border-t border-amber-300 pt-3 text-sm">
          <p>既存の退避原文があります。初期化前に本体Pと退避Rの正確な原文を外部ファイルに保存し、そのファイルを再選択してください。ダウンロード開始だけでは初期化しません。</p>
          <button type="button" className="underline disabled:opacity-50" disabled={saving} onClick={prepareInitialProtection}>現在のP/Rを読戻して保護ファイルを準備</button>
          {initialProtection && <div className="space-y-2">
            <p>保護対象 P SHA256: {initialProtection.primarySha256} / 旧R SHA256: {initialProtection.recoverySha256}</p>
            <a className="underline" href={initialProtection.url} download="hosei-planner-initial-recovery-protection.json">保護ファイルをダウンロード</a>
            <label className="block">保存先の保護ファイルを選び、実内容を照合する
              <input type="file" accept="application/json,.json" disabled={saving} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void verifyInitialProtectionFile(file); }} />
            </label>
            {initialProtection.verified && <button type="button" className="underline disabled:opacity-50" disabled={saving} onClick={recoverWithInitialProtection}>保護した原文を確認して初期化</button>}
          </div>}
        </div>}
      </div>}
      {saveError && <p role="alert" className="border border-red-300 bg-red-50 p-4 text-sm">{saveError}</p>}
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={shouldReduceMotion ? { duration: 0, delay: 0 } : {
          delay: 0.2
        }}
      >
        <CreditSummary
          summary={summarizeCredits(
            importedDerived.plannerItems,
            offeringsById,
            state.publicCourses
          )}
          importedEarnedCredits={importedEarnedCreditsTotal(
            state.importedCourseAchievements
          )}
        />
      </motion.div>
      <div className="min-h-5 text-sm text-[#002255]">
        <p role="status" aria-live="polite" className="inline">{saving ? '保存処理を待っています。完了後に編集できます。' : notice}</p>
        {undoItem && <button type="button" disabled={loaded.error !== null || saving} onClick={undoRemove} className="ml-2 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002255]">元に戻す</button>}
        {undoImport && <button type="button" disabled={loaded.error !== null || saving} onClick={undoGradeImport} className="ml-2 underline underline-offset-2">取り込みを元に戻す</button>}
      </div>
      <PlannerSectionEntrance className="space-y-6">
      <div role="tablist" aria-label="履修プランナーの表示" className="grid w-full max-w-2xl grid-cols-3 border-b border-gray-300">
        <button disabled={saving} id="annual-tab" type="button" role="tab" aria-selected={activeTab === 'annual'} aria-controls="annual-panel" onClick={() => setActiveTab('annual')} className={`min-w-0 px-1 py-3 text-xs sm:px-4 sm:text-sm ${activeTab === 'annual' ? 'border-b-2 border-[#E65C00] text-[#002255]' : 'text-gray-600'}`}>年間履修計画</button>
        <button disabled={saving} id="media-tab" type="button" role="tab" aria-selected={activeTab === 'media'} aria-controls="media-panel" onClick={() => setActiveTab('media')} className={`min-w-0 px-1 py-3 text-xs sm:px-4 sm:text-sm ${activeTab === 'media' ? 'border-b-2 border-[#E65C00] text-[#002255]' : 'text-gray-600'}`}>メディア</button>
        <button disabled={saving} id="profile-tab" type="button" role="tab" aria-selected={activeTab === 'profile'} aria-controls="profile-panel" onClick={() => setActiveTab('profile')} className={`min-w-0 px-1 py-3 text-xs sm:px-4 sm:text-sm ${activeTab === 'profile' ? 'border-b-2 border-[#E65C00] text-[#002255]' : 'text-gray-600'}`}>プロフィール</button>
      </div>
      {loaded.recognitionWarning && activeTab !== 'profile' && <p role="alert" className="mt-4 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">{loaded.recognitionWarning}</p>}
      {activeTab === 'annual' && <div id="annual-panel" role="tabpanel" aria-labelledby="annual-tab" className="space-y-6">
        {profileNeedsAttention && <p className="border-l-4 border-sky-600 bg-sky-50 p-3 text-sm text-sky-900">卒業判定に必要なプロフィール設定があります。プロフィールタブで確認してください。</p>}
        <AnnualCreditLimitNotice rows={annualLimitRows} />
        <CourseSearch curriculumProgress={curriculumProgress} classify={classify} catalog={catalog} selectedScopeId={state.selectedScopeId} offerings={catalog.offerings} addedIds={new Set(state.items.map(item => item.offeringId))} disabled={loaded.error !== null || saving} onAdd={addOffering} onAddPublicCourse={addPublicCourse} />
        {mediaAccess.heldOfferingIds.size > 0 && <p className="text-sm text-amber-900">履修回を確認できないメディア進捗は、メディアタブで閲覧できます。履修計画の進捗表示と書き出しでは保留しています。</p>}
        <CurriculumCourseList key={importEpoch} heldMediaOfferingIds={mediaAccess.heldOfferingIds} catalog={catalog} classify={classify} view={curriculumCourseView} publicCourses={state.publicCourses} offerings={offeringsById} disabled={loaded.error !== null || saving} onChange={changeItem} onChangeImportedMeta={changeImportedUserMeta} onChangeImportedCourse={changeImportedCourseAchievement} onRemove={removeItem} onChangePublicCourse={changePublicCourse} onRemovePublicCourse={removePublic} onChangeEvaluation={changeEvaluation} onChangeCorrespondence={changeCorrespondenceProgress} onOpenMedia={() => setActiveTab('media')} />
        <PlannerExportActions presentation={exportPresentation} />
        <PlannerBackupPanel catalog={catalog} loaded={loaded} disabled={saving} onRestored={next => {
          setLoaded(next); setUndoItem(null); setUndoImport(null); setDirectImport(undefined);
          setImportEpoch(epoch => epoch + 1); setSaveError(null); setNotice('バックアップで全データを置き換えました。');
        }} onBusyChange={busy => { writePending.current = busy; setSaving(busy); }} />
        <details
          id="grade-import"
          tabIndex={-1}
          open={gradeImportOpen}
          onToggle={event => setGradeImportOpen(event.currentTarget.open)}
          className="scroll-mt-40 md:scroll-mt-24 border border-gray-200 bg-white"
        >
          <summary className="cursor-pointer p-4 font-medium text-[#002255]">
            成績データを取り込む
          </summary>
          <GradeImportPanel key={importEpoch} offerings={catalog.offerings} plannedItems={state.items} existing={state.importedStudyRecords} existingCourses={state.importedCourseAchievements} disabled={loaded.error !== null || saving} onApply={applyGradeImport} directImport={directImport} onDirectResult={onDirectResult} />
        </details>
        <ImportedAchievements records={state.importedStudyRecords} courseRows={state.importedCourseAchievements} offerings={catalog.offerings} catalog={catalog} notices={graduationProgress.importedWarnings} disabled={loaded.error !== null || saving} onChange={changeImportedAchievement} onChangeCourse={changeImportedCourseAchievement} onDelete={deleteImportedAchievement} />
        {selectablePrograms(catalog).some(program => program.scopeId === state.selectedScopeId) && <><GraduationProgress progress={graduationProgress} context={{ catalog, scopeId: state.selectedScopeId, profile: state.graduationProfile, importedRows: state.importedCourseAchievements }} onOpenProfile={openProfileFromCondition} />{shouldShowThesisGuidance(state, catalog, state.selectedScopeId) && <ThesisGuidance key={importEpoch} disabled={loaded.error !== null || saving} catalog={catalog} scopeId={state.selectedScopeId} profile={state.graduationProfile} progress={thesisGuidance} eligibilityCredits={guidanceEligibilityCredits(state, catalog)} onChange={next => state.selectedScopeId && commit({ ...state, thesisGuidanceByScope: { ...state.thesisGuidanceByScope, [state.selectedScopeId]: next } }, '卒論手続の記録を保存しました。')} />}</>}
      </div>}
      {activeTab === 'media' && <div id="media-panel" role="tabpanel" aria-labelledby="media-tab" tabIndex={-1} className="scroll-mt-40 md:scroll-mt-24">
        <MediaSchoolingProgress key={importEpoch} items={state.items} offerings={offeringsById} progress={state.mediaSchoolingProgress} officialAchievements={officialMedia} importedAchievements={legacyMedia} importedManaged={managedMedia.media} heldOfferingIds={mediaAccess.heldOfferingIds} importedPending={pendingMedia} partialEarnedSourceIds={partialEarnedMediaSourceIds} personalStartOptions={personalMediaStartOptions} onStartPersonalMedia={startPersonalMediaPlan} routeKey={navigationKey} savedRaw={loaded.raw} disabled={loaded.error !== null || saving} onChange={changeMediaProgress} onResolveImportedMedia={resolveImportedMedia} />
      </div>}
      {activeTab === 'profile' && <div ref={profilePanelRef} id="profile-panel" role="tabpanel" aria-labelledby="profile-tab" tabIndex={-1} className="scroll-mt-24">
        <PlannerProfileTab
          catalog={catalog}
          scopeId={state.selectedScopeId}
          profile={state.graduationProfile}
          thesis={thesisProgress}
          disabled={loaded.error !== null || saving}
          recognitionWarning={loaded.recognitionWarning}
          onScopeChange={selectedScopeId =>
            commit(
              stateForScopeChange(state, catalog, selectedScopeId),
              '所属を保存しました。卒業論文の進捗は学科ごとに保存します。'
            )
          }
          onProfileChange={graduationProfile =>
            commit({ ...state, graduationProfile }, 'プロフィール設定を保存しました。')
          }
          onThesisSelectionChange={selection =>
            commit(
              setThesisProgressForScope(state, catalog, state.selectedScopeId, { selection }),
              '卒業論文の選択を保存しました。'
            )
          }
          onThesisStatusChange={status =>
            commit(
              setThesisProgressForScope(state, catalog, state.selectedScopeId, { status }),
              '卒業論文の進捗を保存しました。'
            )
          }
        />
      </div>
      }
      </PlannerSectionEntrance>
    </div>
  </div>;
}
