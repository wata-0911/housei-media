import CorrespondenceStudyMethod, { type ChangeCorrespondenceItem } from './CorrespondenceStudyMethod';
import FuturePlanNotice from './FuturePlanNotice';
import { planningTermLabel } from '../../planner/futurePlanning';
import { CREDIT_EXAM_GRADES, correspondenceCreditResult, correspondencePlanItems, effectiveCorrespondenceProgress, progressForCorrespondence, REPORT_PASSING_GRADES, REPORT_STATUSES, setReportGrade, setReportStatus } from '../../planner/correspondenceProgress';
import { correspondenceRequirementFor } from '../../planner/correspondenceRequirements';
import { gradeLabel } from '../../planner/courseEvaluations';
import type { CorrespondenceCourseProgress, Offering, PlannerItem } from '../../planner/plannerCatalog';

type Props = { items: PlannerItem[]; offerings: Map<string, Offering>; progress: Record<string, CorrespondenceCourseProgress>; disabled: boolean; onChange: (offeringId: string, progress: CorrespondenceCourseProgress) => void; onChangeItem?: ChangeCorrespondenceItem };
const statusLabel = { not_submitted: '未提出', submitted: '提出済み', grading: '添削中', resubmit: '再提出', passed: '合格済み' } as const;

export function CorrespondenceDetails({ item, offering, saved, disabled, onChange, onChangeItem }: { item: PlannerItem; offering: Offering; saved: CorrespondenceCourseProgress; disabled: boolean; onChange: Props['onChange']; onChangeItem?: ChangeCorrespondenceItem }) {
  const effective = effectiveCorrespondenceProgress(item, offering, saved);
  const result = correspondenceCreditResult(effective);
  const requirement = correspondenceRequirementFor(offering);
  return <article className="min-w-0 border border-gray-200 bg-white p-4 sm:p-6">
    <h3 className="break-words text-lg font-medium text-[#002255]">{offering.name}</h3>
    <p className="mt-1 text-sm text-gray-600">{item.plannedYear === null ? '年度未設定' : `${item.plannedYear}年度`} / {planningTermLabel(item, offering)} / 開講 {offering.credits ?? '単位数不明'}{offering.credits === null ? '' : '単位'}</p>
    <FuturePlanNotice item={item} offering={offering} />
    <CorrespondenceStudyMethod item={item} offering={offering} disabled={disabled} onChange={onChangeItem} />
    <p className="mt-3 text-sm text-gray-700">必要リポート: {effective.requiredReports === null ? '未確認' : `${effective.requiredReports}件`}{requirement && <span className="ml-2 text-xs text-gray-500">設題総覧 {requirement.sourceLabel}</span>}</p>
    {effective.requiredReports === null ? <p className="mt-3 rounded-sm bg-amber-50 p-3 text-sm text-amber-900">この履修方法の必要リポート数を安全に確認できないため、通信学習分の修得条件は自動判定しません。保存済みの記録は保持しています。</p> : <div className="mt-4 space-y-3">{effective.reports.filter(report => report.reportNumber <= effective.requiredReports!).map(report => <div key={report.reportNumber} className="grid min-w-0 gap-2 border-t border-gray-100 pt-3 sm:grid-cols-2"><label className="min-w-0 text-sm text-[#002255]">リポート {report.reportNumber}<select value={report.status} disabled={disabled} onChange={event => onChange(item.offeringId, setReportStatus(saved, report.reportNumber, event.target.value as typeof report.status))} className="mt-1 block w-full rounded-sm border border-gray-300 bg-white p-2">{REPORT_STATUSES.map(status => <option key={status} value={status}>{statusLabel[status]}</option>)}</select></label>{report.status === 'passed' && <label className="min-w-0 text-sm text-[#002255]">評価<select value={report.grade ?? ''} disabled={disabled} onChange={event => onChange(item.offeringId, setReportGrade(saved, report.reportNumber, event.target.value === '' ? null : event.target.value as typeof REPORT_PASSING_GRADES[number]))} className="mt-1 block w-full rounded-sm border border-gray-300 bg-white p-2"><option value="">選択</option>{REPORT_PASSING_GRADES.map(grade => <option key={grade} value={grade}>{gradeLabel(grade)}</option>)}</select></label>}</div>)}</div>}
    {effective.requiredReports !== null && saved.reports.some(report => report.reportNumber > effective.requiredReports!) && <p className="mt-2 text-xs text-gray-600">今回の方式で対象外のリポート記録も保持しています。通信4単位へ戻すと再表示されます。</p>}
    <label className="mt-4 block min-w-0 text-sm text-[#002255]">単位修得試験{offering.credits === 4 && item.courseCreditContribution === 2 ? '（2単位）' : item.courseCreditContribution === 4 ? '（4単位）' : ''}<select value={saved.examGrade ?? ''} disabled={disabled} onChange={event => onChange(item.offeringId, { ...saved, examGrade: event.target.value === '' ? null : event.target.value as typeof CREDIT_EXAM_GRADES[number] })} className="mt-1 block w-full rounded-sm border border-gray-300 bg-white p-2"><option value="">未受験</option>{CREDIT_EXAM_GRADES.map(grade => <option key={grade} value={grade}>{gradeLabel(grade)}</option>)}</select></label>
    <div className="mt-4 rounded-sm bg-[#f5f7fa] p-3 text-sm"><p className="font-medium text-[#002255]">通信学習分: {result.creditEarned === null ? '判定不可' : result.creditEarned ? '単位修得条件達成' : '未修得'}</p><p className="mt-1 text-gray-700">受験資格: {result.examEligible === null ? '判定不可' : result.examEligible ? 'あり' : 'なし'} / リポート: {result.reportsPassed === null ? '判定不可' : result.reportsPassed ? '全件合格' : '未合格あり'}</p><p className="mt-1 text-gray-600">{result.reason}</p></div>
  </article>;
}

export default function CorrespondenceProgress({ items, offerings, progress, disabled, onChange, onChangeItem }: Props) {
  const courseItems = correspondencePlanItems(items, offerings);
  return <section aria-labelledby="correspondence-heading" className="space-y-4"><div className="border border-gray-200 bg-white p-4 sm:p-6"><h2 id="correspondence-heading" className="text-xl text-[#002255]">通信学習</h2><p className="mt-2 text-sm text-gray-600">リポートと単位修得試験を記録します。科目の履修ステータスや卒業要件には自動反映しません。</p></div>{courseItems.length === 0 ? <div className="border border-gray-200 bg-white p-5 text-sm text-gray-600">年間履修計画に通信学習科目を追加すると、ここで進捗を記録できます。</div> : <div className="grid gap-4 lg:grid-cols-2">{courseItems.map(item => { const offering = offerings.get(item.offeringId)!; return <CorrespondenceDetails key={item.offeringId} item={item} offering={offering} saved={progressForCorrespondence(offering, progress)} disabled={disabled} onChange={onChange} onChangeItem={onChangeItem} />; })}</div>}</section>;
}
