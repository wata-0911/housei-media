import { RecordedContributionForm } from '../components/planner/institutional/RecordedCreditForms';
import { RecordedGraduationView } from '../components/planner/institutional/RecordedGraduationView';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useBlocker, useLocation } from 'react-router-dom';
import { InstitutionalSearchView } from '../components/planner/institutional/InstitutionalSearchView';
import { AttemptPlanForm, type PlanDraft } from '../components/planner/institutional/AttemptPlanForm';
import { loadCurrentCurriculumSearchAdapter } from '../planner/institutional/currentSearch';
import type { InstitutionalSearchRow } from '../planner/institutional/search';
import { admissionProblem, createAcController } from '../planner/attempts/production/acController';
import { readAttemptBackupFile, readMigrationFile } from '../planner/attempts/production/migrationFile';
import { protectLegacyPlannerRaw } from '../planner/attempts/production/session';
import type { AttemptId, AttemptOwnedRecord } from '../planner/attempts/types';
import { STORAGE_KEY, BACKUP_KEY } from '../planner/backup/storagePrimitives';
import { AttemptProgressEditor } from '../components/planner/institutional/AttemptProgressEditor';
import { GradeImportLookup, SavedAttemptDisplay, type ReadGradeReference } from '../components/planner/institutional/SavedAttemptDisplay';
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

function SaveConfirmation({ proposal, controller, busy, cancel, notify }: { proposal: Proposal; controller: Controller; busy: boolean; cancel: () => void; notify: () => void }) {
  const [protectedFile, setProtectedFile] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [adopted, setAdopted] = useState(false);
  return <fieldset disabled={busy} aria-label="保存確認"><legend>保存前の確認</legend>
    <p>schema{proposal.schemaVersion} / 履修回 {proposal.graph.attempts.length}件 / 公式原行 {proposal.officialRows}件 / {proposal.bytes} bytes。計算は保存後に教育課程を選択して実行できます。</p>
    <p>下書きの内容と変更前の原文を確認してください。確認して保存するまで永続化されません。</p>
    <button onClick={() => { download(proposal.protectionRaw, 'planner-before-save.json'); setProtectedFile(true); }}>変更前の原文を保護</button>
    <label><input type="checkbox" disabled={!protectedFile} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />保護ファイルと保存内容を確認しました</label>
    {proposal.adoptionSha256 && <>
      <p className="muted">復元ファイル SHA256 {proposal.adoptionSha256}</p>
      <label><input type="checkbox" disabled={!confirmed} checked={adopted} onChange={e => setAdopted(e.target.checked)} />このバックアップを復元元として採用します</label>
    </>}
    <button disabled={!confirmed || (proposal.adoptionSha256 !== null && !adopted)} onClick={() =>
      void controller.save(proposal, confirmed, adopted ? proposal.adoptionSha256 ?? undefined : undefined).finally(notify)
    }>確認して保存</button>
    <button onClick={cancel}>保存確認を取り消す</button>
  </fieldset>;
}

