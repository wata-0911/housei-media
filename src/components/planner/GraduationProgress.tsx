import type { GraduationProgress as Progress } from '../../planner/graduationProgress';
import UnresolvedConditions from './UnresolvedConditions';
import { projectUnresolvedConditions, type ConditionContext } from '../../planner/unresolvedConditions';
import type { SpecialLectureProgress } from '../../planner/specialLectureProgress';
import { UNKNOWN_REASON_CATEGORY_LABEL } from '../../planner/graduationSources';

const statusLabel = (status: Progress['requirements'][number]['status'], earned: number | null, target: number | null, unit: 'credits' | 'courses' | null) => {
  if (status === 'unknown' || earned === null || target === null) return '判定保留';
  if (status === 'satisfied') return '達成';
  return `あと${Math.max(0, target - earned)}${unit === 'courses' ? '科目' : '単位'}`;
};

const coverageLabel: Record<'supported' | 'partial' | 'unknown', string> = { supported: '判定済み', partial: '部分対応', unknown: '未判定' };

const importNoticeGroups = [
  { kind: 'allocation_held', label: '卒業単位の算入を保留', info: false },
  { kind: 'credits_unknown', label: '修得単位の確認が必要', info: false },
  { kind: 'schooling_confirmation', label: 'スクーリング算入の確認が必要', info: false },
  { kind: 'out_of_scope', label: '卒業算入対象外（自動除外）', info: true },
] as const;

function SpecialLectureSupplement({ lecture }: { lecture: SpecialLectureProgress }) {
  const quantity = (value: number | null) => value === null ? '未確認' : `${value}単位`;
  return <section aria-label={`${lecture.label}の卒業算入状況`} className="mt-3 min-w-0 border-t border-gray-200 pt-3 text-sm leading-relaxed">
    <h4 className="font-medium text-[#002255]">{lecture.label}</h4>
    <p className="mt-1 break-words">卒業算入上限：{lecture.limit}単位（{lecture.limitCourses}回）</p>
    <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt>修得済み</dt><dd className="break-words text-right">{quantity(lecture.earnedTotal)}{lecture.earnedCourses !== null && `（${lecture.earnedCourses}回）`}</dd>
      <dt>卒業算入{lecture.reason ? '（参考）' : ''}</dt><dd className="break-words text-right">{quantity(lecture.counted)}</dd>
      <dt>あと算入可能</dt><dd className="break-words text-right">{quantity(lecture.remaining)}</dd>
      <dt>上限超過</dt><dd className="break-words text-right">{quantity(lecture.excess)}</dd>
    </dl>
    {lecture.reason && <>
      <p className="mt-2 break-words text-xs text-gray-600">集計対象の修得済み：{lecture.earned}単位（{lecture.courses}回）。保留中の公式実績は含みません。</p>
      {lecture.officialRows.length > 0 && <ul className="mt-1 space-y-1 text-xs text-gray-700">{lecture.officialRows.map(row => <li key={row.id}>公式成績行の修得済み：{quantity(row.earned)}（算入保留・回数未確認）</li>)}</ul>}
      <p className="mt-2 break-words text-xs text-amber-800">{lecture.reason}</p>
    </>}
    <p className="mt-2 text-xs text-gray-500">上限まで修得する必要はありません。履修・修得できる量と卒業算入枠は別です。</p>
  </section>;
}

export default function GraduationProgress({ progress, context, onOpenProfile }: { progress: Progress; context?: ConditionContext; onOpenProfile?: () => void }) {
  const evaluated = progress.cards;
  const conditions = projectUnresolvedConditions(progress, context);
  return <section aria-labelledby="graduation-progress-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 id="graduation-progress-heading" className="text-xl text-[#002255]">卒業要件の部分進捗</h2>
    <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm leading-relaxed">一部要件のみ自動判定しています。卒業可否を保証しません。</p>
    <p className="my-3 text-sm text-gray-600">修得済みだけを達成判定に使います。履修中・計画中は参考値です。全体判定には合成しません。</p>
    {progress.importedContributionCount > 0 && <p className="mb-3 border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm">成績取込から安全に照合できた修得実績 {progress.importedContributionCount}件を含みます。成績表の科目行ごとの修得単位を一度だけ算入しています。</p>}
    {importNoticeGroups.map(group => {
      const notices = progress.importedWarnings.filter(notice => notice.kind === group.kind);
      return notices.length > 0 && <details key={group.kind} data-import-notice-kind={group.kind} className={`mb-3 border p-3 text-sm ${group.info ? 'border-gray-200 bg-slate-50 text-gray-700' : 'border-amber-200 bg-amber-50'}`}><summary className="cursor-pointer font-medium">{group.label}：{notices.length}件</summary><ul className="mt-2 space-y-1 text-xs">{notices.map((notice, index) => <li key={`${notice.rawName}-${index}`}>{notice.rawName}：{notice.reason}</li>)}</ul></details>;
    })}
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
        {row.specialLectures?.map(lecture => <SpecialLectureSupplement key={lecture.label} lecture={lecture} />)}
        {row.repeatableCourses && row.repeatableCourses.some(course => !row.specialLectures?.some(lecture => lecture.label === course.label)) && <ul className="mt-3 space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-700">{row.repeatableCourses.filter(course => !row.specialLectures?.some(lecture => lecture.label === course.label)).map(course => <li key={course.label}>{course.label} {course.counted} / {course.limit}単位（{Math.min(course.courses, course.limitCourses)} / {course.limitCourses}回）{course.earned > course.counted ? `。超過${course.earned - course.counted}単位は卒業算入外` : ''}</li>)}</ul>}
        {row.publicCourse && <p className="mt-3 border-t border-gray-100 pt-2 text-xs leading-relaxed text-gray-700">{row.publicCourse.countedCredits} / {row.publicCourse.limitCredits}単位（{row.publicCourse.countedCourses} / {row.publicCourse.limitCourses}科目）{row.publicCourse.excludedCredits > 0 ? `。超過${row.publicCourse.excludedCredits}単位は卒業算入外` : ''}</p>}
        {row.reason && <p className="mt-2 break-words text-xs leading-relaxed text-amber-800">{row.unknownReasonCategory && `${UNKNOWN_REASON_CATEGORY_LABEL[row.unknownReasonCategory]}：`}{row.reason}</p>}
        {row.sourceRefs && row.sourceRefs.length > 0 && <div className="mt-3 border-t border-gray-100 pt-2 text-xs leading-relaxed text-gray-600"><p className="font-medium text-[#002255]">根拠</p><ul className="mt-1 space-y-1">{row.sourceRefs.map((source, index) => <li key={`${source.title}-${index}`}>{source.url ? <a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}{source.year ? ` ${source.year}年度` : ''}{source.page ? ` ${source.page}` : ''}</li>)}</ul></div>}
        {row.note && <p className="mt-2 break-words text-xs leading-relaxed text-gray-600">{row.note}</p>}
      </article>)}
    </div>
    <UnresolvedConditions projection={conditions} onOpenProfile={onOpenProfile} />
    <p className="mt-3 text-xs text-gray-600">判定範囲：判定済み {progress.coverageSummary.supported}件 / 部分対応 {progress.coverageSummary.partial}件 / 未判定 {progress.coverageSummary.unknown}件</p>
    <p className="mt-1 text-xs text-gray-600">エンジンの個別ルール：自動評価 {progress.evaluableCount}件 / 判定保留 {progress.unknownCount}件</p>
  </section>;
}
