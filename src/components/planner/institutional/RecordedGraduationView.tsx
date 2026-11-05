import { useId, useState } from 'react';
import rules from '../../../data/graduation_rules.json';
import type { AcSnapshot } from '../../../planner/attempts/production/acController';
import type { ProgressCard, RequirementProgress } from '../../../planner/graduation/graduationProgress';

const scopes = rules.programs.filter(p => !p.isCommon);
const number = (n: number | null | undefined) => n === null ? '不明（null）' : n === undefined ? '未提供' : String(n);
const earnedLabel = (n: number | null | undefined, held: boolean) => held && typeof n === 'number' ? `既知分 ${n}（全体保留）` : number(n);
const status = { satisfied: '条件上達成', unsatisfied: '未達成', unknown: '保留（unknown）' };
const unit = (v: RequirementProgress['unit']) => v === 'courses' ? '科目' : v === 'credits' ? '単位' : '単位種別不明';
const holdReasons: Record<string, string> = {
  explicit_quantity_and_compatible_method_required: '本人記録の単位数または履修方法を確認してください。',
  unique_safe_placement_required: '制度科目・配置の対応が確定するまで保留します。',
  repeatable_independence_unverified: '反復修得の独立した履修回を確認するまで保留します。',
  unsupported_course_component_structure: '履修の構成を確認するまで保留します。',
  partial_schooling_exception_not_connected: '一部修得のスクーリングの扱いを確認するまで保留します。',
  unresolved_official_overlap: '公式成績との重複の可能性を確認するまで保留します。',
  explicit_official_link_unresolved: '公式成績との関連を確認するまで保留します。',
  official_detail_shared: '公式明細の所有関係を確認するまで保留します。',
  special_course_rule_not_connected: '特殊な履修条件の評価を保留します。',
};
function ProgressRows({ rows, caption }: { rows: RequirementProgress[]; caption: string }) {
  return <div className="recorded-table" tabIndex={0} role="region" aria-label={caption}><table>
    <caption>{caption}</caption><thead><tr><th>要件</th><th>判定</th><th>修得（既知分）</th><th>履修中</th><th>予定</th><th>要件値・上限</th><th>単位</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.requirementId} data-requirement-id={row.requirementId}>
      <th scope="row">{row.label}{row.reason && <p>{row.reason}</p>}<details><summary>根拠・配分・上限の内訳</summary>
        <p>{row.coverageStatus ?? '根拠範囲未提供'} / {row.unknownReasonCategory ?? '追加の保留分類なし'}</p>
        {row.sourceRefs?.map((ref, i) => <p key={i}>{ref.title} {ref.page ?? ''}</p>)}
        {(row as ProgressCard).note && <p>{(row as ProgressCard).note}</p>}
        {(row as ProgressCard).details?.map((d, i) => <p key={i}>{d.label}: 修得 {earnedLabel(d.earned, row.status === 'unknown')} / 履修中 {number(d.inProgress)} / 予定 {number(d.planned)} / 要件値 {number(d.target)} {d.unit === 'courses' ? '科目' : '単位'}{d.reason && ` / ${d.reason}`}</p>)}
        {(row as ProgressCard).partialCourses?.map((d, i) => <p key={i}>{d.label}: 構成単位 {d.earned} / {d.target}、完成は別途評価</p>)}
        {(row as ProgressCard).repeatableCourses?.map((d, i) => <p key={i}>{d.label}: 修得 {d.earned} / 配分 {d.counted} / 単位上限 {d.limit} / 完成 {d.courses} / 科目上限 {d.limitCourses}</p>)}
        {(row as ProgressCard).publicCourse && <p>公開科目の配分・上限: {JSON.stringify((row as ProgressCard).publicCourse)}</p>}
        {(row as ProgressCard).specialLectures && <p>総合特講の配分・上限: {JSON.stringify((row as ProgressCard).specialLectures)}</p>}
      </details></th><td>{status[row.status]}</td><td data-value={row.earned === null ? "null" : row.earned}>{earnedLabel(row.earned, row.status === 'unknown')}</td><td>{number(row.inProgress)}</td><td>{number(row.planned)}</td><td>{number(row.target)}</td><td>{unit(row.unit)}</td>
    </tr>)}</tbody></table></div>;
}
export function RecordedGraduationView({ state, calculate }: { state: AcSnapshot; calculate: (scopeId: string) => Promise<boolean> }) {
  const [scopeId, setScopeId] = useState('');
  const scopeInputId = useId();
  const result = state.calculation?.scopeId === scopeId ? state.calculation.result : null;
  const available = state.ready && !state.busy && !state.dirty && !state.proposal && !!state.graph;
  return <section aria-labelledby="graduation-progress-heading"><h2 id="graduation-progress-heading" tabIndex={-1}>修得単位・卒業要件（条件付き計算）</h2>
    <p className="notice">選択した教育課程を仮定した本人記録の計算です。本人適用は未確認です。保留・不明を0単位や達成とみなしません。大学による正式な卒業認定は別途必要です。</p>
    <label htmlFor={scopeInputId}>計算に仮定する教育課程</label><select id={scopeInputId} value={scopeId} onChange={e => setScopeId(e.target.value)} disabled={state.busy}>
      <option value="">教育課程を選択してください</option>{scopes.map(p => <option key={p.scopeId} value={p.scopeId}>{p.displayName}</option>)}
    </select>
    <button disabled={!available || !scopeId} onClick={() => void calculate(scopeId)}>保存済み記録で条件付き計算</button>
    {!available && <p>下書きを保存し、保存内容の再読込・照合を完了してから計算してください。</p>}
    {!result && <p data-testid="calculation-empty">この教育課程の計算結果はまだありません。</p>}
    {result?.status === 'rejected' && <p role="alert">計算を保留しました。記録と公式証拠の対応を確認してください。{result.diagnostics.map(d => d.message).join(' / ')}</p>}
    {result?.status === 'calculated' && <div data-testid="recorded-calculation">
      <p>本人適用: 未確認 / 卒業判定: 未確定。正式な卒業認定ではありません。</p>
      <p>評価可能 {result.progress.evaluableCount}件 / 保留 {result.progress.unknownCount}件。将来の予定・履修中の配分が不明な場合はnullで表示します。</p>
      {result.progress.referenceProgress.map(r => <p key={r.id} data-reference-id={r.id}>{r.label}: {earnedLabel(r.earned, r.status === 'unknown')} / {number(r.target)}単位、{r.status === 'unknown' ? '保留' : '参考値（部分評価）'}。{r.reason}</p>)}
      <ProgressRows rows={result.progress.cards} caption="卒業要件ごとの配分・上限" />
      <details><summary>公式資料の個別要件を確認</summary><ProgressRows rows={result.progress.requirements} caption="個別要件の完成・単位" /></details>
      <h3>本人記録の構成・完成</h3>
      {result.courses.map(c => <p key={c.id} data-recorded-course-id={c.id}>{state.graph?.attempts.find(a => a.identity.ref?.institutionalCourseId === c.id)?.originalTitle ?? c.id}: {c.authority === 'official' ? '公式成績を優先（本人記録による追加算入0）' : `本人修得 ${number(c.recordedEarned)} / 算入 ${c.increment} / 完成構成単位 ${number(c.completedCredits)} / スクーリング ${number(c.schoolingCredits)}`}</p>)}
      <h3>保留した履修記録</h3>{result.holds.length === 0 && <p>履修記録ごとの追加保留はありません。制度上の不明・本人適用の未確認は残ります。</p>}
      {result.holds.map((h, i) => <p key={i} data-held-attempt-id={h.attemptId}>{state.graph?.attempts.find(a => a.id === h.attemptId)?.originalTitle ?? h.attemptId}: {holdReasons[h.reason] ?? '根拠を確認するまで算入を保留します。'}</p>)}
      <details><summary>保留理由と公式成績の注意点</summary>{result.progress.unknownReasons.map((r, i) => <p key={i}>{r.reason}（{r.count}件）: {r.labels.join('、')}</p>)}
        <pre>{JSON.stringify({ holds: result.holds, warnings: result.progress.importedWarnings }, null, 2)}</pre></details>
    </div>}
  </section>;
}
