import { useState } from 'react';
import { mediaPlanItems, mediaProgressSummary, progressFor, setTotalLessons, toggleLesson } from '../../planner/mediaSchooling';
import type { MediaCourseProgress, Offering, PlannerItem } from '../../planner/plannerCatalog';
import MediaProgressShareModal from './MediaProgressShareModal';

type Props = {
  items: PlannerItem[];
  offerings: Map<string, Offering>;
  progress: Record<string, MediaCourseProgress>;
  disabled: boolean;
  onChange: (offeringId: string, progress: MediaCourseProgress) => void;
};

const statusLabels: Record<PlannerItem['status'], string> = { planned: '計画中', in_progress: '履修中', waiting: '結果待ち', earned: '修得済み', failed: '不合格', dropped: '取りやめ' };

function CourseCard({ item, offering, saved, disabled, onChange }: { item: PlannerItem; offering: Offering; saved: MediaCourseProgress; disabled: boolean; onChange: Props['onChange'] }) {
  const [draft, setDraft] = useState(saved.totalLessons?.toString() ?? '');
  const [error, setError] = useState('');
  const summary = mediaProgressSummary(saved);
  const [isSharing, setIsSharing] = useState(false);
  const saveTotal = () => {
    const value = draft.trim() === '' ? null : Number(draft);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 200)) { setError('全回数は1〜200の整数で入力してください。'); return; }
    const next = setTotalLessons(saved, value);
    if (next === null) { setError('完了済みの回があるため、その回より小さくは設定できません。'); return; }
    setError(''); onChange(item.offeringId, next);
  };
  return <article className="border border-gray-200 bg-white p-4 sm:p-6 min-w-0">
    <h3 className="font-medium text-lg break-words text-[#002255]">{offering.name}</h3>
    <p className="mt-1 text-sm text-gray-600">{item.plannedYear === null ? '年度未設定' : `${item.plannedYear}年度`} / {item.plannedTerm ?? offering.period ?? '期未設定'} / {statusLabels[item.status]}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="block text-sm">全回数
        <input aria-label={`${offering.name}の全回数`} inputMode="numeric" value={draft} disabled={disabled} onChange={event => { setDraft(event.target.value); setError(''); }} onBlur={saveTotal} placeholder="未設定" className="mt-1 w-full border border-gray-300 rounded-sm p-2 disabled:opacity-50" />
      </label>
      <button type="button" disabled={disabled} onClick={saveTotal} className="border border-[#002255] px-3 py-2 text-sm disabled:opacity-50">保存</button>
    </div>
    {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="grid min-w-0 flex-1 grid-cols-3 gap-2 text-sm"><p>動画 {saved.totalLessons === null ? `${summary.video}/—` : `${summary.video}/${saved.totalLessons}`}</p><p>テスト {saved.totalLessons === null ? `${summary.test}/—` : `${summary.test}/${saved.totalLessons}`}</p><p>総合 {summary.percent === null ? '—' : `${summary.percent}%`}</p></div><button type="button" onClick={() => setIsSharing(true)} className="shrink-0 border border-[#002255] px-3 py-2 text-sm text-[#002255]">共有</button></div>
    <div className="mt-2 h-2 bg-gray-100" aria-label={`総合進捗 ${summary.percent === null ? '未設定' : `${summary.percent}%`}`}><div className="h-full bg-[#E65C00]" style={{ width: `${summary.percent ?? 0}%` }} /></div>
    {saved.totalLessons === null ? <p className="mt-5 text-sm text-gray-600">全回数を設定すると、各回の動画とテストの進捗を記録できます。</p> : <div className="mt-5 space-y-2">
      {Array.from({ length: saved.totalLessons }, (_, index) => index + 1).map(lesson => {
        const entry = saved.lessons.find(current => current.lesson === lesson);
        return <div key={lesson} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-gray-100 pt-2 text-sm"><span>第{lesson}回</span>
          <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={entry?.videoCompleted ?? false} disabled={disabled} onChange={() => onChange(item.offeringId, toggleLesson(saved, lesson, 'videoCompleted'))} />動画</label>
          <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={entry?.testCompleted ?? false} disabled={disabled} onChange={() => onChange(item.offeringId, toggleLesson(saved, lesson, 'testCompleted'))} />テスト</label>
        </div>;
      })}
    </div>}
    {isSharing && <MediaProgressShareModal offering={offering} progress={saved} onClose={() => setIsSharing(false)} />}
  </article>;
}

export default function MediaSchoolingProgress({ items, offerings, progress, disabled, onChange }: Props) {
  const mediaItems = mediaPlanItems(items, offerings);
  if (mediaItems.length === 0) return <section aria-labelledby="media-heading" className="bg-white border border-gray-200 p-5 sm:p-7"><h2 id="media-heading" className="text-xl text-[#002255]">メディアスクーリング</h2><p className="mt-4 text-sm text-gray-600">年間履修計画にメディアスクーリング科目を追加すると、ここで進捗を管理できます。</p></section>;
  return <section aria-labelledby="media-heading" className="space-y-4"><div><h2 id="media-heading" className="text-xl text-[#002255]">メディアスクーリング <span className="text-sm">{mediaItems.length}件</span></h2><p className="mt-2 text-sm text-gray-600">動画と視聴後テストの進捗を記録します。成績・単位取得の状態は変更しません。</p></div>{mediaItems.map(item => <CourseCard key={item.offeringId} item={item} offering={offerings.get(item.offeringId)!} saved={progressFor(item.offeringId, progress)} disabled={disabled} onChange={onChange} />)}</section>;
}
