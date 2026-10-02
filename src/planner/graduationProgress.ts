import type {
  Mapping,
  Offering,
  PlannerCatalog,
  PlannerItem,
  PublicCourse,
  Requirement,
  StructuredRequirement,
  ThesisSelection,
  ThesisProgress,
  GraduationProfile,
} from './plannerCatalog';
import { graduationProfileValidationError, hasCreditBearingRecognition, recognizedCreditBreakdownTotal, unallocatedRecognizedCredits } from './graduationProfile';
import { createMappingResolver, requirementsForScope } from './plannerHelpers';
import { HISTORY_SCOPE_ID, historySeminarField, isHistoricalSources, isHistorySeminar, validHistorySeminarOrders } from './historySeminar';
import { repeatableRule } from './repeatableRules';
import { allocateGeographyTransfers, geographyTransferKind, type GeographyTransferKind } from './geographyTransferRules';
import { evaluatePublicCourseLimit, publicCourseLimitFor, type PublicCourseProgress } from './publicCourseRules';
import { thesisPolicyForScope } from './thesisSelection';
import { classifyUnknownReason, coverageForCard, LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026, sourcesForGraduationCard, thesisCreditsForDepartment, type CoverageStatus, type GraduationSourceRef, type UnknownReasonCategory } from './graduationSources';
import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import { deriveImportedAchievements, type ImportedAchievementWarning } from './importedAchievementCalculations';

export type ProgressStatus = 'satisfied' | 'unsatisfied' | 'unknown';

export type RequirementProgress = {
  requirementId: string;
  label: string;
  ruleType: string;
  status: ProgressStatus;
  earned: number | null;
  inProgress: number | null;
  planned: number | null;
  target: number | null;
  unit: 'credits' | 'courses' | null;
  reason: string | null;
  coverageStatus?: CoverageStatus;
  unknownReasonCategory?: UnknownReasonCategory | null;
  sourceRefs?: GraduationSourceRef[];
};

export type GraduationProgress = {
  graduationCheckComplete: false;
  requirements: RequirementProgress[];
  cards: ProgressCard[];
  evaluableCount: number;
  unknownCount: number;
  /** One summary row per reason keeps procedure/mapping warnings from becoming a wall of cards. */
  unknownReasons: Array<{ reason: string; count: number; labels: string[] }>;
  coverageSummary: Record<CoverageStatus, number>;
  importedWarnings: ImportedAchievementWarning[];
  importedContributionCount: number;
  referenceProgress: ReferenceProgress[];
  /** Present only for the History program, for internal diagnostic use. */
  historySchoolingDiagnostic: HistorySchoolingDiagnostic | null;
};

export type HistorySchoolingDiagnostic = {
  orderedSeminarOrders: number[];
  overviewDetections: Array<{ family: string | null; offeringId: string; status: PlannerItem['status']; method: Offering['method']; credits: number | null; schooling: boolean; mappingIds: string[] }>;
  overviewSchoolingCompletions: number;
  hasAllFiveSchoolingRequiredCourses: boolean;
};

/** A deliberately non-final, source-backed total. It never asserts graduation eligibility. */
export type ReferenceProgress = {
  id: 'overall-reference-progress' | 'schooling-reference-progress';
  label: string;
  earned: number | null;
  target: number | null;
  recognizedCredits: number | null;
  /** Exemptions are requirement relief, never completed credits. */
  exemptionCredits?: number | null;
  status: 'partial' | 'unknown';
  reason: string | null;
  coverageStatus: CoverageStatus;
  unknownReasonCategory: UnknownReasonCategory | null;
  sourceRefs: GraduationSourceRef[];
};

export type ProgressCard = RequirementProgress & {
  /** Internal uncapped value used when a cross-card rule needs the actual allocation. */
  normalEarned?: number;
  details?: Array<{ label: string; earned: number | null; inProgress: number; planned: number; target: number; schooling?: number; unit?: 'credits' | 'courses'; reason?: string | null }>;
  partialCourses?: Array<{ mappingId: string; label: string; earned: number; target: number }>;
  note?: string;
  repeatableCourses?: Array<{ label: string; earned: number; counted: number; limit: number; courses: number; limitCourses: number }>;
  publicCourse?: { earnedCourses: number; countedCourses: number; earnedCredits: number; countedCredits: number; excludedCredits: number; limitCourses: number; limitCredits: number };
};

function withCoverage<T extends RequirementProgress>(row: T, sourcePage?: number | null): T {
  return { ...row, coverageStatus: coverageForCard(row.status, row.requirementId, row.ruleType),
    unknownReasonCategory: row.status === 'unknown' ? (row.ruleType === 'unsupported' ? 'rule_unimplemented' : classifyUnknownReason(row.reason)) : null,
    sourceRefs: sourcesForGraduationCard(row.requirementId, sourcePage, row.label) };
}

const GROUP_RULES = new Set([
  'common_general_exact_credits', 'common_general_max_credits',
  'common_general_humanities_min_credits', 'common_general_social_min_credits', 'common_general_natural_min_credits',
  'common_physical_exact_credits', 'common_physical_max_credits', 'common_physical_choose_one',
  'common_foreign_choose_one', 'common_foreign_exact_credits', 'common_foreign_min_schooling_credits', 'common_foreign_max_credits',
]);

// These source rules remain in the catalog, but are not independent learner
// checks. The common total is already exactly covered by the three grouped
// cards (general 36, foreign 4, physical 2). Open University recognition is
// explicitly entered and capped at ten credits in the general-education
// overlay, so its catalog row must not create a duplicate learner warning.
const REFERENCE_ONLY_REQUIREMENT_RULES = new Set([
  'common_total_min_credits',
  'common_open_university_max_credits',
]);

const CONDITION_ALLOWLIST: Partial<Record<StructuredRequirement['ruleType'], string[][]>> = {
  // Every condition listed here has a corresponding calculation below.  This
  // is deliberately not a list of conditions that are merely harmless to
  // ignore: an unimplemented condition must keep its requirement unknown.
  min_credits: [[], ['full_course_credits_required'], ['min_courses'], ['full_course_credits_required', 'min_courses']],
  max_credits: [[], ['max_enrollments'], ['aggregate', 'max_enrollments']],
  exact_credits: [[]],
  min_courses: [[]],
  min_schooling_credits: [[], ['min_courses']],
  required_course: [[], ['full_course_credits_required']],
  choose_one: [['choose_count', 'options']],
};

const TARGET_KEYS = new Set(['course_name', 'course_names', 'curriculum_category', 'curriculum_field', 'requirement_type']);

function unknown(requirement: Requirement, reason: string): RequirementProgress {
  return {
    requirementId: requirement.id,
    label: requirement.status === 'unsupported' ? requirement.scopeLabel : requirementLabel(requirement),
    ruleType: requirement.status === 'unsupported' ? 'unsupported' : requirement.ruleType,
    status: 'unknown', earned: null, inProgress: null, planned: null,
    target: requirement.value, unit: requirement.status === 'structured' ? unitFor(requirement) : null, reason,
  };
}

function conditionIsSafe(requirement: StructuredRequirement) {
  const keys = Object.keys(requirement.conditions ?? {}).sort();
  return (CONDITION_ALLOWLIST[requirement.ruleType] ?? []).some(allowed =>
    allowed.length === keys.length && [...allowed].sort().every((key, index) => key === keys[index]));
}

function targetIsClear(requirement: StructuredRequirement) {
  const target = requirement.target;
  const keys = Object.keys(target);
  if (keys.length === 0 || keys.some(key => !TARGET_KEYS.has(key))) return false;
  if (target.course_name !== undefined && typeof target.course_name !== 'string') return false;
  if (target.course_names !== undefined && (!Array.isArray(target.course_names) || target.course_names.length === 0)) return false;
  if (target.curriculum_category !== undefined && typeof target.curriculum_category !== 'string') return false;
  if (target.curriculum_field !== undefined && typeof target.curriculum_field !== 'string') return false;
  if (target.requirement_type !== undefined && typeof target.requirement_type !== 'string') return false;
  return true;
}

function mappingMatches(mapping: Mapping, requirement: StructuredRequirement) {
  const target = requirement.target;
  return (target.curriculum_category === undefined || mapping.category === target.curriculum_category)
    && (target.curriculum_field === undefined || mapping.field === target.curriculum_field)
    && (target.requirement_type === undefined || mapping.requirementType === target.requirement_type);
}

function requirementLabel(requirement: StructuredRequirement) {
  const target = requirement.target;
  if (target.course_name) return target.course_name;
  if (target.course_names) return target.course_names.join('・');
  const parts = [target.curriculum_category, target.curriculum_field, target.requirement_type].filter(Boolean);
  if (requirement.ruleType === 'min_schooling_credits') parts.push('スクーリング');
  return parts.join('：') || requirement.ruleId;
}

function unitFor(requirement: StructuredRequirement): 'credits' | 'courses' | null {
  if (requirement.ruleType === 'min_courses') return 'courses';
  if (['min_credits', 'max_credits', 'exact_credits', 'min_schooling_credits', 'required_course', 'choose_one'].includes(requirement.ruleType)) return 'credits';
  return null;
}

function evaluateStatus(type: StructuredRequirement['ruleType'], earned: number, target: number) {
  if (type === 'max_credits') return earned <= target ? 'satisfied' : 'unsatisfied';
  if (type === 'exact_credits') return earned === target ? 'satisfied' : 'unsatisfied';
  return earned >= target ? 'satisfied' : 'unsatisfied';
}

