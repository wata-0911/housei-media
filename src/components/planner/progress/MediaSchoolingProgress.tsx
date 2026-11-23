import type { IndependentProgress, LegacyProgressReview } from '../../../planner/candidate2026/sameOriginAuthority';
import type { independentImportedMedia } from '../../../planner/gradeImport/importedAchievementCalculations';
import type { MediaConfirmation } from '../../../planner/gradeImport/mediaConfirmation';
import type { OfficialMediaAchievement } from '../../../planner/gradeImport/officialMediaAchievements';
import FuturePlanNotice from '../planning/FuturePlanNotice';
import CommittedInput from '../common/CommittedInput';
import { planningTermLabel } from '../../../planner/planning/futurePlanning';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { addAssessment, assessmentLabel, completeVideosThroughLesson, mediaPlanItems, mediaProgressSummary, mediaShareViewModel, progressFor, removeAssessment, setTotalLessons, toggleLesson, updateAssessment, type ImportedMediaShareItem } from '../../../planner/progress/mediaSchooling';
import type { MediaAssessment, MediaCourseProgress, Offering, PlannerItem } from '../../../planner/plannerCatalog';
import MediaProgressShareModal from './MediaProgressShareModal';
import type { ImportedManagedMedia, ImportedMediaAchievement, ImportedMediaPending } from '../../../planner/gradeImport/importedAchievementCalculations';

export type PersonalMediaStartOption = {
  sourceCourseId: string;
  rawName: string;
  offering: Offering | null;
  status: 'new' | 'existing' | 'hold';
  reason: string;
  existingItem?: PlannerItem;
};
export type PersonalMediaStartRequest = {
  sourceCourseId: string;
  offeringId: string;
  plannedYear: number;
  reviewedRaw: string;
  reviewedRoute: string;
};

type Props = {
  items: PlannerItem[];
  offerings: Map<string, Offering>;
  progress: Record<string, MediaCourseProgress>;
  officialAchievements?: OfficialMediaAchievement[];
  importedAchievements: (ImportedMediaAchievement & { canConfirmOffering?: boolean })[];
  importedManaged: ImportedManagedMedia[];
  heldOfferingIds?: ReadonlySet<string>;
  legacyProgressReviews?: readonly LegacyProgressReview[];
  authorityGeneration?: string;
  onClaimLegacyProgress?: (review: LegacyProgressReview, raw: string, stillConfirmed: () => boolean) => Promise<boolean>;
  independentRows?: ReturnType<typeof independentImportedMedia>;
  heldIndependentRecordIds?: readonly string[];
  independentProgress?: Record<string, IndependentProgress>;
  needsIndependentUpgrade?: boolean;
  onExportUpgradeBackup?: () => Promise<void>;
  onIndependentChange?: (sourceId: string, recordId: string, progress: IndependentProgress, approveV3: boolean) => Promise<boolean>;
  importedPending: (ImportedMediaPending & { canConfirmOffering: boolean })[];
  partialEarnedSourceIds: ReadonlySet<string>;
  personalStartOptions: PersonalMediaStartOption[];
  onStartPersonalMedia: (request: PersonalMediaStartRequest) => Promise<boolean>;
  routeKey: string;
  savedRaw: string | null;
  onResolveImportedMedia: (request: MediaConfirmation) => void;
  disabled: boolean;
  onChange: (offeringId: string, progress: MediaCourseProgress, sourceCourseId: string | null) => void | boolean | Promise<void | boolean>;
};

const statusLabels: Record<PlannerItem['status'], string> = { planned: '計画中', in_progress: '履修中', waiting: '結果待ち', earned: '修得済み', failed: '不合格', dropped: '取りやめ' };

const noHeldOfferings: ReadonlySet<string> = new Set();

const partialEarnedNotice = '要確認：成績表の修得単位と現在の履修回・メディア進捗の対応は確認できません。この成績行から進捗編集を自動生成しません。保存済みの本人計画がある場合は、その進捗欄を確認してください。';

