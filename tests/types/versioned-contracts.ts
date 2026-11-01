import { decodeAuthorityJson, decodeBackupJson, decodeStateJson } from '../../src/planner/attempts/persistence/contractDecoders';
import type { NativeSaveAuthority, ReservationCoverage } from '../../src/planner/attempts/persistence/versionedContracts';

// Compile-time only. No capability constructor is exported or called.
async function typeAssertions(raw: string) {
  const results = [await decodeAuthorityJson(raw), await decodeBackupJson(raw), await decodeStateJson(raw)];
  for (const result of results) {
    // @ts-expect-error Content integrity never supplies the private host capability.
    const authority: NativeSaveAuthority = result;
    void authority;
  }
  // @ts-expect-error A native declaration alone cannot construct host authority.
  const forged: NativeSaveAuthority = { kind: 'native-v2-save-authorized' };
  // @ts-expect-error Legacy coverage must retain its baseline digest.
  const legacy: ReservationCoverage = { policyVersion: 2, kind: 'legacy-unproven', baselineStateSha256: null };
  // @ts-expect-error Native non-null baseline has no supported meaning in PR1.
  const native: ReservationCoverage = { policyVersion: 2, kind: 'native-v2', baselineStateSha256: 'a'.repeat(64) };
  void forged; void legacy; void native;
}
void typeAssertions;
