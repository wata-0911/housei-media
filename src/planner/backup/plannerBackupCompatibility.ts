import type { PlannerCatalog } from '../plannerCatalog';
import { validateCatalog } from '../validation';
import { attachCurriculumCatalog } from '../catalog/curriculumCatalog';
import { createMappingResolver } from '../plannerHelpers';

export type BackupCatalogIdentity = { schemaVersion: 1; academicYear: 2026; snapshot: string; sha256: string };
export type BackupCatalogSnapshot = BackupCatalogIdentity & { compatibilityVersion: 1; semanticSha256: string; snapshotData: PlannerCatalog };

/** Immutable recognition of #95's first published v1 format. Keep this entry
 * when runtime catalogs change; hashes are not recomputed from a future catalog.
 * Source: dev cb70e4d9d995c58d94c65de3e70292037063b0bb enriched runtime catalog.
 * Unknown legacy catalogs must be explicitly archived before a migration exists. */
export const LEGACY_BACKUP_CATALOGS: ReadonlyArray<BackupCatalogIdentity & { semanticSha256: string }> = [
  { schemaVersion: 1, academicYear: 2026, snapshot: 'hosei-2026-v1-postgresql-import',
    sha256: 'd0dcb5b474dc638201b336d8eda291adf083d422e37dd88db860c26ad448f3e2',
    semanticSha256: 'ca8df7b7256c3db842be8c797d7169db1180658169f96d1e7ba2a6a014412dec' },
];

