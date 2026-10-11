import issuedData from '../../data/institutional_issuance_baseline.json';
import type { InstitutionalInput, InstitutionalRegistry } from './types';
import { normalizeInstitutionalCanonicalName } from './canonicalName';

type RegistryCourse = InstitutionalRegistry['institutionalCourses'][number];
type RegistryPlacement = InstitutionalRegistry['placements'][number];
type RegistryVersion = InstitutionalRegistry['curriculumVersions'][number];

/** Independently pinned issuance evidence, NOT a projection of the registry being
 * validated. Synthetic callers supply their own pre-existing expected bindings. */
export type InstitutionalIssuanceBaseline = {
  baselineVersion: number;
  auditedCommit: string;
  registrySha256: string;
  curriculumCrosswalkSha256: string;
  sourceRevisionId: string;
  sourceDigest: string;
  curriculumVersions: ReadonlyArray<Pick<RegistryVersion, 'issuanceRequestId' | 'id' | 'sourceRevisionId'>>;
  institutionalCourses: ReadonlyArray<Pick<RegistryCourse, 'issuanceRequestId' | 'id' | 'oldCurriculumCourseId' | 'evidenceIds'> & { canonicalName: string }>;
  placements: ReadonlyArray<Pick<RegistryPlacement, 'issuanceRequestId' | 'id' | 'oldMappingId' | 'curriculumVersionId' | 'scopeId' | 'placementRoleKey' | 'evidenceId'>>;
};

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const yi02IssuanceBaseline: InstitutionalIssuanceBaseline = freeze(structuredClone(issuedData));

function projection(record: object, fields: string[]): string {
  const values = new Map(Object.entries(record));
  return JSON.stringify(fields.map(key => {
    const value: unknown = values.get(key);
    return Array.isArray(value) ? [...value].sort() : value;
  }));
}
function compareIssued<T extends { issuanceRequestId: string }>(kind: string, actual: readonly T[], expected: readonly T[], fields: string[]) {
  const pinned = new Map(expected.map(entry => [entry.issuanceRequestId, entry]));
  if (pinned.size !== expected.length || actual.length !== expected.length) {
    throw new Error(`Institutional catalog: fixed issuance coverage mismatch: ${kind}`);
  }
  for (const entry of actual) {
    const original = pinned.get(entry.issuanceRequestId);
    if (!original || projection(entry, fields) !== projection(original, fields)) {
      throw new Error(`Institutional catalog: fixed issuance mismatch: ${kind}: ${entry.issuanceRequestId}`);
    }
  }
}

/** Bind valid, unique IDs to their audited origin. Reordering records is harmless;
 * swapping IDs/requests or rewriting the origin of an issued ID is rejected. */
export function validateRegistryBaseline(input: InstitutionalInput, registry: InstitutionalRegistry, baseline: InstitutionalIssuanceBaseline): void {
  if (baseline.baselineVersion !== 1 || registry.sourceRevision.id !== baseline.sourceRevisionId
    || registry.sourceRevision.sha256 !== baseline.sourceDigest) {
    throw new Error('Institutional catalog: fixed issuance source/baseline revision mismatch');
  }
  compareIssued('CurriculumVersion', registry.curriculumVersions, baseline.curriculumVersions, ['id', 'sourceRevisionId']);
  compareIssued('InstitutionalCourse', registry.institutionalCourses, baseline.institutionalCourses, ['id', 'oldCurriculumCourseId', 'evidenceIds']);
  compareIssued('CurriculumPlacement', registry.placements, baseline.placements,
    ['id', 'oldMappingId', 'curriculumVersionId', 'scopeId', 'placementRoleKey', 'evidenceId']);
  const names = new Map(input.curriculumRows.map(row => [row.oldCurriculumCourseId, row.canonicalName]));
  for (const issued of baseline.institutionalCourses) {
    const name = names.get(issued.oldCurriculumCourseId);
    if (name === undefined || normalizeInstitutionalCanonicalName(name) !== normalizeInstitutionalCanonicalName(issued.canonicalName)) {
      throw new Error(`Institutional catalog: fixed canonical name mismatch: ${issued.oldCurriculumCourseId}`);
    }
  }
}
