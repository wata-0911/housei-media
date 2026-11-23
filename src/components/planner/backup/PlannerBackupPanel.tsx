import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlannerCatalog } from '../../../planner/plannerCatalog';
import { backupSummary, createPlannerBackup, parsePlannerBackup, type PlannerBackup } from '../../../planner/backup/plannerBackup';
import { restorePlannerBackupWithIntent } from '../../../planner/backup/plannerBackupStorage';
import { createPlannerBackupProtection } from '../../../planner/backup/plannerBackupProtection';
import { BACKUP_KEY, STORAGE_KEY, type LoadResult } from '../../../planner/backup/storage';

type Props = { catalog: PlannerCatalog; loaded: LoadResult; disabled: boolean; onRestored: (next: LoadResult) => void; onBusyChange: (busy: boolean) => void };
type Preview = { text: string; backup: PlannerBackup; expectedRaw: string | null; recoveryRaw: string | null; storageVersion: number };
type RestoreProtection = { preview: Preview; file: File };
type RestoreReceipt = { preview: Preview; selection: number; consentVersion: number; mountGeneration: number; catalog: PlannerCatalog; route: string; protection: RestoreProtection | null };
type Prepared = { file: File; sourceRaw: string | null };
const buttonClass = 'planner-button border border-[#002255] px-3 py-2 text-sm text-[#002255] disabled:opacity-50';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作できませんでした。保存設定と空き容量を確認してください。';

