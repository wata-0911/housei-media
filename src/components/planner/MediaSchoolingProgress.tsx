import FuturePlanNotice from './FuturePlanNotice';
import { planningTermLabel } from '../../planner/futurePlanning';
import { useState } from 'react';
import { addAssessment, assessmentLabel, completeVideosThroughLesson, mediaPlanItems, mediaProgressSummary, mediaShareViewModel, progressFor, removeAssessment, setTotalLessons, toggleLesson, updateAssessment, type ImportedMediaShareItem } from '../../planner/mediaSchooling';
import type { MediaAssessment, MediaCourseProgress, Offering, PlannerItem } from '../../planner/plannerCatalog';
import MediaProgressShareModal from './MediaProgressShareModal';
import type { ImportedManagedMedia, ImportedMediaAchievement, ImportedMediaPending } from '../../planner/importedAchievementCalculations';

type Props = {
  items: PlannerItem[];
  offerings: Map<string, Offering>;
  progress: Record<string, MediaCourseProgress>;
  importedAchievements: ImportedMediaAchievement[];
  importedManaged: ImportedManagedMedia[];
  importedPending: ImportedMediaPending[];
  onResolveImportedMedia: (sourceCourseId: string, offeringId: string) => void;
  disabled: boolean;
  onChange: (offeringId: string, progress: MediaCourseProgress) => void;
};

const statusLabels: Record<PlannerItem['status'], string> = { planned: '計画中', in_progress: '履修中', waiting: '結果待ち', earned: '修得済み', failed: '不合格', dropped: '取りやめ' };

