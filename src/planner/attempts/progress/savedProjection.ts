import type { createPlannerAttemptSession } from '../production/session';
import type { AttemptBackup, NewPlanBackup } from '../persistence/contracts';
import { freeze } from '../migration/contracts';
import { projectProgress } from './progressProjection';

/** Host port: bind only an actual F01 production session. This is not a parser
 * for submitted backups, a receipt verifier, or a new persistence authority. */
type SavedSession = Pick<ReturnType<typeof createPlannerAttemptSession>, 'createBackup'>;

/** The public session performs locked destination verification and complete
 * replay before returning its saved backup. Reading that exact snapshot avoids
 * mixing a later draft/view with the snapshot the session actually verified.
 * No load is performed here: an unsaved draft must never be discarded. */
export async function readSavedProgress(session: SavedSession) {
  const backupRaw = await session.createBackup();
  // Only bytes returned by the bound production session cross this seam.
  const backup = JSON.parse(backupRaw) as AttemptBackup | NewPlanBackup;
  const { state } = backup;
  return freeze({
    snapshot: { schemaVersion: state.schemaVersion, backupSha256: backup.sha256,
      graphSha256: state.verification.graphSha256 },
    projection: projectProgress({
      graph: state.graph,
      // F01 command receipts prove learner edits, not official enrollment or
      // same-Attempt association. Retained rows remain separate until that
      // authority bridge has an audited command/replay/receipt contract.
      officialObservations: [], associations: [], enrollmentEvidence: [],
      // calculate() exposes a combined scenario, not a verified F02-only
      // subtotal. Do not relabel it or copy it into each owner's accounting.
      knownF02OfficialCredits: null,
    }),
    officialSource: state.source,
    retained: state.retained,
    blockedDependencies: ['official_association_receipt', 'official_enrollment_receipt',
      'f02_official_subtotal_port'] as const,
  });
}
