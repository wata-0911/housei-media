import type { Mapping, Offering, PlannerCatalog, PlannerItem } from './plannerCatalog';
import { createMappingResolver } from './plannerHelpers';
import { summarizeCredits } from './calculations';

export const creditCategories = ['一般教育：人文', '一般教育：社会', '一般教育：自然', '一般教育：その他', '外国語', '保健体育', '専門教育'] as const;
export const classificationStates = ['選択した所属のカリキュラム対象外', '教職等・通常カリキュラム対象外', '対応情報を確認中', '所属を選択すると区分を表示'] as const;
export type CreditCategory = typeof creditCategories[number];
export type CreditClassification = CreditCategory | typeof classificationStates[number];
export const isCreditCategory = (value: CreditClassification): value is CreditCategory => creditCategories.some(category => category === value);
export const selectablePrograms = (catalog: PlannerCatalog) => catalog.programs.filter(p => !p.isCommon);

// Exact catalog values only: preserve legacy text without interpreting it.
export function termOptions(offerings: Offering[]) {
  return [...new Set(offerings.flatMap(o => [o.deliveryCategory, o.period]).filter((v): v is string => v !== null && v !== ''))];
}

export function deliveryLabel(offering: Offering) {
  if (offering.method === 'correspondence') return '通信学習';
  return offering.deliveryCategory || '未分類';
}

export function groupAnnualPlan(items: PlannerItem[], offerings: Map<string, Offering>) {
  const years = [...new Set(items.map(i => i.plannedYear))].sort((a, b) => a === null ? 1 : b === null ? -1 : a - b);
  return years.map(year => {
    const groups = new Map<string, PlannerItem[]>();
    for (const item of items.filter(i => i.plannedYear === year)) {
      const offering = offerings.get(item.offeringId);
      if (!offering) throw new Error(`Unknown offering: ${item.offeringId}`);
      const label = deliveryLabel(offering);
      groups.set(label, [...(groups.get(label) ?? []), item]);
    }
    return { year, groups: [...groups].map(([label, entries]) => ({ label, items: entries })) };
  });
}

function mappingCategory(mapping: Mapping): CreditClassification {
  if (mapping.category === '一般教育' && ['人文', '社会', '自然', 'その他'].includes(mapping.field ?? '')) {
    return `一般教育：${mapping.field}` as CreditCategory;
  }
  if (mapping.category === '外国語' || mapping.category === '保健体育' || mapping.category === '専門教育') return mapping.category;
  return '対応情報を確認中';
}

export function createCreditClassifier(catalog: PlannerCatalog, scopeId: string | null) {
  const resolve = createMappingResolver(catalog);
  const selected = selectablePrograms(catalog).some(p => p.scopeId === scopeId);
  const common = new Set(catalog.programs.filter(p => p.isCommon).map(p => p.scopeId));
  return (offering: Offering): CreditClassification => {
    if (offering.resolutionStatus === 'outside_mapping_scope') return '教職等・通常カリキュラム対象外';
    if (offering.resolutionStatus !== 'matched' || offering.mappingIds.length === 0) return '対応情報を確認中';
    if (!selected) return '所属を選択すると区分を表示';
    const mappings = resolve(offering).filter(m => m.scopeId === scopeId || common.has(m.scopeId));
    if (mappings.length === 0) return '選択した所属のカリキュラム対象外';
    const categories = new Set(mappings.map(mappingCategory));
    return categories.size === 1 ? [...categories][0] : '対応情報を確認中';
  };
}

export function summarizeCategories(items: PlannerItem[], catalog: PlannerCatalog, scopeId: string | null) {
  const offerings = new Map(catalog.offerings.map(o => [o.id, o]));
  const classify = createCreditClassifier(catalog, scopeId);
  const grouped = new Map<CreditClassification, PlannerItem[]>([...creditCategories, ...classificationStates].map(c => [c, []]));
  for (const item of items) {
    const offering = offerings.get(item.offeringId);
    if (!offering) throw new Error(`Unknown offering: ${item.offeringId}`);
    grouped.get(classify(offering))!.push(item);
  }
  return [...creditCategories, ...classificationStates].map(category => ({ category, count: grouped.get(category)!.length, ...summarizeCredits(grouped.get(category)!, offerings) }));
}
