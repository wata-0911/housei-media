import { verifyLedgerState, type Ledger } from './ledger';
import { checkDecimalRoundTrips, NumericPrecisionError } from './decimalPolicy';
import { decodeGradeSourceArchive, type GradeSourceArchive, type DeepReadonly } from './sourceArchive';
import type { HoseiGradeImportCourse } from '../../gradeImport/gradeImportContract';
import { canonicalBackupJson as canonical, backupDigest, backupRawDigest } from '../../digest';
import { parseAttemptGraphJson, AttemptJsonInputError } from '../jsonInput';

export const PREVIEW_FORMAT = 'hosei-g02a-preview-prototype' as const;
export const VERSION = '0.1.0-prototype' as const; // not N/B/A/U
export const POLICY = 'literal-name-candidates/all-revisions/no-identity-confirmation/v1-prototype' as const;
export const LIMITS = Object.freeze({ candidateEdges: 1024, jsonBytes: 8 * 1024 * 1024 });
export type PreviewCode = 'input_type' | 'resource_limit' | 'invalid_preview_json' | 'reference_invalid' | 'stale_or_modified_preview';
export class PreviewError extends Error { constructor(readonly code: PreviewCode) { super(code); this.name = 'PreviewError'; } }
function fail(code: PreviewCode): never { throw new PreviewError(code); }
type Course = DeepReadonly<HoseiGradeImportCourse>;
export type Presence = { present: false } | { present: true; value: unknown };
export type FieldChange = { path: string; before: Presence; after: Presence };
export type Candidate = {
  achievementId: string; revisionId: string; observationId: string;
  sourceRef: { snapshotId: string; rowIndex: number; archiveSha256: string; rawSha256: string };
  currentLatestRevisionId: string; currentActiveRevisionId: string | null;
  isLatest: boolean; isActive: boolean; sameRecord: boolean;
  evidence: 'same_snapshot_position' | 'same_full_dto_only' | 'literal_name_only';
  identity: 'unverified'; before: Course;
  recordChanges: FieldChange[]; sourceRowChanges: FieldChange[]; sourceMetadataChanges: FieldChange[];
  manualAssociations: DeepReadonly<Ledger['view']['associations']>;
};
export type Suggestion = 'new_row' | 'same_snapshot' | 'reimport_candidate' | 'correction_candidate';
export type Conflict = 'identical_incoming_rows' | 'multiple_achievements' | 'shared_candidate'
  | 'historical_match' | 'active_differs_from_observation' | 'year_context_differs';