function OfficialMediaHistory({ achievements, partialEarnedSourceIds }: { achievements: OfficialMediaAchievement[]; partialEarnedSourceIds: Props['partialEarnedSourceIds'] }) {
  const identities = { curriculum_only: '保存済みカリキュラム照合あり / 制度科目・本人適用は要確認 / 卒業算入は別途判定', ambiguous: '制度科目は複数候補・要確認 / 卒業算入は保留', unmatched: '制度科目は未照合 / 卒業算入は保留', unverified: '制度科目の照合根拠は未確認 / 卒業算入は保留', conflict: '制度科目の照合情報に矛盾・要確認 / 卒業算入は保留' };
  return <section className="border border-emerald-200 bg-emerald-50 p-4" aria-label="成績表由来のメディア記録">
    <h3 className="font-medium text-[#002255]">成績表由来のメディア記録 — {achievements.length}件</h3>
    <p className="mt-1 text-xs text-gray-600">期欄の原表記から表示しています。科目行の修得単位はメディア分の単位数や卒業算入単位ではありません。進捗・修得状態は変更しません。</p>
    <ul className="mt-3 space-y-2 text-sm">{achievements.map(row => <li key={row.sourceCourseId} data-official-media-id={row.sourceCourseId} className="min-w-0 break-words border border-emerald-100 bg-white p-3">
      <p className="font-medium">{row.rawName}</p>
      <p className="mt-1">メディア（成績表由来） / 科目行の修得単位: {row.earnedCreditsTotal === null ? '不明' : `${row.earnedCreditsTotal}単位`}</p>
      <p className="mt-1 text-xs">{identities[row.identity]}</p>
      {partialEarnedSourceIds.has(row.sourceCourseId) && <p className="mt-2 text-xs text-amber-900" role="note">{partialEarnedNotice}</p>}
      {row.records.map(record => <p key={record.id} className="mt-1 text-xs text-gray-600">原年度: {record.rawYear || '未記録'} / 原期: {record.rawTerm} / 原評価: {record.grade || '未記録'}</p>)}
    </li>)}</ul>
  </section>;
}

