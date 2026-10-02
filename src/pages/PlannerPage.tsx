import CurriculumCourseProgress from '../components/planner/CurriculumCourseProgress';
import { deriveCurriculumCourseProgress } from '../planner/curriculumCourseProgress';
import { useCallback, useEffect, useState } from 'react';
import CourseSearch from '../components/planner/CourseSearch';
import PlannedCourseList from '../components/planner/PlannedCourseList';
import ProgramSettings from '../components/planner/ProgramSettings';
import CategorySummary from '../components/planner/CategorySummary';
import { annualCreditLimitReferences, createCreditClassifier, selectablePrograms, summarizeCategories } from '../planner/annualPlan';
import CreditSummary from '../components/planner/CreditSummary';
import GraduationProgress from '../components/planner/GraduationProgress';
import PlannerProfileTab from '../components/planner/PlannerProfileTab';
import ThesisGuidance from '../components/planner/ThesisGuidance';
import { catalog, offeringsById } from '../planner/catalog';
import { summarizeCredits } from '../planner/calculations';
import { initialState, loadState, recoverState, saveRecoveredState, STORAGE_KEY, type LoadResult } from '../planner/storage';
import type { ImportedCourseUserMeta, PlannerItem, PlannerState, PublicCourse } from '../planner/plannerCatalog';
import { calculateGraduationProgress } from '../planner/graduationProgress';
import { removePlannerItem, removePublicCourse, restorePlannerItem, restorePublicCourse, type RemovedPlanEntry } from '../planner/removeUndo';
import { createPublicCourse, isValidPublicCourseTitle, normalizePublicCourseTitle } from '../planner/publicCourses';
import { setThesisProgressForScope, stateForScopeChange, thesisProgressForScope } from '../planner/thesisSelection';
import MediaSchoolingProgress from '../components/planner/MediaSchoolingProgress';
import PlannerExportActions from '../components/planner/PlannerExportActions';
import { plannerExportPresentation } from '../planner/plannerExport';
import GradeImportPanel from '../components/planner/GradeImportPanel';
import ImportedAchievements from '../components/planner/ImportedAchievements';
import AnnualCreditLimitNotice from '../components/planner/AnnualCreditLimitNotice';
import { applyImport, importedEarnedCreditsTotal, type ImportedCourseAchievement, type ImportedStudyRecord, type ImportPreviewUnit } from '../planner/gradeImportApply';
import { deriveImportedAchievements, managedImportedMedia } from '../planner/importedAchievementCalculations';
import { createUnifiedCourseRows } from '../planner/unifiedCourseView';
import { plannerItemFromCourseSearch, updatePlannerItem } from '../planner/plannerItemState';
import { GRADE_HANDOFF_REQUEST, gradeHandoffToken, isGradeHandoffResponse } from '../planner/directGradeHandoff';
import { guidanceEligibilityCredits, guidanceForScope } from '../planner/thesisGuidance';
import BrowserExtensionEntrySection from '../components/planner/BrowserExtensionEntrySection';
import { missingGraduationProfilePrerequisites } from '../planner/graduationProfile';

