import { useId, useState, type KeyboardEvent } from 'react';
import { loadCurrentCurriculumSearchAdapter } from '../../../planner/institutional/currentSearch';
import { readonlySelectionHold } from '../../../planner/institutional/readonlySelection';
import type { InstitutionalSearchRow } from '../../../planner/institutional/search';
import { InstitutionalSearchView } from './InstitutionalSearchView';
import { compositionLabel } from './searchView';
import './institutionalSearch.css';

/** Isolated, mount-lifetime preview. No session, writer, ID allocator or host callback. */
export function YearIndependentSearchSidecar() {
  const id = useId();
  const [adapter] = useState(loadCurrentCurriculumSearchAdapter);
  const [tab, setTab] = useState<'search' | 'limits'>('search');
  const [selection, setSelection] = useState<InstitutionalSearchRow | null>(null);
  const [hold, setHold] = useState('');
  const [yearRaw, setYearRaw] = useState('');
  const [method, setMethod] = useState('unknown');
  const validYear = yearRaw === '' || /^[1-9]\d{3}$/.test(yearRaw);
  const plannedYear = yearRaw === '' ? null : Number(yearRaw);
  function clear() { setSelection(null); setHold(''); setYearRaw(''); setMethod('unknown'); }
  function navigateTabs(e: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 'search' : e.key === 'End' ? 'limits' : tab === 'search' ? 'limits' : 'search';
    setTab(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`#${CSS.escape(`${id}-${next}-tab`)}`)?.focus();
  }
  return <article className="institutional-search" aria-labelledby={`${id}-title`}>
    <h1 id={`${id}-title`}>年度に依存しない制度科目検索・入力プレビュー</h1>
    <p className="notice">未保存の確認用画面です。選択と入力はこの画面内だけに保持し、画面を離れると失われます。</p>
    <div role="tablist" aria-label="プレビュー画面" onKeyDown={navigateTabs}>
      <button role="tab" id={`${id}-search-tab`} tabIndex={tab === 'search' ? 0 : -1} aria-selected={tab === 'search'} aria-controls={`${id}-search`} onClick={() => setTab('search')}>検索と未保存入力</button>
      <button role="tab" id={`${id}-limits-tab`} tabIndex={tab === 'limits' ? 0 : -1} aria-selected={tab === 'limits'} aria-controls={`${id}-limits`} onClick={() => setTab('limits')}>確認事項</button>
    </div>
    <div role="tabpanel" id={`${id}-search`} aria-labelledby={`${id}-search-tab`} hidden={tab !== 'search'}>
      <InstitutionalSearchView adapter={adapter} showSelectionEvidence selectionNotice="選択は未保存入力のプレビューだけに使います。" onSelect={row => {
        const reason = readonlySelectionHold(row);
        if (reason) { setHold(`HOLD: ${reason} 現在の未保存入力は保持します。`); return; }
        setSelection(row); setHold('');
      }} />
      {hold && <p role="alert">{hold}</p>}
      {selection && <section aria-label="未保存の履修回入力">
        <h2>未保存の入力候補：{selection.placement.officialName}</h2>
        <p>選択した配置: {selection.scope.officialScopeLabel} / {selection.placement.category} / 構成単位 {compositionLabel(selection.placement.compositionCredits)}</p>
        <p>配置ID: {selection.placement.id} / 制度科目ID: {selection.institutionalCourse?.id}</p>
        <p>上記は資料内の配置です。以下は本人が希望する履修回の入力で、本人適用・実開講・修得単位・卒業算入は未判定です。</p>
        <label>予定年度（空欄は未設定）<input type="text" inputMode="numeric" value={yearRaw} onChange={e => setYearRaw(e.target.value)} aria-invalid={!validYear} /></label>
        {!validYear && <p role="alert">予定年度は1000〜9999の整数、または空欄で入力してください。</p>}
        <label>希望する履修方法<select value={method} onChange={e => setMethod(e.target.value)}>
          <option value="unknown">未設定</option><option value="correspondence">通信</option><option value="schooling">スクーリング</option><option value="media">メディア</option>
        </select></label>
        <p data-testid="draft-preview">未保存プレビュー: plannedYear={validYear ? String(plannedYear) : '入力確認中'} / 希望方式={method}</p>
        <button type="button" onClick={clear}>選択を取り消して入力を消去</button>
      </section>}
      {!selection && <p>入力候補は未選択です。</p>}
      {hold && <button type="button" onClick={() => setHold('')}>保留表示を消す</button>}
    </div>
    <div role="tabpanel" id={`${id}-limits`} aria-labelledby={`${id}-limits-tab`} hidden={tab !== 'limits'}>
      <h2>資料と未保存入力の境界</h2>
      <p>2026年版資料の固定された制度科目配置を参照します。予定年度の変更によって検索対象は変わりません。</p>
      <p>2027・2028年度の実開講、本人への適用、公式成績の真正性、卒業算入は確認していません。</p>
      <p>通常のプランナー接続（Y-01）と新しい履修回の保存（Y-03）は未接続・未受入です。</p>
    </div>
  </article>;
}
