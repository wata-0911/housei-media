import { createPersistentAttemptSession, type PersistentHandle, type PersistentPreview, type BackupInspection } from '../../src/planner/attempts/persistence/persistentSession';
import { decodeAuthorityJson, decodeBackupJson } from '../../src/planner/attempts/persistence/contractDecoders';
declare const api: ReturnType<typeof createPersistentAttemptSession>;
async function noElevation() {
  const authority = await decodeAuthorityJson('{}');
  // @ts-expect-error A content validated authority is not a handle.
  api.identities(authority);
  // @ts-expect-error Neither a validated record nor its coverage is a preview.
  api.commit(authority, { confirmed: true });
  const backup = await decodeBackupJson('{}');
  // @ts-expect-error Controller inspection must be selected through its own registry.
  api.prepareRestore(backup);
  // @ts-expect-error Decoded backup cannot be made a persistence handle.
  const handle: PersistentHandle = backup;
  // @ts-expect-error Inspection alone cannot become a write preview.
  const preview: PersistentPreview = {} as BackupInspection;
  void handle; void preview;
}
void noElevation;
