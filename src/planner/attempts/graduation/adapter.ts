import type { Attempt, AttemptGraph } from '../types';
import { sameAttemptData, snapshotAttemptGraph } from '../validation';
import { requireDecoded } from '../migration/source';
import { freeze, pointer, type RetainedState, type SourceArchive } from '../migration/contracts';
import { calculateGraduationProgress } from '../../graduation/graduationProgress';
import { deriveOfficialGraduationFacts } from '../../graduation/officialGraduationFacts';
import { exactImportedCurriculumId } from '../../graduation/officialCourseCredits';
import { thesisProgressForScope } from '../../graduation/thesisSelection';
import { candidatePlacements, attemptImpact } from './impact';
import type { AttemptDiagnostic, AttemptGraduationInput, AttemptGraduationResult, AttemptHoldCode,
  Decision, GraduationAxis, RecordedQuantity } from './types';

const axes: GraduationAxis[] = ['completion', 'ordinary', 'schooling', 'inProgress', 'planned'];
const supported = (value: number, reason: string): Decision<number> => ({ status: 'supported', value, reasons: [reason] });
const blocked = (status: 'held' | 'unsupported', reasons: string[]): Decision<number> => ({ status, value: null, reasons });
function quantity(value: number | null | undefined): RecordedQuantity {
  return value === undefined ? { kind: 'omitted' } : value === null ? { kind: 'unknown', value: null }
    : value === 0 ? { kind: 'zero', value: 0 } : { kind: 'positive', value };
}
function retainedFromSource(source: SourceArchive): RetainedState {
  const { items, todos, mediaSchoolingProgress, correspondenceProgress, courseEvaluations, ...retained } = source.state;
  void items; void todos; void mediaSchoolingProgress; void correspondenceProgress; void courseEvaluations;
  return retained;
}
function detailRefs(a: Attempt): string[] {
  return [...new Set([a.method.evidence, a.actualYear.evidence]
    .flatMap(e => e?.kind === 'official_detail' ? [e.studyRecordId] : []))];
}

/** Read-only, no clock, issuance, storage, Offering synthesis or legacy graph projection.
 * Source must come from the existing decoder (including YI-06 load/replay).
 * Only retained fields are source-bound; legally edited graphs are independently validated.
 * Stage 1 does not allocate positive manual Attempt credits. */
