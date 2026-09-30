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
  return parsed !== null && Number.isInteger(parsed) && parsed >= 1000 && parsed <= 9999 ? parsed : null;
}

/** Returns a user-facing reason when profile values cannot safely be persisted together. */
export function graduationProfileValidationError(profile: GraduationProfile): string | null {
  if (profile.admissionYear !== null
    && (!Number.isInteger(profile.admissionYear) || profile.admissionYear < 1000 || profile.admissionYear > 9999)) {
    return '入学年度は4桁の西暦（1000〜9999）で入力してください。';
  }

  const { totalCredits, schoolingEquivalentCredits } = profile.recognizedCredits;
  if ((totalCredits !== null && (!Number.isFinite(totalCredits) || totalCredits < 0))
    || (schoolingEquivalentCredits !== null && (!Number.isFinite(schoolingEquivalentCredits) || schoolingEquivalentCredits < 0))) {
    return '認定単位は0以上の数値で入力してください。';
  }
  if (schoolingEquivalentCredits !== null && totalCredits === null) {
    return 'スクーリング相当の認定単位を入力するには、認定単位の合計も入力してください。';
  }
  if (totalCredits !== null && schoolingEquivalentCredits !== null && schoolingEquivalentCredits > totalCredits) {
    return 'スクーリング相当の認定単位は、認定単位の合計以下にしてください。';
  }
  return null;
}

export function isValidGraduationProfile(profile: GraduationProfile): boolean {
  return graduationProfileValidationError(profile) === null;
}