function readSavedState(): LoadResult {
  try { return loadState(window.localStorage, catalog); }
  catch { return { state: initialState(), raw: null, error: 'ブラウザの保存領域を利用できません。保存設定を確認して再読み込みしてください。' }; }
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
  const [loaded, setLoaded] = useState(readSavedState);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [undoItem, setUndoItem] = useState<RemovedPlanEntry | null>(null);
  const [undoImport, setUndoImport] = useState<PlannerState | null>(null);
  const [activeTab, setActiveTab] = useState<'annual' | 'media' | 'profile'>('annual');
  const [directImport, setDirectImport] = useState<unknown | undefined>(undefined);
  const state = loaded.state;
  const classify = createCreditClassifier(catalog, state.selectedScopeId);
  const thesisProgress = thesisProgressForScope(state, catalog, state.selectedScopeId);
  const thesisGuidance = guidanceForScope(state, state.selectedScopeId);
  const graduationProgress = calculateGraduationProgress(state.items, catalog, state.selectedScopeId, state.publicCourses, thesisProgress.selection, state.importedStudyRecords, state.importedCourseAchievements, state.graduationProfile, thesisProgress);
  const importedDerived = deriveImportedAchievements(state.importedStudyRecords, offeringsById, state.items, state.importedCourseAchievements, catalog, state.selectedScopeId);
  const curriculumProgress = deriveCurriculumCourseProgress(state.items, catalog, state.importedCourseAchievements, state.selectedScopeId);
  const unifiedCourseRows = createUnifiedCourseRows(state.items, state.importedCourseAchievements, offeringsById, state.importedCourseUserMeta);
  const managedMedia = managedImportedMedia(state.importedCourseAchievements, state.importedStudyRecords, state.importedCourseUserMeta, offeringsById);
  const exportPresentation = plannerExportPresentation(state, catalog);
  const annualLimitRows = annualCreditLimitReferences(state.items, offeringsById);
  const profileNeedsAttention = state.selectedScopeId === null || missingGraduationProfilePrerequisites(state.graduationProfile).length > 0;

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        setLoaded(current => ({ ...current, error: '別の画面で保存データが変更されました。再読み込みして最新の計画を確認してください。' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const token = gradeHandoffToken(window.location.hash);
    if (!token) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window || !isGradeHandoffResponse(event.data, token)) return;
      window.removeEventListener('message', receive);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      if (!event.data.ok) { setNotice('拡張機能から成績データを受信できませんでした。JSONを保存またはコピーして取り込めます。'); return; }
      setDirectImport(event.data.importData);
    };
    window.addEventListener('message', receive);
    window.postMessage({ type: GRADE_HANDOFF_REQUEST, token }, window.location.origin);
    return () => window.removeEventListener('message', receive);
  }, []);

  function commit(next: PlannerState, message: string): boolean {
    if (loaded.error) return false;
    try {
      setLoaded(saveRecoveredState(window.localStorage, next, loaded, catalog));
      setSaveError(null);
      setNotice(message);
      return true;
    } catch (error) {
      setSaveError(`${error instanceof Error ? error.message : '保存できませんでした。'} 変更は反映していません。保存設定・空き容量を確認し、再操作してください。`);
      return false;
    }
  }

  function addOffering(id: string) {
    if (state.items.some(item => item.offeringId === id)) return;
    commit({ ...state, items: [...state.items, plannerItemFromCourseSearch(id)] }, `${offeringsById.get(id)!.name}を追加・保存しました。`);
  }

  function changeItem(id: string, patch: Partial<Omit<PlannerItem, 'offeringId'>>) {
    commit({ ...state, items: updatePlannerItem(state.items, id, patch) }, '履修計画を保存しました。');
  }

  function changeMediaProgress(offeringId: string, progress: PlannerState['mediaSchoolingProgress'][string]) {
    commit({ ...state, mediaSchoolingProgress: { ...state.mediaSchoolingProgress, [offeringId]: progress } }, 'メディアスクーリングの進捗を保存しました。');
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
    const course = createPublicCourse(newPublicCourseId());
    commit({ ...state, publicCourses: [...state.publicCourses, course] }, `「${course.title}」を公開科目として追加・保存しました。`);
  }

  function changePublicCourse(id: string, patch: Partial<Omit<PublicCourse, 'id' | 'credits'>>) {
    const title = patch.title === undefined ? undefined : normalizePublicCourseTitle(patch.title);
    if (title !== undefined && !isValidPublicCourseTitle(title)) return;
    commit({ ...state, publicCourses: state.publicCourses.map(course => course.id === id ? { ...course, ...patch, ...(title === undefined ? {} : { title }) } : course) }, '公開科目を保存しました。');
  }

  function removeItem(id: string) {
    const removed = removePlannerItem(state.items, id);
    if (!removed) return;
    const offering = offeringsById.get(id);
    if (commit({ ...state, items: state.items.filter(item => item.offeringId !== id) }, `「${offering?.name ?? '科目'}」を履修計画から削除しました。`)) {
      setUndoItem({ kind: 'item', removed });
    }
  }

  function removePublic(id: string) {
    const removed = removePublicCourse(state.publicCourses, id);
    if (!removed) return;
    if (commit({ ...state, publicCourses: state.publicCourses.filter(course => course.id !== id) }, `「${removed.course.title}」を公開科目から削除しました。`)) setUndoItem({ kind: 'publicCourse', removed });
  }

  function undoRemove() {
    if (!undoItem) return;
    if (undoItem.kind === 'item') {
      const restored = restorePlannerItem(state.items, undoItem.removed);
      const label = offeringsById.get(undoItem.removed.item.offeringId)?.name ?? '科目';
      if (restored === null) { setUndoItem(null); setNotice(`「${label}」はすでに履修計画へ追加されているため、元に戻しませんでした。`); return; }
      if (commit({ ...state, items: restored }, `「${label}」を履修計画に元に戻しました。`)) setUndoItem(null);
      return;
    }
    const restored = restorePublicCourse(state.publicCourses, undoItem.removed);
    const label = undoItem.removed.course.title;
    if (restored === null) { setUndoItem(null); setNotice(`「${label}」はすでに履修計画へ追加されているため、元に戻しませんでした。`); return; }
    if (commit({ ...state, publicCourses: restored }, `「${label}」を履修計画に元に戻しました。`)) setUndoItem(null);
  }

  function recover() {
    if (loaded.raw === null || !window.confirm('元の保存データをブラウザ内にバックアップし、履修計画を空にします。よろしいですか？')) return;
    try {
      const raw = recoverState(window.localStorage, loaded.raw, catalog);
      setLoaded({ state: initialState(), raw, error: null });
      setSaveError(null);
      setNotice('元データをバックアップし、履修計画を初期化しました。');
    } catch {
      setSaveError('バックアップまたは初期化ができませんでした。元データをダウンロードしてから保存設定を確認してください。');
    }
  }
  function applyGradeImport(units: ImportPreviewUnit[]) {
    const next = applyImport(state, units, catalog.offerings);
    const addedItems = next.items.length - state.items.length;
    const addedCourses = next.importedCourseAchievements.length - state.importedCourseAchievements.length;
    const addedRecords = next.importedStudyRecords.length - state.importedStudyRecords.length;
    if (commit(next, `${addedCourses}件の成績表行と${addedRecords}件の履修実績を保存し、${addedItems}科目を履修計画に仮登録しました。状態・学年・年度・時期を確認してください。`)) { setUndoImport(state); setDirectImport(undefined); return true; }
    return false;
  }
  function changeImportedAchievement(id: string, patch: Partial<ImportedStudyRecord>) { commit({ ...state, importedStudyRecords: state.importedStudyRecords.map(record => record.id === id ? { ...record, ...patch } : record) }, '取り込んだ履修実績を保存しました。'); }
  function changeImportedCourseAchievement(id: string, patch: Partial<ImportedCourseAchievement>) { commit({ ...state, importedCourseAchievements: state.importedCourseAchievements.map(record => record.id === id ? { ...record, ...patch } : record) }, '成績表の科目行の照合先を保存しました。'); }
  function changeImportedUserMeta(id: string, patch: Partial<ImportedCourseUserMeta>) {
    const current = state.importedCourseUserMeta[id] ?? { lifecycleStatus: null, plannedYear: null, plannedTerm: null, studyYear: null };
    commit({ ...state, importedCourseUserMeta: { ...state.importedCourseUserMeta, [id]: { ...current, ...patch } } }, '成績表の公式情報とは別に、履修管理情報を保存しました。');
  }
  function deleteImportedAchievement(id: string) { const record = state.importedStudyRecords.find(value => value.id === id); if (!record) return; if (commit({ ...state, importedStudyRecords: state.importedStudyRecords.filter(value => value.id !== id) }, `「${record.rawName}」の履修実績を削除しました。`)) setUndoImport(state); }
  function undoGradeImport() { if (undoImport && commit(undoImport, '取り込んだ履修実績を元に戻しました。')) setUndoImport(null); }
  const onDirectResult = useCallback(({ ok, courseCount }: { ok: boolean; courseCount?: number }) => setNotice(ok ? `拡張機能から${courseCount}科目を受信しました。内容を確認してから反映してください。` : '拡張機能から受信した成績データを検証できませんでした。反映していません。'), []);

  return <div className="bg-[#FAFAFA] text-[#1A1A1A] min-h-screen" style={{ fontFamily: '"Noto Serif JP", serif' }}>
    <section className="bg-[#002255] text-white py-12 sm:py-16 text-center px-4">
      <p className="text-orange-400 text-sm tracking-[0.2em] mb-3">2026 PLANNER</p>
      <h1 className="text-3xl sm:text-4xl font-light tracking-wider">履修プランナー</h1>
      <p className="mt-4 text-sm text-white/80">科目を探し、学びの予定と進捗を記録する。</p>
    </section>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="border-l-4 border-[#E65C00] bg-orange-50 p-4 text-sm leading-relaxed">
        {!catalog.metadata.graduationCheckComplete && <p>一部要件のみ自動判定しています。卒業可否を保証しません。</p>}
        <p className="mt-1">2026年の収録データを使用しています。計画はこのブラウザに保存されます。修得単位は公式成績の集計を優先します。制度科目の「予定込み」には計画中・履修中・結果待ちを含めます。単位数不明の件数は全状態を対象に表示します。</p>
      </div>
      {loaded.error && <div role="alert" className="bg-amber-50 border border-amber-300 p-4 space-y-3">
        <p>{loaded.error}</p>
        <p className="text-sm">確認が済むまで追加・変更を停止しています。</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="underline" onClick={() => window.location.reload()}>再読み込み</button>
          {loaded.raw !== null && <>
            <button type="button" className="underline" onClick={() => downloadOriginal(loaded.raw!)}>元データをダウンロード</button>
            <button type="button" className="underline" onClick={recover}>バックアップして初期化</button>
          </>}
        </div>
      </div>}
      {saveError && <p role="alert" className="border border-red-300 bg-red-50 p-4 text-sm">{saveError}</p>}
      <CreditSummary summary={summarizeCredits(importedDerived.plannerItems, offeringsById, state.publicCourses)} importedEarnedCredits={importedEarnedCreditsTotal(state.importedCourseAchievements)} />
      <div className="min-h-5 text-sm text-[#002255]">
        <p role="status" className="inline">{notice}</p>
        {undoItem && <button type="button" onClick={undoRemove} className="ml-2 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002255]">元に戻す</button>}
        {undoImport && <button type="button" onClick={undoGradeImport} className="ml-2 underline underline-offset-2">取り込みを元に戻す</button>}
      </div>
      <div role="tablist" aria-label="履修プランナーの表示" className="grid w-full max-w-2xl grid-cols-3 border-b border-gray-300">
        <button id="annual-tab" type="button" role="tab" aria-selected={activeTab === 'annual'} aria-controls="annual-panel" onClick={() => setActiveTab('annual')} className={`min-w-0 px-1 py-3 text-xs sm:px-4 sm:text-sm ${activeTab === 'annual' ? 'border-b-2 border-[#E65C00] text-[#002255]' : 'text-gray-600'}`}>年間履修計画</button>
        <button id="media-tab" type="button" role="tab" aria-selected={activeTab === 'media'} aria-controls="media-panel" onClick={() => setActiveTab('media')} className={`min-w-0 px-1 py-3 text-xs sm:px-4 sm:text-sm ${activeTab === 'media' ? 'border-b-2 border-[#E65C00] text-[#002255]' : 'text-gray-600'}`}>メディア</button>
        <button id="profile-tab" type="button" role="tab" aria-selected={activeTab === 'profile'} aria-controls="profile-panel" onClick={() => setActiveTab('profile')} className={`min-w-0 px-1 py-3 text-xs sm:px-4 sm:text-sm ${activeTab === 'profile' ? 'border-b-2 border-[#E65C00] text-[#002255]' : 'text-gray-600'}`}>プロフィール</button>
      </div>
      {loaded.recognitionWarning && activeTab !== 'profile' && <p role="alert" className="mt-4 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">{loaded.recognitionWarning}</p>}
      {activeTab === 'annual' && <div id="annual-panel" role="tabpanel" aria-labelledby="annual-tab" className="space-y-6">
        <ProgramSettings catalog={catalog} scopeId={state.selectedScopeId} thesis={thesisProgress} disabled={loaded.error !== null}
          onThesisSelectionChange={selection => commit(setThesisProgressForScope(state, catalog, state.selectedScopeId, { selection }), '卒業論文の選択を保存しました。')}
          onThesisStatusChange={status => commit(setThesisProgressForScope(state, catalog, state.selectedScopeId, { status }), '卒業論文の進捗を保存しました。')} />
        {profileNeedsAttention && <p className="border-l-4 border-sky-600 bg-sky-50 p-3 text-sm text-sky-900">卒業判定に必要なプロフィール設定があります。プロフィールタブで確認してください。</p>}
        <AnnualCreditLimitNotice rows={annualLimitRows} />
        <BrowserExtensionEntrySection />
        <GradeImportPanel offerings={catalog.offerings} plannedItems={state.items} existing={state.importedStudyRecords} existingCourses={state.importedCourseAchievements} disabled={loaded.error !== null} onApply={applyGradeImport} directImport={directImport} onDirectResult={onDirectResult} />
        <ImportedAchievements records={state.importedStudyRecords} courseRows={state.importedCourseAchievements} offerings={catalog.offerings} warnings={importedDerived.warnings} disabled={loaded.error !== null} onChange={changeImportedAchievement} onChangeCourse={changeImportedCourseAchievement} onDelete={deleteImportedAchievement} />
        <CourseSearch curriculumProgress={curriculumProgress} classify={classify} catalog={catalog} selectedScopeId={state.selectedScopeId} offerings={catalog.offerings} addedIds={new Set(state.items.map(item => item.offeringId))} disabled={loaded.error !== null} onAdd={addOffering} onAddPublicCourse={addPublicCourse} />
        <PlannedCourseList classify={classify} unifiedRows={unifiedCourseRows} publicCourses={state.publicCourses} offerings={offeringsById} correspondenceProgress={state.correspondenceProgress} mediaProgress={state.mediaSchoolingProgress} evaluations={state.courseEvaluations} importedUserMeta={state.importedCourseUserMeta} disabled={loaded.error !== null} onChange={changeItem} onChangeImportedMeta={changeImportedUserMeta} onRemove={removeItem} onChangePublicCourse={changePublicCourse} onRemovePublicCourse={removePublic} onChangeEvaluation={changeEvaluation} onChangeCorrespondence={changeCorrespondenceProgress} onOpenMedia={() => setActiveTab('media')} />
        <CurriculumCourseProgress progress={curriculumProgress} catalog={catalog} />
        <PlannerExportActions presentation={exportPresentation} />
        {selectablePrograms(catalog).some(program => program.scopeId === state.selectedScopeId) && <CategorySummary rows={summarizeCategories(importedDerived.plannerItems, catalog, state.selectedScopeId, state.publicCourses, importedDerived.categoryItems, importedDerived.categoryOfferings, importedDerived.categoryOverrides)} importedAchievementCount={importedDerived.categoryItems.length} importedUnclassified={importedDerived.unclassified} />}
        {selectablePrograms(catalog).some(program => program.scopeId === state.selectedScopeId) && <><GraduationProgress progress={graduationProgress} /><ThesisGuidance catalog={catalog} scopeId={state.selectedScopeId} profile={state.graduationProfile} progress={thesisGuidance} eligibilityCredits={guidanceEligibilityCredits(state, catalog)} onChange={next => state.selectedScopeId && commit({ ...state, thesisGuidanceByScope: { ...state.thesisGuidanceByScope, [state.selectedScopeId]: next } }, '卒論手続の記録を保存しました。')} /></>}
      </div>}
      {activeTab === 'media' && <div id="media-panel" role="tabpanel" aria-labelledby="media-tab">
        <MediaSchoolingProgress items={state.items} offerings={offeringsById} progress={state.mediaSchoolingProgress} importedAchievements={importedDerived.media} importedManaged={managedMedia.media} importedPending={[...importedDerived.mediaPending, ...managedMedia.pending]} disabled={loaded.error !== null} onChange={changeMediaProgress} onResolveImportedMedia={(sourceCourseId, offeringId) => { const offering = offeringsById.get(offeringId); if (offering) changeImportedCourseAchievement(sourceCourseId, { selectedOfferingId: offeringId, selectionSource: 'manual', courseId: offering.courseId, match: offering.courseId && offering.resolutionStatus === 'matched' ? 'exact_unique' : 'ambiguous' }); }} />
      </div>}
      {activeTab === 'profile' && <div id="profile-panel" role="tabpanel" aria-labelledby="profile-tab">
        <PlannerProfileTab catalog={catalog} scopeId={state.selectedScopeId} profile={state.graduationProfile} disabled={loaded.error !== null} recognitionWarning={loaded.recognitionWarning}
          onScopeChange={selectedScopeId => commit(stateForScopeChange(state, catalog, selectedScopeId), '所属を保存しました。卒業論文の進捗は学科ごとに保存します。')}
          onProfileChange={graduationProfile => commit({ ...state, graduationProfile }, 'プロフィール設定を保存しました。')} />
      </div>}
    </div>
  </div>;
}