function CompatibilityMediaHistory({ importedAchievements, partialEarnedSourceIds, savedRaw, disabled, onResolveImportedMedia }:
  Pick<Props, 'importedAchievements' | 'partialEarnedSourceIds' | 'savedRaw' | 'disabled' | 'onResolveImportedMedia'>) {
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
        {partialEarnedSourceIds.has(history.sourceCourseId) && <p className="mt-2 text-xs text-amber-900" role="note">{partialEarnedNotice}</p>}
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

function CourseCard<T extends IndependentProgress>({ item, offering, source, saved, disabled, onChange }: {
  item?: PlannerItem; offering?: Offering;
  source?: { recordId: string; name: string; caption: string };
  saved: T; disabled: boolean; onChange: (progress: T) => ReturnType<Props['onChange']>;
}) {
  const name = source?.name ?? offering?.name ?? '';
  const [lessonsExpanded, setLessonsExpanded] = useState(false);
  const lessonsId = useId();
  const [error, setError] = useState('');
  const [totalEpoch, setTotalEpoch] = useState(0);
  const totalInput = useRef<HTMLInputElement>(null);
  const summary = mediaProgressSummary(saved);
  const saveTotal = (raw: string) => {
    const value = raw.trim() === '' ? null : Number(raw);
    if (source && value === null) throw new Error('本人進捗を記録するには全回数が必要です。');
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 200)) throw new Error('全回数は1〜200の整数で入力してください。');
    const next = setTotalLessons(saved, value);
    if (next === null) throw new Error('完了済みの回があるため、その回より小さくは設定できません。');
    setError(''); return onChange(next);
  };
  const chooseTotal = async (totalLessons: number) => {
    const next = setTotalLessons(saved, totalLessons);
    if (next === null) { setError('完了済みの回があるため、その回より小さくは設定できません。'); return; }
    setError(''); const result = await onChange(next);
    if (result !== false) setTotalEpoch(epoch => epoch + 1);
  };
  const addNewAssessment = () => {
    const assessment: MediaAssessment = { id: crypto.randomUUID(), type: 'midterm', label: '中間試験', scheduledDate: null, completed: false };
    onChange(addAssessment(saved, assessment));
  };
  const changeVideo = (lesson: number, checked: boolean) => {
    const next = checked
      ? completeVideosThroughLesson(saved, lesson)
      : toggleLesson(saved, lesson, 'videoCompleted');
    if (next !== null) onChange(next);
  };
  return <article data-media-offering-id={item?.offeringId} data-media-source-record={source?.recordId} tabIndex={-1} className="border border-gray-200 bg-white p-4 sm:p-6 min-w-0">
    <h3 className="font-medium text-lg break-words text-[#002255]">{name}</h3>
    {item && offering ? <>
      <p className="mt-1 text-sm text-gray-600">{item.plannedYear === null ? '年度未設定' : `${item.plannedYear}年度`} / {planningTermLabel(item, offering)} / {statusLabels[item.status]}</p>
      <FuturePlanNotice item={item} offering={offering} />
    </> : <p className="mt-1 text-sm text-gray-600">{source?.caption}</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="block text-sm">全回数
        <CommittedInput key={totalEpoch} inputRef={totalInput} aria-label={`${name}の全回数`} inputMode="numeric" value={saved.totalLessons?.toString() ?? ''} disabled={disabled} onCommit={saveTotal} saveLabel="保存" placeholder="未設定" className="mt-1 w-full border border-gray-300 rounded-sm p-2 disabled:opacity-50" />
      </label>
    </div>
    <div className="mt-2 flex flex-wrap gap-2 text-sm"><span className="self-center text-gray-600">よくある回数:</span><button type="button" disabled={disabled} data-replaces-draft="true" onClick={() => chooseTotal(14)} className="planner-button border border-gray-300 px-3 py-1 disabled:opacity-50">14回</button><button type="button" disabled={disabled} data-replaces-draft="true" onClick={() => chooseTotal(15)} className="planner-button border border-gray-300 px-3 py-1 disabled:opacity-50">15回</button><button type="button" disabled={disabled} data-replaces-draft="true" onClick={() => { totalInput.current?.focus(); totalInput.current?.select(); }} className="planner-button border border-gray-300 px-3 py-1 disabled:opacity-50">その他</button><span className="self-center text-xs text-gray-500">その他は上の入力欄に回数を入力</span></div>
    {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    <div className="mt-4 grid grid-cols-3 gap-2 text-sm"><p>動画 {saved.totalLessons === null ? `${summary.video}/—` : `${summary.video}/${saved.totalLessons}`}</p><p>テスト {saved.totalLessons === null ? `${summary.test}/—` : `${summary.test}/${saved.totalLessons}`}</p><p>総合 {summary.percent === null ? '—' : `${summary.percent}%`}</p></div>
    <div className="mt-2 h-2 bg-gray-100" aria-label={`総合進捗 ${summary.percent === null ? '未設定' : `${summary.percent}%`}`}><div className="h-full bg-[#E65C00]" style={{ width: `${summary.percent ?? 0}%` }} /></div>
    <p className="mt-2 text-sm text-gray-600">各回の動画・テスト：{saved.totalLessons === null ? '全回数未設定（完了判定なし）' : summary.video < saved.totalLessons || summary.test < saved.totalLessons ? '未完了あり' : 'すべて完了'}</p>
    {saved.totalLessons === null ? <p className="mt-5 text-sm text-gray-600">全回数を設定すると、各回の動画とテストの進捗を記録できます。</p> : <>
      <button type="button" aria-expanded={lessonsExpanded} aria-controls={lessonsId} aria-label={`${name}の各回一覧を${lessonsExpanded ? '折りたたむ' : '表示'}`} onClick={() => setLessonsExpanded(expanded => !expanded)} className="planner-button mt-4 border border-[#002255] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002255]">各回一覧を{lessonsExpanded ? '折りたたむ' : '表示'}</button>
      <div id={lessonsId} hidden={!lessonsExpanded}>
      <p className="mt-5 text-xs text-gray-600">動画にチェックを入れると、その回まで一括で視聴済みになります。外す場合はその回のみ解除されます。</p>
      <div className="mt-3 space-y-2">
      {Array.from({ length: saved.totalLessons }, (_, index) => index + 1).map(lesson => {
        const entry = saved.lessons.find(current => current.lesson === lesson);
        return <div key={lesson} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-gray-100 pt-2 text-sm"><span>第{lesson}回</span>
          <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={entry?.videoCompleted ?? false} disabled={disabled} onChange={event => changeVideo(lesson, event.target.checked)} />動画</label>
          <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={entry?.testCompleted ?? false} disabled={disabled} onChange={() => onChange(toggleLesson(saved, lesson, 'testCompleted'))} />テスト</label>
        </div>;
      })}
      </div>
      </div>
    </>}
    <section className="mt-6 border-t border-gray-200 pt-4" aria-label={`${name}の試験・評価予定`}>
      <p className="mb-2 text-xs text-gray-600">名称・全回数・予定日は、入力欄を離れるかEnterキーで確定して保存します。</p>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-medium text-[#002255]">試験・評価予定</h4><p className="mt-1 text-xs text-gray-600">試験の有無・方式・日程は科目ごとに異なります。最新の「法政通信」を確認してください。</p></div><button type="button" disabled={disabled || (!!source && saved.totalLessons === null)} onClick={addNewAssessment} className="planner-button border border-[#002255] px-3 py-2 text-sm disabled:opacity-50">試験を追加</button></div>
      {(saved.assessments ?? []).length > 0 && <div className="mt-3 space-y-3">{(saved.assessments ?? []).map(assessment => <div key={assessment.id} className="grid gap-2 border border-gray-200 bg-slate-50 p-3 sm:grid-cols-[9rem_minmax(0,1fr)_10rem_auto] sm:items-end">
        <label className="text-xs">種類<select value={assessment.type} disabled={disabled} onChange={event => { const type = event.target.value as MediaAssessment['type']; onChange(updateAssessment(saved, assessment.id, { type, label: type === 'midterm' ? '中間試験' : type === 'final' ? '期末試験' : assessment.label || 'その他の試験' })); }} className="mt-1 w-full border border-gray-300 bg-white p-2 text-sm"><option value="midterm">中間試験</option><option value="final">期末試験</option><option value="other">その他</option></select></label>
        {assessment.type === 'other' ? <label className="text-xs">名称<CommittedInput aria-label="試験・評価予定の名称" value={assessment.label} maxLength={200} disabled={disabled} normalize={raw => raw.trim() ? raw : 'その他の試験'} onCommit={label => onChange(updateAssessment(saved, assessment.id, { label }))} className="mt-1 w-full border border-gray-300 bg-white p-2 text-sm" /></label> : <p className="pb-2 text-sm">{assessmentLabel(assessment)}</p>}
        <label className="text-xs">予定日<CommittedInput type="date" value={assessment.scheduledDate ?? ''} disabled={disabled} onCommit={raw => onChange(updateAssessment(saved, assessment.id, { scheduledDate: raw || null }))} className="mt-1 w-full border border-gray-300 bg-white p-2 text-sm" /></label>
        <div className="flex items-center justify-between gap-3 pb-2"><label className="flex items-center gap-1 whitespace-nowrap text-sm"><input type="checkbox" checked={assessment.completed} disabled={disabled} onChange={() => onChange(updateAssessment(saved, assessment.id, { completed: !assessment.completed }))} />実施済み</label><button type="button" disabled={disabled} onClick={() => onChange(removeAssessment(saved, assessment.id))} className="text-sm text-red-700 underline disabled:opacity-50">削除</button></div>
      </div>)}</div>}
    </section>
  </article>;
}

function PersonalMediaStartRow({ option, savedRaw, routeKey, disabled, onStart }: { option: PersonalMediaStartOption; savedRaw: string | null; routeKey: string; disabled: boolean; onStart: Props['onStartPersonalMedia'] }) {
  const [open, setOpen] = useState(false);
  const [reviewedRaw, setReviewedRaw] = useState<string | null>(null);
  const [reviewedRoute, setReviewedRoute] = useState('');
  const [year, setYear] = useState('');
  const [selectedOffering, setSelectedOffering] = useState('');
  const [attempt, setAttempt] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const offering = option.offering;
  const stale = open && (reviewedRaw !== savedRaw || reviewedRoute !== routeKey);
  const validYear = /^[0-9]{4}$/.test(year) && Number(year) >= 1000 && Number(year) <= 9999;
  const ready = option.status === 'new' && offering && reviewedRaw !== null && !stale && validYear
    && selectedOffering === offering.id && attempt === 'new' && acknowledged;
  const openEditor = () => {
    if (!offering) return;
    const card = [...document.querySelectorAll<HTMLElement>('[data-media-offering-id]')]
      .find(element => element.dataset.mediaOfferingId === offering.id);
    card?.scrollIntoView({ block: 'center' });
    card?.focus({ preventScroll: true });
  };
  return <li className="border border-amber-200 bg-white p-4 text-sm" data-media-start-source-id={option.sourceCourseId}>
    <p className="font-medium text-[#002255]">{option.rawName}</p>
    <p className="mt-1">{option.reason}</p>
    {option.status === 'existing' && <button type="button" className="planner-button mt-2 border px-3 py-2" onClick={openEditor}>既存の本人計画を見る</button>}
    {option.status === 'new' && !open && <button type="button" disabled={disabled} className="planner-button mt-2 border px-3 py-2 disabled:opacity-50" onClick={() => {
      setReviewedRaw(savedRaw); setReviewedRoute(routeKey); setYear(''); setSelectedOffering(''); setAttempt(''); setAcknowledged(false); setOpen(true);
    }}>この科目の進捗を記録する</button>}
    {option.status === 'new' && open && offering && <form className="mt-3 space-y-3" onSubmit={async event => {
      event.preventDefault();
      if (!ready || pending || disabled || !reviewedRaw) return;
      setPending(true);
      try {
        const saved = await onStart({ sourceCourseId: option.sourceCourseId, offeringId: offering.id, plannedYear: Number(year), reviewedRaw, reviewedRoute });
        if (saved) setOpen(false);
      } finally { setPending(false); }
    }}>
      <p>2026年度収録データの開講情報と、本人が計画する年度は別です。成績表の行を本人計画と同じ履修回だと確定しません。</p>
      <label className="block">本人の計画年度
        <input aria-label={`${option.rawName}の本人計画年度`} value={year} onChange={event => setYear(event.target.value)} inputMode="numeric" maxLength={4} disabled={disabled || pending} className="mt-1 block w-32 border p-2" placeholder="例：2026" />
      </label>
      <label className="block">方式・期を確認
        <select aria-label={`${option.rawName}の方式・期`} value={selectedOffering} onChange={event => setSelectedOffering(event.target.value)} disabled={disabled || pending} className="mt-1 block max-w-full border p-2">
          <option value="">選択してください</option>
          <option value={offering.id}>{offering.name} / {offering.deliveryCategory} / {offering.period}（2026年度収録）</option>
        </select>
      </label>
      <label className="block">本人が記録する履修回
        <select aria-label={`${option.rawName}の本人履修回`} value={attempt} onChange={event => setAttempt(event.target.value)} disabled={disabled || pending} className="mt-1 block max-w-full border p-2">
          <option value="">選択してください</option>
          <option value="new">このOfferingの本人計画を新規に1件作る</option>
          <option value="other">別の履修回・反復履修を記録したい（この保存形式では未対応）</option>
        </select>
      </label>
      {attempt === 'other' && <p role="note" className="text-amber-900">別履修回はこの画面では保存できません。既存の本人記録を上書きしません。</p>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={disabled || pending} />公式成績との同一履修回を確認した扱いにせず、本人計画として保存する</label>
      {stale && <p role="alert" className="text-red-700">保存原文が変わりました。新しい内容を確認してからやり直してください。</p>}
      <div className="flex gap-2"><button type="submit" disabled={!ready || pending || disabled} className="planner-button border px-3 py-2 disabled:opacity-50">本人計画を追加して保存</button><button type="button" disabled={pending} onClick={() => setOpen(false)} className="planner-button border px-3 py-2">キャンセル</button></div>
    </form>}
  </li>;
}

function LegacyProgressClaim({ review, savedRaw, disabled, onClaim }: {
  review: LegacyProgressReview;
  savedRaw: string;
  disabled: boolean;
  onClaim: NonNullable<Props['onClaimLegacyProgress']>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const revision = useRef(0);
  useLayoutEffect(() => () => { ++revision.current; }, [savedRaw]);
  return <>
    <p className="text-sm">引継ぎ先：{review.year}年度
      {review.imported ? '・' + review.imported.term + 'の成績取込の本人詳細回' : 'の本人履修計画'}。旧進捗の原文は保持します。</p>
    <label className="block text-sm">
      <input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => {
        ++revision.current;
        setConfirmed(event.target.checked);
      }} />{' '}
      科目・年度・旧進捗を確認し、この履修回へ引き継ぐ。保存形式は{review.imported ? 'v5' : 'v4以上'}になり、以前の版では編集できなくなります。
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || !confirmed} className="border p-2 text-sm disabled:opacity-50" onClick={() => {
        const intent = revision.current;
        void onClaim(review, savedRaw, () => revision.current === intent);
      }}>旧進捗の引継ぎを確定</button>
      {confirmed && <button type="button" className="border p-2 text-sm" onClick={() => {
        ++revision.current;
        setConfirmed(false);
      }}>引継ぎを取り消す</button>}
    </div>
  </>;
}

export default function MediaSchoolingProgress({ items, offerings, progress, officialAchievements = [], importedAchievements, importedManaged, heldOfferingIds = noHeldOfferings, legacyProgressReviews = [], authorityGeneration, onClaimLegacyProgress, independentRows = [], heldIndependentRecordIds = [], independentProgress = {}, needsIndependentUpgrade = false, onExportUpgradeBackup, onIndependentChange, importedPending, partialEarnedSourceIds, personalStartOptions = [], onStartPersonalMedia, routeKey, savedRaw, disabled, onChange, onResolveImportedMedia }: Props) {
  const legacyReviewById = new Map(legacyProgressReviews.map(review => [review.offeringId, review]));
  const availableItems = items.filter(item => !heldOfferingIds.has(item.offeringId));
  const mediaItems = mediaPlanItems(availableItems, offerings);
  const plannerOfferingIds = new Set(mediaItems.map(item => item.offeringId));
  const uniqueImportedManaged = importedManaged.filter(achievement => !heldOfferingIds.has(achievement.offering.id) && !plannerOfferingIds.has(achievement.offering.id));
  const importedShareItems: ImportedMediaShareItem[] = uniqueImportedManaged.map(achievement => ({ offering: achievement.offering, name: achievement.rawName }));
  const [isSharing, setIsSharing] = useState(false);
  const [approvedRaw, setApprovedRaw] = useState<string | null>(null);
  const approveV3 = savedRaw !== null && approvedRaw === savedRaw;
  const heldIndependent = new Set(heldIndependentRecordIds);
  const visibleIndependentRows = independentRows.filter(({ record }) =>
    !heldIndependent.has(record.id) || Boolean(independentProgress[record.id]));
  const independentShareItems = visibleIndependentRows.flatMap(({ row, record }) => {
    const saved = independentProgress[record.id];
    if (!saved || heldIndependent.has(record.id)) return [];
    const term = record.rawTerm?.normalize('NFKC').replace(/\s/g, '');
    const deliveryCategory: '前期メディア' | '後期メディア' | '履修期未設定' =
      term === '前期メディア' || term === '後期メディア' ? term : '履修期未設定';
    return [{
      name: record.rawYear ? `${row.rawName}（原年度 ${record.rawYear}）` : row.rawName,
      deliveryCategory,
      progress: saved,
    }];
  });
  const shareGroups = mediaShareViewModel(availableItems, offerings, progress, importedShareItems, independentShareItems);
  if (heldOfferingIds.size === 0 && officialAchievements.length === 0 && mediaItems.length === 0 && importedManaged.length === 0 && importedAchievements.length === 0 && importedPending.length === 0 && personalStartOptions.length === 0 && visibleIndependentRows.length === 0 && heldIndependent.size === 0) return <section aria-labelledby="media-heading" className="bg-white border border-gray-200 p-5 sm:p-7"><h2 id="media-heading" className="text-xl text-[#002255]">メディアスクーリング</h2><p className="mt-4 text-sm text-gray-600">年間履修計画にメディアスクーリング科目を追加すると、ここで進捗を管理できます。</p></section>;
  return <section aria-labelledby="media-heading" className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="media-heading" className="text-xl text-[#002255]">メディアスクーリング <span className="text-sm">進捗管理 {mediaItems.length + uniqueImportedManaged.length + visibleIndependentRows.length}件</span></h2><p className="mt-2 text-sm text-gray-600">動画と視聴後テストの進捗を記録します。成績・単位取得の状態は変更しません。</p></div>{shareGroups.length > 0 && <button type="button" onClick={() => setIsSharing(true)} className="planner-button planner-button--navy border border-[#002255] bg-[#002255] px-3 py-2 text-sm text-white">全科目を共有</button>}</div>{mediaItems.map(item => <CourseCard key={item.offeringId} item={item} offering={offerings.get(item.offeringId)!} saved={progressFor(item.offeringId, progress)} disabled={disabled} onChange={value => onChange(item.offeringId, value, null)} />)}{uniqueImportedManaged.length > 0 && <section className="space-y-3"><div className="border border-blue-200 bg-blue-50 p-4"><h3 className="font-medium text-[#002255]">成績表から取り込んだ履修中のメディア</h3><p className="mt-1 text-xs text-gray-600">成績表の元データは変更せず、ユーザー管理の履修状態に紐づけて進捗を記録します。</p></div>{uniqueImportedManaged.map(achievement => <CourseCard key={`imported:${achievement.sourceCourseId}`} item={{ offeringId: achievement.offering.id, status: achievement.meta.lifecycleStatus!, plannedYear: achievement.meta.plannedYear, plannedTerm: achievement.meta.plannedTerm, studyYear: achievement.meta.studyYear, earnedOrder: null }} offering={{ ...achievement.offering, name: achievement.rawName }} saved={progressFor(achievement.offering.id, progress)} disabled={disabled} onChange={value => onChange(achievement.offering.id, value, achievement.sourceCourseId)} />)}</section>}
    {visibleIndependentRows.length > 0 && onIndependentChange && <section className="space-y-3" aria-label="成績表の行ごとの本人メディア進捗">
      <h3 className="text-[#002255] font-medium">成績表の行ごとの本人メディア進捗</h3>
      <p className="text-sm">本人の進捗は成績表と別に保存します。開講照合や単位算入は変わりません。</p>
      {needsIndependentUpgrade && <div className="rounded border border-amber-300 p-3 text-sm">
        <p>以前の保存データがあります。進捗を記録する前にバックアップを保存できます。</p>
        {onExportUpgradeBackup && <button type="button" disabled={disabled} className="planner-button my-2 border px-3 py-2"
          onClick={() => void onExportUpgradeBackup()}>更新前のバックアップを保存</button>}
        <label className="block">
          <input type="checkbox" checked={approveV3} disabled={disabled} onChange={event => setApprovedRaw(event.target.checked ? savedRaw : null)} />{' '}
          保存形式を更新して進捗を記録する（以前の版では編集できなくなります）
        </label>
      </div>}
      {visibleIndependentRows.map(({ row, record }) => <CourseCard key={record.id}
        source={{ recordId: record.id, name: row.rawName, caption: `${record.rawYear ?? '原年度未設定'} / ${record.rawTerm ?? '原期未設定'} / ${heldIndependent.has(record.id) ? '旧進捗との対応確認待ち' : '履修中'}` }}
        saved={independentProgress[record.id] ?? { totalLessons: null, lessons: [], assessments: [] }}
        disabled={disabled || heldIndependent.has(record.id) || (needsIndependentUpgrade && !approveV3)}
        onChange={progress => onIndependentChange(row.id, record.id, progress, approveV3)} />)}
    </section>}
    {independentRows.some(({ record }) => heldIndependent.has(record.id) && !independentProgress[record.id]) &&
      <p role="status" className="border border-amber-300 bg-amber-50 p-3 text-sm">以前の進捗との対応を確認できない履修回があります。元の記録を保持し、その履修回の編集を保留しています。</p>}
    {heldOfferingIds.size > 0 && <section aria-label="編集を保留したメディア進捗" className="space-y-2 border border-amber-300 bg-amber-50 p-4">
      <h3 className="font-medium text-[#002255]">編集を保留したメディア進捗</h3>
      <p className="text-sm">確認が必要な進捗です。公式履歴と保存済み進捗は保持しています。</p>
      {[...heldOfferingIds].sort().map(id => {
        const review = legacyReviewById.get(id);
        const saved = progress[id];
        const summary = saved && mediaProgressSummary(saved);
        return <article key={id} data-media-held-offering-id={id} className="break-words border bg-white p-3">
          <h4>{offerings.get(id)?.name}</h4>
          {saved && summary ? <div className="mt-1 text-sm">
            <p>保存済み（履修回未確定） 動画 {summary.video}/{saved.totalLessons ?? '—'} ／ テスト {summary.test}/{saved.totalLessons ?? '—'}</p>
            {saved.assessments?.map(assessment => <p key={assessment.id}>{assessmentLabel(assessment)} {assessment.scheduledDate ?? '予定日未設定'} ／ {assessment.completed ? '完了' : '未完了'}</p>)}
          </div> : <p className="text-sm">保存済み進捗なし</p>}
          {review && savedRaw !== null && onClaimLegacyProgress
            ? <LegacyProgressClaim key={authorityGeneration} review={review} savedRaw={savedRaw} disabled={disabled} onClaim={onClaimLegacyProgress} />
            : <p className="text-sm">履修回が未確定、または複数の記録が競合しています。確認できるまで編集を保留します。</p>}
        </article>;
      })}
    </section>}{importedPending.length > 0 && <details className="border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer font-medium text-[#002255]">スクーリング方式・期の確認（必要な場合のみ）</summary>
      <p className="mt-2 text-sm text-gray-600">方式や履修期がはっきりしない記録です。元の履修回を確認できる場合にだけ照合先を選んでください。</p>
      {importedPending.map(row => <PendingMediaRow key={JSON.stringify([row.sourceCourseId, ...row.candidates.map(candidate => candidate.id)])}
        row={row} savedRaw={savedRaw} disabled={disabled} onResolveImportedMedia={onResolveImportedMedia} />)}
    </details>}{officialAchievements.length > 0 && <OfficialMediaHistory achievements={officialAchievements} partialEarnedSourceIds={partialEarnedSourceIds} />}{importedAchievements.length > 0 && <CompatibilityMediaHistory importedAchievements={importedAchievements} partialEarnedSourceIds={partialEarnedSourceIds} savedRaw={savedRaw} disabled={disabled} onResolveImportedMedia={onResolveImportedMedia} />}{personalStartOptions.length > 0 && <section aria-label="成績表から本人メディア計画を始める" className="border border-amber-200 bg-amber-50 p-4"><h3 className="font-medium text-[#002255]">成績表から本人メディア計画を始める</h3><p className="mt-1 text-xs">この操作は公式成績と同じ履修回を結び付けません。本人の記録を別に作ります。</p><ul className="mt-3 space-y-3">{personalStartOptions.map(option => <PersonalMediaStartRow key={option.sourceCourseId} option={option} savedRaw={savedRaw} routeKey={routeKey} disabled={disabled} onStart={onStartPersonalMedia} />)}</ul></section>}{isSharing && <MediaProgressShareModal groups={shareGroups} onClose={() => setIsSharing(false)} />}</section>;
}