export function adaptAttemptGraduation(input: { graph: unknown; retained: RetainedState }, source: SourceArchive,
  scopeId: string): AttemptGraduationResult {
  try { requireDecoded(source); }
  catch { return { status: 'rejected', diagnostics: [{ code: 'unvalidated_source', path: '/source', message: 'Decode the original source or load through YI-06 first' }] }; }
  const sourceRetained = retainedFromSource(source);
  const mismatch = (): AttemptGraduationResult => ({ status: 'rejected', diagnostics: [{
    code: 'retained_source_mismatch', path: '/retained', message: 'Official rows, metadata and non-Attempt records must retain every original field/omission/order',
  }] });
  let graphInput: unknown;
  try {
    const retainedProperty = Object.getOwnPropertyDescriptor(input, 'retained'), graphProperty = Object.getOwnPropertyDescriptor(input, 'graph');
    if (!retainedProperty || !graphProperty || !('value' in retainedProperty) || !('value' in graphProperty)
      || !sameAttemptData(retainedProperty.value, sourceRetained)) return mismatch();
    graphInput = graphProperty.value;
  } catch { return mismatch(); }
  if (!source.sourceCatalog.programs.some(p => p.scopeId === scopeId && !p.isCommon)) return { status: 'rejected', diagnostics: [{
    code: 'unknown_scope', path: '/scopeId', message: 'Select an explicit known program; never infer from a planned year',
  }] };
  let graph: AttemptGraph;
  try {
    const checked = snapshotAttemptGraph(graphInput, source.context);
    if (!checked.valid) return { status: 'rejected', diagnostics: checked.issues };
    graph = checked.graph;
  } catch { return { status: 'rejected', diagnostics: [{ code: 'invalid_graph_input', path: '/graph', message: 'Expected cloneable plain graph data' }] }; }
  // The graph is already captured, validated and frozen. Clone trusted retained data.
  // Calculation uses the decoded source, never a second read of caller retained.
  const retained = structuredClone(sourceRetained);
  const catalog = source.sourceCatalog, master = source.context.catalog;
  const rows = retained.importedCourseAchievements, records = retained.importedStudyRecords;
  const officialEvidence = deriveOfficialGraduationFacts(rows, records, catalog, scopeId, retained.graduationProfile);
  const retainedProgress = calculateGraduationProgress([], catalog, scopeId, retained.publicCourses, retained.thesisSelection,
    records, rows, retained.graduationProfile, thesisProgressForScope(retained, catalog, scopeId));
  const stableFor = (oldId: string | null) => master.crosswalk.find(d => d.oldEntityKind === 'CurriculumCourse'
    && d.oldId === oldId && d.status === 'safe')?.adoptedStableId ?? null;
  const exactRows = rows.map(row => ({ row, stableId: stableFor(exactImportedCurriculumId(row, catalog)) }));
  const claims = new Map<string, string[]>();
  for (const a of graph.attempts) for (const id of detailRefs(a)) claims.set(id, [...(claims.get(id) ?? []), a.id]);
  const attempts: AttemptGraduationInput[] = graph.attempts.map(a => {
    const base = `/graph/attempts/${pointer(a.id)}`;
    const candidates = candidatePlacements(a, master);
    const placement = a.placement.ref ? master.placements.find(p => p.id === a.placement.ref!.placementId)! : null;
    const sameIdentity = a.identity.ref ? graph.attempts.filter(other => other.membership.kind === 'active'
      && other.identity.ref?.institutionalCourseId === a.identity.ref!.institutionalCourseId) : [];
    const refs = detailRefs(a), shared = refs.filter(id => (claims.get(id)?.length ?? 0) > 1);
    const explicit = new Set([...(a.plan?.importedSourceCourseId ? [a.plan.importedSourceCourseId] : []),
      ...records.filter(r => refs.includes(r.id) && r.sourceCourseId).map(r => r.sourceCourseId!)]);
    // A source/detail pointer proves existence only. Stage 1 has no verified
    // exclusive association contract; ownership requires exact Course identity.
    const exclusive = exactRows.filter(({ stableId }) => stableId !== null
      && a.identity.status === 'confirmed' && stableId === a.identity.ref.institutionalCourseId).map(({ row }) => row.id);
    // Unresolved official matching is NEVER repaired with manual quantities.
    // Without proven identity disjointness retain possible overlap, not a match.
    const possible = exactRows.filter(({ row, stableId }) => !exclusive.includes(row.id)
      && (stableId === null || a.identity.ref === null || explicit.has(row.id))).map(({ row }) => row.id);
    const diagnostics: AttemptDiagnostic[] = [];
    const add = (code: AttemptHoldCode, paths: string[] = [base], affected: GraduationAxis[] = axes) => {
      diagnostics.push({ code, axes: [...affected], sourceRefs: paths });
    };
    if (a.identity.status !== 'confirmed') add('identity_unresolved', [`${base}/identity`]);
    if (a.placement.status !== 'confirmed') add(a.placement.status === 'ambiguous' || a.placement.candidatePlacementIds.length > 1
      ? 'placement_ambiguous' : 'placement_unresolved', [`${base}/placement`]);
    if (a.applicability.status !== 'confirmed') add('applicability_unverified', [`${base}/applicability`]);
    // A pointer proves referential integrity, not a native source/slot association.
    // No positive method or academic-year eligibility is asserted in this slice.
    add('method_evidence_insufficient', [`${base}/method`], ['completion', 'ordinary', 'schooling']);
    if (a.actualYear.source !== 'source' || a.actualYear.evidence?.kind !== 'official_detail') {
      add('official_year_unverified', [`${base}/actualYear`], ['completion']);
    } else add('official_association_unverified', [`${base}/actualYear`], ['completion']);
    if (!a.plan || !Object.hasOwn(a.plan, 'contribution')) add('contribution_omitted', [`${base}/plan`]);
    else if (a.plan.contribution!.value === null) add('contribution_unknown', [`${base}/plan/contribution`]);
    if (possible.length) add('official_overlap_possible', possible.map(id => `/retained/importedCourseAchievements/${pointer(id)}`));
    if (refs.length) add('official_association_unverified', refs.map(id => `/retained/importedStudyRecords/${pointer(id)}`));
    if (a.plan?.importedSourceCourseId && !exclusive.includes(a.plan.importedSourceCourseId)) {
      add('official_association_unverified', [`${base}/plan/importedSourceCourseId`]);
    }
    if (shared.length) add('official_detail_shared', shared.map(id => `/retained/importedStudyRecords/${pointer(id)}`));
    if (officialEvidence.facts.some(f => f.sourceRowIds.some(id => exclusive.includes(id)) && f.allocation.kind === 'unknown')) {
      add('official_matching_held', exclusive.map(id => `/retained/importedCourseAchievements/${pointer(id)}`));
    }
    const earnedPeers = sameIdentity.filter(peer => peer.plan?.status === 'earned');
    if (earnedPeers.length > 1) {
      const orders = earnedPeers.map(peer => peer.plan!.earnedOrder);
      if (orders.some(order => order === null) || new Set(orders).size !== orders.length) add('earned_order_unconfirmed');
      add('multiple_attempt_rule_unimplemented');
    }
    add('completion_evidence_insufficient', [base, ...graph.ownedRecords.filter(r => r.owner?.kind === 'attempt' && r.owner.attemptId === a.id)
      .map(r => `/graph/ownedRecords/${pointer(r.id)}`)], ['completion', 'ordinary']);
    add('attempt_rule_unimplemented');
    const decisions = Object.fromEntries(axes.map(axis => {
      const reasons = [...new Set(diagnostics.filter(d => d.axes.includes(axis)).map(d => d.code))];
      const missing = reasons.some(r => !r.endsWith('_unimplemented'));
      return [axis, blocked(missing ? 'held' : 'unsupported', reasons)];
    })) as Record<GraduationAxis, Decision<number>>;
    // These are excluded increments. They say nothing about Course completion.
    for (const axis of ['ordinary', 'schooling', 'inProgress', 'planned'] as const) {
      const status = axis === 'inProgress' ? 'in_progress' : axis === 'planned' ? 'planned' : 'earned';
      if (a.membership.kind !== 'active' || a.plan?.status !== status) decisions[axis] = supported(0, 'not_an_active_increment');
      else if (status === 'earned' && exclusive.length) decisions[axis] = supported(0, 'official_aggregate_owns_increment');
      // Explicit ordinary contribution 0 does NOT establish S registration 0.
      else if (axis !== 'schooling' && a.plan.contribution?.value === 0) decisions[axis] = supported(0, 'explicit_zero_contribution');
    }
    // A dedicated rule capability is always unsupported, even if evidence is also missing.
    // diagnostics preserve both reasons; held has precedence for the actual calculation axes.
    const department = catalog.programs.find(p => p.scopeId === scopeId)!.department;
    const families = [...new Set(candidates.map(p => p.category === '専門教育' ? `professional:${department}` : `common:${p.category}`))];
    const impact = attemptImpact(a, candidates, catalog, scopeId, retainedProgress);
    return { attemptId: a.id, record: a, placementCandidates: structuredClone(candidates),
      quantities: {
        composition: { authority: 'curriculum_placement', placementId: placement?.id ?? null, quantity: quantity(placement?.compositionCredits) },
        learnerContribution: { authority: 'learner', quantity: quantity(a.plan?.contribution?.value) },
        legacyRegistration: a.legacyRefs.filter(ref => ref.status === 'known' && ref.entityKind === 'Offering').flatMap(ref => {
          const offering = catalog.offerings.find(o => o.id === ref.oldId);
          return offering ? [{ authority: 'legacy_offering' as const, offeringId: offering.id, quantity: quantity(offering.credits) }] : [];
        }),
      },
      official: { exclusiveAchievementIds: exclusive, possibleAchievementIds: possible, referencedStudyRecordIds: refs, sharedStudyRecordIds: shared },
      evidence: { ownedRecordIds: graph.ownedRecords.filter(r => r.owner?.kind === 'attempt' && r.owner.attemptId === a.id).map(r => r.id),
        sameIdentityAttemptIds: sameIdentity.map(peer => peer.id), earnedOrder: a.plan?.earnedOrder ?? null, ruleFamilies: families,
        ruleSupport: { status: 'unsupported', value: null, reasons: ['attempt_rule_unimplemented'] } },
      decisions, diagnostics, impact };
  });
  return freeze({ status: 'adapted', graduationCheckComplete: false, sourceLinksReverified: false,
    source: { rawSha256: source.rawSha256, catalogSha256: source.sourceCatalogSha256, sourceRevisionId: master.sourceRevision.id, scopeId },
    graph, retained, attempts, retainedProgress, officialEvidence,
    unresolvedOwners: graph.ownedRecords.flatMap(r => r.owner?.kind === 'unresolved_legacy'
      ? [{ recordId: r.id, sourceRef: `/graph/ownedRecords/${pointer(r.id)}/owner`, reason: r.owner.reason }] : []),
    attemptImpacts: attempts.flatMap(a => {
      const affected = axes.filter(axis => a.decisions[axis].status !== 'supported');
      return a.impact.extent === 'none' || !affected.length ? [] : [{ attemptId: a.attemptId, axes: affected, impact: a.impact }];
    }),
  });
}
