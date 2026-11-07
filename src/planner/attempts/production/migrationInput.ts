import { inspectJsonLexemes } from '../persistence/jsonLexemes';
import { BACKUP_FORMAT, BACKUP_VERSION, NEW_BACKUP_VERSION } from '../persistence/contracts';
/** Keep input policies independent. Neither pass rewrites the original raw. */
export const MIGRATION_INPUT_BYTES = 16 * 1024 * 1024;
export const ATTEMPT_BACKUP_INPUT_BYTES = 64 * 1024 * 1024;
function inspect(raw: string, maxBytes: number, kind: string, backup = false): unknown {
  inspectJsonLexemes(raw, maxBytes, kind, backup ? { format: BACKUP_FORMAT, versions: [BACKUP_VERSION, NEW_BACKUP_VERSION] } : undefined);
  return JSON.parse(raw);
}
export const inspectMigrationInput = (raw: string) => inspect(raw, MIGRATION_INPUT_BYTES, 'migration');
export const inspectAttemptBackupInput = (raw: string) => inspect(raw, ATTEMPT_BACKUP_INPUT_BYTES, 'attempt_backup', true);
