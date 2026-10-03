import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import type { CurriculumCourse, Offering, PlannerCatalog, PlannerItem } from './plannerCatalog';
import { exactImportedCurriculumId } from './officialCourseCredits';
import { isMediaSchooling } from './mediaSchooling';
import { repeatableRule } from './repeatableRules';
import { plannerItemCreditContribution } from './plannerItemCredits';
import { safeImportedStudyOffering } from './unifiedCourseView';

export type CourseCompletion = 'complete' | 'incomplete' | 'unknown' | 'repeatable';
export type CurriculumCourseAttempt = {
  item: PlannerItem;
  offering: Offering;
  earnedContribution: number;
  projectedContribution: number;
  /** True only when an earned attempt is already represented by an official aggregate. */
  officialEarnedPreferred: boolean;
  officialEarnedPreferenceReason: 'aggregate_source_link' | 'component_source_match' | null;
};
export type CurriculumCourseProgress = {
  curriculumCourseId: string;
  canonicalName: string;
  curriculumCredits: number | null;
  /** Uncapped known totals. Excess remains a candidate, never declared invalid. */
  earnedCredits: number;
  projectedCredits: number;
  remainingCredits: number | null;
  completion: CourseCompletion;
  projectedCompletion: CourseCompletion;
  earnedExcessCredits: number;
  projectedExcessCredits: number;
  repeatable: boolean;
  attempts: CurriculumCourseAttempt[];
  officialAchievements: ImportedCourseAchievement[];
  warnings: string[];
};
export type CurriculumProgressWarning = { offeringId: string | null; sourceCourseId: string | null; name: string; reason: string };
export type CurriculumProgressResult = { courses: CurriculumCourseProgress[]; unassigned: CurriculumProgressWarning[] };

export const COMPLETED_COURSE_ADVISORY = '科目構成単位を満たしています。原則として完成後の再履修はできませんが、科目・履修方法によって例外があります。';
export const MEDIA_REPEAT_ADVISORY = '大学への電話確認ではメディアの再履修は不可との案内。詳細は教務へ確認してください';

type ComponentEvidence = { kind: 'matching' | 'contradictory'; sourceCourseId: string };

/** A component match is provenance only. It never attributes the parent aggregate
 * to an Offering and therefore never supplies annual correspondence credits. */
function componentEvidenceForAttempt(
  item: PlannerItem,
  offering: Offering,
  studyRecords: ImportedStudyRecord[],
  officialById: Map<string, ImportedCourseAchievement>,
  offerings: Map<string, Offering>,
  catalog: PlannerCatalog,
): ComponentEvidence | null {
  // A stored aggregate link keeps its existing stronger semantics. Component
  // evidence only repairs legacy items that have no such attribution.
  if (item.importedSourceCourseId !== undefined) return null;
  for (const record of studyRecords) {
    if (!record.sourceCourseId) continue;
    const parent = officialById.get(record.sourceCourseId);
    if (!parent) continue;
    const componentOffering = safeImportedStudyOffering(record, offerings);
    if (componentOffering?.id !== item.offeringId) continue;
    const officialCourseId = exactImportedCurriculumId(parent, catalog);
    if (!officialCourseId) continue;
    return {
      kind: officialCourseId === offering.curriculumCourseId ? 'matching' : 'contradictory',
      sourceCourseId: parent.id,
    };
  }
  return null;
}

