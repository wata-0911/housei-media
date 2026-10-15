import Ajv2020 from 'ajv/dist/2020';
import schema from '../../planner_catalog_2026.schema.json';
import { catalog as pinnedCatalog } from '../../catalog/catalog';
import { loadYi01InstitutionalCatalog } from '../../institutional/yi01';
import legacyData from '../../../../docs/planner-yi-01/legacy-relations.json';
import { validateInstitutionalLegacyArchive } from '../../institutional/legacyArchive';
import { validateBackupState } from '../../backup/plannerBackup';
import { validateState } from '../../validation';
import { loadState, STORAGE_KEY } from '../../backup/storage';
import { sameAttemptData } from '../validation';
import { backupCatalogIdentity, backupCatalogSemantics, backupDigest, backupRawDigest, checkBackupCatalogCompatibility,
  LEGACY_BACKUP_CATALOGS, validateBackupCatalog, verifyBackupCatalogSnapshot } from '../../backup/plannerBackupCompatibility';
import type { PlannerCatalog, PlannerState } from '../../plannerCatalog';
import type { LegacyArchive } from '../../institutional/types';
import { freeze, RULE, type DecodeResult, type SourceArchive } from './contracts';

// Close formerly permissive nested objects without adding defaults or required optional fields.
const closedSchema = structuredClone(schema);
function close(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(close); return; }
  const node = value as Record<string, unknown>;
  if (node.properties && node.additionalProperties === undefined) node.additionalProperties = false;
  Object.values(node).forEach(close);
}
close(closedSchema);
const ajv = new Ajv2020({ allErrors: true });
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const shape = ajv.compile({ ...closedSchema, $ref: '#/$defs/PlannerState' });

/** JSON.parse alone loses duplicate fields and rounds unsafe integers before validation. */
export function parseMigrationJson(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  const tokens = raw.match(/"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,]/g)!;
  let index = 0;
  const visit = (): void => {
    const token = tokens[index++];
    if (token === '{') {
      const keys = new Set<string>();
      if (tokens[index] !== '}') do {
        const key = JSON.parse(tokens[index++]) as string;
        if (keys.has(key)) throw new Error('duplicate_json_key');
        keys.add(key); index++; visit();
      } while (tokens[index++] === ',');
      else index++;
    } else if (token === '[') {
      if (tokens[index] !== ']') do { visit(); } while (tokens[index++] === ',');
      else index++;
    } else if (/^-?\d/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value) || Object.is(value, -0) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('unrepresentable_json_number');
    }
  };
  visit(); return parsed;
}

type Environment = { rawFiles: Record<string, string>; origin: PlannerCatalog; target: PlannerCatalog;
  catalog: ReturnType<typeof loadYi01InstitutionalCatalog>; legacyArchive: LegacyArchive };
const environments = new WeakSet<object>(), decoded = new WeakSet<object>();
export function requireDecoded(source: SourceArchive): void {
  if (!decoded.has(source)) throw new Error('unvalidated_source: decode the original raw text first');
}

/** Explicit opt-in boundary; raw six-file contents are measured, never trusted digest labels.
 * Original runtime snapshot is independently pinned by the immutable v1 registry. */
export async function prepareMigrationEnvironment(rawFiles: Record<string, string>, target: PlannerCatalog = pinnedCatalog): Promise<Environment> {
  const files = structuredClone(rawFiles), original = structuredClone(pinnedCatalog), targetCopy = structuredClone(target);
  const master = loadYi01InstitutionalCatalog();
  if (!sameAttemptData(Object.keys(files).sort(), Object.keys(master.legacyDigests).sort())) throw new Error('raw_archive_coverage');
  for (const [path, digest] of Object.entries(master.legacyDigests)) {
    if (typeof files[path] !== 'string' || await backupRawDigest(files[path]) !== digest) throw new Error(`raw_archive_digest: ${path}`);
  }
  const identity = await backupCatalogIdentity(original);
  const registered = LEGACY_BACKUP_CATALOGS.find(row => row.sha256 === identity.sha256);
  if (!registered || await backupDigest(backupCatalogSemantics(original)) !== registered.semanticSha256) throw new Error('fixed_origin_unavailable');
  await checkBackupCatalogCompatibility(identity, 1, targetCopy);
  const archive = structuredClone(legacyData) as LegacyArchive;
  validateInstitutionalLegacyArchive(master, archive);
  const environment = freeze({ rawFiles: files, origin: original, target: targetCopy, catalog: master, legacyArchive: archive });
  environments.add(environment); return environment;
}

/** local-v22 has no embedded provenance: caller MUST supply the catalog it was saved against.
 * Backups use their own envelope. All failures retain the exact original text. */
