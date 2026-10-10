import GradeImportBookmarklet from './GradeImportBookmarklet';
import { useEffect, useState } from 'react';
import { isHoseiGradeImportV1, type HoseiGradeImportV1 } from '../../planner/gradeImportContract';
import { autoPlannerItemsForImport, importPreview, type ImportPreviewUnit, type ImportedCourseAchievement, type ImportedStudyRecord } from '../../planner/gradeImportApply';
import { focusImportedCourseList } from '../../planner/importNavigation';
import type { Offering, PlannerItem } from '../../planner/plannerCatalog';

const matchLabel = (match: string | undefined) => match === 'exact_unique' ? '一意一致' : match === 'ambiguous' ? '要確認' : '未一致';

export function GradeImportApplyActions({ units, plannedItems, offerings, disabled, onApply }: { units: ImportPreviewUnit[]; plannedItems: PlannerItem[]; offerings: Offering[]; disabled: boolean; onApply: () => void }) {
  const plannerAdditions = autoPlannerItemsForImport(units, plannedItems, offerings);
  const backfillCount = autoPlannerItemsForImport(units.filter(unit => unit.sourceDuplicate), plannedItems, offerings).length;
  const hasOfficialChanges = units.some(unit => unit.selected && !unit.sourceDuplicate && !unit.sourceYearConflict);
  return <>
    {backfillCount > 0 && <p role="status" className="text-sm">成績表行は保存済みです。{backfillCount}科目を履修計画に仮登録できます。公式成績は重複保存しません。</p>}
    <button type="button" disabled={disabled || (!hasOfficialChanges && plannerAdditions.length === 0)} onClick={onApply} className="bg-[#E65C00] px-3 py-2 text-sm text-white disabled:opacity-50">確認した履修実績を保存・履修計画に仮登録</button>
  </>;
}

