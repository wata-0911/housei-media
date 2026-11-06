/** Learner quantities are records, not proof that a regular Course is complete.
 * 2026 学習のしおり pp.10-11,30-32. Special subjects/recognition use their own rules.
 * No array order, earnedOrder, planned year or capture time proves S confirmation
 * by the examination-ticket date, nor independent S content. */
export type OrdinaryComponent = { credits: number | null; method: string };
export function ordinaryCourseCompletion(target: number | null, components: OrdinaryComponent[]) {
  const result = (completedCredits: number, reason: string | null, held = false) => ({ completedCredits, reason, held });
  if (!components.length) return result(0, null);
  if (target === null || target <= 0 || components.some(c => c.credits === null || !Number.isFinite(c.credits) || c.credits < 0 || c.method === 'unknown')) {
    return result(0, 'explicit_quantity_and_compatible_method_required', true);
  }
  if (components.every(c => c.credits === 0)) return result(0, 'course_components_incomplete');
  const t = components.filter(c => c.method === 'correspondence');
  const s = components.filter(c => c.method !== 'correspondence');
  if (target === 4) {
    if (t.some(c => c.credits === 4) && t.every(c => c.credits === 2 || c.credits === 4) && s.every(c => c.credits === 2)) return result(4, null);
    if (t.length === 1 && t[0].credits === 2 && s.length === 1 && s[0].credits === 2) return result(0, 'mixed_completion_evidence_required', true);
    if (components.length === 1 && components[0].credits === 2) return result(0, 'course_components_incomplete');
    if (s.length === 2 && s.every(c => c.credits === 2) && !t.length) return result(0, 'schooling_independence_evidence_required', true);
    return result(0, 'unsupported_course_component_structure', true);
  }
  if (target === 2) {
    if (components.every(c => c.credits === 2)) return result(2, null);
    if (components.every(c => c.credits === 0)) return result(0, 'course_components_incomplete');
    return result(0, 'unsupported_course_component_structure', true);
  }
  if (target !== 2 && target !== 4) return result(components.reduce((n,c) => n + c.credits!, 0) >= target ? target : 0, null);
  // One-credit special placements (e.g. foreign-language S) remain independent.
  return components.length === 1 && components[0].credits === target
    ? result(target, null) : result(0, 'unsupported_course_component_structure', true);
}

export function ordinaryCompletionReason(reason: string): string {
  return ({
    mixed_completion_evidence_required: 'S2の成績が受験票発送予定日までに確定したことと、T2の受験資格を確認できないため完成を保留しています。',
    schooling_independence_evidence_required: 'S2の別日程・授業内容と独立した修得回を確認できないため完成を保留しています。',
    unsupported_course_component_structure: '科目構成単位に対応する正規の修得方式・数量を確認できないため完成を保留しています。',
    explicit_quantity_and_compatible_method_required: '修得数量または方式が不明のため完成を保留しています。',
    course_components_incomplete: '科目構成単位が未完成のため、通常の卒業単位には算入していません。',
  } as Record<string, string>)[reason] ?? reason;
}
