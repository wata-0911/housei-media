import { useEffect, useState } from 'react';
import { isHoseiGradeImportV1, type HoseiGradeImportV1 } from '../../planner/gradeImportContract';
import { autoPlannerItemsForImport, importPreview, type ImportPreviewUnit, type ImportedCourseAchievement, type ImportedStudyRecord } from '../../planner/gradeImportApply';
import type { Offering, PlannerItem } from '../../planner/plannerCatalog';

const matchLabel = (match: string | undefined) => match === 'exact_unique' ? '一意一致' : match === 'ambiguous' ? '要確認' : '未一致';

export function GradeImportApplyActions({ units, plannedItems, offerings, disabled, onApply }: { units: ImportPreviewUnit[]; plannedItems: PlannerItem[]; offerings: Offering[]; disabled: boolean; onApply: () => void }) {
  const plannerAdditions = autoPlannerItemsForImport(units, plannedItems, offerings);
  const backfillCount = autoPlannerItemsForImport(units.filter(unit => unit.sourceDuplicate), plannedItems, offerings).length;
  const hasOfficialChanges = units.some(unit => unit.selected && !unit.sourceDuplicate);
  return <>
    {backfillCount > 0 && <p role="status" className="text-sm">成績表行は保存済みです。{backfillCount}科目を履修計画に仮登録できます。公式成績は重複保存しません。</p>}
    <button type="button" disabled={disabled || (!hasOfficialChanges && plannerAdditions.length === 0)} onClick={onApply} className="bg-[#E65C00] px-3 py-2 text-sm text-white disabled:opacity-50">確認した履修実績を保存・履修計画に仮登録</button>
  </>;
}

