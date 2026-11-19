import { useEffect, useRef, useState } from 'react';
import { BACKUP_KEY, STORAGE_KEY } from '../backup/storagePrimitives';
import { AUTHORITY } from './atomic-media.mjs';
import type { Ready, Reading, Receipt, Track } from './atomic-media.mjs';
import { download, plannerView, transferSummary, type MediaService } from './planner';
import type { BootPreflight } from './preflight';
import { TrackEditor } from './TrackEditor';

type Transfer = { receipt: Receipt; summary: Awaited<ReturnType<typeof transferSummary>>; file: File; attempt: number };

function sendError(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return '空き容量が不足しています。保存を確定できませんでした。';
  if (error instanceof Error && /Snapshot changed|Operation no longer current/.test(error.message)) {
    return '別の操作で保存状態が変わりました。再読込して確認してください。';
  }
  if (error instanceof Error && /Legacy backup cannot replace/.test(error.message)) return '旧版のバックアップでは既存の本人メディア進捗を置き換えられません。';
  return 'ファイルの形式・版・内容、または保存の前提を確認できませんでした。保存は確定していません。';
}

export function Planner2026({ oldUrl, media, initial, preflight }: { oldUrl: URL; media: MediaService; initial: Reading; preflight: BootPreflight }) {
  const [reading, setReading] = useState(initial);
  const [draft, setDraft] = useState<Transfer | null>(null);
  const [validProof, setValidProof] = useState(false);
  const [consent, setConsent] = useState(false);
  const [startChecked, setStartChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [restoreSync, setRestoreSync] = useState<'checking' | 'unconfirmed' | null>(null);
  const [stale, setStale] = useState(false);
  const [isolationHeld, setIsolationHeld] = useState(false);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [notice, setNotice] = useState('');
  const [noticeRevision, setNoticeRevision] = useState(0);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const locked = useRef(false);
  const approved = useRef<number | null>(null);
  const proofFor = useRef<number | null>(null);
  const proofRead = useRef(0);
  const proofExport = useRef(0);
  const dirtyIds = useRef(new Set<string>());

  function markDirty(id: string, dirty: boolean) {
    if (dirty) dirtyIds.current.add(id);
    else dirtyIds.current.delete(id);
    setDirtyCount(dirtyIds.current.size);
  }

  useEffect(() => {
    const invalidate = () => {
      epoch.current++;
      approved.current = null;
      proofFor.current = null;
      media.cancelRestore();
    };
    const resume = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setDraft(null);
      setValidProof(false);
      setConsent(false);
      setPending(false);
      setStartChecked(false);
      const returnedAt = ++epoch.current;
      setNoticeRevision(value => value + 1);
      setStale(true);
      // Keep the displayed editors and their drafts until the user has dealt
      // with them. A wholesale refresh could remove a UUID from the list.
      if (dirtyIds.current.size) return;
      void media.read().then(current => {
        if (returnedAt !== epoch.current) return;
        setReading(current);
        setStale(false);
      });
    };
    const otherDocumentSaved = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== null && ![AUTHORITY, STORAGE_KEY, BACKUP_KEY].includes(event.key))) return;
      proofExport.current++;
      setNoticeRevision(value => value + 1);
      setStale(true);
    };
    const stop = preflight.subscribe(() => {
      invalidate();
      setIsolationHeld(true);
      setDraft(null);
      setValidProof(false);
      setConsent(false);
    });
    window.addEventListener('pagehide', invalidate);
    window.addEventListener('pageshow', resume);
    window.addEventListener('storage', otherDocumentSaved);
    return () => {
      window.removeEventListener('pagehide', invalidate);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('storage', otherDocumentSaved);
      stop();
      invalidate();
    };
  }, [media, preflight]);

  function clearTransfer() {
    epoch.current++;
    proofRead.current++;
    media.cancelRestore();
    approved.current = null;
    proofFor.current = null;
    setDraft(null);
    setValidProof(false);
    setConsent(false);
    setNotice('');
    setError('');
  }

  async function selectBackup(file: File | null) {
    clearTransfer();
    if (!file || reading.status !== 'ready' || isolationHeld) return;
    if (file.size > 24 * 1024 * 1024) {
      setError('プレビューで扱えるファイルサイズを超えています。');
      return;
    }
    const attempt = epoch.current;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (attempt !== epoch.current) return;
      const receipt = await media.prepareRestore(bytes, reading.capture);
      const summary = await transferSummary(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (attempt === epoch.current) setDraft({ receipt, summary, file, attempt });
    } catch (failure) {
      if (attempt === epoch.current) {
        media.cancelRestore();
        setError(sendError(failure));
      }
    }
  }

  function clearProof() {
    proofRead.current++;
    approved.current = null;
    proofFor.current = null;
    setValidProof(false);
    setConsent(false);
    setError('');
  }

  async function downloadRestoreProtection(target: Transfer) {
    if (stale || isolationHeld || locked.current || target.attempt !== epoch.current) return;
    const request = ++proofExport.current;
    const proofSelection = proofRead.current;
    const isCurrent = () => request === proofExport.current && target.attempt === epoch.current
      && proofSelection === proofRead.current && !locked.current;
    try {
      const bytes = new Uint8Array(await target.file.arrayBuffer());
      if (!isCurrent()) return;
      await media.exportRestoreProtection(target.receipt, bytes, isCurrent,
        raw => download(raw, 'hosei-planner-2026-restore-protection.json'));
    } catch {
      if (!isCurrent()) return;
      clearTransfer();
      setError('保護ファイルを書き出せませんでした。保存状態を確認し、バックアップを選び直してください。');
    }
  }

  async function selectProof(file: File | null, target: Transfer) {
    clearProof();
    if (!file) return;
    const validation = proofRead.current;
    try {
      if (file.size !== new TextEncoder().encode(target.receipt.protectionText).byteLength) throw new Error('Different proof length');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (epoch.current !== target.attempt || validation !== proofRead.current) return;
      await media.verifyProtection(target.receipt, bytes);
      if (epoch.current !== target.attempt || validation !== proofRead.current) return;
      proofFor.current = target.attempt;
      setValidProof(true);
    } catch {
      if (epoch.current === target.attempt && validation === proofRead.current) {
        setError('保護ファイルが、今回の保存先の原文と一致しません。');
      }
    }
  }

  async function reflectCommittedRestore(generation: string, message: string) {
    // Once the write returns a generation, invalidating the transfer cannot undo it.
    setRestoreSync('checking');
    setNoticeRevision(value => value + 1);
    setNotice('復元は確定しました。保存済みの内容を確認しています。');
    let current: Reading | undefined;
    try {
      current = await media.read();
    } catch {
      // A failed read does not change the confirmed write.
    }
    clearTransfer();
    if (current?.status !== 'ready' || current.generation !== generation) {
      setRestoreSync('unconfirmed');
      return false;
    }
    setReading(current);
    setStale(false);
    setStartChecked(false);
    setRestoreSync(null);
    setNotice(message);
    return true;
  }

  async function write(action: () => Promise<string>, attempt: number, confirmation?: { message: string; restored?: boolean }) {
    if (locked.current || isolationHeld || stale || attempt !== epoch.current) return false;
    locked.current = true;
    setPending(true);
    setNotice('');
    setError('');
    try {
      const generation = await action();
      if (confirmation?.restored) return await reflectCommittedRestore(generation, confirmation.message);
      const current = await media.read();
      if (attempt !== epoch.current) return false;
      clearTransfer();
      if (current.status !== 'ready' || current.generation !== generation) {
        setStale(true);
        setNotice('保存は確定しました。その後に保存先が変わったため、現在の内容を確認してください。');
        return false;
      }
      setReading(current);
      setStale(false);
      setStartChecked(false);
      if (confirmation) setNotice(confirmation.message);
      return true;
    } catch (failure) {
      if (attempt === epoch.current) {
        clearTransfer();
        setError(sendError(failure));
      }
      return false;
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  function restore() {
    if (!draft || !validProof || !consent || locked.current || draft.attempt !== epoch.current || proofFor.current !== draft.attempt) return;
    if (dirtyIds.current.size) return;
    const target = draft;
    approved.current = target.attempt;
    void write(() => media.restore(target.receipt,
      () => epoch.current === target.attempt && approved.current === target.attempt && !dirtyIds.current.size), target.attempt,
    { message: 'バックアップを復元しました。', restored: true });
  }

  function saveTrack(track: Track, mode: 'create' | 'edit', base: Ready, matchesDraft: () => boolean = () => true) {
    const attempt = epoch.current;
    return write(() => media.upsertTrack(base.capture, track, mode, () => attempt === epoch.current && matchesDraft()), attempt,
      mode === 'create' ? { message: '本人の履修回を作成しました。' } : undefined);
  }

  async function exportPortable() {
    if (reading.status !== 'ready') return;
    try {
      download(await media.exportPortable(reading.capture), 'hosei-planner-2026-media-v1.json');
    } catch (failure) {
      setError(sendError(failure));
    }
  }

  const plan = reading.status === 'ready' && reading.generation ? plannerView(reading.primaryRaw) : null;
  const editDisabled = pending || restoreSync !== null || draft !== null || stale || isolationHeld;
  return <main>
    <h1>2026年度 履修プランナー</h1>
    {location.hostname === '127.0.0.1' && <p>合成データ検証環境です。実際の成績や本人記録のファイルは選択しないでください。</p>}
    <p>新版 <code>{location.origin}</code> ／ 旧版 <code>{oldUrl.origin}</code></p>
    <p>旧版と新版は別の保存先です。書き戻しや自動同期はありません。旧版では新版の本人履修回を開けません。</p>
    <a className="button" href={oldUrl.href} rel="noreferrer">旧版プランナーへ戻る</a>
    <p role="status">{notice}</p>
    {error && <p role="alert">{error}</p>}
    {restoreSync === 'unconfirmed' && <p role="alert">復元は確定しましたが、保存済みの内容を確認できません。再読込して確認してください。</p>}
    {isolationHeld && <p role="alert">配置の分離を確認できなくなったため、編集・復元・書き出しを保留しました。入力中の下書きはこの画面に残っています。配置の安全条件を確認してから再読込してください。</p>}
    {stale && !isolationHeld && <p role="alert">別のタブで保存状態が変わりました。下書きを控えたうえで再読込して確認してください。</p>}
    {reading.status === 'hold' && <p role="alert">保存の状態を確認できません。原本を保全し、再読込するまで編集と復元は保留します。</p>}
    <section aria-label="バックアップと復元">
      <h2>バックアップと復元</h2>
      <p>旧版の通常JSONで計画を移せます。旧版の退避原文と新版の本人メディア進捗は旧版の通常JSONに含まれません。旧P/R原文の保護ファイルは旧版で別に保存してください。</p>
      <label>移行・復元するバックアップ
        <input type="file" accept=".json,application/json" disabled={pending || restoreSync !== null || stale || isolationHeld || reading.status === 'hold'} onClick={() => clearTransfer()} onChange={event => {
          const input = event.currentTarget;
          void selectBackup(input.files?.[0] ?? null);
          input.value = '';
        }} />
      </label>
      {draft && <section aria-label="復元プレビュー">
        <h3>復元プレビュー</h3>
        <p data-testid="preview-summary">{draft.summary.kind} ／ 計画 {draft.summary.plans}件 ／ 成績 {draft.summary.officialRows}件 ／ 本人履修回 {draft.summary.tracks}件</p>
        <p>選択したファイル <output>{draft.file.name}</output></p>
        <p>保存先の原本を保護するファイルを保存し、そのファイルをここで再選択してください。</p>
        <button type="button" disabled={pending || stale || isolationHeld} onClick={() => void downloadRestoreProtection(draft)}>復元前の保護ファイルを保存</button>
        <label>復元前の保護ファイルを再選択
          <input type="file" accept=".json,application/json" disabled={pending} onClick={() => clearProof()} onChange={event => {
            const input = event.currentTarget;
            void selectProof(input.files?.[0] ?? null, draft);
            input.value = '';
          }} />
        </label>
        {validProof && <p>保護ファイルの全バイトが一致しました。</p>}
        {dirtyCount > 0 && <p>未保存の履修回があります。復元を取り消し、下書きを保存するか破棄してから再試行してください。</p>}
        <label><input type="checkbox" checked={consent} disabled={!validProof || pending || stale || isolationHeld || dirtyCount > 0} onChange={event => setConsent(event.target.checked)} /> 確認したバックアップを新版へ復元する</label>
        <button type="button" disabled={!validProof || !consent || pending || stale || isolationHeld || dirtyCount > 0} onClick={restore}>復元を確定</button>
        <button type="button" disabled={restoreSync !== null} onClick={clearTransfer}>復元を取り消す</button>
      </section>}
      <button type="button" disabled={!plan || editDisabled} onClick={() => void exportPortable()}>新版の可搬バックアップを保存</button>
      <button type="button" disabled={pending || isolationHeld} onClick={() => {
        void media.exportQuarantine().then(raw => download(raw, 'hosei-planner-2026-originals.json'), failure => setError(sendError(failure)));
      }}>新版の保存原文を保護用に保存</button>
    </section>
    {reading.status === 'ready' && plan && <section aria-label="移行した計画と本人メディア" hidden={restoreSync !== null}>
      <h2>移行した計画と本人メディア</h2>
      <p data-testid="plan-summary">計画 {plan.plans}件 ／ 公式成績 {plan.officialRows}件</p>
      <ul>
        {plan.records.map(row => <li key={row.id}>{row.name} ／ 原期 メ ／ 原年度 {row.year || '記載なし'} ／ 修得 {row.earned ?? '不明'}単位 ／ Offering未照合</li>)}
      </ul>
      <p>本人履修回は個人の進捗用です。公式成績、Offering、卒業算入へ関連付けません。</p>
      {!!plan.records.length && <form onSubmit={event => {
        event.preventDefault();
        if (!startChecked || editDisabled) return;
        const totalLessons = Number(new FormData(event.currentTarget).get('count'));
        void saveTrack({ id: crypto.randomUUID(), totalLessons, lessons: [], assessments: [] }, 'create', reading);
      }}>
        <label>全回数 <input name="count" type="number" min={1} max={200} defaultValue={14} required disabled={editDisabled} /></label>
        <label><input type="checkbox" checked={startChecked} onChange={event => setStartChecked(event.target.checked)} disabled={editDisabled} /> 既存の本人履修回と別の記録を作成する</label>
        <button type="submit" disabled={!startChecked || editDisabled}>独立した本人履修回を開始</button>
      </form>}
      {reading.tracks.map(track => <TrackEditor key={track.id} track={track} disabled={editDisabled} markDirty={markDirty}
        noticeRevision={stale || isolationHeld ? null : noticeRevision}
        save={(value, matchesDraft) => saveTrack(value, 'edit', reading, matchesDraft)} />)}
    </section>}
  </main>;
}

