import { useRef, useState } from 'react';
import { loadYi01InstitutionalCatalog } from '../../src/planner/institutional/yi01';
import type { Attempt, AttemptValidationContext } from '../../src/planner/attempts/types';
import { applyCommand, createWorkspace, newOperationId, type Command, type Workspace } from '../../src/planner/attempts/workbench/operations';
import { attemptView, ownerLabel } from '../../src/planner/attempts/workbench/catalogView';
import type { MigrationSession } from '../../src/planner/attempts/workbench/migrationSession';
import { AttemptForm } from './AttemptForm';
import { ProgressEditor } from './ProgressEditor';
import { emptyProgress } from './progressDefaults';
import { TodoPanel } from './TodoPanel';
import { MigrationPanel } from './MigrationPanel';
import { buttonClass, Field, inputClass } from './Fields';

const master = loadYi01InstitutionalCatalog();
const initialContext: AttemptValidationContext = { catalog: master, officialAchievementIds: [], officialStudyRecordIds: [] };
type Props = { seed?: { workspace: Workspace; context: AttemptValidationContext }; dispatch?: (workspace: Workspace, command: Command) => Workspace; onCommand?: (command: Command) => void };
export function Workbench({ seed, dispatch, onCommand }: Props = {}) {
  const [state, setState] = useState(() => seed ?? ({ workspace: createWorkspace({ attempts: [], ownedRecords: [], removals: [] }, initialContext), context: initialContext }));
  // Synchronous latest-state reference makes event replays atomic between React renders.
  const current = useRef(state);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [form, setForm] = useState<'new' | Attempt | null>(null);
  const [sort, setSort] = useState('plan');
  function submit(command: Command) {
    try {
      const next = { ...current.current, workspace: dispatch ? dispatch(current.current.workspace, command) : applyCommand(current.current.workspace, command, current.current.context) };
      onCommand?.(command); current.current = next; setState(next); setError(''); setNotice('隔離メモリに反映しました。未保存です。'); return true;
    } catch (err) { setError(String(err)); setNotice('入力を反映できませんでした。draftを確認してください。'); return false; }
  }
  function start(session: MigrationSession) {
    if (session.decoded.status !== 'decoded' || session.preview?.status !== 'ready') return;
    const next = { context: session.decoded.source.context, workspace: createWorkspace(session.preview.target.graph, session.decoded.source.context) };
    current.current = next; setState(next); setForm(null); setError(''); setNotice('readyを初期状態にしました。未保存です。');
  }
  const { workspace, context } = state, graph = workspace.graph;
  const active = graph.attempts.filter(a => a.membership.kind === 'active');
  const detached = graph.attempts.filter(a => a.membership.kind === 'detached');
  if (sort === 'name') active.sort((a, b) => a.originalTitle.localeCompare(b.originalTitle, 'ja'));
  if (sort === 'year') active.sort((a, b) => (a.plan?.plannedYear ?? Infinity) - (b.plan?.plannedYear ?? Infinity));
  function card(a: Attempt) {
    const view = attemptView(a, graph, context.catalog);
    return <article key={a.id} data-attempt-id={a.id} aria-label={`${a.originalTitle} ${a.id}`} className="min-w-0 space-y-3 rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
      <div><h3 className="text-lg font-bold">{a.originalTitle}</h3><p className="break-all text-xs text-slate-600">Attempt ID: {a.id}</p></div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><div><dt>予定年度・時期</dt><dd>{a.plan?.plannedYear ?? '不明'} / {a.plan?.plannedTerm ?? '不明'}</dd></div><div><dt>方式 / 由来</dt><dd>{a.method.value} / {a.method.source}</dd></div><div><dt>履修状態</dt><dd>{a.plan?.status ?? '計画なし'}</dd></div><div><dt>本人寄与単位</dt><dd>{view.contribution}</dd></div></dl>
      <p className="text-sm">制度identity: <strong>{a.identity.status}</strong> / Placement: <strong>{a.placement.status}</strong> / 本人適用: {a.applicability.status} / <strong>{a.membership.kind}</strong></p>
      <p className="text-sm">{a.identity.reason} {a.placement.reason}</p>
      {view.placements.map(p => <p className="text-sm" key={p.id}>配置参考: {p.officialName} / 制度構成 {p.compositionCredits ?? '不明'}単位 / {p.identityDecision.status}（本人寄与とは別）</p>)}
      <p className="text-sm" data-testid="progress-summary">{view.progressSummary}</p>
      <details><summary>根拠・実績context・候補</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ method: a.method, actualYear: a.actualYear, contribution: a.plan?.contribution, earnedOrder: a.plan?.earnedOrder, identity: a.identity, placement: a.placement, legacyRefs: a.legacyRefs,
        // References remain in Attempt; resolve document context only for display.
        selectedDocument: seed ? undefined : view.placements.map(p => ({ placement: p,
          curriculumVersion: context.catalog.curriculumVersions.find(v => v.id === p.curriculumVersionId),
          sourceRevision: context.catalog.sourceRevision,
          notes: context.catalog.notes.filter(n => p.noteIds.includes(n.evidenceId)),
          codes: context.catalog.codes.filter(c => [...p.auditRecord.mainCodeEvidenceIds, ...p.auditRecord.teacherCodeEvidenceIds,
            ...p.auditRecord.sameNameCodeCandidateEvidenceIds].includes(c.evidenceId)),
        })) }, null, 2)}</pre></details>
      <div className="flex flex-wrap gap-2">
        {a.membership.kind === 'active' ? <><button className={buttonClass} onClick={() => setForm(a)}>予定を編集</button><button className={buttonClass} onClick={() => submit({ kind: 'remove', attemptId: a.id, operationId: newOperationId() })}>計画から削除</button></>
          : a.membership.reason === 'plan_deleted' ? <button className={buttonClass} onClick={() => { if (a.membership.kind === 'detached' && a.membership.deletionOperationId) submit({ kind: 'undo', attemptId: a.id, operationId: newOperationId(), removalOperationId: a.membership.deletionOperationId }); }}>このAttemptをUndo</button> : <p>旧孤立owner。計画・状態を推測しません。</p>}
        <button className={buttonClass} onClick={() => setForm('new')}>別の新規履修回を追加</button>
      </div>
      <details><summary>このAttemptの進捗・評価（方式を問わず保持）</summary><div className="mt-3 space-y-3">
        {(['media', 'correspondence', 'evaluation'] as const).map(kind => {
          const record = view.records.find(r => r.kind === kind);
          return record && record.kind !== 'todo' ? <ProgressEditor key={JSON.stringify(record)} record={record} submit={submit} />
            : <button key={kind} className={`${buttonClass} mr-2`} onClick={() => submit({ kind: 'add_record', operationId: newOperationId(), record: emptyProgress(kind, a.id) })}>{kind === 'media' ? 'メディア進捗を開始' : kind === 'correspondence' ? '通信進捗を開始' : '科目評価を開始'}</button>;
        })}
      </div></details>
    </article>;
  }
  return <main className="mx-auto max-w-6xl space-y-6 px-3 py-6 text-slate-900 sm:px-6">
    {!seed && <header className="space-y-2"><p className="font-bold text-indigo-800">YI-05 / 開発・テスト専用</p><h1 className="text-2xl font-bold sm:text-3xl">独立Attempt ワークベンチ</h1><p className="rounded border-2 border-amber-600 bg-amber-50 p-3 font-semibold">すべて未保存の隔離メモリです。ブラウザ更新で変更は失われます。本番primary/recovery・バックアップ・卒業計算には反映されません。</p><p>制度科目と履修回を分けて記録します。将来年度の開講・履修資格・反復履修の許可を保証しません。</p></header>}
    {!seed && <MigrationPanel start={start} />}
    <div aria-live="polite" className="space-y-2">{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="whitespace-pre-wrap rounded border border-red-500 bg-red-50 p-3 text-red-900">{error}</p>}</div>
    <section className="space-y-4" aria-labelledby="plan-heading"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="plan-heading" className="text-xl font-bold">履修計画 / active {active.length}件</h2><button className={buttonClass} onClick={() => setForm('new')}>新しい履修回</button></div>
      <Field label="表示順（ID・計画順は維持）"><select className={`${inputClass} sm:max-w-xs`} value={sort} onChange={e => setSort(e.target.value)}><option value="plan">計画順</option><option value="name">科目名</option><option value="year">予定年度</option></select></Field>
      {form && <AttemptForm key={form === 'new' ? 'new' : form.id} context={context} searchEnabled={!seed} attempt={form === 'new' ? undefined : form} submit={submit} close={() => setForm(null)} />}
      <div className="space-y-4">{active.map(card)}</div>{active.length === 0 && <p>制度科目を選択するか、未確定の名称で追加できます。</p>}
    </section>
    <section className="space-y-4" aria-labelledby="detached-heading"><h2 className="text-xl font-bold" id="detached-heading">detached / 計画外のowner {detached.length}件</h2><p>削除しても進捗・評価・TODOは元Attemptに残ります。Undoと新しい履修回の追加は別操作です。複数削除した場合は、最後に削除した履修回から逆順にUndoしてください。削除順を確認できない場合は復元を停止します。</p>{detached.map(card)}</section>
    <section className="space-y-3"><h2 className="text-xl font-bold">未解決の旧ownerの進捗</h2>{graph.ownedRecords.filter(r => r.owner?.kind === 'unresolved_legacy' && r.kind !== 'todo').map(r => r.kind !== 'todo' && <div key={r.id}><p className="break-all text-sm">{ownerLabel(r.owner, graph)}</p><ProgressEditor key={JSON.stringify(r)} record={r} submit={submit} /></div>)}</section>
    <TodoPanel graph={graph} submit={submit} />
    <footer className="border-t pt-4 text-sm text-slate-600">ページ内操作receipt: {workspace.receipts.length}件。{seed ? '編集は未保存です。上部で比較・確認して隔離保存してください。' : '保存はYI-06、卒業計算adapterはYI-07、公開判断はYI-08の対象です。'}</footer>
  </main>;
}
