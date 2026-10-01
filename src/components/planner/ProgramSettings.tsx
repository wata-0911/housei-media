import type { PlannerCatalog, ThesisProgress, ThesisSelection } from '../../planner/plannerCatalog';
import { supportsThesisSelection, thesisPolicyForScope } from '../../planner/thesisSelection';

type Props = {
  catalog: PlannerCatalog;
  scopeId: string | null;
  thesis: ThesisProgress;
  disabled: boolean;
  onThesisSelectionChange: (selection: ThesisSelection) => void;
  onThesisStatusChange: (status: ThesisProgress['status']) => void;
};

export default function ProgramSettings({ catalog, scopeId, thesis, disabled, onThesisSelectionChange, onThesisStatusChange }: Props) {
  const legacyCommon = catalog.programs.find(program => program.scopeId === scopeId && program.isCommon);
  const thesisPolicy = thesisPolicyForScope(catalog, scopeId);
  if (scopeId === null) return null;

  return <section className="bg-white border border-gray-200 p-5 sm:p-7" aria-labelledby="program-heading">
    <h2 id="program-heading" className="text-xl text-[#002255] mb-3">卒業論文設定</h2>
    {supportsThesisSelection(catalog, scopeId) && <fieldset className="max-w-xl">
      <legend className="text-sm mb-2">卒業論文</legend>
      <div className="flex flex-wrap gap-2">
        {[['undecided', '未定'], ['selected', '履修する'], ['not_selected', '履修しない']].map(([value, label]) => <label key={value} className="border border-gray-300 px-3 py-2 text-sm has-[:checked]:border-[#002255] has-[:checked]:bg-blue-50">
          <input type="radio" name="thesis-selection" value={value} checked={thesis.selection === value} disabled={disabled} onChange={() => onThesisSelectionChange(value as ThesisSelection)} className="mr-2" />{label}
        </label>)}
      </div>
      <p className="text-sm text-gray-600 mt-2">卒論の選択により、一部の専門教育の必要単位が変わります。</p>
    </fieldset>}
    {thesisPolicy !== 'unknown' && (thesisPolicy === 'required' || thesis.selection === 'selected') && <fieldset className="mt-4 max-w-xl">
      <legend className="text-sm mb-2">卒業論文の状態</legend>
      <div className="flex flex-wrap gap-2">
        {([['not_started', '未着手'], ['planned', '計画中'], ['in_progress', '執筆中'], ['earned', '修得済み']] as const).map(([value, label]) => <label key={value} className="border border-gray-300 px-3 py-2 text-sm has-[:checked]:border-[#002255] has-[:checked]:bg-blue-50">
          <input type="radio" name="thesis-status" checked={thesis.status === value} disabled={disabled} onChange={() => onThesisStatusChange(value)} className="mr-2" />{label}
        </label>)}
      </div>
      <p className="mt-2 text-xs text-gray-600">卒論指導・提出手続は単位進捗と分けて確認します。</p>
    </fieldset>}
    {thesisPolicy === 'unknown' && !legacyCommon && <p className="max-w-xl border-l-4 border-amber-500 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">卒業論文の扱いは現在自動判定対象外です。公式の単位分岐を安全に確認できるまで、履修する／しないは選択できません。</p>}
    {legacyCommon && <p className="text-sm text-amber-800">以前の共通scope設定を保持しています。プロフィールタブで所属を選択すると区分別集計を表示できます。</p>}
  </section>;
}
