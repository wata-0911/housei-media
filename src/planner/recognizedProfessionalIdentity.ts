import type { PlannerCatalog, RecognizedProfessionalCourse } from './plannerCatalog';

export type RecognitionIdentityResolution =
  | { kind: 'resolved'; curriculumCourseId: string }
  | { kind: 'unresolved'; reason: 'unsupported_catalog' | 'missing_identity' | 'invalid_relation' | 'inconsistent' };

/** H14 calculation-only identity proof. Names and credit quantities are not inputs
 * to the proof. Mapping alone is supplementary: the profile UI captures it from
 * an Offering, and existing recognition calculation requires an Offering.
 */
export function resolveRecognizedProfessionalCurriculumIdentity(
  row: RecognizedProfessionalCourse, catalog: PlannerCatalog,
): RecognitionIdentityResolution {
  const curriculum = catalog.curriculum;
  if (curriculum?.source !== 'official_curriculum_mappings_2026' || curriculum.schemaVersion !== 1) {
    return { kind: 'unresolved', reason: 'unsupported_catalog' };
  }
  const unresolved = (reason: 'missing_identity' | 'invalid_relation' | 'inconsistent'): RecognitionIdentityResolution => ({ kind: 'unresolved', reason });
  const uniqueOwner = (mappingId: string): string | null => {
    if (catalog.mappings.filter(m => m.mappingId === mappingId).length !== 1) return null;
    const owners = curriculum.courses.filter(c => c.mappingIds.includes(mappingId));
    return owners.length === 1 ? owners[0].id : null;
  };
  const validCourse = (id: string): boolean => {
    const courses = curriculum.courses.filter(c => c.id === id);
    if (courses.length !== 1) return false;
    const ids = courses[0].mappingIds;
    return ids.length > 0 && new Set(ids).size === ids.length && ids.every(mappingId => uniqueOwner(mappingId) === id);
  };
  const exactRelation = (relations: Array<{ curriculumCourseId: string | null; candidateCurriculumCourseIds: string[] }>): string | null => {
    if (relations.length !== 1) return null;
    const { curriculumCourseId: id, candidateCurriculumCourseIds: candidates } = relations[0];
    return id && candidates.length === 1 && candidates[0] === id && validCourse(id) ? id : null;
  };
  const offeringIdentity = (offeringId: string): string | null => {
    const offerings = catalog.offerings.filter(o => o.id === offeringId);
    if (offerings.length !== 1) return null;
    const offering = offerings[0];
    const id = exactRelation(curriculum.offeringRelations.filter(r => r.offeringId === offeringId));
    // Check the explicit relation against every annual Mapping edge. A cached
    // joined id alone, or a stale relation beside different edges, is no proof.
    if (!id || offering.resolutionStatus !== 'matched'
      || (offering.curriculumCourseId !== undefined && offering.curriculumCourseId !== id)
      || !offering.mappingIds.length || new Set(offering.mappingIds).size !== offering.mappingIds.length
      || offering.mappingIds.some(mappingId => uniqueOwner(mappingId) !== id)) return null;
    return id;
  };
  if (row.offeringId === null && row.courseId === null) return unresolved('missing_identity');
  const evidence: string[] = [];
  if (row.offeringId !== null) {
    const id = offeringIdentity(row.offeringId);
    if (!id) return unresolved('invalid_relation');
    evidence.push(id);
  }
  if (row.courseId !== null) {
    if (catalog.courses.filter(c => c.id === row.courseId).length !== 1) return unresolved('invalid_relation');
    const id = exactRelation(curriculum.legacyCourseRelations.filter(r => r.legacyCourseId === row.courseId));
    if (!id) return unresolved('invalid_relation');
    // The generated legacy crosswalk requires every annual member to agree.
    // Preserve explicit historical crosswalks with no remaining annual members,
    // but never ignore contradictory members still present in this catalog.
    if (catalog.offerings.filter(o => o.courseId === row.courseId).some(o => offeringIdentity(o.id) !== id)) return unresolved('inconsistent');
    evidence.push(id);
  }
  if (row.mappingId !== null) {
    const id = uniqueOwner(row.mappingId);
    if (!id || !validCourse(id)) return unresolved('invalid_relation');
    evidence.push(id);
  }
  return evidence.every(id => id === evidence[0])
    ? { kind: 'resolved', curriculumCourseId: evidence[0] }
    : unresolved('inconsistent');
}
