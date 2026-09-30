/** Official references shown alongside partial graduation-progress cards. */
export type GraduationSourceRef = { title: string; year?: number; page?: string | null; url?: string | null };
export type CoverageStatus = 'supported' | 'partial' | 'unknown';
export type UnknownReasonCategory = 'rule_unimplemented' | 'personal_information' | 'course_matching' | 'completion_order' | 'procedure' | 'curriculum_applicability';

export const UNKNOWN_REASON_CATEGORY_LABEL: Record<UnknownReasonCategory, string> = {
  rule_unimplemented: 'ルール未対応', personal_information: '本人情報不足', course_matching: '科目照合不確定',
  completion_order: '履修順・選択未入力', procedure: '手続要件のため自動判定対象外', curriculum_applicability: '旧課程・個別適用条件',
};

const curriculum = (page: number): GraduationSourceRef => ({ title: '2026年度 学習のしおり（教育課程表）', year: 2026, page: `p.${page}` });
const requirements: GraduationSourceRef = { title: '卒業に必要な要件', url: 'https://www.tsukyo.hosei.ac.jp/system/requirements/' };
const thesis: GraduationSourceRef = { title: '卒業論文について', url: 'https://www.tsukyo.hosei.ac.jp/system/graduation-thesis/' };

/** Calculation code refers to stable ids; official-source text lives only here. */
export const GRADUATION_CARD_SOURCES: Record<string, GraduationSourceRef[]> = {
  'group-general': [curriculum(46)], 'group-foreign': [curriculum(46)], 'group-physical': [curriculum(46)],
  'history-seminar-required-elective': [curriculum(53)], 'history-seminar-elective': [curriculum(53)],
  'professional-history-required': [curriculum(53)], 'professional-history-schooling-required-elective': [curriculum(53)], 'professional-history-elective': [curriculum(53)],
  'professional-geography-required': [curriculum(55)], 'professional-geography-schooling-required': [curriculum(55)], 'professional-geography-required-elective': [curriculum(55)], 'professional-geography-elective': [curriculum(55)],
  'professional-law-required-elective': [curriculum(47)], 'professional-law-elective': [curriculum(47)], 'professional-law-total': [curriculum(47)], 'professional-law-schooling': [curriculum(47)],
  'professional-economics-required-elective': [curriculum(57)], 'professional-economics-elective': [curriculum(57)],
  'professional-commerce-required-elective': [curriculum(59)], 'professional-commerce-elective': [curriculum(59)],
  'professional-required': [curriculum(48)], 'professional-schooling-required': [curriculum(48)], 'professional-required-elective': [curriculum(48)], 'professional-elective': [curriculum(48)],
  'public-course': [requirements], thesis: [thesis, requirements],
};

export function sourcesForGraduationCard(requirementId: string, sourcePage?: number | null, label?: string): GraduationSourceRef[] {
  if (GRADUATION_CARD_SOURCES[requirementId]) return GRADUATION_CARD_SOURCES[requirementId];
  if (requirementId.startsWith('public-course-')) return GRADUATION_CARD_SOURCES['public-course'];
  if (requirementId.includes('thesis') || requirementId.includes('卒業論文') || label?.includes('卒業論文')) return GRADUATION_CARD_SOURCES.thesis;
  return sourcePage === null || sourcePage === undefined ? [requirements] : [curriculum(sourcePage)];
}

export function classifyUnknownReason(reason: string | null): UnknownReasonCategory | null {
  if (!reason) return null;
  if (/卒論有無|入学年度|編入|認定単位/.test(reason)) return 'personal_information';
  if (/修得順|順に記録|選択.*未定/.test(reason)) return 'completion_order';
  if (/指導|提出|期限|手続|受講可否/.test(reason)) return 'procedure';
  if (/旧課程|2013年度以前|個別適用|適用課程/.test(reason)) return 'curriculum_applicability';
  if (/対応関係|mapping|対象科目|対象集合|単位数不明|構成単位|区分が複数/.test(reason)) return 'course_matching';
  return 'rule_unimplemented';
}

export function coverageForCard(status: 'satisfied' | 'unsatisfied' | 'unknown', requirementId: string, ruleType: string): CoverageStatus {
  if (status === 'unknown') return 'unknown';
  if (ruleType === 'professional_group' || requirementId.startsWith('history-seminar-')) return 'partial';
  return 'supported';
}
