import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import type { GraduationProfile, PlannerCatalog } from './plannerCatalog';
import { exactImportedCurriculumId } from './officialCourseCredits';
import { deriveMethodEvidence, type OfficialGraduationFact } from './officialGraduationFacts';
import { officialCandidateMappings } from './unresolvedOfficialImpact';

/** Calculation-only global reference quantity. Never a consumer allocation or
 * persistent state. The fact identifies only the global increment H42 may clear.
 */
export type GlobalOfficialSchoolingContribution = { fact: OfficialGraduationFact; schoolingCredits: number };

const positive = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;
const absentOrZero = (n: number | null) => n === null || n === 0;
const sourceQuantities = ['earnedCreditsTotal', 'schoolingCreditsTotal', 'compositionCredits', 'recognizedExemption', 'additionalEnrollment'] as const;

/** Shared H19/H43 proof, with no bucket/special-policy authorization. Each caller
 * must still prove its own eligibility and exclude already accounted source IDs.
 */
export function safePositiveOfficialSchooling(
  fact: OfficialGraduationFact, rows: ImportedCourseAchievement[], records: ImportedStudyRecord[],
  catalog: PlannerCatalog, scopeId: string, profile: GraduationProfile,
) {
  if ((profile.recognizedCredits.professionalCourses?.length ?? 0) > 0
    || (profile.admissionType !== 'first_year' && profile.recognizedCredits.schoolingEquivalentCredits !== 0)
    || fact.sourceRows.length !== 1 || fact.sourceRowIds.length !== 1) return null;
  const sources = rows.filter(row => row.id === fact.sourceRowIds[0]);
  const row = sources[0];
  if (!row || row.source !== 'hosei_import' || exactImportedCurriculumId(row, catalog) !== fact.curriculumCourseId
    || !absentOrZero(row.recognizedExemption) || !absentOrZero(row.additionalEnrollment)) return null;
  // Identical repeated input is idempotent; contradictory copies of one ID are
  // not authority to choose the last snapshot. Different IDs are held upstream.
  if (sources.some(other => other.source !== row.source || exactImportedCurriculumId(other, catalog) !== fact.curriculumCourseId
    || sourceQuantities.some(key => !Object.is(other[key], row[key])))) return null;
  const mappings = officialCandidateMappings(fact, catalog, scopeId, profile);
  const course = catalog.curriculum?.courses.find(c => c.id === fact.curriculumCourseId);
  if (!mappings?.length || !course || !positive(course.curriculumCredits)
    || new Set(course.mappingIds).size !== course.mappingIds.length
    || row.compositionCredits !== course.curriculumCredits
    || !positive(row.earnedCreditsTotal) || row.earnedCreditsTotal > course.curriculumCredits
    || fact.earnedCreditsTotal !== row.earnedCreditsTotal
    || fact.schoolingEvidence.source !== 'official_row'
    || fact.schoolingEvidence.credits !== row.schoolingCreditsTotal
    || !positive(row.schoolingCreditsTotal) || row.schoolingCreditsTotal > row.earnedCreditsTotal
    || row.schoolingCreditsTotal > course.curriculumCredits) return null;
  const method = deriveMethodEvidence(row, records);
  if (method.media === 'conflict') return null;
  return { row, course, mappings, method, schoolingCredits: row.schoolingCreditsTotal };
}
