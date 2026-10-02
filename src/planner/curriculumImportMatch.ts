import type { HoseiGradeImportCourse } from './gradeImportContract';
import type { CurriculumCatalog, Mapping, Offering } from './plannerCatalog';
import { normalizeImportBaseName } from './importNameNormalization';
import { categoryFromImportRaw } from './annualPlan';

export type CurriculumImportMatch = {
  curriculumCourseId: string | null;
  curriculumMatch: 'exact_unique' | 'ambiguous' | 'unmatched';
  candidateCurriculumCourseIds: string[];
};

/** Stage A. Names find candidates; only source-row identities and explicit annual relations identify courses. */
export function matchImportedCurriculumCourse(course: Pick<HoseiGradeImportCourse, 'rawName' | 'categoryRaw' | 'compositionCredits'>, offerings: Offering[], curriculum: CurriculumCatalog, mappings: Mapping[]): CurriculumImportMatch {
  const name = normalizeImportBaseName(course.rawName);
  const aliases = new Set(offerings.filter(offering => offering.resolutionStatus === 'matched'
    && offering.curriculumCourseId && normalizeImportBaseName(offering.name) === name).map(offering => offering.curriculumCourseId!));
  const byMapping = new Map(mappings.map(mapping => [mapping.mappingId, mapping]));
  const category = categoryFromImportRaw(course.categoryRaw);
  const candidates = curriculum.courses.filter(candidate => {
    if (normalizeImportBaseName(candidate.canonicalName) !== name && !aliases.has(candidate.id)) return false;
    // Official composition credits constrain the course, never a two-credit offering component.
    const credits = course.compositionCredits.value;
    if (credits !== null && credits > 0 && candidate.curriculumCredits !== null && candidate.curriculumCredits !== credits) return false;
    if (!category) return true;
    return candidate.mappingIds.some(id => {
      const mapping = byMapping.get(id);
      return mapping && (mapping.category === '一般教育' ? `一般教育：${mapping.field}` : mapping.category) === category;
    });
  }).map(candidate => candidate.id).sort();
  return { curriculumCourseId: candidates.length === 1 ? candidates[0] : null,
    curriculumMatch: candidates.length === 1 ? 'exact_unique' : candidates.length > 0 ? 'ambiguous' : 'unmatched',
    candidateCurriculumCourseIds: candidates };
}

/** An opening selection changes the annual match; clearing it retains the independently known course. */
export function curriculumMatchForOfferingSelection(current: Partial<CurriculumImportMatch>, offering: Offering | undefined, curriculum: CurriculumCatalog): CurriculumImportMatch & { offeringMatch: 'exact_unique' | 'unmatched' } {
  const retained = { curriculumCourseId: current.curriculumCourseId ?? null,
    curriculumMatch: current.curriculumMatch ?? 'unmatched', candidateCurriculumCourseIds: current.candidateCurriculumCourseIds ?? [] };
  if (!offering) return { ...retained, offeringMatch: 'unmatched' };
  // Stage A is independent. A compatible opening retains it; an incompatible pair is
  // rejected by identity validation before saving, without overwriting the known course.
  if (current.curriculumMatch === 'exact_unique' && current.curriculumCourseId) return { ...retained, offeringMatch: 'exact_unique' };
  const courseId = offering.resolutionStatus === 'matched' ? offering.curriculumCourseId ?? null : null;
  const candidates = courseId ? [courseId] : curriculum.offeringRelations.find(relation => relation.offeringId === offering.id)?.candidateCurriculumCourseIds ?? [];
  return { curriculumCourseId: courseId, curriculumMatch: courseId ? 'exact_unique' : candidates.length ? 'ambiguous' : 'unmatched', candidateCurriculumCourseIds: candidates, offeringMatch: 'exact_unique' };
}
