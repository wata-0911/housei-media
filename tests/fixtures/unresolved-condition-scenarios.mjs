import { catalog } from '../../src/planner/catalog.ts';
import { initialState } from '../../src/planner/storage.ts';
import { officialRecognitionPrefill } from '../../src/planner/graduationProfile.ts';
import { calculateGraduationProgress } from '../../src/planner/graduationProgress.ts';

export const plannerItem = (offering, status = 'earned') => ({ offeringId: offering.id, status, plannedYear: 2026, plannedTerm: null, studyYear: null, earnedOrder: null });
export function officialRow(course, amount = 4) {
  return { id: `audit-${course.id}`, fingerprint: `audit-${course.id}`, source: 'hosei_import', rawName: course.canonicalName, categoryRaw: null,
    capturedAt: '2026-10-09T00:00:00Z', earnedCreditsTotal: amount, schoolingCreditsTotal: 0, compositionCredits: course.curriculumCredits,
    recognizedExemption: null, additionalEnrollment: null, academicYear: 2026, yearSource: 'source',
    curriculumCourseId: course.id, curriculumMatch: 'exact_unique', candidateCurriculumCourseIds: [course.id], offeringMatch: 'unmatched',
    courseId: null, selectedOfferingId: null, selectionSource: 'none', match: 'unmatched', candidateOfferingIds: [] };
}
export function scenarios() {
  return catalog.programs.filter(p => !p.isCommon).flatMap(program => {
    const scopeId = program.scopeId;
    const base = { catalog, scopeId, program, items: [], rows: [], records: [], selection: 'not_selected',
      profile: { ...initialState().graduationProfile, admissionYear: 2026, admissionType: 'first_year' } };
    const offering = catalog.offerings.find(o => o.resolutionStatus === 'matched' && o.credits > 0 && o.mappingIds.some(id => catalog.mappings.some(m => m.mappingId === id && m.scopeId === scopeId && m.category === '専門教育')));
    const unresolved = catalog.offerings.find(o => o.resolutionStatus === 'manual_review');
    const course = catalog.curriculum.courses.find(c => c.curriculumCredits === 4 && c.mappingIds.some(id => catalog.mappings.some(m => m.mappingId === id && m.scopeId === scopeId)));
    const unknownRow = { ...officialRow(course), curriculumCourseId: null, curriculumMatch: 'ambiguous', candidateOfferingIds: [offering.id] };
    return [
      ['A', { profile: initialState().graduationProfile, selection: 'undecided' }],
      ['B', {}], ['C', { items: [plannerItem(offering)] }],
      ['D', { profile: { ...base.profile, admissionType: 'transfer_second_year' } }],
      ['E', { profile: { ...base.profile, admissionType: 'transfer_second_year', recognizedCredits: { ...officialRecognitionPrefill('transfer_second_year'), schoolingEquivalentCredits: 7, foreignLanguage: { mode: 'none', credits: null, language: 'unknown', schoolingEquivalentCredits: null }, physicalEducation: { mode: 'none', credits: null } } } }],
      ['F', { profile: { ...base.profile, admissionType: 'bachelor_admission', recognizedCredits: officialRecognitionPrefill('bachelor_admission') } }],
      ['G', { profile: { ...base.profile, curriculumApplicability: 'legacy_or_transition' } }],
      ['H', { rows: [unknownRow] }], ['I-unmatched', { items: [plannerItem(unresolved)] }],
      ['I-credits', { catalog: { ...catalog, offerings: catalog.offerings.map(o => o.id === offering.id ? { ...o, credits: null } : o) }, items: [plannerItem(offering)] }],
      ['J-selected', { selection: 'selected' }], ['J-not-selected', {}], ['J-undecided', { selection: 'undecided' }],
      ['curriculum-unknown', { profile: { ...base.profile, curriculumApplicability: 'unknown' } }],
      ['open-university', { profile: { ...base.profile, recognizedCredits: { ...base.profile.recognizedCredits, openUniversityCredits: 6 } } }],
      ['in-progress', { items: [plannerItem(offering, 'in_progress')] }], ['planned', { items: [plannerItem(offering, 'planned')] }],
      ...[0, null, 4].map(amount => [`official-${amount}`, { rows: [officialRow(course, amount)] }]),
      ['official-schooling-unknown', { rows: [{ ...officialRow(course), schoolingCreditsTotal: null }] }],
    ].map(([name, patch]) => ({ ...base, ...patch, name: `${program.displayName}/${name}` }));
  });
}
export function calculateScenario(s) {
  return calculateGraduationProgress(s.items, s.catalog, s.scopeId, [], s.selection, s.records, s.rows, s.profile);
}
