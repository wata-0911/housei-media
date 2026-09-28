import { isCreditCategory, type summarizeCategories } from '../../planner/annualPlan';

export default function CategorySummary({ rows }: { rows: ReturnType<typeof summarizeCategories> }) {
  return <section aria-labelledby="category-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 id="category-heading" className="text-xl text-[#002255]">所属に基づく区分別集計</h2>
    <p className="text-sm text-gray-600 my-3">全年度の開講単位の単純合計です。対象外・確認中の科目は通常区分に加算せず、下段に参考表示します。この集計自体は卒業要件の達成を示しません。</p>
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {rows.filter(row => isCreditCategory(row.category)).map(row => <div key={row.category} className="border border-gray-200 p-4 min-w-0">
        <h3 className="font-medium text-[#002255]">{row.category} <span className="text-xs">{row.count}件</span></h3>
        <dl className="grid grid-cols-2 gap-2 mt-3 text-sm">
          <div><dt>修得済み</dt><dd>{row.earned}単位</dd></div>
          <div><dt>履修中</dt><dd>{row.in_progress}単位</dd></div>
          <div><dt>計画中</dt><dd>{row.planned}単位</dd></div>
          <div><dt>単位数不明</dt><dd>{row.unknownCreditItems}件</dd></div>
        </dl>
      </div>)}
    </div>
    <h3 className="font-medium text-[#002255] mt-6">対象外・確認中の参考集計</h3>
    <p className="text-sm text-gray-600 my-3">計画への追加・保存は可能です。履修の必要性や単位認定の可否を示すものではありません。</p>
    <ul className="space-y-3">
      {rows.filter(row => !isCreditCategory(row.category) && row.count > 0).map(row => <li key={row.category} className="bg-slate-50 p-3 text-sm break-words">
        <p>{row.category}：{row.count}件</p>
        <p className="text-xs leading-relaxed text-gray-600 mt-1">参考：修得済み {row.earned}単位 / 履修中 {row.in_progress}単位 / 計画中 {row.planned}単位 / 単位数不明 {row.unknownCreditItems}件</p>
      </li>)}
    </ul>
  </section>;
}
