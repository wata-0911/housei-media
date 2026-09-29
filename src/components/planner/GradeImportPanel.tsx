import { useState } from 'react';
import { isHoseiGradeImportV1, type HoseiGradeImportV1 } from '../../planner/gradeImportContract';
import { importPreview, type ImportPreviewUnit, type ImportedStudyRecord } from '../../planner/gradeImportApply';
import type { Offering } from '../../planner/plannerCatalog';

export default function GradeImportPanel({ offerings, existing, disabled, onApply }: { offerings: Offering[]; existing: ImportedStudyRecord[]; disabled: boolean; onApply: (units: ImportPreviewUnit[]) => void }) {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [units, setUnits] = useState<ImportPreviewUnit[] | null>(null);
  function read(value: string) { try { const parsed: unknown = JSON.parse(value); if (!isHoseiGradeImportV1(parsed)) throw new Error('JSON が成績表 contract v1 を満たしていません。'); setUnits(importPreview(parsed as HoseiGradeImportV1, offerings, existing)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'JSON を読み込めません。'); setUnits(null); } }
  function update(index: number, patch: Partial<ImportPreviewUnit>) { setUnits(current => current?.map((unit, i) => i === index ? { ...unit, ...patch, yearSource: patch.academicYear !== undefined && unit.yearSource !== 'source' ? 'manual' : unit.yearSource } : unit) ?? null); }
  return <section className="border border-[#002255] bg-white p-4 space-y-3" aria-label="成績データを取り込む">
    <h2 className="text-lg text-[#002255]">成績データを取り込む</h2><p className="text-sm">この画面ではまだ保存しません。法政IDなどcontract外の値は保存されません。</p>
    <label className="block text-sm">JSONファイル <input disabled={disabled} type="file" accept="application/json,.json" className="mt-1 block max-w-full" onChange={e => { const file = e.target.files?.[0]; if (!file) return; file.text().then(value => { setText(value); read(value); }); }} /></label>
    <label className="block text-sm">またはJSONを貼り付け<textarea disabled={disabled} value={text} onChange={e => setText(e.target.value)} className="mt-1 min-h-24 w-full border p-2 font-mono text-xs" /></label>
    <button type="button" disabled={disabled || !text.trim()} onClick={() => read(text)} className="bg-[#002255] px-3 py-2 text-sm text-white disabled:opacity-50">読み込み・検証</button>
    {error && <p role="alert" className="border border-red-300 bg-red-50 p-2 text-sm">{error}</p>}
    {units && <div className="space-y-3"><p className="text-sm">{units.filter(x => x.match === 'exact_unique').length}件を一意一致、{units.filter(x => x.match !== 'exact_unique').length}件は要確認、{units.filter(x => x.duplicate).length}件は既に保存済みです。</p>
      {units.map((unit, index) => <details key={unit.id} className="border p-2" open={unit.match !== 'exact_unique'}><summary className="cursor-pointer text-sm"><input type="checkbox" checked={unit.selected} disabled={unit.duplicate} onChange={e => update(index, { selected: e.target.checked })} onClick={e => e.stopPropagation()} /> {unit.rawName} — {unit.method === 'correspondence' ? '通信' : 'スクーリング'}（{unit.match}{unit.duplicate ? '・保存済み' : ''}）</summary>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2"><label>年度 <input type="number" value={unit.academicYear ?? ''} onChange={e => update(index, { academicYear: e.target.value === '' ? null : Number(e.target.value), yearSource: 'manual' })} className="ml-2 w-24 border p-1" /> <span className="text-xs">{unit.yearSource}{unit.rawYear ? ` / 元: ${unit.rawYear}` : ''}</span></label><label>期 <input value={unit.term ?? ''} onChange={e => update(index, { term: e.target.value || null })} className="ml-2 w-20 border p-1" /></label><p>単位: {unit.credits ?? '未設定'} / component評価: {unit.grade ?? '未設定'}</p>{unit.candidates.length > 1 ? <label>照合先 <select value={unit.offeringId ?? ''} onChange={e => update(index, { offeringId: e.target.value || null })} className="ml-2 max-w-full border p-1"><option value="">選ばない</option>{unit.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.period ?? '期未設定'})</option>)}</select></label> : <p>候補: {unit.candidates.map(x => x.name).join('、') || 'なし（新規Imported Courseとして記録）'}</p>}<p className="sm:col-span-2 text-xs">現在値: 未登録 → 反映後: component実績を保存（最終評価・卒業要件・修得状態は変更しません）</p></div>
      </details>)}
      <button type="button" disabled={!units.some(x => x.selected && !x.duplicate)} onClick={() => onApply(units)} className="bg-[#E65C00] px-3 py-2 text-sm text-white disabled:opacity-50">確認した変更を反映</button>
    </div>}
  </section>;
}
