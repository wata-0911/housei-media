import type { OfficialAchievementView } from '../../planner/curriculumCourseView';
import type { ImportedCourseUserMeta } from '../../planner/plannerCatalog';
import { importedAchievementStatusLabel } from '../../planner/unifiedCourseView';
import type { OfficialEditorProps } from './CurriculumCourseList.types';
import ImportedSourceDetails from './ImportedSourceDetails';
import { StudyYearSelect, TermSelect, YearInput } from './PlannerRowControls';

const yearSourceLabels = { source: '成績表記載', inferred: '参考・推定', manual: '手動設定', unknown: '未確認' };
const credits = (value: number | null) => value === null ? '未確認' : `${value}単位`;

export default function OfficialAchievementChild({ official, editor }: { official: OfficialAchievementView; editor: OfficialEditorProps }) {
  const { achievement, studyRecords, userMeta, displayStatus } = official;
  const meta = userMeta ?? { lifecycleStatus: null, plannedYear: null, plannedTerm: null, studyYear: null };
  const hasOfficialResult = displayStatus === 'earned_imported' || displayStatus === 'failed_imported';
  return <article data-official-id={achievement.id} aria-label={`成績表 ${achievement.rawName}`} className="min-w-0 rounded-sm border border-gray-200 p-4">
    <h4 className="font-medium text-[#002255]">成績表 — {achievement.rawName}</h4>
    <p className="mt-2 text-sm text-emerald-800">公式修得 {credits(achievement.earnedCreditsTotal)} / {importedAchievementStatusLabel(achievement, userMeta ?? undefined)}</p>
    <p className="mt-1 text-sm">スクーリング修得 {credits(achievement.schoolingCreditsTotal)} / 科目構成 {credits(achievement.compositionCredits)}</p>
    <p className="mt-1 text-xs text-gray-600">公式年度: {achievement.academicYear === null ? '未確認' : `${achievement.academicYear}年度`}（{yearSourceLabels[achievement.yearSource]}） / 開講照合: {achievement.selectedOfferingId ? '取込管理で確認' : '未特定'}</p>
    <ImportedSourceDetails achievements={[achievement]} records={studyRecords} offerings={editor.offerings} />
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer">ユーザー管理情報（公式情報とは別に保存）</summary>
      <p className="mt-2 text-xs text-gray-600">保存状態: {meta.lifecycleStatus === 'waiting' ? '結果待ち' : meta.lifecycleStatus === 'in_progress' ? '履修中' : '判定保留'} / {meta.plannedYear ?? '年度未設定'} / {meta.studyYear === null ? '学年未設定' : `${meta.studyYear}年`} / {meta.plannedTerm ?? '時期未設定'}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs">計画年度<YearInput value={meta.plannedYear} disabled={editor.disabled} onChange={plannedYear => editor.onChangeImportedMeta(achievement.id, { plannedYear })} /></label>
        <label className="text-xs">履修学年<StudyYearSelect value={meta.studyYear} disabled={editor.disabled} onChange={studyYear => editor.onChangeImportedMeta(achievement.id, { studyYear })} /></label>
        <label className="text-xs">時期<TermSelect id={`official-term-${achievement.id}`} value={meta.plannedTerm} disabled={editor.disabled} onChange={plannedTerm => editor.onChangeImportedMeta(achievement.id, { plannedTerm })} /></label>
        <label className="text-xs">履修状態<select value={meta.lifecycleStatus ?? ''} disabled={editor.disabled || hasOfficialResult} onChange={event => editor.onChangeImportedMeta(achievement.id, { lifecycleStatus: (event.target.value || null) as ImportedCourseUserMeta['lifecycleStatus'] })} className="w-full rounded-sm border border-gray-300 bg-white p-2 text-sm disabled:opacity-50"><option value="">判定保留</option><option value="in_progress">履修中</option><option value="waiting">結果待ち</option></select></label>
      </div>
      {hasOfficialResult && <p className="mt-2 text-xs text-gray-600">公式結果を優先表示しています。保存済みのユーザー履修状態は保持します。</p>}
    </details>
  </article>;
}
