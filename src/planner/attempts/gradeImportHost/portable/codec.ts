import { decodeNativeRecord } from '../dispatch';
import { decodeHost, digest, rawDigest, equal, freeze } from '../codec';
import { FORMAT, POLICY, EXPORTER, LIMITS, fail, type Summary, type Backup } from './contracts';
import { requireExporterRevision } from './revision';
import { parseBackupJson, keys } from './json';

export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function utf16Bytes(raw: string): Uint8Array {
  if (typeof raw !== 'string') fail('input_type');
  if (raw.length > LIMITS.codeUnits) fail('resource_limit');
  const bytes = new Uint8Array(raw.length * 2);
  for (let i = 0; i < raw.length; i++) { const c = raw.charCodeAt(i); bytes[i * 2] = c & 255; bytes[i * 2 + 1] = c >>> 8; }
  return bytes;
}
export function base64(bytes: Uint8Array): string {
  // Chunks avoid spread argument/stack limits and are multiples of three.
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 12_288) parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 12_288))));
  return parts.join('');
}
export function decodeRecord(r: Backup['record']): { raw: string; bytes: Uint8Array } {
  keys(r, ['encoding', 'codeUnits', 'byteLength', 'sha256', 'payload']);
  if (r.encoding !== 'js-utf16le-base64/v1') fail('invalid_encoding');
  if (!Number.isSafeInteger(r.codeUnits) || r.codeUnits < 0 || r.codeUnits > LIMITS.codeUnits
    || r.byteLength !== r.codeUnits * 2 || typeof r.payload !== 'string') fail('invalid_encoding');
  const n = r.payload.length;
  if (n > LIMITS.payloadChars || n !== 4 * Math.ceil(r.byteLength / 3)) fail('resource_limit');
  // Iterative alphabet/padding preflight BEFORE atob allocation; no giant regex.
  const padding = r.byteLength % 3 === 0 ? 0 : 3 - r.byteLength % 3;
  for (let i = 0; i < n; i++) {
    const c = r.payload.charCodeAt(i), pad = i >= n - padding;
    if (pad ? c !== 61 : !(c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 48 && c <= 57 || c === 43 || c === 47)) fail('invalid_encoding');
  }
  let binary: string;
  try { binary = atob(r.payload); } catch { return fail('invalid_encoding'); }
  if (binary.length !== r.byteLength) fail('invalid_encoding');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  if (base64(bytes) !== r.payload) fail('invalid_encoding'); // includes unused padding bits
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 16_384) {
    const units: number[] = [];
    for (let j = i; j < Math.min(i + 16_384, bytes.length); j += 2) units.push(bytes[j] | bytes[j + 1] << 8);
    parts.push(String.fromCharCode(...units));
  }
  return { raw: parts.join(''), bytes };
}
export async function summarize(record: Awaited<ReturnType<typeof decodeNativeRecord>>): Promise<Summary> {
  // ledgerRaw is already fully verified by the historical host decoder.
  const ledger = JSON.parse(record.ledgerRaw);
  const legacy = record.hostVersion === 2 ? await decodeHost(record.legacyBaseRaw) : null;
  return { hostVersion: record.hostVersion, hostId: record.hostId, origin: record.environment.origin,
    baseProvenance: record.hostVersion === 2 ? record.baseProvenance : null,
    verifierId: record.hostVersion === 2 ? record.verifier : 'g03-native-one-row/v1',
    authorityGeneration: record.authority.generation, eventTipSha256: record.authority.tipSha256,
    ledgerRawSha256: await rawDigest(record.ledgerRaw), reservationsSha256: await digest(record.authority.reservedIds),
    floorSha256: await rawDigest(JSON.stringify({ issuedIds: ledger.issuedIds, reservedIds: ledger.reservedIds })),
    grantCount: [...(legacy?.events ?? []), ...record.events].filter(e => e.body.kind === 'reserve').length,
    receiptCount: record.receipts.length, operationCount: ledger.journal.entries.length };
}
const hash = (x: unknown) => { if (typeof x !== 'string' || !/^[a-f0-9]{64}$/.test(x)) fail('shape'); };

