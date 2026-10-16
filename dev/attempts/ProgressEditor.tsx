import { nullableText, preventImeSubmit, text } from './formHelpers';
import { useState } from 'react';
import type { AttemptOwnedRecord } from '../../src/planner/attempts/types';
import { newOperationId, type Command } from '../../src/planner/attempts/workbench/operations';
import { optionalNumber } from '../../src/planner/attempts/workbench/catalogView';
import { buttonClass, Field, Grade, inputClass } from './Fields';

type Progress = Exclude<AttemptOwnedRecord, { kind: 'todo' }>;
export function ProgressEditor({ record, submit }: { record: Progress; submit: (command: Command) => boolean }) {
  const [draft, setDraft] = useState(record), [error, setError] = useState('');
  const title = record.kind === 'media' ? 'メディア進捗' : record.kind === 'correspondence' ? '通信進捗' : '科目評価';
  const grade = (data: FormData, name: string) => nullableText(data, name) as Extract<Progress, { kind: 'evaluation' }>['payload']['finalGrade'];
  return <form aria-label={title} className="space-y-3 rounded border border-slate-300 p-3" onKeyDown={preventImeSubmit} onSubmit={e => {
    e.preventDefault();
    try {
      const data = new FormData(e.currentTarget);
      let payload: Progress['payload'];
      if (draft.kind === 'media') payload = {
        totalLessons: optionalNumber(text(data, 'totalLessons')),
        lessons: draft.payload.lessons.map((l, i) => ({ lesson: l.lesson, videoCompleted: data.has(`video-${i}`), testCompleted: data.has(`test-${i}`) })),
        assessments: draft.payload.assessments.map((a, i) => ({ id: a.id, type: text(data, `type-${i}`) as typeof a.type,
          label: text(data, `label-${i}`), scheduledDate: nullableText(data, `date-${i}`), completed: data.has(`complete-${i}`) })),
      };
      else if (draft.kind === 'correspondence') payload = {
        requiredReports: optionalNumber(text(data, 'requiredReports')),
        reports: draft.payload.reports.map((r, i) => ({ reportNumber: r.reportNumber, status: text(data, `status-${i}`) as typeof r.status,
          grade: nullableText(data, `grade-${i}`) as typeof r.grade })), examGrade: grade(data, 'examGrade'),
        ...(text(data, 'batch') ? { calligraphyBatchStatus: text(data, 'batch') as 'not_submitted' | 'grading' | 'passed' } : {}),
      };
      else payload = { finalGrade: grade(data, 'finalGrade'), reportGrade: grade(data, 'reportGrade'), schoolingGrade: grade(data, 'schoolingGrade') };
      if (submit({ kind: 'edit_payload', operationId: newOperationId(), recordId: record.id, payload })) setError('');
    } catch (err) { setError(String(err)); }
  }}>
    <h4 className="font-semibold">{title}</h4>
    {draft.kind === 'media' && <>
      <Field label="総動画・テスト回数（空欄=null）"><input className={inputClass} name="totalLessons" inputMode="numeric" defaultValue={draft.payload.totalLessons ?? ''} /></Field>
      {draft.payload.lessons.map((l, i) => <fieldset key={l.lesson} className="flex flex-wrap gap-3 rounded border p-2"><legend>第{l.lesson}回</legend>
        <label><input type="checkbox" name={`video-${i}`} defaultChecked={l.videoCompleted} /> 動画視聴 第{l.lesson}回</label>
        <label><input type="checkbox" name={`test-${i}`} defaultChecked={l.testCompleted} /> テスト 第{l.lesson}回</label>
      </fieldset>)}
      <button className={buttonClass} type="button" onClick={() => setDraft({ ...draft, payload: { ...draft.payload, lessons: [...draft.payload.lessons, { lesson: Math.max(0, ...draft.payload.lessons.map(l => l.lesson)) + 1, videoCompleted: false, testCompleted: false }] } })}>動画・テスト回を追加</button>
      {draft.payload.assessments.map((a, i) => <fieldset key={a.id} className="grid gap-2 rounded border p-2 sm:grid-cols-2"><legend>試験 {i + 1}</legend>
        <Field label={`試験種別 ${i + 1}`}><select className={inputClass} name={`type-${i}`} defaultValue={a.type}><option value="midterm">中間</option><option value="final">期末</option><option value="other">その他</option></select></Field>
        <Field label={`試験名 ${i + 1}`}><input className={inputClass} name={`label-${i}`} defaultValue={a.label} /></Field>
        <Field label={`予定日 ${i + 1}（YYYY-MM-DD・空欄=null）`}><input className={inputClass} name={`date-${i}`} defaultValue={a.scheduledDate ?? ''} placeholder="2027-02-28" /></Field>
        <label className="self-center"><input type="checkbox" name={`complete-${i}`} defaultChecked={a.completed} /> 試験完了 {i + 1}</label>
        <p className="break-all text-xs text-slate-500 sm:col-span-2">assessment ID: {a.id}</p>
      </fieldset>)}
      <button type="button" className={buttonClass} onClick={() => setDraft({ ...draft, payload: { ...draft.payload, assessments: [...draft.payload.assessments, { id: crypto.randomUUID(), type: 'other', label: '', scheduledDate: null, completed: false }] } })}>試験を追加</button>
    </>}
    {draft.kind === 'correspondence' && <>
      <Field label="必要リポート数（空欄=null）"><input className={inputClass} name="requiredReports" inputMode="numeric" defaultValue={draft.payload.requiredReports ?? ''} /></Field>
      {draft.payload.reports.map((r, i) => <fieldset key={r.reportNumber} className="grid gap-2 rounded border p-2 sm:grid-cols-2"><legend>リポート番号 {r.reportNumber}</legend>
        <Field label={`リポート状態 ${r.reportNumber}`}><select className={inputClass} name={`status-${i}`} defaultValue={r.status}>{Object.entries({ not_submitted: '未提出', submitted: '提出', grading: '添削中', resubmit: '再提出', passed: '合格' }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Grade label={`リポート評価 ${r.reportNumber}`} name={`grade-${i}`} value={r.grade} report />
      </fieldset>)}
      <button type="button" className={buttonClass} onClick={() => setDraft({ ...draft, payload: { ...draft.payload, reports: [...draft.payload.reports, { reportNumber: Math.max(0, ...draft.payload.reports.map(r => r.reportNumber)) + 1, status: 'not_submitted', grade: null }] } })}>リポートを追加</button>
      <Grade label="単位修得試験の評価" name="examGrade" value={draft.payload.examGrade} />
      <Field label="書道実技の一括進捗"><select className={inputClass} name="batch" defaultValue={draft.payload.calligraphyBatchStatus ?? ''}>
        {!Object.hasOwn(draft.payload, 'calligraphyBatchStatus') && <option value="">未設定（fieldなし）</option>}<option value="not_submitted">未提出</option><option value="grading">添削中</option><option value="passed">合格</option>
      </select></Field>
      <p className="text-sm">リポート評価を記録するには合格状態が必要です。回数の縮小で既存リポートを消しません。</p>
    </>}
    {draft.kind === 'evaluation' && <div className="grid gap-2 sm:grid-cols-3"><Grade label="最終評価" name="finalGrade" value={draft.payload.finalGrade} /><Grade label="リポート評価（科目）" name="reportGrade" value={draft.payload.reportGrade} /><Grade label="スクーリング評価" name="schoolingGrade" value={draft.payload.schoolingGrade} /></div>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
    <p className="text-xs text-slate-600">明示ownerを維持。方式・履修状態・公式評価は変更しません。</p>
    <button className={buttonClass}>{title}をメモリに反映</button>
  </form>;
}
