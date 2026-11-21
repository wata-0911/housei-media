import { ATTEMPT_BACKUP_INPUT_BYTES, MIGRATION_INPUT_BYTES } from './migrationInput';

/** A selected file is a byte archive. Never silently replace malformed UTF-8
 * or strip its BOM. Rejected files remain untouched on the user's filesystem. */
type ByteFile = Pick<File, 'size' | 'arrayBuffer'>;
async function readByteFile(file: ByteFile, limit: number, kind: 'migration' | 'attempt_backup'): Promise<string> {
  const size = file.size;
  if (!Number.isSafeInteger(size) || size < 0 || size > limit)
    throw new Error(kind + '_input_limit');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== size || bytes.byteLength > limit)
    throw new Error(kind + '_file_size_mismatch');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    throw new Error(kind + '_utf8_bom_not_supported');
  let raw: string;
  try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(kind + '_invalid_utf8'); }
  const encoded = new TextEncoder().encode(raw);
  if (encoded.byteLength !== bytes.byteLength || encoded.some((byte, i) => byte !== bytes[i]))
    throw new Error(kind + '_non_roundtrip_utf8');
  return raw;
}

export const readMigrationFile = (file: ByteFile) => readByteFile(file, MIGRATION_INPUT_BYTES, 'migration');
export const readAttemptBackupFile = (file: ByteFile) => readByteFile(file, ATTEMPT_BACKUP_INPUT_BYTES, 'attempt_backup');
