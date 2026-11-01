import { backupDigest } from '../../backup/plannerBackupCompatibility';
import { freeze, type SourceArchive } from '../migration/contracts';
import { decodeMigrationSource, parseMigrationJson } from '../migration/source';
import { sameAttemptData } from '../validation';
import { applyCommand, createWorkspace } from '../workbench/operations';
import { replayMigrationState, replayState, replayStateRule2 } from './codec';
import { analyzeCommandIdentities, checkIntroducedIdentities, recordIdentities, type IdentityOccurrence } from './commandIdentities';
import { assertCoverageContinuation } from './contractDecoders';
import { referencedUuids, sourceUuids } from './identity';
import { CanonicalReservations, foldCommandIdentities, requireFoldWorkspace, type IdentityFoldSeed } from './identityFold';
import { emptyNewPlanWorkspace, replayNewPlan } from './newPlan';
import type { ReservationCoverage } from './versionedContracts';

type LegacyState = Awaited<ReturnType<typeof replayState>>['state'];
type Rule2State = Awaited<ReturnType<typeof replayStateRule2>>['state'];
export type MigrationChange = { path: '/rule/version' | '/history/issuedIds'; before: unknown; after: unknown };

/** Full-value check, including fields unknown to this module's domain logic.
 * There are no exceptions to DESIGN §4.4's two permitted fields. */
export async function compareLegacyMigration(original: LegacyState, candidate: unknown) {
  const restored = structuredClone(candidate) as LegacyState;
  if (!restored || !restored.rule || !restored.history) throw new Error('migration_preservation_mismatch');
  const changes: MigrationChange[] = [
    { path: '/rule/version', before: original.rule.version, after: restored.rule.version },
    { path: '/history/issuedIds', before: original.history.issuedIds, after: restored.history.issuedIds },
  ];
  restored.rule = { ...restored.rule, version: original.rule.version };
  restored.history.issuedIds = structuredClone(original.history.issuedIds);
  if (!sameAttemptData(original, restored)) throw new Error('migration_preservation_mismatch');
  const next = await replayStateRule2(candidate);
  return freeze({ allOtherValuesEqual: true as const, workspaceEqual: sameAttemptData((await replayState(original)).workspace, next.workspace), changes });
}

/** Explicit analysis only. Rule1 integrity is established BEFORE any H2/R2
 * checks; a rule2 hold must never be reported as old-state corruption. */
export async function legacyReservationAnalysis(raw: string) {
  if (typeof raw !== 'string') throw new Error('json_input_type');
  const value = parseMigrationJson(raw);
  let seed: IdentityFoldSeed;
  let old;
  if (value && typeof value === 'object' && (value as { schemaVersion?: unknown }).schemaVersion === 24) {
    const replay = await replayNewPlan(value);
    seed = { source: replay.source, initial: emptyNewPlanWorkspace(replay.source) }; old = replay;
  } else {
    const replay = await replayMigrationState(value);
    const previousSources: SourceArchive[] = [];
    for (const correction of replay.state.corrections) {
      const decoded = await decodeMigrationSource(correction.originalRaw, replay.environment, replay.state.source.catalog);
      if (decoded.status !== 'decoded') throw new Error('correction_original');
      previousSources.push(decoded.source);
    }
    seed = { source: replay.source, initial: createWorkspace(replay.base.graph, replay.source.context),
      tables: [...replay.state.corrections.map(c => c.originalAssignments), replay.state.assignments], previousSources };
    old = replay;
  }
  const original = old.state, baselineStateSha256 = await backupDigest(original);
  const coverage: ReservationCoverage = { policyVersion: 2, kind: 'legacy-unproven', baselineStateSha256 };
  assertCoverageContinuation('legacy-authority', coverage); // restriction only, never commit authorization
  // Diagnostic walk uses the verified old transitions, even if strict H2 holds.
  let before = seed.initial;
  const prohibitedIntroductions: IdentityOccurrence[] = [];
  const legalLegacyNonUuid = seed.initial.graph.ownedRecords.flatMap(r => recordIdentities(r, '/initial')).filter(o => !o.uuidTail);
  for (const command of original.history.commands) {
    const delta = analyzeCommandIdentities(before, command);
    prohibitedIntroductions.push(...delta.introduced.filter(o => {
      try { checkIntroducedIdentities([o], new Set()); return false; } catch { return true; }
    }));
    legalLegacyNonUuid.push(...delta.introduced.filter(o => !o.uuidTail));
    before = applyCommand(before, command, seed.source.context);
  }
  const common = { verification: 'content-validated' as const, legacyIntegrity: 'rule1-validated' as const,
    raw, original, originalDigest: baselineStateSha256, reservationCoverage: coverage,
    saveAuthority: 'not-issued' as const, legalLegacyNonUuid, prohibitedIntroductions,
    // No checkpoint list or hash can recover lost payloads. This uncertainty
    // survives even a successful H2 fold; it is not current-state corruption.
    missingEvidence: ['legacy-host-history-completeness-unproven'] as const };
  let fold;
  try {
    fold = foldCommandIdentities(seed, original.history.commands, original);
    requireFoldWorkspace(old.workspace, fold.workspace);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'identity_analysis_failed';
    // Recover restrictions only, never fabricate issuance events or a H2 proof.
    const references = [...sourceUuids(seed.source), ...(seed.previousSources ?? []).flatMap(s => [...sourceUuids(s)]),
      ...referencedUuids([original, old.workspace])];
    const recovered = new CanonicalReservations();
    recovered.restrict(old.requiredReservations); recovered.references(references);
    const recoverableRestrictions = recovered.values();
    return freeze({ ...common, status: 'held' as const, disposition: 'explicit-migration-required' as const,
      h2: null, r2: null, recoverableRestrictions,
      blockers: [{ kind: prohibitedIntroductions.length ? 'prohibited-rule2-introduction' as const
        : /collision|reused|canonical/.test(code) ? 'uuid-namespace-collision' as const : 'rule2-evidence-insufficient' as const, code }] });
  }
  return freeze({ ...common, status: 'migration-candidate' as const, disposition: 'explicit-migration-required' as const,
    h2: fold.issuedIds, r2: fold.requiredReservations, recoverableRestrictions: fold.requiredReservations,
    missingFromLegacyReservations: fold.requiredReservations.filter(id => !old.requiredReservations.includes(id)), blockers: [] });
}

/** Opt-in pure preview: no controller handles, allocator, storage, locks or RPC.
 * Dropping/cancelling the result requires no action and performs no writes. */
export async function previewLegacyRule2Migration(raw: string) {
  const analysis = await legacyReservationAnalysis(raw);
  if (analysis.status === 'held') return freeze({ analysis, status: 'held' as const, saveAuthority: 'not-issued' as const });
  const candidate = { ...structuredClone(analysis.original), rule: { ...analysis.original.rule, version: 2 as const },
    history: { ...structuredClone(analysis.original.history), issuedIds: [...analysis.h2] } };
  const comparison = await compareLegacyMigration(analysis.original, candidate);
  if (!comparison.workspaceEqual) throw new Error('migration_workspace_mismatch');
  const verified = await replayStateRule2(candidate);
  return freeze({ status: 'preview' as const, analysis, candidate: verified.state as Rule2State,
    candidateDigest: await backupDigest(verified.state), comparison,
    reservationCoverage: analysis.reservationCoverage, saveAuthority: 'not-issued' as const });
}