export type RowPreview = {
  rowIndex: number; record: Course;
  kind: Suggestion | 'ambiguous'; suggestion: Suggestion;
  resolution: 'unmatched' | 'unverified' | 'ambiguous' | 'snapshot_observation_only';
  identicalIncomingRowIndexes: number[]; conflicts: Conflict[]; candidates: Candidate[];
  selectedAchievementId: null; requiresExplicitDecision: true;
};
export type ImportPreview = {
  format: typeof PREVIEW_FORMAT; contractVersion: typeof VERSION; policy: typeof POLICY;
  binding: { archiveSha256: string; rawSha256: string; ledgerSha256: string; ledgerTipSha256: string | null; minimumIdsRawSha256: string };
  sourceArchive: GradeSourceArchive; snapshotStatus: 'same_snapshot' | 'new_snapshot'; matchingSnapshotIds: string[];
  rows: RowPreview[];
  existingCoverage: { achievementId: string; latestRevisionId: string; activeRevisionId: string | null;
    status: 'snapshot_observation_only' | 'candidate_only' | 'not_seen_by_policy'; deleteRecommended: false }[];
  authorization: { kind: 'preview-only'; journalDeclaration: 'not-created'; saveAuthority: 'not-issued'; canCommit: false };
  previewSha256: string;
};
function freeze<T>(v: T): DeepReadonly<T> {
  if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v as DeepReadonly<T>;
}
function ptr(k: string) { return k.replace(/~/g, '~0').replace(/\//g, '~1'); }
/** Presence tags preserve omission versus explicit null/0. Original array positions are not sorted. */
function differences(before: unknown, after: unknown, path = '', bp = true, ap = true): FieldChange[] {
  if (!bp || !ap) return [{ path, before: bp ? { present: true, value: before } : { present: false }, after: ap ? { present: true, value: after } : { present: false } }];
  if (canonical(before) === canonical(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from({ length: Math.max(before.length, after.length) }, (_, i) => differences(before[i], after[i], `${path}/${i}`, i < before.length, i < after.length)).flat();
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(k => differences(a[k], b[k], `${path}/${ptr(k)}`, Object.hasOwn(a, k), Object.hasOwn(b, k)));
  }
  return [{ path, before: { present: true, value: before }, after: { present: true, value: after } }];
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function years(c: Course) { return canonical({ examDate: c.creditExam.date, schoolings: c.schoolings.map(s => ({ year: s.year, rawYear: s.rawYear, date: s.date })) }); }
function rawSource(a: DeepReadonly<GradeSourceArchive>): { metadata: unknown; rows: unknown[] } {
  // G01a has already checked lexical preservation, complete DTO projection and all hashes.
  const parsed = JSON.parse(a.raw) as Record<string, unknown>;
  return { metadata: Object.fromEntries(Object.entries(parsed).filter(([k]) => k !== 'courses')), rows: parsed.courses as unknown[] };
}
function parsePreview(input: unknown, generated = false): unknown {
  if (typeof input !== 'string') fail('input_type');
  if (input.length > LIMITS.jsonBytes || new TextEncoder().encode(input).byteLength > LIMITS.jsonBytes) fail('resource_limit');
  try { const parsed = parseAttemptGraphJson(input); checkDecimalRoundTrips(input); return parsed; }
  catch (e) {
    if (generated && e instanceof AttemptJsonInputError && e.code === 'resource_limit') fail('resource_limit');
    if (e instanceof NumericPrecisionError || e instanceof AttemptJsonInputError) fail('invalid_preview_json');
    throw e;
  }
}

/** Only validated observations become candidates. Literal names narrow display candidates,
 * never institutional identity. No caller-selected candidate list or save capability is accepted. */
export async function previewImport(archiveJson: unknown, ledgerJson: unknown, minimumIdsJson: unknown): Promise<DeepReadonly<ImportPreview>> {
  // A known reservation floor is explicit, including 'empty' only for a truly new ledger.
  if (typeof archiveJson !== 'string' || typeof ledgerJson !== 'string' || typeof minimumIdsJson !== 'string') fail('input_type');
  const source = await decodeGradeSourceArchive(archiveJson);
  const ledger = await verifyLedgerState(ledgerJson, minimumIdsJson);
  const incoming = rawSource(source);
  const snapshots = new Map(ledger.view.snapshots.map(s => [s.id, s]));
  const rawSnapshots = new Map(ledger.view.snapshots.map(s => [s.id, rawSource(s.archive)]));
  const observations = new Map(ledger.view.observations.map(o => [o.id, o]));
  const achievements = new Map(ledger.view.achievements.map(a => [a.id, a]));
  const revisions = new Map(ledger.view.revisions.map(r => [r.id, r]));
  const byName = new Map<string, typeof ledger.view.revisions[number][]>();
  for (const r of ledger.view.revisions) byName.set(r.record.rawName, [...(byName.get(r.record.rawName) ?? []), r]);
  const sameSnapshots = ledger.view.snapshots.filter(s => s.archive.rawSha256 === source.rawSha256 && s.archive.raw === source.raw);
  const duplicateGroups = new Map<string, number[]>();
  incoming.rows.forEach((r, i) => { const k = canonical(r); duplicateGroups.set(k, [...(duplicateGroups.get(k) ?? []), i]); });
  let edges = 0, estimatedBytes = 0;
  function account(v: unknown) { estimatedBytes += new TextEncoder().encode(JSON.stringify(v)).byteLength; if (estimatedBytes > LIMITS.jsonBytes) fail('resource_limit'); }
  account(source);
  const rows: RowPreview[] = source.dto.courses.map((record, rowIndex) => {
    // Exact raw snapshot + original row position is provenance, NOT a general matching shortcut.
    const known = sameSnapshots.flatMap(s => { const assignment = s.rows[rowIndex]; const r = revisions.get(assignment.revisionId); if (!r) return fail('reference_invalid'); return [r]; });
    const possibilities = sameSnapshots.length ? known : byName.get(record.rawName) ?? [];
    const candidates: Candidate[] = [];
    for (const r of possibilities) {
      if (++edges > LIMITS.candidateEdges) fail('resource_limit');
      const obs = observations.get(r.observationId), a = achievements.get(r.achievementId);
      const snapshot = obs && snapshots.get(obs.snapshotId), raw = obs && rawSnapshots.get(obs.snapshotId);
      if (!obs || !a || !snapshot || !raw || !a.revisionIds.length) fail('reference_invalid');
      const sameRecord = canonical(r.record) === canonical(record);
      const c: Candidate = {
        achievementId: a.id, revisionId: r.id, observationId: obs.id,
        sourceRef: { snapshotId: snapshot.id, rowIndex: obs.rowIndex, archiveSha256: snapshot.archive.archiveSha256, rawSha256: snapshot.archive.rawSha256 },
        currentLatestRevisionId: a.revisionIds.at(-1)!, currentActiveRevisionId: a.activeRevisionId,
        isLatest: a.revisionIds.at(-1) === r.id, isActive: a.activeRevisionId === r.id, sameRecord,
        evidence: sameSnapshots.length ? 'same_snapshot_position' : sameRecord ? 'same_full_dto_only' : 'literal_name_only',
        identity: 'unverified', before: structuredClone(r.record),
        recordChanges: differences(r.record, record), sourceRowChanges: differences(raw.rows[obs.rowIndex], incoming.rows[rowIndex]),
        sourceMetadataChanges: differences(raw.metadata, incoming.metadata),
        manualAssociations: structuredClone(ledger.view.associations.filter(x => x.achievementId === a.id)),
      };
      account(c); candidates.push(c);
    }
    candidates.sort((a, b) => compare(a.achievementId, b.achievementId) || compare(a.revisionId, b.revisionId));
    const distinct = new Set(candidates.map(c => c.achievementId));
    const suggestion: Suggestion = sameSnapshots.length ? 'same_snapshot' : !candidates.length ? 'new_row'
      : candidates.some(c => c.sameRecord) ? 'reimport_candidate' : 'correction_candidate';
    const identicalIncomingRowIndexes = duplicateGroups.get(canonical(incoming.rows[rowIndex]))!.filter(i => i !== rowIndex);
    const conflicts: Conflict[] = [];
    if (identicalIncomingRowIndexes.length) conflicts.push('identical_incoming_rows');
    if (distinct.size > 1) conflicts.push('multiple_achievements');
    if (candidates.some(c => c.sameRecord && !c.isLatest)) conflicts.push('historical_match');
    if (sameSnapshots.length && candidates.some(c => c.currentActiveRevisionId !== null && !c.isActive)) conflicts.push('active_differs_from_observation');
    if (candidates.some(c => years(c.before) !== years(record))) conflicts.push('year_context_differs');
    const ambiguous = !sameSnapshots.length && distinct.size > 1;
    account(record);
    return { rowIndex, record: structuredClone(record), kind: ambiguous ? 'ambiguous' : suggestion, suggestion,
      resolution: sameSnapshots.length ? 'snapshot_observation_only' : ambiguous ? 'ambiguous' : candidates.length ? 'unverified' : 'unmatched',
      identicalIncomingRowIndexes, conflicts, candidates, selectedAchievementId: null, requiresExplicitDecision: true };
  });
  // A potential many-to-one mapping remains ambiguous even if each row has one candidate.
  if (!sameSnapshots.length) {
    const claims = new Map<string, Set<number>>();
    for (const row of rows) for (const c of row.candidates) { const set = claims.get(c.achievementId) ?? new Set<number>(); set.add(row.rowIndex); claims.set(c.achievementId, set); }
    for (const row of rows) if (row.candidates.some(c => claims.get(c.achievementId)!.size > 1)) {
      row.kind = 'ambiguous'; row.resolution = 'ambiguous'; row.conflicts.push('shared_candidate');
    }
  }
  const body = {
    format: PREVIEW_FORMAT, contractVersion: VERSION, policy: POLICY,
    binding: { archiveSha256: source.archiveSha256, rawSha256: source.rawSha256, ledgerSha256: await backupDigest(ledger),
      ledgerTipSha256: ledger.tipSha256, minimumIdsRawSha256: await backupRawDigest(minimumIdsJson) },
    sourceArchive: structuredClone(source), snapshotStatus: sameSnapshots.length ? 'same_snapshot' as const : 'new_snapshot' as const,
    matchingSnapshotIds: sameSnapshots.map(s => s.id), rows,
    existingCoverage: ledger.view.achievements.map(a => ({ achievementId: a.id, latestRevisionId: a.revisionIds.at(-1)!, activeRevisionId: a.activeRevisionId,
      status: rows.some(r => r.candidates.some(c => c.achievementId === a.id))
        ? sameSnapshots.length ? 'snapshot_observation_only' as const : 'candidate_only' as const : 'not_seen_by_policy' as const,
      deleteRecommended: false as const })),
    authorization: { kind: 'preview-only' as const, journalDeclaration: 'not-created' as const, saveAuthority: 'not-issued' as const, canCommit: false as const },
  };
  const result = { ...body, previewSha256: await backupDigest(body) };
  // Check the complete wire value with the verifier's byte/structure/numeric policy.
  // Reject unrepresentable output; never trim unknown fields, candidates or diffs.
  const parsed = parsePreview(JSON.stringify(result), true);
  if (canonical(parsed) !== canonical(result)) fail('invalid_preview_json');
  return freeze(result);
}
/** Recompute all candidates and diffs against current inputs. This is integrity/staleness
 * checking only: its result cannot be used as a G01b operation or a save credential. */
export async function verifyImportPreview(previewJson: unknown, archiveJson: unknown, ledgerJson: unknown, minimumIdsJson: unknown): Promise<DeepReadonly<ImportPreview>> {
  const submitted = parsePreview(previewJson);
  const expected = await previewImport(archiveJson, ledgerJson, minimumIdsJson);
  if (canonical(submitted) !== canonical(expected)) fail('stale_or_modified_preview');
  return expected;
}
