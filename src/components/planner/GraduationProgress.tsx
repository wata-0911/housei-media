import type { GraduationProgress as Progress } from '../../planner/graduationProgress';

const statusLabel = (status: Progress['requirements'][number]['status'], earned: number | null, target: number | null, unit: 'credits' | 'courses' | null) => {
  if (status === 'unknown' || earned === null || target === null) return '判定保留';
  if (status === 'satisfied') return '達成';
  return `あと${Math.max(0, target - earned)}${unit === 'courses' ? '科目' : '単位'}`;
};

export default function GraduationProgress({ progress }: { progress: Progress }) {
  const evaluated = progress.requirements.filter(row => row.status !== 'unknown');
  const unknown = progress.requirements.filter(row => row.status === 'unknown');
  return <section aria-labelledby="graduation-progress-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 id="graduation-progress-heading" className="text-xl text-[#002255]">卒業要件の部分進捗</h2>
    <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm leading-relaxed">一部要件のみ自動判定しています。卒業可否を保証しません。</p>
    <p className="my-3 text-sm text-gray-600">修得済みだけを達成判定に使います。履修中・計画中は参考値です。各要件は独立して表示し、全体判定には合成しません。</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {evaluated.map(row => <article key={row.requirementId} className="min-w-0 border border-gray-200 p-4">
        <h3 className="break-words font-medium text-[#002255]">{row.label}</h3>
        <p className="mt-2 text-lg"><span className="font-semibold">{row.earned}</span> / {row.target}{row.unit === 'courses' ? '科目' : '単位'}</p>
        <p className={`mt-1 text-sm font-medium ${row.status === 'satisfied' ? 'text-emerald-700' : 'text-amber-700'}`}>{statusLabel(row.status, row.earned, row.target, row.unit)}</p>
        <p className="mt-2 break-words text-xs leading-relaxed text-gray-600">参考：履修中 {row.inProgress}{row.unit === 'courses' ? '科目' : '単位'} / 計画中 {row.planned}{row.unit === 'courses' ? '科目' : '単位'}</p>
      </article>)}
    </div>
    <details className="mt-6 border border-gray-200 bg-slate-50 p-4">
      <summary className="cursor-pointer font-medium text-[#002255]">自動判定できない要件：{unknown.length}件</summary>
      <ul className="mt-3 space-y-2 text-sm">
        {progress.unknownReasons.map(item => <li key={item.reason} className="break-words">{item.reason}：{item.count}件</li>)}
      </ul>
    </details>
    <p className="mt-3 text-xs text-gray-600">自動評価 {progress.evaluableCount}件 / 判定保留 {progress.unknownCount}件</p>
  </section>;
}
