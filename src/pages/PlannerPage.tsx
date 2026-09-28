import { useEffect, useState } from 'react';
import CourseSearch from '../components/planner/CourseSearch';
import PlannedCourseList from '../components/planner/PlannedCourseList';
import ProgramSettings from '../components/planner/ProgramSettings';
import CategorySummary from '../components/planner/CategorySummary';
import { createCreditClassifier, selectablePrograms, summarizeCategories } from '../planner/annualPlan';
import CreditSummary from '../components/planner/CreditSummary';
import GraduationProgress from '../components/planner/GraduationProgress';
import { catalog, offeringsById } from '../planner/catalog';
import { summarizeCredits } from '../planner/calculations';
import { initialState, loadState, recoverState, saveState, STORAGE_KEY, type LoadResult } from '../planner/storage';
import type { PlannerItem, PlannerState, PublicCourse } from '../planner/plannerCatalog';
import { calculateGraduationProgress } from '../planner/graduationProgress';
import { removePlannerItem, removePublicCourse, restorePlannerItem, restorePublicCourse, type RemovedPlanEntry } from '../planner/removeUndo';
import { createPublicCourse, isValidPublicCourseTitle, normalizePublicCourseTitle } from '../planner/publicCourses';
import { stateForScopeChange } from '../planner/thesisSelection';
import MediaSchoolingProgress from '../components/planner/MediaSchoolingProgress';

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
  const [activeTab, setActiveTab] = useState<'annual' | 'media'>('annual');
  const state = loaded.state;
  const classify = createCreditClassifier(catalog, state.selectedScopeId);
  const graduationProgress = calculateGraduationProgress(state.items, catalog, state.selectedScopeId, state.publicCourses, state.thesisSelection);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        setLoaded(current => ({ ...current, error: '別の画面で保存データが変更されました。再読み込みして最新の計画を確認してください。' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function commit(next: PlannerState, message: string): boolean {
    if (loaded.error) return false;
    try {
      const raw = saveState(window.localStorage, next, loaded.raw, catalog);
      setLoaded({ state: next, raw, error: null });
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
    commit({ ...state, items: [...state.items, { offeringId: id, status: 'planned', plannedYear: 2026, plannedTerm: null, studyYear: null, earnedOrder: null }] }, `${offeringsById.get(id)!.name}を追加・保存しました。`);
  }

  function changeItem(id: string, patch: Partial<Omit<PlannerItem, 'offeringId'>>) {
    commit({ ...state, items: state.items.map(item => item.offeringId === id
      ? { ...item, ...patch, ...(patch.status && patch.status !== 'earned' ? { earnedOrder: null } : {}) }
      : item) }, '履修計画を保存しました。');
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

  return <div className="bg-[#FAFAFA] text-[#1A1A1A] min-h-screen" style={{ fontFamily: '"Noto Serif JP", serif' }}>
    <section className="bg-[#002255] text-white py-12 sm:py-16 text-center px-4">
      <p className="text-orange-400 text-sm tracking-[0.2em] mb-3">2026 PLANNER</p>
      <h1 className="text-3xl sm:text-4xl font-light tracking-wider">履修プランナー</h1>
      <p className="mt-4 text-sm text-white/80">科目を探し、学びの予定と進捗を記録する。</p>
    </section>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="border-l-4 border-[#E65C00] bg-orange-50 p-4 text-sm leading-relaxed">
        {!catalog.metadata.graduationCheckComplete && <p>一部要件のみ自動判定しています。卒業可否を保証しません。</p>}
        <p className="mt-1">2026年の収録データを使用しています。計画はこのブラウザに保存されます。結果待ち・不合格・取りやめの単位は合計に含めません。単位数不明の件数は全状態を対象に表示します。</p>
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
      <ProgramSettings catalog={catalog} scopeId={state.selectedScopeId} thesisSelection={state.thesisSelection} disabled={loaded.error !== null}
        onChange={selectedScopeId => commit(stateForScopeChange(state, selectedScopeId), '所属を保存しました。卒業論文の選択は未定に戻しました。')}
        onThesisSelectionChange={thesisSelection => commit({ ...state, thesisSelection }, '卒業論文の選択を保存しました。')} />
      <CreditSummary summary={summarizeCredits(state.items, offeringsById, state.publicCourses)} />
      {selectablePrograms(catalog).some(p => p.scopeId === state.selectedScopeId) && <CategorySummary rows={summarizeCategories(state.items, catalog, state.selectedScopeId, state.publicCourses)} />}
      <div className="min-h-5 text-sm text-[#002255]">
        <p role="status" className="inline">{notice}</p>
        {undoItem && <button type="button" onClick={undoRemove} className="ml-2 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002255]">元に戻す</button>}
      </div>
      <div role="tablist" aria-label="履修プランナーの表示" className="grid grid-cols-2 border-b border-gray-300 max-w-md">
        <button type="button" role="tab" aria-selected={activeTab === 'annual'} onClick={() => setActiveTab('annual')} className={`min-w-0 px-2 py-3 text-sm sm:px-4 ${activeTab === 'annual' ? 'border-b-2 border-[#E65C00] text-[#002255]' : 'text-gray-600'}`}>年間履修計画</button>
        <button type="button" role="tab" aria-selected={activeTab === 'media'} onClick={() => setActiveTab('media')} className={`min-w-0 px-1 py-3 text-xs sm:px-4 sm:text-sm ${activeTab === 'media' ? 'border-b-2 border-[#E65C00] text-[#002255]' : 'text-gray-600'}`}>メディア</button>
      </div>
      {activeTab === 'annual'
        ? <div className="space-y-6"><CourseSearch classify={classify} catalog={catalog} selectedScopeId={state.selectedScopeId} offerings={catalog.offerings} addedIds={new Set(state.items.map(item => item.offeringId))} disabled={loaded.error !== null} onAdd={addOffering} onAddPublicCourse={addPublicCourse} /><PlannedCourseList classify={classify} items={state.items} publicCourses={state.publicCourses} offerings={offeringsById} correspondenceProgress={state.correspondenceProgress} mediaProgress={state.mediaSchoolingProgress} evaluations={state.courseEvaluations} disabled={loaded.error !== null} onChange={changeItem} onRemove={removeItem} onChangePublicCourse={changePublicCourse} onRemovePublicCourse={removePublic} onChangeEvaluation={changeEvaluation} onChangeCorrespondence={changeCorrespondenceProgress} onOpenMedia={() => setActiveTab('media')} />{selectablePrograms(catalog).some(p => p.scopeId === state.selectedScopeId) && <GraduationProgress progress={graduationProgress} />}</div>
        : activeTab === 'media'
          ? <MediaSchoolingProgress items={state.items} offerings={offeringsById} progress={state.mediaSchoolingProgress} disabled={loaded.error !== null} onChange={changeMediaProgress} /> : null}
    </div>
  </div>;
}
