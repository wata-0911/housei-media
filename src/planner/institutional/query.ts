import type { Applicability, InstitutionalCatalog, IdentityDecision } from './types';

/** Exact text only; numeral/letter variants and identities are never normalized/merged. */
export function searchInstitutionalPlacements(catalog: InstitutionalCatalog, text = '') {
  return catalog.placements.filter(placement => placement.officialName.includes(text)
    || placement.officialRow.canonicalName.includes(text));
}

/** Browsing a documented version is separate from confirming a learner's applicability. */
export function placementsForContext(catalog: InstitutionalCatalog, context: {
  curriculumVersionId: string | null; scopeId: string | null; applicability: Applicability;
}) {
  if (context.scopeId === null || !catalog.scopes.some(scope => scope.id === context.scopeId)) {
    return { status: 'unknown_scope' as const, applicability: context.applicability, placements: [] };
  }
  if (context.curriculumVersionId === null || !catalog.curriculumVersions.some(version => version.id === context.curriculumVersionId)) {
    return { status: 'unknown_curriculum' as const, applicability: context.applicability, placements: [] };
  }
  return { status: 'documented_slice_only' as const, applicability: context.applicability,
    placements: catalog.placements.filter(p => p.scopeId === context.scopeId && p.curriculumVersionId === context.curriculumVersionId) };
}

/** Bare UUIDs, mismatched raw revisions and backup semantic digests cannot resolve. */
export function resolveInstitutionalLegacyRef(catalog: InstitutionalCatalog, ref: {
  oldEntityKind: IdentityDecision['oldEntityKind']; oldId: string; legacyDigest: string; sourceDigest: string;
}) {
  if (ref.sourceDigest !== catalog.sourceRevision.sha256) throw new Error('Institutional catalog: source digest mismatch');
  const row = catalog.crosswalk.find(candidate => candidate.oldEntityKind === ref.oldEntityKind && candidate.oldId === ref.oldId);
  if (!row || row.legacyDigest !== ref.legacyDigest) throw new Error('Institutional catalog: unknown legacy entity/revision');
  return row;
}
