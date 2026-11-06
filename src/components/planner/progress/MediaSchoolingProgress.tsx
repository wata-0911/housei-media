import type { MediaConfirmation } from '../../../planner/gradeImport/mediaConfirmation';
import type { OfficialMediaAchievement } from '../../../planner/gradeImport/officialMediaAchievements';
import FuturePlanNotice from '../planning/FuturePlanNotice';
import CommittedInput from '../common/CommittedInput';
import { planningTermLabel } from '../../../planner/planning/futurePlanning';
import { useId, useRef, useState } from 'react';
import { addAssessment, assessmentLabel, completeVideosThroughLesson, mediaPlanItems, mediaProgressSummary, mediaShareViewModel, progressFor, removeAssessment, setTotalLessons, toggleLesson, updateAssessment, type ImportedMediaShareItem } from '../../../planner/progress/mediaSchooling';
import type { MediaAssessment, MediaCourseProgress, Offering, PlannerItem } from '../../../planner/plannerCatalog';
import MediaProgressShareModal from './MediaProgressShareModal';
import type { ImportedManagedMedia, ImportedMediaAchievement, ImportedMediaPending } from '../../../planner/gradeImport/importedAchievementCalculations';

type Props = {
  items: PlannerItem[];
  offerings: Map<string, Offering>;
  progress: Record<string, MediaCourseProgress>;
  officialAchievements?: OfficialMediaAchievement[];
  importedAchievements: (ImportedMediaAchievement & { canConfirmOffering?: boolean })[];
  importedManaged: ImportedManagedMedia[];
  importedPending: (ImportedMediaPending & { canConfirmOffering: boolean })[];
  savedRaw: string | null;
  onResolveImportedMedia: (request: MediaConfirmation) => void;
  disabled: boolean;
  onChange: (offeringId: string, progress: MediaCourseProgress) => void | boolean | Promise<void | boolean>;
};

const statusLabels: Record<PlannerItem['status'], string> = { planned: '計画中', in_progress: '履修中', waiting: '結果待ち', earned: '修得済み', failed: '不合格', dropped: '取りやめ' };

function OfficialMediaHistory({ achievements }: { achievements: OfficialMediaAchievement[] }) {
  const identities = { curriculum_only: '保存済みカリキュラム照合あり / 制度科目・本人適用は要確認 / 卒業算入は別途判定', ambiguous: '制度科目は複数候補・要確認 / 卒業算入は保留', unmatched: '制度科目は未照合 / 卒業算入は保留', unverified: '制度科目の照合根拠は未確認 / 卒業算入は保留', conflict: '制度科目の照合情報に矛盾・要確認 / 卒業算入は保留' };
  return <section className="border border-emerald-200 bg-emerald-50 p-4" aria-label="成績表由来のメディア記録">
    <h3 className="font-medium text-[#002255]">成績表由来のメディア記録 — {achievements.length}件</h3>
    <p className="mt-1 text-xs text-gray-600">期欄の原表記から表示しています。科目行の修得単位はメディア分の単位数や卒業算入単位ではありません。進捗・修得状態は変更しません。</p>
    <ul className="mt-3 space-y-2 text-sm">{achievements.map(row => <li key={row.sourceCourseId} data-official-media-id={row.sourceCourseId} className="min-w-0 break-words border border-emerald-100 bg-white p-3">
      <p className="font-medium">{row.rawName}</p>
      <p className="mt-1">メディア（成績表由来） / 科目行の修得単位: {row.earnedCreditsTotal === null ? '不明' : `${row.earnedCreditsTotal}単位`}</p>
      <p className="mt-1 text-xs">{identities[row.identity]}</p>
      {row.records.map(record => <p key={record.id} className="mt-1 text-xs text-gray-600">原年度: {record.rawYear || '未記録'} / 原期: {record.rawTerm} / 原評価: {record.grade || '未記録'}</p>)}
    </li>)}</ul>
  </section>;
}