export function canonicalBackupJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBackupJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalBackupJson(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function backupDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalBackupJson(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function backupRawDigest(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const unique = (ids: string[]) => new Set(ids).size === ids.length;

/** Validate archived catalogs as untrusted data. Never install their rules as
 * the live graduation engine. Reuse catalog relation checks, not name inference. */
export function validateBackupCatalog(value: unknown): asserts value is PlannerCatalog {
  try {
    if (!validateCatalog(value) || value.schemaVersion !== 1 || value.academicYear !== 2026 || !value.curriculum) throw new Error();
    const { curriculum } = value;
    if (curriculum.schemaVersion !== 1 || curriculum.source !== 'official_curriculum_mappings_2026'
      || !Array.isArray(curriculum.courses) || !Array.isArray(curriculum.offeringRelations) || !Array.isArray(curriculum.legacyCourseRelations)) throw new Error();
    const scopes = new Set(value.programs.map(row => row.scopeId));
    const courses = new Set(value.courses.map(row => row.id));
    const institutional = new Set(curriculum.courses.map(row => row.id));
    if (![value.programs.map(row => row.scopeId), value.courses.map(row => row.id), value.mappings.map(row => row.mappingId), value.offerings.map(row => row.id), value.requirements.map(row => row.id), curriculum.courses.map(row => row.id)].every(unique)) throw new Error();
    if (!value.mappings.every(row => scopes.has(row.scopeId))
      || !value.offerings.every(row => row.courseId === null || courses.has(row.courseId))
      || !value.requirements.every(row => row.scopeId === null || scopes.has(row.scopeId))) throw new Error();
    const resolve = createMappingResolver(value);
    value.offerings.forEach(row => resolve(row));
    if (!curriculum.courses.every(row => typeof row.id === 'string' && typeof row.canonicalName === 'string'
      && (row.curriculumCredits === null || typeof row.curriculumCredits === 'number' && Number.isFinite(row.curriculumCredits) && row.curriculumCredits >= 0)
      && Array.isArray(row.mappingIds) && unique(row.mappingIds) && Array.isArray(row.scopeIds) && unique(row.scopeIds) && row.scopeIds.every(id => scopes.has(id)))) throw new Error();
    if (!unique(curriculum.legacyCourseRelations.map(row => row.legacyCourseId))
      || curriculum.legacyCourseRelations.length !== courses.size
      || !curriculum.legacyCourseRelations.every(row => courses.has(row.legacyCourseId)
        && (row.curriculumCourseId === null || institutional.has(row.curriculumCourseId))
        && Array.isArray(row.candidateCurriculumCourseIds) && unique(row.candidateCurriculumCourseIds) && row.candidateCurriculumCourseIds.every(id => institutional.has(id)))) throw new Error();
    const joined = attachCurriculumCatalog(value, curriculum);
    if (canonicalBackupJson(joined) !== canonicalBackupJson(value)) throw new Error();
  } catch { throw new Error('保存されたカタログの形式・参照・対応版が不正です。'); }
}

/** compatibilityVersion=1: identity migration only. Every calculation-bearing
 * field and every array order is retained. Ignore ONLY source citations and
 * program displayName. Unknown fields remain in the semantic digest, so new
 * semantics fail closed until a versioned rule exists. Even additive changes
 * require a future explicit rule; this release does not guess their effects. */
export function backupCatalogSemantics(catalog: PlannerCatalog): unknown {
  const copy = structuredClone(catalog);
  for (const row of [...copy.offerings, ...copy.mappings]) row.source = { url: null, page: null };
  for (const row of copy.programs) row.displayName = '';
  return copy;
}

export async function backupCatalogIdentity(catalog: PlannerCatalog): Promise<BackupCatalogIdentity> {
  return { schemaVersion: catalog.schemaVersion, academicYear: catalog.academicYear, snapshot: catalog.generatedFromSnapshot, sha256: await backupDigest(catalog) };
}
export async function createBackupCatalogSnapshot(catalog: PlannerCatalog): Promise<BackupCatalogSnapshot> {
  validateBackupCatalog(catalog);
  const snapshotData = structuredClone(catalog);
  return { ...await backupCatalogIdentity(snapshotData), compatibilityVersion: 1, semanticSha256: await backupDigest(backupCatalogSemantics(snapshotData)), snapshotData };
}

export async function verifyBackupCatalogSnapshot(value: unknown): Promise<BackupCatalogSnapshot> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('カタログ情報が不正です。');
  const info = value as Record<string, unknown>;
  if (Object.keys(info).sort().join(',') !== 'academicYear,compatibilityVersion,schemaVersion,semanticSha256,sha256,snapshot,snapshotData' || info.compatibilityVersion !== 1) throw new Error('カタログ互換性規則の版が未対応です。');
  validateBackupCatalog(info.snapshotData);
  const expected = await createBackupCatalogSnapshot(info.snapshotData);
  if (canonicalBackupJson(info) !== canonicalBackupJson(expected)) throw new Error('カタログ原版のSHA・識別情報が一致しません。');
  return info as BackupCatalogSnapshot;
}

/** Validate source integrity AND target semantics. A different SHA is accepted
 * only by explicit v1 semantic equivalence, followed by state validation at both
 * boundaries. No credit conversion, matching, repair or schema migration. */
export async function checkBackupCatalogCompatibility(value: unknown, backupVersion: 1 | 2, target: PlannerCatalog): Promise<PlannerCatalog | null> {
  validateBackupCatalog(target);
  const targetInfo = await backupCatalogIdentity(target);
  const targetSemantic = await backupDigest(backupCatalogSemantics(target));
  if (backupVersion === 2) {
    const source = await verifyBackupCatalogSnapshot(value);
    if (source.semanticSha256 !== targetSemantic) throw new Error('カタログの単位・identity・要件等に互換性のない変更があります。この原版を保持し、対応する明示的なmigration版が提供されるまで復元しないでください。');
    return source.snapshotData;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'academicYear,schemaVersion,sha256,snapshot') throw new Error('旧v1カタログ情報が不正です。');
  if (canonicalBackupJson(value) === canonicalBackupJson(targetInfo)) return target;
  const source = LEGACY_BACKUP_CATALOGS.find(entry => canonicalBackupJson({ schemaVersion: entry.schemaVersion, academicYear: entry.academicYear, snapshot: entry.snapshot, sha256: entry.sha256 }) === canonicalBackupJson(value));
  if (!source || source.semanticSha256 !== targetSemantic) throw new Error('旧v1のカタログ原版を確認できないか、互換性がありません。元ファイルを保持し、作成時の版または明示的なmigration対応が必要です。');
  return null; // Archived full hash anchors the known original semantic contract.
}
