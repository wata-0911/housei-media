import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import type { GraduationProfile, PlannerCatalog } from './plannerCatalog';
import type { DerivedOfficialGraduationFacts } from './officialGraduationFacts';
import { LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026 } from './graduationSources';
import { safePositiveOfficialSchooling, type GlobalOfficialSchoolingContribution } from './globalOfficialSchooling';

/** H19: the 13 exact Law markers are ineligible for professional S8, but their
 * independently proven source S can count for global S30. Ordinary/special
 * allocation stays unchanged, including its null schooling consumer input.
 */
export function lawExcludedOfficialSchoolingContributions(
  official: DerivedOfficialGraduationFacts, rows: ImportedCourseAchievement[], records: ImportedStudyRecord[],
  catalog: PlannerCatalog, scopeId: string, profile: GraduationProfile,
  alreadyAccounted: readonly GlobalOfficialSchoolingContribution[] = [],
): GlobalOfficialSchoolingContribution[] {
  if (!catalog.programs.some(p => p.scopeId === scopeId && p.department === '法律学科' && !p.isCommon)) return [];
  const accounted = new Set([
    ...official.allocations.filter(a => a.schoolingCredits !== null).flatMap(a => a.fact.sourceRowIds),
    ...alreadyAccounted.flatMap(c => c.fact.sourceRowIds),
  ]);
  const result: GlobalOfficialSchoolingContribution[] = [];
  for (const fact of official.facts) {
    if (!LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026.has(fact.canonicalName ?? '')
      || fact.allocation.kind === 'out_of_scope'
      || (fact.allocation.kind === 'unknown' && fact.allocation.reason !== 'special_rule_evidence_required')
      || fact.sourceRowIds.some(id => accounted.has(id))) continue;
    const proof = safePositiveOfficialSchooling(fact, rows, records, catalog, scopeId, profile);
    if (!proof) continue;
    const { mappings, method, row } = proof;
    // No public/common/foreign/special-family generalization. Every candidate
    // must independently be the same Law professional descriptor. Only exact
    // marker families get this exception when ordinary repeatable routing holds.
    const signatures = new Set(mappings.map(m => JSON.stringify([m.requirementType, m.schoolingOnly, m.mediaOnly])));
    if (signatures.size !== 1 || mappings.some(m => m.scopeId !== scopeId || m.category !== '専門教育'
      || m.field !== null || !['選択必修', '選択'].includes(m.requirementType ?? '')
      || (m.mediaOnly && !method.allEarnedCreditsAreMedia)
      || (m.schoolingOnly && row.schoolingCreditsTotal !== row.earnedCreditsTotal && !method.allEarnedCreditsAreMedia))) continue;
    result.push({ fact, schoolingCredits: proof.schoolingCredits });
    accounted.add(row.id);
  }
  return result;
}
