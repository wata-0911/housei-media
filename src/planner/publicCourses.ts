import type { PublicCourse } from './plannerCatalog';

export const PUBLIC_COURSE_TITLE = '公開科目';

function normalize(text: string) {
  return text.normalize('NFKC').toLocaleLowerCase('ja');
}

/** A catalog-independent result that is deliberately available only through search. */
export function matchesPublicCourseSearch(query: string) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every(term => normalize(PUBLIC_COURSE_TITLE).includes(term));
}

export function createPublicCourse(id: string): PublicCourse {
  return { id, title: PUBLIC_COURSE_TITLE, status: 'planned', plannedYear: 2026, plannedTerm: null, credits: 2 };
}

export function normalizePublicCourseTitle(title: string) {
  return title.trim();
}

export function isValidPublicCourseTitle(title: string) {
  return title.length > 0 && title.length <= 200;
}
