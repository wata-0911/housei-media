import { RecordedContributionForm } from '../components/planner/institutional/RecordedCreditForms';
import { RecordedGraduationView } from '../components/planner/institutional/RecordedGraduationView';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { InstitutionalSearchView } from '../components/planner/institutional/InstitutionalSearchView';
import { AttemptPlanForm, type PlanDraft } from '../components/planner/institutional/AttemptPlanForm';
import { loadCurrentCurriculumSearchAdapter } from '../planner/institutional/currentSearch';
import type { InstitutionalSearchRow } from '../planner/institutional/search';
import { admissionProblem, createAcController } from '../planner/attempts/production/acController';
import { protectLegacyPlannerRaw } from '../planner/attempts/production/session';
import type { Attempt, AttemptGraph } from '../planner/attempts/types';
import '../components/planner/institutional/institutionalSearch.css';
import '../components/planner/institutional/planner.css';

type Controller = ReturnType<typeof createAcController>;
type Proposal = NonNullable<ReturnType<Controller['getSnapshot']>['proposal']>;
function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const input = (draft: PlanDraft) => JSON.stringify({ plannedYear: draft.plan.plannedYear, method: draft.method, status: draft.plan.status });

function SaveConfirmation({ proposal, controller, busy, cancel }: { proposal: Proposal; controller: Controller; busy: boolean; cancel: () => void }) {
  const [protectedFile, setProtectedFile] = useState(false), [confirmed, setConfirmed] = useState(false);
  return <fieldset disabled={busy} aria-label="保存確認"><legend>保存前の確認</legend>
    <p>schema{proposal.schemaVersion} / 履修回 {proposal.graph.attempts.length}件 / 公式原行 {proposal.officialRows}件 / {proposal.bytes} bytes。計算は保存後に教育課程を選択して実行できます。</p>
    <p>下書きの内容と変更前の原文を確認してください。確認して保存するまで永続化されません。</p>
    <button onClick={() => { download(proposal.protectionRaw, 'planner-before-save.json'); setProtectedFile(true); }}>変更前の原文を保護</button>
    <label><input type="checkbox" disabled={!protectedFile} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />保護ファイルと保存内容を確認しました</label>
    <button disabled={!confirmed} onClick={() => void controller.save(proposal, confirmed)}>確認して保存</button>
    <button onClick={cancel}>保存確認を取り消す</button>
  </fieldset>;
}

function ProgressForm({ attempt, graph, disabled, controller }: { attempt: Attempt; graph: AttemptGraph; disabled: boolean; controller: Controller }) {
  const records = graph.ownedRecords.filter(r => r.kind === 'correspondence' && r.owner?.kind === 'attempt' && r.owner.attemptId === attempt.id);
  const previous = records.length === 1 ? records[0] : undefined;
  const [error, setError] = useState('');
  if (records.length > 1) return <p>通信進捗が複数あります。記録を保全し、編集対象の確認まで進捗編集を保留します。</p>;
  return <form aria-label={`${attempt.originalTitle}の通信進捗`} onSubmit={e => {
    e.preventDefault(); if (disabled || attempt.method.value !== 'correspondence') return;
    const raw = String(new FormData(e.currentTarget).get('reports') ?? '');
    if (raw !== '' && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))) { setError('必要リポート数は0以上の整数、または空欄で入力してください。'); return; }
    setError('');
    controller.progress(attempt.id, JSON.stringify({ requiredReports: raw === '' ? null : Number(raw),
      reports: previous?.kind === 'correspondence' ? previous.payload.reports : [],
      examGrade: previous?.kind === 'correspondence' ? previous.payload.examGrade : null }));
  }}><fieldset disabled={disabled || attempt.method.value !== 'correspondence'}><legend>通信進捗の下書き</legend>
      <label>必要リポート数<input name="reports" inputMode="numeric" defaultValue={previous?.kind === 'correspondence' ? previous.payload.requiredReports ?? '' : ''} /></label>
      <button>進捗を下書きに反映</button>
    </fieldset>{error && <p role="alert">{error}</p>}</form>;
}