/** Rule names only classify repeatability after identity is established. They never group courses. */
function isRepeatableCourse(course: CurriculumCourse, catalog: PlannerCatalog, scopeId: string | null): boolean {
  const common = new Set(catalog.programs.filter(program => program.isCommon).map(program => program.scopeId));
  const scopes = new Set(scopeId ? [scopeId, ...common] : course.scopeIds);
  const matchesName = (name: string) => course.canonicalName === name
    || (name === '史学演習' && /^史学演習[1-4]$/.test(course.canonicalName))
    || (name === '歴史資料学' && course.canonicalName === '歴史資料学1〜6')
    || ['（', '(', '［'].some(bracket => course.canonicalName.startsWith(`${name}${bracket}`));
  if (catalog.requirements.some(rule => rule.status === 'structured' && scopes.has(rule.scopeId) && course.scopeIds.includes(rule.scopeId)
    && (rule.conditions?.max_enrollments ?? 0) > 1
    && [rule.target.course_name, ...(rule.target.course_names ?? [])].some(name => name !== undefined && matchesName(name)))) return true;
  return catalog.offerings.some(offering => offering.curriculumCourseId === course.id
    && catalog.programs.some(program => scopes.has(program.scopeId) && course.scopeIds.includes(program.scopeId) && program.department
      && repeatableRule(program.department, offering)));
}