/** Integrity-only file inspection. No native handle, restore ticket or issuer
 * authentication is produced, even for a locally exported file. */
export async function inspectBackupBytes(input: Uint8Array) {
  if (!(input instanceof Uint8Array)) fail('input_type');
  if (input.byteLength > LIMITS.fileBytes) fail('resource_limit');
  const bytes = input.slice(); // own immutable input before the first await
  let text: string;
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail('invalid_utf8');
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch { return fail('invalid_utf8'); }
  const p = parseBackupJson(text);
  keys(p, ['format', 'backupVersion', 'policy', 'createdAt', 'producer', 'record', 'summary', 'integrity']);
  if (p.format !== FORMAT || p.backupVersion !== 1 || p.policy !== POLICY) fail('unsupported_backup');
  if (typeof p.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.createdAt)
    || !Number.isFinite(Date.parse(p.createdAt)) || new Date(p.createdAt).toISOString() !== p.createdAt) fail('shape');
  keys(p.producer, ['repository', 'revision', 'exporter']);
  if (p.producer.repository !== 'wata-0911/housei-media' || p.producer.exporter !== EXPORTER
    || typeof p.producer.revision !== 'string' || !/^[a-f0-9]{40}$/.test(p.producer.revision)) fail('unsupported_backup');
  keys(p.integrity, ['algorithm', 'sha256']); hash(p.integrity.sha256);
  if (p.integrity.algorithm !== 'sha256-canonical-json/v1') fail('unsupported_backup');
  const { integrity, ...body } = p;
  if (await digest(body) !== integrity.sha256) fail('backup_mismatch');
  const decoded = decodeRecord(p.record as Backup['record']); hash((p.record as Backup['record']).sha256);
  if (await sha256(decoded.bytes) !== (p.record as Backup['record']).sha256) fail('backup_mismatch');
  const record = await decodeNativeRecord(decoded.raw), summary = await summarize(record);
  if (!equal(p.summary, summary)) fail('backup_mismatch');
  // Public result is a frozen integrity description; caller bytes never retained.
  return freeze({ backup: p as unknown as Backup, raw: decoded.raw, record,
    fileSha256: await sha256(bytes), fileByteLength: bytes.length });
}

/** Packing is not export qualification. Only the native controller may issue an
 * export file. Tests/offline tools may build an unqualified integrity package. */
export async function packBackup(raw: string, createdAt = new Date().toISOString()): Promise<Uint8Array> {
  const revision = requireExporterRevision();
  const record = await decodeNativeRecord(raw), encoded = utf16Bytes(raw);
  const body = { format: FORMAT, backupVersion: 1 as const, policy: POLICY, createdAt,
    producer: { repository: 'wata-0911/housei-media' as const, revision, exporter: EXPORTER },
    record: { encoding: 'js-utf16le-base64/v1' as const, codeUnits: raw.length, byteLength: encoded.length,
      sha256: await sha256(encoded), payload: base64(encoded) }, summary: await summarize(record) };
  const file = new TextEncoder().encode(JSON.stringify({ ...body, integrity: { algorithm: 'sha256-canonical-json/v1', sha256: await digest(body) } }));
  const checked = await inspectBackupBytes(file);
  if (checked.raw !== raw || !equal(checked.record, record)) fail('backup_mismatch');
  return file;
}

export async function readSelectedFile(file: File) {
  // Intrinsic brand checks/getters avoid caller-overridden size/arrayBuffer/name.
  const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!.call(file) as number;
  if (size > LIMITS.fileBytes) fail('resource_limit');
  const name = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!.call(file) as string;
  if (new TextEncoder().encode(name).length > LIMITS.metadataBytes) fail('resource_limit');
  const bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(file));
  if (bytes.length !== size) fail('backup_mismatch');
  return { name, bytes, checked: await inspectBackupBytes(bytes) };
}
