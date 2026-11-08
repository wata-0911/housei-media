import { MIGRATION_INPUT_BYTES } from './migrationInput';

/** A selected file is a byte archive. Never silently replace malformed UTF-8
 * or strip its BOM. Rejected files remain untouched on the user's filesystem. */
export async function readMigrationFile(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<string> {
  const size = file.size;
  if (!Number.isSafeInteger(size) || size < 0 || size > MIGRATION_INPUT_BYTES)
    throw new Error('migration_input_limit');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== size || bytes.byteLength > MIGRATION_INPUT_BYTES)
    throw new Error('migration_file_size_mismatch');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    throw new Error('migration_utf8_bom_not_supported');
  let raw: string;
  try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('migration_invalid_utf8'); }
  const encoded = new TextEncoder().encode(raw);
  if (encoded.byteLength !== bytes.byteLength || encoded.some((byte, i) => byte !== bytes[i]))
    throw new Error('migration_non_roundtrip_utf8');
  return raw;
}
