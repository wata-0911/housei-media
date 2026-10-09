import type { ConditionProjection, UnresolvedCondition } from '../../planner/unresolvedConditions';

function Condition({ condition, onOpenProfile }: { condition: UnresolvedCondition; onOpenProfile?: () => void }) {
  return <li className="min-w-0 break-words border-t border-gray-200 pt-3 first:border-0 first:pt-0">
    <p className="font-medium">{condition.label}</p>
    <p className="mt-1 text-sm leading-relaxed">{condition.action}</p>
    {condition.destination === 'profile' && onOpenProfile && <button type="button" onClick={onOpenProfile} className="mt-2 min-h-11 underline">プロフィールを開く</button>}
    {condition.destination === 'imports' && <a href="#imported-achievements" className="mt-2 inline-block py-2 underline">成績取込の管理へ</a>}
    {condition.owner !== 'learner' && <p className="mt-1 text-xs text-gray-600">{condition.owner === 'university' ? '大学・教務への確認' : '実装未対応・算入根拠の確認'}</p>}
    <ul className="mt-2 space-y-2 text-xs leading-relaxed text-gray-700">{condition.targets.map(target => <li key={target.id}>
      <p>対象：{target.label}</p>
      {condition.owner !== 'learner' && <p>{target.reason}</p>}
      {target.sourceRefs.length > 0 && <p>根拠：{target.sourceRefs.map((source, index) => <span key={index}>{index > 0 && ' / '}{source.url ? <a href={source.url} className="underline" target="_blank" rel="noreferrer">{source.title}</a> : source.title}{source.page && ` ${source.page}`}</span>)}</p>}
    </li>)}</ul>
  </li>;
}

export default function UnresolvedConditions({ projection, onOpenProfile }: { projection: ConditionProjection; onOpenProfile?: () => void }) {
  return <div className="mt-6 min-w-0 space-y-3">
    {projection.learner.length > 0 && <details aria-label="確認が必要な条件" className="min-w-0 border border-amber-200 bg-amber-50 p-4">
      <summary className="cursor-pointer font-medium text-[#002255]">確認が必要な条件：{projection.learner.length}件</summary>
      <p className="mt-2 text-xs leading-relaxed text-gray-600">件数は入力・選択・照合の操作単位です。同じ操作に関係する要件・カード・参考進捗をまとめています。</p>
      <ul className="mt-3 space-y-3">{projection.learner.map(condition => <Condition key={condition.id} condition={condition} onOpenProfile={onOpenProfile} />)}</ul>
    </details>}
    {projection.automatic.length > 0 && <details aria-label="自動判定できない条件" className="min-w-0 border border-gray-200 bg-slate-50 p-4">
      <summary className="cursor-pointer font-medium text-[#002255]">自動判定できない条件：{projection.automatic.length}件</summary>
      <p className="mt-2 text-xs leading-relaxed text-gray-600">個別ルール・カード・参考進捗の保留をそれぞれ1件と数えます。同じ理由でも独立した条件は別件です。成績取込の警告は上部に別掲しています。</p>
      <ul className="mt-3 space-y-3">{projection.automatic.map(condition => <Condition key={condition.id} condition={condition} />)}</ul>
    </details>}
    {projection.delegated.length > 0 && <p className="break-words text-xs leading-relaxed text-gray-600">上記カードで扱う条件：{projection.delegated.length}個別ルール。重複する説明を集約しています。個別ルールの判定保留は維持しています。</p>}
    {projection.excluded.length > 0 && <p className="break-words text-xs leading-relaxed text-gray-600">他学科・他コースの条件：{projection.excluded.length}個別ルールを確認一覧の対象外としています。内部の判定保留件数には含まれます。</p>}
  </div>;
}
