import type { CurriculumCourseListProps } from './CurriculumCourseList.types';
import CurriculumCourseCard from './CurriculumCourseCard';
import ImportedSourceDetails from './ImportedSourceDetails';
import PublicCourseList from './PublicCourseList';
import UnresolvedCurriculumSection from './UnresolvedCurriculumSection';

export default function CurriculumCourseList(props: CurriculumCourseListProps) {
  const { courses, unresolved, orphanStudyRecords } = props.view;
  const empty = courses.length + unresolved.length + orphanStudyRecords.length + props.publicCourses.length === 0;
  return <section aria-labelledby="planned-heading" className="min-w-0 border border-gray-200 bg-white">
    <div className="p-5 sm:p-7">
      <h2 id="planned-heading" className="text-xl text-[#002255]">履修・修得一覧 <span className="text-sm">制度科目 {courses.length}件</span></h2>
      <p className="mt-2 text-sm text-gray-600">2026の制度科目ごとに、成績表の公式実績と履修attemptを分けて表示します。科目構成単位の進捗は卒業所要単位への算入とは別です。予定込みには結果待ちも含みます。</p>
      <p className="mt-1 text-sm text-gray-600">履修学年・計画年度・時期は各attemptで記録します。最終評価は進捗や修得状態を自動変更しません。</p>
    </div>
    {empty && <p className="px-5 pb-7 text-sm text-gray-600">科目を検索して、履修計画に追加してください。</p>}
    {courses.map(course => <CurriculumCourseCard key={course.curriculumCourse.id} course={course} editor={props} />)}
    <UnresolvedCurriculumSection editor={props} />
    {orphanStudyRecords.length > 0 && <section aria-labelledby="orphan-study-heading" className="min-w-0 border-t border-gray-200 p-4 sm:p-6">
      <h3 id="orphan-study-heading" className="font-medium text-[#002255]">成績表の履修内訳・公式科目との対応未確認（{orphanStudyRecords.length}件）</h3>
      <p className="mt-2 text-sm text-gray-600">内訳を参照表示します。科目名だけでは公式実績や制度科目へまとめません。</p>
      {orphanStudyRecords.map(record => <article key={record.id} data-orphan-study-id={record.id} className="mt-3 min-w-0"><h4 className="text-sm font-medium">{record.rawName}</h4><ImportedSourceDetails achievements={[]} records={[record]} offerings={props.offerings} /></article>)}
    </section>}
    <PublicCourseList publicCourses={props.publicCourses} disabled={props.disabled} onChangePublicCourse={props.onChangePublicCourse} onRemovePublicCourse={props.onRemovePublicCourse} />
  </section>;
}