export function deriveCurriculumCourseProgress(
  items: PlannerItem[],
  catalog: PlannerCatalog,
  rows: ImportedCourseAchievement[] = [],
  scopeId: string | null = null,
  studyRecords: ImportedStudyRecord[] = [],
): CurriculumProgressResult {
  const offerings = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const courses = new Map((catalog.curriculum?.courses ?? []).map(course => [course.id, course]));
  const officialById = new Map(rows.map(row => [row.id, row]));
  const officialSourceIds = new Set(officialById.keys());
  const assigned = new Map<string, { attempts: Array<{ item: PlannerItem; offering: Offering }>; official: ImportedCourseAchievement[] }>();
  const unassigned: CurriculumProgressWarning[] = [];
  const groupFor = (id: string) => {
    let group = assigned.get(id);
    if (!group) { group = { attempts: [], official: [] }; assigned.set(id, group); }
    return group;
  };
  for (const item of items) {
    const offering = offerings.get(item.offeringId);
    if (offering?.curriculumCourseId && courses.has(offering.curriculumCourseId)) groupFor(offering.curriculumCourseId).attempts.push({ item, offering });
    else unassigned.push({ offeringId: item.offeringId, sourceCourseId: null, name: offering?.name ?? item.offeringId, reason: '制度科目を一意に判定できません。履修計画には保持しています。' });
  }
  for (const row of rows) {
    const id = exactImportedCurriculumId(row, catalog);
    if (id && courses.has(id)) groupFor(id).official.push(row);
    else unassigned.push({ offeringId: null, sourceCourseId: row.id, name: row.rawName, reason: '成績表行の制度科目を一意に判定できません。公式情報は保持しています。' });
  }
  const result: CurriculumCourseProgress[] = [];
  for (const [id, group] of assigned) {
    const course = courses.get(id)!;
    const repeatable = isRepeatableCourse(course, catalog, scopeId);
    const warnings: string[] = [];
    let unknownEarned = group.official.some(row => row.earnedCreditsTotal === null);
    let unknownProjected = unknownEarned;
    const attempts = group.attempts.map(({ item, offering }): CurriculumCourseAttempt => {
      const aggregateSourceLink = item.status === 'earned'
        && officialSourceIds.has(item.importedSourceCourseId ?? '');
      const componentEvidence = item.status === 'earned'
        ? componentEvidenceForAttempt(item, offering, studyRecords, officialById, offerings, catalog)
        : null;
      const officialEarnedPreferenceReason = aggregateSourceLink
        ? 'aggregate_source_link' as const
        : componentEvidence?.kind === 'matching' ? 'component_source_match' as const : null;
      const officialEarnedPreferred = officialEarnedPreferenceReason !== null;
      if (aggregateSourceLink && !group.official.some(row => row.id === item.importedSourceCourseId)) {
        unknownEarned = true; unknownProjected = true;
        if (!warnings.includes('取込元の制度科目が未確定または異なるため、履修項目の単位を推測して加算していません。')) warnings.push('取込元の制度科目が未確定または異なるため、履修項目の単位を推測して加算していません。');
      }
      if (componentEvidence?.kind === 'contradictory') {
        const warning = '成績表の履修内訳と履修項目の制度科目が一致しないため、重複とは判定せず修得単位を別に表示しています。';
        if (!warnings.includes(warning)) warnings.push(warning);
      }
      const earned = item.status === 'earned' && !officialEarnedPreferred;
      const planned = ['planned', 'in_progress', 'waiting'].includes(item.status);
      // Only explicit learner metadata overrides an opening's credit information.
      // Neither grades, other attempts nor remaining Course credits infer a value.
      const credits = plannerItemCreditContribution(item, offering);
      if (earned && credits === null) unknownEarned = true;
      if ((earned || planned) && credits === null) unknownProjected = true;
      return { item, offering, officialEarnedPreferred, officialEarnedPreferenceReason, earnedContribution: earned ? credits ?? 0 : 0, projectedContribution: earned || planned ? credits ?? 0 : 0 };
    });
    const officialEarned = group.official.reduce((total, row) => total + (row.earnedCreditsTotal ?? 0), 0);
    const earnedCredits = officialEarned + attempts.reduce((total, attempt) => total + attempt.earnedContribution, 0);
    const projectedCredits = officialEarned + attempts.reduce((total, attempt) => total + attempt.projectedContribution, 0);
    const target = course.curriculumCredits;
    const completion = (credits: number, unknown: boolean): CourseCompletion => repeatable ? 'repeatable'
      : target === null || target <= 0 ? 'unknown' : credits >= target ? 'complete' : unknown ? 'unknown' : 'incomplete';
    const earnedCompletion = completion(earnedCredits, unknownEarned);
    if (unknownEarned || unknownProjected) warnings.push('修得単位または予定単位に不明な値があります。表示は確認できた単位のみです。');
    if (earnedCompletion === 'complete') warnings.push(COMPLETED_COURSE_ADVISORY);
    const excess = (credits: number) => repeatable || target === null ? 0 : Math.max(0, credits - target);
    if (excess(projectedCredits) > 0) warnings.push('科目構成単位を超える単位は超過候補です。卒業所要単位への算入可否は別途確認してください。');
    if (attempts.filter(attempt => isMediaSchooling(attempt.offering) && attempt.item.status !== 'dropped').length > 1) warnings.push(MEDIA_REPEAT_ADVISORY);
    if (attempts.some(attempt => attempt.officialEarnedPreferred)) warnings.push('修得単位は成績表の公式集計を優先し、取込元が一致する修得済み履修項目を重複加算していません。');
    if (group.official.length > 0 && attempts.some(attempt => attempt.item.status === 'earned' && !attempt.officialEarnedPreferred)) warnings.push('成績表とは別に修得済みとして記録された履修があります。卒業要件への正式反映には成績表の再取込を推奨します。');
    result.push({ curriculumCourseId: id, canonicalName: course.canonicalName, curriculumCredits: target,
      earnedCredits, projectedCredits, remainingCredits: target === null || unknownEarned ? null : Math.max(0, target - earnedCredits),
      completion: earnedCompletion, projectedCompletion: completion(projectedCredits, unknownProjected || unknownEarned),
      earnedExcessCredits: excess(earnedCredits), projectedExcessCredits: excess(projectedCredits), repeatable,
      attempts, officialAchievements: group.official, warnings });
  }
  return { courses: result.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName, 'ja') || a.curriculumCourseId.localeCompare(b.curriculumCourseId)), unassigned };
}

/** Advisory only: never filter or block another opening of the same Course. */
export function curriculumOfferingAdvisories(offering: Offering, progress: CurriculumProgressResult): string[] {
  const course = progress.courses.find(course => course.curriculumCourseId === offering.curriculumCourseId);
  if (!course) return [];
  const messages = course.completion === 'complete' ? [COMPLETED_COURSE_ADVISORY] : [];
  if (isMediaSchooling(offering) && course.attempts.some(attempt => attempt.offering.id !== offering.id && isMediaSchooling(attempt.offering) && attempt.item.status !== 'dropped')) messages.push(MEDIA_REPEAT_ADVISORY);
  return messages;
}