function CourseCard({ item, offering, saved, disabled, onChange }: { item: PlannerItem; offering: Offering; saved: MediaCourseProgress; disabled: boolean; onChange: Props['onChange'] }) {
  const [draft, setDraft] = useState(saved.totalLessons?.toString() ?? '');
  const [bulkThroughLesson, setBulkThroughLesson] = useState('1');
  const [error, setError] = useState('');
  const summary = mediaProgressSummary(saved);
  const saveTotal = () => {
    const value = draft.trim() === '' ? null : Number(draft);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 200)) { setError('全回数は1〜200の整数で入力してください。'); return; }
    const next = setTotalLessons(saved, value);
    if (next === null) { setError('完了済みの回があるため、その回より小さくは設定できません。'); return; }
    setError(''); onChange(item.offeringId, next);
  };
  const chooseTotal = (totalLessons: number) => {
    const next = setTotalLessons(saved, totalLessons);
    if (next === null) { setError('完了済みの回があるため、その回より小さくは設定できません。'); return; }
    setDraft(String(totalLessons)); setError(''); onChange(item.offeringId, next);
  };
  const addNewAssessment = () => {
    const assessment: MediaAssessment = { id: crypto.randomUUID(), type: 'midterm', label: '中間試験', scheduledDate: null, completed: false };
    onChange(item.offeringId, addAssessment(saved, assessment));
  };
  const selectedBulkThroughLesson = saved.totalLessons !== null && Number(bulkThroughLesson) >= 1 && Number(bulkThroughLesson) <= saved.totalLessons
    ? Number(bulkThroughLesson)
    : 1;
  const completeVideosThroughSelectedLesson = () => {
    const next = completeVideosThroughLesson(saved, selectedBulkThroughLesson);
    if (next !== null) onChange(item.offeringId, next);
  };
  return <article className="border border-gray-200 bg-white p-4 sm:p-6 min-w-0">
    <h3 className="font-medium text-lg break-words text-[#002255]">{offering.name}</h3>
    <p className="mt-1 text-sm text-gray-600">{item.plannedYear === null ? '年度未設定' : `${item.plannedYear}年度`} / {planningTermLabel(item, offering)} / {statusLabels[item.status]}</p>
    <FuturePlanNotice item={item} offering={offering} />
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="block text-sm">全回数
        <input aria-label={`${offering.name}の全回数`} inputMode="numeric" value={draft} disabled={disabled} onChange={event => { setDraft(event.target.value); setError(''); }} onBlur={saveTotal} placeholder="未設定" className="mt-1 w-full border border-gray-300 rounded-sm p-2 disabled:opacity-50" />
      </label>
      <button type="button" disabled={disabled} onClick={saveTotal} className="border border-[#002255] px-3 py-2 text-sm disabled:opacity-50">保存</button>
    </div>
    <div className="mt-2 flex flex-wrap gap-2 text-sm"><span className="self-center text-gray-600">よくある回数:</span><button type="button" disabled={disabled} onClick={() => chooseTotal(14)} className="border border-gray-300 px-3 py-1 disabled:opacity-50">14回</button><button type="button" disabled={disabled} onClick={() => chooseTotal(15)} className="border border-gray-300 px-3 py-1 disabled:opacity-50">15回</button><button type="button" disabled={disabled} onClick={() => { setDraft(''); setError(''); }} className="border border-gray-300 px-3 py-1 disabled:opacity-50">その他</button><span className="self-center text-xs text-gray-500">その他は上の入力欄に回数を入力</span></div>
    {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    <div className="mt-4 grid grid-cols-3 gap-2 text-sm"><p>動画 {saved.totalLessons === null ? `${summary.video}/—` : `${summary.video}/${saved.totalLessons}`}</p><p>テスト {saved.totalLessons === null ? `${summary.test}/—` : `${summary.test}/${saved.totalLessons}`}</p><p>総合 {summary.percent === null ? '—' : `${summary.percent}%`}</p></div>
    <div className="mt-2 h-2 bg-gray-100" aria-label={`総合進捗 ${summary.percent === null ? '未設定' : `${summary.percent}%`}`}><div className="h-full bg-[#E65C00]" style={{ width: `${summary.percent ?? 0}%` }} /></div>
    {saved.totalLessons === null ? <p className="mt-5 text-sm text-gray-600">全回数を設定すると、各回の動画とテストの進捗を記録できます。</p> : <>
      <div className="mt-5 flex flex-wrap items-end gap-2 border border-gray-200 bg-slate-50 p-3">
        <label className="text-sm">動画を第<select aria-label={`${offering.name}の動画を視聴済みにする回`} value={selectedBulkThroughLesson} disabled={disabled} onChange={event => setBulkThroughLesson(event.target.value)} className="mx-1 border border-gray-300 bg-white p-2"><option value="">選択</option>{Array.from({ length: saved.totalLessons }, (_, index) => index + 1).map(lesson => <option key={lesson} value={lesson}>{lesson}</option>)}</select>回まで視聴済みにする</label>
        <button type="button" disabled={disabled} onClick={completeVideosThroughSelectedLesson} className="border border-[#002255] px-3 py-2 text-sm disabled:opacity-50">適用</button>
        <p className="w-full text-xs text-gray-600">第1回から選択した回までの動画だけを視聴済みにします。テストと以降の動画進捗は変更しません。</p>
      </div>
      <div className="mt-5 space-y-2">
      {Array.from({ length: saved.totalLessons }, (_, index) => index + 1).map(lesson => {
        const entry = saved.lessons.find(current => current.lesson === lesson);
        return <div key={lesson} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-gray-100 pt-2 text-sm"><span>第{lesson}回</span>
          <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={entry?.videoCompleted ?? false} disabled={disabled} onChange={() => onChange(item.offeringId, toggleLesson(saved, lesson, 'videoCompleted'))} />動画</label>
          <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={entry?.testCompleted ?? false} disabled={disabled} onChange={() => onChange(item.offeringId, toggleLesson(saved, lesson, 'testCompleted'))} />テスト</label>
        </div>;
      })}
      </div>
    </>}
    <section className="mt-6 border-t border-gray-200 pt-4" aria-label={`${offering.name}の試験・評価予定`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-medium text-[#002255]">試験・評価予定</h4><p className="mt-1 text-xs text-gray-600">試験の有無・方式・日程は科目ごとに異なります。最新の「法政通信」を確認してください。</p></div><button type="button" disabled={disabled} onClick={addNewAssessment} className="border border-[#002255] px-3 py-2 text-sm disabled:opacity-50">試験を追加</button></div>
      {(saved.assessments ?? []).length > 0 && <div className="mt-3 space-y-3">{(saved.assessments ?? []).map(assessment => <div key={assessment.id} className="grid gap-2 border border-gray-200 bg-slate-50 p-3 sm:grid-cols-[9rem_minmax(0,1fr)_10rem_auto] sm:items-end">
        <label className="text-xs">種類<select value={assessment.type} disabled={disabled} onChange={event => { const type = event.target.value as MediaAssessment['type']; onChange(item.offeringId, updateAssessment(saved, assessment.id, { type, label: type === 'midterm' ? '中間試験' : type === 'final' ? '期末試験' : assessment.label || 'その他の試験' })); }} className="mt-1 w-full border border-gray-300 bg-white p-2 text-sm"><option value="midterm">中間試験</option><option value="final">期末試験</option><option value="other">その他</option></select></label>
        {assessment.type === 'other' ? <label className="text-xs">名称<input value={assessment.label} maxLength={200} disabled={disabled} onChange={event => onChange(item.offeringId, updateAssessment(saved, assessment.id, { label: event.target.value }))} onBlur={event => { if (!event.target.value.trim()) onChange(item.offeringId, updateAssessment(saved, assessment.id, { label: 'その他の試験' })); }} className="mt-1 w-full border border-gray-300 bg-white p-2 text-sm" /></label> : <p className="pb-2 text-sm">{assessmentLabel(assessment)}</p>}
        <label className="text-xs">予定日<input type="date" value={assessment.scheduledDate ?? ''} disabled={disabled} onChange={event => onChange(item.offeringId, updateAssessment(saved, assessment.id, { scheduledDate: event.target.value || null }))} className="mt-1 w-full border border-gray-300 bg-white p-2 text-sm" /></label>
        <div className="flex items-center justify-between gap-3 pb-2"><label className="flex items-center gap-1 whitespace-nowrap text-sm"><input type="checkbox" checked={assessment.completed} disabled={disabled} onChange={() => onChange(item.offeringId, updateAssessment(saved, assessment.id, { completed: !assessment.completed }))} />実施済み</label><button type="button" disabled={disabled} onClick={() => onChange(item.offeringId, removeAssessment(saved, assessment.id))} className="text-sm text-red-700 underline disabled:opacity-50">削除</button></div>
      </div>)}</div>}
    </section>
  </article>;
}

export default function MediaSchoolingProgress({ items, offerings, progress, importedAchievements, importedManaged, importedPending, disabled, onChange, onResolveImportedMedia }: Props) {
  const mediaItems = mediaPlanItems(items, offerings);
  const plannerOfferingIds = new Set(mediaItems.map(item => item.offeringId));
  const uniqueImportedManaged = importedManaged.filter(achievement => !plannerOfferingIds.has(achievement.offering.id));
  const importedShareItems: ImportedMediaShareItem[] = uniqueImportedManaged.map(achievement => ({ offering: achievement.offering, name: achievement.rawName }));
  const [isSharing, setIsSharing] = useState(false);
  const shareGroups = mediaShareViewModel(items, offerings, progress, importedShareItems);
  if (mediaItems.length === 0 && importedManaged.length === 0 && importedAchievements.length === 0 && importedPending.length === 0) return <section aria-labelledby="media-heading" className="bg-white border border-gray-200 p-5 sm:p-7"><h2 id="media-heading" className="text-xl text-[#002255]">メディアスクーリング</h2><p className="mt-4 text-sm text-gray-600">年間履修計画にメディアスクーリング科目を追加すると、ここで進捗を管理できます。</p></section>;
  return <section aria-labelledby="media-heading" className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="media-heading" className="text-xl text-[#002255]">メディアスクーリング <span className="text-sm">{mediaItems.length + uniqueImportedManaged.length}件</span></h2><p className="mt-2 text-sm text-gray-600">動画と視聴後テストの進捗を記録します。成績・単位取得の状態は変更しません。</p></div>{shareGroups.length > 0 && <button type="button" onClick={() => setIsSharing(true)} className="border border-[#002255] bg-[#002255] px-3 py-2 text-sm text-white">全科目を共有</button>}</div>{mediaItems.map(item => <CourseCard key={item.offeringId} item={item} offering={offerings.get(item.offeringId)!} saved={progressFor(item.offeringId, progress)} disabled={disabled} onChange={onChange} />)}{uniqueImportedManaged.length > 0 && <section className="space-y-3"><div className="border border-blue-200 bg-blue-50 p-4"><h3 className="font-medium text-[#002255]">成績表から取り込んだ履修中のメディア</h3><p className="mt-1 text-xs text-gray-600">成績表の元データは変更せず、ユーザー管理の履修状態に紐づけて進捗を記録します。</p></div>{uniqueImportedManaged.map(achievement => <CourseCard key={`imported:${achievement.sourceCourseId}`} item={{ offeringId: achievement.offering.id, status: achievement.meta.lifecycleStatus!, plannedYear: achievement.meta.plannedYear, plannedTerm: achievement.meta.plannedTerm, studyYear: achievement.meta.studyYear, earnedOrder: null }} offering={{ ...achievement.offering, name: achievement.rawName }} saved={progressFor(achievement.offering.id, progress)} disabled={disabled} onChange={onChange} />)}</section>}{importedPending.length > 0 && <section className="border border-amber-200 bg-amber-50 p-4"><h3 className="font-medium text-[#002255]">判定できない取込スクーリング実績</h3><p className="mt-1 text-xs text-gray-600">通常スクーリングとの区別に十分な根拠がないため自動登録していません。メディアだった場合だけ照合先を選んでください。</p>{importedPending.map(row => <label key={row.sourceCourseId} className="mt-3 block text-sm">{row.rawName}<select disabled={disabled} defaultValue="" onChange={event => { if (event.target.value) onResolveImportedMedia(row.sourceCourseId, event.target.value); }} className="ml-2 max-w-full border p-1"><option value="">メディアなら選択</option>{row.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}（{candidate.deliveryCategory ?? candidate.period ?? '期未設定'}）</option>)}</select></label>)}</section>}{importedAchievements.length > 0 && <section className="border border-emerald-200 bg-emerald-50 p-4"><h3 className="font-medium text-[#002255]">成績表から取り込んだメディア実績</h3><p className="mt-1 text-xs text-gray-600">過去実績です。動画・テスト・評価予定の進捗は作成しません。</p><ul className="mt-3 space-y-2 text-sm">{importedAchievements.map(achievement => <li key={achievement.sourceCourseId} className="border border-emerald-100 bg-white p-3"><p className="font-medium">{achievement.rawName}</p><p className="mt-1 text-gray-700">{achievement.academicYear === null ? '年度未設定' : `${achievement.academicYear}年度`} / {achievement.term ?? achievement.offering.period ?? '期未設定'} / 修得 {achievement.earnedCreditsTotal}単位{achievement.schoolingCreditsTotal === null ? '' : `（S ${achievement.schoolingCreditsTotal}単位）`}</p><p className="mt-1 text-xs text-gray-600">成績表の評価: {achievement.records.filter(record => record.grade).map(record => `${record.method === 'schooling' ? 'S' : '通信'} ${record.grade}`).join(' / ') || '未設定'}</p></li>)}</ul></section>}{isSharing && <MediaProgressShareModal groups={shareGroups} onClose={() => setIsSharing(false)} />}</section>;
}
