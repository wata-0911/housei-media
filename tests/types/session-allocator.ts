import { createSynchronousAttemptSession } from '../../src/planner/attempts/persistence/syncSession';
import type { NativeSaveAuthority } from '../../src/planner/attempts/persistence/versionedContracts';
function checks(session: ReturnType<typeof createSynchronousAttemptSession>) {
  // @ts-expect-error No caller UUID factory or reservation argument.
  session.identities({}, () => 'uuid', []);
  // @ts-expect-error Session identities never confer native authority.
  const authority: NativeSaveAuthority = session;
  void authority;
}
void checks;
