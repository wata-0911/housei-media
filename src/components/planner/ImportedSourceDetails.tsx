import {
  importedExamDate, type ImportedCourseAchievement,
  type ImportedStudyRecord
} from '../../planner/gradeImportApply';
import type { Offering } from '../../planner/plannerCatalog';
import { safeImportedStudyOffering } from '../../planner/unifiedCourseView';

function SourceRecord({ record, source, offerings }: { record: ImportedStudyRecord; source?: ImportedCourseAchievement; offerings: Map<string, Offering> }) {
  const offering = safeImportedStudyOffering(record, offerings);
  const examDate = importedExamDate(record, source);
  return <li className="min-w-0 border-t border-gray-200 py-3">
    <p className="font-medium">{record.method === 'schooling' ? 'スクーリング' : '通信'}</p>
    <p className="mt-1">{record.academicYear === null ? '年度未確認' : `${record.academicYear}年度`}{record.yearSource === 'inferred' && '（参考・推定）'}{record.yearSource === 'manual' && '（手動設定）'} / {record.rawTerm ?? record.term ?? '期未確認'}{record.method === 'schooling' && ` / ${record.date ?? '日付未確認'}`}</p>
    {record.method === 'schooling' ? <p>{record.credits === null ? '単位数未確認' : `${record.credits}単位`} / 評価: {record.grade ?? '未確認'}</p> : <>
      <ul className="mt-1 space-y-1">{record.reports?.flatMap((report, index) => report.raw || report.status !== 'none' || report.date
        ? [<li key={index}>リポート {index + 1}: {report.raw || report.status}{report.date && ` / ${report.date}`}</li>] : [])}</ul>
      <p className="mt-1">
        単位修得試験: {record.examGrade ?? '未確認'}
        {' / '}評価: {record.grade ?? '未確認'}
        {' / '}{record.credits === null ? '単位数未確認' : `${record.credits}単位`}
        {' / '}試験日: {examDate ?? '未確認'}
      </p>
    </>}
    <p className="mt-1 break-words text-xs text-gray-600">照合先: {offering ? `${offering.academicYear}開講と照合済み / ${offering.name}` : record.match === 'ambiguous' ? '未特定（複数候補）' : '未特定'}</p>
  </li>;
}

export default function ImportedSourceDetails({ achievements, records, offerings }: { achievements: ImportedCourseAchievement[]; records: ImportedStudyRecord[]; offerings: Map<string, Offering> }) {
  if (records.length === 0) return null;
  return <details className="mt-3 min-w-0 rounded-sm border border-gray-200 bg-slate-50 p-3 text-sm text-gray-800">
    <summary className="cursor-pointer font-medium">成績表の履修内訳（{records.length}件）</summary>
    <p className="mt-2 text-xs text-gray-600">内訳の単位は公式科目行の修得単位に追加加算しません。</p>
    {achievements.map(achievement => <div key={achievement.id} className="mt-3">
      <p className="font-medium">{achievement.rawName} / 公式修得 {achievement.earnedCreditsTotal === null ? '未確定' : `${achievement.earnedCreditsTotal}単位`}</p>
      <ul>{records.filter(record => record.sourceCourseId === achievement.id).map(record => <SourceRecord key={record.id} record={record} source={achievement} offerings={offerings} />)}</ul>
    </div>)}
    {achievements.length === 0 && <><p className="mt-2 text-xs">公式科目行との対応未確認</p><ul>{records.map(record => <SourceRecord key={record.id} record={record} offerings={offerings} />)}</ul></>}
  </details>;
}
