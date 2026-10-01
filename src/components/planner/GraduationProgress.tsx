import type { GraduationProgress as Progress } from '../../planner/graduationProgress';
import { UNKNOWN_REASON_CATEGORY_LABEL } from '../../planner/graduationSources';

const statusLabel = (status: Progress['requirements'][number]['status'], earned: number | null, target: number | null, unit: 'credits' | 'courses' | null) => {
  if (status === 'unknown' || earned === null || target === null) return '判定保留';
  if (status === 'satisfied') return '達成';
  return `あと${Math.max(0, target - earned)}${unit === 'courses' ? '科目' : '単位'}`;
};

const coverageLabel: Record<'supported' | 'partial' | 'unknown', string> = { supported: '判定済み', partial: '部分対応', unknown: '未判定' };

export default function GraduationProgress({ progress }: { progress: Progress }) {
  const evaluated = progress.cards;
  const unknown = progress.requirements.filter(row => row.status === 'unknown');
  return <section aria-labelledby="graduation-progress-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 id="graduation-progress-heading" className="text-xl text-[#002255]">卒業要件の部分進捗</h2>
    <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm leading-relaxed">一部要件のみ自動判定しています。卒業可否を保証しません。</p>
    <p className="my-3 text-sm text-gray-600">修得済みだけを達成判定に使います。履修中・計画中は参考値です。全体判定には合成しません。</p>
    {progress.importedContributionCount > 0 && <p className="mb-3 border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm">成績取込から安全に照合できた修得実績 {progress.importedContributionCount}件を含みます。成績表の科目行ごとの修得単位を一度だけ算入しています。</p>}
    {progress.importedWarnings.length > 0 && <details className="mb-3 border border-amber-200 bg-amber-50 p-3 text-sm"><summary className="cursor-pointer font-medium">成績取込から自動算入しなかった実績：{progress.importedWarnings.length}件</summary><ul className="mt-2 space-y-1 text-xs">{progress.importedWarnings.map((warning, index) => <li key={`${warning.rawName}-${index}`}>{warning.rawName}：{warning.reason}</li>)}</ul></details>}
    {progress.referenceProgress.length > 0 && <div className="mb-3 grid gap-3 sm:grid-cols-2">
      {progress.referenceProgress.map(row => <article key={row.id} className="border border-sky-200 bg-sky-50 p-4">
        <h3 className="font-medium text-[#002255]">{row.label}</h3>
        <p className="mt-2 text-lg"><span className="font-semibold">修得済み {row.earned ?? '—'}</span> / {row.target === null ? '—' : `${row.target}単位`}</p>
        <p className="mt-1 text-xs font-medium text-slate-700">判定範囲：{coverageLabel[row.coverageStatus]}</p>
        <p className="mt-2 text-xs text-gray-700">{row.id === 'overall-reference-progress' ? `認定単位 ${row.recognizedCredits ?? '—'}単位を含む` : `認定スクーリング相当 ${row.recognizedCredits ?? '—'}単位を含む`}</p>
        {row.exemptionCredits !== null && row.exemptionCredits !== undefined && <p className="mt-1 text-xs text-gray-700">卒業要件上の免除 {row.exemptionCredits}単位相当（修得・認定済み単位には加えません）</p>}
        {row.earned !== null && row.target !== null && <p className="mt-1 text-sm text-[#002255]">参考：あと{Math.max(0, row.target - row.earned)}単位</p>}
        {row.reason && <p className="mt-2 text-xs leading-relaxed text-amber-800">{row.unknownReasonCategory && `${UNKNOWN_REASON_CATEGORY_LABEL[row.unknownReasonCategory]}：`}{row.reason}</p>}
        <p className="mt-2 text-xs text-gray-600">この数値だけで卒業可否は判定しません。</p>
        <div className="mt-3 border-t border-sky-100 pt-2 text-xs text-gray-600"><p className="font-medium text-[#002255]">根拠</p><ul className="mt-1 space-y-1">{row.sourceRefs.map((source, index) => <li key={`${source.title}-${index}`}>{source.url ? <a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}{source.year ? ` ${source.year}年度` : ''}{source.page ? ` ${source.page}` : ''}</li>)}</ul></div>
      </article>)}
    </div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {evaluated.map(row => <article key={row.requirementId} className="min-w-0 border border-gray-200 p-4">
        <h3 className="break-words font-medium text-[#002255]">{row.label}</h3>
        <p className="mt-2 text-lg"><span className="font-semibold">{row.earned ?? '—'}</span> / {row.target === null ? '個別要件により変動' : `${row.target}${row.unit === 'courses' ? '科目' : '単位'}`}</p>
        <p className={`mt-1 text-sm font-medium ${row.ruleType === 'public_course_limit' ? 'text-[#002255]' : row.status === 'satisfied' ? 'text-emerald-700' : 'text-amber-700'}`}>{row.ruleType === 'public_course_limit' ? '卒業算入の上限' : statusLabel(row.status, row.earned, row.target, row.unit)}</p>
        <p className="mt-1 text-xs font-medium text-slate-700">判定範囲：{coverageLabel[row.coverageStatus ?? 'unknown']}</p>
        <p className="mt-2 break-words text-xs leading-relaxed text-gray-600">参考：履修中 {row.inProgress ?? '—'}{row.unit === 'courses' ? '科目' : '単位'} / 計画中 {row.planned ?? '—'}{row.unit === 'courses' ? '科目' : '単位'}</p>
        {row.details && <ul className="mt-3 space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-700">{row.details.map(detail => <li key={detail.label} className="break-words">{detail.label}：{detail.earned ?? '—'} / {detail.target}{detail.unit === 'courses' ? '科目' : '単位'}（{detail.reason ?? `履修中 ${detail.inProgress}・計画中 ${detail.planned}${detail.schooling !== undefined ? `・修得済みスクーリング ${detail.schooling}` : ''}`}）</li>)}</ul>}
        {row.partialCourses && row.partialCourses.length > 0 && <div className="mt-3 border-t border-gray-100 pt-2 text-xs leading-relaxed text-gray-700">
          <p className="font-medium text-[#002255]">未完成のカリキュラム科目（卒業算入前）</p>
          <ul className="mt-1 space-y-1">{row.partialCourses.map(course => <li key={course.mappingId} className="break-words">{course.label} {course.earned} / {course.target}単位（あと{course.target - course.earned}単位で卒業算入）</li>)}</ul>
        </div>}
        {row.repeatableCourses && row.repeatableCourses.length > 0 && <ul className="mt-3 space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-700">{row.repeatableCourses.map(course => <li key={course.label}>{course.label} {course.counted} / {course.limit}単位（{Math.min(course.courses, course.limitCourses)} / {course.limitCourses}回）{course.earned > course.counted ? `。超過${course.earned - course.counted}単位は卒業算入外` : ''}</li>)}</ul>}
        {row.publicCourse && <p className="mt-3 border-t border-gray-100 pt-2 text-xs leading-relaxed text-gray-700">{row.publicCourse.countedCredits} / {row.publicCourse.limitCredits}単位（{row.publicCourse.countedCourses} / {row.publicCourse.limitCourses}科目）{row.publicCourse.excludedCredits > 0 ? `。超過${row.publicCourse.excludedCredits}単位は卒業算入外` : ''}</p>}
        {row.reason && <p className="mt-2 break-words text-xs leading-relaxed text-amber-800">{row.unknownReasonCategory && `${UNKNOWN_REASON_CATEGORY_LABEL[row.unknownReasonCategory]}：`}{row.reason}</p>}
        {row.sourceRefs && row.sourceRefs.length > 0 && <div className="mt-3 border-t border-gray-100 pt-2 text-xs leading-relaxed text-gray-600"><p className="font-medium text-[#002255]">根拠</p><ul className="mt-1 space-y-1">{row.sourceRefs.map((source, index) => <li key={`${source.title}-${index}`}>{source.url ? <a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}{source.year ? ` ${source.year}年度` : ''}{source.page ? ` ${source.page}` : ''}</li>)}</ul></div>}
        {row.note && <p className="mt-2 break-words text-xs leading-relaxed text-gray-600">{row.note}</p>}
      </article>)}
    </div>
    <details className="mt-6 border border-gray-200 bg-slate-50 p-4">
      <summary className="cursor-pointer font-medium text-[#002255]">確認が必要な条件：{unknown.length}件</summary>
      <ul className="mt-3 space-y-2 text-sm">
        {progress.unknownReasons.map(item => <li key={item.reason} className="break-words"><p>{item.reason}：{item.count}件</p>{item.labels.length > 0 && <p className="mt-1 text-xs leading-relaxed text-gray-600">対象例：{item.labels.join('、')}</p>}</li>)}
      </ul>
    </details>
    <p className="mt-3 text-xs text-gray-600">判定範囲：判定済み {progress.coverageSummary.supported}件 / 部分対応 {progress.coverageSummary.partial}件 / 未判定 {progress.coverageSummary.unknown}件</p>
    <p className="mt-1 text-xs text-gray-600">個別ルールの自動評価 {progress.evaluableCount}件 / 判定保留 {progress.unknownCount}件</p>
  </section>;
}
