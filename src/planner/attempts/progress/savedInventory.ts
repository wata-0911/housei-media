import { backupDigest } from '../../digest';
import type { InstitutionalCatalog } from '../../institutional/types';
import { freeze } from '../migration/contracts';
import type { AttemptBackup, NewPlanBackup } from '../persistence/contracts';
import { ownerKey } from '../validation';
import { projectSavedProgress } from './savedProjection';

/** Internal projection. The caller must supply F01's verified backup and its
 * actual validation catalog from the same locked read. */
export async function inventoryFromVerifiedBackup(raw: string, catalog: InstitutionalCatalog) {
  const backup = JSON.parse(raw) as AttemptBackup | NewPlanBackup;
  const state = backup.state;
  const master = state.schemaVersion === 23 ? state.verification.masterSha256 : state.source.masterSha256;
  if (master !== await backupDigest(catalog)) throw new Error('saved_inventory_master_mismatch');
  const revision = catalog.sourceRevision;
  if (state.schemaVersion === 24 &&
      (state.source.sourceRevisionId !== revision.id || state.source.sourceDigest !== revision.sha256)) {
    throw new Error('saved_inventory_source_mismatch');
  }
  const projected = projectSavedProgress(backup);
  const snapshot = { ...projected.snapshot, sourceRevisionId: revision.id, sourceDigest: revision.sha256 };
  const migrationSlots = new Map(state.schemaVersion === 23 ? state.ledger.records.map(slot => [slot.recordId, slot]) : []);
  if (state.schemaVersion === 23 && migrationSlots.size !== state.ledger.records.length) {
    throw new Error('saved_inventory_duplicate_slot');
  }
  const nativeIds = new Set(state.history.commands.flatMap(command =>
    command.kind === 'add_record' ? [command.record.id] : []));
  const singletonOwners = new Set<string>();
  const records = state.graph.ownedRecords.map((record, order) => {
    const { id, kind, owner } = record;
    if (kind !== 'todo') {
      const key = JSON.stringify([kind, ownerKey(owner)]);
      if (singletonOwners.has(key)) throw new Error('duplicate_owner_payload');
      singletonOwners.add(key);
    }
    const provenance = migrationSlots.get(id) ?? null;
    if (provenance && provenance.kind !== kind) throw new Error('saved_inventory_slot_mismatch');
    if (state.schemaVersion === 23 && !provenance && !nativeIds.has(id)) {
      throw new Error('saved_inventory_missing_provenance');
    }
    return { ...record, order, provenance };
  });
  return freeze({ ...projected, snapshot,
    ownerInventory: { coverage: 'complete' as const, sourcePin: snapshot, records } });
}