export default function PlannerBackupPanel({ catalog, loaded, disabled, onRestored, onBusyChange }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [download, setDownload] = useState<{ file: File; url: string } | null>(null);
  const [restoreProtection, setRestoreProtection] = useState<RestoreProtection | null>(null);
  const [restoreDownload, setRestoreDownload] = useState<{ protection: RestoreProtection; url: string } | null>(null);
  const [protectionVerified, setProtectionVerified] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [protectionNeeded, setProtectionNeeded] = useState(false);
  const [working, setWorking] = useState(false);
  const selection = useRef(0);
  const restoring = useRef(false);
  const storageVersion = useRef(0);
  const mounted = useRef(false);
  const mountGeneration = useRef(0);
  const currentPreview = useRef<Preview | null>(null);
  const currentConfirmed = useRef(false);
  const consentVersion = useRef(0);
  const currentCatalog = useRef(catalog);
  const currentLoadedRaw = useRef(loaded.raw);
  const activeRestore = useRef<RestoreReceipt | null>(null);
  const protectionVersion = useRef(0);
  const preparedProtection = useRef<RestoreProtection | null>(null);
  const verifiedProtection = useRef<RestoreProtection | null>(null);
  useLayoutEffect(() => {
    mounted.current = true; mountGeneration.current += 1;
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (event.key === null || event.key === STORAGE_KEY || event.key === BACKUP_KEY)) {
        storageVersion.current += 1;
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      mounted.current = false; mountGeneration.current += 1; activeRestore.current = null;
    };
  }, []);
  useLayoutEffect(() => { currentCatalog.current = catalog; currentLoadedRaw.current = loaded.raw; }, [catalog, loaded.raw]);
  useEffect(() => {
    if (!prepared) return;
    const url = URL.createObjectURL(prepared.file); setDownload({ file: prepared.file, url });
    return () => URL.revokeObjectURL(url);
  }, [prepared]);
  useEffect(() => {
    if (!restoreProtection) return;
    const url = URL.createObjectURL(restoreProtection.file);
    setRestoreDownload({ protection: restoreProtection, url });
    return () => URL.revokeObjectURL(url);
  }, [restoreProtection]);
  const stalePreview = preview !== null && preview.expectedRaw !== loaded.raw;
  const staleFile = prepared !== null && prepared.sourceRaw !== loaded.raw;
  const summary = preview ? backupSummary(preview.backup) : null;

  function currentRaw() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== loaded.raw) throw new Error('別の画面で保存データが変更されました。再読み込みしてください。');
    return raw;
  }
  async function prepareBackup() {
    setWorking(true); setError(''); setPrepared(null);
    try {
      const raw = currentRaw();
      const backup = await createPlannerBackup(raw, catalog);
      if (window.localStorage.getItem(STORAGE_KEY) !== raw) throw new Error('準備中に保存データが変更されました。再読み込みしてください。');
      const file = new File([JSON.stringify(backup, null, 2)], `hosei-planner-backup-${backup.createdAt.slice(0, 10)}.json`, { type: 'application/json' });
      setPrepared({ file, sourceRaw: raw }); setProtectionNeeded(false); setMessage('JSONを準備しました。共有・保存、またはダウンロードを選択してください。');
    } catch (error) { setError(errorMessage(error)); setProtectionNeeded(true); }
    finally { setWorking(false); }
  }
  async function prepareOriginal() {
    setWorking(true); setPrepared(null);
    try {
      const raw = currentRaw();
      const recoveryRaw = window.localStorage.getItem(BACKUP_KEY);
      const protection = await createPlannerBackupProtection(raw, recoveryRaw, catalog);
      if (window.localStorage.getItem(STORAGE_KEY) !== raw || window.localStorage.getItem(BACKUP_KEY) !== recoveryRaw) throw new Error('保護ファイル準備中に原文が変更されました。再読み込みしてください。');
      setPrepared({ file: new File([JSON.stringify(protection, null, 2)], 'hosei-planner-protection.json', { type: 'application/json' }), sourceRaw: raw });
      setError(''); setProtectionNeeded(true); setMessage('主キー原文・旧recovery原文・作成時カタログを改変せず保護ファイルに収録しました。正常バックアップとしては復元できません。保存先のファイルを確認してください。個人データ・未知の情報が含まれる可能性があります。');
    } catch (error) { setError(errorMessage(error)); }
    finally { setWorking(false); }
  }
  async function share() {
    if (!prepared || staleFile) return;
    try {
      // Invoke directly from the user gesture; the File was prepared earlier.
      if (!navigator.canShare?.({ files: [prepared.file] }) || !navigator.share) {
        setMessage('このブラウザでは共有できません。ファイルをダウンロードしてください。'); return;
      }
      await navigator.share({ files: [prepared.file] });
      setMessage('共有画面を閉じました。保存先でファイルを確認してください。');
    } catch (error) { setMessage(error instanceof Error && error.name === 'AbortError' ? '共有をキャンセルしました。' : '共有できませんでした。ファイルをダウンロードしてください。'); }
  }
  function invalidateProtection() {
    protectionVersion.current += 1;
    verifiedProtection.current = null;
    currentConfirmed.current = false;
    consentVersion.current += 1;
    setProtectionVerified(false);
    setConfirmed(false);
  }

  function clearPreview() {
    selection.current += 1;
    currentPreview.current = null;
    preparedProtection.current = null;
    invalidateProtection();
    setPreview(null);
    setRestoreProtection(null);
    setError('');
    setMessage('');
  }

  function assertSnapshot(target: Preview) {
    if (storageVersion.current !== target.storageVersion || currentLoadedRaw.current !== target.expectedRaw ||
      window.localStorage.getItem(STORAGE_KEY) !== target.expectedRaw ||
      window.localStorage.getItem(BACKUP_KEY) !== target.recoveryRaw) {
      throw new Error('保存データまたは退避データが変更されました。再読み込みしてください。');
    }
  }

  async function prepareRestoreProtection() {
    if (!preview || preview.expectedRaw === null || loaded.error || stalePreview || disabled) return;
    const target = preview;
    invalidateProtection();
    preparedProtection.current = null;
    setRestoreProtection(null);
    setWorking(true);
    setError('');
    const version = protectionVersion.current;
    const generation = mountGeneration.current;
    const isCurrent = () => mounted.current && mountGeneration.current === generation &&
      currentPreview.current === target && currentCatalog.current === catalog &&
      protectionVersion.current === version;
    try {
      assertSnapshot(target);
      const envelope = await createPlannerBackupProtection(target.expectedRaw, target.recoveryRaw, catalog);
      if (!isCurrent()) return;
      assertSnapshot(target);
      const file = new File([JSON.stringify(envelope, null, 2)], 'hosei-planner-restore-protection.json', { type: 'application/json' });
      const protection = { preview: target, file };
      preparedProtection.current = protection;
      setRestoreProtection(protection);
    } catch (error) {
      if (isCurrent()) setError(errorMessage(error));
    } finally {
      if (mounted.current && mountGeneration.current === generation) setWorking(false);
    }
  }

  async function verifyRestoreProtection(file: File) {
    invalidateProtection();
    setError('');
    const target = preparedProtection.current;
    if (!target || disabled || target.preview !== currentPreview.current) return;
    const version = protectionVersion.current;
    const generation = mountGeneration.current;
    const isCurrent = () => mounted.current && mountGeneration.current === generation &&
      currentPreview.current === target.preview && preparedProtection.current === target &&
      currentCatalog.current === catalog && protectionVersion.current === version;
    try {
      if (file.size !== target.file.size) throw new Error('再選択したファイルが保護ファイルと一致しません。');
      const [selected, prepared] = await Promise.all([file.arrayBuffer(), target.file.arrayBuffer()]);
      if (!isCurrent()) return;
      const expected = new Uint8Array(prepared);
      if (!new Uint8Array(selected).every((byte, i) => byte === expected[i])) {
        throw new Error('再選択したファイルが保護ファイルと一致しません。');
      }
      assertSnapshot(target.preview);
      verifiedProtection.current = target;
      setProtectionVerified(true);
    } catch (error) {
      if (isCurrent()) setError(errorMessage(error));
    }
  }

  async function selectFile(file: File) {
    clearPreview();
    const id = selection.current;
    const generation = mountGeneration.current;
    const isCurrent = () => mounted.current && mountGeneration.current === generation &&
      currentCatalog.current === catalog && id === selection.current;
    try {
      if (loaded.error) throw new Error('現在の保存データを確認できないため、全件復元できません。');
      const expectedRaw = currentRaw();
      const recoveryRaw = window.localStorage.getItem(BACKUP_KEY);
      const version = storageVersion.current;
      const text = await file.text();
      const backup = await parsePlannerBackup(text, catalog);
      if (!isCurrent()) return;
      const nextPreview = { text, backup, expectedRaw, recoveryRaw, storageVersion: version };
      assertSnapshot(nextPreview);
      currentPreview.current = nextPreview; setPreview(nextPreview);
    } catch (error) { if (isCurrent()) setError(errorMessage(error)); }
  }
  async function restore() {
    if (!preview || !confirmed || stalePreview || loaded.error || disabled || restoring.current) return;
    const protection = verifiedProtection.current;
    if (preview.expectedRaw !== null && protection?.preview !== preview) return;
    const receipt: RestoreReceipt = { preview, selection: selection.current, consentVersion: consentVersion.current,
      mountGeneration: mountGeneration.current, catalog, route: window.location.pathname, protection };
    activeRestore.current = receipt;
    const isCurrent = () => mounted.current && mountGeneration.current === receipt.mountGeneration &&
      activeRestore.current === receipt && currentPreview.current === receipt.preview &&
      currentConfirmed.current && consentVersion.current === receipt.consentVersion &&
      verifiedProtection.current === receipt.protection &&
      selection.current === receipt.selection && currentCatalog.current === receipt.catalog &&
      currentLoadedRaw.current === receipt.preview.expectedRaw && window.location.pathname === receipt.route;
    restoring.current = true; onBusyChange(true); setError('');
    let committed = false;
    try {
      const next = await restorePlannerBackupWithIntent(window.localStorage, preview.text, preview.expectedRaw, catalog, navigator.locks,
        () => isCurrent() && storageVersion.current === preview.storageVersion, { recoveryRaw: preview.recoveryRaw });
      committed = true;
      if (!isCurrent()) return;
      onRestored(next); clearPreview(); setPrepared(null);
      setMessage('全データを置き換えて保存しました。再読み込み後も保持されます。');
    } catch (error) {
      if (isCurrent()) setError(committed ? '復元は保存されましたが、画面を更新できませんでした。再読み込みしてください。' : `${errorMessage(error)} 復元は反映していません。`);
    } finally { activeRestore.current = null; restoring.current = false; if (mounted.current && mountGeneration.current === receipt.mountGeneration) onBusyChange(false); }
  }
  return <section aria-label="プランナー全データのバックアップ・復元" className="min-w-0 space-y-3 border border-[#002255] bg-white p-4 sm:p-5">
    <h2 className="text-lg text-[#002255]">全データのJSONバックアップ・復元</h2>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={disabled || working} onClick={prepareBackup}>現在の全データをJSONで準備（事前バックアップ）</button>
      <button type="button" className={buttonClass} disabled={disabled || working} onClick={prepareOriginal}>原文と旧退避を保護用ファイルに保存</button>
    </div>
    {prepared && !staleFile && download?.file === prepared.file && <div className="flex flex-wrap gap-3">
      <button type="button" className={buttonClass} disabled={disabled} onClick={share}>共有・保存（iPhoneなど）</button>
      <a className={buttonClass} href={download.url} download={prepared.file.name}>ファイルをダウンロード</a>
    </div>}
    {protectionNeeded && <div role="note" className="space-y-2 border border-amber-300 bg-amber-50 p-3 text-sm">
      <p>正常バックアップが作れない場合の保護・復旧手順</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>原文と旧退避の保護ファイルを保存し、保存先にファイルがあることを確認してください。</li>
        <li>保護が済むまで、初期化・ブラウザデータ削除・修復目的の無関係な保存を行わないでください。</li>
        <li>認定値は公式資料と照合し、プロフィール画面で修正対象を明示して直してください。参照・旧v22正規化・版の問題は、元ファイルを保持して対応版の復旧手順を確認してください。</li>
        <li>修正内容を確認して保存後、正常バックアップを再作成してください。保護原文を通常復元へ直接流したり、未確定値を0に置換したりしないでください。</li>
      </ol>
    </div>}
    {staleFile && <p role="status" className="text-sm">データが変更されました。JSONを再準備してください。</p>}
    <label className="block text-sm">復元するJSONファイル<input type="file" accept="application/json,.json" disabled={disabled} className="mt-2 block max-w-full" onClick={clearPreview} ref={node => {
      if (!node) return;
      node.addEventListener('cancel', clearPreview);
      return () => node.removeEventListener('cancel', clearPreview);
    }} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void selectFile(file); }} /></label>
    {preview && summary && <div className="space-y-3 border border-amber-300 bg-amber-50 p-3 text-sm">
      <h3>復元対象の概要</h3>
      <p>作成日時: {preview.backup.createdAt}</p>
      <p>互換性規則v1で原版と現在のカタログを検証しました。stateは移行・再生成せず保持します。</p>
      <p>計画 {summary.plans}件 / 公開科目 {summary.publicCourses}件 / 公式成績 {summary.officialRows}件 / 内訳 {summary.components}件 / TODO {summary.todos}件</p>
      <p>進捗・評価・卒論・プロフィール・手動設定を含む全データで、現在のデータを全件置換します。マージはしません。ブラウザ内の旧recovery退避は保持します。</p>
      {stalePreview && <p role="alert">プレビュー後にデータが変更されました。もう一度ファイルを選択してください。</p>}
      {preview.expectedRaw !== null && <div className="space-y-2">
        <p>現在の保存データを保護します。保護ファイルを端末に保存してから、保存先のファイルを選び直してください。個人データが含まれるため、保存先に注意してください。</p>
        <button type="button" className={buttonClass} disabled={disabled || working || stalePreview} onClick={prepareRestoreProtection}>復元前の保護ファイルを準備する</button>
        {restoreProtection && restoreProtection === restoreDownload?.protection && !stalePreview && <>
          <a className={buttonClass} href={restoreDownload.url} download={restoreProtection.file.name}>復元前の保護ファイルをダウンロード</a>
          <label className="block">保存した保護ファイルを再選択
            <input type="file" accept="application/json,.json" disabled={disabled} className="mt-2 block max-w-full"
              onClick={invalidateProtection} ref={node => {
                if (!node) return;
                node.addEventListener('cancel', invalidateProtection);
                return () => node.removeEventListener('cancel', invalidateProtection);
              }}
              onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void verifyRestoreProtection(file); else invalidateProtection(); }} />
          </label>
          {protectionVerified && <p role="status">再選択した保護ファイルの内容が一致しました。</p>}
        </>}
      </div>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed && !stalePreview} disabled={disabled || stalePreview || (preview.expectedRaw !== null && !protectionVerified)} onChange={event => { currentConfirmed.current = event.target.checked; consentVersion.current += 1; setConfirmed(event.target.checked); }} />他のタブ・画面を閉じ、現在の全データが置き換わることを確認しました</label>
      <button type="button" className={buttonClass} disabled={disabled || !confirmed || stalePreview || (preview.expectedRaw !== null && !protectionVerified)} onClick={restore}>確認したバックアップで全件置換する</button>
    </div>}
    {error && <p role="alert" className="break-words border border-red-300 bg-red-50 p-3 text-sm">{error}</p>}
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </section>;
}
