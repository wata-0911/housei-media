import type { PersistenceHandle } from '../persistence/controller';
import type { SourceArchive } from '../migration/contracts';
import { STORAGE_KEY, BACKUP_KEY } from '../../backup/storagePrimitives';

export type LegacySnapshot = Readonly<{ primaryRaw: string | null; recoveryRaw: string | null }>;
export type AuthorityAdmission = Readonly<{
  case: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';
  canView: boolean; canCreate: boolean; canMigrate: boolean; canEdit: boolean;
  code: string; message: string;
}>;
export const emptyLegacySnapshot = (): LegacySnapshot => ({ primaryRaw: null, recoveryRaw: null });
/** Read only: absence, empty text and unreadable storage must remain distinct. */
export function readLegacySnapshot(storage: Pick<Storage, 'getItem'>): LegacySnapshot {
  return Object.freeze({ primaryRaw: storage.getItem(STORAGE_KEY), recoveryRaw: storage.getItem(BACKUP_KEY) });
}
export function sameLegacySnapshot(a: LegacySnapshot, b: LegacySnapshot) {
  return a.primaryRaw === b.primaryRaw && a.recoveryRaw === b.recoveryRaw;
}
function result(c: AuthorityAdmission['case'], code: string, message: string, canView: boolean,
  permission?: 'canCreate' | 'canMigrate' | 'canEdit'): AuthorityAdmission {
  return Object.freeze({ case: c, code, message, canView, canCreate: false, canMigrate: false, canEdit: false,
    ...(permission ? { [permission]: true } : {}) });
}
export function unavailableAdmission(error: unknown): AuthorityAdmission {
  const code = error instanceof Error ? error.message : String(error);
  if (/stale|legacy_changed/.test(code)) return result('I', code,
    '別の画面で保存内容が変更されました。書込みを停止しています。原文を保護し、再読込してください。', false);
  return result(/authority|format|schema|assignment|history|digest/.test(code) ? 'H' : 'J', code,
    '保存内容を確認できません。書込みを停止しています。原文を保護し、診断後に再読込してください。', false);
}
export function sameLegacySource(a: SourceArchive, b: SourceArchive) {
  return a.stateSha256 === b.stateSha256 && a.sourceCatalogSha256 === b.sourceCatalogSha256;
}
/** No initialization, ID allocation, migration preview, normalization or writes.
 * The handle MUST come from persistence.load (complete checkpoint/history replay).
 * decode MUST be the strict v22 decoder, never legacy loadState's repaired view.
 * This description grants no capability; the session retains and rechecks bytes. */
export async function inspectAuthorityAdmission(legacy: LegacySnapshot, handle: PersistenceHandle | null,
  decode: (raw: string) => Promise<SourceArchive | null>): Promise<AuthorityAdmission> {
  if (legacy.primaryRaw === null && legacy.recoveryRaw === null) {
    if (!handle) return result('A', 'empty', '旧・新の保存はありません。確認後に新規計画を開始できます。', false, 'canCreate');
    return result(handle.state.schemaVersion === 23 ? 'C' : 'D', 'verified_authority',
      '既存のAttempt正本を再読込・照合しました。', true, 'canEdit');
  }
  if (legacy.primaryRaw === null) return result('G', 'recovery_without_primary',
    '旧recoveryのみ残っています。原文を保護し、復旧元を確認するまで書込みを停止します。', !!handle);
  // load already replayed the entire explicit correction chain. The exact
  // pre-correction original can legitimately remain held by today's decoder.
  if (handle?.state.schemaVersion === 23 && handle.state.corrections[0]?.originalRaw === legacy.primaryRaw) {
    return result('E', 'verified_corrected_migration_source',
      '旧原文と明示訂正の移行履歴を再読込・照合しました。新正本を編集し、訂正前の原文も保持します。', true, 'canEdit');
  }
  const source = await decode(legacy.primaryRaw);
  if (!source) return result('G', 'legacy_held',
    '旧データが未対応・破損または確認待ちです。原文を保護し、書込みを停止しています。', !!handle);
  if (!handle) return result('B', 'explicit_migration_required',
    '旧schema22があります。空の新規計画は作成できません。原文を保護し、明示移行してください。', true, 'canMigrate');
  if (handle.source.kind === 'new-plan') return result('F', 'separate_plans',
    '旧schema22と新schema24は別計画です。自動統合せず、両方を保護して書込みを停止します。', true);
  // A backup envelope can differ byte-for-byte from localStorage. Both strict
  // decoders must agree on the complete v22 state AND its original catalog.
  // No source drift is adopted from semantic similarity or course names.
  if (sameLegacySource(source, handle.source)) return result('E', 'verified_migration_source',
    '旧schema22と移行履歴を照合しました。新正本を編集し、旧原文は保持します。', true, 'canEdit');
  return result('E', 'legacy_source_conflict',
    '旧schema22が保存済みの移行元と一致しません。両方を保護し、再統合の確認まで書込みを停止します。', true);
}