function evaluateStructured(
  requirement: StructuredRequirement,
  items: PlannerItem[],
  offerings: Map<string, Offering>,
  eligibleMappings: (offering: Offering) => Mapping[],
  hasUnresolvedEarned: boolean,
): RequirementProgress {
  if (!conditionIsSafe(requirement)) return unknown(requirement, '条件または例外を安全に自動評価できません');
  if (!targetIsClear(requirement)) return unknown(requirement, '対象集合を一意に特定できません');
  if (requirement.target.course_name === '史学演習') return unknown(requirement, '修得順により割当が変わるため自動評価できません');
  if (requirement.value === null) return unknown(requirement, '必要値が設定されていません');
  const unit = unitFor(requirement);
  if (unit === null) return unknown(requirement, 'この要件種別は自動評価対象外です');

  const names = requirement.target.course_names ?? (requirement.target.course_name ? [requirement.target.course_name] : null);
  const targetMappingIds = names === null ? null : new Set(
    [...offerings.values()]
      .filter(offering => names.includes(offering.name) && offering.resolutionStatus === 'matched')
      .flatMap(offering => eligibleMappings(offering))
      .filter(mapping => mappingMatches(mapping, requirement))
      .map(mapping => mapping.mappingId),
  );
  if (targetMappingIds !== null && targetMappingIds.size === 0) return unknown(requirement, '対象科目のmappingを一意に特定できません');

  const matched = items.flatMap(item => {
    const offering = offerings.get(item.offeringId);
    if (!offering) throw new Error(`Unknown offering: ${item.offeringId}`);
    if (offering.resolutionStatus !== 'matched') return [];
    const mappings = eligibleMappings(offering);
    const matchingMappings = mappings.filter(mapping => mappingMatches(mapping, requirement)
      && (targetMappingIds === null || targetMappingIds.has(mapping.mappingId)));
    if (requirement.conditions?.method && offering.method !== requirement.conditions.method) return [];
    return matchingMappings.length ? [{ item, offering, mappings: matchingMappings }] : [];
  });

  if (hasUnresolvedEarned) return unknown(requirement, '修得済みに対応関係を確認中の科目があります');
  if (matched.some(({ offering }) => offering.credits === null)) return unknown(requirement, '対象科目に単位数不明の開講があります');

  const completedMappings = new Map<string, { mapping: Mapping; earned: number; inProgress: number; planned: number }>();
  for (const row of matched) {
    for (const mapping of row.mappings) {
      const entry = completedMappings.get(mapping.mappingId) ?? {
        mapping, earned: 0, inProgress: 0, planned: 0,
      };
      if (row.item.status === 'earned') entry.earned += row.offering.credits!;
      else if (row.item.status === 'in_progress') entry.inProgress += row.offering.credits!;
      else if (row.item.status === 'planned') entry.planned += row.offering.credits!;
      completedMappings.set(mapping.mappingId, entry);
    }
  }
  if (requirement.conditions?.full_course_credits_required
    && [...completedMappings.values()].some(entry => entry.mapping.curriculumCredits === null)) {
    return unknown(requirement, '科目構成単位が不明のため全単位修得条件を判定できません');
  }
  const total = (status: PlannerItem['status']) => {
    if (requirement.conditions?.full_course_credits_required) {
      return [...completedMappings.values()].reduce((sum, entry) => {
        const credits = entry[status === 'earned' ? 'earned' : status === 'in_progress' ? 'inProgress' : 'planned'];
        return sum + (credits >= entry.mapping.curriculumCredits! ? entry.mapping.curriculumCredits! : 0);
      }, 0);
    }
    const rows = matched.filter(row => row.item.status === status);
    if (unit === 'courses') return new Set(rows.map(row => row.offering.id)).size;
    return rows.reduce((sum, row) => sum + row.offering.credits!, 0);
  };
  const earned = total('earned');
  const inProgress = total('in_progress');
  const planned = total('planned');
  const completedCourseCount = [...completedMappings.values()].filter(entry =>
    entry.earned >= (entry.mapping.curriculumCredits ?? Number.POSITIVE_INFINITY)).length;
  const minimumCourses = requirement.conditions?.min_courses;
  const maximumEnrollments = requirement.conditions?.max_enrollments;
  // A credit requirement with a course-count condition must meet both parts.
  // This is especially important for law's 8 courses / 32 credits rule.
  const meetsMinimumCourses = minimumCourses === undefined || completedCourseCount >= minimumCourses;
  const respectsMaximumEnrollments = maximumEnrollments === undefined || completedCourseCount <= maximumEnrollments;
  const creditStatus = evaluateStatus(requirement.ruleType, earned, requirement.value);
  return {
    requirementId: requirement.id,
    label: requirementLabel(requirement),
    ruleType: requirement.ruleType,
    status: creditStatus === 'satisfied' && meetsMinimumCourses && respectsMaximumEnrollments ? 'satisfied' : 'unsatisfied',
    earned, inProgress, planned, target: requirement.value, unit, reason: null,
  };
}

function thesisCondition(requirement: StructuredRequirement, selection: ThesisSelection): 'active' | 'inactive' | 'undecided' {
  const expected = requirement.conditions?.when?.thesis_selected;
  if (expected === undefined) return 'active';
  if (selection === 'undecided') return 'undecided';
  return expected === (selection === 'selected') ? 'active' : 'inactive';
}

function withoutThesisCondition(requirement: StructuredRequirement): StructuredRequirement {
  const conditions = { ...requirement.conditions };
  delete conditions.when;
  // This annotates the selected branch; it does not introduce an additional calculation.
  delete conditions.includes_thesis;
  return { ...requirement, conditions: Object.keys(conditions).length ? conditions : null };
}

function groupedCards(
  items: PlannerItem[], offerings: Map<string, Offering>, eligibleMappings: (offering: Offering) => Mapping[],
  hasUnresolvedEarned: boolean,
): ProgressCard[] {
  type Totals = { earned: number; inProgress: number; planned: number; schooling: number };
  const empty = (): Totals => ({ earned: 0, inProgress: 0, planned: 0, schooling: 0 });
  const general = empty();
  const fields = new Map(['人文', '社会', '自然'].map(field => [field, empty()]));
  const physical = empty();
  const basicLecture = empty();
  type CommonEntry = { mapping: Mapping; totals: Totals };
  const commonEntries = new Map<string, CommonEntry>();
  const physicalEarned = new Set<string>();
  const languages = new Map(['英語', '独語', '仏語'].map(language => [language, empty()]));
  for (const item of items) {
    const offering = offerings.get(item.offeringId);
    if (!offering) throw new Error(`Unknown offering: ${item.offeringId}`);
    if (offering.resolutionStatus !== 'matched' || offering.credits === null) continue;
    const mappings = eligibleMappings(offering);
    const add = (totals: Totals) => {
      if (item.status === 'earned') {
        totals.earned += offering.credits!;
        if (offering.method === 'schooling') totals.schooling += offering.credits!;
      } else if (item.status === 'in_progress') totals.inProgress += offering.credits!;
      else if (item.status === 'planned') totals.planned += offering.credits!;
    };
    const commonMappings = mappings.filter(mapping => mapping.category === '一般教育' && mapping.curriculumCredits !== null);
    if (commonMappings.length) {
      // 学習のしおり p.45: 基礎特講 is countable only twice / four credits.
      // Keep its excess out of the common-education total while still reporting it.
      if (offering.name === '基礎特講' || offering.name.startsWith('基礎特講（') || offering.name.startsWith('基礎特講［')) {
        add(basicLecture);
        if (item.status === 'earned') general.earned += Math.max(0, Math.min(4, basicLecture.earned) - Math.min(4, basicLecture.earned - offering.credits));
        else if (item.status === 'in_progress') general.inProgress += offering.credits;
        else if (item.status === 'planned') general.planned += offering.credits;
      } else {
        // p.45: graduation credits attach to a completed curriculum course,
        // not to an individual two-credit schooling attendance.
        for (const mapping of commonMappings) {
          const entry = commonEntries.get(mapping.mappingId) ?? { mapping, totals: empty() };
          add(entry.totals); commonEntries.set(mapping.mappingId, entry);
        }
      }
    }
    if (mappings.some(mapping => mapping.category === '保健体育')
      && (offering.name.startsWith('健康・スポーツ科学概論') || offering.name.startsWith('スポーツ総合演習'))) {
      add(physical);
      if (item.status === 'earned' && offering.credits >= 2) physicalEarned.add(offering.name.startsWith('健康・スポーツ科学概論') ? '概論' : '演習');
    }
    for (const [language, totals] of languages) {
      if (mappings.some(mapping => mapping.category === '外国語' && mapping.field === language)) add(totals);
    }
  }
  for (const { mapping, totals } of commonEntries.values()) {
    const completed = totals.earned >= mapping.curriculumCredits! ? mapping.curriculumCredits! : 0;
    general.earned += completed;
    const field = mapping.field && fields.get(mapping.field);
    if (field) field.earned += completed;
    // Plans remain informational only; they never complete a curriculum row.
    general.inProgress += totals.inProgress; general.planned += totals.planned;
    if (field) { field.inProgress += totals.inProgress; field.planned += totals.planned; }
  }
  const detail = (label: string, totals: Totals, target: number, showSchooling = false) => ({
    label, earned: totals.earned, inProgress: totals.inProgress, planned: totals.planned, target,
    ...(showSchooling ? { schooling: totals.schooling } : {}),
  });
  const make = (id: string, label: string, totals: Totals, target: number, satisfied: boolean, details?: ProgressCard['details'], note?: string): ProgressCard => ({
    requirementId: id, label, ruleType: 'group', status: hasUnresolvedEarned ? 'unknown' : satisfied ? 'satisfied' : 'unsatisfied',
    earned: Math.min(target, totals.earned), inProgress: totals.inProgress, planned: totals.planned, target, unit: 'credits',
    reason: hasUnresolvedEarned ? '修得済みに対応関係を確認中の科目があります' : null, details, note,
  });
  // p.45: a family can supply at most six credits to the natural-field minimum.
  // The 36-credit common-education total deliberately remains uncapped.
  const familyEarned = new Map<string, number>();
  const naturalFamily = (name: string) => /^(数学|生物学|化学|物理学)(?:[１２３123])?$/.test(name.normalize('NFKC')) ? name.normalize('NFKC').replace(/[１２３123]$/, '') : null;
  for (const { mapping, totals } of commonEntries.values()) {
    if (mapping.field !== '自然' || totals.earned < mapping.curriculumCredits!) continue;
    const name = [...offerings.values()].find(offering => offering.mappingIds.includes(mapping.mappingId))?.name ?? '';
    const family = naturalFamily(name);
    if (family) familyEarned.set(family, (familyEarned.get(family) ?? 0) + mapping.curriculumCredits!);
  }
  const naturalCapped = [...familyEarned.values()].reduce((sum, credits) => sum + Math.min(6, credits), 0)
    + [...commonEntries.values()].filter(({ mapping, totals }) => mapping.field === '自然' && totals.earned >= mapping.curriculumCredits! && !naturalFamily([...offerings.values()].find(o => o.mappingIds.includes(mapping.mappingId))?.name ?? '')).reduce((sum, entry) => sum + entry.mapping.curriculumCredits!, 0);
  const generalDetails = [...fields].map(([field, totals]) => detail(field, field === '自然' ? { ...totals, earned: naturalCapped } : totals, 8));
  const generalCard = make('group-general', '一般教育', general, 36,
    general.earned >= 36 && fields.get('人文')!.earned >= 8 && fields.get('社会')!.earned >= 8 && naturalCapped >= 8, generalDetails,
    `36単位のうち人文・社会・自然を各8単位以上。算入上限36単位。基礎特講は${Math.min(4, basicLecture.earned)} / 4単位（${basicLecture.earned > 4 ? `${basicLecture.earned - 4}単位は修得済みだが卒業算入外` : '2回まで算入'}）。`);
  const physicalCard = make('group-physical', '保健体育', physical, 2, physicalEarned.size > 0, undefined,
    '健康・スポーツ科学概論 または スポーツ総合演習を1科目。算入上限2単位');
  const candidates = [...languages].filter(([, totals]) => totals.earned >= 4 && totals.schooling >= 2);
  const best = candidates[0]?.[1] ?? [...languages.values()].sort((a, b) =>
    Math.min(4, b.earned) - Math.min(4, a.earned) || b.schooling - a.schooling
    || b.inProgress - a.inProgress || b.planned - a.planned)[0];
  const foreignCard = make('group-foreign', '外国語', best,
    4, candidates.length > 0, [...languages].map(([language, totals]) => detail(language, totals, 4, true)),
    `同一言語で4単位、うちスクーリング2単位以上。算入は1言語・上限4単位${candidates.length > 1 ? '（複数候補）' : candidates.length === 1 ? `（候補：${candidates[0][0]}）` : ''}`);
  return [generalCard, foreignCard, physicalCard];
}

