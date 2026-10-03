import type { CurriculumCourseListProps } from './CurriculumCourseList.types';
import OfficialAchievementChild from './OfficialAchievementChild';
import PlannerAttemptChild from './PlannerAttemptChild';

export default function UnresolvedCurriculumSection({ editor }: { editor: CurriculumCourseListProps }) {
  if (editor.view.unresolved.length === 0) return null;
  const describe = (id: string) => {
    const course = editor.catalog.curriculum?.courses.find(course => course.id === id);
    return course ? `${course.canonicalName} / 科目構成 ${course.curriculumCredits ?? '未確認'}単位 / ${id}` : id;
  };
  return <section aria-labelledby="unresolved-curriculum-heading" className="min-w-0 border-t border-gray-200 p-4 sm:p-6">
    <h3 id="unresolved-curriculum-heading" className="font-medium text-[#002255]">制度科目との対応未確認（{editor.view.unresolved.length}件）</h3>
    <p className="mt-2 text-sm text-gray-600">公式実績と履修attemptを保持しています。成績表の照合・修復は「取り込んだ履修実績」で行えます。</p>
    <div className="mt-4 space-y-4">{editor.view.unresolved.map(entry => <div key={entry.kind === 'official' ? `official:${entry.official.achievement.id}` : `attempt:${entry.attempt.plannerItem.offeringId}`} data-unresolved-kind={entry.kind}>
      <p className="mb-2 text-sm text-amber-900">{entry.reason}</p>
      {entry.kind === 'official' ? <>
        <OfficialAchievementChild official={entry.official} editor={editor} />
        <div className="mt-2 break-words text-xs text-gray-600"><p>制度科目照合: {entry.official.achievement.curriculumMatch ?? '未確認'}</p><p>保存済み制度科目: {entry.official.achievement.curriculumCourseId ? describe(entry.official.achievement.curriculumCourseId) : '未特定'}</p><p>候補:</p><ul>{(entry.official.achievement.candidateCurriculumCourseIds ?? []).map(id => <li key={id}>{describe(id)}</li>)}</ul>{!entry.official.achievement.candidateCurriculumCourseIds?.length && <p>候補なし</p>}<p>開講候補: {entry.official.achievement.candidateOfferingIds.map(id => editor.offerings.get(id)?.name ? `${editor.offerings.get(id)!.name} / ${id}` : id).join('、') || '候補なし'}</p></div>
      </> : <PlannerAttemptChild attempt={entry.attempt} editor={editor} />}
    </div>)}</div>
  </section>;
}
