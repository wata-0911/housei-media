import type { Offering, PlannerItem } from './plannerCatalog';

/** A user's desired calendar year; never an offering-year or availability lookup. */
export function isFuturePlan(item: Pick<PlannerItem, 'plannedYear'>, offering: Pick<Offering, 'academicYear'>): boolean {
  return item.plannedYear !== null && item.plannedYear > offering.academicYear;
}

export function futurePlanNote(item: Pick<PlannerItem, 'plannedYear'>, offering: Pick<Offering, 'academicYear'>): string | null {
  return isFuturePlan(item, offering) ? `${item.plannedYear}年の仮計画：${offering.academicYear}年度カタログを参考 / 将来年度の開講は未確認` : null;
}

/** A desired term and a catalog opening period must remain distinguishable. */
export function planningTermLabel(item: Pick<PlannerItem, 'plannedYear' | 'plannedTerm'>, offering: Pick<Offering, 'academicYear' | 'period'>): string {
  if (!isFuturePlan(item, offering)) return item.plannedTerm ?? offering.period ?? '期未設定';
  return item.plannedTerm ? `${item.plannedTerm}（希望時期）` : '希望時期未設定';
}

export const FUTURE_PLAN_POLICY = '正式な科目名は原則年度で変わりませんが、カリキュラム改正時は変更され得ます。スクーリングの開講有無・時期・授業内容は年度ごとに変わります。毎年2月の新年度予定発表後に確認し、実際の開講は「法政通信」で確認してください。単位・区分・卒業要件は2026年度課程の参考です。';
