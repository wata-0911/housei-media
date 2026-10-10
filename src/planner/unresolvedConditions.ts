import type { GraduationProgress, RequirementProgress } from './graduationProgress';
import type { GraduationProfile, PlannerCatalog, Requirement } from './plannerCatalog';
import type { ImportedCourseAchievement } from './gradeImportApply';
import type { GraduationSourceRef } from './graduationSources';

export type ConditionTarget = { id: string; label: string; reason: string; sourceRefs: GraduationSourceRef[] };
export type UnresolvedCondition = {
  id: string;
  owner: 'learner' | 'university' | 'developer';
  label: string;
  action: string;
  destination?: 'profile' | 'plan' | 'imports';
  targets: ConditionTarget[];
};
export type ConditionContext = { catalog: PlannerCatalog; scopeId: string | null; profile: GraduationProfile; importedRows: ImportedCourseAchievement[] };
export type ConditionProjection = {
  learner: UnresolvedCondition[];
  automatic: UnresolvedCondition[];
  delegated: Array<{ requirementId: string; cardId: string; label: string; reason: string }>;
  excluded: Array<{ requirementId: string; reason: string }>;
};

// scopeId is null on unsupported catalog rows. Only these audited scope labels
// may narrow their display; unknown/future labels remain visible (H45).
const scopeLabels: Record<string, [string, string | null]> = {
  law: ['法律学科', null], history: ['史学科', null], geography: ['地理学科', null],
  economics: ['経済学科', null], commerce: ['商業学科', null],
  japanese_language: ['日本文学科', '言語コース'], japanese_literature: ['日本文学科', '文学コース'],
  japanese_performance: ['日本文学科', '芸能文化コース'],
};

// These exact catalog rules are already presented by the named calculator.
// This is display ownership, NEVER evidence to change a requirement's status.
const cardOwners: Record<string, string> = {
  common_foreign_choose_one: 'group-foreign', common_foreign_exact_credits: 'group-foreign',
  common_foreign_max_credits: 'group-foreign', common_foreign_min_schooling_credits: 'group-foreign',
  common_natural_per_subject_kind_max_credits: 'group-general',
  common_basic_lecture_max_credits: 'group-general',
  law_professional_min_schooling_credits: 'professional-law-schooling',
  law_required_elective_to_elective_overflow_credit_transfer: 'professional-law-elective',
  japanese_language_required_elective_to_elective_overflow_credit_transfer: 'professional-elective',
  japanese_literature_required_elective_to_elective_overflow_credit_transfer: 'professional-elective',
  japanese_performance_required_elective_to_elective_overflow_credit_transfer: 'professional-elective',
  geography_required_elective_to_elective_overflow_credit_transfer: 'professional-geography-elective',
  economics_required_elective_to_elective_overflow_credit_transfer: 'professional-economics-total',
  commerce_required_elective_to_elective_overflow_credit_transfer: 'professional-commerce-total',
};
const lectureRuleIds = new Set(Object.keys(scopeLabels).map(scope => `${scope}_general_lecture_max_credits`));
const publicRuleIds = new Set(Object.keys(scopeLabels).map(scope => `${scope}_open_courses_max_credits`));
const legacyRuleIds = new Set(['common_legacy_rules_external', 'common_natural_legacy_reenrollment',
  ...Object.keys(scopeLabels).map(scope => `${scope}_legacy_rules_external`),
  'geography_legacy_regional_transfer', 'geography_legacy_fieldwork']);

