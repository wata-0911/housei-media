import type { Attempt, AttemptLegacyRef, AttemptOwnedRecord, Resolution, CourseRef, PlacementResolution } from '../types';
import { isMediaSchooling } from '../../progress/mediaSchooling';
import { bindingFor, pointer, type IdAssignments, type MigrationTarget, type SourceArchive, type RetainedState } from './contracts';

function makeAttempt(source: SourceArchive, row: IdAssignments['attempts'][number]): Attempt {
  const master = source.context.catalog;
  const offering = source.sourceCatalog.offerings.find(o => o.id === row.offeringId)!;
  const ref: AttemptLegacyRef = { status: 'known', entityKind: 'Offering', oldId: row.offeringId,
    sourceRevisionId: master.sourceRevision.id, sourceDigest: master.sourceRevision.sha256,
    legacyDigests: { ...master.legacyDigests }, reason: null };
  // The decoder validated and froze this archive against the measured original.
  const edge = source.context.legacyArchive!.offeringEdges.find(e => e.offeringId === row.offeringId)!;
  if (!edge) throw new Error('unarchived_offering');
  const candidates: string[] = edge.relation.candidateCurriculumCourseIds;
  const decisions = master.crosswalk.filter(d => d.oldEntityKind === 'CurriculumCourse' && candidates.includes(d.oldId));
  const decision = decisions.length === 1 ? decisions[0] : undefined;
  const course = decision?.status === 'safe' ? master.institutionalCourses.find(c => c.id === decision.adoptedStableId) : undefined;
  const status = decisions.some(d => d.status === 'conflict') ? 'conflict'
    : decisions.some(d => d.status === 'ambiguous') || decisions.length > 1 ? 'ambiguous' : 'unmatched';
  const reason = decisions.flatMap(d => d.reason).join('; ') || 'No audited safe identity for this original Offering';
  const identity: Resolution<CourseRef> = course ? { status: 'confirmed', ref: { institutionalCourseId: course.id,
    sourceRevisionId: course.nameHistory[0].sourceRevisionId, evidenceIds: [...course.nameHistory[0].evidenceIds] }, candidateAuditIds: [...candidates], reason: null }
    : { status, ref: null, candidateAuditIds: [...candidates], reason };
  if (edge.mappingIds.length !== offering.mappingIds.length || edge.mappingIds.some(id => !offering.mappingIds.includes(id))) throw new Error('original_placement_edge_conflict');
  const placements = master.placements.filter(p => (edge.mappingIds as string[]).includes(p.identityDecision.oldId));
  // Confirm a definition only when the original edge has exactly one safe placement.
  // selectedScopeId does not authorize choosing one of several candidates.
  const p = placements.length === 1 ? placements[0] : undefined;
  const safe = p && p.kind === 'course_placement' && p.auditRecord.placementStatus === 'safe' && p.methodConstraint.status === 'safe'
    && p.institutionalCourseId === (identity.ref?.institutionalCourseId ?? null);
  const placement: PlacementResolution = safe ? { status: 'confirmed', ref: { placementId: p.id,
    curriculumVersionId: p.curriculumVersionId, scopeId: p.scopeId, sourceRevisionId: p.sourceRevisionId,
    evidenceIds: [...p.identityDecision.evidenceIds] }, candidateAuditIds: [...p.candidateAuditIds], candidatePlacementIds: [p.id], reason: null }
    : { status: placements.some(p => p.auditRecord.placementStatus === 'conflict') ? 'conflict' : placements.length > 1 ? 'ambiguous' : 'unmatched',
      ref: null, candidateAuditIds: [...candidates], candidatePlacementIds: placements.map(p => p.id), reason: 'Original placement candidates retained; no safe unique definition' };
  const item = row.itemIndex === null ? null : source.state.items[row.itemIndex];
  const applicability = source.state.graduationProfile.curriculumApplicability;
  return { id: row.attemptId, creationOperationId: row.operationId, originalTitle: offering.name, identity, placement,
    applicability: { status: 'unknown', curriculumVersionId: null, scopeId: null, legacyApplicability: applicability, originalValue: applicability, evidence: null },
    legacyRefs: [ref], membership: item ? { kind: 'active' } : { kind: 'detached', reason: 'legacy_orphan', deletionOperationId: null },
    plan: item ? { status: item.status, plannedYear: item.plannedYear, plannedTerm: item.plannedTerm, studyYear: item.studyYear, earnedOrder: item.earnedOrder,
      ...(Object.hasOwn(item, 'courseCreditContribution') ? { contribution: { value: item.courseCreditContribution!, source: 'learner' as const, note: null } } : {}),
      ...(Object.hasOwn(item, 'importedSourceCourseId') ? { importedSourceCourseId: item.importedSourceCourseId! } : {}) } : null,
    method: { value: isMediaSchooling(offering) ? 'media' : offering.method, source: 'legacy_reference', evidence: { kind: 'legacy', ref: structuredClone(ref) } },
    actualYear: { value: null, source: 'unknown', evidence: null, reason: 'Planned year is not evidence of actual enrollment year' } };
}

/** Internal construction; public preview validates assignments before reaching here. */
export function buildMigrationTarget(source: SourceArchive, table: IdAssignments): MigrationTarget {
  const attempts = table.attempts.map(row => makeAttempt(source, row));
  const owners = new Map(table.attempts.map(row => [row.offeringId, row.attemptId]));
  const ownedRecords = table.records.map(row => {
    const old = row.sourceCollection === 'todos' ? source.state.todos[Number(row.sourceKey)] : source.state[row.sourceCollection][row.sourceKey];
    const { offeringId, ...payload } = structuredClone(old);
    return { id: row.recordId, kind: row.kind, owner: offeringId === null ? null : { kind: 'attempt', attemptId: owners.get(offeringId)! }, payload } as AttemptOwnedRecord;
  });
  const retained = Object.fromEntries(Object.entries(structuredClone(source.state)).filter(([key]) => !['items', 'todos', 'mediaSchoolingProgress', 'correspondenceProgress', 'courseEvaluations'].includes(key))) as RetainedState;
  const fields: MigrationTarget['ledger']['fields'] = [];
  const walk = (value: unknown, from: string, to: string): void => {
    fields.push({ sourcePath: from, targetPath: to });
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(child, `${from}/${pointer(key)}`, `${to}/${pointer(key)}`);
  };
  for (const [key, value] of Object.entries(retained)) walk(value, `/${key}`, `/retained/${key}`);
  source.state.items.forEach((item, i) => {
    for (const [key, value] of Object.entries(item)) walk(value, `/items/${i}/${key}`, key === 'offeringId' ? `/graph/attempts/${i}/legacyRefs/0/oldId`
      : key === 'courseCreditContribution' ? `/graph/attempts/${i}/plan/contribution/value` : `/graph/attempts/${i}/plan/${key}`);
  });
  table.records.forEach((row, i) => {
    const old = row.sourceCollection === 'todos' ? source.state.todos[Number(row.sourceKey)] : source.state[row.sourceCollection][row.sourceKey];
    for (const [key, value] of Object.entries(old)) walk(value, `${row.key}/${pointer(key)}`, key === 'offeringId' ? `/ledger/records/${i}/offeringId` : `/graph/ownedRecords/${i}/payload/${pointer(key)}`);
  });
  return { binding: bindingFor(source), graph: { attempts, ownedRecords, removals: [] }, retained,
    ledger: { attempts: structuredClone(table.attempts), records: structuredClone(table.records), fields } };
}
