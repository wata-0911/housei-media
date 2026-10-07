import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import type { GraduationProfile, PlannerCatalog } from './plannerCatalog';
import { specialOfficialCourse, type DerivedOfficialGraduationFacts } from './officialGraduationFacts';
import { safePositiveOfficialSchooling, type GlobalOfficialSchoolingContribution } from './globalOfficialSchooling';
import { LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026 } from './graduationSources';

/** Calculation-only H43 evidence for global reference, never an ordinary or
 * consumer-specific allocation. The fact reference also identifies the exact
 * missing increment that H42 may discharge for global reference only.
 */
export type HeldOfficialSchoolingContribution = GlobalOfficialSchoolingContribution;

export function heldOfficialSchoolingContributions(
  official: DerivedOfficialGraduationFacts, rows: ImportedCourseAchievement[], records: ImportedStudyRecord[],
  catalog: PlannerCatalog, scopeId: string, profile: GraduationProfile,
): HeldOfficialSchoolingContribution[] {
  const department = catalog.programs.find(p => p.scopeId === scopeId)?.department ?? null;
  const accounted = new Set(official.allocations.flatMap(a => a.fact.sourceRowIds));
  const result: HeldOfficialSchoolingContribution[] = [];
  for (const fact of official.facts) {
    if (fact.allocation.kind !== 'unknown'
      || !['mapping_conflict', 'special_rule_evidence_required'].includes(fact.allocation.reason)
      || fact.sourceRowIds.some(id => accounted.has(id))) continue;
    const proof = safePositiveOfficialSchooling(fact, rows, records, catalog, scopeId, profile);
    if (!proof) continue;
    const { row, course, mappings } = proof;
    // Every candidate must independently permit ordinary global S. No chosen
    // Mapping, media inference, special policy or H19 positive split here.
    if (LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026.has(course.canonicalName)
      || mappings.some(mapping => mapping.schoolingOnly || mapping.mediaOnly
        || specialOfficialCourse(course.canonicalName, department, mapping)
        || !(mapping.category === '一般教育' && ['人文', '社会', '自然', 'その他'].includes(mapping.field ?? '')
          || mapping.category === '外国語'
          || mapping.category === '保健体育' && /^(健康・スポーツ科学概論|スポーツ総合演習)/.test(course.canonicalName)
          || mapping.category === '専門教育' && ['必修', '選択必修', '選択'].includes(mapping.requirementType ?? '')))) continue;
    result.push({ fact, schoolingCredits: proof.schoolingCredits });
    accounted.add(row.id);
  }
  return result;
}
