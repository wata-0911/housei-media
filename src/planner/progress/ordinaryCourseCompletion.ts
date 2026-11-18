/** Learner quantities are records, not proof that a regular Course is complete.
 * 2026 学習のしおり pp.10-11,30-32. Special subjects/recognition use their own rules.
 * No array order, earnedOrder, planned year or capture time proves S confirmation
 * by the examination-ticket date, nor independent S content. */
export type OrdinaryComponent = { credits: number | null; method: string };
export function ordinaryCourseCompletion(target: number | null, components: OrdinaryComponent[]) {
  const result = (completedCredits: number, reason: string | null, held = false, countedIndexes: number[] = []) => ({ completedCredits, reason, held, countedIndexes });
  if (!components.length) return result(0, null);
  if (target === null || target <= 0) return result(0, 'explicit_quantity_and_compatible_method_required', true);
  const known = (c: OrdinaryComponent) => c.credits !== null && Number.isFinite(c.credits) && c.credits >= 0 && c.method !== 'unknown';
  // A separately proven regular award survives unproven additional records.
  // Only one award belongs to an ordinary Course; extra rows remain records.
  const base = components.findIndex(c => known(c) && (target === 4
    ? c.method === 'correspondence' && c.credits === 4
    : c.credits === target && (target !== 1 || c.method === 'schooling')));
  const schoolingBase = target === 2 ? components.findIndex(c => known(c) && c.method === 'schooling' && c.credits === 2) : -1;
  if (base >= 0) return result(target, components.length > 1 ? 'additional_course_components_not_counted' : null, false, [schoolingBase >= 0 ? schoolingBase : base]);
  if (components.some(c => !known(c))) return result(0, 'explicit_quantity_and_compatible_method_required', true);
  if (components.every(c => c.credits === 0)) return result(0, 'course_components_incomplete');
  const t = components.filter(c => c.method === 'correspondence');
  const s = components.filter(c => c.method !== 'correspondence');
  if (target === 4) {
    if (t.length === 1 && t[0].credits === 2 && s.length === 1 && s[0].credits === 2) return result(0, 'mixed_completion_evidence_required', true);
    if (components.length === 1 && components[0].credits === 2) return result(0, 'course_components_incomplete');
    if (s.length === 2 && s.every(c => c.credits === 2) && !t.length) return result(0, 'schooling_independence_evidence_required', true);
  }
  // In particular, fractions may never synthesize a one-credit S award.
  return result(0, 'unsupported_course_component_structure', true);
}

export function ordinaryCompletionReason(reason: string): string {
  return ({
    additional_course_components_not_counted: '正規の一回分を算入し、追加記録の卒業単位は別の修得根拠を確認するまで算入していません。',
    mixed_completion_evidence_required: 'S2の成績が受験票発送予定日までに確定したことと、T2の受験資格を確認できないため完成を保留しています。',
    schooling_independence_evidence_required: 'S2の別日程・授業内容と独立した修得回を確認できないため完成を保留しています。',
    unsupported_course_component_structure: '科目構成単位に対応する正規の修得方式・数量を確認できないため完成を保留しています。',
    explicit_quantity_and_compatible_method_required: '修得数量または方式が不明のため完成を保留しています。',
    course_components_incomplete: '科目構成単位が未完成のため、通常の卒業単位には算入していません。',
    geography_transfer_evidence_required: '地理の振替先は先行配分・独立した履修回・同一出所の排他を確認できないため算入を保留しています。',
    geography_earned_quantity_conflict: '修得済みの地理開講について保存された寄与量が正規の1回分と一致しないため算入を保留しています。',
  } as Record<string, string>)[reason] ?? reason;
}
