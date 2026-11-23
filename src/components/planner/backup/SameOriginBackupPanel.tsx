import { useEffect, useRef, useState } from 'react';
import type { AuthorityView, SameOriginAuthority } from '../../../planner/candidate2026/sameOriginAuthority';

type GradeDraft = Readonly<{ revision: number; present: boolean }>;

type Props = { authority: SameOriginAuthority; disabled: boolean;
  gradeDraft: GradeDraft; readGradeDraft: () => GradeDraft;
  onRestored: (next: AuthorityView) => void; onBusyChange: (busy: boolean) => void };

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const draftHoldMessage = '成績取込の下書きが変わったため、復元の同意を取り消しました。入力とプレビューは残っています。';

export default function SameOriginBackupPanel({ authority, disabled, gradeDraft, readGradeDraft, onRestored, onBusyChange }: Props) {
  type Receipt = Awaited<ReturnType<SameOriginAuthority['prepareRestore']>>;
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [protection, setProtection] = useState<File | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<number | null>(null);
  const verified = verifiedAt === gradeDraft.revision;
  const [confirmedAt, setConfirmedAt] = useState<number | null>(null);
  const confirmed = !gradeDraft.present && confirmedAt === gradeDraft.revision;
  const [error, setError] = useState('');
  const operation = useRef(0);
  useEffect(() => () => { ++operation.current; authority.cancelRestore(); }, [authority]);

  function cancel() {
    ++operation.current; authority.cancelRestore();
    setReceipt(null); setSource(null); setProtection(null); setVerifiedAt(null); setConfirmedAt(null);
  }
  async function run(action: () => Promise<void> | void) {
    setError('');
    try { await action(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : '操作を保留しました。'); }
  }
  async function prepare(file: File) {
    cancel();
    const revision = operation.current;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (revision !== operation.current) return;
    const next = await authority.prepareRestore(bytes);
    if (revision === operation.current) setReceipt(next);
  }
  async function compare() {
    if (!receipt || !source || !protection) return;
    const revision = operation.current;
    const draftRevision = readGradeDraft().revision;
    const [input, original] = await Promise.all([source.arrayBuffer(), protection.arrayBuffer()]);
    if (revision !== operation.current) return;
    await authority.verifyRestore(receipt, new Uint8Array(input), new Uint8Array(original));
    if (revision === operation.current && readGradeDraft().revision === draftRevision) setVerifiedAt(draftRevision);
  }
  async function restore() {
    if (!receipt || !verified || confirmedAt === null) return;
    const revision = operation.current;
    const draftStillCurrent = () => {
      const current = readGradeDraft();
      return !current.present && current.revision === confirmedAt;
    };
    if (!draftStillCurrent()) throw new Error(draftHoldMessage);
    onBusyChange(true);
    try {
      const result = await authority.restore(receipt, () => revision === operation.current && draftStillCurrent());
      if (revision === operation.current) { cancel(); onRestored(result); }
    } catch (problem) {
      // The authority consumes the receipt when a restore starts.
      if (revision !== operation.current) return;
      cancel();
      if (!draftStillCurrent()) throw new Error(draftHoldMessage);
      throw problem;
    } finally { onBusyChange(false); }
  }

  return <section aria-label="新しい保存先のバックアップ" className="space-y-2 border border-gray-300 p-4">
    <h3 className="font-medium">バックアップと復元</h3>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={disabled} onClick={() => void run(() => authority.exportAuthority(text => download(text, 'hosei-planner-2026-backup.json')))}>新版の通常バックアップ</button>
      <button type="button" disabled={disabled} onClick={() => void run(() => authority.authorityOriginal(text => download(text, 'hosei-planner-2026-original.json')))}>新版の保存原文（保護用）</button>
      <button type="button" disabled={disabled} onClick={() => void run(() => authority.legacyBackup(text => download(text, 'hosei-planner-legacy-backup.json')))}>旧版の通常バックアップ</button>
      <button type="button" disabled={disabled} onClick={() => void run(() => authority.legacyOriginals(text => download(text, 'hosei-planner-legacy-originals.json')))}>旧保存と退避の原文（保護用）</button>
    </div>
    <label className="block">移行・復元する通常バックアップを選択
      <input type="file" accept=".json,application/json" disabled={disabled}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(() => prepare(file)); }} />
    </label>
    {receipt && <div className="space-y-2">
      <p>現在 → 選択ファイル: 計画 {receipt.current.planned} → {receipt.incoming.planned}、公式行 {receipt.current.official} → {receipt.incoming.official}、本人進捗 {receipt.current.tracks} → {receipt.incoming.tracks}</p>
      <p>{receipt.changed.length ? '変更がある項目：' + receipt.changed.join('、') : '保存内容に差分はありません。確定すると新しい保存世代になります。'}</p>
      <button type="button" disabled={disabled} onClick={() => void run(() => authority.protectionFile(receipt, text => download(text, 'hosei-planner-before-restore.json')))}>対象原文の保護ファイルを保存</button>
      <label className="block">同じ入力ファイルを再選択
        <input type="file" accept=".json,application/json" disabled={disabled}
          onChange={event => { ++operation.current; setVerifiedAt(null); setConfirmedAt(null); setSource(event.target.files?.[0] ?? null); }} />
      </label>
      <label className="block">保存した保護ファイルを再選択
        <input type="file" accept=".json,application/json" disabled={disabled}
          onChange={event => { ++operation.current; setVerifiedAt(null); setConfirmedAt(null); setProtection(event.target.files?.[0] ?? null); }} />
      </label>
      <button type="button" disabled={disabled || !source || !protection} onClick={() => void run(compare)}>全バイトを照合</button>
      {confirmedAt !== null && !confirmed && <p role="alert">{draftHoldMessage}</p>}
      <label className="block"><input type="checkbox" disabled={disabled || !verified || gradeDraft.present} checked={confirmed} onChange={event => {
        const draft = readGradeDraft();
        setConfirmedAt(event.target.checked && !draft.present && verifiedAt === draft.revision ? draft.revision : null);
      }} /> 対象を確認して移行・復元する</label>
      <button type="button" disabled={disabled || !confirmed || !verified} onClick={() => void run(restore)}>移行・復元を確定</button>
      <button type="button" disabled={disabled} onClick={cancel}>キャンセル</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {gradeDraft.present && <p><a href="#grade-import">成績取込の下書きを確認</a>。復元する場合は、下書きを保存するか、確認して破棄した後で、ファイルを再照合して同意してください。</p>}
  </section>;
}
