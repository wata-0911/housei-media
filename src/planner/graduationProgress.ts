import type {
  Mapping,
  Offering,
  PlannerCatalog,
  PlannerItem,
  Requirement,
  StructuredRequirement,
} from './plannerCatalog';
import { createMappingResolver, requirementsForScope } from './plannerHelpers';
import { HISTORY_SCOPE_ID, historySeminarField, isHistorySeminar, validHistorySeminarOrders } from './historySeminar';

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
  unknownReasons: Array<{ reason: string; count: number }>;
};

export type ProgressCard = RequirementProgress & {
  details?: Array<{ label: string; earned: number; inProgress: number; planned: number; target: number; schooling?: number }>;
  note?: string;
};

const GROUP_RULES = new Set([
  'common_general_exact_credits', 'common_general_max_credits',
  'common_general_humanities_min_credits', 'common_general_social_min_credits', 'common_general_natural_min_credits',
  'common_physical_exact_credits', 'common_physical_max_credits', 'common_physical_choose_one',
  'common_foreign_choose_one', 'common_foreign_exact_credits', 'common_foreign_min_schooling_credits', 'common_foreign_max_credits',
]);

const CONDITION_ALLOWLIST: Partial<Record<StructuredRequirement['ruleType'], string[][]>> = {
  min_credits: [[], ['full_course_credits_required']],
  max_credits: [[], ['max_enrollments']],
  exact_credits: [[]],
  min_courses: [[]],
  min_schooling_credits: [[]],
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
    target: requirement.value, unit: null, reason,
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
    return mappings.some(mapping => mappingMatches(mapping, requirement)
      && (targetMappingIds === null || targetMappingIds.has(mapping.mappingId))) ? [{ item, offering }] : [];
  });

  if (hasUnresolvedEarned) return unknown(requirement, '修得済みに対応関係を確認中の科目があります');
  if (matched.some(({ offering }) => offering.credits === null)) return unknown(requirement, '対象科目に単位数不明の開講があります');

  const total = (status: PlannerItem['status']) => {
    const rows = matched.filter(row => row.item.status === status);
    if (unit === 'courses') return new Set(rows.map(row => row.offering.id)).size;
    return rows.reduce((sum, row) => sum + row.offering.credits!, 0);
  };
  const earned = total('earned');
  const inProgress = total('in_progress');
  const planned = total('planned');
  return {
    requirementId: requirement.id,
    label: requirementLabel(requirement),
    ruleType: requirement.ruleType,
    status: evaluateStatus(requirement.ruleType, earned, requirement.value),
    earned, inProgress, planned, target: requirement.value, unit, reason: null,
  };
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
      else totals.planned += offering.credits!;
    };
    if (mappings.some(mapping => mapping.category === '一般教育')) {
      add(general);
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
    '36単位のうち人文・社会・自然を各8単位以上。算入上限36単位');
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

/** Individual rules and grouped cards never compose into a graduation decision. */
export function calculateGraduationProgress(items: PlannerItem[], catalog: PlannerCatalog, scopeId: string | null): GraduationProgress {
  if (catalog.metadata.graduationCheckComplete !== false) throw new Error('Incomplete graduation-check metadata is required.');
  if (scopeId === null || !catalog.programs.some(program => !program.isCommon && program.scopeId === scopeId)) {
    return { graduationCheckComplete: false, requirements: [], cards: [], evaluableCount: 0, unknownCount: 0, unknownReasons: [] };
  }
  const offerings = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const resolve = createMappingResolver(catalog);
  const commonScopes = new Set(catalog.programs.filter(program => program.isCommon).map(program => program.scopeId));
  const eligibleMappings = (offering: Offering) => resolve(offering).filter(mapping => mapping.scopeId === scopeId || commonScopes.has(mapping.scopeId));
  const hasUnresolvedEarned = items.some(item => item.status === 'earned'
    && offerings.get(item.offeringId)?.resolutionStatus === 'manual_review'
    && !(scopeId === HISTORY_SCOPE_ID && isHistorySeminar(offerings.get(item.offeringId))));
  const requirements = requirementsForScope(catalog, scopeId).map(requirement =>
    requirement.status === 'unsupported'
      ? unknown(requirement, requirement.reason || '未対応の要件です')
      : evaluateStructured(requirement, items, offerings, eligibleMappings, hasUnresolvedEarned));
  const cards = [
    ...groupedCards(items, offerings, eligibleMappings, hasUnresolvedEarned),
    ...(scopeId === HISTORY_SCOPE_ID ? historySeminarCards(items, offerings) : []),
    ...requirements.filter(row => row.status !== 'unknown' && row.ruleType !== 'max_credits'
      && !GROUP_RULES.has(catalog.requirements.find(rule => rule.id === row.requirementId)?.ruleId ?? '')),
  ];
  const reasons = new Map<string, number>();
  for (const row of requirements.filter(row => row.status === 'unknown')) {
    const reason = row.reason ?? '自動判定できません';
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return {
    graduationCheckComplete: false,
    requirements,
    cards,
    evaluableCount: requirements.filter(row => row.status !== 'unknown').length,
    unknownCount: requirements.filter(row => row.status === 'unknown').length,
    unknownReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}
