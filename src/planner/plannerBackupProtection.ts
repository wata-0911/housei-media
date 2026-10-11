import type { PlannerCatalog } from './plannerCatalog';
import { backupRawDigest, createBackupCatalogSnapshot, verifyBackupCatalogSnapshot, type BackupCatalogSnapshot } from './plannerBackupCompatibility';

/** Quarantine envelope, NOT a restorable normal backup. Invalid JSON, shadow
 * values, missing v22 fields and old recovery bytes are preserved verbatim.
 * Checksums detect corruption, not authenticity. No repair or storage write. */
export type PlannerBackupProtection = {
  format: 'hosei-planner-protection'; protectionVersion: 1; createdAt: string;
  catalog: BackupCatalogSnapshot;
  primaryRaw: string | null; primarySha256: string | null;
  recoveryRaw: string | null; recoverySha256: string | null;
};
export async function createPlannerBackupProtection(primaryRaw: string | null, recoveryRaw: string | null, catalog: PlannerCatalog, now = new Date()): Promise<PlannerBackupProtection> {
  return { format: 'hosei-planner-protection', protectionVersion: 1, createdAt: now.toISOString(), catalog: await createBackupCatalogSnapshot(catalog),
    primaryRaw, primarySha256: primaryRaw === null ? null : await backupRawDigest(primaryRaw),
    recoveryRaw, recoverySha256: recoveryRaw === null ? null : await backupRawDigest(recoveryRaw) };
}
/** For offline recovery tooling/tests. Inspection never returns a PlannerState
 * or authorizes a write. Any future recovery must preserve this original and
 * use a named, audited migration with before/after preview and confirmation. */
export async function inspectPlannerBackupProtection(text: string): Promise<PlannerBackupProtection> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('保護ファイルのJSON構文が不正です。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('保護ファイルではありません。');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'catalog,createdAt,format,primaryRaw,primarySha256,protectionVersion,recoveryRaw,recoverySha256'
    || record.format !== 'hosei-planner-protection' || record.protectionVersion !== 1
    || typeof record.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.createdAt)
    || !Number.isFinite(Date.parse(record.createdAt)) || new Date(record.createdAt).toISOString() !== record.createdAt) throw new Error('保護ファイルの識別子・版・日時が不正です。');
  await verifyBackupCatalogSnapshot(record.catalog);
  for (const [rawKey, hashKey] of [['primaryRaw', 'primarySha256'], ['recoveryRaw', 'recoverySha256']] as const) {
    const raw = record[rawKey];
    if (raw !== null && typeof raw !== 'string') throw new Error('保護原文の形式が不正です。');
    if (record[hashKey] !== (raw === null ? null : await backupRawDigest(raw))) throw new Error('保護原文のSHAが一致しません。');
  }
  return record as PlannerBackupProtection;
}
