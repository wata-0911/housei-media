import type { Mapping, Offering, PlannerCatalog, PlannerItem, StructuredRequirement } from './plannerCatalog';
import { HISTORY_SCOPE_ID, isHistoricalSources, isHistorySeminar } from './historySeminar';
import { GEOGRAPHY_TRANSFER_RULES_2026 } from './geographyTransferRules';

export const UNRESOLVED_EARNED_REASON = '修得済みに対応関係を確認中の科目があります';

/** Candidate edges are uncertainty, never allocation or completion evidence. */
export type UnresolvedEarnedImpact = {
  globalUnknown: boolean;
  candidates: Array<{ mapping: Mapping; canonicalName: string | null; method: Offering['method'] }>;
  cardIds: Set<string>;
};

export function unresolvedEarnedImpact(items: PlannerItem[], catalog: PlannerCatalog, scopeId: string): UnresolvedEarnedImpact {
  const impact: UnresolvedEarnedImpact = { globalUnknown: false, candidates: [], cardIds: new Set() };
  const mappings = new Map(catalog.mappings.map(m => [m.mappingId, m]));
  const courses = catalog.curriculum?.courses ?? [];
  const programs = new Map(catalog.programs.map(p => [p.scopeId, p]));
  const department = programs.get(scopeId)?.department;
  const offerings = new Map(catalog.offerings.map(o => [o.id, o]));
  const addProfessional = (mapping: Mapping, canonicalName: string | null, method: Offering['method']) => {
    const supportedTypes = ({
      '日本文学科': ['必修', '選択必修', '選択'],
      '史学科': ['必修', 'スクーリング選択必修', '選択'],
      '地理学科': ['必修', 'スクーリング必修', '選択必修', '選択'],
      '法律学科': ['選択必修', '選択'], '経済学科': ['選択必修', '選択'], '商業学科': ['選択必修', '選択'],
    } as Record<string, string[]>)[department ?? ''];
    if (!supportedTypes?.includes(mapping.requirementType ?? '')) { impact.globalUnknown = true; return; }
    const types = new Set([mapping.requirementType!]);
    // Exact institutional identities select existing transfer rules. No annual
    // display-name or provisional courseId inference is used here.
    if (department === '地理学科') for (const rule of Object.values(GEOGRAPHY_TRANSFER_RULES_2026)) {
      const names: readonly string[] = 'canonicalName' in rule ? [rule.canonicalName] : rule.canonicalNames;
      if (canonicalName === null || names.includes(canonicalName)) {
        for (const [bucket] of rule.stages) types.add(bucket.split(':')[0]);
      }
    }
    if (department === '史学科' && (canonicalName === null || ['日本史概説', '東洋史概説', '西洋史概説'].includes(canonicalName))) {
      types.add('必修'); types.add('スクーリング選択必修'); types.add('選択');
    }
    const prefix = ({ '法律学科': 'law-', '日本文学科': '', '史学科': 'history-', '地理学科': 'geography-', '経済学科': 'economics-', '商業学科': 'commerce-' } as Record<string, string>)[department ?? ''];
    if (prefix === undefined) { impact.globalUnknown = true; return; }
    const ids = ({ '必修': 'required', '選択必修': 'required-elective', '選択': 'elective', 'スクーリング必修': 'schooling-required', 'スクーリング選択必修': 'schooling-required-elective' } as Record<string, string>);
    for (const type of types) impact.cardIds.add(`professional-${prefix}${ids[type]}`);
    // Required-elective excess flows to elective. Law's course-count gate also
    // permits known partials there; totals use mutually exclusive source buckets.
    if (types.has('選択必修') && ['法律学科', '日本文学科', '地理学科'].includes(department ?? '')) impact.cardIds.add(`professional-${prefix}elective`);
    if (department === '史学科' && types.has('スクーリング選択必修')) impact.cardIds.add('professional-history-elective');
    if (department !== '史学科') impact.cardIds.add(`professional-${department === '日本文学科' ? 'japanese-' : prefix}total`);
    if (department === '法律学科' && method === 'schooling') impact.cardIds.add('professional-law-schooling');
  };
  for (const item of items) {
    const offering = offerings.get(item.offeringId);
    if (item.status !== 'earned' || offering?.resolutionStatus !== 'manual_review') continue;
    if (scopeId === HISTORY_SCOPE_ID && (isHistorySeminar(offering) || isHistoricalSources(offering))) continue;
    const relations = catalog.curriculum?.offeringRelations.filter(r => r.offeringId === offering.id) ?? [];
    // attachCurriculumCatalog emits no institutional identity or relation
    // candidates for manual_review. Stale post-attach identities are not
    // localization authority, even if they reference a real Course.
    if (relations.length !== 1 || offering.curriculumCourseId != null
      || relations[0].curriculumCourseId !== null || relations[0].candidateCurriculumCourseIds.length !== 0) {
      impact.globalUnknown = true; continue;
    }
    // The existing schema/resolver/attach contract permits explicit Mapping
    // edges on manual_review while keeping its Course relation empty. These
    // edges describe possible impact only; they never resolve or earn credits.
    if (offering.mappingIds.length === 0) impact.globalUnknown = true;
    for (const id of offering.mappingIds) {
      const mapping = mappings.get(id);
      if (!mapping || !programs.has(mapping.scopeId)
        || !['一般教育', '外国語', '保健体育', '専門教育'].includes(mapping.category)
        || (mapping.field !== null && typeof mapping.field !== 'string')
        || (mapping.category === '一般教育' && mapping.field !== null && !['人文', '社会', '自然'].includes(mapping.field))
        || (mapping.category === '外国語' && !['英語', '独語', '仏語'].includes(mapping.field ?? ''))
        || (mapping.category === '専門教育' && !['必修', '選択必修', '選択', 'スクーリング必修', 'スクーリング選択必修'].includes(mapping.requirementType ?? ''))) {
        impact.globalUnknown = true; continue;
      }
      if (mapping.scopeId !== scopeId && !programs.get(mapping.scopeId)!.isCommon) continue;
      const owners = courses.filter(c => c.mappingIds.includes(id));
      const canonicalName = owners.length === 1 ? owners[0].canonicalName : null;
      impact.candidates.push({ mapping, canonicalName, method: offering.method });
      if (mapping.category === '専門教育') addProfessional(mapping, canonicalName, offering.method);
      else impact.cardIds.add(({ '一般教育': 'group-general', '外国語': 'group-foreign', '保健体育': 'group-physical' } as Record<string, string>)[mapping.category]);
    }
  }
  return impact;
}

export function impactsCard(impact: UnresolvedEarnedImpact, id: string) {
  return impact.globalUnknown || impact.cardIds.has(id);
}

export function impactsRequirement(impact: UnresolvedEarnedImpact, requirement: StructuredRequirement,
  mappingMatches: (mapping: Mapping, requirement: StructuredRequirement) => boolean, targetMappingIds: Set<string> | null) {
  if (impact.globalUnknown) return true;
  const names = requirement.target.course_names ?? (requirement.target.course_name ? [requirement.target.course_name] : null);
  return impact.candidates.some(candidate => mappingMatches(candidate.mapping, requirement)
    && (!requirement.conditions?.method || candidate.method === requirement.conditions.method)
    && (names === null || candidate.canonicalName === null || names.includes(candidate.canonicalName)
      || targetMappingIds?.has(candidate.mapping.mappingId)));
}
