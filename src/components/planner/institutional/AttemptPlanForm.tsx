import { useId, useRef, useState } from 'react';
import { statusLabels, methodLabels } from './planLabels';
import type { PlannerItem } from '../../../planner/plannerCatalog';
// Display/input shape only; no Attempt module or persistence API import.
type Attempt = { plan: Pick<PlannerItem, 'status' | 'plannedYear' | 'plannedTerm' | 'studyYear' | 'earnedOrder'> | null; method: { value: 'unknown' | 'correspondence' | 'schooling' | 'media' } };

export type PlanDraft = { plan: NonNullable<Attempt['plan']>; method: Attempt['method']['value'] };

export function AttemptPlanForm({ attempt, title, disabled, locked, save, close }: {
  attempt?: Attempt; title: string; disabled: boolean; locked: boolean; save: (draft: PlanDraft) => Promise<boolean>; close: () => void;
}) {
  const id = useId();
  const [error, setError] = useState('');
  const year = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  return <form aria-label="履修記録の入力" onKeyDown={e => {
    if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
  }} onSubmit={async e => {
    e.preventDefault();
    if (disabled || locked || submitted.current) return;
    const data = new FormData(e.currentTarget);
    const raw = String(data.get('year') ?? '');
    if (raw && (!/^\d{4}$/.test(raw) || Number(raw) < 1000 || Number(raw) > 9999)) {
      setError('予定年度は1000〜9999の整数、または空欄で入力してください。'); year.current?.focus(); return;
    }
    setError('');
    const plan = { ...attempt?.plan, status: data.get('status') as PlanDraft['plan']['status'], plannedYear: raw ? Number(raw) : null,
      plannedTerm: attempt?.plan?.plannedTerm ?? null, studyYear: attempt?.plan?.studyYear ?? null, earnedOrder: attempt?.plan?.earnedOrder ?? null };
    submitted.current = true;
    try {
      if (await save({ plan, method: data.get('method') as PlanDraft['method'] })) close();
      else submitted.current = false;
    } catch (error) { submitted.current = false; setError(String(error)); }
  }}>
    <h2>{attempt ? '履修記録を編集' : '履修計画に追加'}：{title}</h2>
    <p>履修方法は本人の希望です。予定年度は未設定でも記録できます。</p>
    <fieldset disabled={locked}><legend>履修予定・進捗</legend>
      <label>予定年度（空欄は未設定）<input ref={year} name="year" inputMode="numeric" defaultValue={attempt?.plan?.plannedYear ?? ''} /></label>
      <label htmlFor={`${id}-method`}>履修方法</label><select id={`${id}-method`} name="method" defaultValue={attempt?.method.value ?? 'unknown'}>{Object.entries(methodLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <label htmlFor={`${id}-status`}>進捗</label><select id={`${id}-status`} name="status" defaultValue={attempt?.plan?.status ?? 'planned'}>{Object.entries(statusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <button type="submit" disabled={disabled}>{attempt ? '変更を下書きに反映' : '下書きへ追加'}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={locked} onClick={close}>入力を閉じる</button>
  </form>;
}
