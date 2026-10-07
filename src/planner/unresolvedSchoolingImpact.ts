import type { GraduationProfile, PlannerCatalog, StructuredRequirement } from './plannerCatalog';
import { officialFactCreditState, type DerivedOfficialGraduationFacts } from './officialGraduationFacts';
import { LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026 } from './graduationSources';
import type { GlobalOfficialSchoolingContribution } from './globalOfficialSchooling';
import { validOfficialImpactMapping, officialCandidateMappings, officialCandidatesMatchRequirement, unresolvedOfficialImpact, type UnresolvedOfficialImpact } from './unresolvedOfficialImpact';

/** H42 describes missing schooling increments, never a second allocation ledger.
 * H19/H43 can account for an increment in global reference without resolving its
 * foreign/law/structured eligibility. This helper itself never adds credits.
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
  globalSchooling: readonly GlobalOfficialSchoolingContribution[] = [],
): UnresolvedSchoolingImpact {
  const isLaw = catalog.programs.some(p => p.scopeId === scopeId && p.department === '法律学科');
  const impact: UnresolvedSchoolingImpact = {
    globalUnknown: hasOrphanRecords, globalReferenceUnknown: hasOrphanRecords,
    candidates: [], foreignLanguages: new Set(), lawProfessionalUnknown: isLaw && hasOrphanRecords,
  };
  const allocations = new Map(official.allocations.map(a => [a.fact, a]));
  const globallyAccounted = new Set(globalSchooling.map(c => c.fact));
  for (const fact of official.facts) {
    if (fact.allocation.kind === 'out_of_scope' || officialFactCreditState(fact).allZero) continue;
    const allocation = allocations.get(fact);
    if (allocation && allocation.schoolingCredits !== null) continue;
    // An explicit zero has no missing S increment. Conflicting media evidence
    // is not a confirmed zero, even though the original source row says zero.
    if (fact.schoolingEvidence.credits === 0 && !fact.diagnostics.includes('media_schooling_credits_conflict')) continue;
    if (!globallyAccounted.has(fact)) impact.globalReferenceUnknown = true;
    const mappings = allocation
      ? validOfficialImpactMapping(allocation.mapping, catalog) ? [allocation.mapping] : null
      : officialCandidateMappings(fact, catalog, scopeId, profile);
    if (!mappings) {
      impact.globalUnknown = true;
      if (isLaw) impact.lawProfessionalUnknown = true;
      continue;
    }
    const ordinaryClosure = allocation ? null : unresolvedOfficialImpact([fact], false, catalog, scopeId, profile);
    // A special family's unresolved ordinary routing does not erase its proven
    // schooling location. Keep known transfer destinations where H41 has a safe
    // closure; otherwise retain every validated Mapping, without allocating S.
    const candidates = ordinaryClosure?.candidates.slice() ?? [];
    for (const mapping of mappings) {
      if (!candidates.some(candidate => candidate.mapping.mappingId === mapping.mappingId)) {
        candidates.push({ mapping, canonicalName: fact.canonicalName!, affectsHistorySeminar: false,
          destinations: [{ category: mapping.category, field: mapping.field, requirementType: mapping.requirementType }] });
      }
    }
    impact.candidates.push(...candidates);
    for (const candidate of candidates) {
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

/** A missing S increment can complete a language only after its ordinary minimum
 * is met. Other ordinary/recognition holds remain the caller's responsibility.
 */
export function schoolingCanChangeForeignCompletion(
  impact: UnresolvedSchoolingImpact,
  languages: Array<{ label: string; earned: number | null; schooling?: number }>,
): boolean {
  return impact.globalUnknown || languages.some(language => impact.foreignLanguages.has(language.label)
    && language.earned !== null && language.earned >= 4 && (language.schooling ?? 0) < 2);
}