// Exact producer messages are intentionally allowlisted. Category regexes in
// graduationSources mix missing input with implementation gaps and must not
// decide who can resolve a hold. Unrecognized text fails closed to developer.
const inputReasons: Array<{ reason: string; key: string; label: string; action: string; destination: 'profile' | 'plan' }> = [
  ...['卒論有無が未定のため、必要単位を判定できません。', '卒業論文を履修するか未定です。', '法学部の卒業論文の選択が未定のため、124/128単位を確定できません。'].map(reason => ({ reason, key: 'thesis-selection', label: '卒業論文を履修するか選択してください', action: 'プロフィールの「卒業論文」で選択してください。', destination: 'profile' as const })),
  { reason: '入学区分が未入力のため、個別の認定単位を扱えません。', key: 'admission', label: '入学区分を選択してください', action: 'プロフィールの「入学区分」で選択してください。', destination: 'profile' },
  { reason: '適用課程が未確認のため、2026年度の必要単位を適用できません。', key: 'curriculum', label: '適用課程を確認してください', action: '公式資料で適用課程を確認し、プロフィールに記録してください。不明な場合は大学へ確認してください。', destination: 'profile' },
  { reason: '一般教育の認定情報が未確認です。0単位認定とは扱いません。', key: 'general-recognition', label: '一般教育の認定内訳を確認してください', action: 'プロフィールの「一般教育」に公式認定結果を入力してください。', destination: 'profile' },
  { reason: '編入学の認定単位合計または公式の個別認定結果が未入力です。0としては扱いません。', key: 'recognition-total', label: '編入学の認定結果を入力してください', action: 'プロフィールの認定単位に公式認定結果を入力してください。', destination: 'profile' },
  { reason: '編入学の認定スクーリング相当単位が未入力です。0としては扱いません。', key: 'recognized-schooling', label: '認定スクーリング相当単位を確認してください', action: 'プロフィールの「スクーリング相当」に公式認定結果を入力してください。', destination: 'profile' },
  { reason: '同一言語要件未確認です。公式認定結果の言語を確認してください。', key: 'recognized-language', label: '外国語認定の言語を確認してください', action: 'プロフィールの「外国語」に公式認定結果の言語を入力してください。', destination: 'profile' },
  { reason: 'スクーリング相当認定単位が未確認です。0単位とは扱いません。', key: 'foreign-schooling', label: '外国語認定のスクーリング相当を確認してください', action: 'プロフィールの「外国語認定のうちスクーリング相当」に入力してください。', destination: 'profile' },
  { reason: '認定単位の入力を確認してください。異常な認定値は全体参考進捗に算入しません。', key: 'recognition-invalid', label: '認定単位の入力を確認してください', action: 'プロフィールの入力エラーと公式認定結果を照合してください。', destination: 'profile' },
  { reason: '修得済み史学演習の修得順が未確定です。公式の1〜4を順に記録してください。', key: 'history-order', label: '史学演習の修得順を記録してください', action: '年間履修計画の「履修・修得一覧」で史学演習の修得順を記録してください。', destination: 'plan' },
];

function ruleLabel(rule: Requirement | undefined, row: RequirementProgress) {
  if (!rule || rule.status !== 'unsupported') return row.label;
  const subject = scopeLabels[rule.scopeLabel];
  const scope = subject ? subject.filter(Boolean).join('・') : rule.scopeLabel === 'common' ? '共通課程' : rule.scopeLabel;
  const suffix = rule.ruleId.replace(`${rule.scopeLabel}_`, '');
  const names: Record<string, string> = {
    legacy_rules_external: '旧課程・経過措置', course_credit_completion: '科目の全単位修得・例外',
    open_course_individual_limits: '公開科目の個別開講上限', calligraphy_methods: '書道実技の課題・期限',
    foreign_reenrollment: '外国語の再履修制限', natural_legacy_reenrollment: '自然科学の旧新課程科目',
    already_fulfilled: '既修得科目の算入除外', partial_course_exception: '部分修得の特例',
    overview_exam: '概説の試験・前提条件', overview_allocation: '概説の配分', seminar_prerequisite: '史学演習の履修前提',
    fifth_schooling_course: 'スクーリング5科目と演習の配分', seminar_three_stage_transfer: '演習の段階配分',
    legacy_regional_transfer: '旧地誌の配分', legacy_fieldwork: '旧現地研究の配分',
  };
  return `${scope}：${names[suffix] ?? rule.ruleId}`;
}

