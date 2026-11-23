import GradeImportBookmarklet from './GradeImportBookmarklet';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isHoseiGradeImportV1, type HoseiGradeImportV1 } from '../../../planner/gradeImport/gradeImportContract';
import { autoPlannerItemsForImport, holdIncompleteImportSelections, importPreview, type ImportPreviewUnit, type ImportedCourseAchievement, type ImportedStudyRecord } from '../../../planner/gradeImport/gradeImportApply';
import { focusImportedCourseList } from '../../../planner/gradeImport/importNavigation';
import type { Offering, PlannerItem } from '../../../planner/plannerCatalog';

const matchLabel = (match: string | undefined) => match === 'exact_unique' ? '一意一致' : match === 'ambiguous' ? '要確認' : '未一致';

export function GradeImportApplyActions({ units, plannedItems, offerings, disabled, onApply }: { units: ImportPreviewUnit[]; plannedItems: PlannerItem[]; offerings: Offering[]; disabled: boolean; onApply: () => void }) {
  units = holdIncompleteImportSelections(units);
  const plannerAdditions = autoPlannerItemsForImport(units, plannedItems, offerings);
  const backfillCount = autoPlannerItemsForImport(units.filter(unit => unit.sourceDuplicate || unit.sourceIdentityConflict || unit.sourceYearConflict), plannedItems, offerings).length;
  const hasOfficialChanges = units.some(unit => unit.selected && !unit.sourceDuplicate && !unit.sourceYearConflict && !unit.sourceIdentityConflict);
  return <>
    {units.some(unit => unit.sourceIdentityReason === 'incomplete-source-selection') && <p role="alert" className="text-sm">要確認：更新が必要な保存済み内訳が選択されていないため、この科目の成績表行と内訳の更新を保留しています。元の記録は変更しません。更新する場合は、変更された内訳をすべて選択してください。</p>}
    {backfillCount > 0 && <p role="status" className="text-sm">成績表行は保存済みです。{backfillCount}科目を履修計画に仮登録できます。公式成績は重複保存しません。</p>}
    <button type="button" disabled={disabled || (!hasOfficialChanges && plannerAdditions.length === 0)} onClick={onApply} className="bg-[#E65C00] px-3 py-2 text-sm text-white disabled:opacity-50">確認した履修実績を保存・履修計画に仮登録</button>
  </>;
}

