import { catalog } from '../../src/planner/catalog.ts';
import { plannerItemFromCourseSearch } from '../../src/planner/plannerItemState.ts';
import { initialState } from '../../src/planner/storage.ts';
export const economics = catalog.curriculum.courses.find(course => course.canonicalName === '経済学');
export const correspondence = catalog.offerings.find(o => o.curriculumCourseId === economics.id && o.method === 'correspondence');
export const winter = catalog.offerings.find(o => o.curriculumCourseId === economics.id && o.method === 'schooling' && o.name.includes('冬期'));
export const item = (offering, status = 'planned', patch = {}) => ({ ...plannerItemFromCourseSearch(offering.id), status, ...patch });
export const official = (patch = {}) => ({
  id: 'official-economics', fingerprint: 'source-row', source: 'hosei_import', rawName: '経済学', categoryRaw: '社会',
  capturedAt: '2026-10-02T00:00:00Z', earnedCreditsTotal: 4, schoolingCreditsTotal: 2, compositionCredits: 4,
  recognizedExemption: null, additionalEnrollment: null, academicYear: 2025, yearSource: 'source',
  curriculumCourseId: economics.id, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [economics.id],
  offeringMatch: 'unmatched', courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched',
  candidateOfferingIds: [], ...patch,
});
export const detail = (patch = {}) => ({
  id: 'winter-detail', fingerprint: 'component', source: 'hosei_import', sourceCourseId: 'official-economics',
  rawName: '経済学', offeringId: null, match: 'unmatched', method: 'schooling', academicYear: 2025,
  yearSource: 'source', rawYear: '25', term: '冬期', rawTerm: '冬期', date: '2026-02-01', credits: 2, grade: 'A', ...patch,
});
export const communicationDetail = () => detail({ id: 'communication-detail', method: 'communication', rawTerm: null, term: null, examGrade: 'S', grade: 'S', reports: [{ raw: '○25/06/01', status: 'passed', date: '2025-06-01' }] });
export const state = (patch = {}) => ({ ...initialState(), ...patch });