export function GradeImportPreviewUnit({ unit, onChange }: { unit: ImportPreviewUnit; onChange: (patch: Partial<ImportPreviewUnit>) => void }) {
  return <div className="border p-2">
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" aria-label={`${unit.rawName}を取り込む`} checked={unit.selected} disabled={unit.sourceDuplicate || unit.sourceYearConflict === true} onChange={e => onChange({ selected: e.target.checked })} />
      取り込み対象
    </label>
    {unit.sourceYearConflict && <p role="alert" className="text-sm">明示年度の追加・訂正を同じ成績行の更新と確認できないため、この科目の取り込みを保留しています。保存済みの成績と元の成績表をご確認ください。</p>}
    <details className="mt-2" open={unit.match !== 'exact_unique'}><summary className="cursor-pointer text-sm">{unit.rawName} — {unit.courseOnly ? '成績表行のみ' : unit.method === 'correspondence' ? '通信' : 'スクーリング'}（{unit.match}{unit.sourceDuplicate ? '・成績表行は保存済み' : ''}）</summary>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2"><p className="sm:col-span-2 border-l-2 border-[#E65C00] pl-2">成績表行: 修得 {unit.sourceCourse.earnedCreditsTotal ?? '不明'}単位 / S {unit.sourceCourse.schoolingCreditsTotal ?? '不明'}単位 / 構成 {unit.sourceCourse.compositionCredits ?? '不明'}単位</p><p className="sm:col-span-2">カリキュラム照合: {matchLabel(unit.sourceCourse.curriculumMatch)} / 2026開講照合: {matchLabel(unit.sourceCourse.offeringMatch)}</p><label>年度 <input type="number" value={unit.academicYear ?? ''} onChange={e => onChange({ academicYear: e.target.value === '' ? null : Number(e.target.value), yearSource: 'manual' })} className="ml-2 w-24 border p-1" /> <span className="text-xs">{unit.yearSource === 'inferred' ? '推定' : unit.yearSource}{unit.rawYear ? ` / 元: ${unit.rawYear}` : ''}</span></label><label>期 <input value={unit.term ?? ''} onChange={e => onChange({ term: e.target.value || null })} className="ml-2 w-20 border p-1" /></label><p>詳細単位: {unit.credits ?? '未設定'} / 評価（成績表の項目）: {unit.grade ?? '未設定'}</p>{unit.candidates.length > 1 ? <label>照合先 <select value={unit.offeringId ?? ''} onChange={e => onChange({ offeringId: e.target.value || null })} className="ml-2 max-w-full border p-1"><option value="">選ばない</option>{unit.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.period ?? '期未設定'})</option>)}</select></label> : <p>候補: {unit.candidates.map(x => x.name).join('、') || 'なし（成績表行として保存）'}</p>}<p className="sm:col-span-2 text-xs">反映後: 成績表の科目行を必ず保存し、詳細があれば履修実績も保存します。既存項目の状態・最終評価は変更しません。</p></div>
      </details>
  </div>;
}

export default function GradeImportPanel({ offerings, plannedItems, existing, existingCourses = [], disabled, onApply, directImport, onDirectResult }: { offerings: Offering[]; plannedItems: PlannerItem[]; existing: ImportedStudyRecord[]; existingCourses?: ImportedCourseAchievement[]; disabled: boolean; onApply: (units: ImportPreviewUnit[]) => boolean; directImport?: unknown; onDirectResult?: (result: { ok: boolean; courseCount?: number }) => void }) {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [units, setUnits] = useState<ImportPreviewUnit[] | null>(null);
  function read(value: string) { try { const parsed: unknown = JSON.parse(value); if (!isHoseiGradeImportV1(parsed)) throw new Error('JSON が成績表 contract v1 を満たしていません。'); setUnits(importPreview(parsed as HoseiGradeImportV1, offerings, existing, existingCourses)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'JSON を読み込めません。'); setUnits(null); } }
  useEffect(() => { if (directImport === undefined) return; if (!isHoseiGradeImportV1(directImport)) { setError('拡張機能から受信した成績データが contract v1 を満たしていません。反映していません。'); setUnits(null); onDirectResult?.({ ok: false }); return; } setText(''); setUnits(importPreview(directImport, offerings, existing, existingCourses)); setError(''); onDirectResult?.({ ok: true, courseCount: directImport.courses.length }); }, [directImport, offerings, existing, existingCourses, onDirectResult]);
  function update(index: number, patch: Partial<ImportPreviewUnit>) { setUnits(current => current?.map((unit, i) => i === index ? { ...unit, ...patch, yearSource: patch.academicYear !== undefined ? 'manual' : unit.yearSource } : unit) ?? null); }
  return <section id="grade-import-panel" className="border border-[#002255] bg-white p-4 space-y-3" aria-label="成績データを取り込む">
    <h2 className="text-lg text-[#002255]">成績データを取り込む</h2><p className="text-sm">この画面ではまだ保存しません。法政IDなどcontract外の値は保存されません。</p><p className="text-sm">反映すると照合できた科目を、履修計画に仮登録します。成績表に修得単位があり、すべての履修内訳を確認でき、成績表行と開講が安全に1対1で対応する場合のみ「修得済み」とします。照合できない修得済み科目は公式実績のみ保存し、それ以外の仮登録は「計画中」とします。既存の履修計画は変更しません。反映前に内容をご確認ください。最終評価は自動設定しません。</p>
    <GradeImportBookmarklet disabled={disabled} />
    {directImport !== undefined && !error && units && <p role="status" className="border border-blue-200 bg-blue-50 p-2 text-sm">成績データを受信しました。内容を確認してから反映してください。</p>}
    <label className="block text-sm">JSONファイル <input disabled={disabled} type="file" accept="application/json,.json" className="mt-1 block max-w-full" onChange={e => { const file = e.target.files?.[0]; if (!file) return; file.text().then(value => { setText(value); read(value); }); }} /></label>
    <label className="block text-sm">またはJSONを貼り付け<textarea disabled={disabled} value={text} onChange={e => setText(e.target.value)} className="mt-1 min-h-24 w-full border p-2 font-mono text-xs" /></label>
    <button type="button" disabled={disabled || !text.trim()} onClick={() => read(text)} className="bg-[#002255] px-3 py-2 text-sm text-white disabled:opacity-50">読み込み・検証</button>
    {error && <p role="alert" className="border border-red-300 bg-red-50 p-2 text-sm">{error}</p>}
    {units && <div className="space-y-3"><p className="text-sm">{units.filter(x => x.match === 'exact_unique').length}件を一意一致、{units.filter(x => x.match !== 'exact_unique').length}件は要確認、{units.filter(x => x.duplicate).length}件は既に保存済みです。</p>
      {units.map((unit, index) => <GradeImportPreviewUnit key={unit.id} unit={unit} onChange={patch => update(index, patch)} />)}
      <GradeImportApplyActions units={units} plannedItems={plannedItems} offerings={offerings} disabled={disabled} onApply={() => { if (onApply(units)) { setUnits(null); setText(''); focusImportedCourseList(); } }} />
    </div>}
  </section>;
}
