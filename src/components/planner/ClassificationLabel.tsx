import type { CreditClassification } from '../../planner/annualPlan';

export default function ClassificationLabel({ value }: { value: CreditClassification }) {
  return <p className={`text-xs leading-relaxed break-words my-2 ${value === '対応情報を確認中' ? 'text-amber-800' : 'text-slate-600'}`}>{value}</p>;
}
