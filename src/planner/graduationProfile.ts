import type { GraduationProfile } from './plannerCatalog';

export const initialGraduationProfile = (): GraduationProfile => ({
  admissionYear: null,
  admissionType: 'unknown',
  recognizedCredits: { totalCredits: null, schoolingEquivalentCredits: null },
  curriculumApplicability: 'unknown',
});

export type GraduationProfilePrerequisite = 'admission_year' | 'admission_type' | 'recognized_credits' | 'curriculum_applicability';

export const GRADUATION_PROFILE_PREREQUISITE_LABEL: Record<GraduationProfilePrerequisite, string> = {
  admission_year: '入学年度',
  admission_type: '入学区分',
  recognized_credits: '認定単位',
  curriculum_applicability: '適用課程',
};

/** Missing information is deliberately reported instead of being guessed from the current year. */
export function missingGraduationProfilePrerequisites(profile: GraduationProfile): GraduationProfilePrerequisite[] {
  const missing: GraduationProfilePrerequisite[] = [];
  if (profile.admissionYear === null) missing.push('admission_year');
  if (profile.admissionType === 'unknown') missing.push('admission_type');
  if (profile.curriculumApplicability === 'unknown') missing.push('curriculum_applicability');
  if (profile.admissionType === 'transfer' && profile.recognizedCredits.totalCredits === null) missing.push('recognized_credits');
  return missing;
}

/** Empty, non-finite, and negative values never enter persisted planner state; zero is valid. */
export function normalizeNonnegativeNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeAdmissionYear(value: string): number | null {
  const parsed = normalizeNonnegativeNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}
