import type {
  Attempt, AttemptEvidence, AttemptGraph, AttemptLegacyRef, AttemptOwnedRecord, AttemptValidationContext,
  AttemptValidationIssue, AttemptValidationResult, DocumentEvidence, ProgressOwner,
} from './types';
import { validateAttemptGraphShape } from './schema';
import { sameDigests, idPattern } from '../institutional/validation';
import { validateInstitutionalLegacyArchive } from '../institutional/legacyArchive';

/** Compare plain data without invoking accessors or skipping array holes.
 * Object-key order is immaterial; omissions and array order are payload data.
 * Bare undefined still represents an omitted source path, never a data property. */
export function sameAttemptData(a: unknown, b: unknown): boolean {
  const leftPath = new Set<object>(), rightPath = new Set<object>();
  const equal = (left: unknown, right: unknown, root = false): boolean => {
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
      return left === right && (left === null || typeof left === 'string' || typeof left === 'boolean'
        || (typeof left === 'number' && Number.isFinite(left) && !Object.is(left, -0))
        || (root && left === undefined));
    }
    const array = Array.isArray(left);
    if (array !== Array.isArray(right) || leftPath.has(left) || rightPath.has(right)) return false;
    for (const value of [left, right]) {
      const prototype = Object.getPrototypeOf(value);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    }
    const leftKeys = Reflect.ownKeys(left), rightKeys = Reflect.ownKeys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    if (array && (leftKeys.length !== Object.getOwnPropertyDescriptor(left, 'length')!.value + 1
      || rightKeys.length !== Object.getOwnPropertyDescriptor(right, 'length')!.value + 1)) return false;
    leftPath.add(left); rightPath.add(right);
    try {
      for (const key of leftKeys) {
        const l = Object.getOwnPropertyDescriptor(left, key), r = Object.getOwnPropertyDescriptor(right, key);
        if (typeof key === 'symbol' || !l || !r || !('value' in l) || !('value' in r)) return false;
        if (array && key === 'length') { if (l.value !== r.value) return false; continue; }
        if (!l.enumerable || !r.enumerable || (array && (!/^(0|[1-9][0-9]*)$/.test(key)
          || Number(key) >= Object.getOwnPropertyDescriptor(left, 'length')!.value))
          || !equal(l.value, r.value)) return false;
      }
      return true;
    } finally { leftPath.delete(left); rightPath.delete(right); }
  };
  try { return equal(a, b, true); }
  catch { return false; }
}
export function ownerKey(owner: ProgressOwner | null): string {
  if (owner === null) return 'unowned';
  if (owner.kind === 'attempt') return owner.attemptId;
  // Include the complete raw revision identity; never group by name/course/year.
  return JSON.stringify([owner.ref.entityKind, owner.ref.oldId, owner.ref.sourceRevisionId, owner.ref.sourceDigest,
    Object.entries(owner.ref.legacyDigests).sort(([a], [b]) => a.localeCompare(b))]);
}
export function attemptValidationResult(issues: AttemptValidationIssue[]): AttemptValidationResult {
  const sorted = [...issues].sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  return { valid: sorted.length === 0, issues: sorted };
}

