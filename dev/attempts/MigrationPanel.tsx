import { preventImeSubmit, text } from './formHelpers';
import { useRef, useState } from 'react';
import type { DateCorrection, MigrationSession } from '../../src/planner/attempts/workbench/migrationSession';
import { heldDates } from '../../src/planner/attempts/workbench/migrationSession';
import { fixtureRaw, loadMigrationWorkbench, type FixtureName } from './fixtures';
import { buttonClass, Field, inputClass } from './Fields';

export function MigrationPanel({ start }: { start: (session: MigrationSession) => void }) {
  const service = useRef<ReturnType<typeof loadMigrationWorkbench> | null>(null);
  const [session, setSession] = useState<MigrationSession | null>(null), [history, setHistory] = useState<MigrationSession[]>([]);
  const [proposal, setProposal] = useState<DateCorrection | null>(null), [confirmed, setConfirmed] = useState(false), [replace, setReplace] = useState(false);
  const [fixture, setFixture] = useState<FixtureName>('ready'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const api = () => { service.current ??= loadMigrationWorkbench(); return service.current; };
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (err) { setError(String(err)); } finally { setBusy(false); }
  }
  function show(next: MigrationSession) {
    setSession(next); setHistory(h => h.includes(next) ? h : [...h, next]); setProposal(null); setConfirmed(false); setReplace(false);
  }
  const status = session?.preview?.status ?? session?.decoded.status;
  return <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-labelledby="migration-heading">
    <h2 className="text-xl font-bold" id="migration-heading">YI-04 migration preview（隔離fixture）</h2>
    <p className="text-sm">既存ユーザーの保存データは読みません。readyは移行時の完全保持確認で、永続保存・卒業算入の承認ではありません。</p>
    <Field label="移行fixture"><select className={inputClass} value={fixture} disabled={busy} onChange={e => setFixture(e.target.value as FixtureName)}><option value="ready">正常v22</option><option value="held-day">不実在日 2027-02-30</option><option value="held-month">不正月 2027-99-99</option><option value="rejected">未対応schema（rejected）</option></select></Field>
    <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy} onClick={() => run(async () => show(await (await api()).inspect(fixtureRaw(fixture))))}>decodeしてpreview</button>
      <button className={buttonClass} disabled={busy || !session} onClick={() => run(async () => { const repeated = (await api()).repeat(session!); setNotice(`固定割当を再利用: ${repeated?.status ?? session!.decoded.status}。作業中のCRUDは変更しません。`); })}>同じ割当で再preview</button></div>
    {busy && <p role="status">全体を検証中…</p>}{error && <p role="alert" className="whitespace-pre-wrap text-red-800">{error}</p>}{notice && <p role="status">{notice}</p>}
    {session && <div className="space-y-3">
      <p role="status" className="font-bold">移行結果: {status}</p>
      <p className="break-all text-xs">source digest: {session.decoded.status === 'decoded' ? session.decoded.source.rawSha256 : 'decode未成立'}</p>
      {(session.preview?.diagnostics ?? session.decoded.diagnostics).map((d, i) => <p key={i} className="break-words text-sm text-red-900">{d.code}: {d.message}</p>)}
      {heldDates(session).map(row => <form key={`${session.raw}-${row.assessmentId}`} className="space-y-2 rounded border bg-white p-3" onKeyDown={preventImeSubmit} onSubmit={e => {
        e.preventDefault(); const data = new FormData(e.currentTarget);
        run(async () => { setProposal((await api()).proposeDate(session, row.offeringId, row.assessmentId, data.has('null-date') ? null : text(data, 'newDate'))); setConfirmed(false); });
      }}>
        <p className="break-all">元assessment ID: {row.assessmentId}</p><p className="break-all">旧owner: {row.offeringId}</p><p>元日付: <strong>{row.date}</strong></p>
        <Field label="日付の修正案"><input className={inputClass} name="newDate" placeholder="2027-02-28" /></Field>
        <label className="block"><input type="checkbox" name="null-date" /> 日付不明 (null) を明示提案</label><button className={buttonClass} disabled={busy}>修正案を比較</button>
      </form>)}
      {proposal && <div className="space-y-2 rounded border-2 border-amber-700 bg-white p-3">
        <p>原値 <strong>{proposal.oldDate}</strong> → 修正案 <strong>{proposal.newDate ?? '不明 (null)'}</strong></p>
        <p>source digestが変わります。旧Attempt IDを継承せず、新しい割当IDで全体を再decode・再previewします。訂正前後の履修回の同一性は再確認が必要です。</p>
        <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> 原値と修正案、新規ID割当を確認しました</label>
        <button className={buttonClass} disabled={busy || !confirmed} onClick={() => run(async () => { const next = await (await api()).confirmDate(proposal, confirmed); show(next); setNotice('元rawを保持し、新source全体を再検証しました。'); })}>確認した修正だけを新sourceに適用</button>
      </div>}
      {session.preview?.status === 'ready' && <div className="space-y-2"><p>Attempt {session.preview.target.graph.attempts.length}件 / owner付き記録 {session.preview.target.graph.ownedRecords.length}件</p>
        <label className="block"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> 現在の隔離編集を破棄し、readyを新しい作業の初期状態にします</label>
        <button className={buttonClass} disabled={busy || !replace} onClick={() => { start(session); setReplace(false); setNotice('ready graphを隔離メモリに読み込みました。以後はYI-05 CRUD契約で検証します。'); }}>readyから隔離作業を開始</button>
      </div>}
    </div>}
    <details><summary>訂正前を含む元raw・割当履歴（ページ内のみ） {history.length}件</summary>{history.map((s, i) => <details key={i}><summary>source {i + 1} / {s.preview?.status ?? s.decoded.status}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs" data-testid={`source-raw-${i}`}>{s.raw}</pre><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(s.table, null, 2)}</pre></details>)}</details>
  </section>;
}
