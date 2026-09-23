import type {
  Mapping,
  Offering,
  PlannerCatalog,
  PlannerItem,
  Requirement,
  StructuredRequirement,
} from './plannerCatalog';
import { createMappingResolver, requirementsForScope } from './plannerHelpers';

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
  evaluableCount: number;
  unknownCount: number;
  unknownReasons: Array<{ reason: string; count: number }>;
};

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

/** Individual rules stay independent; this never composes them into a graduation decision. */
export function calculateGraduationProgress(items: PlannerItem[], catalog: PlannerCatalog, scopeId: string | null): GraduationProgress {
  if (catalog.metadata.graduationCheckComplete !== false) throw new Error('Incomplete graduation-check metadata is required.');
  if (scopeId === null || !catalog.programs.some(program => !program.isCommon && program.scopeId === scopeId)) {
    return { graduationCheckComplete: false, requirements: [], evaluableCount: 0, unknownCount: 0, unknownReasons: [] };
  }
  const offerings = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const resolve = createMappingResolver(catalog);
  const commonScopes = new Set(catalog.programs.filter(program => program.isCommon).map(program => program.scopeId));
  const eligibleMappings = (offering: Offering) => resolve(offering).filter(mapping => mapping.scopeId === scopeId || commonScopes.has(mapping.scopeId));
  const hasUnresolvedEarned = items.some(item => item.status === 'earned' && offerings.get(item.offeringId)?.resolutionStatus === 'manual_review');
  const requirements = requirementsForScope(catalog, scopeId).map(requirement =>
    requirement.status === 'unsupported'
      ? unknown(requirement, requirement.reason || '未対応の要件です')
      : evaluateStructured(requirement, items, offerings, eligibleMappings, hasUnresolvedEarned));
  const reasons = new Map<string, number>();
  for (const row of requirements.filter(row => row.status === 'unknown')) {
    const reason = row.reason ?? '自動判定できません';
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return {
    graduationCheckComplete: false,
    requirements,
    evaluableCount: requirements.filter(row => row.status !== 'unknown').length,
    unknownCount: requirements.filter(row => row.status === 'unknown').length,
    unknownReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}