export async function decodeMigrationSource(raw: string, environment: Environment, localCatalog?: PlannerCatalog): Promise<DecodeResult> {
  let stage = 'source_json';
  const fail = (status: 'held' | 'rejected', code: string, message: string): DecodeResult => ({ status, raw, diagnostics: [{ code, path: '', message }] });
  try {
    if (!environments.has(environment)) throw new Error('unvalidated_environment');
    const value = parseMigrationJson(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('rejected', 'source_shape', 'Expected state22 or backup v1/v2');
    const input = value as Record<string, unknown>;
    if (input.format === 'hosei-planner-protection') return fail('rejected', 'protection_not_migratable', 'Preserve protection original; this is not a normal backup');
    let state: unknown, origin: PlannerCatalog, metadata: unknown, kind: SourceArchive['kind'];
    stage = 'source_version';
    if (Object.hasOwn(input, 'format')) {
      if (input.format !== 'hosei-planner-backup' || ![1, 2].includes(input.backupVersion as number)
        || Object.keys(input).sort().join(',') !== 'backupVersion,catalog,createdAt,format,state') throw new Error('Supported: hosei-planner-backup v1/v2 only');
      if (typeof input.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.createdAt)
        || !Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt) throw new Error('Invalid backup createdAt');
      state = input.state; metadata = input.catalog;
      stage = 'source_catalog';
      if (input.backupVersion === 2) {
        kind = 'backup-v2'; origin = (await verifyBackupCatalogSnapshot(input.catalog)).snapshotData;
        // Also require this rule's audited raw6 semantics; no unknown source promotion.
        await checkBackupCatalogCompatibility(input.catalog, 2, environment.origin);
      } else {
        kind = 'backup-v1';
        if (!sameAttemptData(input.catalog, await backupCatalogIdentity(environment.origin))) throw new Error('Unarchived v1 original');
        origin = environment.origin;
      }
      await checkBackupCatalogCompatibility(input.catalog, input.backupVersion as 1 | 2, environment.target);
    } else {
      kind = 'local-v22'; state = value; stage = 'source_catalog';
      if (!localCatalog) throw new Error('local_original_catalog_required');
      origin = structuredClone(localCatalog); validateBackupCatalog(origin);
      metadata = await backupCatalogIdentity(origin);
      // A bare local state cannot authenticate a citation-only altered catalog. Require the pinned original.
      if (!sameAttemptData(metadata, await backupCatalogIdentity(environment.origin))) throw new Error('Unarchived local original');
    }
    if (!state || typeof state !== 'object' || (state as Record<string, unknown>).schemaVersion !== 22) return fail('rejected', 'unsupported_state_version', 'Only state22; schema1–21 and future schemas require another rule');
    stage = 'source_shape';
    if (!shape(state)) return fail('rejected', stage, JSON.stringify(shape.errors));
    // Use raw validation first, never its recovery/display projection as canonical source.
    if (!validateState(state, origin)) return fail('held', 'source_validation', 'Invalid v22 references/quantities or recognition; explicit review required');
    stage = 'source_normalization';
    const unchanged = (catalog: PlannerCatalog) => {
      const loaded = loadState({ getItem: key => key === STORAGE_KEY ? JSON.stringify(state) : null,
        setItem: () => { throw new Error('Unexpected write'); } }, catalog);
      return !loaded.error && !loaded.recoveredRecognitionRaw && sameAttemptData(state, loaded.state);
    };
    if (!unchanged(origin) || !unchanged(environment.target)) return fail('held', stage, 'Reload would normalize/repair the source; preserve and explicitly review');
    // Backup safety is never relaxed. For local state, this is an additional migration
    // reference-closure gate, not permission to normalize a valid display state.
    stage = 'source_references';
    validateBackupState(state, origin); validateBackupState(state, environment.target);
    const sourceState = state as PlannerState;
    const source: SourceArchive = freeze({ kind, raw, rawSha256: await backupRawDigest(raw), stateSha256: await backupDigest(state),
      state: structuredClone(sourceState), sourceCatalog: structuredClone(origin), sourceCatalogSha256: await backupDigest(origin),
      sourceCatalogSemanticSha256: await backupDigest(backupCatalogSemantics(origin)), catalogMetadata: structuredClone(metadata),
      rawFiles: environment.rawFiles, rawFileSha256: environment.catalog.legacyDigests, compatibilityVersion: 1, rule: RULE,
      context: { catalog: environment.catalog, legacyArchive: environment.legacyArchive,
        officialAchievementIds: sourceState.importedCourseAchievements.map(row => row.id), officialStudyRecordIds: sourceState.importedStudyRecords.map(row => row.id) } });
    decoded.add(source); return { status: 'decoded', source, diagnostics: [] };
  } catch (e) { return fail(stage === 'source_normalization' || stage === 'source_references' ? 'held' : 'rejected', stage, e instanceof Error ? e.message : 'Invalid source'); }
}