function historySeminarCards(items: PlannerItem[], offerings: Map<string, Offering>): ProgressCard[] {
  const seminars = items.filter(item => item.status === 'earned' && isHistorySeminar(offerings.get(item.offeringId)));
  const ordered = seminars.filter(item => item.earnedOrder !== null);
  const assignedAll = ordered.length === 4;
  const orderKnown = validHistorySeminarOrders(items, offerings) && (assignedAll || seminars.every(item => item.earnedOrder !== null));
  const reason = orderKnown ? null : '修得済み史学演習の修得順が未確定です。公式の1〜4を順に記録してください。';
  const creditsFor = (orders: number[]) => ordered.filter(item => orders.includes(item.earnedOrder!)).reduce((sum, item) => sum + (offerings.get(item.offeringId)?.credits ?? 0), 0);
  const { hasAllFiveSchoolingRequiredCourses } = historySchoolingDiagnostic(items, offerings);
  const required = creditsFor(hasAllFiveSchoolingRequiredCourses ? [1] : [1, 2]);
  const elective = creditsFor(hasAllFiveSchoolingRequiredCourses ? [2, 3, 4] : [3, 4]);
  const details = ordered.map(item => {
    const offering = offerings.get(item.offeringId)!;
    return { label: `史学演習${item.earnedOrder}（${historySeminarField(offering) ?? '分野未確認'}）`, earned: offering.credits ?? 0, inProgress: 0, planned: 0, target: 2 };
  });
  const card = (requirementId: string, label: string, earned: number, target: number): ProgressCard => ({
    requirementId, label, ruleType: 'history_seminar_sequence',
    status: orderKnown ? (earned >= target ? 'satisfied' : 'unsatisfied') : 'unknown',
    earned: orderKnown ? earned : null, inProgress: 0, planned: 0, target, unit: 'credits', reason,
    details, note: '史学演習1はスクーリング選択必修、2も原則同枠です。ただし5科目すべてを修得した場合は、公式どおり史学演習2を選択へ振り替えます。3・4は選択、5回目以降は卒業所要単位に算入しません。分野別概説4単位の修得前提は参考情報であり、受講可否は判定しません。',
  });
  return [
    card('history-seminar-required-elective', hasAllFiveSchoolingRequiredCourses ? '史学演習1（スクーリング選択必修）' : '史学演習1・2（スクーリング選択必修）', required, hasAllFiveSchoolingRequiredCourses ? 2 : 4),
    card('history-seminar-elective', hasAllFiveSchoolingRequiredCourses ? '史学演習2〜4（選択）' : '史学演習3・4（選択）', elective, hasAllFiveSchoolingRequiredCourses ? 6 : 4),
  ];
}

type Totals = { earned: number; inProgress: number; planned: number; courses: Set<string> };
const emptyTotals = (): Totals => ({ earned: 0, inProgress: 0, planned: 0, courses: new Set() });

// The source snapshot has no courseId for these offerings.  Their curriculum
// mapping is therefore the canonical identity; names are only a compatibility
// fallback for an as-yet-unmapped catalog row.
const HISTORY_OVERVIEW_NAMES = ['日本史概説', '東洋史概説', '西洋史概説'] as const;
const HISTORY_OVERVIEW_MAPPING_NAMES = new Map<string, typeof HISTORY_OVERVIEW_NAMES[number]>([
  ['f87aca70-d720-4435-8f2c-013b1c1fd5e4', '日本史概説'],
  ['c644b305-f312-4b08-8f8f-aaf02cf9069e', '日本史概説'],
  ['4623706f-84c7-46f2-b736-b98731eba3a0', '東洋史概説'],
  ['4db251ac-3887-4f18-a225-1c332572d2db', '東洋史概説'],
  ['8dc9f71e-30c1-4a7f-8fb7-7a117af6a3a7', '西洋史概説'],
  ['a1c1e855-6e61-4232-8b8a-d7d9dd2a809a', '西洋史概説'],
]);
function historyOverviewName(offering: Offering | undefined): typeof HISTORY_OVERVIEW_NAMES[number] | null {
  if (!offering) return null;
  const mapped = offering.mappingIds.map(mappingId => HISTORY_OVERVIEW_MAPPING_NAMES.get(mappingId)).find(Boolean);
  if (mapped) return mapped;
  return HISTORY_OVERVIEW_NAMES.find(name => offering.name === name
    || offering.name.startsWith(`${name}（`) || offering.name.startsWith(`${name}［`) || offering.name.startsWith(`${name}[`)) ?? null;
}

function isHistoryOverviewSchooling(offering: Offering | undefined) {
  // The raw snapshot labels two media offerings as method=schooling.  The
  // printed 2026 table is authoritative: a メディア offering is not one of the
  // five *スクーリング*選択必修 courses.
  return offering?.method === 'schooling' && !/メディア/.test(offering.name);
}

/**
 * Shared fifth-course evidence for both History card groups.  Keeping this
 * independent of the display/coalescing layer makes the saved PlannerItem
 * identity, status, and completion order directly auditable.
 */
export function historySchoolingDiagnostic(items: PlannerItem[], offerings: Map<string, Offering>): HistorySchoolingDiagnostic {
  const overviewDetections = items.flatMap(item => {
    const offering = offerings.get(item.offeringId);
    const family = historyOverviewName(offering);
    return family === null || !offering ? [] : [{
      family, offeringId: item.offeringId, status: item.status, method: offering.method,
      credits: offering.credits, schooling: isHistoryOverviewSchooling(offering), mappingIds: offering.mappingIds,
    }];
  });
  const orderedSeminarOrders = items.filter(item => item.status === 'earned' && isHistorySeminar(offerings.get(item.offeringId)) && item.earnedOrder !== null)
    .map(item => item.earnedOrder!).sort((a, b) => a - b);
  const overviewSchoolingCompletions = HISTORY_OVERVIEW_NAMES.filter(name => overviewDetections.some(row =>
    row.family === name && row.status === 'earned' && row.schooling && (row.credits ?? 0) >= 2)).length;
  return {
    orderedSeminarOrders,
    overviewDetections,
    overviewSchoolingCompletions,
    hasAllFiveSchoolingRequiredCourses: overviewSchoolingCompletions === 3
      && orderedSeminarOrders.includes(1) && orderedSeminarOrders.includes(2),
  };
}

type ElectiveOverflowRule = { threshold: number; requiredCourses: number | null };

/**
 * The curriculum table is the source of truth for an 選択必修 excess transfer.
 * Do not duplicate department-specific thresholds in the card implementation:
 * a stale constant here could make the displayed elective bucket disagree with
 * the structured official rule retained in the catalog.
 */
function electiveOverflowRule(catalog: PlannerCatalog, scopeId: string): ElectiveOverflowRule | null {
  const requirement = catalog.requirements.find((candidate): candidate is StructuredRequirement =>
    candidate.status === 'structured'
      && candidate.scopeId === scopeId
      && candidate.ruleType === 'overflow_credit_transfer'
      && candidate.target.curriculum_category === '専門教育'
      && candidate.target.requirement_type === '選択'
      && candidate.conditions?.transfer === 'excess_only'
      && candidate.conditions.double_count === false
      && candidate.conditions.from?.curriculum_category === '専門教育'
      && candidate.conditions.from?.requirement_type === '選択必修'
      && candidate.conditions.to?.curriculum_category === '専門教育'
      && candidate.conditions.to?.requirement_type === '選択'
      && typeof candidate.conditions.threshold?.credits === 'number'
      && candidate.conditions.threshold.credits >= 0,
  );
  if (!requirement) return null;
  return {
    threshold: requirement.conditions!.threshold!.credits,
    requiredCourses: typeof requirement.conditions!.requires_completed_courses === 'number'
      ? requirement.conditions!.requires_completed_courses
      : null,
  };
}

function requiredElectiveCreditTarget(catalog: PlannerCatalog, scopeId: string): number | null {
  const requirement = catalog.requirements.find((candidate): candidate is StructuredRequirement =>
    candidate.status === 'structured'
      && candidate.scopeId === scopeId
      && candidate.ruleType === 'min_credits'
      && candidate.target.curriculum_category === '専門教育'
      && candidate.target.requirement_type === '選択必修'
      && candidate.target.curriculum_field === undefined
      && typeof candidate.value === 'number'
      && candidate.value >= 0,
  );
  return requirement?.value ?? null;
}

/** The economics and commerce tables specify a professional-education total,
 * separately from their required-elective minimum. */
function professionalTotalCreditTarget(catalog: PlannerCatalog, scopeId: string): number | null {
  const requirement = catalog.requirements.find((candidate): candidate is StructuredRequirement =>
    candidate.status === 'structured'
      && candidate.scopeId === scopeId
      && candidate.ruleType === 'min_credits'
      && candidate.target.curriculum_category === '専門教育'
      && candidate.target.requirement_type === undefined
      && candidate.target.curriculum_field === undefined
      && typeof candidate.value === 'number'
      && candidate.value >= 0,
  );
  return requirement?.value ?? null;
}

function addOfferingTotals(totals: Totals, item: PlannerItem, offering: Offering) {
  if (item.status === 'earned') {
    totals.earned += offering.credits!;
    totals.courses.add(offering.id);
  } else if (item.status === 'in_progress') totals.inProgress += offering.credits!;
  else if (item.status === 'planned') totals.planned += offering.credits!;
}

type CurriculumEntry = {
  mapping: Mapping;
  label: string;
  earned: number;
  inProgress: number;
  planned: number;
  earnedSchooling: number;
};

function curriculumCourseLabel(offering: Offering) {
  // Delivery and department qualifiers describe an offering, rather than the
  // curriculum course being completed across multiple offerings.
  return offering.name
    .replace(/（(?:春期|夏期|秋期|冬期)?スクーリング）$/, '')
    .replace(/（地理）$/, '');
}

function isCalligraphyPracticum(entry: CurriculumEntry) {
  return entry.label === '書道実技';
}

function completedCurriculumCredits(entry: CurriculumEntry) {
  // 2026 p.48: 書道実技 is completed by correspondence + one schooling
  // credit, or by two schooling credits. Correspondence-only completion is
  // deliberately not treated as a completed curriculum course.
  if (isCalligraphyPracticum(entry) && entry.earnedSchooling < 1) return 0;
  return entry.earned >= entry.mapping.curriculumCredits! ? entry.mapping.curriculumCredits! : 0;
}

function addCurriculumTotals(totals: Totals, entry: CurriculumEntry) {
  totals.inProgress += entry.inProgress;
  totals.planned += entry.planned;
  // A mapping becomes one completed curriculum course only after all of its
  // official curriculum credits have been earned across its offerings.
  const completed = completedCurriculumCredits(entry);
  if (completed > 0) {
    totals.earned += completed;
    totals.courses.add(entry.mapping.mappingId);
  }
}

/**
 * The curriculum tables express a small number of connected buckets per department.
 * Keep their transfer rules here rather than showing every source rule as a card.
 */
