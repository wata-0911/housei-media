import CommittedInput from '../common/CommittedInput';
import { normalizeAdmissionYear } from '../../../planner/graduation/graduationProfile';
import { isStandardTerm, STANDARD_TERMS, statusLabels } from '../../../planner/planning/planTable';
import { COURSE_GRADES, gradeLabel } from '../../../planner/progress/courseEvaluations';
import { isHistoryCompletionOrderCourse, isHistoricalSources, isHistorySeminar } from '../../../planner/graduation/historySeminar';
import type { CourseGrade, Offering, PlannerItem } from '../../../planner/plannerCatalog';

const control = 'w-full rounded-sm border border-gray-300 bg-white p-2 text-sm disabled:opacity-50';
const yearOptions = [1, 2, 3, 4] as const;

export function TermSelect({ value, disabled, onChange, id }: { value: string | null; disabled: boolean; onChange: (value: string | null) => void; id: string }) { const legacy = value !== null && !isStandardTerm(value); return <select id={id} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value || null)} className={control}><option value="">未設定</option>{legacy && <option value={value!}>保存済み：{value}（要確認）</option>}{STANDARD_TERMS.map(term => <option key={term} value={term}>{term}</option>)}</select>; }
export function GradeSelect({ value, disabled, onChange, label }: { value: CourseGrade | null; disabled: boolean; onChange: (value: CourseGrade | null) => void; label: string }) { return <select aria-label={label} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value === '' ? null : event.target.value as CourseGrade)} className={control}><option value="">未評価</option>{COURSE_GRADES.map(grade => <option key={grade} value={grade}>{gradeLabel(grade)}</option>)}</select>; }
export function StudyYearSelect({ value, disabled, onChange }: { value: 1 | 2 | 3 | 4 | null; disabled: boolean; onChange: (value: 1 | 2 | 3 | 4 | null) => void }) { return <select value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value) as 1 | 2 | 3 | 4)} className={control}><option value="">未設定</option>{yearOptions.map(year => <option key={year} value={year}>{year}年</option>)}</select>; }
export function StatusSelect({ value, disabled, onChange }: { value: PlannerItem['status']; disabled: boolean; onChange: (value: PlannerItem['status']) => void }) { return <select value={value} disabled={disabled} onChange={event => onChange(event.target.value as PlannerItem['status'])} className={control}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>; }
export function YearInput({ value, disabled, onChange }: { value: number | null; disabled: boolean; onChange: (value: number | null) => void }) {
  return <CommittedInput aria-label="計画年度" inputMode="numeric" value={value?.toString() ?? ''} disabled={disabled} onCommit={raw => {
    const next = raw.trim(); const year = normalizeAdmissionYear(next);
    if (next && (!/^\d{4}$/.test(next) || year === null)) throw new Error('4桁の西暦（1000〜9999）で入力してください。');
    return onChange(year);
  }} className={control} />;
}
export function CompletionOrderInput({ item, offering, disabled, onChange }: { item: PlannerItem; offering: Offering; disabled: boolean; onChange: (value: number | null) => void }) {
  if (!isHistoryCompletionOrderCourse(offering) || item.status !== 'earned') return null;
  const family = isHistorySeminar(offering) ? '史学演習' : isHistoricalSources(offering) ? '歴史資料学' : '';
  return <label className="text-xs">{family}の修得順<CommittedInput aria-label={`${family}の修得順`} inputMode="numeric" min="1" value={item.earnedOrder?.toString() ?? ''} disabled={disabled} onCommit={raw => {
    const next = raw.trim();
    if (next && !/^[1-9]\d*$/.test(next)) throw new Error('1以上の整数で入力してください。系列内で重複・欠番は保存できません。');
    return onChange(next === '' ? null : Number(next));
  }} className={control} /><span className="mt-1 block text-xs text-gray-500">修得済みだけに入力します。変更・削除できます。</span></label>;
}