/** Connected presentation; mounted only by the isolated integration entry. */
export default function InstitutionalPlannerPage() {
  const location = useLocation();
  const handled = useRef<string | null>(null);
  const [source] = useState(loadCurrentCurriculumSearchAdapter), [controller] = useState(createAcController);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const initial = useRef<Promise<boolean> | null>(null);
  const fileGeneration = useRef(0);
  const invalidateFileRead = useCallback(() => {
    fileGeneration.current++; controller.invalidateSelection();
  }, [controller]);
  const migrationInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = migrationInput.current;
    element?.addEventListener('cancel', invalidateFileRead);
    return () => element?.removeEventListener('cancel', invalidateFileRead);
  }, [invalidateFileRead]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    initial.current ??= controller.load();
    void initial.current.then(() => { if (alive) setLoaded(true); });
    return () => { alive = false; invalidateFileRead(); };
  }, [controller, invalidateFileRead]);
  useLayoutEffect(() => {
    if (!loaded) return;
    const request = `${location.key}:${location.hash}`;
    if (handled.current === request) return;
    const id = location.hash.slice(1);
    if (!['planned-heading', 'course-query', 'graduation-progress-heading'].includes(id)) return;
    const target = document.getElementById(id);
    if (!target) return;
    handled.current = request;
    target.style.scrollMarginTop = `${Math.max(160, (document.querySelector('header')?.getBoundingClientRect().height ?? 0) + 32)}px`;
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
    target.focus({ preventScroll: true });
  }, [location.key, location.hash, loaded]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (state.dirty || state.busy || state.proposal) e.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [state.dirty, state.busy, state.proposal]);
  const [selection, setSelection] = useState<InstitutionalSearchRow | null>(null), [editing, setEditing] = useState<string | null>(null);
  const [protectionError, setProtectionError] = useState('');
  const form = useRef<HTMLDivElement>(null);
  const locked = !state.ready || state.busy || !!state.proposal;
  const problem = selection ? admissionProblem(selection) : '';
  async function protect(action: () => Promise<string>, name: string) {
    try { setProtectionError(''); download(await action(), name); } catch (error) { setProtectionError(String(error)); }
  }
  return <article className="institutional-planner" id="planner-start" tabIndex={-1}>
    <h1>履修プランナー A＋B＋C 結合候補</h1>
    <p className="notice">隔離環境の候補です。下書きは別途保存が必要です。画面を離れると未保存の入力は失われます。</p>
    <p role="status" data-testid="save-status">{state.notice}</p>
    {(state.error || protectionError) && <p role="alert">{state.error || protectionError}。保存内容を消去する自動修復は行いません。</p>}
    <fieldset disabled={state.busy} aria-label="保存操作"><legend>保存・保護</legend>
      <button disabled={!state.ready || !!state.proposal || !(state.graph ? state.admission?.canEdit : state.admission?.canCreate)} onClick={() => void controller.prepare()}>{state.graph ? '保存内容を準備' : '新規計画の保存を準備'}</button>
      <button onClick={() => {
        if ((state.dirty || state.proposal) && !window.confirm('未保存の下書きを破棄し、保存内容を再読込します。続けますか？')) return;
        fileGeneration.current++; controller.invalidateSelection(); setProtectionError('');
        setSelection(null); setEditing(null); void controller.load();
      }}>保存内容を再読込</button>
      <button onClick={() => void protect(controller.protectCurrent, 'planner-current-raw.json')}>保存原文を保護</button>
      <button onClick={() => void protect(() => protectLegacyPlannerRaw(localStorage), 'planner-legacy-raw.json')}>旧計画・公式成績の原文を保護</button>
      <label>旧schema22原文から明示移行<input ref={migrationInput} type="file" accept=".json" disabled={!state.ready || state.busy || !!state.graph || !(state.admission?.canMigrate || state.admission?.canCreate)} onChange={e => {
        const stamp = ++fileGeneration.current;
        controller.invalidateSelection(); setProtectionError('');
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void file.text().then(raw => {
          if (stamp === fileGeneration.current) return controller.prepareMigration(raw);
        }).catch(error => { if (stamp === fileGeneration.current) setProtectionError(String(error)); });
      }} /></label>
    </fieldset>
    {state.proposal && <SaveConfirmation key={state.proposal.generation} proposal={state.proposal} controller={controller} busy={state.busy} cancel={() => {
      fileGeneration.current++; controller.cancel();
    }} />}
    <InstitutionalSearchView adapter={source} selectionNotice="選択は入力フォームを開く操作です。下書きへの反映と、確認後の正式保存を別々に行います。" onSelect={row => {
      if (locked) return;
      setSelection(row); setEditing(null); requestAnimationFrame(() => form.current?.focus());
    }} />
    {selection && <div ref={form} tabIndex={-1}>{problem && <p role="alert">{problem}</p>}
      <AttemptPlanForm key={selection.placement.id} title={selection.placement.officialName} disabled={locked || !state.graph || !!problem} locked={locked}
        save={async draft => controller.add(selection.placement.id, input(draft))} close={() => setSelection(null)} />
    </div>}
    <section aria-labelledby="planned-heading"><h2 id="planned-heading" tabIndex={-1}>履修計画</h2>
      {!state.graph && <p>{state.admission?.canCreate ? '新規計画を確認して保存してから、制度科目を追加できます。' : '旧データの保護・確認が必要です。空の新規計画を最新の計画として表示しません。'}</p>}
      {state.graph?.attempts.map(a => <article data-attempt-id={a.id} key={a.id} className="attempt-record">
        <h3>{a.originalTitle}</h3><p>科目対応: {a.identity.status} / 本人適用: {a.applicability.status} / 卒業算入: 下の条件付き計算で確認（本人適用は未確認）</p>
        <p>予定年度: {a.plan?.plannedYear ?? '未設定'} / 状態: {a.plan?.status ?? '未設定'} / {a.membership.kind === 'active' ? '計画内' : '計画から除外（記録保持）'}</p>
        {a.membership.kind === 'active' ? <>
          <button disabled={locked || !a.plan} onClick={() => { setEditing(a.id); setSelection(null); }}>履修記録を編集</button>
          {editing === a.id && <AttemptPlanForm attempt={a} title={a.originalTitle} disabled={locked} locked={locked}
            save={async draft => controller.update(a.id, input(draft))} close={() => setEditing(null)} />}
          <ProgressForm key={`${a.id}:${JSON.stringify(state.graph!.ownedRecords.filter(r => r.kind === 'correspondence' && r.owner?.kind === 'attempt' && r.owner.attemptId === a.id))}`} attempt={a} graph={state.graph!} disabled={locked} controller={controller} />
          <RecordedContributionForm attempt={a} disabled={locked || !a.plan} save={raw => controller.recordContribution(a.id, raw)} />
          <button disabled={locked} onClick={() => { if (controller.remove(a.id)) setEditing(null); }}>計画から削除</button>
        </> : <button disabled={locked || !a.membership.deletionOperationId} onClick={() => controller.undo(a.id)}>この履修回をUndo</button>}
        <details><summary>保持する記録と進捗</summary><pre>{JSON.stringify({ attempt: a, records: state.graph!.ownedRecords.filter(r => r.owner?.kind === 'attempt' && r.owner.attemptId === a.id) }, null, 2)}</pre></details>
      </article>)}
      <p>通信の必要リポート数のみ編集できます。既存のリポート・成績・メディア進捗は保持し、assessmentの新規IDは発行しません。</p>
    </section>
    <RecordedGraduationView state={state} calculate={controller.calculate} />
    <p>旧Plannerは旧schema22を保存します。新Attemptの取込・バックアップ先には使えません。旧側を変更した場合、新側では原文の再照合が必要です。</p>
    <Link to="/planner" onClick={e => { if (state.dirty && !window.confirm('未保存の下書きがあります。旧Plannerへ移動しますか？')) e.preventDefault(); }}>旧schema22 Planner（別保存）</Link>
  </article>;
}
