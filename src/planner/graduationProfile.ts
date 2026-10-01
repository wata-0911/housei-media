import type { GraduationProfile } from './plannerCatalog';

/** 2026 requirements: the largest current degree total is law without thesis (128). */
export const MAX_RECOGNIZED_CREDITS_2026 = 128;
export const MAX_GENERAL_RECOGNIZED_CREDITS_2026 = 36;
export const MAX_SCHOOLING_RECOGNITION_2026 = 30;

export function schoolingRecognitionCap(profile: Pick<GraduationProfile, 'admissionType'>): number {
  if (profile.admissionType === 'transfer_second_year') return 7;
  if (profile.admissionType === 'transfer_third_year' || profile.admissionType === 'bachelor_admission') return 15;
  return MAX_SCHOOLING_RECOGNITION_2026;
}

export const initialGraduationProfile = (): GraduationProfile => ({
  admissionYear: null,
  currentStudyYear: null,
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
  // The transfer route establishes the general-education recognition, but the
  // official material distinguishes a fixed schooling recognition from a cap
  // based on the prior school.  The route alone cannot select between them.
  if (route === 'transfer_second_year') return { ...base, general: { humanities: { mode: 'recognized' as const, credits: 8 }, social: { mode: 'recognized' as const, credits: 8 }, natural: { mode: 'recognized' as const, credits: 8 } } };
  if (route === 'transfer_third_year') return { ...base, general: { humanities: { mode: 'recognized' as const, credits: 12 }, social: { mode: 'recognized' as const, credits: 12 }, natural: { mode: 'recognized' as const, credits: 12 } } };
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
  if (['transfer_second_year', 'transfer_third_year', 'other_transfer', 'hosei_internal_transfer'].includes(profile.admissionType) && !hasCreditBearingRecognition(profile.recognizedCredits)) missing.push('recognized_credits');
  return missing;
}

/** Exemptions are deliberately not credit-bearing.  This is also used for the
 * route prefill: a confirmed category breakdown is sufficient even when the
 * old aggregate total was never supplied. */
export function recognizedCreditBreakdownTotal(credits: GraduationProfile['recognizedCredits']): number {
  // Calculation also accepts old in-memory callers; persisted v19 records are
  // validated with all fields present.
  const legacy = credits as Partial<GraduationProfile['recognizedCredits']>;
  const general = Object.values(legacy.general ?? {}).reduce((sum, row) => sum + (row.mode === 'recognized' ? row.credits ?? 0 : 0), 0);
  const foreign = legacy.foreignLanguage?.mode === 'recognized' ? legacy.foreignLanguage.credits ?? 0 : 0;
  const physical = legacy.physicalEducation?.mode === 'recognized' ? legacy.physicalEducation.credits ?? 0 : 0;
  return general + foreign + physical + (legacy.professionalCourses ?? []).reduce((sum, row) => sum + row.credits, 0);
}

export function hasCreditBearingRecognition(credits: GraduationProfile['recognizedCredits']): boolean {
  return credits.totalCredits !== null || recognizedCreditBreakdownTotal(credits) > 0 || credits.schoolingEquivalentCredits !== null;
}

/** The legacy aggregate is not another bucket.  Only its excess is an
 * unallocated, overall-reference-only credit. */
export function unallocatedRecognizedCredits(credits: GraduationProfile['recognizedCredits']): number | null {
  if (credits.totalCredits === null) return null;
  return credits.totalCredits - recognizedCreditBreakdownTotal(credits);
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
  if (!profile.recognizedCredits?.general || !profile.recognizedCredits.foreignLanguage || !profile.recognizedCredits.physicalEducation || !Array.isArray(profile.recognizedCredits.professionalCourses)) return '認定単位の入力を確認してください。';
  if (profile.admissionYear !== null
    && (!Number.isInteger(profile.admissionYear) || profile.admissionYear < 1000 || profile.admissionYear > 9999)) {
    return '入学年度は4桁の西暦（1000〜9999）で入力してください。';
  }

  const { totalCredits, schoolingEquivalentCredits } = profile.recognizedCredits;
  if ((totalCredits !== null && (!Number.isFinite(totalCredits) || totalCredits < 0 || totalCredits > MAX_RECOGNIZED_CREDITS_2026))
    || (schoolingEquivalentCredits !== null && (!Number.isFinite(schoolingEquivalentCredits) || schoolingEquivalentCredits < 0 || schoolingEquivalentCredits > schoolingRecognitionCap(profile)))) {
    return '認定単位は0以上の数値で入力してください。';
  }
  if (totalCredits !== null && schoolingEquivalentCredits !== null && schoolingEquivalentCredits > totalCredits) {
    return 'スクーリング相当の認定単位は、認定単位の合計以下にしてください。';
  }
  const fields = Object.values(profile.recognizedCredits.general);
  const modes = [profile.recognizedCredits.foreignLanguage, profile.recognizedCredits.physicalEducation, ...fields];
  if (modes.some(row => row.mode === 'exempt' && row.credits !== null)) return '免除と認定単位は同時に指定できません。免除は修得単位ではありません。';
  const outside = (value: number | null, cap: number) => value !== null && (!Number.isFinite(value) || value < 0 || value > cap);
  if (fields.some(row => outside(row.credits, MAX_GENERAL_RECOGNIZED_CREDITS_2026))
    || outside(profile.recognizedCredits.foreignLanguage.credits, 4)
    || outside(profile.recognizedCredits.physicalEducation.credits, 2)
    || profile.recognizedCredits.professionalCourses.some(row => !Number.isFinite(row.credits) || row.credits < 0 || row.credits > MAX_RECOGNIZED_CREDITS_2026)) return '区分別の認定単位が公式上限を超えています。';
  const foreign = profile.recognizedCredits.foreignLanguage;
  if (foreign.mode !== 'recognized' && (foreign.language !== 'unknown' || foreign.schoolingEquivalentCredits !== null)) return '外国語が認定以外の場合、言語とスクーリング相当は指定できません。';
  if (foreign.schoolingEquivalentCredits !== null
    && (!Number.isFinite(foreign.schoolingEquivalentCredits) || foreign.schoolingEquivalentCredits < 0
      || foreign.schoolingEquivalentCredits > 2
      || foreign.credits === null || foreign.schoolingEquivalentCredits > foreign.credits)) {
    return '外国語のスクーリング相当は、認定単位以下かつ2単位以下で入力してください。';
  }
  const detailed = recognizedCreditBreakdownTotal(profile.recognizedCredits);
  if (detailed > MAX_RECOGNIZED_CREDITS_2026) return '内訳の認定単位が2026年度の卒業所要単位上限を超えています。';
  const generalRecognized = fields.reduce((sum, row) => sum + (row.mode === 'recognized' ? row.credits ?? 0 : 0), 0);
  if (generalRecognized > MAX_GENERAL_RECOGNIZED_CREDITS_2026) return '一般教育の認定単位は合計36単位以下で入力してください。';
  if (totalCredits !== null && detailed > totalCredits) return '内訳の認定単位が公式認定単位合計を超えています。';
  const cap = schoolingRecognitionCap(profile);
  if (schoolingEquivalentCredits !== null && schoolingEquivalentCredits > cap) return `この入学区分のスクーリング認定は${cap}単位以下です。個別認定の場合は「その他・個別」を選択してください。`;
  const identities = profile.recognizedCredits.professionalCourses.map(row => row.courseId ? `course:${row.courseId}` : row.offeringId ? `offering:${row.offeringId}` : null).filter((id): id is string => id !== null);
  if (new Set(identities).size !== identities.length) return '同じ専門認定科目を重複して登録できません。';
  return null;
}

export function isValidGraduationProfile(profile: GraduationProfile): boolean {
  return graduationProfileValidationError(profile) === null;
}
