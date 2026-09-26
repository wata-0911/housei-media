import ClassificationLabel from './ClassificationLabel';
import type { createCreditClassifier } from '../../planner/annualPlan';
import { useState } from 'react';
import type { Offering, PlannerItem } from '../../planner/plannerCatalog';
import { groupAnnualPlan, termOptions } from '../../planner/annualPlan';
import { isHistorySeminar, historySeminarField } from '../../planner/historySeminar';

const statuses: Record<PlannerItem['status'], string> = {
  planned: '計画中', in_progress: '履修中', waiting: '結果待ち', earned: '修得済み', failed: '不合格', dropped: '取りやめ',
};
type Props = { classify: ReturnType<typeof createCreditClassifier>; items: PlannerItem[]; offerings: Map<string, Offering>; disabled: boolean; onChange: (id: string, patch: Partial<Omit<PlannerItem, 'offeringId'>>) => void };
const control = 'w-full min-w-0 border border-gray-300 rounded-sm p-2 bg-white disabled:opacity-50';

function YearEditor({ item, disabled, onChange }: { item: PlannerItem; disabled: boolean; onChange: Props['onChange'] }) {
  const [draft, setDraft] = useState(item.plannedYear?.toString() ?? '');
  const [error, setError] = useState('');
  return <form onSubmit={e => {
    e.preventDefault();
    const year = draft.trim() === '' ? null : Number(draft);
    if (year !== null && (!/^\d{4}$/.test(draft) || year < 1900 || year > 9999)) {
      setError('年度は1900〜9999の整数で入力してください。'); return;
    }
    setError(''); onChange(item.offeringId, { plannedYear: year });
  }}>
    <label htmlFor={`year-${item.offeringId}`} className="block text-sm mb-1">計画年度</label>
    <div className="flex gap-2">
      <input id={`year-${item.offeringId}`} inputMode="numeric" value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} placeholder="未設定" className={control} aria-describedby={error ? `year-error-${item.offeringId}` : undefined} />
      <button type="submit" disabled={disabled} className="shrink-0 border border-[#002255] px-2 text-sm disabled:opacity-50">保存</button>
    </div>
    {error && <p id={`year-error-${item.offeringId}`} role="alert" className="text-sm text-red-700 mt-1">{error}</p>}
  </form>;
}

export default function PlannedCourseList({ classify, items, offerings, disabled, onChange }: Props) {
  const terms = termOptions([...offerings.values()]);
  return <section aria-labelledby="planned-heading" className="bg-white border border-gray-200 p-5 sm:p-7 min-w-0">
    <h2 id="planned-heading" className="text-xl text-[#002255]">年間履修計画 <span className="text-sm">{items.length}件</span></h2>
    <p className="text-sm text-gray-600 mt-3">計画年度・元データの開講区分ごとに表示します。計画期は予定の記録で、開講区分は変更しません。2026年以外の開講は保証されません。</p>
    {items.length === 0 && <p className="text-gray-600 text-sm mt-5">科目を検索して、履修計画に追加してください。</p>}
    {groupAnnualPlan(items, offerings).map(({ year, groups }) => <div key={year ?? 'unset'} className="mt-6">
      <h3 className="text-lg text-[#002255] border-b-2 border-[#002255] pb-2">{year === null ? '年度未設定' : `${year}年度`}</h3>
      {groups.map(group => <div key={group.label} className="mt-4">
        <h4 className="bg-slate-50 px-3 py-2 text-[#002255]">{group.label} <span className="text-sm">{group.items.length}件</span></h4>
        <ul className="divide-y divide-gray-100">
          {group.items.map(item => {
            const offering = offerings.get(item.offeringId)!;
            const seminar = isHistorySeminar(offering);
            const usedOrders = new Set(items.filter(other => other.offeringId !== item.offeringId && other.status === 'earned' && isHistorySeminar(offerings.get(other.offeringId))).map(other => other.earnedOrder).filter((order): order is 1 | 2 | 3 | 4 => order !== null));
            const nextOrder = ([1, 2, 3, 4] as const).find(order => !usedOrders.has(order));
            const legacyTerm = item.plannedTerm !== null && !terms.includes(item.plannedTerm);
            return <li key={item.offeringId} className="py-4 min-w-0">
              <h5 className="font-medium break-words">{offering.name}</h5>
              <p className="text-sm text-gray-600 my-2">開講期：{offering.period ?? '未分類'} / {offering.classCode ?? 'クラス未設定'} / {offering.credits === null ? '単位数不明' : `${offering.credits}単位`}</p>
              <ClassificationLabel value={classify(offering)} />
              {seminar && <p className="mt-2 break-words text-sm text-gray-600">史学演習の分野：{historySeminarField(offering) ?? '未確認'} / 修得順：{item.status === 'earned' ? (item.earnedOrder ?? '未確定') : '未確定（修得済み後に記録）'}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <YearEditor key={`${item.offeringId}-${item.plannedYear}`} item={item} disabled={disabled} onChange={onChange} />
                <div><label htmlFor={`term-${item.offeringId}`} className="block text-sm mb-1">計画期</label>
                  <select id={`term-${item.offeringId}`} value={item.plannedTerm === null ? 'unset' : `term:${item.plannedTerm}`} disabled={disabled} onChange={e => onChange(item.offeringId, { plannedTerm: e.target.value === 'unset' ? null : e.target.value.slice(5) })} className={control}>
                    <option value="unset">未設定</option>
                    {legacyTerm && <option value={`term:${item.plannedTerm}`}>保存済み：{item.plannedTerm || '空文字'}（要確認）</option>}
                    {terms.map(term => <option key={term} value={`term:${term}`}>{term}</option>)}
                  </select>
                </div>
                <div><label htmlFor={`status-${item.offeringId}`} className="block text-sm mb-1">履修状態</label>
                  <select id={`status-${item.offeringId}`} value={item.status} disabled={disabled} onChange={e => onChange(item.offeringId, { status: e.target.value as PlannerItem['status'] })} className={control}>
                    {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                {seminar && item.status === 'earned' && <div><label htmlFor={`earned-order-${item.offeringId}`} className="block text-sm mb-1">修得順</label>
                  <select id={`earned-order-${item.offeringId}`} value={item.earnedOrder ?? 'unknown'} disabled={disabled} onChange={e => onChange(item.offeringId, { earnedOrder: e.target.value === 'unknown' ? null : Number(e.target.value) as 1 | 2 | 3 | 4 })} className={control}>
                    <option value="unknown">未確定</option>
                    {nextOrder !== undefined && nextOrder !== item.earnedOrder && <option value={nextOrder}>{nextOrder}</option>}
                    {item.earnedOrder !== null && <option value={item.earnedOrder}>{item.earnedOrder}</option>}
                  </select>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">公式の1〜4は修得順です。重複・飛び番は保存できません。</p>
                </div>}
              </div>
            </li>;
          })}
        </ul>
      </div>)}
    </div>)}
  </section>;
}
