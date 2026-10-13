import { catalog } from '../../src/planner/catalog.ts';
import { initialState } from '../../src/planner/storage.ts';
import { plannerItemFromCourseSearch } from '../../src/planner/plannerItemState.ts';
import { deriveCurriculumCourseProgress } from '../../src/planner/curriculumCourseProgress.ts';
import { calculateGraduationProgress } from '../../src/planner/graduationProgress.ts';
export const course = catalog.curriculum.courses.find(c => c.canonicalName === '書道実技');
export const corr = catalog.offerings.find(o => o.curriculumCourseId === course.id && o.method === 'correspondence');
export const schools = catalog.offerings.filter(o => o.curriculumCourseId === course.id && o.method === 'schooling' && o.credits === 1);
export const programs = catalog.programs.filter(p => course.scopeIds.includes(p.scopeId));
export const item = (o, status = 'earned') => ({ ...plannerItemFromCourseSearch(o.id), status });
export const profile = { ...initialState().graduationProfile, curriculumApplicability: 'current_2026', admissionType: 'first_year', admissionYear: 2026, currentStudyYear: 3 };
export const batch = status => ({ [corr.id]: { offeringId: corr.id, requiredReports: null, reports: [], examGrade: null, calligraphyBatchStatus: status } });
export function result(items, saved = {}, rows = [], scope = programs[0].scopeId, overrides = {}) {
  const p = { ...profile, ...overrides };
  const progress = deriveCurriculumCourseProgress(items, catalog, rows, scope, [], saved, p).courses[0];
  const graduation = calculateGraduationProgress(items, catalog, scope, [], 'not_selected', [], rows, p, null, saved);
  return { progress, graduation, credits: graduation.cards.find(c => c.requirementId === 'professional-elective').earned };
}
export const official = (patch = {}) => ({
  id: 'official-calligraphy', fingerprint: 'calligraphy-source', source: 'hosei_import', rawName: '書道実技', categoryRaw: null,
  capturedAt: '2026-10-13T00:00:00Z', earnedCreditsTotal: 2, schoolingCreditsTotal: 1, compositionCredits: 2,
  recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source',
  curriculumCourseId: course.id, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [course.id],
  offeringMatch: 'unmatched', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched', candidateOfferingIds: [], ...patch,
});