function CompatibilityMediaHistory({ importedAchievements, savedRaw, disabled, onResolveImportedMedia }:
  Pick<Props, 'importedAchievements' | 'savedRaw' | 'disabled' | 'onResolveImportedMedia'>) {
  return <section aria-label="照合先に基づくメディア履歴" className="border border-emerald-200 bg-emerald-50 p-4">
    <h3 className="font-medium text-[#002255]">照合先に基づくメディア履歴</h3>
    <p className="mt-1 text-xs text-gray-600">方式未確認（成績表）。照合先がメディアのため表示しています。</p>
    <ul className="mt-3 space-y-2 text-sm">{importedAchievements.map(history => (
      <li key={history.sourceCourseId} className="min-w-0 break-words border border-emerald-100 bg-white p-3">
        <p className="font-medium">{history.rawName}</p>
        <p className="mt-1 text-gray-700">
          {history.academicYear === null ? '年度未設定' : `${history.academicYear}年度`} / {history.term ?? (history.offering.period ? `照合先の期: ${history.offering.period}` : '期未設定')} / 科目行の修得 {history.earnedCreditsTotal}単位
          {history.schoolingCreditsTotal === null ? '' : `（S ${history.schoolingCreditsTotal}単位）`}
        </p>
        <p className="mt-1 text-xs text-gray-600">成績表の評価: {history.records.filter(record => record.grade).map(record => `${record.method === 'schooling' ? 'S' : '通信'} ${record.grade}`).join(' / ') || '未設定'}</p>
        {history.canConfirmOffering && <form key={history.offering.id} className="mt-2" onSubmit={event => {
          event.preventDefault();
          const selected = new FormData(event.currentTarget).get('offeringId');
          if (selected === history.offering.id) onResolveImportedMedia({ sourceCourseId: history.sourceCourseId, offeringId: selected, reviewedRaw: savedRaw });
        }}>
          <label className="block">
            照合先の候補
            <select name="offeringId" aria-label={`${history.rawName}の照合先を確認`} disabled={disabled}
              required defaultValue={history.offering.id} className="mt-1 block max-w-full border p-1">
              <option value="">未確認のまま</option>
              <option value={history.offering.id}>{history.offering.name}（{history.offering.deliveryCategory ?? 'メディア'}）</option>
            </select>
          </label>
          <button type="submit" disabled={disabled} className="planner-button mt-2 border px-3 py-1">この照合先で手動照合</button>
        </form>}
      </li>
    ))}</ul>
  </section>;
}

function PendingMediaRow({ row, savedRaw, disabled, onResolveImportedMedia }:
  Pick<Props, 'savedRaw' | 'disabled' | 'onResolveImportedMedia'> & { row: Props['importedPending'][number] }) {
  const [choice, setChoice] = useState<{ id: string; raw: string | null } | null>(null);
  if (!row.canConfirmOffering) return <div className="mt-3 text-sm">
    <p>{row.rawName}</p>
    <p>参照のみ。確定できる公式原行がありません。</p>
    <ul className="list-inside list-disc">{row.candidates.map(candidate =>
      <li key={candidate.id}>{candidate.name}（{candidate.deliveryCategory ?? candidate.period ?? '期未設定'}）</li>)}</ul>
  </div>;
  const selected = choice && choice.raw === savedRaw ? choice.id : '';
  const canSubmit = row.candidates.some(candidate => candidate.id === selected);
  return <form className="mt-3 space-y-2 text-sm" onKeyDown={event => {
    if (event.key === 'Escape') setChoice(null);
  }} onSubmit={event => {
    event.preventDefault();
    if (!disabled && canSubmit && choice) onResolveImportedMedia({ sourceCourseId: row.sourceCourseId, offeringId: selected, reviewedRaw: choice.raw });
  }}>
    <label className="block">{row.rawName}
      <select value={selected} disabled={disabled} className="mt-1 block max-w-full border p-1"
        onChange={event => setChoice({ id: event.target.value, raw: savedRaw })}>
        <option value="">メディアなら選択</option>
        {row.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>
          {candidate.name}（{candidate.deliveryCategory ?? candidate.period ?? '期未設定'}）
        </option>)}
      </select>
    </label>
    <button type="submit" disabled={disabled || !canSubmit} className="planner-button border px-3 py-1">この照合先で確定</button>
    <button type="button" disabled={disabled || !selected} onClick={() => setChoice(null)} className="planner-button ml-2 border px-3 py-1">キャンセル</button>
  </form>;
}

