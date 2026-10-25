import { normalizeInstitutionalCanonicalName } from './canonicalName';
import { placementsForContext, searchInstitutionalPlacements } from './query';
import type {
  CurriculumPlacement, CurriculumVersion, InstitutionalCatalog, InstitutionalCourse,
  InstitutionalScope, OfficialCode, OfficialNote, SourceRevision,
} from './types';

/** An explicit document slice, never inferred from a learner's planned year. */
export type InstitutionalSearchTarget = {
  curriculumVersionId: string;
  sourceRevisionId: string;
  sourceDigest: string;
};
export type InstitutionalSearchRequest = {
  text?: string;
  /** Exact audited code; teacher-only evidence requires explicit teacher use. */
  officialCode?: { value: string; usage: 'undergraduate' | 'teacher' };
  scope: { kind: 'all' } | { kind: 'scope'; scopeId: string; includeCommon?: boolean };
  category?: string;
  field?: string | null;
  requirementType?: string;
  eligibleYear?: number;
};
export type InstitutionalSearchRow = {
  /** One row per placement, including unresolved identities and non-course buckets. */
  placement: CurriculumPlacement;
  institutionalCourse: InstitutionalCourse | null;
  scope: InstitutionalScope;
  curriculumVersion: CurriculumVersion;
  sourceRevision: SourceRevision;
  notes: OfficialNote[];
  /** Raw audit channels, including inapplicable evidence; not eligibility or
   * a list of evidence accepted by the code-search predicate. */
  codeEvidence: {
    status: CurriculumPlacement['auditRecord']['codeStatus'];
    undergraduate: OfficialCode[];
    teacher: OfficialCode[];
    /** Name-only candidates are evidence, never code-search or identity proof. */
    nameOnlyCandidates: OfficialCode[];
  };
};
export type InstitutionalSearchResponse = {
  status: 'documented_slice_only' | 'unknown_curriculum' | 'unknown_scope' | 'revision_mismatch';
  target: InstitutionalSearchTarget;
  rows: InstitutionalSearchRow[];
};
export type InstitutionalSearchAdapter = {
  search(request: InstitutionalSearchRequest): InstitutionalSearchResponse;
};

const codeKey = (text: string) => text.normalize('NFKC').trim();
// YI-01 official-codes.md p.199-202 and mapping-crosswalk.json audit pairs.
// The loader validates officialRow.scope against the registry Placement scope.
// These are exact labels, not a prefix rule or permission for future scopes.
const undergraduateCodeScopes = new Map<string, string>([
  ['common', 'common'], ['法律', '法律'], ['史学', '史学'],
  ['地理', '地理'], ['経済', '経済'], ['商業', '商業'],
  ['日文文学', '日文'], ['日文言語', '日文'], ['日文芸能', '日文'],
]);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Accept only a catalog validated by YI-02's loader. Snapshot ownership prevents
 * callers from changing the evidence after adapter creation or via search results.
 * No registration, applicability, offering or graduation eligibility is inferred. */
