import type { GraduationProfile } from './plannerCatalog';

export const initialGraduationProfile = (): GraduationProfile => ({
  admissionYear: null,
  admissionType: 'unknown',
  recognizedCredits: emptyRecognizedCredits(),
  curriculumApplicability: 'unknown',
});

export const emptyRecognizedCredits = () => ({
  totalCredits: null, schoolingEquivalentCredits: null,
  general: { humanities: { mode: 'unknown' as const, credits: null }, social: { mode: 'unknown' as const, credits: null }, natural: { mode: 'unknown' as const, credits: null } },
  foreignLanguage: { mode: 'unknown' as const, credits: null, language: 'unknown' as const, schoolingEquivalentCredits: null },
  physicalEducation: { mode: 'unknown' as const, credits: null }, professionalCourses: [],
});

/** Explicit helper only: callers must still save the returned profile. */
export function officialRecognitionPrefill(route: GraduationProfile['admissionType']) {
  const base = emptyRecognizedCredits();
  if (route === 'transfer_second_year') return { ...base, general: { humanities: { mode: 'recognized' as const, credits: 8 }, social: { mode: 'recognized' as const, credits: 8 }, natural: { mode: 'recognized' as const, credits: 8 } }, schoolingEquivalentCredits: 7 };
  if (route === 'transfer_third_year') return { ...base, general: { humanities: { mode: 'recognized' as const, credits: 12 }, social: { mode: 'recognized' as const, credits: 12 }, natural: { mode: 'recognized' as const, credits: 12 } }, schoolingEquivalentCredits: 15 };
  if (route === 'bachelor_admission') return { ...base, general: { humanities: { mode: 'exempt' as const, credits: null }, social: { mode: 'exempt' as const, credits: null }, natural: { mode: 'exempt' as const, credits: null } }, foreignLanguage: { ...base.foreignLanguage, mode: 'exempt' as const }, physicalEducation: { mode: 'exempt' as const, credits: null }, schoolingEquivalentCredits: 15 };
  return base;
}

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
  if (['transfer_second_year', 'transfer_third_year', 'other_transfer', 'hosei_internal_transfer'].includes(profile.admissionType) && profile.recognizedCredits.totalCredits === null && profile.recognizedCredits.professionalCourses.length === 0) missing.push('recognized_credits');
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
  const fields = Object.values(profile.recognizedCredits.general);
  const modes = [profile.recognizedCredits.foreignLanguage, profile.recognizedCredits.physicalEducation, ...fields];
  if (modes.some(row => row.mode === 'exempt' && row.credits !== null)) return '免除と認定単位は同時に指定できません。免除は修得単位ではありません。';
  if (fields.some(row => row.credits !== null && (row.credits < 0 || row.credits > 36))
    || (profile.recognizedCredits.foreignLanguage.credits !== null && (profile.recognizedCredits.foreignLanguage.credits < 0 || profile.recognizedCredits.foreignLanguage.credits > 4))
    || (profile.recognizedCredits.physicalEducation.credits !== null && (profile.recognizedCredits.physicalEducation.credits < 0 || profile.recognizedCredits.physicalEducation.credits > 2))) return '区分別の認定単位が公式上限を超えています。';
  const detailed = fields.reduce((sum, row) => sum + (row.mode === 'recognized' ? row.credits ?? 0 : 0), 0) + (profile.recognizedCredits.foreignLanguage.mode === 'recognized' ? profile.recognizedCredits.foreignLanguage.credits ?? 0 : 0) + (profile.recognizedCredits.physicalEducation.mode === 'recognized' ? profile.recognizedCredits.physicalEducation.credits ?? 0 : 0) + profile.recognizedCredits.professionalCourses.reduce((sum, row) => sum + row.credits, 0);
  if (totalCredits !== null && detailed > totalCredits) return '内訳の認定単位が公式認定単位合計を超えています。';
  const cap = profile.admissionType === 'transfer_second_year' ? 7 : profile.admissionType === 'transfer_third_year' || profile.admissionType === 'bachelor_admission' ? 15 : null;
  if (cap !== null && schoolingEquivalentCredits !== null && schoolingEquivalentCredits > cap) return `この入学区分のスクーリング認定は${cap}単位以下です。個別認定の場合は「その他・個別」を選択してください。`;
  const identities = profile.recognizedCredits.professionalCourses.map(row => row.courseId ?? row.offeringId).filter((id): id is string => id !== null);
  if (new Set(identities).size !== identities.length) return '同じ専門認定科目を重複して登録できません。';
  return null;
}

export function isValidGraduationProfile(profile: GraduationProfile): boolean {
  return graduationProfileValidationError(profile) === null;
}