export function GradeImportPreviewUnit({ unit, onChange }: { unit: ImportPreviewUnit; onChange: (patch: Partial<ImportPreviewUnit>) => void }) {
  return <div className="border p-2">
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" aria-label={`${unit.rawName}を取り込む`} checked={unit.selected} disabled={unit.sourceDuplicate || unit.sourceYearConflict === true || unit.sourceIdentityConflict === true} onChange={e => onChange({ selected: e.target.checked })} />
      取り込み対象
    </label>
    {(unit.sourceIdentityConflict || unit.sourceYearConflict) && <p role="alert" className="text-sm">要確認：保存済みの成績と同じ履修記録であることを日付・年度・内訳から確認できないため、この科目の取り込みを保留しています。公式単位や元の記録は変更しません。保存済みの成績と元の成績表をご確認ください。</p>}
    <details className="mt-2" open={unit.match !== 'exact_unique'}><summary className="cursor-pointer text-sm">{unit.rawName} — {unit.courseOnly ? '成績表行のみ' : unit.method === 'correspondence' ? '通信' : 'スクーリング'}（{unit.match}{unit.sourceDuplicate ? '・成績表行は保存済み' : ''}）</summary>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2"><p className="sm:col-span-2 border-l-2 border-[#E65C00] pl-2">成績表行: 修得 {unit.sourceCourse.earnedCreditsTotal ?? '不明'}単位 / S {unit.sourceCourse.schoolingCreditsTotal ?? '不明'}単位 / 構成 {unit.sourceCourse.compositionCredits ?? '不明'}単位</p><p className="sm:col-span-2">カリキュラム照合: {matchLabel(unit.sourceCourse.curriculumMatch)} / 2026開講照合: {matchLabel(unit.sourceCourse.offeringMatch)}</p><label>年度 <input type="number" value={unit.academicYear ?? ''} onChange={e => onChange({ academicYear: e.target.value === '' ? null : Number(e.target.value), yearSource: 'manual' })} className="ml-2 w-24 border p-1" /> <span className="text-xs">{unit.yearSource === 'inferred' ? '推定' : unit.yearSource}{unit.rawYear ? ` / 元: ${unit.rawYear}` : ''}</span></label><label>期 <input value={unit.term ?? ''} onChange={e => onChange({ term: e.target.value || null })} className="ml-2 w-20 border p-1" /></label><p>詳細単位: {unit.credits ?? '未設定'} / 評価（成績表の項目）: {unit.grade ?? '未設定'}</p>{unit.candidates.length > 1 ? <label>照合先 <select value={unit.offeringId ?? ''} onChange={e => onChange({ offeringId: e.target.value || null })} className="ml-2 max-w-full border p-1"><option value="">選ばない</option>{unit.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.period ?? '期未設定'})</option>)}</select></label> : <p>候補: {unit.candidates.map(x => x.name).join('、') || 'なし（成績表行として保存）'}</p>}<p className="sm:col-span-2 text-xs">反映後: 成績表の科目行を必ず保存し、詳細があれば履修実績も保存します。既存項目の状態・最終評価は変更しません。</p></div>
      </details>
  </div>;
}

type GradeImportProps = {
  offerings: Offering[];
  plannedItems: PlannerItem[];
  existing: ImportedStudyRecord[];
  existingCourses?: ImportedCourseAchievement[];
  disabled: boolean;
  onApply: (units: ImportPreviewUnit[]) => boolean | Promise<boolean>;
  directImport?: unknown;
  onDirectResult?: (result: { ok: boolean; courseCount?: number }) => void;
  onDraftChange?: (present: boolean) => void;
  onDiscardDraft?: () => void;
  allowDraftEditing?: boolean;
  restoreEpoch?: number;
};

export default function GradeImportPanel({ offerings, plannedItems, existing, existingCourses = [], disabled,
  onApply, directImport, onDirectResult, onDraftChange, onDiscardDraft, allowDraftEditing, restoreEpoch }: GradeImportProps) {
  const [applying, setApplying] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [handoffRejected, setHandoffRejected] = useState(false);
  const [acceptedHandoff, setAcceptedHandoff] = useState<HoseiGradeImportV1 | null>(null);
  const [units, setUnits] = useState<ImportPreviewUnit[] | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [preview, setPreview] = useState<{ inputRevision: number; restoreEpoch?: number } | null>(null);
  const activeInput = useRef({ revision: 0, reading: false });
  const draftOperation = useRef(0);
  const processedDirectImport = useRef<unknown>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const draftDisabled = disabled && !allowDraftEditing;
  const inputRevision = activeInput.current.revision;
  const previewMatchesInput = preview?.inputRevision === inputRevision;
  const previewNeedsRecheck = units !== null && previewMatchesInput && preview.restoreEpoch !== restoreEpoch;
  const canRecheckHandoff = previewNeedsRecheck && acceptedHandoff !== null;

  const markDraft = useCallback((present: boolean) => {
    ++draftOperation.current;
    onDraftChange?.(present);
  }, [onDraftChange]);

  const replaceInput = useCallback((present: boolean, reading = false) => {
    // Invalidate old handlers before React updates the controls.
    const revision = activeInput.current.revision + 1;
    activeInput.current = { revision, reading };
    setReadingFile(reading);
    setAcceptedHandoff(null);
    setHandoffRejected(false);
    markDraft(present);
    return revision;
  }, [markDraft]);

  function read(value: string, revision: number) {
    if (activeInput.current.reading || activeInput.current.revision !== revision) return;
    try {
      const parsed: unknown = JSON.parse(value);
      if (!isHoseiGradeImportV1(parsed)) throw new Error('JSON が成績表 contract v1 を満たしていません。');
      setUnits(importPreview(parsed as HoseiGradeImportV1, offerings, existing, existingCourses));
      setPreview({ inputRevision: revision, restoreEpoch });
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'JSON を読み込めません。');
      setUnits(null);
      setPreview(null);
    }
  }

  async function selectFile(file: File) {
    const revision = replaceInput(true, true);
    setText('');
    setError('');
    try {
      const value = await file.text();
      if (activeInput.current.revision !== revision) return;
      activeInput.current = { revision, reading: false };
      setReadingFile(false);
      setText(value);
      read(value, revision);
    } catch {
      if (activeInput.current.revision !== revision) return;
      activeInput.current = { revision, reading: false };
      setReadingFile(false);
      setUnits(null);
      setPreview(null);
      setError('JSON ファイルを読み込めません。');
    }
  }

  useEffect(() => () => {
    activeInput.current = { revision: activeInput.current.revision + 1, reading: false };
    ++draftOperation.current;
    onDraftChange?.(false);
  }, [onDraftChange]);

  useEffect(() => {
    if (directImport === undefined) {
      processedDirectImport.current = undefined;
      return;
    }
    if (onDraftChange && processedDirectImport.current === directImport) return;
    processedDirectImport.current = directImport;
    let accepted: { data: HoseiGradeImportV1; units: ImportPreviewUnit[] } | undefined;
    try {
      if (isHoseiGradeImportV1(directImport)) {
        accepted = { data: directImport, units: importPreview(directImport, offerings, existing, existingCourses) };
      }
    } catch {
      // A failed preview does not replace the active draft.
    }
    if (!accepted) {
      setHandoffRejected(true);
      onDirectResult?.({ ok: false });
      return;
    }

    const revision = replaceInput(true);
    if (fileInput.current) fileInput.current.value = '';
    setText('');
    setAcceptedHandoff(accepted.data);
    setUnits(accepted.units);
    setPreview({ inputRevision: revision, restoreEpoch });
    setError('');
    onDirectResult?.({ ok: true, courseCount: accepted.data.courses.length });
  }, [directImport, offerings, existing, existingCourses, onDirectResult, onDraftChange, replaceInput, restoreEpoch]);

  function update(index: number, patch: Partial<ImportPreviewUnit>) {
    if (activeInput.current.reading || preview?.inputRevision !== activeInput.current.revision) return;
    markDraft(true);
    setUnits(current => current?.map((unit, i) => i === index ? { ...unit, ...patch, yearSource: patch.academicYear !== undefined ? 'manual' : unit.yearSource } : unit) ?? null);
  }

  function clearDraft() {
    replaceInput(false);
    setText('');
    setUnits(null);
    setPreview(null);
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function apply() {
    const input = activeInput.current;
    if (disabled || applying || input.reading || !units || preview?.inputRevision !== input.revision
      || preview.restoreEpoch !== restoreEpoch) return;
    const revision = draftOperation.current;
    setApplying(true);
    try {
      if (await onApply(units)) {
        if (input.revision === activeInput.current.revision && revision === draftOperation.current) clearDraft();
        focusImportedCourseList();
      }
    } finally { setApplying(false); }
  }
  return <section id="grade-import-panel" className="border border-[#002255] bg-white p-4 space-y-3" aria-label="成績データを取り込む">
    <h2 className="text-lg text-[#002255]">成績データを取り込む</h2><p className="text-sm">この画面ではまだ保存しません。法政IDなどcontract外の値は保存されません。</p><p className="text-sm">反映すると照合できた科目を、履修計画に仮登録します。成績表に修得単位があり、すべての履修内訳を確認でき、成績表行と開講が安全に1対1で対応する場合のみ「修得済み」とします。照合できない修得済み科目は公式実績として保存します。新規で結果が未確定の場合、本人の管理状態は「履修中」で開始します。既存の本人選択と履修計画は維持します。反映前に内容をご確認ください。最終評価は自動設定しません。</p>
    <GradeImportBookmarklet disabled={disabled} />
    {acceptedHandoff && !error && units && <p role="status" className="border border-blue-200 bg-blue-50 p-2 text-sm">成績データを受信しました。内容を確認してから反映してください。</p>}
    <label className="block text-sm">JSONファイル <input ref={fileInput} disabled={draftDisabled} type="file" accept="application/json,.json" className="mt-1 block max-w-full" onChange={event => {
      const file = event.target.files?.[0];
      if (file) void selectFile(file);
    }} /></label>
    <label className="block text-sm">またはJSONを貼り付け<textarea disabled={draftDisabled} value={text} onChange={event => {
      const next = event.target.value;
      replaceInput(Boolean(next));
      if (fileInput.current) fileInput.current.value = '';
      setText(next);
      setUnits(null);
      setPreview(null);
      setError('');
    }} className="mt-1 min-h-24 w-full border p-2 font-mono text-xs" /></label>
    <button type="button" disabled={draftDisabled || readingFile || (!text.trim() && !canRecheckHandoff)} onClick={() => {
      if (activeInput.current.reading || activeInput.current.revision !== inputRevision) return;
      markDraft(true);
      read(text.trim() ? text : JSON.stringify(acceptedHandoff), inputRevision);
    }} className="planner-button planner-button--navy bg-[#002255] px-3 py-2 text-sm text-white disabled:opacity-50">読み込み・検証</button>
    {onDiscardDraft && (text || units || error || readingFile || handoffRejected) && <button type="button" disabled={draftDisabled || applying} className="ml-2 underline" onClick={() => {
      if (!window.confirm('成績取込の未保存の入力とプレビューを破棄しますか？')) return;
      clearDraft();
      onDiscardDraft();
    }}>未保存の成績取込を破棄</button>}
    {readingFile && <p role="status">成績ファイルを読み込み中です。読み込みが終わるまでプレビューは保存できません。</p>}
    {previewNeedsRecheck && <p role="alert">復元前のプレビューです。入力と選択は残っています。取り込む前に「読み込み・検証」をやり直してください。</p>}
    {handoffRejected && <p role="alert" className="border border-red-300 bg-red-50 p-2 text-sm">拡張機能から受信した成績データが contract v1 を満たしていません。反映していません。</p>}
    {error && <p role="alert" className="border border-red-300 bg-red-50 p-2 text-sm">{error}</p>}
    {units && <fieldset disabled={draftDisabled || applying || readingFile || !previewMatchesInput} className="min-w-0 space-y-3"><p className="text-sm">{units.filter(x => x.match === 'exact_unique' && !x.sourceIdentityConflict && !x.sourceYearConflict).length}件を一意一致、{units.filter(x => x.match !== 'exact_unique' || x.sourceIdentityConflict || x.sourceYearConflict).length}件は要確認、{units.filter(x => x.duplicate).length}件は既に保存済みです。</p>
      {units.map((unit, index) => <GradeImportPreviewUnit key={unit.id} unit={unit} onChange={patch => update(index, patch)} />)}
      <GradeImportApplyActions units={units} plannedItems={plannedItems} offerings={offerings} disabled={disabled || applying || readingFile || !previewMatchesInput || previewNeedsRecheck} onApply={apply} />
    </fieldset>}
  </section>;
}
