import { useState } from 'react';
import { COURSE_GRADES, evaluationFor, evaluationIsUnrated, evaluationItems, evaluationSummary, gradeLabel, usesLegacyReportEvaluation } from '../../planner/courseEvaluations';
import type { CourseEvaluation, CourseGrade, Offering, PlannerItem } from '../../planner/plannerCatalog';

type Props = {
  items: PlannerItem[];
  offerings: Map<string, Offering>;
  evaluations: Record<string, CourseEvaluation>;
  disabled: boolean;
  onChange: (offeringId: string, evaluation: CourseEvaluation) => void;
};

const statusLabels: Record<PlannerItem['status'], string> = { planned: '計画中', in_progress: '履修中', waiting: '結果待ち', earned: '修得済み', failed: '不合格', dropped: '取りやめ' };

function GradeSelect({ label, value, disabled, onChange }: { label: string; value: CourseGrade | null; disabled: boolean; onChange: (grade: CourseGrade | null) => void }) {
  return <label className="block min-w-0 text-sm text-[#002255]">{label}
    <select aria-label={label} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value === '' ? null : event.target.value as CourseGrade)} className="mt-1 block w-full max-w-full rounded-sm border border-gray-300 bg-white p-2 disabled:opacity-50">
      <option value="">未評価</option>
      {COURSE_GRADES.map(grade => <option key={grade} value={grade}>{gradeLabel(grade)}</option>)}
    </select>
  </label>;
}

function EvaluationCard({ item, offering, saved, disabled, onChange }: { item: PlannerItem; offering: Offering; saved: CourseEvaluation; disabled: boolean; onChange: Props['onChange'] }) {
  const change = (field: 'reportGrade' | 'schoolingGrade', grade: CourseGrade | null) => onChange(item.offeringId, { ...saved, [field]: grade });
  return <article className="min-w-0 border border-gray-200 bg-white p-4 sm:p-6">
    <h3 className="break-words text-lg font-medium text-[#002255]">{offering.name}</h3>
    <p className="mt-1 break-words text-sm text-gray-600">{item.plannedYear === null ? '年度未設定' : `${item.plannedYear}年度`} / {item.plannedTerm ?? offering.period ?? '期未設定'} / {offering.deliveryCategory ?? (offering.method === 'schooling' ? 'スクーリング' : '通信')} / {statusLabels[item.status]}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {usesLegacyReportEvaluation(offering) ? <GradeSelect label="リポート評価" value={saved.reportGrade} disabled={disabled} onChange={grade => change('reportGrade', grade)} /> : <p className="rounded-sm bg-[#f5f7fa] p-3 text-sm text-gray-700">リポート評価は「通信学習」タブで設題ごとに記録します。</p>}
      {offering.method === 'schooling' && <GradeSelect label="スクーリング評価" value={saved.schoolingGrade} disabled={disabled} onChange={grade => change('schoolingGrade', grade)} />}
    </div>
  </article>;
}

export default function CourseEvaluations({ items, offerings, evaluations, disabled, onChange }: Props) {
  const [onlyUnrated, setOnlyUnrated] = useState(false);
  const allItems = evaluationItems(items, offerings);
  const summary = evaluationSummary(allItems, evaluations, offerings);
  const visibleItems = allItems.filter(item => !onlyUnrated || (() => {
    const saved = evaluationFor(item.offeringId, evaluations);
    const offering = offerings.get(item.offeringId)!;
    return evaluationIsUnrated(offering, saved);
  })());
  const groups = new Map<number | null, PlannerItem[]>();
  for (const item of visibleItems) groups.set(item.plannedYear, [...(groups.get(item.plannedYear) ?? []), item]);
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER));

  return <section aria-labelledby="evaluation-heading" className="space-y-4">
    <div className="border border-gray-200 bg-white p-4 sm:p-6">
      <h2 id="evaluation-heading" className="text-xl text-[#002255]">評価・成績</h2>
      <p className="mt-2 text-sm text-gray-600">評価記録は履修ステータスや卒業要件へ自動反映されません。</p>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><p>リポート: 入力済み {summary.reportsEntered} / {summary.reportEligibleTotal}</p><p>スクーリング: 入力済み {summary.schoolingsEntered} / {allItems.filter(item => offerings.get(item.offeringId)?.method === 'schooling').length}</p></div>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyUnrated} onChange={event => setOnlyUnrated(event.target.checked)} />未評価のみ表示</label>
    </div>
    {allItems.length === 0 ? <div className="border border-gray-200 bg-white p-5 text-sm text-gray-600">年間履修計画に科目を追加すると、ここで評価を記録できます。</div> : orderedGroups.length === 0 ? <div className="border border-gray-200 bg-white p-5 text-sm text-gray-600">未評価の科目はありません。</div> : orderedGroups.map(([year, group]) => <section key={year ?? 'unset'} aria-label={year === null ? '年度未設定' : `${year}年度`} className="space-y-3"><h3 className="text-base text-[#002255]">{year === null ? '年度未設定' : `${year}年度`}</h3><div className="grid gap-4 lg:grid-cols-2">{group.map(item => <EvaluationCard key={item.offeringId} item={item} offering={offerings.get(item.offeringId)!} saved={evaluationFor(item.offeringId, evaluations)} disabled={disabled} onChange={onChange} />)}</div></section>)}
  </section>;
}
