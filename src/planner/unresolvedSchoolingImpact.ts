import type { GraduationProfile, PlannerCatalog, StructuredRequirement } from './plannerCatalog';
import { officialFactCreditState, type DerivedOfficialGraduationFacts } from './officialGraduationFacts';
import { LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026 } from './graduationSources';
import { validOfficialImpactMapping, officialCandidateMappings, officialCandidatesMatchRequirement, unresolvedOfficialImpact, type UnresolvedOfficialImpact } from './unresolvedOfficialImpact';

/** H42 describes missing schooling increments, never a second allocation ledger.
 * In particular a held positive S budget (H43) is not part of earned here.
 */
export type UnresolvedSchoolingImpact = {
  globalUnknown: boolean;
  globalReferenceUnknown: boolean;
  candidates: UnresolvedOfficialImpact['candidates'];
  foreignLanguages: Set<string>;
  lawProfessionalUnknown: boolean;
};

export function unresolvedSchoolingImpact(
  official: DerivedOfficialGraduationFacts, hasOrphanRecords: boolean, catalog: PlannerCatalog,
  scopeId: string, profile: GraduationProfile,
): UnresolvedSchoolingImpact {
  const isLaw = catalog.programs.some(p => p.scopeId === scopeId && p.department === '法律学科');
  const impact: UnresolvedSchoolingImpact = {
    globalUnknown: hasOrphanRecords, globalReferenceUnknown: hasOrphanRecords,
    candidates: [], foreignLanguages: new Set(), lawProfessionalUnknown: isLaw && hasOrphanRecords,
  };
  const allocations = new Map(official.allocations.map(a => [a.fact, a]));
  for (const fact of official.facts) {
    if (fact.allocation.kind === 'out_of_scope' || officialFactCreditState(fact).allZero) continue;
    const allocation = allocations.get(fact);
    if (allocation && allocation.schoolingCredits !== null) continue;
    // An explicit zero has no missing S increment. Conflicting media evidence
    // is not a confirmed zero, even though the original source row says zero.
    if (fact.schoolingEvidence.credits === 0 && !fact.diagnostics.includes('media_schooling_credits_conflict')) continue;
    impact.globalReferenceUnknown = true;
    const closure = allocation ? {
      globalUnknown: !validOfficialImpactMapping(allocation.mapping, catalog),
      candidates: [{ mapping: allocation.mapping, canonicalName: fact.canonicalName!, affectsHistorySeminar: false,
        destinations: [{ category: allocation.mapping.category, field: allocation.mapping.field, requirementType: allocation.mapping.requirementType }] }],
    } : unresolvedOfficialImpact([fact], false, catalog, scopeId, profile);
    if (closure.globalUnknown) {
      impact.globalUnknown = true;
      // Exact exclusion can settle law S8 even when a special family's other
      // destinations remain unsafe. Validate the same Course/Mapping edges;
      // do not infer identity from its source/display name (or from an Offering).
      const mappings = officialCandidateMappings(fact, catalog, scopeId, profile);
      const excluded = mappings && mappings.length > 0
        && LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026.has(fact.canonicalName ?? '')
        && mappings.every(m => m.scopeId === scopeId && m.category === '専門教育');
      if (isLaw && !excluded) impact.lawProfessionalUnknown = true;
    }
    impact.candidates.push(...closure.candidates);
    for (const candidate of closure.candidates) {
      const mapping = candidate.mapping;
      if (mapping.category === '外国語' && ['英語', '独語', '仏語'].includes(mapping.field ?? '')) impact.foreignLanguages.add(mapping.field!);
      if (isLaw && mapping.scopeId === scopeId && mapping.category === '専門教育'
        && mapping.requirementType !== '公開科目'
        && !LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026.has(candidate.canonicalName)) impact.lawProfessionalUnknown = true;
    }
  }
  return impact;
}

export function schoolingImpactsRequirement(impact: UnresolvedSchoolingImpact, requirement: StructuredRequirement): boolean {
  return requirement.ruleType === 'min_schooling_credits'
    && (impact.globalUnknown || officialCandidatesMatchRequirement(impact.candidates, requirement));
}
