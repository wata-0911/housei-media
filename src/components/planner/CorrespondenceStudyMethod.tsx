import type { Offering, PlannerItem } from '../../planner/plannerCatalog';

export type ChangeCorrespondenceItem = (id: string, patch: Partial<Omit<PlannerItem, 'offeringId'>>) => void;

export default function CorrespondenceStudyMethod({ item, offering, disabled = false, onChange }: { item: PlannerItem; offering: Offering; disabled?: boolean; onChange?: ChangeCorrespondenceItem }) {
  if (offering.method !== 'correspondence' || offering.credits !== 4 || !onChange) return null;
  const credits = item.courseCreditContribution;
  const value = credits === undefined ? '' : credits === 4 ? 'full4' : credits === 2 ? 'split2' : 'legacy';
  return <div className="mt-3 max-w-lg text-sm">
    <label className="block">この通信学習の修得方法
      <select aria-label={`${offering.name}の通信学習の修得方法`} value={value} disabled={disabled}
        onChange={event => onChange(item.offeringId, { courseCreditContribution: event.target.value === 'full4' ? 4 : event.target.value === 'split2' ? 2 : undefined })}
        className="mt-1 block w-full rounded-sm border border-gray-300 bg-white p-2 text-sm disabled:opacity-50">
        <option value="">未設定（開講の4単位を使用）</option>
        <option value="full4">通信学習で4単位修得</option>
        <option value="split2">スクーリング2単位 + 通信学習2単位</option>
        {value === 'legacy' && <option value="legacy">保存済み設定: {credits}単位（修得方法は要確認）</option>}
      </select>
    </label>
    {credits === 2 && <p className="mt-1 text-xs text-gray-600">スクーリング2単位修得後に2単位試験を受験する方式です。リポートはスクーリング単位修得前でも提出できます。</p>}
  </div>;
}