/** Read-only UI projection. Engine requirements/cards/coverage remain the audit authority. */
export function projectUnresolvedConditions(progress: GraduationProgress, context?: ConditionContext): ConditionProjection {
  const result: ConditionProjection = { learner: [], automatic: [], delegated: [], excluded: [] };
  const groups = new Map<string, UnresolvedCondition>();
  const add = (id: string, owner: UnresolvedCondition['owner'], label: string, action: string, target: ConditionTarget, destination?: UnresolvedCondition['destination']) => {
    const entry = groups.get(id) ?? { id, owner, label, action, targets: [], destination };
    if (!entry.targets.some(t => t.id === target.id)) entry.targets.push(target);
    groups.set(id, entry);
  };
  const program = context?.catalog.programs.find(p => p.scopeId === context.scopeId);
  const rules = new Map(context?.catalog.requirements.map(r => [r.id, r]) ?? []);
  const consume = (row: RequirementProgress, kind: 'requirement' | 'card' | 'reference') => {
    if (row.status !== 'unknown') return;
    const rule = kind === 'requirement' ? rules.get(row.requirementId) : undefined;
    const scope = rule?.status === 'unsupported' ? scopeLabels[rule.scopeLabel] : undefined;
    if (scope && program && (scope[0] !== program.department || scope[1] !== program.course)) {
      result.excluded.push({ requirementId: row.requirementId, reason: '公式カタログのscopeLabelが選択中の学科・コースと異なる' });
      return;
    }
    const label = ruleLabel(rule, row);
    const target = { id: `${kind}:${row.requirementId}`, label, reason: row.reason ?? '自動判定できません', sourceRefs: row.sourceRefs ?? [] };
    // Consume only the recognized leading cause. A combined official hold or
    // future suffix is retained separately instead of disappearing with input.
    const input = inputReasons.find(input => row.reason?.startsWith(input.reason));
    let remainder = row.reason ?? '自動判定できません';
    if (input) {
      add(`input:${input.key}`, 'learner', input.label, input.action, target, input.destination);
      remainder = remainder.slice(input.reason.length).replace(/^。/, '');
      if (!remainder) return;
    }
    const missingRecognition = '認定情報未入力です。0単位認定とは扱いません。';
    if (kind === 'card' && ['group-foreign', 'group-physical'].includes(row.requirementId) && remainder.startsWith(missingRecognition)) {
      add(`input:${row.requirementId}-recognition`, 'learner', `${row.label}の認定結果を確認してください`, `プロフィールの「${row.label}」に公式認定結果を入力してください。`, target, 'profile');
      remainder = remainder.slice(missingRecognition.length).replace(/^。/, '');
      if (!remainder) return;
    }
    const cardId = rule && (cardOwners[rule.ruleId] ?? (lectureRuleIds.has(rule.ruleId) ? progress.cards.find(c => c.specialLectures?.some(l => l.label === '総合特講'))?.requirementId : undefined) ?? (publicRuleIds.has(rule.ruleId) ? progress.cards.find(c => c.ruleType === 'public_course_limit')?.requirementId : undefined));
    // Only the audited generic limitation is redundant. Dynamic official,
    // mapping and input holds never disappear merely because a card exists.
    const staticReason = ['条件または例外を安全に自動評価できません', '対象科目のmappingを一意に特定できません'].includes(remainder);
    const card = cardId && progress.cards.find(c => c.requirementId === cardId);
    if (card && staticReason && context?.profile.curriculumApplicability === 'current_2026'
      && (rule?.ruleId !== 'common_basic_lecture_max_credits' || card.specialLectures?.some(l => l.label === '基礎特講'))) {
      result.delegated.push({ requirementId: row.requirementId, cardId: card.requirementId, label, reason: remainder });
      return;
    }
    const university = (rule && legacyRuleIds.has(rule.ruleId)) || row.ruleType === 'manual_review'
      || remainder === '旧課程・経過措置では2026年度の必要単位を適用しません。';
    add(target.id, university ? 'university' : 'developer', label,
      university ? '大学・教務に適用条件を確認してください。プロフィールの変更だけでは確定できません。'
        : 'この条件は自動判定できません。公式資料・算入根拠の確認または判定機能の対応が必要です。',
      { ...target, reason: remainder });
  };
  for (const row of progress.requirements) consume(row, 'requirement');
  for (const row of progress.cards) consume(row, 'card');
  for (const row of progress.referenceProgress) consume({ ...row, requirementId: row.id, ruleType: 'reference', inProgress: null, planned: null, unit: 'credits', status: row.status === 'unknown' ? 'unknown' : 'unsatisfied' }, 'reference');

  // Import notices retain their own source-row counts and UI. A real candidate
  // can make manual identity confirmation actionable; allocation holds remain
  // visible in the original notices/cards even after this action is offered.
  for (const row of context?.importedRows ?? []) {
    if (row.curriculumMatch === 'exact_unique' || row.earnedCreditsTotal === 0) continue;
    const notice = progress.importedWarnings.find(n => n.kind !== 'out_of_scope' && n.sourceRowIds.includes(row.id));
    const candidate = context!.catalog.offerings.some(o => row.candidateOfferingIds.includes(o.id)
      && o.resolutionStatus === 'matched' && o.curriculumCourseId
      && context!.catalog.curriculum?.courses.some(c => c.id === o.curriculumCourseId));
    if (notice && candidate) add(`input:import:${row.id}`, 'learner', `${row.rawName}の科目対応を確認してください`,
      '成績取込の管理で公式科目行の「行の照合先」を確認してください。照合しても算入条件が残る場合があります。',
      { id: `import:${row.id}`, label: row.rawName, reason: notice.reason, sourceRefs: [] }, 'imports');
  }
  result.learner = [...groups.values()].filter(g => g.owner === 'learner');
  result.automatic = [...groups.values()].filter(g => g.owner !== 'learner');
  return result;
}