/** Validate an independent graph against a trusted YI-02 master. No normalization, issuance or aggregation. */
export function validateAttemptGraph(value: unknown, context: AttemptValidationContext): AttemptValidationResult {
  const issues: AttemptValidationIssue[] = [];
  const error = (code: string, path: string, message: string) => { issues.push({ code, path, message }); };
  // Reject explicit undefined/non-JSON numbers as well as unknown keys. Nothing is stripped.
  const json = (v: unknown, path: string, seen: Set<object>) => {
    if (v === undefined || typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol'
      || (typeof v === 'number' && !Number.isFinite(v))) error('non_json_value', path, 'Value cannot be preserved as JSON');
    else if (v && typeof v === 'object') {
      if (seen.has(v)) { error('non_json_value', path, 'Cyclic input'); return; }
      const prototype = Object.getPrototypeOf(v);
      if (Array.isArray(v) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
        error('non_json_value', path, 'Expected a plain JSON object'); return;
      }
      if (Array.isArray(v) && Object.keys(v).length !== v.length) {
        error('non_json_value', path, 'Sparse arrays are not JSON data'); return;
      }
      seen.add(v);
      for (const k of Reflect.ownKeys(v)) {
        if (Array.isArray(v) && k === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(v, k)!;
        if (typeof k === 'symbol' || !descriptor.enumerable || !('value' in descriptor)
          || (Array.isArray(v) && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length))) {
          error('non_json_value', path, 'Only enumerable JSON data properties are supported');
          continue;
        }
        json(descriptor.value, `${path}/${k}`, seen);
      }
      seen.delete(v);
    }
  };
  try { json(value, '', new Set()); }
  catch { error('non_json_value', '', 'Unable to inspect JSON data'); }
  if (issues.length) return attemptValidationResult(issues);
  if (!validateAttemptGraphShape(value)) {
    for (const e of validateAttemptGraphShape.errors ?? []) error(`shape_${e.keyword}`, e.instancePath, `${e.message}: ${JSON.stringify(e.params)}`);
    return attemptValidationResult(issues);
  }
  const graph: AttemptGraph = value;
  const catalog = context.catalog;
  const unique = <T>(rows: readonly T[], key: (r: T) => string, path: string, code: string) => {
    const groups = new Map<string, T[]>();
    for (const row of rows) { const k = key(row); groups.set(k, [...(groups.get(k) ?? []), row]); }
    for (const [k, group] of groups) if (group.length > 1) error(code, `${path}/${k}`, 'Duplicate key; no winner selected');
    return new Map([...groups].filter(([, group]) => group.length === 1).map(([k, group]) => [k, group[0]]));
  };
  const attempts = unique(graph.attempts, a => a.id, '/attempts', 'duplicate_attempt_id');
  unique(graph.attempts, a => a.creationOperationId, '/creationOperations', 'duplicate_creation_operation');
  unique(graph.ownedRecords, r => r.id, '/ownedRecords', 'duplicate_owned_record_id');
  const removals = unique(graph.removals, r => r.operationId, '/removals', 'duplicate_removal_operation');
  unique(graph.removals, r => r.attemptSnapshot.id, '/removedAttempts', 'duplicate_removed_attempt');
  unique([...graph.attempts.map(a => a.creationOperationId), ...graph.removals.map(r => r.operationId)], s => s, '/operations', 'operation_collision');
  // UUID collisions across new namespaces and the pre-existing master are invalid too.
  const newIds = [...graph.attempts.map(a => a.id), ...graph.attempts.map(a => a.creationOperationId),
    ...graph.ownedRecords.map(r => r.id), ...graph.removals.map(r => r.operationId)];
  const masterIds = [...catalog.institutionalCourses, ...catalog.placements, ...catalog.curriculumVersions].map(r => r.id);
  unique([...newIds, ...masterIds], s => s.split(':').at(-1)!, '/uuid', 'uuid_collision');
  unique(context.officialAchievementIds, id => id, '/context/officialAchievementIds', 'duplicate_official_id');
  unique(context.officialStudyRecordIds, id => id, '/context/officialStudyRecordIds', 'duplicate_official_id');
  const courses = new Map(catalog.institutionalCourses.map(c => [c.id, c]));
  const placements = new Map(catalog.placements.map(p => [p.id, p]));
  const versions = new Map(catalog.curriculumVersions.map(v => [v.id, v]));
  const scopes = new Set(catalog.scopes.map(s => s.id));
  const auditIds = new Set(catalog.curriculumAudit.map(r => r.oldCurriculumCourseId));
  const evidenceIds = new Set([...catalog.placements.map(p => p.officialRow.evidenceId), ...catalog.notes.map(n => n.evidenceId), ...catalog.codes.map(c => c.evidenceId)]);
  if (context.legacyArchive) {
    try { validateInstitutionalLegacyArchive(catalog, context.legacyArchive); }
    catch (e) { error('invalid_legacy_archive', '/context/legacyArchive', e instanceof Error ? e.message : 'Invalid archive'); }
  }
  const document = (ref: DocumentEvidence, path: string) => {
    if (ref.sourceRevisionId !== catalog.sourceRevision.id) error('source_revision_mismatch', path, 'Unknown document revision');
    for (const id of ref.evidenceIds) if (!evidenceIds.has(id)) error('unknown_evidence', `${path}/${id}`, 'Unknown document evidence');
  };
  const legacy = (ref: AttemptLegacyRef, path: string) => {
    if (!idPattern(ref.entityKind === 'CurriculumCourse' ? 'curriculum:' : '').test(ref.oldId)) error('legacy_namespace', path, 'Wrong legacy ID format/namespace');
    if (ref.sourceRevisionId !== catalog.sourceRevision.id || ref.sourceDigest !== catalog.sourceRevision.sha256
      || !sameDigests(ref.legacyDigests, catalog.legacyDigests)) error('legacy_revision_mismatch', path, 'Requires the exact raw source revision and digest set');
    const exists = ref.entityKind === 'CurriculumCourse' ? auditIds.has(ref.oldId)
      : ref.entityKind === 'Mapping' ? catalog.placements.some(p => p.identityDecision.oldId === ref.oldId)
      : ref.entityKind === 'Offering' ? context.legacyArchive?.offeringEdges.some(o => o.offeringId === ref.oldId)
      : context.legacyArchive?.legacyCourseRelations.some(c => c.legacyCourseId === ref.oldId);
    if (ref.status === 'known' && !exists) error('unknown_legacy_id', path, 'Known legacy reference is missing or its archive is unavailable');
    if ((ref.status === 'unknown') !== (ref.reason !== null)) error('legacy_resolution_state', path, 'Unknown legacy reference requires a reason; known reference has no unresolved reason');
  };
  const evidence = (e: AttemptEvidence | null, path: string) => {
    if (e?.kind === 'document') document(e.ref, path);
    if (e?.kind === 'legacy') legacy(e.ref, path);
    if (e?.kind === 'official_detail' && !context.officialStudyRecordIds.includes(e.studyRecordId)) error('unknown_official_detail', path, 'Dangling official detail reference');
  };
  const validateAttempt = (a: Attempt, path: string) => {
    for (const resolution of [a.identity, a.placement]) for (const id of resolution.candidateAuditIds) {
      if (!auditIds.has(id)) error('unknown_audit_candidate', `${path}/candidates/${id}`, 'Candidate must name an audit identity, not an invented master');
    }
    for (const id of a.placement.candidatePlacementIds) if (!placements.has(id)) error('unknown_placement_candidate', `${path}/placement/${id}`, 'Dangling placement candidate');
    if (a.placement.ref && a.placement.candidatePlacementIds.some(id => id !== a.placement.ref?.placementId)) error('resolution_candidate_conflict', `${path}/placement`, 'Confirmed placement retains competing candidates');
    if (a.identity.ref) {
      const ref = a.identity.ref, c = courses.get(ref.institutionalCourseId);
      document(ref, `${path}/identity`);
      if (!c) error('unknown_course', `${path}/identity`, 'Dangling InstitutionalCourse reference');
      else if (a.identity.candidateAuditIds.some(id => id !== c.identityDecision.oldId)) error('resolution_candidate_conflict', `${path}/identity`, 'Confirmed identity retains competing audit candidates');
      if (c && !c.nameHistory.some(h => h.sourceRevisionId === ref.sourceRevisionId
        && ref.evidenceIds.every(id => h.evidenceIds.includes(id)))) error('course_evidence_mismatch', `${path}/identity`, 'Evidence is not bound to this course definition');
    }
    if (a.placement.ref) {
      const ref = a.placement.ref, p = placements.get(ref.placementId);
      document(ref, `${path}/placement`);
      if (!p) error('unknown_placement', `${path}/placement`, 'Dangling Placement reference');
      else {
        if (a.placement.candidateAuditIds.some(id => id !== p.auditRecord.oldCurriculumCourseId)) error('resolution_candidate_conflict', `${path}/placement`, 'Confirmed placement retains competing audit identities');
        if (p.kind !== 'course_placement' || p.methodConstraint.status !== 'safe' || p.auditRecord.placementStatus !== 'safe') error('unconfirmed_placement', `${path}/placement`, 'Bucket/conflict cannot be a confirmed course placement');
        if (p.curriculumVersionId !== ref.curriculumVersionId || p.scopeId !== ref.scopeId || p.sourceRevisionId !== ref.sourceRevisionId
          || !ref.evidenceIds.every(id => p.identityDecision.evidenceIds.includes(id))) error('placement_context_mismatch', `${path}/placement`, 'Version/scope/evidence does not match Placement');
        if (p.institutionalCourseId !== null && p.institutionalCourseId !== a.identity.ref?.institutionalCourseId) error('placement_identity_conflict', `${path}/placement`, 'Confirmed placement identity contradicts the Attempt identity');
        if (p.institutionalCourseId === null && a.identity.ref !== null) error('placement_identity_unresolved', `${path}/placement`, 'Unresolved master identity has no reviewed binding to the confirmed course');
      }
      if (!versions.has(ref.curriculumVersionId) || !scopes.has(ref.scopeId)) error('unknown_placement_context', `${path}/placement`, 'Unknown version/scope');
    }
    const app = a.applicability;
    if (app.evidence) document(app.evidence, `${path}/applicability`);
    if (app.status === 'unknown') {
      if (app.curriculumVersionId !== null || app.scopeId !== null || app.evidence !== null) error('unknown_applicability_ref', `${path}/applicability`, 'Unknown applicability retains originalValue, not a confirmed version');
    } else {
      const version = app.curriculumVersionId === null ? undefined : versions.get(app.curriculumVersionId);
      if (!version || app.scopeId === null || !scopes.has(app.scopeId)) error('unknown_applicability_context', `${path}/applicability`, 'Version/scope must exist');
      if (a.placement.ref && (a.placement.ref.curriculumVersionId !== app.curriculumVersionId || a.placement.ref.scopeId !== app.scopeId)) error('applicability_placement_conflict', `${path}/applicability`, 'Applicability differs from confirmed placement');
      if (app.status === 'confirmed' && (!app.evidence || version?.applicabilityStatus === 'unknown'
        || !version?.effectiveConditions.length || version.sourceRevisionId !== app.evidence.sourceRevisionId)) error('unreviewed_applicability', `${path}/applicability`, 'A documented slice or learner year is not confirmed applicability');
    }
    unique(a.legacyRefs, ref => JSON.stringify([ref.entityKind, ref.oldId]), `${path}/legacyRefs`, 'duplicate_legacy_ref');
    for (const ref of a.legacyRefs) {
      legacy(ref, `${path}/legacyRefs/${ref.entityKind}/${ref.oldId}`);
      // Check explicit contradictions only. Never use legacy relations to populate identity.
      const candidates = ref.entityKind === 'CurriculumCourse' ? [ref.oldId]
        : ref.entityKind === 'Mapping' ? catalog.placements.filter(p => p.identityDecision.oldId === ref.oldId).map(p => p.auditRecord.oldCurriculumCourseId)
        : ref.entityKind === 'Offering' ? context.legacyArchive?.offeringEdges.find(o => o.offeringId === ref.oldId)?.relation.candidateCurriculumCourseIds ?? []
        : context.legacyArchive?.legacyCourseRelations.find(c => c.legacyCourseId === ref.oldId)?.candidateCurriculumCourseIds ?? [];
      const decisions = catalog.crosswalk.filter(d => d.oldEntityKind === 'CurriculumCourse' && candidates.includes(d.oldId));
      if (a.identity.ref && decisions.length && decisions.length === candidates.length
        && decisions.every(d => d.status === 'safe' && d.adoptedStableId !== null)
        && !decisions.some(d => d.adoptedStableId === a.identity.ref?.institutionalCourseId)) error('legacy_identity_conflict', `${path}/legacyRefs/${ref.oldId}`, 'Explicit course disagrees with all safe legacy candidates');
      if (a.placement.ref && ref.entityKind === 'Mapping' && placements.get(a.placement.ref.placementId)?.identityDecision.oldId !== ref.oldId) error('legacy_placement_conflict', `${path}/legacyRefs/${ref.oldId}`, 'Explicit Mapping disagrees with placement');
      if (a.placement.ref && ref.entityKind === 'Offering') {
        const edge = context.legacyArchive?.offeringEdges.find(o => o.offeringId === ref.oldId);
        const oldMapping = placements.get(a.placement.ref.placementId)?.identityDecision.oldId;
        if (edge && oldMapping && !(edge.mappingIds as string[]).includes(oldMapping)) error('legacy_placement_conflict', `${path}/legacyRefs/${ref.oldId}`, 'Placement is outside the legacy Offering edges');
      }
    }
    if (a.membership.kind === 'active' && a.plan === null) error('active_without_plan', path, 'Active Attempt requires a plan');
    if (a.membership.kind === 'detached' && a.membership.reason === 'legacy_orphan' && (a.plan !== null || a.legacyRefs.length === 0)) error('invalid_orphan', path, 'Legacy orphan needs original reference and no invented plan');
    if (a.plan?.importedSourceCourseId && !context.officialAchievementIds.includes(a.plan.importedSourceCourseId)) error('unknown_official_achievement', `${path}/plan`, 'Dangling explicit source association');
    evidence(a.method.evidence, `${path}/method`);
    const expectedMethodEvidence = { learner: 'learner', legacy_reference: 'legacy', official_detail: 'official_detail', unknown: null };
    if ((a.method.evidence?.kind ?? null) !== expectedMethodEvidence[a.method.source]
      || (a.method.source === 'unknown' && a.method.value !== 'unknown')) error('method_provenance', `${path}/method`, 'Method value/source/evidence contradict each other');
    evidence(a.actualYear.evidence, `${path}/actualYear`);
    if (a.actualYear.source === 'unknown') {
      if (a.actualYear.value !== null || a.actualYear.evidence !== null) error('year_provenance', `${path}/actualYear`, 'Unknown actual year has no asserted value/evidence');
    } else if (a.actualYear.value === null || a.actualYear.evidence === null
      || (a.actualYear.source === 'manual' && a.actualYear.evidence.kind !== 'learner')
      || (a.actualYear.source === 'source' && !['document', 'official_detail'].includes(a.actualYear.evidence.kind))
      || (a.actualYear.source === 'inferred' && !a.actualYear.reason)) error('year_provenance', `${path}/actualYear`, 'Actual year needs independent matching evidence');
  };
  for (const a of graph.attempts) {
    const path = `/attempts/${a.id}`;
    validateAttempt(a, path);
    if (a.membership.kind === 'detached' && a.membership.reason === 'plan_deleted') {
      const removal = removals.get(a.membership.deletionOperationId);
      if (!removal || removal.attemptSnapshot.id !== a.id) error('missing_removal', path, 'Deleted plan requires its original Undo snapshot');
    }
  }
  for (const r of graph.removals) {
    const path = `/removals/${r.operationId}`, a = attempts.get(r.attemptSnapshot.id);
    validateAttempt(r.attemptSnapshot, `${path}/attemptSnapshot`);
    if (r.attemptSnapshot.membership.kind !== 'active') error('invalid_undo_snapshot', path, 'Undo snapshot must be the original active Attempt');
    if (!a || a.membership.kind !== 'detached' || a.membership.reason !== 'plan_deleted'
      || a.membership.deletionOperationId !== r.operationId) error('removal_owner_conflict', path, 'Removal must refer to its detached Attempt');
    if (a && !sameAttemptData({ ...a, membership: { kind: 'active' } }, r.attemptSnapshot)) error('undo_snapshot_mismatch', path, 'Detached record must preserve the original Attempt fields');
  }
  const singletonRecords = graph.ownedRecords.filter(r => r.kind !== 'todo');
  unique(singletonRecords, r => `${r.kind}:${ownerKey(r.owner)}`, '/owners', 'duplicate_owner_payload');
  unique(graph.ownedRecords.filter(r => r.kind === 'todo'), r => (r as Extract<AttemptOwnedRecord, { kind: 'todo' }>).payload.id, '/todos', 'duplicate_todo_id');
  for (const r of graph.ownedRecords) {
    const path = `/ownedRecords/${r.id}`;
    if (r.owner?.kind === 'attempt' && !attempts.has(r.owner.attemptId)) error('dangling_owner', path, 'Unknown or duplicate Attempt owner');
    if (r.owner?.kind === 'unresolved_legacy') {
      if (r.owner.ref.entityKind !== 'Offering') error('legacy_owner_kind', path, 'Old progress owner must retain its Offering reference');
      legacy(r.owner.ref, `${path}/owner`);
      // A remaining legacy payload beside the same type on an attached legacy Attempt is a competing owner.
      for (const other of singletonRecords) if (r.kind !== 'todo' && other.kind === r.kind && other.owner?.kind === 'attempt') {
        const a = attempts.get(other.owner.attemptId);
        if (a?.legacyRefs.some(ref => ownerKey({ kind: 'unresolved_legacy', ref, reason: '' }) === ownerKey(r.owner))) error('competing_legacy_owner', path, 'Legacy payload also claimed by an Attempt; cannot choose or copy it');
      }
    }
    if (r.kind === 'media') {
      unique(r.payload.lessons, l => String(l.lesson), `${path}/lessons`, 'duplicate_lesson');
      unique(r.payload.assessments, a => a.id, `${path}/assessments`, 'duplicate_assessment');
      if (r.payload.lessons.some(l => r.payload.totalLessons !== null && l.lesson > r.payload.totalLessons)) error('lesson_range', path, 'Lesson exceeds recorded total');
      for (const assessment of r.payload.assessments) if (assessment.scheduledDate !== null) {
        const d = assessment.scheduledDate;
        const date = new Date(`${d}T00:00:00Z`);
        if (d.slice(0, 4) === '0000' || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== d) error('assessment_date', `${path}/assessments/${assessment.id}`, 'Invalid calendar date');
      }
    }
    if (r.kind === 'correspondence') {
      unique(r.payload.reports, report => String(report.reportNumber), `${path}/reports`, 'duplicate_report');
      if (r.payload.reports.some(report => report.grade !== null && report.status !== 'passed')) error('report_grade_status', path, 'Report grade requires a passed report; extra saved reports are retained');
    }
  }
  return attemptValidationResult(issues);
}
