import { useRef, useState } from 'react';
import type { SavedDisplay } from '../../../planner/attempts/production/acController';
import type { Attempt, AttemptId } from '../../../planner/attempts/types';
import type { GradeSourceReference } from '../../../planner/attempts/gradeImportHost/codec';
import { methodLabels } from './planLabels';

const quantity = (value: number | null | undefined) => value == null ? '未確認' : String(value);

export function SavedAttemptDisplay({ state, verify, disabled }: { state: SavedDisplay; verify: () => void; disabled: boolean }) {
  const current = state.status === 'pinned';
  const past = state.past;
  const retained = past?.retained;
  return <section aria-label="保存済み記録の照合">
    <h2>保存済み記録の照合</h2>
    <p data-testid="saved-display-state">{current ? '読取時点の検証済みスナップショット' :
      state.status === 'reading' ? '保存済み記録を照合中' :
      state.status === 'hold' ? '保存済み表示は保留: ' + state.reason : '保存済み表示は未接続'}</p>
    <button disabled={disabled} onClick={verify}>保存済み表示を再照合</button>
    {current && past && <>
      <p className="muted">schema {past.snapshot.schemaVersion} / 資料版 {past.snapshot.sourceRevisionId} / 資料 SHA256 {past.snapshot.sourceDigest}</p>
      <p className="muted">バックアップ SHA256 {past.snapshot.backupSha256} / グラフ SHA256 {past.snapshot.graphSha256}</p>
      <p>履修回 {past.projection.owners.length}件 / 同一スナップショットの進捗・評価・TODO {past.ownerInventory.records.length}件</p>
      <details><summary>未解決の所有者・所有者なしの記録</summary>
        {past.ownerInventory.records.filter(row => row.owner?.kind !== 'attempt').map(row =>
          <details key={row.id}><summary>{row.kind} / {row.owner ? '旧記録の所有者未照合' : '所有者なし'} / {row.id}</summary>
            <pre>{JSON.stringify({ owner: row.owner, payload: row.payload, provenance: row.provenance }, null, 2)}</pre>
          </details>)}
      </details>
    </>}
    {retained && <details data-testid="official-reference">
      <summary>公式原行参照 {current ? '（履修回との対応は未照合）' : '（過去時点・再照合待ち）'}</summary>
      <p>所属する履修回と修得完了は未確認です。本人評価への置き換えや、単位の配分は行いません。</p>
      {retained.importedCourseAchievements.map(row => <p key={row.id}>
        {row.rawName} / 原行 {row.id} / 修得 {quantity(row.earnedCreditsTotal)}・構成 {quantity(row.compositionCredits)}単位
      </p>)}
      {retained.importedStudyRecords.map(row => <p key={row.id}>
        {row.rawName} / 明細 {row.id} / 単位 {quantity(row.credits)} / 評価 {row.grade ?? '未確認'}
      </p>)}
      {!retained.importedCourseAchievements.length && !retained.importedStudyRecords.length &&
        <p>この保存内容に保全された原行はありません。大学側の成績の有無は未確認です。</p>}
    </details>}
  </section>;
}

export type ReadGradeReference = (file: File) => Promise<
  { status: 'tooLarge' } | { status: 'verified'; reference: GradeSourceReference }
>;

export function GradeImportLookup({ attempts, disabled, open, readGradeReference }: {
  attempts: readonly Attempt[]; disabled: boolean; open: (id: AttemptId) => void;
  readGradeReference: ReadGradeReference;
}) {
  const readToken = useRef(0);
  const [reference, setReference] = useState<GradeSourceReference | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const row = selected === '' ? undefined : reference?.rows[Number(selected)];
  const matches = row ? attempts.filter(attempt => attempt.membership.kind === 'active' && attempt.originalTitle === row.rawName) : [];
  return <section aria-label="成績ファイルから対象を確認">
    <h2>成績ファイルから対象を確認</h2>
    <p>原行を参照し、同じ名称の履修回を候補として表示します。選んだ履修回で本人入力を編集できます。</p>
    <label>成績 JSON（原行参照）<input type="file" accept=".json,application/json" disabled={disabled} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      const token = ++readToken.current;
      setReference(null); setSelected(''); setError('');
      void readGradeReference(file).then(result => {
        if (token !== readToken.current) return;
        if (result.status === 'tooLarge') { setError('成績ファイルが読取上限を超えています。'); return; }
        setReference(result.reference);
      }).catch(() => {
        if (token === readToken.current) setError('成績 JSON の原文とバージョンを照合できません。');
      });
    }} /></label>
    {error && <p role="alert">{error}</p>}
    {reference && <>
      <p className="muted">取込参照 {reference.rows.length}行 / 原文 SHA256 {reference.rawSha256}</p>
      <label>成績原行<select value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">選択してください</option>
        {reference.rows.map((row, i) => <option value={i} key={i}>{i + 1}行目 {row.rawName}</option>)}
      </select></label>
    </>}
    {row && <>
      <p>原行の修得 {quantity(row.earnedCredits)}・構成 {quantity(row.compositionCredits)}単位 / 履修回との対応未照合</p>
      <p>{matches.length ? '名称一致は操作先の候補です。年度・方式・IDで選択してください。' : '名称一致する履修回がありません。制度科目検索から対象を確認してください。'}</p>
      {matches.map(attempt => <button type="button" key={attempt.id} disabled={disabled} onClick={() => open(attempt.id)}>
        本人入力を開く {attempt.originalTitle} / {attempt.plan?.plannedYear ?? '年度未設定'} / {methodLabels[attempt.method.value]} / {attempt.id}
      </button>)}
    </>}
  </section>;
}
