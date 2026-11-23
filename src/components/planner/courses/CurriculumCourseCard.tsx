import { useId, useState } from 'react';
import type { CurriculumCourseView } from '../../../planner/progress/curriculumCourseView';
import type { CurriculumCourseListProps } from './CurriculumCourseList.types';
import OfficialAchievementChild from './OfficialAchievementChild';
import PlannerAttemptChild from './PlannerAttemptChild';

const completionLabels = { complete: '完成', incomplete: '未完成', unknown: '判定保留', repeatable: '反復履修可能科目' };

export default function CurriculumCourseCard({ course, editor }: { course: CurriculumCourseView; editor: CurriculumCourseListProps }) {
  const target = course.curriculumCredits ?? '未確認';
  const detailId = useId();
  // 書道実技は既存の複数構成要素を直接編集する導線を維持する。
  const [expanded, setExpanded] = useState(course.canonicalName === '書道実技');
  return <section data-curriculum-course-id={course.curriculumCourse.id} aria-label={`制度科目 ${course.canonicalName} ${target}単位`} className="min-w-0 border-t border-gray-200 p-4 sm:p-6">
    <div className="grid min-w-0 grid-cols-2 items-center gap-2 rounded-sm bg-slate-50 p-4 text-sm sm:grid-cols-2 xl:grid-cols-[minmax(10rem,2fr)_repeat(4,minmax(0,1fr))_auto]">
      <div className="col-span-2 min-w-0 xl:col-span-1">
        <h3 className="min-w-0 break-words text-lg font-medium text-[#002255]">{course.canonicalName}</h3>
        <p className="text-gray-600">科目構成: {target}単位</p>
      </div>
      <p className="min-w-0">{course.completionEvidence === 'learner' ? '本人記録による完成条件' : '修得'}: {course.earnedCredits}{!course.repeatable && ` / ${target}`}単位 · {completionLabels[course.completion]}</p>
      <p className="min-w-0">予定込み: {course.projectedCredits}{!course.repeatable && ` / ${target}`}単位 · {completionLabels[course.projectedCompletion]}</p>
      <div className="min-w-0">
        {!course.repeatable && <p>残り: {course.remainingCredits ?? '未確認'}単位</p>}
        <p>超過候補: 修得 {course.earnedExcessCredits}単位 / 予定込み {course.projectedExcessCredits}単位</p>
      </div>
      <div className="min-w-0 text-xs">
        {course.repeatable && <p className="text-gray-600">反復履修の修得・予定単位をそのまま表示します。通常科目の完成判定は適用しません。</p>}
        <p className="text-gray-600">公式行 {course.officialAchievements.length}件 / 本人履修回 {course.attempts.length}件</p>
        <p className={course.warnings.length > 0 ? 'font-medium text-amber-900' : 'text-gray-600'}>確認要否: {course.warnings.length}件</p>
      </div>
      <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)} className="col-span-2 rounded-sm border border-[#002255] px-3 py-2 text-[#002255] hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002255] xl:col-span-1">
        {expanded ? '詳細を閉じる' : '詳細・編集を開く'}
      </button>
    </div>
    <div id={detailId} hidden={!expanded} className="mt-4 space-y-3">
      {course.warnings.length > 0 && <ul className="space-y-1 text-xs text-amber-900">{course.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      {course.officialAchievements.map(official => <OfficialAchievementChild key={official.achievement.id} official={official} editor={editor} />)}
      {course.attempts.map(attempt => <PlannerAttemptChild key={attempt.plannerItem.offeringId} attempt={attempt} contributions={attempt} editor={editor} />)}
    </div>
  </section>;
}
