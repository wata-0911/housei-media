import { useMemo, useState } from 'react';
import { CURRENT_CURRICULUM_SEARCH_TARGET } from '../../src/planner/institutional/currentSearch';
import { createInstitutionalSearchAdapter, type InstitutionalSearchRow } from '../../src/planner/institutional/search';
import type { InstitutionalCatalog } from '../../src/planner/institutional/types';
import { buttonClass, Field, inputClass } from './Fields';

export function PlacementSearch({ catalog, selection, select }: {
  catalog: InstitutionalCatalog; selection: InstitutionalSearchRow | null; select: (row: InstitutionalSearchRow | null) => void;
}) {
  const [query, setQuery] = useState(''), [code, setCode] = useState(''), [scopeId, setScopeId] = useState('');
  const [usage, setUsage] = useState<'undergraduate' | 'teacher'>('undergraduate');
  const [common, setCommon] = useState(true), [limit, setLimit] = useState(30);
  const adapter = useMemo(() => createInstitutionalSearchAdapter(catalog, CURRENT_CURRICULUM_SEARCH_TARGET), [catalog]);
  const result = useMemo(() => adapter.search({ text: query,
    ...(code.trim() ? { officialCode: { value: code, usage } } : {}),
    scope: scopeId ? { kind: 'scope', scopeId, includeCommon: common } : { kind: 'all' },
  }), [adapter, query, code, usage, scopeId, common]);
  return <section aria-label="制度Placement検索" className="min-w-0 space-y-3" onKeyDown={e => {
    // Enter in a search control must not confirm the separate registration form.
    if (e.key === 'Enter' && (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) e.preventDefault();
  }}>
    <Field label="制度科目を検索"><input className={inputClass} value={query} onChange={e => { setQuery(e.target.value); setLimit(30); }} placeholder="正式科目名" /></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="公式科目コード（完全一致）"><input className={inputClass} value={code} onChange={e => { setCode(e.target.value); setLimit(30); }} /></Field>
      <Field label="公式コードの用途"><select className={inputClass} value={usage} onChange={e => { setUsage(e.target.value as typeof usage); setLimit(30); }}><option value="undergraduate">本科</option><option value="teacher">教職（本人資格は未確認）</option></select></Field>
      <Field label="学科・コースscope"><select className={inputClass} value={scopeId} onChange={e => { setScopeId(e.target.value); setLimit(30); }}><option value="">全scope</option>{catalog.scopes.map(s => <option key={s.id} value={s.id}>{s.officialScopeLabel}</option>)}</select></Field>
      <Field label="共通科目を含める"><input type="checkbox" checked={common} onChange={e => { setCommon(e.target.checked); setLimit(30); }} /></Field>
    </div>
    <p role="status">検索結果 {result.rows.length}件 / 表示 {Math.min(limit, result.rows.length)}件。1行は1配置です。選択後に下の追加ボタンで登録します。</p>
    {result.status !== 'documented_slice_only' && <p role="alert">検索対象の資料版・scopeを確認できません: {result.status}</p>}
    <ul aria-label="Placement検索結果" className="max-h-80 space-y-2 overflow-auto rounded border p-2">
      {result.rows.slice(0, limit).map(row => {
        const p = row.placement, bucket = p.kind === 'non_course_bucket';
        return <li key={p.id} className="min-w-0 space-y-1 border-b pb-2 text-sm">
          <p>{p.officialName} / {row.scope.officialScopeLabel} / {p.category} / {p.requirementType} / 構成 {p.compositionCredits === null ? '不明 (null)' : `${p.compositionCredits}単位`} / identity: {p.identityDecision.status}</p>
          <p>{bucket ? '非科目枠：通常Attempt登録の対象外' : row.institutionalCourse ? 'IC確定（資料版内）' : 'IC未確定の配置'} / 方式制約: {p.methodConstraint.requiredMethod ?? '指定なし'} ({p.methodConstraint.status})</p>
          <button type="button" className={buttonClass} disabled={bucket} aria-pressed={selection?.placement.id === p.id} onClick={() => select(row)}>この配置を選択: {p.officialName} / {row.scope.officialScopeLabel} / {p.placementRoleKey}</button>
        </li>;
      })}
    </ul>
    {result.rows.length > limit && <button type="button" className={buttonClass} onClick={() => setLimit(n => n + 30)}>次の30件を表示（残り{result.rows.length - limit}件）</button>}
    {selection ? <div className="min-w-0 space-y-2 rounded border-2 border-indigo-600 p-3" aria-label="選択中の配置">
      <p className="break-words">選択中: {selection.placement.officialName} / {selection.scope.officialScopeLabel} / {selection.placement.identityDecision.status}。本人適用unknown。検索条件を変えてもこの選択を維持します。</p>
      <details><summary>選択根拠・候補・出典</summary><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(selection, null, 2)}</pre></details>
      <button type="button" className={buttonClass} onClick={() => select(null)}>選択解除・未確定名称を手入力</button>
    </div> : <p>配置は未選択です。名称を手入力すると制度identity未確定の履修回になります。</p>}
  </section>;
}
