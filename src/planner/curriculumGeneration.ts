import type { CurriculumCatalog, CurriculumCourse, Mapping, PlannerCatalog } from './plannerCatalog';

export type CurriculumSourceRow = Omit<Mapping, 'scopeId' | 'source'> & { canonicalName: string; sourcePage: number };
export type CurriculumEquivalence = { id: string; mappingIds: string[]; evidenceOfferingIds: string[]; reason: string };
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const definition = (row: CurriculumSourceRow) => JSON.stringify([row.canonicalName, row.category, row.curriculumCredits, row.schoolingOnly, row.mediaOnly]);

/** Identity is pinned to explicit source-row groups, never inferred from offering display names. */
export function generateCurriculumCatalog(catalog: PlannerCatalog, rows: CurriculumSourceRow[], groups: CurriculumEquivalence[]): CurriculumCatalog {
  const mappings = new Map(catalog.mappings.map(mapping => [mapping.mappingId, mapping]));
  const source = new Map(rows.map(row => [row.mappingId, row]));
  if (source.size !== rows.length || source.size !== mappings.size) throw new Error('Curriculum source coverage differs');
  for (const row of rows) {
    const mapping = mappings.get(row.mappingId);
    if (!mapping || !row.canonicalName || row.sourcePage !== mapping.source.page) throw new Error('Curriculum source reference differs');
    for (const key of ['faculty', 'department', 'course', 'category', 'field', 'requirementType', 'curriculumCredits', 'eligibleYears', 'schoolingOnly', 'mediaOnly'] as const) {
      if (JSON.stringify(row[key]) !== JSON.stringify(mapping[key])) throw new Error(`Curriculum source differs: ${row.mappingId}/${key}`);
    }
  }
  const claimed = new Set<string>();
  const rowGroups: Array<{ id: string; mappingIds: string[] }> = [];
  const offerings = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  for (const group of groups) {
    if (!group.id.startsWith('curriculum:') || group.mappingIds.length < 2 || !group.reason || group.evidenceOfferingIds.length === 0) throw new Error('Missing equivalence evidence');
    const ids = sorted(group.mappingIds);
    if (ids.length !== group.mappingIds.length) throw new Error('Duplicate equivalence row');
    const connected = new Set([ids[0]]);
    const evidence = group.evidenceOfferingIds.map(id => {
      const offering = offerings.get(id);
      if (!offering || offering.resolutionStatus !== 'matched') throw new Error('Invalid equivalence evidence');
      return offering.mappingIds.filter(id => ids.includes(id));
    });
    for (let pass = 0; pass < ids.length; pass++) for (const edge of evidence) {
      if (edge.some(id => connected.has(id))) edge.forEach(id => connected.add(id));
    }
    if (connected.size !== ids.length) throw new Error('Disconnected equivalence evidence');
    const definitions = new Set(ids.map(id => {
      const row = source.get(id);
      if (!row || claimed.has(id)) throw new Error('Unknown or multiply claimed curriculum row');
      claimed.add(id);
      return definition(row);
    }));
    if (definitions.size !== 1) throw new Error('Incompatible curriculum definitions');
    rowGroups.push({ id: group.id, mappingIds: ids });
  }
  for (const row of rows) if (!claimed.has(row.mappingId)) rowGroups.push({ id: `curriculum:${row.mappingId}`, mappingIds: [row.mappingId] });
  const courses: CurriculumCourse[] = rowGroups.map(({ id, mappingIds: ids }) => {
    const first = source.get(ids[0])!;
    return { id, canonicalName: first.canonicalName, curriculumCredits: first.curriculumCredits,
      mappingIds: ids, scopeIds: sorted(ids.map(id => mappings.get(id)!.scopeId)) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(courses.map(course => course.id)).size !== courses.length) throw new Error('Duplicate curriculum identity');
  const courseForMapping = new Map(courses.flatMap(course => course.mappingIds.map(id => [id, course.id] as const)));
  const offeringRelations = catalog.offerings.map(offering => {
    const ids = offering.resolutionStatus === 'matched' ? sorted(offering.mappingIds.map(id => courseForMapping.get(id)!)) : [];
    return { offeringId: offering.id, curriculumCourseId: ids.length === 1 ? ids[0] : null, candidateCurriculumCourseIds: ids };
  }).sort((a, b) => a.offeringId.localeCompare(b.offeringId));
  // A legacy identity is migratable only if every member has one consistent relation.
  const legacyCourseRelations = catalog.courses.map(course => {
    const members = catalog.offerings.filter(offering => offering.courseId === course.id);
    const relations = members.map(offering => offeringRelations.find(relation => relation.offeringId === offering.id)!);
    const ids = sorted(relations.flatMap(relation => relation.candidateCurriculumCourseIds));
    return { legacyCourseId: course.id, curriculumCourseId: members.length > 0 && relations.every(relation => relation.curriculumCourseId !== null) && ids.length === 1 ? ids[0] : null,
      candidateCurriculumCourseIds: ids };
  }).sort((a, b) => a.legacyCourseId.localeCompare(b.legacyCourseId));
  return { schemaVersion: 1, source: 'official_curriculum_mappings_2026', courses, offeringRelations, legacyCourseRelations };
}
