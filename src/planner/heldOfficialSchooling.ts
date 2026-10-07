import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import type { GraduationProfile, PlannerCatalog } from './plannerCatalog';
import { exactImportedCurriculumId } from './officialCourseCredits';
import { deriveMethodEvidence, specialOfficialCourse, type DerivedOfficialGraduationFacts, type OfficialGraduationFact } from './officialGraduationFacts';
import { officialCandidateMappings } from './unresolvedOfficialImpact';
import { LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026 } from './graduationSources';

/** Calculation-only H43 evidence for global reference, never an ordinary or
 * consumer-specific allocation. The fact reference also identifies the exact
 * missing increment that H42 may discharge for global reference only.
 */
export type HeldOfficialSchoolingContribution = { fact: OfficialGraduationFact; schoolingCredits: number };

const positive = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;
const absentOrZero = (n: number | null) => n === null || n === 0;

export function heldOfficialSchoolingContributions(
  official: DerivedOfficialGraduationFacts, rows: ImportedCourseAchievement[], records: ImportedStudyRecord[],
  catalog: PlannerCatalog, scopeId: string, profile: GraduationProfile,
): HeldOfficialSchoolingContribution[] {
  // Professional recognition can independently generate schooling items. Do
  // not invent overlap resolution, even when ordinary held before its guard.
  if ((profile.recognizedCredits.professionalCourses?.length ?? 0) > 0
    || (profile.admissionType !== 'first_year' && profile.recognizedCredits.schoolingEquivalentCredits !== 0)) return [];
  const department = catalog.programs.find(p => p.scopeId === scopeId)?.department ?? null;
  const sourceRows = new Map(rows.map(row => [row.id, row]));
  const accounted = new Set(official.allocations.flatMap(a => a.fact.sourceRowIds));
  const result: HeldOfficialSchoolingContribution[] = [];
  for (const fact of official.facts) {
    if (fact.allocation.kind !== 'unknown'
      || !['mapping_conflict', 'special_rule_evidence_required'].includes(fact.allocation.reason)
      || fact.sourceRows.length !== 1 || fact.sourceRowIds.length !== 1
      || fact.sourceRowIds.some(id => accounted.has(id))) continue;
    const row = sourceRows.get(fact.sourceRowIds[0]);
    if (!row || exactImportedCurriculumId(row, catalog) !== fact.curriculumCourseId
      || !absentOrZero(row.recognizedExemption) || !absentOrZero(row.additionalEnrollment)) continue;
    const mappings = officialCandidateMappings(fact, catalog, scopeId, profile);
    const course = catalog.curriculum?.courses.find(c => c.id === fact.curriculumCourseId);
    if (!mappings?.length || !course || !positive(course.curriculumCredits)
      || row.compositionCredits !== course.curriculumCredits
      || !positive(row.earnedCreditsTotal) || row.earnedCreditsTotal > course.curriculumCredits
      || fact.earnedCreditsTotal !== row.earnedCreditsTotal
      || fact.schoolingEvidence.source !== 'official_row'
      || fact.schoolingEvidence.credits !== row.schoolingCreditsTotal
      || !positive(row.schoolingCreditsTotal) || row.schoolingCreditsTotal > row.earnedCreditsTotal
      || row.schoolingCreditsTotal > course.curriculumCredits) continue;
    // Every candidate must independently permit ordinary global S. No chosen
    // Mapping, media inference, special policy or H19 positive split here.
    if (LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026.has(course.canonicalName)
      || mappings.some(mapping => mapping.schoolingOnly || mapping.mediaOnly
        || specialOfficialCourse(course.canonicalName, department, mapping)
        || !(mapping.category === '一般教育' && ['人文', '社会', '自然', 'その他'].includes(mapping.field ?? '')
          || mapping.category === '外国語'
          || mapping.category === '保健体育' && /^(健康・スポーツ科学概論|スポーツ総合演習)/.test(course.canonicalName)
          || mapping.category === '専門教育' && ['必修', '選択必修', '選択'].includes(mapping.requirementType ?? '')))
      || deriveMethodEvidence(row, records).media === 'conflict') continue;
    result.push({ fact, schoolingCredits: row.schoolingCreditsTotal });
    accounted.add(row.id);
  }
  return result;
}