function professionalCards(
  items: PlannerItem[], catalog: PlannerCatalog, scopeId: string, offerings: Map<string, Offering>,
  eligibleMappings: (offering: Offering) => Mapping[], hasUnresolvedEarned: boolean, publicCourseCredits: number, thesisSelection: ThesisSelection, thesisStatus: ThesisProgress['status'],
): ProgressCard[] {
  const program = catalog.programs.find(candidate => candidate.scopeId === scopeId);
  if (!program || !['日本文学科', '史学科', '地理学科', '法律学科', '経済学科', '商業学科'].includes(program.department ?? '')) return [];
  const buckets = new Map<string, Totals>();
  const bucket = (name: string) => buckets.get(name) ?? (buckets.set(name, emptyTotals()), buckets.get(name)!);
  const ambiguous = new Set<string>();
  const incompleteMetadata = new Set<string>();
  const legacyRepeatable = new Set<string>();
  const repeatables = new Map<string, { name: string; type: string; limit: number; limitCourses: number; earned: number; inProgress: number; planned: number; courses: Set<string> }>();
  const entries = new Map<string, CurriculumEntry>();
  const addTo = (name: string, item: PlannerItem, offering: Offering) => addOfferingTotals(bucket(name), item, offering);
  const specialRows: Array<{ kind: string; item: PlannerItem; offering: Offering }> = [];
  const geographyTransferDetails: string[] = [];
  const canonicalNameForCourse = (courseId: string | null) => catalog.courses.find(course => course.id === courseId)?.canonicalName ?? null;
  for (const item of items) {
    const offering = offerings.get(item.offeringId);
    if (!offering || offering.credits === null) continue;
    // These two 2026 history rows intentionally remain manual_review in the
    // catalog because their numbered curriculum identity depends on the
    // learner. Their official family and fixed credit value are nevertheless
    // known, so route them through the dedicated allocation below.
    if (program.department === '史学科' && isHistorySeminar(offering)) continue;
    if (program.department === '史学科' && isHistoricalSources(offering)) {
      specialRows.push({ kind: 'history-sources', item, offering });
      continue;
    }
    // The source snapshot retains some verified overview offerings as
    // manual_review until the runtime ledger supplies their mapping edge.
    // This dedicated official allocation is safe without that generic gate.
    if (program.department === '史学科' && historyOverviewName(offering) !== null) {
      specialRows.push({ kind: 'history-overview', item, offering });
      continue;
    }
    if (offering.resolutionStatus !== 'matched') continue;
    // A required literature thesis is tracked by its own source-configured card.
    // Do not let a future thesis offering also inflate a professional-category bucket.
    // Thesis progress is a learner-managed record, rather than an annual offering.
    // Ignore a future catalog/import match with this name to make the one-source
    // policy explicit and avoid double counting it with the manual record.
    if (offering.name === '卒業論文') continue;
    // History seminars are allocated by the learner's confirmed completion order below.
    if (program.department === '史学科' && isHistorySeminar(offering)) continue;
    if (program.department === '地理学科') {
      const kind = geographyTransferKind(offering, canonicalNameForCourse);
      if (kind) {
        const specialMappings = eligibleMappings(offering).filter(mapping => mapping.scopeId === scopeId && mapping.category === '専門教育');
        // Transfer destinations must never bypass the same curriculum-completion
        // evidence required for ordinary professional rows.
        if (specialMappings.length === 0) {
          if (item.status === 'earned') ambiguous.add(offering.id);
          continue;
        }
        if (specialMappings.some(mapping => mapping.curriculumCredits === null)) {
          if (item.status === 'earned') specialMappings.forEach(mapping => incompleteMetadata.add(mapping.mappingId));
          continue;
        }
        specialRows.push({ kind, item, offering });
        continue;
      }
    }
    const mappings = eligibleMappings(offering).filter(mapping => mapping.scopeId === scopeId && mapping.category === '専門教育');
    const types = [...new Set(mappings.map(mapping => mapping.requirementType).filter((type): type is string => type !== null))];
    // Only completed courses affect today's graduation judgement.  An unresolved
    // future course must not put an otherwise evaluable professional card on hold.
    if (types.length > 1) {
      if (item.status === 'earned') ambiguous.add(offering.id);
      continue;
    }
    const type = types[0];
    if (!type) continue;
    const fields = [...new Set(mappings.filter(mapping => mapping.requirementType === type).map(mapping => mapping.field))];
    if (fields.length > 1) {
      if (item.status === 'earned') ambiguous.add(offering.id);
      continue;
    }
    // Multiple identical mapping edges describe one curriculum row, not several courses.
    const mapping = [...mappings].sort((a, b) => a.mappingId.localeCompare(b.mappingId))[0];
    if (mapping.curriculumCredits === null) {
      if (item.status === 'earned') incompleteMetadata.add(mapping.mappingId);
      continue;
    }
    const rule = repeatableRule(program.department!, offering);
    if (rule) {
      const [, name, limit, limitCourses] = rule;
      const repeat = repeatables.get(`${type}:${name}`) ?? { name, type, limit, limitCourses, earned: 0, inProgress: 0, planned: 0, courses: new Set<string>() };
      if (item.status === 'earned') { repeat.earned += offering.credits; repeat.courses.add(offering.id); }
      else if (item.status === 'in_progress') repeat.inProgress += offering.credits;
      else if (item.status === 'planned') repeat.planned += offering.credits;
      repeatables.set(`${type}:${name}`, repeat);
      continue;
    }
    if (['法律学特講', '歴史資料学'].some(name => offering.name === name || offering.name.startsWith(`${name}（`))) {
      if (item.status === 'earned') legacyRepeatable.add(mapping.mappingId);
      continue;
    }
    const entry = entries.get(mapping.mappingId) ?? {
      mapping, label: curriculumCourseLabel(offering), earned: 0, inProgress: 0, planned: 0, earnedSchooling: 0,
    };
    if (item.status === 'earned') {
      entry.earned += offering.credits;
      if (offering.method === 'schooling') entry.earnedSchooling += offering.credits;
    }
    else if (item.status === 'in_progress') entry.inProgress += offering.credits;
    else if (item.status === 'planned') entry.planned += offering.credits;
    entries.set(mapping.mappingId, entry);
  }

  const addCredits = (name: string, item: PlannerItem, offering: Offering, credits: number) => {
    if (credits <= 0) return;
    const totals = bucket(name);
    if (item.status === 'earned') {
      totals.earned += credits;
      totals.courses.add(offering.id);
    } else if (item.status === 'in_progress') totals.inProgress += credits;
    else if (item.status === 'planned') totals.planned += credits;
  };
  // These transfers are stated in the 2026 curriculum tables. They are based on
  // completed-credit quantities, so unlike 史学演習 they do not need a learner-entered order.
  const distribute = (rows: typeof specialRows, allocations: Array<[string, number]>) => {
    // A cap belongs to the course family, not to each lifecycle status.  Give
    // already-earned credits priority, then in-progress and planned credits,
    // so an earlier completion cannot be counted again as a future plan.
    const used = allocations.map(() => 0);
    for (const status of ['earned', 'in_progress', 'planned'] as const) {
      for (const row of rows.filter(candidate => candidate.item.status === status)) {
        let remaining = row.offering.credits!;
        for (const [index, [name, cap]] of allocations.entries()) {
          const room = cap === Infinity ? remaining : Math.max(0, cap - used[index]);
          const amount = Math.min(remaining, room);
          addCredits(name, row.item, row.offering, amount);
          if (name.startsWith('選択必修:')) addCredits('選択必修', row.item, row.offering, amount);
          remaining -= amount;
          used[index] += amount;
          if (remaining === 0) break;
        }
      }
    }
  };
  if (program.department === '史学科') {
    // p.53 c: for each overview, the first two schooling credits are the
    // schooling-elective course; any further credits are its required namesake.
    for (const name of HISTORY_OVERVIEW_NAMES) {
      const rows = specialRows.filter(row => row.kind === 'history-overview' && historyOverviewName(row.offering) === name);
      const schooling = rows.filter(row => isHistoryOverviewSchooling(row.offering));
      const other = rows.filter(row => !isHistoryOverviewSchooling(row.offering));
      distribute(schooling, [['スクーリング選択必修', 2], ['必修', Infinity]]);
      distribute(other, [['必修', Infinity]]);
    }
    // 歴史資料学1〜6 are all elective. The official maximum is six
    // completions / 12 credits; unlike 史学演習 their number never changes the
    // destination bucket, so a missing personal order does not block this cap.
    distribute(specialRows.filter(row => row.kind === 'history-sources'), [['選択', 12]]);
  }
  if (program.department === '地理学科') {
    // The table's named destination courses are allocation buckets, not extra
    // offerings.  This helper emits exactly one allocation for each credit.
    for (const kind of ['fieldStudy', 'chorography', 'humanSeminar', 'naturalSeminar', 'geographyLecture'] as GeographyTransferKind[]) {
      const rows = specialRows.filter(row => row.kind === kind);
      const { allocations, discarded } = allocateGeographyTransfers(kind, rows.map(row => ({ id: row.offering.id, credits: row.offering.credits!, status: row.item.status as 'earned' | 'in_progress' | 'planned' })).filter(row => ['earned', 'in_progress', 'planned'].includes(row.status)));
      for (const allocation of allocations) {
        const row = rows.find(candidate => candidate.offering.id === allocation.id)!;
        addCredits(allocation.bucket, row.item, row.offering, allocation.credits);
        if (allocation.bucket.startsWith('選択必修:')) addCredits('選択必修', row.item, row.offering, allocation.credits);
      }
      if (allocations.some(allocation => allocation.status === 'earned')) {
        const label = { fieldStudy: '現地研究', chorography: '地誌学特講', humanSeminar: '人文地理学演習', naturalSeminar: '自然地理学演習', geographyLecture: '人文・自然地理学特講' }[kind];
        const summary = allocations.filter(allocation => allocation.status === 'earned').map(allocation => `${allocation.bucket} ${allocation.credits}単位`).join(' + ');
        geographyTransferDetails.push(`${label}: ${summary}${discarded ? `（超過${discarded}単位は卒業算入外）` : ''}`);
      }
    }
  }

  for (const entry of entries.values()) {
    const type = entry.mapping.requirementType!;
    addCurriculumTotals(bucket(type), entry);
    if (entry.mapping.field !== null) addCurriculumTotals(bucket(`${type}:${entry.mapping.field}`), entry);
  }
  for (const repeat of repeatables.values()) {
    const totals = bucket(repeat.type);
    totals.earned += Math.min(repeat.earned, repeat.limit);
    totals.inProgress += repeat.inProgress;
    totals.planned += repeat.planned;
    [...repeat.courses].slice(0, repeat.limitCourses).forEach(id => totals.courses.add(id));
  }

  const baseReason = hasUnresolvedEarned
    ? '修得済みに対応関係を確認中の科目があります'
    : ambiguous.size ? '専門教育の区分が複数ある科目があるため自動配分を保留しています'
        : incompleteMetadata.size ? 'カリキュラム科目の構成単位が未設定のため卒業算入を保留しています'
        : legacyRepeatable.size ? '複数回の卒業算入があり得る科目を安全に判定できないため保留しています' : null;
  const overflowRule = electiveOverflowRule(catalog, scopeId);
  const requiredElectiveTarget = requiredElectiveCreditTarget(catalog, scopeId);
  const overflowRuleReason = overflowRule === null
    ? '選択必修超過分を選択へ算入する公式ルールを安全に特定できません。'
    : baseReason;
  const make = (id: string, label: string, totals: Totals, target: number | null, satisfied: boolean,
    details?: ProgressCard['details'], note?: string, reason = baseReason): ProgressCard => ({
    requirementId: id, label, ruleType: 'professional_group',
    status: reason ? 'unknown' : satisfied ? 'satisfied' : 'unsatisfied',
    earned: reason ? null : target === null ? totals.earned : Math.min(target, totals.earned), normalEarned: totals.earned,
    inProgress: totals.inProgress, planned: totals.planned, target, unit: 'credits', reason, details, note,
    repeatableCourses: [...repeatables.values()].filter(repeat => repeat.type === label.split('：').at(-1)).map(repeat => ({ label: repeat.name, earned: repeat.earned, counted: Math.min(repeat.earned, repeat.limit), limit: repeat.limit, courses: repeat.courses.size, limitCourses: repeat.limitCourses })),
  });
  const makeKnownUnknown = (id: string, label: string, totals: Totals, details: ProgressCard['details'] | undefined, note: string, reason: string) => ({
    ...make(id, label, totals, null, false, details, note, reason), earned: totals.earned,
  });
  const detail = (label: string, totals: Totals, target: number, unit: 'credits' | 'courses' = 'credits') =>
    ({ label, earned: unit === 'courses' ? totals.courses.size : totals.earned, inProgress: totals.inProgress, planned: totals.planned, target, unit });
  const normal = (name: string) => bucket(name);
  // The official public-course row is an independent cap, then its counted
  // credits flow into this department's professional-elective bucket.
  normal('選択').earned += publicCourseCredits;
  const catalogElectiveEarned = () => normal('選択').earned - publicCourseCredits;
  const publicCourseBreakdown = () => publicCourseCredits > 0 ? ` + 公開科目算入 ${publicCourseCredits}単位` : '';
  const partialCourses = (type: string): ProgressCard['partialCourses'] => [...entries.values()]
    .filter(entry => entry.mapping.requirementType === type
      && entry.earned > 0 && completedCurriculumCredits(entry) < entry.mapping.curriculumCredits!)
    .map(entry => ({
      mappingId: entry.mapping.mappingId,
      label: entry.label,
      earned: isCalligraphyPracticum(entry) && entry.earnedSchooling < 1 ? 0 : entry.earned,
      target: entry.mapping.curriculumCredits!,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
  const overflow = (from: Totals, threshold: number) => Math.max(0, from.earned - threshold);
  const withOverflow = (own: Totals, from: Totals, threshold: number): Totals => ({ ...own, earned: own.earned + overflow(from, threshold) });

  if (program.department === '日本文学科') {
    const required = normal('必修'), requiredElective = normal('選択必修');
    const requiredElectiveTargetValue = requiredElectiveTarget ?? 20;
    const threshold = overflowRule?.threshold ?? 0;
    const elective = withOverflow(normal('選択'), requiredElective, threshold);
    const thesisCredits = thesisSelection === 'selected' ? thesisCreditsForDepartment(program.department) ?? 0 : 0;
    const total = {
      earned: required.earned + requiredElective.earned + normal('選択').earned + (thesisStatus === 'earned' ? thesisCredits : 0),
      inProgress: required.inProgress + requiredElective.inProgress + normal('選択').inProgress + (thesisStatus === 'in_progress' ? thesisCredits : 0),
      planned: required.planned + requiredElective.planned + normal('選択').planned + (thesisStatus === 'planned' ? thesisCredits : 0),
      schooling: 0,
      courses: new Set<string>(),
    };
    return [
      { ...make('professional-required', '専門教育：必修', required, 20, required.earned >= 20), partialCourses: partialCourses('必修') },
      { ...make('professional-required-elective', '専門教育：選択必修', requiredElective, requiredElectiveTargetValue, requiredElective.earned >= requiredElectiveTargetValue), partialCourses: partialCourses('選択必修') },
      { ...make('professional-elective', '専門教育：選択', elective, 24, elective.earned >= 24, undefined,
        `純粋な選択 ${catalogElectiveEarned()}単位 + 選択必修超過 ${overflow(requiredElective, threshold)}単位${publicCourseBreakdown()}。超過分は選択必修の達成値には重ねて算入しません。`, overflowRuleReason), partialCourses: partialCourses('選択') },
      make('professional-japanese-total', '専門教育：合計', total, 82, total.earned >= 82, undefined,
        '必修・選択必修・選択と卒業論文（必修）を、各要件カードの上限とは別に相互排他的に合計します。', baseReason),
    ];
  }

  if (program.department === '史学科') {
    const seminars = items.filter(item => item.status === 'earned' && isHistorySeminar(offerings.get(item.offeringId)));
    const ordered = seminars.filter(item => item.earnedOrder !== null);
    const orderKnown = validHistorySeminarOrders(items, offerings) && (ordered.length === 4 || seminars.every(item => item.earnedOrder !== null));
    const orderReason = orderKnown ? baseReason : '修得済み史学演習の修得順が未確定です。公式の1〜4を順に記録してください。';
    const { hasAllFiveSchoolingRequiredCourses } = historySchoolingDiagnostic(items, offerings);
    for (const item of ordered) {
      const offering = offerings.get(item.offeringId)!;
      const target = item.earnedOrder === 1 || (item.earnedOrder === 2 && !hasAllFiveSchoolingRequiredCourses)
        ? 'スクーリング選択必修' : item.earnedOrder! <= 4 ? '選択' : null;
      if (target === null) continue;
      addTo(target, item, offering);
      const field = historySeminarField(offering);
      if (target === '選択' && field) addTo(`選択:${field}史の分野`, item, offering);
    }
    const required = normal('必修');
    const schoolingRequired = normal('スクーリング選択必修');
    const elective = normal('選択');
    const fields = ['日本', '東洋', '西洋'].map(field => ({ label: `${field}史`, totals: normal(`選択:${field}史の分野`) }));
    const fieldMet = fields.every(field => field.totals.courses.size >= 1);
    return [
      { ...make('professional-history-required', '専門教育：必修', required, 16, required.earned >= 16), partialCourses: partialCourses('必修') },
      { ...make('professional-history-schooling-required-elective', '専門教育：スクーリング選択必修', schoolingRequired, 8, schoolingRequired.earned >= 8,
        undefined, hasAllFiveSchoolingRequiredCourses ? '5科目すべてを修得済みのため、公式どおり史学演習2は選択へ算入しています。' : '史学演習1と（5科目修得前の）2はこの枠へ算入します。', orderReason), partialCourses: partialCourses('スクーリング選択必修') },
      { ...make('professional-history-elective', '専門教育：選択', elective, 50, elective.earned >= 50 && fieldMet,
        fields.map(field => detail(`${field.label}から1科目以上`, field.totals, 1, 'courses')),
        `${hasAllFiveSchoolingRequiredCourses ? '史学演習2（5科目修得時）・' : ''}史学演習3・4と歴史資料学（6回12単位まで）はこの枠へ算入します。50単位に加え、日本・東洋・西洋史から各1科目が必要です。`, orderReason), partialCourses: partialCourses('選択') },
    ];
  }

  if (program.department === '地理学科') {
    const required = normal('必修'), schooling = normal('スクーリング必修'), requiredElective = normal('選択必修');
    const requiredElectiveTargetValue = requiredElectiveTarget ?? 36;
    const threshold = overflowRule?.threshold ?? 0;
    const elective = withOverflow(normal('選択'), requiredElective, threshold);
    const human = normal('選択必修:人文地理の分野'), natural = normal('選択必修:自然地理の分野'), regional = normal('選択必修:地誌・その他の分野');
    const fieldsMet = human.earned >= 8 && human.courses.size >= 2 && natural.earned >= 8 && natural.courses.size >= 2 && regional.earned >= 16;
    const thesisCredits = thesisSelection === 'selected' ? thesisCreditsForDepartment(program.department) ?? 0 : 0;
    const total = {
      earned: required.earned + schooling.earned + requiredElective.earned + normal('選択').earned + (thesisStatus === 'earned' ? thesisCredits : 0),
      inProgress: required.inProgress + schooling.inProgress + requiredElective.inProgress + normal('選択').inProgress + (thesisStatus === 'in_progress' ? thesisCredits : 0),
      planned: required.planned + schooling.planned + requiredElective.planned + normal('選択').planned + (thesisStatus === 'planned' ? thesisCredits : 0),
      schooling: 0,
      courses: new Set<string>(),
    };
    return [
      { ...make('professional-geography-required', '専門教育：必修', required, 12, required.earned >= 12), partialCourses: partialCourses('必修') },
      { ...make('professional-geography-schooling-required', '専門教育：スクーリング必修', schooling, 6, schooling.earned >= 6), partialCourses: partialCourses('スクーリング必修') },
      { ...make('professional-geography-required-elective', '専門教育：選択必修', requiredElective, requiredElectiveTargetValue, requiredElective.earned >= requiredElectiveTargetValue && fieldsMet,
        [detail('人文地理：2科目・8単位以上', human, 8), detail('自然地理：2科目・8単位以上', natural, 8), detail('地誌・その他：16単位以上', regional, 16)],
        `人文・自然はそれぞれ科目数も満たす必要があります。${geographyTransferDetails.filter(detail => /演習|地誌/.test(detail)).join('。')}。2013年度以前の救済措置は自動判定しません。`), partialCourses: partialCourses('選択必修') },
      { ...make('professional-geography-elective', '専門教育：選択', elective, 12, elective.earned >= 12, undefined,
        `純粋な選択 ${catalogElectiveEarned()}単位 + 選択必修超過 ${overflow(requiredElective, threshold)}単位${publicCourseBreakdown()}。${geographyTransferDetails.join('。')}。`, overflowRuleReason), partialCourses: partialCourses('選択') },
      make('professional-geography-total', '専門教育：合計', total, 82, total.earned >= 82, undefined,
        '必修・スクーリング必修・選択必修・選択と卒業論文（必修）を、特殊振替を含む相互排他的な配分から合計します。', baseReason),
    ];
  }

  if (program.department === '法律学科') {
    const requiredElective = normal('選択必修');
    const requiredElectiveTargetValue = requiredElectiveTarget ?? 32;
    const threshold = overflowRule?.threshold ?? 0;
    const requiredCourses = overflowRule?.requiredCourses ?? 0;
    const qualifies = requiredElective.earned >= requiredElectiveTargetValue && requiredElective.courses.size >= requiredCourses;
    // p.47 b: after the eight completed required-elective courses / 32 credits,
    // a 2-credit schooling completion of a 4-credit required-elective or elective
    // course can count toward graduation. Do not generalize this to other partials.
    const permittedPartial = qualifies ? [...entries.values()]
      .filter(entry => ['選択必修', '選択'].includes(entry.mapping.requirementType ?? '')
        && entry.mapping.curriculumCredits === 4 && entry.earned === 2 && entry.earnedSchooling === 2)
      .reduce((sum, entry) => sum + entry.earned, 0) : 0;
    const thesisCredits = thesisSelection === 'selected' ? thesisCreditsForDepartment(program.department) ?? 0 : 0;
    const thesisTotals = { earned: thesisStatus === 'earned' ? thesisCredits : 0, inProgress: thesisStatus === 'in_progress' ? thesisCredits : 0, planned: thesisStatus === 'planned' ? thesisCredits : 0 };
    const overflowElective = withOverflow(normal('選択'), requiredElective, threshold);
    const elective = { ...overflowElective, earned: overflowElective.earned + permittedPartial + thesisTotals.earned, inProgress: overflowElective.inProgress + thesisTotals.inProgress, planned: overflowElective.planned + thesisTotals.planned };
    const thesisValue = (ruleId: string) => catalog.requirements.find((rule): rule is StructuredRequirement =>
      rule.status === 'structured' && rule.scopeId === scopeId && rule.ruleId === ruleId)?.value ?? null;
    const selected = thesisSelection === 'selected';
    const electiveTarget = thesisSelection === 'undecided' ? null : thesisValue(selected ? 'law_elective_with_thesis_min_credits' : 'law_elective_without_thesis_min_credits');
    const totalTarget = thesisSelection === 'undecided' ? null : thesisValue(selected ? 'law_total_with_thesis_min_credits' : 'law_total_without_thesis_min_credits');
    const total = { ...requiredElective, earned: requiredElective.earned + normal('選択').earned + permittedPartial + thesisTotals.earned, inProgress: requiredElective.inProgress + normal('選択').inProgress + thesisTotals.inProgress, planned: requiredElective.planned + normal('選択').planned + thesisTotals.planned };
    const undecidedReason = '卒論有無が未定のため、必要単位を判定できません。';
    return [
      { ...make('professional-law-required-elective', '専門教育：選択必修', requiredElective, requiredElectiveTargetValue, qualifies,
        [detail('選択必修科目数', requiredElective, 8, 'courses')], '8科目かつ32単位が必要です。'), partialCourses: partialCourses('選択必修') },
      ...(thesisSelection === 'undecided' ? [{ ...makeKnownUnknown('professional-law-elective', '専門教育：選択（卒業算入見込み）', elective, undefined,
        `純粋な選択 ${catalogElectiveEarned()}単位 + 選択必修超過 ${overflow(requiredElective, threshold)}単位${publicCourseBreakdown()} + ${requiredCourses}科目${threshold}単位達成後に認められる4単位科目のスクーリング部分修得 ${permittedPartial}単位。`, undecidedReason), partialCourses: partialCourses('選択') },
        makeKnownUnknown('professional-law-total', '専門教育：合計（卒業算入見込み）', total, undefined, '卒論の選択により必要単位が変わります。', undecidedReason)] : [
        { ...make('professional-law-elective', '専門教育：選択', elective, electiveTarget, electiveTarget !== null && elective.earned >= electiveTarget,
          undefined, `純粋な選択 ${catalogElectiveEarned()}単位 + 選択必修超過 ${overflow(requiredElective, threshold)}単位${publicCourseBreakdown()} + ${requiredCourses}科目${threshold}単位達成後に認められる4単位科目のスクーリング部分修得 ${permittedPartial}単位。`, overflowRuleReason), partialCourses: partialCourses('選択') },
        make('professional-law-total', '専門教育：合計', total, totalTarget, totalTarget !== null && total.earned >= totalTarget, undefined, '選択必修・選択の卒業算入見込み合計です。', baseReason)]),
      (() => {
        const schooling = emptyTotals();
        for (const item of items) {
          if (item.status !== 'earned') continue;
          const offering = offerings.get(item.offeringId);
          if (!offering || offering.method !== 'schooling' || offering.credits === null || offering.resolutionStatus !== 'matched') continue;
          const maps = eligibleMappings(offering).filter(mapping => mapping.scopeId === scopeId && mapping.category === '専門教育');
          if (!maps.length) continue;
          const canonical = offering.courseId ? catalog.courses.find(course => course.id === offering.courseId)?.canonicalName : offering.name;
          // Public courses and every exact official ＊ row are excluded.  No fuzzy name matching.
          if (!canonical || LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026.has(canonical) || maps.some(mapping => mapping.requirementType === '公開科目')) continue;
          schooling.earned += offering.credits;
        }
        return make('professional-law-schooling', '専門教育：スクーリング', schooling, 8, schooling.earned >= 8, undefined,
          '選択必修・選択のうち、2026年度正本 p.47 の＊印科目・他学部他学科公開科目を除く実修得スクーリング単位。4単位科目のスクーリング部分修得もここでは実修得分を数えます。');
      })(),
    ];
  }

  const requiredElectiveTargetValue = requiredElectiveTarget;
  const requiredElective = normal('選択必修');
  const elective = normal('選択');
  const professionalTotalTarget = professionalTotalCreditTarget(catalog, scopeId);
  const thesisCredits = thesisSelection === 'selected' ? thesisCreditsForDepartment(program.department) ?? 0 : 0;
  const professionalTotal = { ...requiredElective, earned: requiredElective.earned + elective.earned + (thesisStatus === 'earned' ? thesisCredits : 0),
    inProgress: requiredElective.inProgress + elective.inProgress + (thesisStatus === 'in_progress' ? thesisCredits : 0), planned: requiredElective.planned + elective.planned + (thesisStatus === 'planned' ? thesisCredits : 0) };
  const prefix = program.department === '経済学科' ? 'economics' : 'commerce';
  const totalReason = professionalTotalTarget === null
    ? '専門教育合計の公式な必要単位を安全に特定できません。'
    : baseReason;
  return [
    ...(requiredElectiveTargetValue === null ? [makeKnownUnknown(`professional-${prefix}-required-elective`, '専門教育：選択必修', requiredElective, undefined,
      '選択必修の公式な最低単位を安全に特定できません。', '選択必修の公式な最低単位を安全に特定できません。')] : [
      { ...make(`professional-${prefix}-required-elective`, '専門教育：選択必修', requiredElective, requiredElectiveTargetValue, requiredElective.earned >= requiredElectiveTargetValue), partialCourses: partialCourses('選択必修') },
    ]),
    { ...make(`professional-${prefix}-total`, '専門教育合計', professionalTotal, professionalTotalTarget,
      professionalTotalTarget !== null && professionalTotal.earned >= professionalTotalTarget, undefined,
      `選択必修 ${requiredElective.earned}単位 + 選択 ${catalogElectiveEarned()}単位${publicCourseBreakdown()}。選択必修の超過分も含め、各修得済み科目は専門教育合計に1回だけ算入します。卒業論文は選択科目として修得済みの場合に限り、この合計へ1回だけ算入します。`, totalReason),
      partialCourses: [...(partialCourses('選択必修') ?? []), ...(partialCourses('選択') ?? [])].sort((a, b) => a.label.localeCompare(b.label, 'ja')) },
  ];
}

function publicCourseCard(publicCourses: PublicCourse[], catalog: PlannerCatalog, scopeId: string): { cards: ProgressCard[]; progress: PublicCourseProgress | null } {
  const limit = publicCourseLimitFor(catalog, scopeId);
  if (!limit) return { cards: [], progress: null };
  const progress = evaluatePublicCourseLimit(publicCourses, limit);
  return { progress, cards: [{
    requirementId: `public-course-${scopeId}`,
    label: '他学部・他学科公開科目（算入上限）', ruleType: 'public_course_limit', status: 'satisfied',
    earned: progress.countedCredits, inProgress: progress.inProgressCredits, planned: progress.plannedCredits,
    target: limit.maxCredits, unit: 'credits', reason: null,
    publicCourse: {
      earnedCourses: progress.earnedCourses, countedCourses: progress.countedCourses, earnedCredits: progress.earnedCredits,
      countedCredits: progress.countedCredits, excludedCredits: progress.excludedCredits,
      limitCourses: limit.maxCourses, limitCredits: limit.maxCredits,
    },
    note: '達成すべき要件ではなく、卒業算入の上限です。修得済みのみ算入し、履修中・計画中は参考値です。',
  }] };
}

function referencePrerequisiteReason(profile: GraduationProfile, program: { department: string | null }, thesisSelection: ThesisSelection): string | null {
  const credits = profile.recognizedCredits as Partial<GraduationProfile['recognizedCredits']>;
  if (credits.general && credits.foreignLanguage && credits.physicalEducation && credits.professionalCourses && graduationProfileValidationError(profile)) return '認定単位の入力を確認してください。異常な認定値は全体参考進捗に算入しません。';
  if (profile.curriculumApplicability === 'unknown') return '適用課程が未確認のため、2026年度の必要単位を適用できません。';
  if (profile.curriculumApplicability === 'legacy_or_transition') return '旧課程・経過措置では2026年度の必要単位を適用しません。';
  if (profile.admissionType === 'unknown') return '入学区分が未入力のため、個別の認定単位を扱えません。';
  if (['transfer_second_year', 'transfer_third_year', 'other_transfer', 'hosei_internal_transfer'].includes(profile.admissionType) && !hasCreditBearingRecognition(profile.recognizedCredits)) return '編入学の認定単位合計または公式の個別認定結果が未入力です。0としては扱いません。';
  if (program.department === '法律学科' && thesisSelection === 'undecided') return '法学部の卒業論文の選択が未定のため、124/128単位を確定できません。';
  return null;
}

/** Recognition is an independent source.  It is overlaid once on common cards;
 * exemptions satisfy their requirement but deliberately contribute no earned credits. */
function applyRecognition(cards: ProgressCard[], profile: GraduationProfile): ProgressCard[] {
  const general = profile.recognizedCredits.general ?? { humanities: { mode: 'unknown' as const, credits: null }, social: { mode: 'unknown' as const, credits: null }, natural: { mode: 'unknown' as const, credits: null } };
  const replace = (source: ProgressCard[], id: string, fn: (card: ProgressCard) => ProgressCard) => source.map(card => card.requirementId === id ? fn(card) : card);
  let next = replace(cards, 'group-general', card => {
    const fields = ['humanities', 'social', 'natural'] as const;
    const recognitionMayApply = ['transfer_second_year', 'transfer_third_year', 'bachelor_admission', 'other_transfer', 'hosei_internal_transfer'].includes(profile.admissionType);
    const exempt = fields.every(key => general[key].mode === 'exempt');
    const credited = fields.reduce((sum, key) => sum + (general[key].mode === 'recognized' ? general[key].credits ?? 0 : 0), 0);
    // The 2026 guide permits this explicit official recognition only in the
    // general-education total; it must never satisfy a named field minimum.
    const openUniversity = exempt ? 0 : profile.recognizedCredits.openUniversityCredits ?? 0;
    const details = card.details?.map((detail, index) => {
      const row = general[fields[index]];
      const earned = row.mode === 'exempt' ? detail.target : (detail.earned ?? 0) + (row.mode === 'recognized' ? row.credits ?? 0 : 0);
      return recognitionMayApply && row.mode === 'unknown' && earned < detail.target ? { ...detail, earned: null, reason: '認定情報未確認' } : { ...detail, earned };
    });
    const completed = details?.every(detail => detail.earned !== null && detail.earned >= detail.target) && (card.earned ?? 0) + credited + openUniversity >= 36;
    const unknown = recognitionMayApply && !exempt && details?.some(detail => detail.earned === null);
    return { ...card, earned: exempt ? 0 : unknown ? null : Math.min(card.target ?? 36, (card.earned ?? 0) + credited + openUniversity), details,
      status: exempt || completed ? 'satisfied' : unknown ? 'unknown' : card.status,
      reason: unknown ? '一般教育の認定情報が未確認です。0単位認定とは扱いません。' : card.reason,
      note: `${card.note ?? ''}${exempt ? ' 学士入学等により一般教育は免除済み（修得単位には算入しません）。' : `${credited ? ' 公式認定単位を反映しています。' : ''}${openUniversity ? ` 放送大学認定 ${openUniversity}単位を一般教育（その他）に反映しています。` : ''}`}` };
  });
  next = replace(next, 'group-foreign', card => {
    const row = profile.recognizedCredits.foreignLanguage ?? { mode: 'unknown' as const, credits: null, language: 'unknown' as const, schoolingEquivalentCredits: null };
    if (row.mode === 'exempt') return { ...card, earned: 0, status: 'satisfied', note: `${card.note ?? ''} 免除済み（修得単位には算入しません）。` };
    if (row.mode === 'recognized' && row.credits === 4 && row.language !== 'unknown' && (row.schoolingEquivalentCredits ?? 0) >= 2) return { ...card, earned: 4, status: 'satisfied', note: `${card.note ?? ''} 公式認定の内訳を反映しています。` };
    if (row.mode === 'unknown' && profile.admissionType !== 'unknown' && profile.admissionType !== 'first_year' && card.status !== 'satisfied' && card.earned === 0 && card.inProgress === 0 && card.planned === 0) return { ...card, status: 'unknown', earned: null, reason: '認定情報未入力です。0単位認定とは扱いません。', note: `${card.note ?? ''} 外国語の認定結果を確認してください。` };
    if (row.mode === 'recognized' && row.credits === 4 && row.language === 'unknown') return { ...card, status: 'unknown', earned: null, reason: '同一言語要件未確認です。公式認定結果の言語を確認してください。' };
    if (row.mode === 'recognized' && row.credits === 4 && row.schoolingEquivalentCredits === null) return { ...card, status: 'unknown', earned: null, reason: 'スクーリング相当認定単位が未確認です。0単位とは扱いません。' };
    if (row.mode === 'recognized' && row.credits === 4 && (row.schoolingEquivalentCredits ?? 0) < 2) return { ...card, status: 'unsatisfied', earned: 4, reason: 'スクーリング相当認定単位が2単位未満です。' };
    return card;
  });
  next = replace(next, 'group-physical', card => {
    const row = profile.recognizedCredits.physicalEducation ?? { mode: 'unknown' as const, credits: null };
    if (row.mode === 'exempt') return { ...card, earned: 0, status: 'satisfied', note: `${card.note ?? ''} 免除済み（修得単位には算入しません）。` };
    if (row.mode === 'recognized' && row.credits === 2) return { ...card, earned: 2, status: 'satisfied', note: `${card.note ?? ''} 公式認定を反映しています。` };
    if (row.mode === 'unknown' && profile.admissionType !== 'unknown' && profile.admissionType !== 'first_year' && card.status !== 'satisfied' && card.earned === 0 && card.inProgress === 0 && card.planned === 0) return { ...card, status: 'unknown', earned: null, reason: '認定情報未入力です。0単位認定とは扱いません。', note: `${card.note ?? ''} 保健体育の認定結果を確認してください。` };
    return card;
  });
  return next;
}

/**
 * Uses the already-capped, mutually exclusive graduation buckets rather than
 * summing PlannerItem credits.  The cards contain the existing safeguards for
 * curriculum-credit completion, public-course caps, repeatables, and the
 * department-specific transfers.
 */
function countedOverallCredits(cards: ProgressCard[], department: string | null): number {
  const common = ['group-general', 'group-foreign', 'group-physical'];
  const commonCredits = common.reduce((sum, id) => sum + (cards.find(card => card.requirementId === id)?.earned ?? 0), 0);
  if (department === '法律学科') return commonCredits + (cards.find(card => card.requirementId === 'professional-law-total')?.earned ?? 0);
  if (department === '経済学科') return commonCredits + (cards.find(card => card.requirementId === 'professional-economics-total')?.earned ?? 0);
  if (department === '商業学科') return commonCredits + (cards.find(card => card.requirementId === 'professional-commerce-total')?.earned ?? 0);
  if (department === '日本文学科') return commonCredits + (cards.find(card => card.requirementId === 'professional-japanese-total')?.earned ?? 0);
  if (department === '地理学科') return commonCredits + (cards.find(card => card.requirementId === 'professional-geography-total')?.earned ?? 0);
  const professionalCredits = cards.filter(card => card.requirementId.startsWith('professional-')
    && !card.requirementId.endsWith('-schooling') && card.requirementId !== 'professional-law-total')
    .reduce((sum, card) => sum + (card.earned ?? 0), 0);
  const thesisCredits = cards.filter(card => card.requirementId.includes('thesis') || card.label === '卒業論文')
    .reduce((sum, card) => sum + (card.earned ?? 0), 0);
  return commonCredits + professionalCredits + thesisCredits;
}

/**
 * Count only completed, mapped schooling components.  A mixed imported row is
 * represented as correspondence by deriveImportedAchievements, so its aggregate
 * is never accidentally counted as schooling.  This is an actual-attendance
 * reference: unlike graduation buckets, a two-credit partial schooling is kept.
 */
function countedSchoolingCredits(items: PlannerItem[], offerings: Map<string, Offering>, eligibleMappings: (offering: Offering) => Mapping[], department: string | null): { credits: number; uncertain: boolean } {
  const byCourse = new Map<string, { curriculumCredits: number; earned: number; schooling: number }>();
  let uncertain = false;
  for (const item of items) {
    if (item.status !== 'earned') continue;
    const offering = offerings.get(item.offeringId);
    if (!offering || offering.resolutionStatus !== 'matched' || offering.credits === null) { uncertain = true; continue; }
    const mappings = eligibleMappings(offering).filter(mapping => mapping.curriculumCredits !== null);
    const distinct = new Map(mappings.map(mapping => [mapping.mappingId, mapping]));
    // A course that can be allocated to more than one curriculum row needs the
    // department allocator; leaving it out is safer than double counting it.
    if (distinct.size !== 1 || !offering.courseId || (department && repeatableRule(department, offering))) { uncertain = true; continue; }
    const mapping = [...distinct.values()][0];
    const entry = byCourse.get(offering.courseId) ?? { curriculumCredits: mapping.curriculumCredits!, earned: 0, schooling: 0 };
    if (entry.curriculumCredits !== mapping.curriculumCredits) { uncertain = true; continue; }
    entry.earned += offering.credits;
    if (offering.method === 'schooling') entry.schooling += offering.credits;
    byCourse.set(offering.courseId, entry);
  }
  return { credits: [...byCourse.values()].reduce((sum, entry) => sum + Math.min(entry.schooling, entry.earned, entry.curriculumCredits), 0), uncertain };
}

function referenceProgress(cards: ProgressCard[], calculationItems: PlannerItem[], offerings: Map<string, Offering>, eligibleMappings: (offering: Offering) => Mapping[], program: { department: string | null }, profile: GraduationProfile, thesisSelection: ThesisSelection): ReferenceProgress[] {
  const prerequisiteReason = referencePrerequisiteReason(profile, program, thesisSelection);
  const target = prerequisiteReason ? null : program.department === '法律学科' && thesisSelection === 'not_selected'
    ? 124 + (thesisCreditsForDepartment(program.department) ?? 0) : 124;
  const creditBearingRoute = profile.admissionType !== 'first_year' && profile.admissionType !== 'unknown' && profile.admissionType !== 'bachelor_admission';
  const detailedRecognized = recognizedCreditBreakdownTotal(profile.recognizedCredits);
  const unallocated = creditBearingRoute ? unallocatedRecognizedCredits(profile.recognizedCredits) : 0;
  // Detailed recognition already appears in the category/professional cards.
  // The legacy total may add only the explicitly unallocated remainder.
  const recognizedTotal = creditBearingRoute ? (profile.recognizedCredits.totalCredits ?? detailedRecognized) : 0;
  const overallEarned = countedOverallCredits(cards, program.department) + (unallocated ?? 0);
  const schooling = countedSchoolingCredits(calculationItems, offerings, eligibleMappings, program.department);
  const schoolingRecognized = profile.admissionType !== 'first_year' && profile.admissionType !== 'unknown' ? profile.recognizedCredits.schoolingEquivalentCredits : 0;
  const schoolingReason = prerequisiteReason ?? (profile.admissionType !== 'first_year' && profile.admissionType !== 'unknown' && schoolingRecognized === null
    ? '編入学の認定スクーリング相当単位が未入力です。0としては扱いません。'
    : schooling.uncertain ? '一部の修得済み科目はスクーリング算入先を一意に確認できないため、含めていません。' : null);
  const bachelor = profile.admissionType === 'bachelor_admission' && prerequisiteReason === null;
  const exemptionCredits = bachelor ? 42 : null;
  const make = (id: ReferenceProgress['id'], label: string, earned: number | null, referenceTarget: number | null, recognizedCredits: number | null, reason: string | null, exemptions: number | null = null): ReferenceProgress => ({
    id, label, earned, target: referenceTarget, recognizedCredits, exemptionCredits: exemptions, status: reason ? 'unknown' : 'partial', coverageStatus: reason ? 'unknown' : 'partial', reason,
    unknownReasonCategory: reason ? classifyUnknownReason(reason) : null, sourceRefs: sourcesForGraduationCard(id),
  });
  return [
    make('overall-reference-progress', bachelor ? '卒業対象単位（参考）' : '全体所要単位（参考）', prerequisiteReason ? null : overallEarned, bachelor && target !== null ? target - 42 : target, recognizedTotal, prerequisiteReason, exemptionCredits),
    make('schooling-reference-progress', 'スクーリング（参考）', prerequisiteReason || schoolingRecognized === null ? null : schooling.credits + schoolingRecognized, prerequisiteReason ? null : 30, schoolingRecognized, schoolingReason),
  ];
}

function thesisProgressCard(catalog: PlannerCatalog, scopeId: string, progress: ThesisProgress): ProgressCard[] {
  const program = catalog.programs.find(candidate => candidate.scopeId === scopeId);
  const policy = thesisPolicyForScope(catalog, scopeId);
  const credits = thesisCreditsForDepartment(program?.department ?? null);
  if (!program || !credits || policy === 'unknown') return [];
  if (policy === 'optional' && progress.selection === 'not_selected') return [{
    requirementId: `thesis-progress-${scopeId}`, label: '卒業論文（選択）', ruleType: 'thesis_progress', status: 'satisfied',
    earned: 0, inProgress: 0, planned: 0, target: credits, unit: 'credits', reason: null,
    note: '卒業論文を選択しない設定です。このカードの単位は卒業要件に要求せず、他の専門教育科目で必要単位を満たします。',
  }];
  const selected = policy === 'required' || progress.selection === 'selected';
  if (!selected) return [{
    requirementId: `thesis-progress-${scopeId}`, label: '卒業論文（選択）', ruleType: 'thesis_progress', status: 'unknown',
    earned: 0, inProgress: 0, planned: 0, target: credits, unit: 'credits', reason: '卒業論文を履修するか未定です。',
    note: '専門教育・全体所要単位の通常判定は継続します。',
  }];
  const earned = progress.status === 'earned' ? credits : 0;
  return [{
    requirementId: `thesis-progress-${scopeId}`, label: policy === 'required' ? '卒業論文（必修）' : '卒業論文（選択）', ruleType: 'thesis_progress',
    status: earned === credits ? 'satisfied' : 'unsatisfied', earned, inProgress: progress.status === 'in_progress' ? credits : 0,
    planned: progress.status === 'planned' ? credits : 0, target: credits, unit: 'credits', reason: null,
    note: '年度別の開講科目・mappingには依存しません。指導・提出手続の確認は、この単位進捗とは別です。',
  }];
}

/** p.68 is a faculty decision, never a two-credit automatic completion. */
function literaturePartialExceptionCard(items: PlannerItem[], catalog: PlannerCatalog, scopeId: string, offerings: Map<string, Offering>, eligibleMappings: (offering: Offering) => Mapping[], cards: ProgressCard[]): ProgressCard[] {
  const department = catalog.programs.find(program => program.scopeId === scopeId)?.department;
  if (!['日本文学科', '史学科', '地理学科'].includes(department ?? '')) return [];
  // This is intentionally a candidate only.  In particular, a partial must not
  // be silently converted into an ordinary two credits by the normal allocator.
  const partial = items.some(item => {
    if (item.status !== 'earned') return false;
    const offering = offerings.get(item.offeringId);
    if (offering?.method !== 'schooling' || offering.credits !== 2) return false;
    const mappings = eligibleMappings(offering).filter(mapping => mapping.scopeId === scopeId && mapping.category === '専門教育' && mapping.requirementType === '選択');
    return mappings.length > 0 && mappings.every(mapping => mapping.curriculumCredits === 4);
  });
  if (!partial) return [];
  const ids = department === '日本文学科'
    ? ['professional-required', 'professional-required-elective', 'professional-elective']
    : department === '史学科'
      ? ['professional-history-required', 'professional-history-schooling-required-elective', 'professional-history-elective']
      : ['professional-geography-required', 'professional-geography-schooling-required', 'professional-geography-required-elective', 'professional-geography-elective'];
  const requiredCards = ids.map(id => cards.find(card => card.requirementId === id));
  if (requiredCards.some(card => !card || card.earned === null || card.status === 'unknown')) return [];
  const thesis = cards.find(card => card.requirementId === `thesis-progress-${scopeId}`);
  if (!thesis || thesis.status !== 'satisfied' || thesis.earned === null) return [];

  // The grouped cards are the authoritative minima for Japanese literature and
  // geography. History's normal elective card has a 50-credit target, however,
  // so it must not be required here: the valid 80 + 2 pattern can have 48
  // completed elective credits plus the separate two-credit partial. Its field
  // details remain mandatory, and every other department must meet its minima.
  const minimaMet = department === '史学科'
    ? requiredCards[0]!.status === 'satisfied'
      && requiredCards[1]!.status === 'satisfied'
      && requiredCards[2]!.details?.every(detail => detail.earned !== null && detail.earned >= detail.target)
    : requiredCards.every(card => card!.status === 'satisfied');
  if (!minimaMet) return [];

  const professionalTotal = department === '史学科'
    ? requiredCards.reduce((sum, card) => sum + (card!.normalEarned ?? 0), 0)
    : cards.find(card => card.requirementId === (department === '日本文学科' ? 'professional-japanese-total' : 'professional-geography-total'))?.earned;
  // The partial curriculum row deliberately remains outside the normal
  // allocator. In particular, history has no professional-history-total card:
  // compose its mutually-exclusive buckets and the already-completed thesis.
  const total = professionalTotal === null || professionalTotal === undefined ? null
    : department === '史学科' ? professionalTotal + thesis.earned : professionalTotal;
  if (total !== 80) return [];
  return [{ requirementId: 'literature-professional-80-plus-partial-2', label: '文学部 80＋部分修得2単位の特例候補', ruleType: 'manual_review', status: 'unknown', earned: 80, inProgress: 0, planned: 0, target: 82, unit: 'credits', reason: '教授会判断が必要な特例候補です。Plannerは82単位達成とは判定しません。', note: '分野要件を含む正式な判定は大学へ確認してください。' }];
}

/** Individual rules and grouped cards never compose into a graduation decision. */
export function calculateGraduationProgress(items: PlannerItem[], catalog: PlannerCatalog, scopeId: string | null, publicCourses: PublicCourse[] = [], thesisSelection: ThesisSelection = 'undecided', importedStudyRecords: ImportedStudyRecord[] = [], importedCourseAchievements: ImportedCourseAchievement[] = [], profile: GraduationProfile = { admissionYear: null, currentStudyYear: null, admissionType: 'unknown', recognizedCredits: { totalCredits: null, schoolingEquivalentCredits: null, openUniversityCredits: null, general: { humanities: { mode: 'unknown', credits: null }, social: { mode: 'unknown', credits: null }, natural: { mode: 'unknown', credits: null } }, foreignLanguage: { mode: 'unknown', credits: null, language: 'unknown', schoolingEquivalentCredits: null }, physicalEducation: { mode: 'unknown', credits: null }, professionalCourses: [] }, curriculumApplicability: 'unknown' }, thesisProgress: ThesisProgress | null = null): GraduationProgress {
  if (catalog.metadata.graduationCheckComplete !== false) throw new Error('Incomplete graduation-check metadata is required.');
  if (scopeId === null || !catalog.programs.some(program => !program.isCommon && program.scopeId === scopeId)) {
    return {
      graduationCheckComplete: false, requirements: [], cards: [], evaluableCount: 0, unknownCount: 0, unknownReasons: [],
      coverageSummary: { supported: 0, partial: 0, unknown: 0 }, importedWarnings: [], importedContributionCount: 0, referenceProgress: [], historySchoolingDiagnostic: null,
    };
  }
  const catalogOfferings = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const currentThesis = thesisProgress ?? { selection: thesisSelection, status: 'not_started' as const };
  const currentSelection = thesisPolicyForScope(catalog, scopeId) === 'required' ? 'selected' : currentThesis.selection;
  const imported = deriveImportedAchievements(importedStudyRecords, catalogOfferings, items, importedCourseAchievements, catalog, scopeId);
  const identity = (offering: Offering | undefined) => offering?.courseId ? `course:${offering.courseId}` : offering ? `offering:${offering.id}` : null;
  const existingCourseIds = new Set([...items, ...imported.items].map(item => identity(catalogOfferings.get(item.offeringId))).filter((id): id is string => id !== null));
  const recognizedItems = (profile.recognizedCredits.professionalCourses ?? []).flatMap(course => {
    const offering = course.offeringId ? catalogOfferings.get(course.offeringId) : undefined;
    const key = identity(offering);
    if (!offering || !key || existingCourseIds.has(key) || offering.name === '卒業論文') return [];
    existingCourseIds.add(key);
    return [{ offeringId: offering.id, status: 'earned' as const, plannedYear: null, plannedTerm: null, studyYear: null, earnedOrder: null }];
  });
  const calculationItems = [...imported.plannerItems, ...imported.items, ...recognizedItems];
  const offerings = new Map([...catalog.offerings, ...imported.offerings].map(offering => [offering.id, offering]));
  const resolve = createMappingResolver(catalog);
  const commonScopes = new Set(catalog.programs.filter(program => program.isCommon).map(program => program.scopeId));
  const eligibleMappings = (offering: Offering) => resolve(offering).filter(mapping => mapping.scopeId === scopeId || commonScopes.has(mapping.scopeId));
  const hasUnresolvedEarned = calculationItems.some(item => item.status === 'earned'
    && offerings.get(item.offeringId)?.resolutionStatus === 'manual_review'
    && !(scopeId === HISTORY_SCOPE_ID && (isHistorySeminar(offerings.get(item.offeringId)) || isHistoricalSources(offerings.get(item.offeringId)))));
  const requirements = requirementsForScope(catalog, scopeId)
    .filter(requirement => !(requirement.status === 'structured'
      && REFERENCE_ONLY_REQUIREMENT_RULES.has(requirement.ruleId)))
    .flatMap(requirement => {
    if (requirement.status === 'structured' && requirement.ruleType === 'required_course' && requirement.target.course_name === '卒業論文') return [];
    if (requirement.status === 'unsupported') return [unknown(requirement, requirement.reason || '未対応の要件です')];
    const condition = thesisCondition(requirement, currentSelection);
    if (condition === 'inactive') return [];
    if (condition === 'undecided') return [unknown(requirement, '卒論有無が未定のため、必要単位を判定できません。')];
      return [evaluateStructured(withoutThesisCondition(requirement), calculationItems, offerings, eligibleMappings, hasUnresolvedEarned)];
    });
  const thesisCards = thesisProgressCard(catalog, scopeId, { ...currentThesis, selection: currentSelection });
  const publicCourse = publicCourseCard(publicCourses, catalog, scopeId);
  const professional = professionalCards(calculationItems, catalog, scopeId, offerings, eligibleMappings, hasUnresolvedEarned, publicCourse.progress?.countedCredits ?? 0, currentSelection, currentThesis.status);
  const cards = applyRecognition([
    ...groupedCards(calculationItems, offerings, eligibleMappings, hasUnresolvedEarned),
    ...professional,
    ...thesisCards,
    ...publicCourse.cards,
    ...(scopeId === HISTORY_SCOPE_ID ? historySeminarCards(calculationItems, offerings) : []),
    ...requirements.filter(row => row.status !== 'unknown' && row.ruleType !== 'max_credits'
      && !GROUP_RULES.has(catalog.requirements.find(rule => rule.id === row.requirementId)?.ruleId ?? '')
      && !professional.length),
  ], profile);
  cards.push(...literaturePartialExceptionCard(calculationItems, catalog, scopeId, offerings, eligibleMappings, cards));
  const program = catalog.programs.find(candidate => candidate.scopeId === scopeId)!;
  const coveredRequirements = requirements.map(row => withCoverage(row, catalog.requirements.find(rule => rule.id === row.requirementId)?.sourcePage));
  const thesisPage = thesisCreditsForDepartment(program.department) === 8 ? ({ '日本文学科': 49, '史学科': 52, '地理学科': 54 } as Record<string, number>)[program.department ?? ''] : ({ '法律学科': 46, '経済学科': 57, '商業学科': 59 } as Record<string, number>)[program.department ?? ''];
  const coveredCards = cards.map(card => withCoverage(card, card.ruleType === 'thesis_progress' ? thesisPage : catalog.requirements.find(rule => rule.id === card.requirementId)?.sourcePage));
  const reference = referenceProgress(coveredCards, calculationItems, offerings, eligibleMappings, program, profile, currentSelection);
  const reasons = new Map<string, { count: number; labels: string[] }>();
  for (const row of coveredRequirements.filter(row => row.status === 'unknown')) {
    const reason = row.reason ?? '自動判定できません';
    const summary = reasons.get(reason) ?? { count: 0, labels: [] };
    summary.count += 1;
    if (summary.labels.length < 3 && !summary.labels.includes(row.label)) summary.labels.push(row.label);
    reasons.set(reason, summary);
  }
  return {
    graduationCheckComplete: false,
    requirements: coveredRequirements,
    cards: coveredCards,
    evaluableCount: coveredRequirements.filter(row => row.status !== 'unknown').length,
    unknownCount: coveredRequirements.filter(row => row.status === 'unknown').length,
    unknownReasons: [...reasons].map(([reason, summary]) => ({ reason, ...summary })).sort((a, b) => b.count - a.count),
    coverageSummary: coveredCards.reduce<Record<CoverageStatus, number>>((summary, card) => {
      summary[card.coverageStatus ?? 'unknown'] += 1;
      return summary;
    }, { supported: 0, partial: 0, unknown: 0 }),
    importedWarnings: imported.warnings,
    importedContributionCount: imported.items.length,
    referenceProgress: reference,
    historySchoolingDiagnostic: scopeId === HISTORY_SCOPE_ID ? historySchoolingDiagnostic(calculationItems, offerings) : null,
  };
}
