import { finiteNonnegativeSum } from '../../graduation/finiteNumbers';
import { parseAttemptGraphJson } from '../jsonInput';
import rulesJson from '../../../data/graduation_rules.json';
import type { PlannerCatalog } from '../../plannerCatalog';
import { thesisProgressForScope } from '../../graduation/thesisSelection';
import { calculateGraduationProgress, type CourseAllocationInput } from '../../graduation/graduationProgress';
import { specialOfficialCourse, deriveOfficialGraduationFacts } from '../../graduation/officialGraduationFacts';
import { officialRepeatableRule } from '../../graduation/officialRepeatableEvidence';
import { createNewPlanSource } from '../persistence/newPlan';
import type { PersistenceSource } from '../persistence/contracts';
import { requireDecoded } from '../migration/source';
import { freeze } from '../migration/contracts';
import { sameAttemptData, validateAttemptGraph } from '../validation';
import type { AttemptGraph } from '../types';
import { adaptAttemptGraduation } from './adapter';

const rules = rulesJson as unknown as PlannerCatalog;
/** Explicit curriculum scenario, NOT university certification of this learner.
 * The graph is primitive JSON, parsed privately before validation/calculation.
 * Stored schema23/24 applicability is never promoted or overwritten. */
export async function calculateRecordedCredits(graphJson: string, source: PersistenceSource, scopeId: string) {
  if (typeof graphJson !== 'string' || graphJson.length > 1048576) throw new Error('primitive_graph_json_required');
  if (source.kind === 'new-plan') {
    if (source !== await createNewPlanSource()) throw new Error('unvalidated_new_plan_source');
  } else requireDecoded(source);
  const graph: AttemptGraph = parseAttemptGraphJson(graphJson) as AttemptGraph;
  const checked = validateAttemptGraph(graph, source.context);
  if (!checked.valid) return freeze({ status: 'rejected' as const, diagnostics: checked.issues });
  if (!rules.programs.some(p => !p.isCommon && p.scopeId === scopeId)) throw new Error('unknown_scope');
  // Use only structural rules here; the annual list is absent for both source kinds.
  const master = source.context.catalog;
  const common = new Set(rules.programs.filter(p => p.isCommon).map(p => p.scopeId));
  const rows = source.kind === 'new-plan' ? [] : source.state.importedCourseAchievements;
  const details = source.kind === 'new-plan' ? [] : source.state.importedStudyRecords;
  if (source.kind !== 'new-plan' && (source.state.graduationProfile.recognizedCredits.professionalCourses ?? []).length) {
    return freeze({ status: 'rejected' as const, diagnostics: [{ code: 'legacy_professional_recognition_requires_separate_adapter', path: '/profile/recognizedCredits/professionalCourses', message: 'Do not discard legacy Offering-linked recognition' }] });
  }
  const profile = source.kind === 'new-plan' ? undefined : source.state.graduationProfile;
  const official = deriveOfficialGraduationFacts(rows, details, rules, scopeId, profile);
  const associationHolds: Array<{ attemptId: string; reason: string }> = [];
  // Schema23 reuses YI-07's source-bound ownership checks, without forging schema24 source.
  if (source.kind !== 'new-plan') {
    const { items, todos, mediaSchoolingProgress, correspondenceProgress, courseEvaluations, ...retained } = source.state;
    void items; void todos; void mediaSchoolingProgress; void correspondenceProgress; void courseEvaluations;
    const adapted = adaptAttemptGraduation({ graph, retained }, source, scopeId);
    if (adapted.status === 'rejected') return adapted;
    for (const entry of adapted.attempts) {
      const refs = entry.official.referencedStudyRecordIds;
      for (const d of entry.diagnostics) if (d.code === 'official_detail_shared'
        || (refs.length > 0 && ['official_association_unverified', 'official_overlap_possible'].includes(d.code))) {
        associationHolds.push({ attemptId: entry.attemptId, reason: d.code });
      }
      if (entry.record.plan?.importedSourceCourseId
        && !entry.official.exclusiveAchievementIds.includes(entry.record.plan.importedSourceCourseId)) {
        associationHolds.push({ attemptId: entry.attemptId, reason: 'explicit_official_link_unresolved' });
      }
    }
  }
  const conflicting = new Set<string>();
  const groups = new Map<string, { placementId: string; attempts: typeof graph.attempts }>();
  const holds: Array<{ attemptId: string; reason: string }> = [...associationHolds];
  const informational = graph.attempts.filter(a => a.membership.kind === 'active').map(a => ({
    attemptId: a.id, status: a.plan?.status ?? null, method: a.method.value,
    contribution: a.plan?.contribution ? a.plan.contribution.value : undefined }));
  for (const a of graph.attempts) {
    if (a.membership.kind !== 'active' || a.plan?.status !== 'earned') continue;
    const ids = a.placement.ref ? [a.placement.ref.placementId] : a.placement.candidatePlacementIds;
    const p = ids.length === 1 ? master.placements.find(p => p.id === ids[0]) : null;
    if (!p || a.identity.status !== 'confirmed' || p.institutionalCourseId !== a.identity.ref.institutionalCourseId
      || p.identityDecision.status !== 'safe' || p.auditRecord.placementStatus !== 'safe'
      || p.methodConstraint.status !== 'safe' || (p.scopeId !== scopeId && !common.has(p.scopeId))) {
      holds.push({ attemptId: a.id, reason: 'unique_safe_placement_required' }); continue;
    }
    const id = a.identity.ref.institutionalCourseId;
    const group = groups.get(id);
    if (group && group.placementId !== p.id) { conflicting.add(id); holds.push({ attemptId: a.id, reason: 'conflicting_placements' }); continue; }
    groups.set(id, { placementId: p.id, attempts: [...(group?.attempts ?? []), a] });
  }
  const allocations: CourseAllocationInput[] = [];
  const courses = [];
  for (const [id, group] of groups) {
    if (conflicting.has(id)) { group.attempts.forEach(a => holds.push({ attemptId: a.id, reason: 'conflicting_placements' })); continue; }
    const p = master.placements.find(p => p.id === group.placementId)!;
    const mapping = rules.mappings.find(m => m.mappingId === p.auditRecord.oldMappingId);
    const course = rules.curriculum?.courses.find(c => c.id === p.auditRecord.oldCurriculumCourseId);
    const block = (reason: string) => { group.attempts.forEach(a => holds.push({ attemptId: a.id, reason })); };
    if (!mapping || !course || !sameAttemptData(mapping.curriculumCredits, p.compositionCredits)) { block('rule_mapping_conflict'); continue; }
    const ownedOfficial = official.facts.some(f => f.curriculumCourseId === course.id);
    if (ownedOfficial) { courses.push({ id, authority: 'official' as const, increment: 0 }); continue; }
    if (holds.some(h => group.attempts.some(a => a.id === h.attemptId))) continue;
    if (official.facts.some(f => f.curriculumCourseId === null)) { block('unresolved_official_overlap'); continue; }
    if (group.attempts.some(a => a.plan?.importedSourceCourseId)) { block('explicit_official_link_unresolved'); continue; }
    const repeat = officialRepeatableRule(rules.programs.find(p => p.scopeId === scopeId)!.department, course);
    if (specialOfficialCourse(course.canonicalName, mapping.department, mapping) && !repeat) { block('special_course_rule_not_connected'); continue; }
    if (holds.some(h => group.attempts.some(a => a.id === h.attemptId))) continue;
    const valid = group.attempts.every(a => typeof a.plan!.contribution?.value === 'number'
      && Number.isFinite(a.plan!.contribution.value) && a.plan!.contribution.value >= 0 && a.method.value !== 'unknown'
      && (!p.methodConstraint.requiredMethod || p.methodConstraint.requiredMethod === a.method.value));
    if (!valid) { block('explicit_quantity_and_compatible_method_required'); continue; }
    const total = finiteNonnegativeSum(group.attempts.map(a => a.plan!.contribution!.value!));
    const schooling = finiteNonnegativeSum(group.attempts.map(a => a.method.value === 'correspondence' ? 0 : a.plan!.contribution!.value!));
    if (total === null || schooling === null) { block('aggregate_quantity_non_finite'); continue; }
    const target = p.compositionCredits;
    if (target === null || target <= 0) { block('composition_unknown'); continue; }
    // Ordinary extra attempts are not additional copies of the same Course.
    // Ambiguous excess is held rather than choosing an arbitrary S distribution.
    if (!repeat && total > target && schooling > 0) { block('ordinary_reenrollment_excess'); continue; }
    if (repeat && group.attempts.some(a => a.plan!.contribution!.value !== 2 || a.method.value !== 'schooling')) {
      block('repeatable_component_requires_schooling2'); continue;
    }
    if (repeat && group.attempts.length > 1) { block('repeatable_independence_unverified'); continue; }
    // p.31: a normal T4 examination is not two T2 examinations.
    // Only the documented T4 or T2+S2 structures are enabled for a four-credit Course.
    if (!repeat && target === 4) {
      const t = group.attempts.filter(a => a.method.value === 'correspondence').map(a => a.plan!.contribution!.value!);
      const sc = group.attempts.filter(a => a.method.value !== 'correspondence').map(a => a.plan!.contribution!.value!);
      const wholeT = t.length > 0 && t.every(n => n === 4) && sc.length === 0;
      const partialT = t.length === 1 && t[0] === 2 && sc.length === 0;
      const mixed = t.length === 1 && t[0] === 2 && sc.length === 1 && sc[0] === 2;
      if (!wholeT && !partialT && !mixed) { block('unsupported_course_component_structure'); continue; }
    }
    const completed = total >= target;
    if (!completed && schooling > 0) { block('partial_schooling_exception_not_connected'); continue; }
    const credits = repeat ? Math.min(total, repeat[2]) : completed ? target : total;
    const sCredits = repeat ? Math.min(schooling, repeat[2]) : completed ? schooling : 0;
    allocations.push({ mapping, credits, completedCredits: repeat ? credits : completed ? target : 0, schoolingCredits: sCredits,
      fact: { canonicalName: course.canonicalName, curriculumCourseId: course.id,
        ...(repeat ? { repeatableEvidence: { label: repeat[1], attempts: group.attempts.map(a => ({ attemptId: a.id })),
          earnedTotal: total, countedCredits: credits, excessCredits: total - credits, limit: repeat[2], limitCourses: repeat[3] } } : {}) } });
    courses.push({ id, authority: 'learner_record' as const, increment: credits, recordedEarned: total,
      completedCredits: repeat ? credits : completed ? target : 0, schoolingCredits: sCredits, repeatable: Boolean(repeat) });
  }
  const retained = source.kind === 'new-plan' ? undefined : source.state;
  const progress = calculateGraduationProgress([], rules, scopeId, retained?.publicCourses, retained?.thesisSelection,
    details, rows, profile, retained ? thesisProgressForScope(retained, rules, scopeId) : null, {}, allocations);
  // Future intent quantities are exposed per record; the earned-only seam does not allocate projections.
  for (const row of [...progress.requirements, ...progress.cards]) {
    if (informational.some(a => a.status === 'planned')) row.planned = null;
    if (informational.some(a => a.status === 'in_progress')) row.inProgress = null;
  }
  return freeze({ status: 'calculated' as const, basis: 'selected_curriculum_learner_record_scenario' as const,
    personalApplicability: { status: 'unverified' as const, missing: ['official_learner_program', 'official_admission_context', 'reviewed_transition_rules'] },
    graduationCheckComplete: false, sourceLinksReverified: false, courses, holds, informational, progress,
    releaseReady: false });
}
