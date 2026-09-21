import { useState } from 'react';
import type { Offering } from '../../planner/plannerCatalog';
import { searchOfferings } from '../../planner/calculations';

type Props = { offerings: Offering[]; addedIds: Set<string>; disabled: boolean; onAdd: (id: string) => void };
export default function CourseSearch({ offerings, addedIds, disabled, onAdd }: Props) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);
  const matches = searchOfferings(offerings, query);
  return <section aria-labelledby="course-search-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 id="course-search-heading" className="text-xl text-[#002255] mb-5">科目を探す</h2>
    <label htmlFor="course-query" className="block text-sm mb-2">科目名・科目コード・クラスコード・開講区分・期</label>
    <input id="course-query" type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(30); }}
      placeholder="例：政治学、前期メディア" className="w-full border border-gray-300 p-3 rounded-sm focus:ring-2 focus:ring-[#002255]" />
    <p role="status" className="text-sm text-gray-600 my-4">全{offerings.length}件中 {matches.length}件・{Math.min(limit, matches.length)}件表示</p>
    {matches.length === 0 && <p className="py-6 text-gray-600">一致する科目はありません。検索語を変えてください。</p>}
    <ul aria-label="検索結果" tabIndex={0} className="divide-y divide-gray-100 max-h-[36rem] overflow-y-auto pr-2">
      {matches.slice(0, limit).map(o => <li key={o.id} className="py-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="min-w-0">
          <h3 className="font-medium break-words">{o.name}</h3>
          <p className="text-sm text-gray-600 mt-1">{[o.deliveryCategory ?? (o.method === 'correspondence' ? '通信学習' : 'スクーリング'), o.period, o.credits === null ? '単位数不明' : `${o.credits}単位`].filter(Boolean).join(' / ')}</p>
          <p className="text-xs text-gray-500 mt-1">科目コード：{o.subjectCode ?? '—'} / クラス：{o.classCode ?? '—'}</p>
        </div>
        <button type="button" disabled={disabled || addedIds.has(o.id)} onClick={() => onAdd(o.id)} aria-label={`${o.name}（${o.classCode ?? o.deliveryCategory ?? o.method}）を履修計画に追加`}
          className="shrink-0 rounded-sm bg-[#002255] text-white px-4 py-2 text-sm hover:bg-[#003377] disabled:bg-gray-200 disabled:text-gray-600">{addedIds.has(o.id) ? '追加済み' : '計画に追加'}</button>
      </li>)}
    </ul>
    {limit < matches.length && <button type="button" onClick={() => setLimit(limit + 30)} className="mt-5 border border-[#002255] text-[#002255] px-5 py-2">さらに30件表示</button>}
  </section>;
}
