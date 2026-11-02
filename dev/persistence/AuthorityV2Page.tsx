import { useEffect, useRef, useState } from 'react';
import { createPersistentAttemptSession, type PersistentHandle, type PersistentPreview, type BackupInspection } from '../../src/planner/attempts/persistence/persistentSession';
import { createIndexedDbAttemptStore } from '../../src/planner/attempts/persistence/indexedDb';
import type { Command } from '../../src/planner/attempts/workbench/operations';
import { Workbench } from '../attempts/Workbench';
import { loadMigrationEnvironment } from '../attempts/fixtures';
import { buttonClass, inputClass } from '../attempts/Fields';
type Controller = ReturnType<typeof createPersistentAttemptSession>;
function download(name: string, raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function AuthorityV2Page() {
  const [api, setApi] = useState<Controller | null>(null), [loaded, setLoaded] = useState<PersistentHandle | null>(null);
  const [proposed, setProposed] = useState<PersistentPreview | null>(null), [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('読込中'), [busy, setBusy] = useState(false);
  const [protectedFile, setProtectedFile] = useState(false), [confirmed, setConfirmed] = useState(false), [adopted, setAdopted] = useState(false);
  const [epoch, setEpoch] = useState(0), [diagnostic, setDiagnostic] = useState('');
  const commands = useRef<Command[]>([]);
  useEffect(() => {
    let alive = true;
    const controller = createPersistentAttemptSession(createIndexedDbAttemptStore(indexedDB), navigator.locks, loadMigrationEnvironment);
    setApi(controller);
    void controller.load().then(h => { if (alive) { setLoaded(h); setNotice(h ? '確定保存を再読込しました' : '隔離hostは空です'); } })
      .catch(e => { if (alive) { setError(`再読込拒否: ${String(e)}`); setNotice('原文保護を利用できます'); } });
    return () => { alive = false; };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(`${String(e)}。確定表示は進めません。結果不明の場合は再読込してください。`); }
    finally { setBusy(false); }
  }
  function preview(p: PersistentPreview) { setProposed(p); setProtectedFile(false); setConfirmed(false); setAdopted(false); }
  return <main className="mx-auto max-w-6xl space-y-5 px-3 py-6 text-slate-900">
    <h1 className="text-2xl font-bold">3C-0b PR4 authority v2 隔離検証</h1>
    <p>開発専用。通常v22・Worker・卒業計算は未接続です。ファイルのSHAとcoverage宣言は発行者の認証ではありません。</p>
    <a href="/__dev/persistence">旧rule1の移行・backup v1/v2/v3検証画面</a>
    {error && <p role="alert" className="break-all border border-red-600 p-3">{error}</p>}
    <p role="status">{notice}</p>
    <p data-testid="saved-state">確定表示: {loaded ? `rule ${loaded.state.rule.version} / ${loaded.saveStatus} / receipt ${loaded.state.history.commands.length}` : 'なし'}</p>
    <fieldset disabled={!api || busy} className="min-w-0 space-y-3 border p-3"><legend>host確認と原文保護</legend>
      <button className={buttonClass} onClick={() => run(async () => download('yi06-current-protection.json', await api!.protectCurrent()))}>現在rawを保護（破損時も可）</button>
      <button className={buttonClass} onClick={() => run(async () => { const h = await api!.load(); setLoaded(h); setProposed(null); commands.current = []; setEpoch(n => n + 1); setNotice('確定保存を再読込しました'); })}>確定保存を再読込</button>
      <button className={buttonClass} onClick={() => run(async () => preview(await api!.prepareNewPlan()))}>native-v2 新規計画preview</button>
      <button className={buttonClass} onClick={() => run(async () => {
        const result = await api!.previewLegacyMigration();
        if ('status' in result) { setDiagnostic(JSON.stringify(result.migration, null, 2)); setNotice('移行held。自動修復しません'); setProposed(null); }
        else { preview(result); setDiagnostic(JSON.stringify(result.migration, null, 2)); }
      })}>現在rule1を明示移行preview</button>
      {loaded && <details><summary>現在state・coverageの全値</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ state: loaded.state, coverage: loaded.coverage }, null, 2)}</pre></details>}
      {diagnostic && <details><summary>移行診断と許可差分</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{diagnostic}</pre></details>}
    </fieldset>
    <fieldset disabled={!api || busy} className="min-w-0 space-y-3 border p-3"><legend>backup</legend>
      <button className={buttonClass} disabled={!loaded} onClick={() => run(async () => download('yi06-backup-v4.json', await api!.createBackup(loaded!)))}>確定状態をbackup v4 export</button>
      <label className="block">backup inspect<input className={inputClass} type="file" accept=".json" onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ''; setInspection(null); setProposed(null);
        if (file) void run(async () => { const i = await api!.inspectBackup(await file.text()); setInspection(i); setNotice(i.backupKind === 'v4' ? 'v4内容検証済み。保存資格は未発行です' : '旧backup内容検証済み。rule1画面での明示復元を使用してください'); });
      }} /></label>
      {inspection && <><p>{inspection.backupKind} / {inspection.saveAuthority}</p><button className={buttonClass} disabled={inspection.backupKind !== 'v4'} onClick={() => run(async () => preview(await api!.prepareRestore(inspection)))}>選択ファイルを復元preview</button></>}
    </fieldset>
    {proposed && <fieldset disabled={busy} className="min-w-0 space-y-3 border-2 border-indigo-600 p-4"><legend>全件置換の明示確認</legend>
      <p>操作: {proposed.action} / {proposed.bytes.toLocaleString()} bytes / coverage: {typeof proposed.handle.coverage === 'string' ? proposed.handle.coverage : proposed.handle.coverage.kind}</p>
      <p>legacy-unprovenは移行後も通常編集保存を停止します。元の失われた履歴の完全性は証明できません。</p>
      <details><summary>置換前authority・元source・候補全値</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ previous: proposed.previousAuthority, source: proposed.sourceRaw, candidate: proposed.handle.state }, null, 2)}</pre></details>
      <button className={buttonClass} onClick={() => {
        download('yi06-replacement-originals.json', JSON.stringify({ format: 'hosei-yi06-protection', protectionVersion: 1,
          previousAuthority: proposed.previousAuthority, previousRaw: proposed.previousRaw, sourceRaw: proposed.sourceRaw, backupRaw: proposed.backupRaw })); setProtectedFile(true);
      }}>置換前authority・source・選択原文を保護</button>
      {proposed.backupRaw !== null && <label className="block"><input type="checkbox" disabled={!protectedFile} checked={adopted} onChange={e => setAdopted(e.target.checked)} />発行者未認証の選択ファイルを復旧元として採用する</label>}
      <label className="block"><input type="checkbox" disabled={!protectedFile} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />保護ファイルと差分を確認し、全件置換を確定する</label>
      <button className={buttonClass} disabled={!confirmed || proposed.backupRaw !== null && !adopted} onClick={() => run(async () => {
        const h = await api!.commit(proposed, { confirmed, protectedRaw: proposed.previousRaw, protectedSourceRaw: proposed.sourceRaw,
          ...(adopted ? { acceptedBackupRawSha256: proposed.backupRawSha256!, protectedBackupRaw: proposed.backupRaw! } : {}) });
        setLoaded(h); setProposed(null); setInspection(null); commands.current = []; setEpoch(n => n + 1); setNotice('隔離保存と正規再読込が完了しました');
      })}>確認してv2保存</button>
      <button className={buttonClass} onClick={() => setProposed(null)}>取消</button>
    </fieldset>}
    {loaded?.saveStatus === 'native-v2-save-authorized' && api && <fieldset disabled={busy || !!proposed} className="min-w-0"><legend>native同期編集</legend>
      <button className={buttonClass} onClick={() => run(async () => preview(await api.prepareEdits(loaded, commands.current)))}>編集を保存preview</button>
      <Workbench key={epoch} identities={api.identities(loaded)} mode={loaded.source.kind === 'new-plan' ? 'institutional-search' : 'legacy-migration'} seed={{ workspace: loaded.workspace, context: loaded.source.context }} dispatch={(w, c) => api.dispatch(loaded, w, c)} onCommand={c => { commands.current.push(c); }} />
    </fieldset>}
  </main>;
}
