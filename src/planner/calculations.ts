import type { Offering, PlannerItem, PublicCourse } from './plannerCatalog';
import { plannerItemCreditContribution } from './plannerItemCredits';

export function summarizeCredits(items: PlannerItem[], offerings: Map<string, Offering>, publicCourses: PublicCourse[] = []) {
  const summary = { earned: 0, in_progress: 0, planned: 0, unknownCreditItems: 0 };
  for (const item of items) {
    const offering = offerings.get(item.offeringId);
    if (!offering) throw new Error(`Unknown offering: ${item.offeringId}`);
    const credits = plannerItemCreditContribution(item, offering);
    if (credits === null) summary.unknownCreditItems += 1;
    else if (item.status === 'earned' || item.status === 'in_progress' || item.status === 'planned') {
      summary[item.status] += credits;
    }
  }
  for (const course of publicCourses) {
    if (course.status === 'earned' || course.status === 'in_progress' || course.status === 'planned') summary[course.status] += 2;
  }
  return summary;
}

export function searchOfferings(offerings: Offering[], query: string) {
  const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ja');
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return offerings.filter(o => {
    const text = normalize([o.name, o.subjectCode, o.classCode, o.deliveryCategory, o.period].filter(Boolean).join(' '));
    return terms.every(term => text.includes(term));
  });
}
