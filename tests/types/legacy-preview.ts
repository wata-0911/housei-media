import { previewLegacyRule2Migration, legacyReservationAnalysis } from '../../src/planner/attempts/persistence/legacyPreview';
import type { NativeSaveAuthority } from '../../src/planner/attempts/persistence/versionedContracts';
async function checks(raw: string) {
  const result = await previewLegacyRule2Migration(raw);
  // @ts-expect-error A preview never has the private save capability.
  const authority: NativeSaveAuthority = result;
  const analysis = await legacyReservationAnalysis(raw);
  // @ts-expect-error Analysis is not a save credential either.
  const other: NativeSaveAuthority = analysis;
  void authority; void other;
}
void checks;
