import type {
  Mapping,
  Offering,
  PlannerCatalog,
  PlannerItem,
  PublicCourse,
  Requirement,
  StructuredRequirement,
  ThesisSelection,
} from './plannerCatalog';
import { createMappingResolver, requirementsForScope } from './plannerHelpers';
import { HISTORY_SCOPE_ID, historySeminarField, isHistorySeminar, validHistorySeminarOrders } from './historySeminar';
import { repeatableRule } from './repeatableRules';
import { evaluatePublicCourseLimit, publicCourseLimitFor, type PublicCourseProgress } from './publicCourseRules';
import { thesisPolicyForScope } from './thesisSelection';
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
};

export type GraduationProgress = {
  graduationCheckComplete: false;
  requirements: RequirementProgress[];
  cards: ProgressCard[];
  evaluableCount: number;
  unknownCount: number;
  /** One summary row per reason keeps procedure/mapping warnings from becoming a wall of cards. */
  unknownReasons: Array<{ reason: string; count: number; labels: string[] }>;
  importedWarnings: ImportedAchievementWarning[];
  importedContributionCount: number;
};

export type ProgressCard = RequirementProgress & {
  details?: Array<{ label: string; earned: number; inProgress: number; planned: number; target: number; schooling?: number; unit?: 'credits' | 'courses' }>;
  partialCourses?: Array<{ mappingId: string; label: string; earned: number; target: number }>;
  note?: string;
  repeatableCourses?: Array<{ label: string; earned: number; counted: number; limit: number; courses: number; limitCourses: number }>;
  publicCourse?: { earnedCourses: number; countedCourses: number; earnedCredits: number; countedCredits: number; excludedCredits: number; limitCourses: number; limitCredits: number };
};

