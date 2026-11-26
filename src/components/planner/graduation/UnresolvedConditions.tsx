import type { ConditionProjection, UnresolvedCondition } from '../../../planner/graduation/unresolvedConditions';

function Condition({ condition }: { condition: UnresolvedCondition }) {
  return <li className="min-w-0 break-words border-t border-gray-200 pt-3 first:border-0 first:pt-0">
    <p className="font-medium">{condition.label}</p>
    <p className="mt-1 text-sm leading-relaxed">{condition.action}</p>
    {condition.destination === 'imports' && <a href="#imported-achievements" className="mt-2 inline-block py-2 underline">成績取込の管理へ</a>}
    <ul className="mt-2 space-y-2 text-xs leading-relaxed text-gray-700">{condition.targets.map(target => <li key={target.id}>
      <p>対象：{target.label}</p>
      {target.sourceRefs.length > 0 && <p>根拠：{target.sourceRefs.map((source, index) => <span key={index}>{index > 0 && ' / '}{source.url ? <a href={source.url} className="underline" target="_blank" rel="noreferrer">{source.title}</a> : source.title}{source.page && ` ${source.page}`}</span>)}</p>}
    </li>)}</ul>
  </li>;
}
type Props = {
  projection: ConditionProjection;
  onOpenProfile?: () => void;
};

// 卒業要件カード群の上側

export function ProfileUnresolvedConditions({
  projection,
  onOpenProfile
}: Props) {
  const conditions = projection.learner.filter(
    condition => condition.destination === 'profile'
  );

  if (conditions.length === 0) return null;

  return (
    <div className="mt-6 min-w-0">
      <details
        open
        aria-label="確認が必要な条件"
        className="min-w-0 border border-amber-200 bg-amber-50 p-4"
      >
        <summary className="cursor-pointer font-medium text-[#002255]">
          確認が必要な条件：{conditions.length}件
        </summary>

        <p className="mt-2 text-xs text-gray-600">
          プロフィールで以下の項目を設定してください。
        </p>

        <ul className="mt-3 space-y-3">
          {conditions.map(condition => (
            <li
              key={condition.id}
              className="min-w-0 break-words border-t border-amber-200 pt-3 first:border-0 first:pt-0"
            >
              <p className="font-medium">
                {condition.label}
              </p>
              <p className="mt-1 text-sm leading-relaxed">
                {condition.action}
              </p>
            </li>
          ))}
        </ul>

        {onOpenProfile && (
          <button
            type="button"
            onClick={onOpenProfile}
            className="planner-button mt-4 min-h-11 rounded border border-[#002255] px-4 py-2 font-medium text-[#002255]"
          >
            プロフィールを開く
          </button>
        )}
      </details>
    </div>
  );
}


export default function UnresolvedConditions({ projection }: { projection: ConditionProjection }) {
  const remaining = projection.learner.filter(condition => condition.destination !== 'profile');
  if (remaining.length === 0) return null;

  return <details open aria-label="その他の確認が必要な条件"
    className="mt-6 min-w-0 border border-amber-200 bg-amber-50 p-4">
    <summary className="cursor-pointer font-medium text-[#002255]">
      その他の確認が必要な条件：{remaining.length}件
    </summary>
    <ul className="mt-3 space-y-3">
      {remaining.map(condition => <Condition key={condition.id} condition={condition} />)}
    </ul>
  </details>;
}
