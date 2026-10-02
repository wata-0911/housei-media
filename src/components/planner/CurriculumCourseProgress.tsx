import type { CurriculumProgressResult } from '../../planner/curriculumCourseProgress';
import type { PlannerCatalog, PlannerItem } from '../../planner/plannerCatalog';
import { offeringFormLabel } from '../../planner/planTable';

const statusLabels = { planned: '計画中', in_progress: '履修中', waiting: '結果待ち', earned: '修得済み', failed: '不合格', dropped: '取りやめ' };
const completionLabels = { complete: '完成', incomplete: '未完成', unknown: '判定保留', repeatable: '反復履修可能科目' };

export default function CurriculumCourseProgress({ progress, catalog, disabled = false, onChange }: { progress: CurriculumProgressResult; catalog: PlannerCatalog; disabled?: boolean; onChange?: (id: string, patch: Partial<Omit<PlannerItem, 'offeringId'>>) => void }) {
  if (progress.courses.length + progress.unassigned.length === 0) return null;
  return <section aria-labelledby="curriculum-progress-heading" className="border border-gray-200 bg-white p-5 sm:p-7">
    <h2 id="curriculum-progress-heading" className="text-xl text-[#002255]">制度科目ごとの進捗</h2>
    <p className="mt-2 text-sm text-gray-600">科目構成単位に対する修得・予定の集計です。卒業所要単位への算入とは別に表示します。予定込みには結果待ちも含みます。</p>
    <div className="mt-4 divide-y divide-gray-200">
      {progress.courses.map(course => {
        const definition = catalog.curriculum?.courses.find(value => value.id === course.curriculumCourseId);
        const mappings = catalog.mappings.filter(mapping => definition?.mappingIds.includes(mapping.mappingId));
        const contexts = [...new Set(mappings.map(mapping => [catalog.programs.find(program => program.scopeId === mapping.scopeId)?.displayName, mapping.category, mapping.field, mapping.requirementType].filter(Boolean).join(' / ')))];
        const denominator = course.curriculumCredits ?? '不明';
        const displayCredits = (credits: number) => course.repeatable || course.curriculumCredits === null ? credits : Math.min(credits, course.curriculumCredits);
        return <details key={course.curriculumCourseId} className="py-3">
          <summary className="cursor-pointer text-sm leading-7">
            <span className="font-medium">{course.canonicalName}</span> <span className="text-gray-600">科目構成: {denominator}単位</span>
            <span className="block ml-4">修得済み {displayCredits(course.earnedCredits)} / {denominator} · {completionLabels[course.completion]}{course.earnedExcessCredits > 0 && ` · +${course.earnedExcessCredits}単位 超過候補`}</span>
            <span className="block ml-4">予定込み {displayCredits(course.projectedCredits)} / {denominator} · {completionLabels[course.projectedCompletion]}{course.projectedExcessCredits > 0 && ` · +${course.projectedExcessCredits}単位 超過候補`}</span>
            <span className="block ml-4 text-xs text-gray-500">{contexts.join('、')}</span>
          </summary>
          <ul className="mt-2 ml-4 space-y-1 text-sm">
            {course.officialAchievements.map(row => <li key={row.id}>成績表（公式集計）: {row.earnedCreditsTotal ?? '不明'}単位{row.selectedOfferingId === null && ' / 開講未特定'}</li>)}
            {course.attempts.map(attempt => <li key={attempt.item.offeringId}>
              {offeringFormLabel(attempt.offering)} / {attempt.offering.period ?? '期未設定'} / 開講 {attempt.offering.credits ?? '不明'}単位 / {statusLabels[attempt.item.status]}
              {attempt.item.courseCreditContribution !== undefined && <span> / 科目進捗への寄与設定 {attempt.item.courseCreditContribution}単位</span>}
              {attempt.officialEarnedPreferred ? '（修得単位は公式集計を優先）' : ` / 修得に加算 ${attempt.earnedContribution}単位・予定込みに加算 ${attempt.projectedContribution}単位`}
              {onChange && !attempt.officialEarnedPreferred && course.curriculumCredits === 4 && attempt.offering.method === 'correspondence' && attempt.offering.credits === 4 && <label className="mt-2 block max-w-md text-sm">
                この履修で科目進捗に数える単位
                <select aria-label={`${course.canonicalName}の通信履修で科目進捗に数える単位`} disabled={disabled} value={attempt.item.courseCreditContribution ?? ''}
                  onChange={event => onChange(attempt.item.offeringId, { courseCreditContribution: event.target.value === '' ? undefined : Number(event.target.value) })}
                  className="mt-1 block w-full rounded-sm border border-gray-300 bg-white p-2 text-sm disabled:opacity-50">
                  <option value="">未設定（開講の4単位を使用）</option>
                  <option value="2">2単位（スクーリング2単位と組み合わせる）</option>
                  <option value="4">4単位（通信学習で4単位分）</option>
                  {attempt.item.courseCreditContribution !== undefined && ![2, 4].includes(attempt.item.courseCreditContribution) && <option value={attempt.item.courseCreditContribution}>保存済み設定: {attempt.item.courseCreditContribution}単位</option>}
                </select>
                <span className="mt-1 block text-xs text-gray-600">実際に履修する単位分を選んでください。2単位の通信試験は先にスクーリング2単位の修得確定が必要です。試験・リポートの条件は学習のしおりで確認してください。卒業所要単位への算入は別に判定します。</span>
              </label>}
            </li>)}
          </ul>
          {course.warnings.map(warning => <p key={warning} className="mt-2 ml-4 text-xs text-amber-900">{warning}</p>)}
        </details>;
      })}
    </div>
    {progress.unassigned.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-amber-900">制度科目の照合を確認する項目 {progress.unassigned.length}件</summary><ul className="mt-2 space-y-2">{progress.unassigned.map((warning, index) => <li key={warning.offeringId ?? warning.sourceCourseId ?? index}>{warning.name}: {warning.reason}</li>)}</ul></details>}
  </section>;
}