const GROUP_RULES = new Set([
  'common_general_exact_credits', 'common_general_max_credits',
  'common_general_humanities_min_credits', 'common_general_social_min_credits', 'common_general_natural_min_credits',
  'common_physical_exact_credits', 'common_physical_max_credits', 'common_physical_choose_one',
  'common_foreign_choose_one', 'common_foreign_exact_credits', 'common_foreign_min_schooling_credits', 'common_foreign_max_credits',
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
    if (mappings.some(mapping => mapping.category === '一般教育')) {
      // 学習のしおり p.45: 基礎特講 is countable only twice / four credits.
      // Keep its excess out of the common-education total while still reporting it.
      if (offering.name === '基礎特講' || offering.name.startsWith('基礎特講（') || offering.name.startsWith('基礎特講［')) {
        add(basicLecture);
        if (item.status === 'earned') general.earned += Math.max(0, Math.min(4, basicLecture.earned) - Math.min(4, basicLecture.earned - offering.credits));
        else if (item.status === 'in_progress') general.inProgress += offering.credits;
        else if (item.status === 'planned') general.planned += offering.credits;
      } else add(general);
      for (const [field, totals] of fields) {
        if (mappings.some(mapping => mapping.category === '一般教育' && mapping.field === field)) add(totals);
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
  const detail = (label: string, totals: Totals, target: number, showSchooling = false) => ({
    label, earned: totals.earned, inProgress: totals.inProgress, planned: totals.planned, target,
    ...(showSchooling ? { schooling: totals.schooling } : {}),
  });
  const make = (id: string, label: string, totals: Totals, target: number, satisfied: boolean, details?: ProgressCard['details'], note?: string): ProgressCard => ({
    requirementId: id, label, ruleType: 'group', status: hasUnresolvedEarned ? 'unknown' : satisfied ? 'satisfied' : 'unsatisfied',
    earned: Math.min(target, totals.earned), inProgress: totals.inProgress, planned: totals.planned, target, unit: 'credits',
    reason: hasUnresolvedEarned ? '修得済みに対応関係を確認中の科目があります' : null, details, note,
  });
  const generalDetails = [...fields].map(([field, totals]) => detail(field, totals, 8));
  const generalCard = make('group-general', '一般教育', general, 36,
    general.earned >= 36 && [...fields.values()].every(totals => totals.earned >= 8), generalDetails,
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
  const required = creditsFor([1, 2]);
  const elective = creditsFor([3, 4]);
  const details = ordered.map(item => {
    const offering = offerings.get(item.offeringId)!;
    return { label: `史学演習${item.earnedOrder}（${historySeminarField(offering) ?? '分野未確認'}）`, earned: offering.credits ?? 0, inProgress: 0, planned: 0, target: 2 };
  });
  const card = (requirementId: string, label: string, earned: number, target: number): ProgressCard => ({
    requirementId, label, ruleType: 'history_seminar_sequence',
    status: orderKnown ? (earned >= target ? 'satisfied' : 'unsatisfied') : 'unknown',
    earned: orderKnown ? earned : null, inProgress: 0, planned: 0, target, unit: 'credits', reason,
    details, note: '史学演習1・2はスクーリング選択必修、3・4は選択。5回目以降は卒業所要単位に算入しません。分野別概説4単位の修得前提は参考情報であり、受講可否は判定しません。',
  });
  return [
    card('history-seminar-required-elective', '史学演習1・2（スクーリング選択必修）', required, 4),
    card('history-seminar-elective', '史学演習3・4（選択）', elective, 4),
  ];
}

type Totals = { earned: number; inProgress: number; planned: number; courses: Set<string> };
const emptyTotals = (): Totals => ({ earned: 0, inProgress: 0, planned: 0, courses: new Set() });

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

function addCurriculumTotals(totals: Totals, entry: CurriculumEntry) {
  totals.inProgress += entry.inProgress;
  totals.planned += entry.planned;
  // A mapping becomes one completed curriculum course only after all of its
  // official curriculum credits have been earned across its offerings.
  if (entry.earned >= entry.mapping.curriculumCredits!) {
    totals.earned += entry.mapping.curriculumCredits!;
    totals.courses.add(entry.mapping.mappingId);
  }
}

/**
 * The curriculum tables express a small number of connected buckets per department.
 * Keep their transfer rules here rather than showing every source rule as a card.
 */
function professionalCards(
  items: PlannerItem[], catalog: PlannerCatalog, scopeId: string, offerings: Map<string, Offering>,
  eligibleMappings: (offering: Offering) => Mapping[], hasUnresolvedEarned: boolean, publicCourseCredits: number, thesisSelection: ThesisSelection,
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
  const isNamed = (offering: Offering, name: string) => offering.name === name
    || offering.name.startsWith(`${name}（`) || offering.name.startsWith(`${name}［`) || offering.name.startsWith(`${name}[`);

  for (const item of items) {
    const offering = offerings.get(item.offeringId);
    if (!offering || offering.resolutionStatus !== 'matched' || offering.credits === null) continue;
    // A required thesis is tracked by its own 8-credit requirement card. Do not
    // let a future thesis offering also inflate a professional-category bucket.
    if (thesisPolicyForScope(catalog, scopeId) === 'required' && offering.name === '卒業論文') continue;
    // History seminars are allocated by the learner's confirmed completion order below.
    if (program.department === '史学科' && isHistorySeminar(offering)) continue;
    if (program.department === '史学科' && ['日本史概説', '東洋史概説', '西洋史概説'].some(name => isNamed(offering, name))) {
      specialRows.push({ kind: 'history-overview', item, offering });
      continue;
    }
    if (program.department === '地理学科') {
      const kind = isNamed(offering, '現地研究') ? 'field-study'
        : isNamed(offering, '地誌学特講') ? 'chorography'
          : isNamed(offering, '人文地理学演習') ? 'human-seminar'
            : isNamed(offering, '自然地理学演習') ? 'natural-seminar'
              : isNamed(offering, '人文地理学特講') || isNamed(offering, '自然地理学特講') ? 'geography-lecture' : null;
      if (kind) {
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
    for (const status of ['earned', 'in_progress', 'planned'] as const) {
      const used = allocations.map(() => 0);
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
    for (const name of ['日本史概説', '東洋史概説', '西洋史概説']) {
      const rows = specialRows.filter(row => row.kind === 'history-overview' && isNamed(row.offering, name));
      const schooling = rows.filter(row => row.offering.method === 'schooling');
      const other = rows.filter(row => row.offering.method !== 'schooling');
      distribute(schooling, [['スクーリング選択必修', 2], ['必修', Infinity]]);
      distribute(other, [['必修', Infinity]]);
    }
  }
  if (program.department === '地理学科') {
    // 学習のしおり p.55 d/i. The named destination courses in the table are
    // graduation buckets, not separate offerings to add alongside these credits.
    distribute(specialRows.filter(row => row.kind === 'field-study'), [['スクーリング必修', 2], ['選択', 2]]);
    distribute(specialRows.filter(row => row.kind === 'chorography'), [['選択必修:地誌・その他の分野', 2], ['選択', Infinity]]);
    distribute(specialRows.filter(row => row.kind === 'human-seminar'), [['スクーリング必修', 2], ['選択必修:人文地理の分野', 2], ['選択', Infinity]]);
    distribute(specialRows.filter(row => row.kind === 'natural-seminar'), [['スクーリング必修', 2], ['選択必修:自然地理の分野', 2], ['選択', Infinity]]);
    distribute(specialRows.filter(row => row.kind === 'geography-lecture'), [['選択', 4]]);
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
    earned: reason ? null : target === null ? totals.earned : Math.min(target, totals.earned),
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
      && entry.earned > 0 && entry.earned < entry.mapping.curriculumCredits!)
    .map(entry => ({
      mappingId: entry.mapping.mappingId,
      label: entry.label,
      earned: entry.earned,
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
    return [
      { ...make('professional-required', '専門教育：必修', required, 20, required.earned >= 20), partialCourses: partialCourses('必修') },
      { ...make('professional-required-elective', '専門教育：選択必修', requiredElective, requiredElectiveTargetValue, requiredElective.earned >= requiredElectiveTargetValue), partialCourses: partialCourses('選択必修') },
      { ...make('professional-elective', '専門教育：選択', elective, 24, elective.earned >= 24, undefined,
        `純粋な選択 ${catalogElectiveEarned()}単位 + 選択必修超過 ${overflow(requiredElective, threshold)}単位${publicCourseBreakdown()}。超過分は選択必修の達成値には重ねて算入しません。`, overflowRuleReason), partialCourses: partialCourses('選択') },
    ];
  }

  if (program.department === '史学科') {
    const seminars = items.filter(item => item.status === 'earned' && isHistorySeminar(offerings.get(item.offeringId)));
    const ordered = seminars.filter(item => item.earnedOrder !== null);
    const orderKnown = validHistorySeminarOrders(items, offerings) && (ordered.length === 4 || seminars.every(item => item.earnedOrder !== null));
    const orderReason = orderKnown ? baseReason : '修得済み史学演習の修得順が未確定です。公式の1〜4を順に記録してください。';
    for (const item of ordered) {
      const offering = offerings.get(item.offeringId)!;
      const target = item.earnedOrder! <= 2 ? 'スクーリング選択必修' : '選択';
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
        undefined, '史学演習1・2はこの枠へ算入します。', orderReason), partialCourses: partialCourses('スクーリング選択必修') },
      { ...make('professional-history-elective', '専門教育：選択', elective, 50, elective.earned >= 50 && fieldMet,
        fields.map(field => detail(`${field.label}から1科目以上`, field.totals, 1, 'courses')),
        '史学演習3・4はこの枠へ算入します。50単位に加え、日本・東洋・西洋史から各1科目が必要です。', orderReason), partialCourses: partialCourses('選択') },
    ];
  }

  if (program.department === '地理学科') {
    const required = normal('必修'), schooling = normal('スクーリング必修'), requiredElective = normal('選択必修');
    const requiredElectiveTargetValue = requiredElectiveTarget ?? 36;
    const threshold = overflowRule?.threshold ?? 0;
    const elective = withOverflow(normal('選択'), requiredElective, threshold);
    const human = normal('選択必修:人文地理の分野'), natural = normal('選択必修:自然地理の分野'), regional = normal('選択必修:地誌・その他の分野');
    const fieldsMet = human.earned >= 8 && human.courses.size >= 2 && natural.earned >= 8 && natural.courses.size >= 2 && regional.earned >= 16;
    const specialEarned = (kind: string) => specialRows.filter(row => row.kind === kind && row.item.status === 'earned')
      .reduce((sum, row) => sum + row.offering.credits!, 0);
    const fieldStudyEarned = specialEarned('field-study');
    const geographyLectureEarned = specialEarned('geography-lecture');
    return [
      { ...make('professional-geography-required', '専門教育：必修', required, 12, required.earned >= 12), partialCourses: partialCourses('必修') },
      { ...make('professional-geography-schooling-required', '専門教育：スクーリング必修', schooling, 6, schooling.earned >= 6), partialCourses: partialCourses('スクーリング必修') },
      { ...make('professional-geography-required-elective', '専門教育：選択必修', requiredElective, requiredElectiveTargetValue, requiredElective.earned >= requiredElectiveTargetValue && fieldsMet,
        [detail('人文地理：2科目・8単位以上', human, 8), detail('自然地理：2科目・8単位以上', natural, 8), detail('地誌・その他：16単位以上', regional, 16)],
        '人文・自然はそれぞれ科目数も満たす必要があります。2013年度以前の救済措置は自動判定しません。'), partialCourses: partialCourses('選択必修') },
      { ...make('professional-geography-elective', '専門教育：選択', elective, 12, elective.earned >= 12, undefined,
        `純粋な選択 ${catalogElectiveEarned()}単位 + 選択必修超過 ${overflow(requiredElective, threshold)}単位${publicCourseBreakdown()}。現地研究は必修2単位＋選択2単位まで${fieldStudyEarned > 4 ? `（超過${fieldStudyEarned - 4}単位は修得済みだが卒業算入外）` : ''}。人文・自然地理学特講は合算4単位まで${geographyLectureEarned > 4 ? `（超過${geographyLectureEarned - 4}単位は修得済みだが卒業算入外）` : ''}。`, overflowRuleReason), partialCourses: partialCourses('選択') },
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
    const overflowElective = withOverflow(normal('選択'), requiredElective, threshold);
    const elective = { ...overflowElective, earned: overflowElective.earned + permittedPartial };
    const thesisValue = (ruleId: string) => catalog.requirements.find((rule): rule is StructuredRequirement =>
      rule.status === 'structured' && rule.scopeId === scopeId && rule.ruleId === ruleId)?.value ?? null;
    const selected = thesisSelection === 'selected';
    const electiveTarget = thesisSelection === 'undecided' ? null : thesisValue(selected ? 'law_elective_with_thesis_min_credits' : 'law_elective_without_thesis_min_credits');
    const totalTarget = thesisSelection === 'undecided' ? null : thesisValue(selected ? 'law_total_with_thesis_min_credits' : 'law_total_without_thesis_min_credits');
    const total = { ...requiredElective, earned: requiredElective.earned + normal('選択').earned + permittedPartial };
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
      make('professional-law-schooling', '専門教育：スクーリング', emptyTotals(), 8, false, undefined,
        '＊印以外のみを数える必要があります。現行offeringには＊印を識別するデータがないため自動判定しません。',
        '＊印除外と4単位科目の部分修得例外を安全に識別できません。'),
    ];
  }

  const threshold = overflowRule?.threshold ?? 0;
  const requiredElectiveTargetValue = requiredElectiveTarget ?? threshold;
  const requiredElective = normal('選択必修');
  const elective = withOverflow(normal('選択'), requiredElective, threshold);
  return [
    { ...make(`professional-${program.department === '経済学科' ? 'economics' : 'commerce'}-required-elective`, '専門教育：選択必修', requiredElective, requiredElectiveTargetValue, requiredElective.earned >= requiredElectiveTargetValue), partialCourses: partialCourses('選択必修') },
    { ...makeKnownUnknown(`professional-${program.department === '経済学科' ? 'economics' : 'commerce'}-elective`, '専門教育：選択（卒業算入見込み）', elective, undefined,
        `純粋な選択 ${catalogElectiveEarned()}単位 + 選択必修超過 ${overflow(requiredElective, threshold)}単位${publicCourseBreakdown()}。専門教育82単位には卒業論文を含むため、ここでは達成判定しません。`,
      overflowRule === null ? (overflowRuleReason ?? '選択必修超過分の公式ルールを確認できません。') : '卒業論文を含む選択必要量の内訳をPlannerStateで安全に判定できません。'), partialCourses: partialCourses('選択') },
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

/** Individual rules and grouped cards never compose into a graduation decision. */
export function calculateGraduationProgress(items: PlannerItem[], catalog: PlannerCatalog, scopeId: string | null, publicCourses: PublicCourse[] = [], thesisSelection: ThesisSelection = 'undecided', importedStudyRecords: ImportedStudyRecord[] = [], importedCourseAchievements: ImportedCourseAchievement[] = []): GraduationProgress {
  if (catalog.metadata.graduationCheckComplete !== false) throw new Error('Incomplete graduation-check metadata is required.');
  if (scopeId === null || !catalog.programs.some(program => !program.isCommon && program.scopeId === scopeId)) {
    return { graduationCheckComplete: false, requirements: [], cards: [], evaluableCount: 0, unknownCount: 0, unknownReasons: [], importedWarnings: [], importedContributionCount: 0 };
  }
  const catalogOfferings = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const imported = deriveImportedAchievements(importedStudyRecords, catalogOfferings, items, importedCourseAchievements);
  const calculationItems = [...items, ...imported.items];
  const offerings = new Map([...catalog.offerings, ...imported.offerings].map(offering => [offering.id, offering]));
  const resolve = createMappingResolver(catalog);
  const commonScopes = new Set(catalog.programs.filter(program => program.isCommon).map(program => program.scopeId));
  const eligibleMappings = (offering: Offering) => resolve(offering).filter(mapping => mapping.scopeId === scopeId || commonScopes.has(mapping.scopeId));
  const hasUnresolvedEarned = calculationItems.some(item => item.status === 'earned'
    && offerings.get(item.offeringId)?.resolutionStatus === 'manual_review'
    && !(scopeId === HISTORY_SCOPE_ID && isHistorySeminar(offerings.get(item.offeringId))));
  const requirements = requirementsForScope(catalog, scopeId).flatMap(requirement => {
    if (requirement.status === 'unsupported') return [unknown(requirement, requirement.reason || '未対応の要件です')];
    const condition = thesisCondition(requirement, thesisSelection);
    if (condition === 'inactive') return [];
    if (condition === 'undecided') return [unknown(requirement, '卒論有無が未定のため、必要単位を判定できません。')];
    return [evaluateStructured(withoutThesisCondition(requirement), calculationItems, offerings, eligibleMappings, hasUnresolvedEarned)];
  });
  const requiredThesisCards = thesisPolicyForScope(catalog, scopeId) !== 'required' ? [] : requirements
    .filter(row => {
      const source = catalog.requirements.find(requirement => requirement.id === row.requirementId);
      return source?.status === 'structured' && source.ruleType === 'required_course' && source.target.course_name === '卒業論文';
    })
    .map(row => ({ ...row, note: row.status === 'unknown'
      ? '2026年度の開講snapshotに卒業論文の対応科目・mappingがないため、単位数は表示しつつ修得進捗は判定保留です。'
      : '卒業論文の単位のみを追跡します。専門教育の区分別カードには重ねて算入しません。' }));
  const publicCourse = publicCourseCard(publicCourses, catalog, scopeId);
  const professional = professionalCards(calculationItems, catalog, scopeId, offerings, eligibleMappings, hasUnresolvedEarned, publicCourse.progress?.countedCredits ?? 0, thesisSelection);
  const cards = [
    ...groupedCards(calculationItems, offerings, eligibleMappings, hasUnresolvedEarned),
    ...professional,
    ...requiredThesisCards,
    ...publicCourse.cards,
    ...(scopeId === HISTORY_SCOPE_ID ? historySeminarCards(calculationItems, offerings) : []),
    ...requirements.filter(row => row.status !== 'unknown' && row.ruleType !== 'max_credits'
      && !GROUP_RULES.has(catalog.requirements.find(rule => rule.id === row.requirementId)?.ruleId ?? '')
      && !professional.length),
  ];
  const reasons = new Map<string, { count: number; labels: string[] }>();
  for (const row of requirements.filter(row => row.status === 'unknown')) {
    const reason = row.reason ?? '自動判定できません';
    const summary = reasons.get(reason) ?? { count: 0, labels: [] };
    summary.count += 1;
    if (summary.labels.length < 3 && !summary.labels.includes(row.label)) summary.labels.push(row.label);
    reasons.set(reason, summary);
  }
  return {
    graduationCheckComplete: false,
    requirements,
    cards,
    evaluableCount: requirements.filter(row => row.status !== 'unknown').length,
    unknownCount: requirements.filter(row => row.status === 'unknown').length,
    unknownReasons: [...reasons].map(([reason, summary]) => ({ reason, ...summary })).sort((a, b) => b.count - a.count),
    importedWarnings: imported.warnings,
    importedContributionCount: imported.items.length,
  };
}