function CourseCard({ item, offering, saved, disabled, onChange }: { item: PlannerItem; offering: Offering; saved: MediaCourseProgress; disabled: boolean; onChange: Props['onChange'] }) {
  const [lessonsExpanded, setLessonsExpanded] = useState(false);
  const lessonsId = useId();
  const [error, setError] = useState('');
  const [totalEpoch, setTotalEpoch] = useState(0);
  const totalInput = useRef<HTMLInputElement>(null);
  const summary = mediaProgressSummary(saved);
  const saveTotal = (raw: string) => {
    const value = raw.trim() === '' ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 200)) throw new Error('全回数は1〜200の整数で入力してください。');
    const next = setTotalLessons(saved, value);
    if (next === null) throw new Error('完了済みの回があるため、その回より小さくは設定できません。');
    setError(''); return onChange(item.offeringId, next);
  };
  const chooseTotal = async (totalLessons: number) => {
    const next = setTotalLessons(saved, totalLessons);
    if (next === null) { setError('完了済みの回があるため、その回より小さくは設定できません。'); return; }
    setError(''); const result = await onChange(item.offeringId, next);
    if (result !== false) setTotalEpoch(epoch => epoch + 1);
  };
  const addNewAssessment = () => {
    const assessment: MediaAssessment = { id: crypto.randomUUID(), type: 'midterm', label: '中間試験', scheduledDate: null, completed: false };
    onChange(item.offeringId, addAssessment(saved, assessment));
  };
  const changeVideo = (lesson: number, checked: boolean) => {
    const next = checked
      ? completeVideosThroughLesson(saved, lesson)
      : toggleLesson(saved, lesson, 'videoCompleted');
    if (next !== null) onChange(item.offeringId, next);
  };
  return <article className="border border-gray-200 bg-white p-4 sm:p-6 min-w-0">
    <h3 className="font-medium text-lg break-words text-[#002255]">{offering.name}</h3>
    <p className="mt-1 text-sm text-gray-600">{item.plannedYear === null ? '年度未設定' : `${item.plannedYear}年度`} / {planningTermLabel(item, offering)} / {statusLabels[item.status]}</p>
    <FuturePlanNotice item={item} offering={offering} />
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="block text-sm">全回数
        <CommittedInput key={totalEpoch} inputRef={totalInput} aria-label={`${offering.name}の全回数`} inputMode="numeric" value={saved.totalLessons?.toString() ?? ''} disabled={disabled} onCommit={saveTotal} saveLabel="保存" placeholder="未設定" className="mt-1 w-full border border-gray-300 rounded-sm p-2 disabled:opacity-50" />
      </label>
    </div>
    <div className="mt-2 flex flex-wrap gap-2 text-sm"><span className="self-center text-gray-600">よくある回数:</span><button type="button" disabled={disabled} data-replaces-draft="true" onClick={() => chooseTotal(14)} className="planner-button border border-gray-300 px-3 py-1 disabled:opacity-50">14回</button><button type="button" disabled={disabled} data-replaces-draft="true" onClick={() => chooseTotal(15)} className="planner-button border border-gray-300 px-3 py-1 disabled:opacity-50">15回</button><button type="button" disabled={disabled} data-replaces-draft="true" onClick={() => { totalInput.current?.focus(); totalInput.current?.select(); }} className="planner-button border border-gray-300 px-3 py-1 disabled:opacity-50">その他</button><span className="self-center text-xs text-gray-500">その他は上の入力欄に回数を入力</span></div>
    {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    <div className="mt-4 grid grid-cols-3 gap-2 text-sm"><p>動画 {saved.totalLessons === null ? `${summary.video}/—` : `${summary.video}/${saved.totalLessons}`}</p><p>テスト {saved.totalLessons === null ? `${summary.test}/—` : `${summary.test}/${saved.totalLessons}`}</p><p>総合 {summary.percent === null ? '—' : `${summary.percent}%`}</p></div>
    <div className="mt-2 h-2 bg-gray-100" aria-label={`総合進捗 ${summary.percent === null ? '未設定' : `${summary.percent}%`}`}><div className="h-full bg-[#E65C00]" style={{ width: `${summary.percent ?? 0}%` }} /></div>
    <p className="mt-2 text-sm text-gray-600">各回の動画・テスト：{saved.totalLessons === null ? '全回数未設定（完了判定なし）' : summary.video < saved.totalLessons || summary.test < saved.totalLessons ? '未完了あり' : 'すべて完了'}</p>
    {saved.totalLessons === null ? <p className="mt-5 text-sm text-gray-600">全回数を設定すると、各回の動画とテストの進捗を記録できます。</p> : <>
      <button type="button" aria-expanded={lessonsExpanded} aria-controls={lessonsId} aria-label={`${offering.name}の各回一覧を${lessonsExpanded ? '折りたたむ' : '表示'}`} onClick={() => setLessonsExpanded(expanded => !expanded)} className="planner-button mt-4 border border-[#002255] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002255]">各回一覧を{lessonsExpanded ? '折りたたむ' : '表示'}</button>
      <div id={lessonsId} hidden={!lessonsExpanded}>
      <p className="mt-5 text-xs text-gray-600">動画にチェックを入れると、その回まで一括で視聴済みになります。外す場合はその回のみ解除されます。</p>
      <div className="mt-3 space-y-2">
      {Array.from({ length: saved.totalLessons }, (_, index) => index + 1).map(lesson => {
        const entry = saved.lessons.find(current => current.lesson === lesson);
        return <div key={lesson} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-gray-100 pt-2 text-sm"><span>第{lesson}回</span>
          <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={entry?.videoCompleted ?? false} disabled={disabled} onChange={event => changeVideo(lesson, event.target.checked)} />動画</label>
          <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={entry?.testCompleted ?? false} disabled={disabled} onChange={() => onChange(item.offeringId, toggleLesson(saved, lesson, 'testCompleted'))} />テスト</label>
        </div>;
      })}
      </div>
      </div>
    </>}
    <section className="mt-6 border-t border-gray-200 pt-4" aria-label={`${offering.name}の試験・評価予定`}>
      <p className="mb-2 text-xs text-gray-600">名称・全回数・予定日は、入力欄を離れるかEnterキーで確定して保存します。</p>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-medium text-[#002255]">試験・評価予定</h4><p className="mt-1 text-xs text-gray-600">試験の有無・方式・日程は科目ごとに異なります。最新の「法政通信」を確認してください。</p></div><button type="button" disabled={disabled} onClick={addNewAssessment} className="planner-button border border-[#002255] px-3 py-2 text-sm disabled:opacity-50">試験を追加</button></div>
      {(saved.assessments ?? []).length > 0 && <div className="mt-3 space-y-3">{(saved.assessments ?? []).map(assessment => <div key={assessment.id} className="grid gap-2 border border-gray-200 bg-slate-50 p-3 sm:grid-cols-[9rem_minmax(0,1fr)_10rem_auto] sm:items-end">
        <label className="text-xs">種類<select value={assessment.type} disabled={disabled} onChange={event => { const type = event.target.value as MediaAssessment['type']; onChange(item.offeringId, updateAssessment(saved, assessment.id, { type, label: type === 'midterm' ? '中間試験' : type === 'final' ? '期末試験' : assessment.label || 'その他の試験' })); }} className="mt-1 w-full border border-gray-300 bg-white p-2 text-sm"><option value="midterm">中間試験</option><option value="final">期末試験</option><option value="other">その他</option></select></label>
        {assessment.type === 'other' ? <label className="text-xs">名称<CommittedInput aria-label="試験・評価予定の名称" value={assessment.label} maxLength={200} disabled={disabled} normalize={raw => raw.trim() ? raw : 'その他の試験'} onCommit={label => onChange(item.offeringId, updateAssessment(saved, assessment.id, { label }))} className="mt-1 w-full border border-gray-300 bg-white p-2 text-sm" /></label> : <p className="pb-2 text-sm">{assessmentLabel(assessment)}</p>}
        <label className="text-xs">予定日<CommittedInput type="date" value={assessment.scheduledDate ?? ''} disabled={disabled} onCommit={raw => onChange(item.offeringId, updateAssessment(saved, assessment.id, { scheduledDate: raw || null }))} className="mt-1 w-full border border-gray-300 bg-white p-2 text-sm" /></label>
        <div className="flex items-center justify-between gap-3 pb-2"><label className="flex items-center gap-1 whitespace-nowrap text-sm"><input type="checkbox" checked={assessment.completed} disabled={disabled} onChange={() => onChange(item.offeringId, updateAssessment(saved, assessment.id, { completed: !assessment.completed }))} />実施済み</label><button type="button" disabled={disabled} onClick={() => onChange(item.offeringId, removeAssessment(saved, assessment.id))} className="text-sm text-red-700 underline disabled:opacity-50">削除</button></div>
      </div>)}</div>}
    </section>
  </article>;
}

export default function MediaSchoolingProgress({ items, offerings, progress, officialAchievements = [], importedAchievements, importedManaged, importedPending, savedRaw, disabled, onChange, onResolveImportedMedia }: Props) {
  const mediaItems = mediaPlanItems(items, offerings);
  const plannerOfferingIds = new Set(mediaItems.map(item => item.offeringId));
  const uniqueImportedManaged = importedManaged.filter(achievement => !plannerOfferingIds.has(achievement.offering.id));
  const importedShareItems: ImportedMediaShareItem[] = uniqueImportedManaged.map(achievement => ({ offering: achievement.offering, name: achievement.rawName }));
  const [isSharing, setIsSharing] = useState(false);
  const shareGroups = mediaShareViewModel(items, offerings, progress, importedShareItems);
  if (officialAchievements.length === 0 && mediaItems.length === 0 && importedManaged.length === 0 && importedAchievements.length === 0 && importedPending.length === 0) return <section aria-labelledby="media-heading" className="bg-white border border-gray-200 p-5 sm:p-7"><h2 id="media-heading" className="text-xl text-[#002255]">メディアスクーリング</h2><p className="mt-4 text-sm text-gray-600">年間履修計画にメディアスクーリング科目を追加すると、ここで進捗を管理できます。</p></section>;
  return <section aria-labelledby="media-heading" className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="media-heading" className="text-xl text-[#002255]">メディアスクーリング <span className="text-sm">進捗管理 {mediaItems.length + uniqueImportedManaged.length}件</span></h2><p className="mt-2 text-sm text-gray-600">動画と視聴後テストの進捗を記録します。成績・単位取得の状態は変更しません。</p></div>{shareGroups.length > 0 && <button type="button" onClick={() => setIsSharing(true)} className="planner-button planner-button--navy border border-[#002255] bg-[#002255] px-3 py-2 text-sm text-white">全科目を共有</button>}</div>{mediaItems.map(item => <CourseCard key={item.offeringId} item={item} offering={offerings.get(item.offeringId)!} saved={progressFor(item.offeringId, progress)} disabled={disabled} onChange={onChange} />)}{uniqueImportedManaged.length > 0 && <section className="space-y-3"><div className="border border-blue-200 bg-blue-50 p-4"><h3 className="font-medium text-[#002255]">成績表から取り込んだ履修中のメディア</h3><p className="mt-1 text-xs text-gray-600">成績表の元データは変更せず、ユーザー管理の履修状態に紐づけて進捗を記録します。</p></div>{uniqueImportedManaged.map(achievement => <CourseCard key={`imported:${achievement.sourceCourseId}`} item={{ offeringId: achievement.offering.id, status: achievement.meta.lifecycleStatus!, plannedYear: achievement.meta.plannedYear, plannedTerm: achievement.meta.plannedTerm, studyYear: achievement.meta.studyYear, earnedOrder: null }} offering={{ ...achievement.offering, name: achievement.rawName }} saved={progressFor(achievement.offering.id, progress)} disabled={disabled} onChange={onChange} />)}</section>}{importedPending.length > 0 && <section className="border border-amber-200 bg-amber-50 p-4"><h3 className="font-medium text-[#002255]">判定できない取込スクーリング実績</h3><p className="mt-1 text-xs text-gray-600">方式または進捗管理用の照合先が未確定です。メディアの進捗を記録する場合は、照合先を確認して選んでください。成績表由来の方式表示とは別の操作です。</p>{importedPending.map(row => <PendingMediaRow key={JSON.stringify([row.sourceCourseId, ...row.candidates.map(candidate => candidate.id)])}
      row={row} savedRaw={savedRaw} disabled={disabled} onResolveImportedMedia={onResolveImportedMedia} />)}</section>}{officialAchievements.length > 0 && <OfficialMediaHistory achievements={officialAchievements} />}{importedAchievements.length > 0 && <CompatibilityMediaHistory importedAchievements={importedAchievements} savedRaw={savedRaw} disabled={disabled} onResolveImportedMedia={onResolveImportedMedia} />}{isSharing && <MediaProgressShareModal groups={shareGroups} onClose={() => setIsSharing(false)} />}</section>;
}
