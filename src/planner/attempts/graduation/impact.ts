import type { Attempt } from '../types';
import type { InstitutionalCatalog, CurriculumPlacement } from '../../institutional/types';
import type { PlannerCatalog } from '../../plannerCatalog';
import type { GraduationProgress } from '../../graduation/graduationProgress';
import type { AttemptImpact } from './types';

// Unsupported descriptors have null scopeId. Resolve only the catalog's known
// labels; never interpret an engine warning or a missing descriptor as impact.
const scopeLabels: Record<string, [string, string | null]> = {
  law: ['法律学科', null], history: ['史学科', null], geography: ['地理学科', null],
  economics: ['経済学科', null], commerce: ['商業学科', null],
  japanese_language: ['日本文学科', '言語コース'], japanese_literature: ['日本文学科', '文学コース'],
  japanese_performance: ['日本文学科', '芸能文化コース'],
};

/** Use the union of explicit candidates, or the confirmed Course's placements.
 * Neither names, planned years nor candidate array order resolve identity. */
export function candidatePlacements(a: Attempt, catalog: InstitutionalCatalog): CurriculumPlacement[] {
  if (a.placement.ref) return catalog.placements.filter(p => p.id === a.placement.ref!.placementId);
  const ids = new Set(a.placement.candidatePlacementIds);
  const audits = new Set([...a.identity.candidateAuditIds, ...a.placement.candidateAuditIds]);
  return catalog.placements.filter(p => ids.has(p.id)
    || (a.identity.ref !== null && p.institutionalCourseId === a.identity.ref.institutionalCourseId)
    || audits.has(p.auditRecord.oldCurriculumCourseId));
}

/** Category-level conservative closure includes all professional transfers/caps
 * within this program. It deliberately does not claim a per-family allocator. */
export function attemptImpact(a: Attempt, candidates: CurriculumPlacement[], catalog: PlannerCatalog,
  scopeId: string, progress: GraduationProgress): AttemptImpact {
  const empty: AttemptImpact = { extent: 'none', scopeIds: [], placementIds: [], categories: [], requirementIds: [], cardIds: [], referenceIds: [] };
  if (a.membership.kind !== 'active' || !a.plan || ['failed', 'dropped', 'waiting'].includes(a.plan.status)) return empty;
  const common = catalog.programs.filter(p => p.isCommon).map(p => p.scopeId);
  const unverifiedOutside = a.applicability.status !== 'confirmed'
    && candidates.some(p => p.scopeId !== scopeId && !common.includes(p.scopeId));
  const relevant = candidates.filter(p => p.scopeId === scopeId || common.includes(p.scopeId));
  // A documented placement in another program does not confirm this student's
  // applicability. Until confirmed, it cannot prove absence of local impact.
  const outsideConfirmed = candidates.length > 0 && relevant.length === 0 && a.applicability.status === 'confirmed';
  if (outsideConfirmed) return empty;
  // An unresolved outside candidate keeps its potential local impact even when
  // another (e.g. common) candidate is added. Candidate unions cannot erase holds.
  const unknown = relevant.length === 0 || unverifiedOutside;
  const categories = [...new Set(relevant.map(p => p.category))].sort();
  const has = (category: string) => unknown || categories.includes(category);
  const program = catalog.programs.find(p => p.scopeId === scopeId)!;
  const evaluatedRequirementIds = new Set(progress.requirements.map(r => r.requirementId));
  const requirementIds = catalog.requirements.filter(r => {
    if (!evaluatedRequirementIds.has(r.id)) return false;
    if (r.status === 'unsupported') {
      if (r.scopeLabel === 'common') {
        if (r.ruleId === 'common_natural_legacy_reenrollment') return has('一般教育');
        if (r.ruleId === 'common_foreign_reenrollment') return has('外国語');
        return unknown || relevant.some(p => common.includes(p.scopeId));
      }
      const subject = scopeLabels[r.scopeLabel];
      return !!subject && subject[0] === program.department && subject[1] === program.course && has('専門教育');
    }
    if (r.scopeId !== scopeId && !common.includes(r.scopeId)) return false;
    // An Attempt is not a recognized/Open University credit record.
    if (r.target.credit_source) return unknown;
    if (r.target.curriculum_category) return has(r.target.curriculum_category);
    const names = r.target.course_names ?? (r.target.course_name ? [r.target.course_name] : []);
    // Named professional rules may depend on other professional transfers.
    if (names.length && !unknown) return relevant.some(p => names.includes(p.officialName))
      || (categories.includes('専門教育') && r.scopeId === scopeId);
    return unknown || (common.includes(r.scopeId) ? relevant.some(p => common.includes(p.scopeId)) : has('専門教育'));
  }).map(r => r.id);
  const cardIds = progress.cards.filter(row => {
    if (unknown) return true;
    if (row.requirementId === 'group-general') return has('一般教育');
    if (row.requirementId === 'group-foreign') return has('外国語');
    if (row.requirementId === 'group-physical') return has('保健体育');
    if (/^(professional-|history-|literature-)/.test(row.requirementId)) return has('専門教育');
    if (row.ruleType === 'thesis_progress') return relevant.some(p => p.officialName === '卒業論文');
    return requirementIds.includes(row.requirementId) || has('専門教育');
  }).map(r => r.requirementId);
  return { extent: unknown ? 'selected_scope_unknown' : 'placements',
    scopeIds: unknown ? [scopeId, ...common] : [...new Set(relevant.map(p => p.scopeId))].sort(),
    placementIds: relevant.map(p => p.id).sort(), categories, requirementIds, cardIds,
    referenceIds: ['overall-reference-progress', 'schooling-reference-progress'] };
}
