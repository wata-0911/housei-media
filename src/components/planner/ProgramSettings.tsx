import type { PlannerCatalog, ThesisSelection } from '../../planner/plannerCatalog';
import { selectablePrograms } from '../../planner/annualPlan';
import { supportsThesisSelection } from '../../planner/thesisSelection';

type Props = { catalog: PlannerCatalog; scopeId: string | null; thesisSelection: ThesisSelection; disabled: boolean; onChange: (scopeId: string | null) => void; onThesisSelectionChange: (selection: ThesisSelection) => void };
export default function ProgramSettings({ catalog, scopeId, thesisSelection, disabled, onChange, onThesisSelectionChange }: Props) {
  const programs = selectablePrograms(catalog);
  const legacyCommon = catalog.programs.find(p => p.scopeId === scopeId && p.isCommon);
  return <section className="bg-white border border-gray-200 p-5 sm:p-7" aria-labelledby="program-heading">
    <h2 id="program-heading" className="text-xl text-[#002255] mb-3">所属設定</h2>
    <label htmlFor="program-scope" className="block text-sm mb-2">学部 / 学科 / コース</label>
    <select id="program-scope" value={legacyCommon ? '' : scopeId ?? ''} disabled={disabled} onChange={e => onChange(e.target.value || null)} className="w-full max-w-xl min-w-0 border border-gray-300 bg-white p-3 disabled:opacity-50">
      <option value="">所属を選択してください</option>
      {[...new Set(programs.map(p => p.faculty))].map(faculty => <optgroup key={faculty} label={faculty ?? '学部未設定'}>
        {programs.filter(p => p.faculty === faculty).map(p => <option key={p.scopeId} value={p.scopeId}>{p.displayName}</option>)}
      </optgroup>)}
    </select>
    <p className="text-sm text-gray-600 mt-3">所属は区分別集計に使用します。すべての開講科目を引き続き検索・追加できます。</p>
    {supportsThesisSelection(catalog, scopeId) && <fieldset className="mt-5 max-w-xl">
      <legend className="text-sm mb-2">卒業論文</legend>
      <div className="flex flex-wrap gap-2">
        {[['undecided', '未定'], ['selected', '履修する'], ['not_selected', '履修しない']].map(([value, label]) => <label key={value} className="border border-gray-300 px-3 py-2 text-sm has-[:checked]:border-[#002255] has-[:checked]:bg-blue-50">
          <input type="radio" name="thesis-selection" value={value} checked={thesisSelection === value} disabled={disabled} onChange={() => onThesisSelectionChange(value as ThesisSelection)} className="mr-2" />{label}
        </label>)}
      </div>
      <p className="text-sm text-gray-600 mt-2">卒論の選択により、一部の専門教育の必要単位が変わります。</p>
    </fieldset>}
    {legacyCommon && <p className="text-sm text-amber-800 mt-2">以前の共通scope設定を保持しています。区分別集計を表示するには所属を選択してください。</p>}
  </section>;
}
