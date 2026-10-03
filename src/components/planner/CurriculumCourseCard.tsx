import type { CurriculumCourseView } from '../../planner/curriculumCourseView';
import type { CurriculumCourseListProps } from './CurriculumCourseList.types';
import OfficialAchievementChild from './OfficialAchievementChild';
import PlannerAttemptChild from './PlannerAttemptChild';

const completionLabels = { complete: '完成', incomplete: '未完成', unknown: '判定保留', repeatable: '反復履修可能科目' };

export default function CurriculumCourseCard({ course, editor }: { course: CurriculumCourseView; editor: CurriculumCourseListProps }) {
  const target = course.curriculumCredits ?? '未確認';
  return <section data-curriculum-course-id={course.curriculumCourse.id} aria-label={`制度科目 ${course.canonicalName} ${target}単位`} className="min-w-0 border-t border-gray-200 p-4 sm:p-6">
    <div className="rounded-sm bg-slate-50 p-4">
      <h3 className="text-lg font-medium text-[#002255]">{course.canonicalName}</h3>
      <p className="mt-1 text-sm text-gray-600">科目構成: {target}単位</p>
      <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <p>修得: {course.earnedCredits}{!course.repeatable && ` / ${target}`}単位 · {completionLabels[course.completion]}</p>
        <p>予定込み: {course.projectedCredits}{!course.repeatable && ` / ${target}`}単位 · {completionLabels[course.projectedCompletion]}</p>
        {!course.repeatable && <p>残り: {course.remainingCredits ?? '未確認'}単位</p>}
        <p>超過候補: 修得 {course.earnedExcessCredits}単位 / 予定込み {course.projectedExcessCredits}単位</p>
      </div>
      {course.repeatable && <p className="mt-2 text-xs text-gray-600">反復履修の修得・予定単位をそのまま表示します。通常科目の完成判定は適用しません。</p>}
      {course.warnings.length > 0 && <ul className="mt-3 space-y-1 text-xs text-amber-900">{course.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    </div>
    <div className="mt-4 space-y-3">
      {course.officialAchievements.map(official => <OfficialAchievementChild key={official.achievement.id} official={official} editor={editor} />)}
      {course.attempts.map(attempt => <PlannerAttemptChild key={attempt.plannerItem.offeringId} attempt={attempt} contributions={attempt} editor={editor} />)}
    </div>
  </section>;
}
