import type { CurriculumCourse, Mapping, Offering, PlannerCatalog } from '../plannerCatalog';

/** The four p.54 destination rows describe transfers from earlier awards. Their
 * own Course/Mapping identity is never evidence of a separate registration. */
const destinations = new Map([
  ['curriculum:763f0ed3-0c6a-42e9-972c-4cf29de549bc', '地理特講（地誌学特講）'],
  ['curriculum:8fb43286-9d1d-444d-aa8f-4479f30d1c2a', '地理特講（人文地理学演習）'],
  ['curriculum:53c249d9-c2ec-4754-a633-37b5dc66f392', '地理特講（自然地理学演習）'],
  ['curriculum:ff7f30ab-1445-4c69-9213-3e92b45eacf1', '地域特講（現地研究）'],
]);

export function geographyDestinationCourse(course: CurriculumCourse | undefined, mapping: Mapping): boolean {
  return mapping.department === '地理学科' && course !== undefined
    && destinations.get(course.id) === course.canonicalName
    && course.mappingIds.includes(mapping.mappingId);
}

/** Annual offerings must have a verified fixed Course edge; title/year alone
 * must not create or release a transfer award. */
export function geographyDestinationOffering(offering: Offering, catalog: PlannerCatalog): boolean {
  const course = catalog.curriculum?.courses.find(c => c.id === offering.curriculumCourseId);
  return (course !== undefined && destinations.get(course.id) === course.canonicalName)
    || offering.mappingIds.some(id => catalog.mappings.some(m => m.mappingId === id && geographyDestinationMapping(m)));
}

export function geographyDestinationMapping(mapping: Mapping): boolean {
  return mapping.department === '地理学科' && [...destinations.keys()]
    .some(id => id.slice('curriculum:'.length) === mapping.mappingId);
}
