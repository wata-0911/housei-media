import { curriculumOfferingAdvisories, type CurriculumProgressResult } from '../../planner/curriculumCourseProgress';
import ClassificationLabel from './ClassificationLabel';
import type { createCreditClassifier } from '../../planner/annualPlan';
import { useState } from 'react';
import type { Offering } from '../../planner/plannerCatalog';
import { searchOfferings } from '../../planner/calculations';
import { matchesPublicCourseSearch } from '../../planner/publicCourses';
import { eligibilityYearsLabel, filterOfferingsByYear, showSyntheticPublicCourse, yearEligibility, type AcademicYearLevel } from '../../planner/yearEligibility';
import type { PlannerCatalog } from '../../planner/plannerCatalog';

type Props = { curriculumProgress?: CurriculumProgressResult; classify: ReturnType<typeof createCreditClassifier>; catalog: PlannerCatalog; selectedScopeId: string | null; offerings: Offering[]; addedIds: Set<string>; disabled: boolean; onAdd: (id: string) => void; onAddPublicCourse: () => void };
export default function CourseSearch({ curriculumProgress, classify, catalog, selectedScopeId, offerings, addedIds, disabled, onAdd, onAddPublicCourse }: Props) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);
  const [targetYear, setTargetYear] = useState<AcademicYearLevel | null>(null);
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const queryMatches = searchOfferings(offerings, query);
  const matches = filterOfferingsByYear(queryMatches, selectedScopeId, targetYear, includeUnknown, catalog);
  const includesPublicCourse = matchesPublicCourseSearch(query);
  const showPublicCourse = includesPublicCourse && showSyntheticPublicCourse(targetYear, includeUnknown);
  const eligibleCount = targetYear === null ? 0 : queryMatches.filter(offering => yearEligibility(offering, selectedScopeId, targetYear, catalog) === 'eligible').length;
  const unknownCount = targetYear === null ? 0 : queryMatches.filter(offering => yearEligibility(offering, selectedScopeId, targetYear, catalog) === 'unknown').length;
  return <section aria-labelledby="course-search-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 id="course-search-heading" className="text-xl text-[#002255] mb-5">科目を探す</h2>
    <p className="mb-4 text-sm text-gray-600">2026年度カタログの科目です。追加後、計画年度に2027年以降の西暦を入力して仮計画を作れます。ここに表示する方式・期は2026年度情報です。</p>
    <label htmlFor="course-query" className="block text-sm mb-2">科目名・科目コード・クラスコード・開講区分・期</label>
    <input id="course-query" type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(30); }}
      placeholder="例：政治学、前期メディア" className="w-full border border-gray-300 p-3 rounded-sm focus:ring-2 focus:ring-[#002255]" />
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-end">
      <label className="block text-sm">履修可能学年
        <select value={targetYear ?? ''} onChange={event => { setTargetYear(event.target.value === '' ? null : Number(event.target.value) as AcademicYearLevel); setLimit(30); }} className="mt-1 block w-full border border-gray-300 bg-white p-2">
          <option value="">すべて</option><option value="1">1年</option><option value="2">2年</option><option value="3">3年</option><option value="4">4年</option>
        </select>
      </label>
      {targetYear !== null && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeUnknown} onChange={event => { setIncludeUnknown(event.target.checked); setLimit(30); }} />履修可否が判定できない科目も表示</label>}
    </div>
    {selectedScopeId === null && targetYear !== null && <p className="mt-3 text-xs text-gray-600">所属を選択すると履修可能学年をより正確に判定できます。</p>}
    <p role="status" className="text-sm text-gray-600 my-4">全{offerings.length}件中 {matches.length}件・{Math.min(limit, matches.length)}件表示{targetYear !== null && <> / {targetYear}年次で履修可 {eligibleCount}件 / 判定保留 {unknownCount}件</>}</p>
    {matches.length === 0 && !showPublicCourse && <p className="py-6 text-gray-600">一致する科目はありません。検索語を変えてください。</p>}
    <ul aria-label="検索結果" tabIndex={0} className="divide-y divide-gray-100 max-h-[36rem] overflow-y-auto pr-2">
      {showPublicCourse && <li className="py-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="min-w-0">
          <h3 className="font-medium break-words">公開科目</h3>
          <p className="text-sm text-gray-600 mt-1">他学部・他学科公開科目 / 2単位</p>
          {targetYear !== null && <p className="text-xs text-gray-500 mt-1">履修可能学年: 判定保留</p>}
          <p className="text-xs text-gray-500 mt-1">追加後に実際の科目名へ変更できます</p>
        </div>
        <button type="button" disabled={disabled} onClick={onAddPublicCourse} aria-label="公開科目を履修計画に追加"
          className="shrink-0 rounded-sm bg-[#002255] text-white px-4 py-2 text-sm hover:bg-[#003377] disabled:bg-gray-200 disabled:text-gray-600">計画に追加</button>
      </li>}
      {matches.slice(0, limit).map(o => <li key={o.id} className="py-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="min-w-0">
          <h3 className="font-medium break-words">{o.name}</h3>
          <ClassificationLabel value={classify(o)} />
          <p className="text-sm text-gray-600 mt-1">{[o.deliveryCategory ?? (o.method === 'correspondence' ? '通信学習' : 'スクーリング'), o.period, o.credits === null ? '単位数不明' : `${o.credits}単位`].filter(Boolean).join(' / ')}</p>
          <p className="text-xs text-gray-500 mt-1">科目コード：{o.subjectCode ?? '—'} / クラス：{o.classCode ?? '—'}</p>
          <p className="text-xs text-gray-500 mt-1">{eligibilityYearsLabel(o, selectedScopeId, catalog)}</p>
          {curriculumProgress && curriculumOfferingAdvisories(o, curriculumProgress).map(warning => <p key={warning} className="mt-2 text-xs text-amber-900">{warning}</p>)}
        </div>
        <button type="button" disabled={disabled || addedIds.has(o.id)} onClick={() => onAdd(o.id)} aria-label={`${o.name}（${o.classCode ?? o.deliveryCategory ?? o.method}）を履修計画に追加`}
          className="shrink-0 rounded-sm bg-[#002255] text-white px-4 py-2 text-sm hover:bg-[#003377] disabled:bg-gray-200 disabled:text-gray-600">{addedIds.has(o.id) ? '追加済み' : '計画に追加'}</button>
      </li>)}
    </ul>
    {limit < matches.length && <button type="button" onClick={() => setLimit(limit + 30)} className="mt-5 border border-[#002255] text-[#002255] px-5 py-2">さらに30件表示</button>}
  </section>;
}
