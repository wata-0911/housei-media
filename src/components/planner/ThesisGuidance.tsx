import type { GraduationProfile, PlannerCatalog, ThesisGuidanceProgress, ThesisGuidanceStatus } from '../../planner/plannerCatalog';
import { thesisGuidanceViews } from '../../planner/thesisGuidance';

const label = (status: 'satisfied' | 'unsatisfied' | 'unknown') => status === 'satisfied' ? '満たす' : status === 'unsatisfied' ? '未達' : '判定保留';

export default function ThesisGuidance({ catalog, scopeId, profile, progress, eligibilityCredits, onChange }: {
  catalog: PlannerCatalog; scopeId: string | null; profile: GraduationProfile; progress: ThesisGuidanceProgress;
  eligibilityCredits: number | null; onChange: (next: ThesisGuidanceProgress) => void;
}) {
  const department = catalog.programs.find(program => program.scopeId === scopeId)?.department;
  const rows = thesisGuidanceViews(catalog, scopeId, profile, progress, eligibilityCredits, new Date());
  if (!rows.length) return null;
  return <section className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 className="text-xl text-[#002255]">卒論手続・事前指導（参考）</h2>
    <p className="mt-2 text-sm text-gray-600">卒論単位の進捗とは別の手続記録です。2026年度資料の参考表示であり、最終可否は大学に確認してください。</p>
    {department === '地理学科' && <label className="mt-4 grid gap-1 text-sm">地理調査法（自然編・人文編）のリポート提出
      <select aria-label="地理調査法リポート提出" value={progress.geographyReportSubmitted === null ? 'unknown' : progress.geographyReportSubmitted ? 'submitted' : 'not_submitted'} onChange={event => onChange({ ...progress, geographyReportSubmitted: event.target.value === 'unknown' ? null : event.target.value === 'submitted' })} className="border p-2">
        <option value="unknown">未確認</option><option value="submitted">提出済み</option><option value="not_submitted">未提出</option>
      </select>
    </label>}
    {rows.map(row => <div key={row.id} className="mt-4 border-t pt-3">
      <p className="font-medium">{row.label}</p>
      <div className="mt-2 flex gap-2"><select value={row.step.status} onChange={event => onChange({ ...progress, steps: { ...progress.steps, [row.id]: { ...row.step, status: event.target.value as ThesisGuidanceStatus } } })} className="border p-1"><option value="not_started">未着手</option><option value="planned">予定</option><option value="passed">合格・受講済み</option><option value="failed">不合格</option></select><input aria-label={`${row.label}合格日`} type="date" value={row.step.passedOn ?? ''} onChange={event => onChange({ ...progress, steps: { ...progress.steps, [row.id]: { ...row.step, passedOn: event.target.value || null } } })} className="border p-1" /></div>
      <ul className="mt-2 text-xs">{rows.length && row.conditions.map(condition => <li key={condition.label}>{condition.label}：{label(condition.status)}{condition.reason ? `（${condition.reason}）` : ''}</li>)}</ul>
    </div>)}
  </section>;
}