/** Connected presentation; mounted only by the isolated integration entry. */
export default function InstitutionalPlannerPage({ readGradeReference }: { readGradeReference: ReadGradeReference }) {
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

  const [unsent, setUnsent] = useState<ReadonlySet<string>>(() => new Set());
  const [resetInputs, setResetInputs] = useState(0);
  const [readingFile, setReadingFile] = useState(false);
  const [selection, setSelection] = useState<InstitutionalSearchRow | null>(null), [editing, setEditing] = useState<string | null>(null);
  const [protectionError, setProtectionError] = useState('');
  const form = useRef<HTMLDivElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const invalidate = () => controller.invalidateSaved();
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === STORAGE_KEY || event.key === BACKUP_KEY) invalidate();
    };
    const signal = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('hosei-attempt-authority-invalidation');
    channel.current = signal;
    signal?.addEventListener('message', invalidate);
    window.addEventListener('storage', storage);
    return () => { signal?.close(); channel.current = null; window.removeEventListener('storage', storage); };
  }, [controller]);
  const hasChanges = unsent.size > 0 || state.dirty || !!state.proposal;
  const navigation = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && (hasChanges || state.busy || readingFile));
  useEffect(() => {
    if (navigation.state !== 'blocked') return;
    if (window.confirm('保存または入力の途中です。この画面を離れますか？')) navigation.proceed();
    else navigation.reset();
  }, [navigation]);
  const recordsByAttempt = useMemo(() => {
    const index = new Map<AttemptId, AttemptOwnedRecord[]>();
    for (const record of state.graph?.ownedRecords ?? []) {
      if (record.owner?.kind !== 'attempt') continue;
      const id = record.owner.attemptId;
      const group = index.get(id);
      if (group) group.push(record); else index.set(id, [record]);
    }
    return index;
  }, [state.graph]);
  const savedDisplay = unsent.size && state.saved.status === 'pinned'
    ? { status: 'hold' as const, past: state.saved.past, reason: '送信していない入力があります' }
    : state.saved;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (hasChanges || state.busy || readingFile) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasChanges, state.busy, readingFile]);
  function markUnsent(key: string, value: boolean) {
    setUnsent(previous => {
      if (previous.has(key) === value) return previous;
      const next = new Set(previous);
      if (value) next.add(key); else next.delete(key);
      return next;
    });
  }
  function closePlan(discard?: boolean) {
    if (discard && unsent.has('plan') && !window.confirm('送信していない履修入力を破棄しますか？')) return false;
    markUnsent('plan', false); setSelection(null); setEditing(null);
    return true;
  }
  function openAttempt(id: AttemptId) {
    if (locked || !closePlan(true)) return;
    const target = document.getElementById('attempt-' + id);
    target?.focus(); target?.scrollIntoView({ block: 'start' });
  }
  function restore(file?: File) {
    if (!file || unsent.size || state.dirty || locked) return;
    const stamp = ++fileGeneration.current;
    setReadingFile(true); setProtectionError('');
    controller.invalidateSelection();
    void readAttemptBackupFile(file).then(raw => {
      if (stamp === fileGeneration.current) return controller.prepareRestore(raw);
    }).catch(error => {
      if (stamp === fileGeneration.current) setProtectionError(String(error));
    }).finally(() => {
      if (stamp === fileGeneration.current) setReadingFile(false);
    });
  }
  const locked = !state.ready || state.busy || !!state.proposal || readingFile;
  const problem = selection ? admissionProblem(selection) : '';
  async function protect(action: () => Promise<string>, name: string) {
    try { setProtectionError(''); download(await action(), name); } catch (error) { setProtectionError(String(error)); }
  }
  return <article className="institutional-planner" id="planner-start" tabIndex={-1}>
    <h1>年度非依存の履修プランナー</h1>
    <p className="notice">隔離環境の候補です。下書きは別途保存が必要です。画面を離れると未保存の入力は失われます。</p>
    <p role="status" data-testid="save-status">{state.notice}</p>
    {state.error && <p role="alert">{state.error}。保存内容を消去する自動修復は行いません。</p>}
    {protectionError && <p role="alert" data-testid="protection-error">{protectionError}。保存内容を消去する自動修復は行いません。</p>}
    <fieldset disabled={state.busy} aria-label="保存操作"><legend>保存・保護</legend>
      <button disabled={locked || unsent.size > 0 || !(state.graph ? state.admission?.canEdit : state.admission?.canCreate)} onClick={() => void controller.prepare()}>{state.graph ? '保存内容を準備' : '新規計画の保存を準備'}</button>
      <button onClick={() => {
        if ((hasChanges || readingFile) && !window.confirm('未保存の下書きを破棄し、保存内容を再読込します。続けますか？')) return;
        fileGeneration.current++; controller.invalidateSelection(); setProtectionError('');
        setSelection(null); setEditing(null); setUnsent(new Set());
        setReadingFile(false); setResetInputs(value => value + 1); void controller.load();
      }}>保存内容を再読込</button>
      <button disabled={locked || hasChanges || !state.graph} onClick={() => void protect(controller.createBackup, 'attempt-plan-backup.json')}>可搬バックアップをダウンロード</button>
      <label>可搬バックアップから復元<input type="file" accept=".json,application/json" disabled={locked || hasChanges} onChange={e => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        restore(file);
      }} /></label>
      <button onClick={() => void protect(controller.protectCurrent, 'planner-current-raw.json')}>保存原文を保護</button>
      <button onClick={() => void protect(() => protectLegacyPlannerRaw(localStorage), 'planner-legacy-raw.json')}>旧計画・公式成績の原文を保護</button>
      <label>旧schema22原文から明示移行<input ref={migrationInput} type="file" accept=".json" disabled={!state.ready || state.busy || !!state.graph || !(state.admission?.canMigrate || state.admission?.canCreate)} onChange={e => {
        const stamp = ++fileGeneration.current;
        controller.invalidateSelection(); setProtectionError('');
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void readMigrationFile(file).then(raw => {
          if (stamp === fileGeneration.current) return controller.prepareMigration(raw);
        }).catch(error => { if (stamp === fileGeneration.current) setProtectionError(String(error)); });
      }} /></label>
    </fieldset>
    {unsent.size > 0 && <p role="status">送信していない入力があります。下書きに反映するか、入力を取り消してから保存してください。</p>}
    {state.proposal && <SaveConfirmation key={state.proposal.generation} proposal={state.proposal} controller={controller} busy={state.busy} notify={() => channel.current?.postMessage('recheck')} cancel={() => {
      fileGeneration.current++; controller.cancel();
    }} />}
    <SavedAttemptDisplay state={savedDisplay} verify={() => void controller.verifySaved()} disabled={locked || hasChanges || !state.graph} />
    <GradeImportLookup key={resetInputs} attempts={state.graph?.attempts ?? []} disabled={locked} open={openAttempt}
      readGradeReference={readGradeReference} />
    <InstitutionalSearchView adapter={source} selectionNotice="選択は入力フォームを開く操作です。下書きへの反映と、確認後の正式保存を別々に行います。" onSelect={row => {
      if (locked || !closePlan(true)) return;
      setSelection(row); setEditing(null); requestAnimationFrame(() => form.current?.focus());
    }} />
    {selection && <div ref={form} tabIndex={-1}>{problem && <p role="alert">{problem}</p>}
      <AttemptPlanForm onUnsent={() => markUnsent('plan', true)} key={selection.placement.id} title={selection.placement.officialName} disabled={locked || !state.graph || !!problem} locked={locked}
        save={async draft => controller.add(selection.placement.id, input(draft))} close={closePlan} />
    </div>}
    <section aria-labelledby="planned-heading"><h2 id="planned-heading" tabIndex={-1}>履修計画</h2>
      {!state.graph && <p>{state.admission?.canCreate ? '新規計画を確認して保存してから、制度科目を追加できます。' : '旧データの保護・確認が必要です。空の新規計画を最新の計画として表示しません。'}</p>}
      {state.graph?.attempts.map(attempt => {
        const id = attempt.id;
        const records = recordsByAttempt.get(id) ?? [];
        const attemptInputs = [...unsent].filter(key => key.startsWith(id + '/'));
        const discardAttemptInputs = () => {
          for (const key of attemptInputs) markUnsent(key, false);
        };
        return <article id={'attempt-' + id} tabIndex={-1} data-attempt-id={id} key={resetInputs + ':' + id} className="attempt-record">
          <h3>{attempt.originalTitle}</h3>
          <p>科目対応: {attempt.identity.status} / 本人適用: {attempt.applicability.status} / 卒業算入: 下の条件付き計算で確認</p>
          <p>予定年度: {attempt.plan?.plannedYear ?? '未設定'} / 状態: {attempt.plan?.status ?? '未設定'} / {attempt.membership.kind === 'active' ? '計画内' : '計画から除外（記録保持）'}</p>
          {attempt.membership.kind === 'active' ? <>
            <button disabled={locked || !attempt.plan || attemptInputs.length > 0} onClick={() => {
              if (closePlan(true)) setEditing(id);
            }}>履修記録を編集</button>
            {editing === id && <AttemptPlanForm onUnsent={() => markUnsent('plan', true)} attempt={attempt} title={attempt.originalTitle} disabled={locked} locked={locked}
              save={async draft => controller.update(id, input(draft))} close={closePlan} />}
            <AttemptProgressEditor attempt={attempt} records={records} disabled={locked || editing === id}
              onUnsent={(kind, value) => markUnsent(id + '/' + kind, value)}
              save={(kind, raw) => controller.progress(id, raw, kind)} />
            <div onChange={() => markUnsent(id + '/credits', true)}>
              <RecordedContributionForm attempt={attempt} disabled={locked || editing === id || !attempt.plan} save={raw => {
                const staged = controller.recordContribution(id, raw);
                if (staged) markUnsent(id + '/credits', false);
                return staged;
              }} />
            </div>
            <button disabled={locked} onClick={() => {
              if (attemptInputs.length && !window.confirm('この履修回の送信していない入力を破棄しますか？')) return;
              if (editing === id && !closePlan(true)) return;
              if (controller.remove(id)) discardAttemptInputs();
            }}>計画から削除</button>
          </> : <button disabled={locked || !attempt.membership.deletionOperationId} onClick={() => controller.undo(id)}>この履修回をUndo</button>}
          <details><summary>保持する記録と進捗</summary><pre>{JSON.stringify({ attempt, records }, null, 2)}</pre></details>
        </article>;
      })}
      <p>通信・メディアの進捗と本人評価は履修回ごとの記録です。日付付き評価の既存 ID を保持します。</p>
    </section>
    <RecordedGraduationView state={state} calculate={controller.calculate} />
    <p>旧Plannerは旧schema22を保存します。新Attemptの取込・バックアップ先には使えません。旧側を変更した場合、新側では原文の再照合が必要です。</p>
    <Link to="/planner">旧schema22 Planner（別保存）</Link>
  </article>;
}
