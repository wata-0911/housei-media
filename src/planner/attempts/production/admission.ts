import type { InstitutionalSearchRow } from '../../institutional/search';

export function methodAdmissionProblem(p: InstitutionalSearchRow['placement'], method?: unknown) {
  if (p.methodConstraint.status !== 'safe') return '履修方式の根拠が未確定です。';
  if (method !== undefined && p.methodConstraint.requiredMethod && method !== p.methodConstraint.requiredMethod)
    return `この配置の履修方法は ${p.methodConstraint.requiredMethod} です。方式を確認してください。`;
  return '';
}

/** A+C admission only. The caller must reconstruct the row from its trusted
 * catalog. Workbench representation/acceptance rules are deliberately separate. */
export function admissionProblem(row: Pick<InstitutionalSearchRow, 'placement' | 'institutionalCourse'>, method?: unknown) {
  const p = row.placement, c = row.institutionalCourse;
  if (p.kind !== 'course_placement') return '非科目枠は追加できません。';
  if (p.identityDecision.status !== 'safe' || c?.identityDecision.status !== 'safe'
    || p.institutionalCourseId !== c.id || p.identityDecision.adoptedStableId !== c.id
    || c.identityDecision.adoptedStableId !== c.id) return '科目identityが未確定です。検索・根拠確認のみ利用できます。';
  return methodAdmissionProblem(p, method);
}
