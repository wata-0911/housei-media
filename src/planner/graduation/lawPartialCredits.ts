import type { Mapping } from '../plannerCatalog';
import type { OrdinaryComponent } from '../progress/ordinaryCourseCompletion';

/** 2026 shiori p.47 b. A regular S2 record, never a sum of fractional rows. */
export function lawPartialSchoolingCredits(mapping: Mapping, components: OrdinaryComponent[]): number {
  const substantive = components.filter(c => c.credits !== 0);
  return mapping.department === '法律学科' && mapping.category === '専門教育'
    && ['選択必修', '選択'].includes(mapping.requirementType ?? '') && mapping.curriculumCredits === 4
    // Several S2 claims establish at least one S2, never independent completion4.
    && substantive.length > 0 && substantive.every(c => c.credits === 2 && ['schooling', 'media'].includes(c.method)) ? 2 : 0;
}

type LawCourse = { id: string; mapping: Mapping; completedCredits: number; partialSchoolingCredits: number };
/** The same exclusive destination allocation feeds cards, requirements and ABC increments. */
export function allocateLawPartialCredits(courses: LawCourse[]): Map<string, number> {
  const required = courses.filter(c => c.mapping.department === '法律学科'
    && c.mapping.category === '専門教育' && c.mapping.requirementType === '選択必修'
    && c.mapping.curriculumCredits === 4 && c.completedCredits === 4);
  if (new Set(required.map(c => c.id)).size < 8) return new Map();
  return new Map(courses.filter(c => c.completedCredits === 0 && c.partialSchoolingCredits === 2)
    .map(c => [c.id, 2]));
}