export default function GradeImportPanel({ offerings, plannedItems, existing, existingCourses = [], disabled, onApply, directImport, onDirectResult }: { offerings: Offering[]; plannedItems: PlannerItem[]; existing: ImportedStudyRecord[]; existingCourses?: ImportedCourseAchievement[]; disabled: boolean; onApply: (units: ImportPreviewUnit[]) => boolean; directImport?: unknown; onDirectResult?: (result: { ok: boolean; courseCount?: number }) => void }) {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [units, setUnits] = useState<ImportPreviewUnit[] | null>(null);
  function read(value: string) { try { const parsed: unknown = JSON.parse(value); if (!isHoseiGradeImportV1(parsed)) throw new Error('JSON が成績表 contract v1 を満たしていません。'); setUnits(importPreview(parsed as HoseiGradeImportV1, offerings, existing, existingCourses)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'JSON を読み込めません。'); setUnits(null); } }
  useEffect(() => { if (directImport === undefined) return; if (!isHoseiGradeImportV1(directImport)) { setError('拡張機能から受信した成績データが contract v1 を満たしていません。反映していません。'); setUnits(null); onDirectResult?.({ ok: false }); return; } setText(''); setUnits(importPreview(directImport, offerings, existing, existingCourses)); setError(''); onDirectResult?.({ ok: true, courseCount: directImport.courses.length }); }, [directImport, offerings, existing, existingCourses, onDirectResult]);
  function update(index: number, patch: Partial<ImportPreviewUnit>) { setUnits(current => current?.map((unit, i) => i === index ? { ...unit, ...patch, yearSource: patch.academicYear !== undefined ? 'manual' : unit.yearSource } : unit) ?? null); }
  return <section className="border border-[#002255] bg-white p-4 space-y-3" aria-label="成績データを取り込む">
    <h2 className="text-lg text-[#002255]">成績データを取り込む</h2><p className="text-sm">この画面ではまだ保存しません。法政IDなどcontract外の値は保存されません。</p><p className="text-sm">反映すると、一意に照合できた科目を履修計画に仮登録します。公式修得単位があり、すべての履修内訳を確認して成績表行と開講が1対1に対応する新規項目は「修得済み」です。成績表の修得単位が正の構成単位以上で、1つの開講へ安全に対応づけられない場合は、公式実績と履修内訳のみ保存し、新たな履修計画は作りません。それ以外で未照合・複数候補の内訳がある場合、複数の開講や成績表行が競合する場合、修得単位が不明・0の場合は「計画中」です。過去年度の履修内訳も保存・表示し、今年度の開講として仮登録しません。既存の履修計画は変更しません。状態・学年・年度・時期を確認してください。最終評価は自動設定しません。</p>
    {directImport !== undefined && !error && units && <p role="status" className="border border-blue-200 bg-blue-50 p-2 text-sm">拡張機能から成績データを受信しました。内容を確認してから反映してください。</p>}
    <label className="block text-sm">JSONファイル <input disabled={disabled} type="file" accept="application/json,.json" className="mt-1 block max-w-full" onChange={e => { const file = e.target.files?.[0]; if (!file) return; file.text().then(value => { setText(value); read(value); }); }} /></label>
    <label className="block text-sm">またはJSONを貼り付け<textarea disabled={disabled} value={text} onChange={e => setText(e.target.value)} className="mt-1 min-h-24 w-full border p-2 font-mono text-xs" /></label>
    <button type="button" disabled={disabled || !text.trim()} onClick={() => read(text)} className="bg-[#002255] px-3 py-2 text-sm text-white disabled:opacity-50">読み込み・検証</button>
    {error && <p role="alert" className="border border-red-300 bg-red-50 p-2 text-sm">{error}</p>}
    {units && <div className="space-y-3"><p className="text-sm">{units.filter(x => x.match === 'exact_unique').length}件を一意一致、{units.filter(x => x.match !== 'exact_unique').length}件は要確認、{units.filter(x => x.duplicate).length}件は既に保存済みです。</p>
      {units.map((unit, index) => <details key={unit.id} className="border p-2" open={unit.match !== 'exact_unique'}><summary className="cursor-pointer text-sm"><input type="checkbox" checked={unit.selected} disabled={unit.sourceDuplicate} onChange={e => update(index, { selected: e.target.checked })} onClick={e => e.stopPropagation()} /> {unit.rawName} — {unit.courseOnly ? '成績表行のみ' : unit.method === 'correspondence' ? '通信' : 'スクーリング'}（{unit.match}{unit.sourceDuplicate ? '・成績表行は保存済み' : ''}）</summary>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2"><p className="sm:col-span-2 border-l-2 border-[#E65C00] pl-2">成績表行: 修得 {unit.sourceCourse.earnedCreditsTotal ?? '不明'}単位 / S {unit.sourceCourse.schoolingCreditsTotal ?? '不明'}単位 / 構成 {unit.sourceCourse.compositionCredits ?? '不明'}単位</p><p className="sm:col-span-2">カリキュラム照合: {matchLabel(unit.sourceCourse.curriculumMatch)} / 2026開講照合: {matchLabel(unit.sourceCourse.offeringMatch)}</p><label>年度 <input type="number" value={unit.academicYear ?? ''} onChange={e => update(index, { academicYear: e.target.value === '' ? null : Number(e.target.value), yearSource: 'manual' })} className="ml-2 w-24 border p-1" /> <span className="text-xs">{unit.yearSource === 'inferred' ? '推定' : unit.yearSource}{unit.rawYear ? ` / 元: ${unit.rawYear}` : ''}</span></label><label>期 <input value={unit.term ?? ''} onChange={e => update(index, { term: e.target.value || null })} className="ml-2 w-20 border p-1" /></label><p>詳細単位: {unit.credits ?? '未設定'} / 評価（成績表の項目）: {unit.grade ?? '未設定'}</p>{unit.candidates.length > 1 ? <label>照合先 <select value={unit.offeringId ?? ''} onChange={e => update(index, { offeringId: e.target.value || null })} className="ml-2 max-w-full border p-1"><option value="">選ばない</option>{unit.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.period ?? '期未設定'})</option>)}</select></label> : <p>候補: {unit.candidates.map(x => x.name).join('、') || 'なし（成績表行として保存）'}</p>}<p className="sm:col-span-2 text-xs">反映後: 成績表の科目行を必ず保存し、詳細があれば履修実績も保存します。既存項目の状態・最終評価は変更しません。</p></div>
      </details>)}
      <GradeImportApplyActions units={units} plannedItems={plannedItems} offerings={offerings} disabled={disabled} onApply={() => { if (onApply(units)) { setUnits(null); setText(''); document.getElementById('imported-achievements')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }} />
    </div>}
  </section>;
}
