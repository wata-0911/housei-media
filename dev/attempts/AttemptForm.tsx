import { nullableText, preventImeSubmit, text } from './formHelpers';
import { useRef, useState } from 'react';
import type { Attempt, AttemptValidationContext } from '../../src/planner/attempts/types';
import { courseChoices, makeAttempt, optionalNumber, placementChoices } from '../../src/planner/attempts/workbench/catalogView';
import { newAttemptIds, newOperationId, type Command } from '../../src/planner/attempts/workbench/operations';
import { buttonClass, Field, inputClass } from './Fields';
import type { InstitutionalSearchRow } from '../../src/planner/institutional/search';
import { makeSearchAttempt } from '../../src/planner/attempts/workbench/searchBridge';
import { PlacementSearch } from './PlacementSearch';

const statuses = { planned: '予定', in_progress: '履修中', waiting: '結果待ち', earned: '修得', failed: '不合格', dropped: '中止' };
const methods = { unknown: '未定', correspondence: '通信', schooling: 'スクーリング', media: 'メディア' };
export function AttemptForm({ context, attempt, submit, close, searchEnabled = false }: { searchEnabled?: boolean; context: AttemptValidationContext; attempt?: Attempt; submit: (command: Command) => boolean; close: () => void }) {
  const [query, setQuery] = useState(''), [courseId, setCourseId] = useState(''), [placementId, setPlacementId] = useState('');
  const [selection, setSelection] = useState<InstitutionalSearchRow | null>(null);
  const [error, setError] = useState('');
  const [contributionMode, setContributionMode] = useState(attempt?.plan?.contribution ? attempt.plan.contribution.value === null ? 'null' : 'number' : 'unset');
  // A successful request stays fixed until the form is closed. Failed validation keeps the draft.
  const request = useRef<Command | null>(null);
  const [creationIds] = useState(newAttemptIds);
  const [editOperationId] = useState(newOperationId);
  const course = context.catalog.institutionalCourses.find(c => c.id === courseId);
  const placements = placementChoices(context.catalog, courseId || null);
  return <form aria-label={attempt ? 'Attempt編集' : '新規履修回'} className="space-y-4 rounded-xl border border-indigo-200 bg-white p-4" onKeyDown={preventImeSubmit} onSubmit={e => {
    e.preventDefault();
    try {
      const data = new FormData(e.currentTarget);
      const plan = { ...attempt?.plan, status: text(data, 'status') as NonNullable<Attempt['plan']>['status'],
        plannedYear: optionalNumber(text(data, 'year')), plannedTerm: nullableText(data, 'term', attempt?.plan?.plannedTerm),
        studyYear: optionalNumber(text(data, 'studyYear')) as NonNullable<Attempt['plan']>['studyYear'], earnedOrder: optionalNumber(text(data, 'earnedOrder')) };
      delete plan.contribution;
      if (contributionMode !== 'unset') {
        const value = contributionMode === 'null' ? null : optionalNumber(text(data, 'credits'));
        if (contributionMode === 'number' && value === null) throw new Error('寄与単位の数値を入力してください');
        plan.contribution = { value, source: 'learner', note: nullableText(data, 'creditNote', attempt?.plan?.contribution?.note) };
      }
      const value = text(data, 'method') as Attempt['method']['value'];
      const note = text(data, 'note');
      const oldNote = attempt?.method.evidence?.kind === 'learner' ? attempt.method.evidence.note : '';
      const command: Command = request.current ?? (attempt ? { kind: 'edit', operationId: editOperationId, attemptId: attempt.id, changes: {
        plan, method: attempt.method.value === value && oldNote === note ? attempt.method : { value, source: 'learner', evidence: { kind: 'learner', note: note || '本人希望（公式実績ではない）' } },
      } } : (() => {
        const created = selection ? makeSearchAttempt(context.catalog, selection, { plan, method: value, note }, creationIds)
          : makeAttempt(context.catalog, { title: course?.officialName ?? text(data, 'title'), courseId: courseId || null, placementId: placementId || null, plan, method: value, note }, creationIds);
        return { kind: 'add' as const, operationId: created.creationOperationId, attempt: created };
      })());
      if (submit(command)) { request.current = command; close(); }
    } catch (err) { setError(String(err)); }
  }}>
    <h3 className="text-lg font-semibold">{attempt ? `${attempt.originalTitle} の予定を編集` : '新しい履修回を追加'}</h3>
    {!attempt && <>
      {searchEnabled ? <PlacementSearch catalog={context.catalog} selection={selection} select={setSelection} /> : <>
        <Field label="制度科目を検索"><input className={inputClass} value={query} onChange={e => setQuery(e.target.value)} placeholder="正式名称で検索" /></Field>
        <Field label="制度科目"><select className={inputClass} value={courseId} onChange={e => { setCourseId(e.target.value); setPlacementId(''); }}><option value="">未確定 identity (unknown)</option>{courseChoices(context.catalog, query).map(c => <option key={c.id} value={c.id}>{c.officialName} / {c.id}</option>)}</select></Field>
        {!courseId && <Field label="未確定科目の名称"><input className={inputClass} name="title" required /></Field>}
        <Field label="Placement候補"><select className={inputClass} value={placementId} onChange={e => setPlacementId(e.target.value)}><option value="">未選択・本人適用未確認</option>{placements.map(p => <option key={p.id} value={p.id}>{p.officialName} / {context.catalog.scopes.find(s => s.id === p.scopeId)?.officialScopeLabel ?? p.scopeId} / 構成 {p.compositionCredits ?? '不明'}単位 / {p.identityDecision.status} / {p.id}</option>)}</select></Field>
      </>}
      {searchEnabled && !selection && <Field label="未確定科目の名称"><input className={inputClass} name="title" required /></Field>}
    </>}
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="予定年度"><input className={inputClass} name="year" inputMode="numeric" defaultValue={attempt?.plan?.plannedYear ?? ''} placeholder="例: 2030" /></Field>
      <Field label="希望時期"><input className={inputClass} name="term" defaultValue={attempt?.plan?.plannedTerm ?? ''} /></Field>
      <Field label="履修学年"><input className={inputClass} name="studyYear" inputMode="numeric" defaultValue={attempt?.plan?.studyYear ?? ''} placeholder="1〜4・空欄は不明" /></Field>
      <Field label="本人確認の修得順"><input className={inputClass} name="earnedOrder" inputMode="numeric" defaultValue={attempt?.plan?.earnedOrder ?? ''} placeholder="空欄は不明" /></Field>
      <Field label="履修方法（本人希望）"><select className={inputClass} name="method" defaultValue={attempt?.method.value ?? 'unknown'}>{Object.entries(methods).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="履修ステータス"><select className={inputClass} name="status" defaultValue={attempt?.plan?.status ?? 'planned'}>{Object.entries(statuses).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="本人寄与単位の入力状態"><select className={inputClass} value={contributionMode} onChange={e => setContributionMode(e.target.value)}><option value="unset">未設定（fieldなし）</option><option value="null">不明 (null)</option><option value="number">数値を明示（0を含む）</option></select></Field>
      {contributionMode === 'number' && <Field label="本人入力の寄与単位"><input className={inputClass} name="credits" inputMode="decimal" defaultValue={attempt?.plan?.contribution?.value ?? ''} required /></Field>}
      {contributionMode !== 'unset' && <Field label="寄与単位の根拠・メモ"><input className={inputClass} name="creditNote" defaultValue={attempt?.plan?.contribution?.note ?? ''} /></Field>}
      <Field label="方式の根拠・メモ"><input className={inputClass} name="note" defaultValue={attempt?.method.evidence?.kind === 'learner' ? attempt.method.evidence.note : ''} /></Field>
    </div>
    <p className="text-sm text-slate-600">予定と実績年度は別です。評価・単位完成・修得順は自動同期しません。開講・反復履修・履修資格は大学の案内で確認してください。</p>
    {error && <p role="alert" className="whitespace-pre-wrap text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2"><button className={buttonClass}>{attempt ? '編集をメモリに反映' : '新規Attemptを追加'}</button><button type="button" className={buttonClass} onClick={close}>取消</button></div>
  </form>;
}
