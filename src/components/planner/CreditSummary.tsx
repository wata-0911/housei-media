import type { summarizeCredits } from '../../planner/calculations';

export default function CreditSummary({ summary, importedAchievementCount = 0 }: { summary: ReturnType<typeof summarizeCredits>; importedAchievementCount?: number }) {
  return <section aria-label="単位集計">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    {([
      ['修得済み', summary.earned, '単位'], ['履修中', summary.in_progress, '単位'],
      ['計画中', summary.planned, '単位'], ['単位数不明', summary.unknownCreditItems, '件'],
    ] as const).map(([label, value, unit]) => <div key={label} className="bg-white border-t-4 border-[#002255] p-5 shadow-sm">
      <p className="text-sm text-gray-600">{label}</p>
      <p className="mt-2 text-3xl text-[#002255] tabular-nums">{value}<span className="ml-2 text-sm">{unit}</span></p>
    </div>)}</div>
    {importedAchievementCount > 0 && <p className="mt-2 text-xs text-gray-600">成績表から安全に照合された修得実績 {importedAchievementCount}件を含みます。</p>}
  </section>;
}