export function createInstitutionalSearchAdapter(
  catalog: InstitutionalCatalog, target: InstitutionalSearchTarget,
): InstitutionalSearchAdapter {
  const master = structuredClone(catalog);
  const pinnedTarget = structuredClone(target);
  return { search(request) {
    const response = (status: InstitutionalSearchResponse['status'], rows: InstitutionalSearchRow[] = []): InstitutionalSearchResponse =>
      structuredClone({ status, target: pinnedTarget, rows });
    const version = master.curriculumVersions.find(v => v.id === pinnedTarget.curriculumVersionId);
    if (!version) return response('unknown_curriculum');
    if (version.sourceRevisionId !== pinnedTarget.sourceRevisionId
      || master.sourceRevision.id !== pinnedTarget.sourceRevisionId
      || master.sourceRevision.sha256 !== pinnedTarget.sourceDigest) return response('revision_mismatch');

    let placements: CurriculumPlacement[];
    if (request.scope.kind === 'all') {
      placements = master.placements.filter(p => p.curriculumVersionId === version.id);
    } else {
      const selectedScope = request.scope;
      const slice = placementsForContext(master, {
        curriculumVersionId: version.id, scopeId: selectedScope.scopeId, applicability: 'unknown',
      });
      if (slice.status === 'unknown_scope') return response('unknown_scope');
      placements = slice.placements;
      if (selectedScope.includeCommon !== false) {
        const commonIds = new Set(master.scopes.filter(s => s.officialScopeLabel === 'common').map(s => s.id));
        placements = master.placements.filter(p => p.curriculumVersionId === version.id
          && (p.scopeId === selectedScope.scopeId || commonIds.has(p.scopeId)));
      }
    }
    const needle = normalizeInstitutionalCanonicalName(request.text ?? '');
    // Retain the exact YI-02 search and extend only comparison, never identity.
    const exactIds = new Set(searchInstitutionalPlacements(master, request.text ?? '').map(p => p.id));
    const rows: InstitutionalSearchRow[] = [];
    for (const placement of placements) {
      if (!exactIds.has(placement.id)
        && ![placement.officialName, placement.officialRow.canonicalName]
          .some(name => normalizeInstitutionalCanonicalName(name).includes(needle))) continue;
      if (request.category !== undefined && placement.category !== request.category) continue;
      if (request.field !== undefined && placement.field !== request.field) continue;
      if (request.requirementType !== undefined && placement.requirementType !== request.requirementType) continue;
      if (request.eligibleYear !== undefined && !placement.officialRow.eligibleYears?.includes(request.eligibleYear)) continue;
      const evidence = (ids: string[]) => master.codes.filter(code => ids.includes(code.evidenceId));
      const undergraduate = evidence(placement.auditRecord.mainCodeEvidenceIds);
      const teacher = evidence(placement.auditRecord.teacherCodeEvidenceIds);
      if (request.officialCode) {
        const key = codeKey(request.officialCode.value);
        const undergraduateScope = undergraduateCodeScopes.get(placement.officialRow.scope);
        const matched = request.officialCode.usage === 'teacher'
          // teacher_only is the audited usage domain, not a learner eligibility decision.
          ? teacher.some(c => c.scope === 'teacher_only' && c.codes.some(code => codeKey(code) === key))
          : undergraduateScope !== undefined && placement.auditRecord.mainCodes.some(code => codeKey(code) === key)
            && undergraduate.some(c => undergraduateScope === c.scope
              && c.codes.some(code => codeKey(code) === key));
        if (!key || !matched) continue;
      }
      rows.push({ placement,
        institutionalCourse: placement.kind === 'course_placement' && placement.identityDecision.status === 'safe'
          ? master.institutionalCourses.find(c => c.id === placement.institutionalCourseId) ?? null : null,
        scope: master.scopes.find(s => s.id === placement.scopeId)!, curriculumVersion: version,
        sourceRevision: master.sourceRevision,
        notes: master.notes.filter(note => placement.noteIds.includes(note.evidenceId)),
        codeEvidence: { status: placement.auditRecord.codeStatus, undergraduate, teacher,
          nameOnlyCandidates: evidence(placement.auditRecord.sameNameCodeCandidateEvidenceIds) },
      });
    }
    // No locale/runtime dependent collation and no dependence on input array order.
    rows.sort((a, b) => compare(normalizeInstitutionalCanonicalName(a.placement.officialRow.canonicalName),
      normalizeInstitutionalCanonicalName(b.placement.officialRow.canonicalName))
      || compare(a.placement.scopeId, b.placement.scopeId)
      || compare(a.placement.placementRoleKey, b.placement.placementRoleKey)
      || compare(a.placement.id, b.placement.id));
    return response('documented_slice_only', rows);
  } };
}
