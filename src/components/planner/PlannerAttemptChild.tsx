import { useState } from 'react';
import type { PlannerAttemptView } from '../../planner/curriculumCourseView';
import type { Offering, PlannerItem } from '../../planner/plannerCatalog';
import { offeringFormLabel, progressSummaryForOffering, statusLabels } from '../../planner/planTable';
import { progressForCorrespondence } from '../../planner/correspondenceProgress';
import { isMediaSchooling } from '../../planner/mediaSchooling';
import type { AttemptEditorProps } from './CurriculumCourseList.types';
import ClassificationLabel from './ClassificationLabel';
import { CorrespondenceDetails } from './CorrespondenceProgress';
import FuturePlanNotice from './FuturePlanNotice';
import SavedAttemptProgress from './SavedAttemptProgress';
import { CompletionOrderInput, GradeSelect, StatusSelect, StudyYearSelect, TermSelect, YearInput } from './PlannerRowControls';

type Contributions = { earnedContribution: number; projectedContribution: number; officialEarnedPreferred: boolean };
function CreditContributionInput({ item, offering, editor }: { item: PlannerItem; offering: Offering | null; editor: AttemptEditorProps }) {
  const [draft, setDraft] = useState(item.courseCreditContribution?.toString() ?? '');
  const [invalid, setInvalid] = useState(false);
  return <label className="text-xs">科目進捗への寄与単位<input aria-label="科目進捗への寄与単位" inputMode="decimal" value={draft} disabled={editor.disabled} onChange={event => { setDraft(event.target.value); setInvalid(false); }} onBlur={() => {
    const value = draft.trim();
    if (value !== '' && (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || (offering?.credits != null && Number(value) > offering.credits))) { setInvalid(true); return; }
    editor.onChange(item.offeringId, { courseCreditContribution: value === '' ? undefined : Number(value) });
  }} className="w-full rounded-sm border border-gray-300 bg-white p-2 text-sm disabled:opacity-50" />{invalid && <span className="text-red-700">0以上{offering?.credits != null && `・開講の${offering.credits}単位以下`}で入力してください。</span>}<span className="block text-gray-500">未設定は開講単位を使用</span></label>;
}

export default function PlannerAttemptChild({ attempt, editor, contributions }: { attempt: PlannerAttemptView; editor: AttemptEditorProps; contributions?: Contributions }) {
  const { plannerItem: item, offering, progress } = attempt;
  const evaluation = attempt.evaluation ?? { offeringId: item.offeringId, finalGrade: null, reportGrade: null, schoolingGrade: null };
  const correspondence = offering ? progress.correspondence ?? progressForCorrespondence(offering, {}) : null;
  return <article data-attempt-id={item.offeringId} aria-label={`履修attempt ${offering?.name ?? item.offeringId}`} className="min-w-0 rounded-sm border border-gray-200 p-4">
    <h4 className="break-words font-medium text-[#002255]">履修attempt — {offering ? `${offering.academicYear} ${offeringFormLabel(offering)} / ${offering.name}` : `開講情報なし / ${item.offeringId}`}</h4>
    {offering && <><FuturePlanNotice item={item} offering={offering} /><ClassificationLabel value={editor.classify(offering)} /></>}
    <p className="mt-2 text-sm">{statusLabels[item.status]} / 計画 {item.plannedYear === null ? '年度未設定' : `${item.plannedYear}年度`} / {item.studyYear === null ? '学年未設定' : `${item.studyYear}年`} / {item.plannedTerm ?? '時期未設定'}</p>
    <p className="mt-1 text-sm">開講 {offering?.credits ?? '未確認'}単位 / 科目進捗への寄与設定 {item.courseCreditContribution ?? '未設定'}</p>
    {contributions && <p className="mt-1 text-xs text-gray-600">{contributions.officialEarnedPreferred ? '修得単位は取込元の公式集計を優先（重複加算なし）' : `修得に加算 ${contributions.earnedContribution}単位 / 予定込みに加算 ${contributions.projectedContribution}単位`}</p>}
    {offering && <p className="mt-2 text-sm">{progressSummaryForOffering(item, offering, progress.correspondence ? { [item.offeringId]: progress.correspondence } : {}, progress.mediaSchooling ? { [item.offeringId]: progress.mediaSchooling } : {})}</p>}
    <label className="mt-3 block max-w-xs text-sm">最終評価<GradeSelect label={`${offering?.name ?? item.offeringId}の最終評価`} value={evaluation.finalGrade} disabled={editor.disabled} onChange={finalGrade => editor.onChangeEvaluation(item.offeringId, { ...evaluation, finalGrade })} /></label>
    <details className="mt-3">
      <summary className="cursor-pointer text-sm">履修attemptの詳細・編集</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs">計画年度<YearInput value={item.plannedYear} disabled={editor.disabled} onChange={plannedYear => editor.onChange(item.offeringId, { plannedYear })} /></label>
        <label className="text-xs">履修学年<StudyYearSelect value={item.studyYear} disabled={editor.disabled} onChange={studyYear => editor.onChange(item.offeringId, { studyYear })} /></label>
        <label className="text-xs">時期<TermSelect id={`attempt-term-${item.offeringId}`} value={item.plannedTerm} disabled={editor.disabled} onChange={plannedTerm => editor.onChange(item.offeringId, { plannedTerm })} /></label>
        <label className="text-xs">状態<StatusSelect value={item.status} disabled={editor.disabled} onChange={status => editor.onChange(item.offeringId, { status })} /></label>
        {offering && <CompletionOrderInput item={item} offering={offering} disabled={editor.disabled} onChange={earnedOrder => editor.onChange(item.offeringId, { earnedOrder })} />}
        {!(offering?.method === 'correspondence' && offering.credits === 4) && <CreditContributionInput item={item} offering={offering} editor={editor} />}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(offering?.method !== 'correspondence' || evaluation.reportGrade !== null) && <label className="text-sm">リポート評価（従来記録）<GradeSelect label="リポート評価（従来記録）" value={evaluation.reportGrade} disabled={editor.disabled} onChange={reportGrade => editor.onChangeEvaluation(item.offeringId, { ...evaluation, reportGrade })} /></label>}
        <label className="text-sm">スクーリング評価（従来記録）<GradeSelect label="スクーリング評価" value={evaluation.schoolingGrade} disabled={editor.disabled} onChange={schoolingGrade => editor.onChangeEvaluation(item.offeringId, { ...evaluation, schoolingGrade })} /></label>
      </div>
      {offering?.method === 'correspondence' && correspondence && <div className="mt-3"><CorrespondenceDetails item={item} offering={offering} saved={correspondence} disabled={editor.disabled} onChange={editor.onChangeCorrespondence} onChangeItem={editor.onChange} /></div>}
      {offering && isMediaSchooling(offering) && <button type="button" onClick={editor.onOpenMedia} className="mt-3 text-sm underline">メディア進捗で編集</button>}
      {(!offering || (progress.correspondence && offering.method !== 'correspondence') || (progress.mediaSchooling && !isMediaSchooling(offering))) && <SavedAttemptProgress progress={progress} />}
    </details>
    <button type="button" disabled={editor.disabled} onClick={() => editor.onRemove(item.offeringId)} className="mt-3 text-sm text-red-700 underline disabled:opacity-50">履修attemptを削除</button>
  </article>;
}
