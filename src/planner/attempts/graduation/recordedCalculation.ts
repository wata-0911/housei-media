import { legacyRecordedEvidence } from './legacyRecordedEvidence';
import { allocateLawPartialCredits, lawPartialSchoolingCredits } from '../../graduation/lawPartialCredits';
import { ordinaryCourseCompletion } from '../../progress/ordinaryCourseCompletion';
import { finiteNonnegativeSum } from '../../graduation/finiteNumbers';
import { parseAttemptGraphJson } from '../jsonInput';
import rulesJson from '../../../data/graduation_rules.json';
import type { PlannerCatalog } from '../../plannerCatalog';
import { thesisProgressForScope } from '../../graduation/thesisSelection';
import { calculateGraduationProgress, type CourseAllocationInput } from '../../graduation/graduationProgress';
import { specialOfficialCourse, deriveOfficialGraduationFacts } from '../../graduation/officialGraduationFacts';
import { officialRepeatableRule } from '../../graduation/officialRepeatableEvidence';
import { geographyDestinationCourse } from '../../graduation/geographyAllocationEvidence';
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
    // A destination Course row is not an independent award. Official/raw or
    // learner ownership of the row does not establish preceding staged uses.
    if (geographyDestinationCourse(course, mapping)) {
      block('geography_transfer_evidence_required');
      const values = group.attempts.map(a => Object.hasOwn(a.plan!, 'contribution') ? a.plan!.contribution!.value : null);
      courses.push({ id, authority: 'learner_record' as const, increment: 0,
        recordedEarned: values.every((n): n is number => n !== null && Number.isFinite(n) && n >= 0)
          ? finiteNonnegativeSum(values as number[]) : null,
        completedCredits: 0, schoolingCredits: 0, repeatable: false,
        quantityInterpretations: group.attempts.map((a, i) => ({ attemptId: a.id, value: values[i],
          basis: Object.hasOwn(a.plan!, 'contribution') ? 'explicit_learner' : 'unknown', legacyOfferingId: null })) });
      continue;
    }
    const ownedOfficial = official.facts.some(f => f.curriculumCourseId === course.id);
    if (ownedOfficial) { courses.push({ id, authority: 'official' as const, increment: 0 }); continue; }
    if (holds.some(h => group.attempts.some(a => a.id === h.attemptId))) continue;
    if (official.facts.some(f => f.curriculumCourseId === null)) { block('unresolved_official_overlap'); continue; }
    if (group.attempts.some(a => a.plan?.importedSourceCourseId)) { block('explicit_official_link_unresolved'); continue; }
    const repeat = officialRepeatableRule(rules.programs.find(p => p.scopeId === scopeId)!.department, course);
    if (specialOfficialCourse(course.canonicalName, mapping.department, mapping) && !repeat) { block('special_course_rule_not_connected'); continue; }
    if (holds.some(h => group.attempts.some(a => a.id === h.attemptId))) continue;
    const evidence = group.attempts.map(a => legacyRecordedEvidence(a, source, p));
    // Resolve a source-slot collision before consuming its single award. An
    // explicit0/null/fraction cannot take the evidence away from a proper S1
    // just by being first. A lone edited0 still uses its explicit0 below.
    const sourceClaims = new Map<string, number[]>();
    evidence.forEach((e,i) => {
      if (e) sourceClaims.set(e.sourceRowKey, [...(sourceClaims.get(e.sourceRowKey) ?? []), i]);
    });
    const repeatedSourceClaim = evidence.map(() => false);
    for (const indexes of sourceClaims.values()) {
      const winner = indexes.find(i => {
        const a = group.attempts[i];
        const n = Object.hasOwn(a.plan!, 'contribution') ? a.plan!.contribution!.value : evidence[i]!.omittedCredits;
        return n === (['schooling', 'media'].includes(a.method.value) ? p.compositionCredits === 1 ? 1 : 2 : p.compositionCredits);
      }) ?? indexes[0];
      indexes.forEach(i => { repeatedSourceClaim[i] = i !== winner; });
    }
    const components = group.attempts.map((a,i) => ({
      credits: Object.hasOwn(a.plan!, 'contribution') ? a.plan!.contribution!.value : repeatedSourceClaim[i] ? null : evidence[i]?.omittedCredits ?? null,
      // p.45: native foreign S belongs to the S1 placement. A free method
      // label on a T2 placement supplies no S eligibility (nor a T2 award).
      // Bound old openings and official facts retain their separate evidence.
      method: repeatedSourceClaim[i] || (mapping.category === '外国語'
        && ['schooling', 'media'].includes(a.method.value)
        && !(p.compositionCredits === 1 && p.methodConstraint.requiredMethod === 'schooling') && !evidence[i]) ? 'unknown'
        : p.methodConstraint.requiredMethod && p.methodConstraint.requiredMethod !== a.method.value
        && !(p.methodConstraint.requiredMethod === 'schooling' && evidence[i]?.mediaAsSchooling)
        ? 'unknown' : a.method.value,
    }));
    const quantitiesKnown = components.every(c => c.credits !== null && Number.isFinite(c.credits) && c.credits >= 0);
    const valid = quantitiesKnown && components.every(c => c.method !== 'unknown');
    const regularCompletion = ordinaryCourseCompletion(p.compositionCredits, components);
    const knownSchooling = components.some(c => ['schooling', 'media'].includes(c.method)
      && c.credits === (p.compositionCredits === 1 ? 1 : 2));
    if (!valid && regularCompletion.completedCredits === 0 && !knownSchooling) {
      block('explicit_quantity_and_compatible_method_required');
      // Known safe placement, unknown quantity: preserve known subtotal0 with an
      // explicit unknown reason. Absence and an explicit recorded0 remain different.
      if (!repeat) allocations.push({ mapping, credits: 0, completedCredits: 0, schoolingCredits: 0,
        learnerRecord: true, completionHoldReason: 'explicit_quantity_and_compatible_method_required',
        fact: { canonicalName: course.canonicalName, curriculumCourseId: course.id } });
      continue;
    }
    const total = finiteNonnegativeSum(components.map(c => c.credits ?? 0));
    if (total === null) { block('aggregate_quantity_non_finite'); continue; }
    const target = p.compositionCredits;
    if (target === null || target <= 0) { block('composition_unknown'); continue; }
    // p.45 explicitly permits repeated foreign-language S1 (up to four);
    // this is not the ordinary S2+S2 completion rule.
    const isSchooling = (i: number) => ['schooling', 'media'].includes(components[i].method);
    const foreignSchooling = mapping.category === '外国語' && target === 1
      && components.some((c,i) => isSchooling(i) && c.credits === 1);
    const repeatCandidates = components.flatMap((c,i) => c.credits === 2 && isSchooling(i) ? [i] : []);
    const provenRepeats = new Map<string, number>();
    for (const i of repeatCandidates) {
      const key = evidence[i]?.repeatKey;
      if (course.id === 'curriculum:f49de1e6-82ae-4b86-8c0a-453ef41995ce' && mapping.department === '法律学科'
        && key && !provenRepeats.has(key)) provenRepeats.set(key,i);
    }
    // Distinct original openings may establish two old registrations. Native
    // IDs alone never establish independent repeat awards. Cap at the rule.
    const repeatIndexes = provenRepeats.size ? [...provenRepeats].sort(([a],[b]) => a.localeCompare(b)).slice(0,repeat?.[3] ?? 1).map(([,i]) => i)
      : repeatCandidates.slice(0,1);
    if (repeat && !repeatIndexes.length) { block('repeatable_component_requires_schooling2'); continue; }
    if (repeat) group.attempts.forEach((a,i) => {
      if (!repeatIndexes.includes(i)) holds.push({ attemptId: a.id, reason: repeatedSourceClaim[i] || repeatCandidates.includes(i)
        ? 'repeatable_independence_unverified' : 'repeatable_component_requires_schooling2' });
    });
    const foreignIndexes = components.flatMap((c,i) => isSchooling(i) && c.credits === 1 ? [i] : []).slice(0,4);
    const completion = foreignSchooling ? { completedCredits: foreignIndexes.length, reason: foreignIndexes.length < group.attempts.length ? 'additional_course_components_not_counted' : null, held: false, countedIndexes: foreignIndexes } : regularCompletion;
    const reason = !repeat ? completion.reason : null;
    if (reason) {
      if (completion.completedCredits > 0) group.attempts.forEach((a,i) => { if (!completion.countedIndexes.includes(i)) holds.push({ attemptId: a.id, reason }); });
      else block(reason);
    }
    const completed = repeat || completion.completedCredits > 0;
    // Independent, correctly sized S records survive a held whole-Course claim.
    const properSchooling = components.filter((c,i) => isSchooling(i) && c.credits === (target === 1 ? 1 : 2));
    const partialSchooling = lawPartialSchoolingCredits(mapping, components);
    const countedSchooling = partialSchooling === 2 ? 2 : repeat ? repeatIndexes.length * 2 : foreignSchooling ? completion.completedCredits
      : target === 4 ? (properSchooling.length > 0 ? 2 : 0) : Math.min(target, properSchooling.length * (target === 1 ? 1 : 2));
    const credits = repeat ? repeatIndexes.length * 2 : foreignSchooling ? completion.completedCredits : completed ? target : total;
    allocations.push({ mapping, credits, learnerRecord: true, lawPartialSchoolingCredits: partialSchooling, ...(completion.held && !repeat ? { completionHoldReason: reason! } : {}), completedCredits: repeat || foreignSchooling ? credits : completed ? target : 0, schoolingCredits: countedSchooling,
      fact: { canonicalName: course.canonicalName, curriculumCourseId: course.id,
        ...(repeat ? { repeatableEvidence: { label: repeat[1], attempts: repeatIndexes.map(i => ({ attemptId: group.attempts[i].id })),
          earnedTotal: credits, countedCredits: credits, excessCredits: 0, limit: repeat[2], limitCourses: repeat[3] } } : {}) } });
    courses.push({ id, authority: 'learner_record' as const, increment: completed ? credits : 0, recordedEarned: quantitiesKnown ? total : null,
      completedCredits: repeat || foreignSchooling ? credits : completed ? target : 0, schoolingCredits: countedSchooling, repeatable: Boolean(repeat) || foreignSchooling,
      quantityInterpretations: group.attempts.map((a,i) => ({ attemptId: a.id, value: components[i].credits,
        basis: Object.hasOwn(a.plan!, 'contribution') ? 'explicit_learner' : !repeatedSourceClaim[i] && evidence[i]?.omittedCredits !== null && evidence[i]?.omittedCredits !== undefined ? 'decoded_legacy_opening' : 'unknown',
        legacyOfferingId: evidence[i]?.offeringId ?? null })) });
  }
  const retained = source.kind === 'new-plan' ? undefined : source.state;
  const progress = calculateGraduationProgress([], rules, scopeId, retained?.publicCourses, retained?.thesisSelection,
    details, rows, profile, retained ? thesisProgressForScope(retained, rules, scopeId) : null, {}, allocations);
  const partialAllocation = allocateLawPartialCredits([...official.allocations.map(a => ({
    id: a.fact.curriculumCourseId!, mapping: a.mapping, completedCredits: a.completedCredits, partialSchoolingCredits: 0,
  })), ...allocations.map(a => ({
    id: a.fact.curriculumCourseId!, mapping: a.mapping, completedCredits: a.completedCredits,
    partialSchoolingCredits: a.lawPartialSchoolingCredits ?? 0,
  }))]);
  for (const course of courses) {
    const oldId = master.placements.find(p => p.id === groups.get(course.id)?.placementId)?.auditRecord.oldCurriculumCourseId;
    if (oldId && partialAllocation.has(oldId) && 'increment' in course) course.increment = partialAllocation.get(oldId)!;
  }
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
