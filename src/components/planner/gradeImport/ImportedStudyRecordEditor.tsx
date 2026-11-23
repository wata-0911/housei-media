import CommittedInput from '../common/CommittedInput';
import { normalizeAdmissionYear } from '../../../planner/graduation/graduationProfile';
import { normalizeImportName, type ImportedCourseAchievement, type ImportedStudyRecord } from '../../../planner/gradeImport/gradeImportApply';
import type { Offering } from '../../../planner/plannerCatalog';

const methodLabel = (method: ImportedStudyRecord['method']) => method === 'correspondence' ? '通信' : 'スクーリング';
const matchLabel = (match: ImportedStudyRecord['match']) => match === 'exact_unique' ? '一意一致' : match === 'ambiguous' ? '要確認' : '未一致';
const yearLabel = (source: ImportedStudyRecord['yearSource']) => source === 'source' ? '成績表の年度' : source === 'inferred' ? '推定' : source === 'manual' ? '手動修正' : '未設定';

export default function ImportedStudyRecordEditor({ record, sourceRows = [], offerings, disabled, onChange, onDelete }: { record: ImportedStudyRecord; sourceRows?: ImportedCourseAchievement[]; offerings: Offering[]; disabled: boolean; onChange: (id: string, patch: Partial<ImportedStudyRecord>) => void; onDelete: (id: string) => void }) {
  const linked = record.offeringId ? offerings.find(offering => offering.id === record.offeringId) : null;
  const candidates = offerings.filter(offering => offering.method === record.method && offering.name.trim() === record.rawName.trim());
  // Resolve only an existing, unique owner. Never infer a parent by name or
  // snapshot quantities; those quantities are retained import-time history.
  const sources = sourceRows.filter(source => record.sourceCourseId && source.id === record.sourceCourseId);
  const source = sources.length === 1 && sources[0].source === record.source
    && normalizeImportName(sources[0].rawName) === normalizeImportName(record.rawName) ? sources[0] : null;
  const snapshotDiffers = source && (['earnedCreditsTotal', 'schoolingCreditsTotal', 'compositionCredits', 'recognizedExemption', 'additionalEnrollment'] as const).some(key => record[key] !== undefined && record[key] !== source[key]);
  return <article data-import-study-id={record.id} className="border p-3 text-sm space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="font-medium">{record.rawName} <span className="font-normal text-gray-600">— {methodLabel(record.method)}</span></p><button type="button" disabled={disabled} onClick={() => { if (window.confirm(`「${record.rawName}」の取り込んだ履修実績を削除しますか？`)) onDelete(record.id); }} className="text-xs underline disabled:opacity-50">削除</button></div>
    <div className="grid gap-2 sm:grid-cols-2"><label>年度 <CommittedInput disabled={disabled} type="number" value={record.academicYear?.toString() ?? ''} onCommit={raw => { const year = normalizeAdmissionYear(raw); if (raw.trim() && year === null) throw new Error('年度は4桁の西暦（1000〜9999）で入力してください。'); return onChange(record.id, { academicYear: year, yearSource: 'manual' }); }} className="ml-2 w-24 border p-1" /> <span className="text-xs text-gray-600">{yearLabel(record.yearSource)}</span></label><label>期 <CommittedInput disabled={disabled} value={record.term ?? ''} onCommit={term => onChange(record.id, { term: term || null })} className="ml-2 w-20 border p-1" /></label></div>
    <p>日付: {record.date ?? '未設定'} / 単位: {record.credits ?? '未設定'} / 評価（成績表の項目）: {record.grade ?? '未設定'}</p>
    {source && <p className="text-xs text-gray-600">成績表の科目行（現在の公式集計）: 修得単位 {source.earnedCreditsTotal ?? '不明'} / S単位 {source.schoolingCreditsTotal ?? '不明'} / 構成単位 {source.compositionCredits ?? '不明'}（内訳の単位は追加加算しません）</p>}
    {record.sourceCourseId && (!source || snapshotDiffers) && <p className="text-xs text-gray-600">取込時の集計（履歴）: 修得単位 {record.earnedCreditsTotal ?? '不明'} / S単位 {record.schoolingCreditsTotal ?? '不明'} / 構成単位 {record.compositionCredits ?? '不明'}{source ? '（現在の公式集計とは別の取込時点の記録です）' : '（現在の公式科目行との対応未確認）'}</p>}
    <label className="block">照合先 <select disabled={disabled} value={record.offeringId ?? ''} onChange={event => onChange(record.id, { offeringId: event.target.value || null })} className="ml-2 max-w-full border p-1"><option value="">選ばない（Imported Course実績として保存）</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}（{candidate.period ?? '期未設定'}）</option>)}</select></label>
    <p className="text-xs text-gray-600">{matchLabel(record.match)}{linked ? ` / 紐づけ: ${linked.name}（${linked.period ?? '期未設定'}）` : ' / 新規Imported Course実績'} / 取込元: 法政成績表</p>
    {record.method === 'correspondence' && <details className="text-xs"><summary className="cursor-pointer">リポート・試験の詳細</summary><p className="mt-1">リポート: {record.reports?.map(report => report.raw || report.status).filter(Boolean).join(' / ') || '記録なし'} / 単位修得試験: {record.examGrade ?? '未設定'}</p></details>}
    <p className="text-xs text-gray-600">この評価は最終評価ではありません。履修計画・卒業要件・修得状態は変更しません。</p>
  </article>;
}
