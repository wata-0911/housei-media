import { useEffect, useRef, useState } from 'react';
import { createAttemptPersistence, type PersistenceHandle, type PersistencePreview } from '../../src/planner/attempts/persistence/controller';
import { createIndexedDbAttemptStore } from '../../src/planner/attempts/persistence/indexedDb';
import { heldDates, type MigrationSession, type DateCorrection } from '../../src/planner/attempts/workbench/migrationSession';
import type { Command } from '../../src/planner/attempts/workbench/operations';
import { Workbench } from '../attempts/Workbench';
import { loadMigrationEnvironment, fixtureRaw, type FixtureName } from '../attempts/fixtures';
import { buttonClass, Field, inputClass } from '../attempts/Fields';

type Controller = ReturnType<typeof createAttemptPersistence>;
function download(name: string, raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PersistencePage() {
  const [api, setApi] = useState<Controller | null>(null), [loaded, setLoaded] = useState<PersistenceHandle | null>(null);
  const [session, setSession] = useState<MigrationSession | null>(null), [proposed, setProposed] = useState<PersistencePreview | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [epoch, setEpoch] = useState(0);
  const [fixture, setFixture] = useState<FixtureName>('ready'), [raw, setRaw] = useState('');
  const [protectedFile, setProtectedFile] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [date, setDate] = useState('2028-02-29'), [dateNull, setDateNull] = useState(false), [correction, setCorrection] = useState<DateCorrection | null>(null), [dateConfirmed, setDateConfirmed] = useState(false);
  const commands = useRef<Command[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const controller = createAttemptPersistence(createIndexedDbAttemptStore(indexedDB), navigator.locks, await loadMigrationEnvironment());
        if (active) setApi(controller);
        const current = await controller.load();
        if (active) { setApi(controller); setLoaded(current); setNotice(current ? '隔離保存を再検証して読み込みました。' : '隔離保存は空です。明示移行から開始してください。'); }
      } catch (e) { if (active) setError(`再読込拒否。原文は変更していません。${String(e)}`); }
    })();
    return () => { active = false; };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  function showPreview(value: PersistencePreview) { setProposed(value); setProtectedFile(false); setConfirmed(false); }
  async function inspect(value: string) {
    const next = await api!.inspectLegacy(value); setSession(next); setCorrection(null); setProposed(null);
    if (next.preview?.status === 'ready') showPreview(await api!.prepareMigration(next));
  }
  const held = session ? heldDates(session) : [];
  return <main className="mx-auto max-w-6xl space-y-5 px-3 py-6 text-slate-900">
    <header><h1 className="text-2xl font-bold">YI-06 隔離保存・復旧</h1><p>開発・テスト専用。通常のv22とは別のDBです。卒業計算・一般公開は未接続です。</p><p>同じブラウザで確定保存した履歴だけ復元できます。別端末・DB消失後の新backupは未検証として拒否します。</p></header>
    {error && <p role="alert" className="whitespace-pre-wrap break-all border border-red-600 p-3">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button className={buttonClass} disabled={!api || busy} onClick={() => run(async () => download('yi06-current-original.json', await api!.protectCurrent()))}>現在の隔離保存原文を保護（検証失敗時も可）</button>
    <p data-testid="loaded-count">確定保存: {loaded ? `${loaded.state.graph.attempts.length} Attempt / receipt ${loaded.state.history.commands.length}` : 'なし'}</p>
    <fieldset disabled={busy || !api} className="min-w-0 space-y-4">
      <legend className="font-bold">旧v22 / backup v1・v2 の明示移行</legend>
      <Field label="移行fixture"><select className={inputClass} value={fixture} onChange={e => setFixture(e.target.value as FixtureName)}><option value="ready">正常v22（合成）</option><option value="held-day">不正日 2027-02-30</option><option value="held-month">不正月 2027-99-99</option><option value="rejected">未対応版</option></select></Field>
      <button className={buttonClass} onClick={() => run(() => inspect(fixtureRaw(fixture)))}>fixtureを移行preview</button>
      <Field label="旧原文JSON"><textarea className={inputClass} rows={3} value={raw} onChange={e => setRaw(e.target.value)} /></Field>
      <button className={buttonClass} onClick={() => run(() => inspect(raw))}>旧原文を移行preview</button>
      {session && <p>移行結果: {session.preview?.status ?? session.decoded.status}</p>}
      {session && <details><summary>移行元の原文・診断</summary><pre data-testid="source-original" className="max-h-60 overflow-auto whitespace-pre-wrap break-all">{session.raw}</pre><pre className="overflow-auto">{JSON.stringify(session.preview?.diagnostics ?? session.decoded.diagnostics, null, 2)}</pre></details>}
      {held.length > 0 && <section className="space-y-2"><p>旧owner: {held[0].offeringId} / assessment: {held[0].assessmentId} / 原日付: {held[0].date}</p>
        <Field label="日付の修正案"><input className={inputClass} value={date} onChange={e => { setDate(e.target.value); setCorrection(null); }} /></Field>
        <label><input type="checkbox" checked={dateNull} onChange={e => { setDateNull(e.target.checked); setCorrection(null); }} />明示nullにする</label>
        <button className={buttonClass} onClick={() => run(async () => { setCorrection(await api!.proposeDate(session!, held[0].offeringId, held[0].assessmentId, dateNull ? null : date)); setDateConfirmed(false); })}>修正案を比較</button>
        {correction && <div><p>{correction.oldDate} → {correction.newDate ?? 'null'}。別source・新ID割当。元rawと元ID表を保持します。</p><label><input type="checkbox" checked={dateConfirmed} onChange={e => setDateConfirmed(e.target.checked)} />原値・修正案・新IDを確認しました</label><button className={buttonClass} disabled={!dateConfirmed} onClick={() => run(async () => {
          const next = await api!.confirmDate(session!, correction, true); setSession(next); setCorrection(null);
          if (next.preview?.status === 'ready') showPreview(await api!.prepareMigration(next));
        })}>確認した日付を再decode</button></div>}
      </section>}
      <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={!loaded} onClick={() => run(async () => showPreview(await api!.prepareEdits(loaded!, commands.current)))}>編集の保存preview</button>
        <button className={buttonClass} disabled={!loaded} onClick={() => run(async () => download('yi06-backup.json', await api!.createBackup(loaded!)))}>確定状態の新backupを書き出す</button></div>
      <Field label="新backupファイル"><input type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(async () => showPreview(await api!.inspectBackup(await file.text()))); }} /></Field>
    </fieldset>
    {proposed && <fieldset disabled={busy} className="min-w-0 space-y-3 rounded border-2 border-indigo-600 p-4"><legend>確定前の比較（全件置換）</legend>
      <p>操作: {proposed.action} / 保存JSON: {proposed.bytes.toLocaleString()} bytes</p>
      <p>旧計画 {proposed.handle.source.state.items.length} → active {proposed.handle.state.graph.attempts.filter(a => a.membership.kind === 'active').length} / detached {proposed.handle.state.graph.attempts.filter(a => a.membership.kind === 'detached').length} / owner付き記録 {proposed.handle.state.graph.ownedRecords.length} / receipt {proposed.handle.state.history.commands.length}</p>
      <p>公式原行 {proposed.handle.state.retained.importedCourseAchievements.length} 件。元sourceの全field往復検証と編集履歴の再実行を確認済み。初期移行の元数量と非Attempt情報を保持します。</p>
      <details><summary>公式数量・非Attempt情報・対応台帳</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ retained: proposed.handle.state.retained, ledger: proposed.handle.state.ledger, verification: proposed.handle.state.verification }, null, 2)}</pre></details>
      <button className={buttonClass} onClick={() => { download('yi06-original-protection.json', JSON.stringify({ format: 'hosei-yi06-protection', protectionVersion: 1, previousRaw: proposed.previousRaw, sourceRaw: proposed.sourceRaw, corrections: proposed.handle.state.corrections })); setProtectedFile(true); }}>置換前原文・移行元を保護ファイルに保存</button>
      <label className="block"><input type="checkbox" disabled={!protectedFile} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />保護ファイルの保存先と比較内容を確認し、隔離保存の全件置換に同意します</label>
      <button className={buttonClass} disabled={!confirmed} onClick={() => run(async () => {
        const next = await api!.commit(proposed, true, proposed.previousRaw, proposed.sourceRaw);
        setLoaded(next); commands.current = []; setEpoch(n => n + 1); setProposed(null); setSession(null); setNotice('隔離保存が完了しました。再読込でも同じID・履歴を維持します。');
      })}>確認して隔離保存</button>
      <button className={buttonClass} onClick={() => setProposed(null)}>取消（保存しない）</button>
    </fieldset>}
    {loaded && api && <fieldset disabled={busy || proposed !== null} className="min-w-0"><legend>編集draft（保存preview後に確定）</legend><Workbench key={epoch} seed={{ workspace: loaded.workspace, context: loaded.source.context }} dispatch={(workspace, command) => api.dispatch(loaded, workspace, command)} onCommand={command => { commands.current.push(command); }} /></fieldset>}
  </main>;
}
