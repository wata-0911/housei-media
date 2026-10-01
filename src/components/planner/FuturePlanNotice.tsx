import { futurePlanNote } from '../../planner/futurePlanning';
import type { Offering, PlannerItem } from '../../planner/plannerCatalog';

export default function FuturePlanNotice({ item, offering }: { item: PlannerItem; offering: Offering }) {
  const note = futurePlanNote(item, offering);
  return note ? <p className="mt-2 text-xs text-amber-800">{note}。方式・開講期・担当教員・シラバスは{offering.academicYear}年度情報（参考）です。</p> : null;
}
