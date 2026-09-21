import type { summarizeCategories } from '../../planner/annualPlan';

export default function CategorySummary({ rows }: { rows: ReturnType<typeof summarizeCategories> }) {
  return <section aria-labelledby="category-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 id="category-heading" className="text-xl text-[#002255]">所属に基づく区分別集計</h2>
    <p className="text-sm text-gray-600 my-3">全年度の開講単位の単純合計です。所属・共通の対応情報が一意に決まらない科目は「未分類/要確認」に残します。卒業要件への算入は判定しません。</p>
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {rows.map(row => <div key={row.category} className="border border-gray-200 p-4 min-w-0">
        <h3 className="font-medium text-[#002255]">{row.category} <span className="text-xs">{row.count}件</span></h3>
        <dl className="grid grid-cols-2 gap-2 mt-3 text-sm">
          <div><dt>修得済み</dt><dd>{row.earned}単位</dd></div>
          <div><dt>履修中</dt><dd>{row.in_progress}単位</dd></div>
          <div><dt>計画中</dt><dd>{row.planned}単位</dd></div>
          <div><dt>単位数不明</dt><dd>{row.unknownCreditItems}件</dd></div>
        </dl>
      </div>)}
    </div>
  </section>;
}
