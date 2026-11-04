import { useMemo, useState } from 'react';
import { loadCurrentCurriculumSearchAdapter } from '../../src/planner/institutional/currentSearch';
import type { InstitutionalSearchAdapter, InstitutionalSearchRow } from '../../src/planner/institutional/search';
import { compositionLabel, filterPlacementNames, type NameMatchMode } from './searchView';

function PlacementCard({ row }: { row: InstitutionalSearchRow }) {
  const p = row.placement;
  return <li>
    <h2>{p.officialName}</h2>
    <p>{row.scope.officialScopeLabel === 'common' ? '共通科目' : row.scope.officialScopeLabel} / {p.category} / {p.field ?? '分野未記載'} / {p.requirementType}</p>
    <p>カリキュラム構成単位: {compositionLabel(p.compositionCredits)} / 配当学年: {p.officialRow.eligibleYears?.join('・') || '未確認'}</p>
    <p>{p.kind === 'non_course_bucket' ? '非科目枠（通常科目ではありません）' : '科目配置'} / identity: {p.identityDecision.status} / {row.institutionalCourse ? 'IC確定（資料版内）' : 'IC未確定'}</p>
    <p>方式制約: {p.methodConstraint.requiredMethod ?? '資料内の指定なし（自由選択の保証ではありません）'} / 確認状態: {p.methodConstraint.status}</p>
    <p className="notice">本人への課程適用: 未確認（unknown）。履修条件・希望する履修方法は要確認。開講・履修可能性・卒業算入は未判定です。</p>
    <p>出典: {row.sourceRevision.title} {row.sourceRevision.editionLabel}年版 / 冊子p.{p.officialRow.printedPage}（PDF p.{p.officialRow.pdfPage}） / 行 {p.officialRow.row}</p>
    <p className="muted">配置: {p.placementRoleKey} / 根拠行: {p.officialRow.evidenceId}</p>
    <details><summary>公式根拠・未確定事項を確認</summary>
      <p>identityの判断理由: {p.identityDecision.reason.join(' / ') || '記載なし'}</p>
      <p>候補（自動採用しません）: {p.candidateAuditIds.join(' / ') || 'なし'}</p>
      {row.notes.map(note => <p key={note.evidenceId}>脚注 {note.marker}（冊子p.{note.printedPage} / {note.evidenceId}）: {note.text}</p>)}
      <p>公式科目コード証拠（旧クラスコードとは別。本人資格を保証しません）</p>
      {(['undergraduate', 'teacher', 'nameOnlyCandidates'] as const).map(channel => <div key={channel}>
        <p>{channel === 'undergraduate' ? '本科' : channel === 'teacher' ? '教職' : '名称のみの候補（コード確定根拠ではありません）'}</p>
        {row.codeEvidence[channel].map(code => <p key={code.evidenceId}>{code.codes.join(' / ')} / scope: {code.scope} / 条件: {code.conditions ?? '記載なし（資格未確認）'} / 根拠: {code.evidenceId}</p>)}
      </div>)}
      <p>資料リンク再検証: 未実施。{row.sourceRevision.limitations.join(' / ')}</p>
      <p className="muted">資料版: {row.sourceRevision.id} / SHA-256: {row.sourceRevision.sha256} / Placement ID: {p.id}</p>
      <details><summary>原行・方式矛盾・旧値の監査記録</summary><pre>{JSON.stringify({ officialRow: p.officialRow, methodConstraint: p.methodConstraint, differences: p.differences, legacySnapshot: p.legacySnapshot, codeEvidence: row.codeEvidence }, null, 2)}</pre></details>
    </details>
  </li>;
}

/** Isolated read-only view. No selection callback or Attempt/save capability. */
export function InstitutionalSearch({ adapter }: { adapter?: InstitutionalSearchAdapter }) {
  const [source] = useState(() => adapter ?? loadCurrentCurriculumSearchAdapter());
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<NameMatchMode>('partial');
  const [scopeId, setScopeId] = useState('');
  const [common, setCommon] = useState(true);
  const [limit, setLimit] = useState(30);
  const all = useMemo(() => source.search({ scope: { kind: 'all' } }), [source]);
  const scopes = useMemo(() => [...new Map(all.rows.map(row => [row.scope.id, row.scope])).values()], [all]);
  const result = useMemo(() => scopeId ? source.search({ scope: { kind: 'scope', scopeId, includeCommon: common } }) : all, [source, scopeId, common, all]);
  const rows = useMemo(() => filterPlacementNames(result.rows, query, mode), [result, query, mode]);
  return <main className="institutional-search">
    <h1>制度科目を調べる</h1>
    <p>学習のしおりに基づく現行課程の配置を閲覧する開発用read-only画面です。1件は1配置。同名の配置も学科・単位構成・根拠ごとに表示します。</p>
    <p className="notice">本人への適用は未確認です。2027年度以降を含む実開講・履修資格・卒業算入は保証しません。登録・保存機能はありません。</p>
    <label>正式科目名<input type="text" value={query} onChange={e => { setQuery(e.target.value); setLimit(30); }} /></label>
    <fieldset><legend>科目名の一致方法</legend>{(['partial', 'exact'] as const).map(value => <label key={value}>
      <input type="radio" name="name-mode" checked={mode === value} onChange={() => { setMode(value); setLimit(30); }} />{value === 'partial' ? '部分一致' : '完全一致'}
    </label>)}</fieldset>
    <p className="muted">部分一致は複数語AND検索。完全一致は正式名称全体で比較します。全半角・英字大小・前後空白を正規化し、内部空白は完全一致では保持します。空欄・空白のみは全配置（学科条件は維持）を表示します。</p>
    <div className="controls">
      <label>学科・コース・共通科目<select value={scopeId} onChange={e => { setScopeId(e.target.value); setLimit(30); }}><option value="">すべての配置</option>{scopes.map(scope => <option key={scope.id} value={scope.id}>{scope.officialScopeLabel === 'common' ? '共通科目' : scope.officialScopeLabel}</option>)}</select></label>
      <label><input type="checkbox" checked={common} disabled={!scopeId} onChange={e => { setCommon(e.target.checked); setLimit(30); }} />選択した学科に共通科目を含める</label>
    </div>
    <p role="status">検索結果 {rows.length}件 / 表示 {Math.min(limit, rows.length)}件</p>
    {result.status !== 'documented_slice_only' && <p role="alert">検索資料版・対象を確認できません: {result.status}</p>}
    {result.status === 'documented_slice_only' && rows.length === 0 && <p>該当する配置はありません。正式名称・一致方法・学科条件を確認してください。</p>}
    <ul className="results" aria-label="制度科目の検索結果">{rows.slice(0, limit).map(row => <PlacementCard key={row.placement.id} row={row} />)}</ul>
    {rows.length > limit && <button type="button" onClick={() => setLimit(n => n + 30)}>さらに30件表示（残り{rows.length - limit}件）</button>}
  </main>;
}
