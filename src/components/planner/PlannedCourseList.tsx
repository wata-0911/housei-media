import type { Offering, PlannerItem } from '../../planner/plannerCatalog';

const statuses: Record<PlannerItem['status'], string> = {
  planned: '計画中', in_progress: '履修中', waiting: '結果待ち', earned: '修得済み', failed: '不合格', dropped: '取りやめ',
};
type Props = { items: PlannerItem[]; offerings: Map<string, Offering>; disabled: boolean; onStatus: (id: string, status: PlannerItem['status']) => void };
export default function PlannedCourseList({ items, offerings, disabled, onStatus }: Props) {
  return <section aria-labelledby="planned-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 id="planned-heading" className="text-xl text-[#002255]">履修計画 <span className="text-sm">{items.length}件</span></h2>
    {items.length === 0 && <p className="text-gray-600 text-sm mt-5">科目を検索して、履修計画に追加してください。</p>}
    <ul className="divide-y divide-gray-100 mt-3">
      {items.map(item => {
        const offering = offerings.get(item.offeringId)!;
        return <li key={item.offeringId} className="py-4">
          <h3 className="font-medium">{offering.name}</h3>
          <p className="text-sm text-gray-600 my-2">{[offering.deliveryCategory, offering.period, offering.classCode, offering.credits === null ? '単位数不明' : `${offering.credits}単位`].filter(Boolean).join(' / ')}</p>
          <label htmlFor={`status-${item.offeringId}`} className="text-sm mr-3">履修状態</label>
          <select id={`status-${item.offeringId}`} value={item.status} disabled={disabled}
            onChange={event => onStatus(item.offeringId, event.target.value as PlannerItem['status'])}
            className="border border-gray-300 rounded-sm p-2 bg-white disabled:opacity-50">
            {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </li>;
      })}
    </ul>
  </section>;
}
