import type { InstitutionalInput, InstitutionalRegistry } from './types';
import { normalizeInstitutionalCanonicalName } from './canonicalName';
import { validateRegistryBaseline, yi02IssuanceBaseline, type InstitutionalIssuanceBaseline } from './registryBaseline';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const idPattern = (namespace: string) => new RegExp(`^${namespace}${uuid}$`);
export function requireInvariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Institutional catalog: ${message}`);
}
export function uniqueIndex<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    requireInvariant(typeof id === 'string' && id.length > 0 && !result.has(id), `duplicate/invalid ID: ${id}`);
    result.set(id, row);
  }
  return result;
}
export function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));
}
export function sameDigests(a: Record<string, string>, b: Record<string, string>): boolean {
  return sameSet(Object.keys(a), Object.keys(b)) && Object.keys(a).every(key => a[key] === b[key]);
}

/** Validate against a trusted, issuance-time registry, never against annual offerings.
 * Callers must supply measured raw-file digests, not backup v2 semantic digests. */
export function validateInstitutionalInput(input: InstitutionalInput, registry: InstitutionalRegistry, baseline: InstitutionalIssuanceBaseline = yi02IssuanceBaseline): void {
  requireInvariant(input.auditVersion === 1 && registry.auditVersion === 1 && registry.registryVersion === 1, 'unsupported audit/registry version');
  requireInvariant(input.sourceDigest === registry.sourceRevision.sha256 && /^[0-9a-f]{64}$/.test(input.sourceDigest), 'source digest mismatch');
  requireInvariant(sameDigests(input.legacyDigests, registry.legacyDigests), 'legacy raw digest set mismatch');
  const cc = uniqueIndex(input.curriculumRows, r => r.oldCurriculumCourseId);
  const mappings = uniqueIndex(input.mappingRows, r => r.oldMappingId);
  const rows = uniqueIndex(input.officialRows, r => r.evidenceId);
  const scopes = uniqueIndex(registry.scopes, r => r.id);
  const versions = uniqueIndex(registry.curriculumVersions, r => r.id);
  const courses = uniqueIndex(registry.institutionalCourses, r => r.id);
  const placements = uniqueIndex(registry.placements, r => r.id);
  const issued = [...registry.institutionalCourses, ...registry.curriculumVersions, ...registry.placements];
  uniqueIndex(issued, r => r.issuanceRequestId);
  uniqueIndex(issued, r => r.id.split(':').at(-1)!); // UUID collisions across namespaces also stop loading.
  const evidence = uniqueIndex([...input.officialRows, ...input.notes, ...input.codes], r => r.evidenceId);
  for (const row of evidence.values()) requireInvariant((!('sourceDigest' in row) || row.sourceDigest === input.sourceDigest) && row.quality === 'image_verified'
    && row.pdfPage === row.printedPage + registry.sourceRevision.printedToPdfOffset, `invalid source/locator: ${row.evidenceId}`);
  for (const scope of scopes.values()) requireInvariant(idPattern('').test(scope.id), `unknown scope namespace: ${scope.id}`);
  for (const version of versions.values()) {
    requireInvariant(idPattern('hosei:cv:').test(version.id) && version.sourceRevisionId === registry.sourceRevision.id, 'invalid curriculum version reference/namespace');
    requireInvariant(version.definitionStatus === 'documented_slice' && version.applicabilityStatus === 'unknown'
      && version.applicableTo === null && version.effectiveConditions.length === 0 && version.unverifiedAreas.length > 0, 'unreviewed curriculum applicability');
  }
  for (const course of courses.values()) {
    requireInvariant(idPattern('curriculum:').test(course.id) || idPattern('hosei:ic:').test(course.id), `unknown course namespace: ${course.id}`);
    requireInvariant(course.issuanceRequestId === `yi-01:adopt:${course.oldCurriculumCourseId}`, 'course issuance request mismatch');
    const decision = cc.get(course.oldCurriculumCourseId);
    // This YI-01 slice has no newly evidenced IC issuance. A new namespace does not bypass adoption review.
    requireInvariant(decision?.status === 'safe' && decision.adoptedStableId === course.id
      && sameSet(course.evidenceIds, decision.evidenceIds), `unreviewed IC adoption: ${course.id}`);
  }
  const rules: Record<string, string[]> = { safe: ['S-ROW'], ambiguous: ['A-GROUP', 'A-PEER', 'A-ORDER'], conflict: ['C-METHOD'], unmatched: ['U-BUCKET'] };
  for (const decision of [...input.curriculumRows, ...input.mappingRows]) {
    const oldId = 'oldMappingId' in decision ? decision.oldMappingId : decision.oldCurriculumCourseId;
    requireInvariant(idPattern('oldMappingId' in decision ? '' : 'curriculum:').test(oldId), `invalid old entity namespace: ${oldId}`);
    const legacyPath = 'oldMappingId' in decision ? 'src/data/planner_catalog_2026.json' : 'src/data/planner_curriculum_2026.json';
    requireInvariant(decision.sourceDigest === input.sourceDigest && decision.legacyDigest === input.legacyDigests[legacyPath], 'crosswalk digest mismatch');
    requireInvariant(rules[decision.status]?.includes(decision.ruleId) && decision.ruleVersion === 1
      && decision.historicalContinuityStatus === 'unverified' && decision.reason.length > 0, 'invalid decision/rule/continuity');
    requireInvariant(decision.candidateStableIds.length > 0 && new Set(decision.candidateStableIds).size === decision.candidateStableIds.length
      && decision.candidateStableIds.every(id => cc.has(id)), 'dangling/duplicate audit candidate');
    if (decision.status === 'safe') requireInvariant(decision.candidateStableIds.length === 1 && decision.adoptedStableId === decision.candidateStableIds[0]
      && courses.has(decision.adoptedStableId), 'unsafe stable adoption');
    else requireInvariant(decision.adoptedStableId === null, 'non-safe stable adoption');
  }
  const usedMappings: string[] = [];
  for (const decision of cc.values()) {
    requireInvariant(decision.evidenceIds.length > 0 && decision.evidenceIds.every(id => evidence.has(id)), 'dangling course evidence');
    requireInvariant(decision.peerCurriculumCourseIds.every(id => cc.has(id)), 'dangling peer candidate');
    requireInvariant(decision.scopeIds.length > 0 && decision.scopeIds.every(id => scopes.has(id)), 'dangling course scope');
    requireInvariant(decision.mappingIds.length > 0, 'empty mapping membership');
    usedMappings.push(...decision.mappingIds);
    for (const id of decision.mappingIds) {
      const mapping = mappings.get(id);
      requireInvariant(mapping && mapping.oldCurriculumCourseId === decision.oldCurriculumCourseId
        && decision.scopeIds.includes(mapping.scopeId) && mapping.status === decision.status
        && mapping.adoptedStableId === decision.adoptedStableId && sameSet(mapping.candidateStableIds, decision.candidateStableIds)
        && mapping.officialEvidenceIds.every(ref => decision.evidenceIds.includes(ref)), 'invalid member/identity gate');
      requireInvariant(normalizeInstitutionalCanonicalName(mapping.canonicalName) === normalizeInstitutionalCanonicalName(decision.canonicalName),
        `curriculum/mapping canonical name mismatch: ${id}`);
    }
    requireInvariant(sameSet(decision.scopeIds, [...new Set(decision.mappingIds.map(id => mappings.get(id)!.scopeId))])
      && sameSet(decision.evidenceIds.filter(id => rows.has(id)), decision.mappingIds.flatMap(id => mappings.get(id)!.officialEvidenceIds)), 'incomplete course scope/evidence');
    if (decision.status === 'safe') requireInvariant(decision.peerCurriculumCourseIds.length === 0
      && new Set(decision.evidenceIds.filter(id => rows.has(id)).map(id => normalizeInstitutionalCanonicalName(rows.get(id)!.canonicalName))).size === 1, 'ambiguous safe identity');
  }
  requireInvariant(sameSet(usedMappings, [...mappings.keys()]), 'incomplete mapping partition');
  for (const row of rows.values()) requireInvariant(row.officialLabel.length > 0 && row.canonicalName.length > 0
    && row.bbox.length === 4 && row.bbox.every(Number.isFinite) && Number.isInteger(row.row) && row.row > 0, 'invalid physical row locator/name');
  const usedRows: string[] = [];
  for (const mapping of mappings.values()) {
    requireInvariant(mapping.officialRowMatchStatus === 'safe' && mapping.officialEvidenceIds.length === 1, 'invalid row match');
    const row = rows.get(mapping.officialEvidenceIds[0]);
    const scope = scopes.get(mapping.scopeId);
    const old = mapping.legacySnapshot;
    requireInvariant(row && scope && row.scope === scope.officialScopeLabel && old.scopeId === mapping.scopeId
      && old.mappingId === mapping.oldMappingId && old.source.page === row.printedPage, 'dangling/mismatched placement source/scope');
    requireInvariant(normalizeInstitutionalCanonicalName(row.canonicalName) === normalizeInstitutionalCanonicalName(mapping.canonicalName),
      `official/mapping canonical name mismatch: ${mapping.oldMappingId}`);
    usedRows.push(row.evidenceId);
    requireInvariant(['faculty', 'department', 'course'].every(key => old[key as keyof typeof old] === scope[key as keyof typeof scope]), 'scope definition mismatch');
    requireInvariant((row.curriculumCredits === null || (Number.isFinite(row.curriculumCredits) && row.curriculumCredits >= 0))
      && ['curriculumCredits', 'category', 'field', 'requirementType', 'eligibleYears'].every(key =>
        JSON.stringify(row[key as keyof typeof row]) === JSON.stringify(old[key as keyof typeof old])), 'placement definition mismatch');
    requireInvariant(mapping.placementStatus === (mapping.status === 'conflict' ? 'conflict' : 'safe')
      && (Object.keys(mapping.differences).length > 0) === (mapping.status === 'conflict'), 'lost placement conflict');
    requireInvariant([null, 'schooling', 'media'].includes(row.requiredMethod)
      && (!(row.requirementType.startsWith('スクーリング')) || row.requiredMethod === 'schooling'), 'invalid method constraint');
    const refs = [...mapping.mainCodeEvidenceIds, ...mapping.teacherCodeEvidenceIds, ...mapping.sameNameCodeCandidateEvidenceIds];
    requireInvariant(refs.every(id => evidence.has(id)), 'dangling code evidence');
    for (const id of mapping.mainCodeEvidenceIds) requireInvariant(input.codes.some(code => code.evidenceId === id && code.scope !== 'teacher_only'), 'teacher code used as main evidence');
  }
  requireInvariant(sameSet(usedRows, [...rows.keys()]), 'incomplete official row coverage');
  const placementKeys: string[] = [];
  const usedPlacementMappings: string[] = [];
  for (const placement of placements.values()) {
    const mapping = mappings.get(placement.oldMappingId);
    requireInvariant(idPattern('hosei:cp:').test(placement.id) && versions.has(placement.curriculumVersionId)
      && mapping && mapping.scopeId === placement.scopeId, 'dangling placement/unknown namespace');
    requireInvariant(mapping.officialEvidenceIds[0] === placement.evidenceId, 'placement evidence mismatch');
    const row = rows.get(placement.evidenceId)!;
    requireInvariant(placement.placementRoleKey === `${row.table}:${row.evidenceId}`, 'placement role mismatch');
    requireInvariant(placement.issuanceRequestId === `yi-02:placement:${placement.oldMappingId}`, 'placement issuance request mismatch');
    usedPlacementMappings.push(placement.oldMappingId);
    placementKeys.push(JSON.stringify([placement.curriculumVersionId, placement.scopeId, placement.placementRoleKey]));
  }
  requireInvariant(new Set(placementKeys).size === placementKeys.length, 'duplicate placement role');
  requireInvariant(sameSet(usedPlacementMappings, [...mappings.keys()]), 'incomplete placement registry');
  requireInvariant(sameSet([...courses.keys()], input.curriculumRows.filter(r => r.status === 'safe').map(r => r.adoptedStableId!)), 'incomplete safe registry');
  validateRegistryBaseline(input, registry, baseline);
}
