import type { Offering } from '../plannerCatalog';

/** A frozen registration session, not a learner's planned date or an award.
 * Normal/teacher openings in the same original year, delivery and period share
 * one session. Different titles/IDs do not establish another attendance. */
export function recordedOpeningSessionKey(offering: Offering, catalogYear: number) {
  return offering.curriculumCourseId && offering.academicYear === catalogYear && offering.classCode
    && offering.deliveryCategory && offering.period
    ? JSON.stringify([offering.curriculumCourseId, offering.academicYear, offering.deliveryCategory, offering.period]) : null;
}
