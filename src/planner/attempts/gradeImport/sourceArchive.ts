import { parseHoseiGradeImportV1, type HoseiGradeImportV1 } from '../../gradeImport/gradeImportContract';
import { parseAttemptGraphJson, AttemptJsonInputError } from '../jsonInput';
import { canonicalBackupJson, backupRawDigest, backupDigest } from '../../digest';

// Local source contract only. These are NOT state N, backup B, authority A or replay U.
export const SOURCE_FORMAT = 'hosei-g01a-source-prototype' as const;
export const SOURCE_VERSION = '0.1.0-prototype' as const;
export const SOURCE_POLICY = Object.freeze({
  id: 'g01a-source-utf8-v1-prototype',
  dtoContract: 'hosei_web_learning_grade_table/v1',
  normalization: 'pinned-v1-allowlist',
  digest: 'sha256/utf8-raw+canonical-sorted-keys-preserve-array-order',
  numericPolicy: 'decimal-roundtrip-no-underflow-or-rounding',
} as const);
// Prototype acceptance ceilings, deliberately below the existing host record limit.
// They are not measured production capacity promises. Callers may only tighten them.
export type SourceLimits = { maxRawBytes: number; maxCourses: number; maxArchiveBytes: number };
export const SOURCE_LIMITS: Readonly<SourceLimits> = Object.freeze({ maxRawBytes: 1024 * 1024, maxCourses: 2000, maxArchiveBytes: 4 * 1024 * 1024 });
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type GradeSourceArchive = {
  format: typeof SOURCE_FORMAT;
  contractVersion: typeof SOURCE_VERSION;
  policy: typeof SOURCE_POLICY;
  inputContract: { source: 'hosei_web_learning_grade_table'; schemaVersion: 1 };
  raw: string;
  rawUtf8Bytes: number;
  rawSha256: string;
  dto: HoseiGradeImportV1;
  dtoSha256: string;
  archiveSha256: string;
};
export type SourceFailureCode = 'input_type' | 'invalid_unicode' | 'invalid_json' | 'duplicate_json_key'
  | 'numeric_precision' | 'invalid_contract' | 'capacity_exceeded' | 'invalid_limits'
  | 'archive_shape' | 'unsupported_version' | 'archive_mismatch' | 'digest_unavailable';
export class SourceContractError extends Error {
  readonly code: SourceFailureCode;
  constructor(code: SourceFailureCode) {
    super(code); this.name = 'SourceContractError'; this.code = code;
  }
}
function fail(code: SourceFailureCode): never { throw new SourceContractError(code); }
function limits(input: Partial<SourceLimits>): SourceLimits {
  if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) fail('invalid_limits');
  const out = { ...SOURCE_LIMITS };
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !Object.hasOwn(out, key)) fail('invalid_limits');
    const k = key as keyof SourceLimits, desc = Object.getOwnPropertyDescriptor(input, k);
    if (!desc || !('value' in desc) || !Number.isSafeInteger(desc.value) || desc.value <= 0 || desc.value > SOURCE_LIMITS[k]) fail('invalid_limits');
    out[k] = desc.value;
  }
  return out;
}
/** Reject literal lone surrogates so raw UTF-8 hashing is injective over accepted text.
 * JSON escape sequences remain exact raw ASCII, including escaped surrogate values. */
function utf8Size(raw: unknown, maximum: number): number {
  if (typeof raw !== 'string') fail('input_type');
  if (raw.length > maximum) fail('capacity_exceeded');
  let size = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = raw.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) fail('invalid_unicode');
      size += 4;
    } else {
      if (c >= 0xdc00 && c <= 0xdfff) fail('invalid_unicode');
      size += c <= 0x7f ? 1 : c <= 0x7ff ? 2 : 3;
    }
    if (size > maximum) fail('capacity_exceeded');
  }
  return size;
}
function parse(raw: string): unknown {
  try { return parseAttemptGraphJson(raw); }
  catch (e) {
    if (e instanceof AttemptJsonInputError) {
      if (e.code === 'duplicate_json_key') fail('duplicate_json_key');
      if (e.code === 'unrepresentable_json_number') fail('numeric_precision');
      if (e.code === 'resource_limit') fail('capacity_exceeded');
      fail('invalid_json');
    }
    throw e;
  }
}
/** Additional source policy: reject decimal information loss, e.g. 1e-999 -> 0.
 * It does not assert IEEE-754 exactness for ordinary decimals such as 0.1. */
function decimalSignature(token: string): string {
  const [mantissa, exponent = '0'] = token.toLowerCase().split('e');
  const sign = mantissa.startsWith('-') ? '-' : '';
  const unsigned = sign ? mantissa.slice(1) : mantissa;
  const [whole, fraction = ''] = unsigned.split('.');
  let digits = (whole + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const tail = digits.length - digits.replace(/0+$/, '').length;
  digits = digits.slice(0, digits.length - tail);
  const power = Number(exponent) - fraction.length + tail;
  if (!Number.isSafeInteger(power)) fail('numeric_precision');
  return `${sign}${digits}@${power}`;
}
function checkDecimalRoundTrips(raw: string): void {
  // JSON structure and token syntax have already passed the pinned parser.
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '"') {
      i++;
      while (i < raw.length) {
        if (raw[i] === '\\') { i += 2; continue; }
        if (raw[i++] === '"') break;
      }
    } else if (raw[i] === '-' || (raw[i] >= '0' && raw[i] <= '9')) {
      const start = i++;
      while (i < raw.length && /[0-9eE+.-]/.test(raw[i])) i++;
      const token = raw.slice(start, i);
      if (decimalSignature(token) !== decimalSignature(String(Number(token)))) fail('numeric_precision');
    } else i++;
  }
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
async function digest<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch { return fail('digest_unavailable'); }
}
/** Primitive text boundary only; no Offering/catalog, identity minting, clock or storage. */
export async function createGradeSourceArchive(input: unknown, options: Partial<SourceLimits> = {}): Promise<DeepReadonly<GradeSourceArchive>> {
  const budget = limits(options);
  const rawUtf8Bytes = utf8Size(input, budget.maxRawBytes);
  const raw = input as string;
  const parsed = parse(raw);
  checkDecimalRoundTrips(raw);
  const dto = parseHoseiGradeImportV1(parsed);
  if (!dto) fail('invalid_contract');
  if (dto.courses.length > budget.maxCourses) fail('capacity_exceeded');
  // Exact size gate BEFORE hashing. Digests are fixed-length lower-case hex strings.
  const body = {
    format: SOURCE_FORMAT, contractVersion: SOURCE_VERSION, policy: SOURCE_POLICY,
    inputContract: { source: 'hosei_web_learning_grade_table' as const, schemaVersion: 1 as const },
    raw, rawUtf8Bytes, rawSha256: '0'.repeat(64), dto, dtoSha256: '0'.repeat(64),
  };
  utf8Size(JSON.stringify({ ...body, archiveSha256: '0'.repeat(64) }), budget.maxArchiveBytes);
  body.rawSha256 = await digest(() => backupRawDigest(raw));
  body.dtoSha256 = await digest(() => backupDigest(dto));
  const archive = { ...body, archiveSha256: await digest(() => backupDigest(body)) };
  return freeze(archive);
}
/** Reconstruct from original text and compare ALL fields, not only declared hashes.
 * A decoded archive has integrity only; this API never issues a host/save capability. */
export async function decodeGradeSourceArchive(input: unknown, options: Partial<SourceLimits> = {}): Promise<DeepReadonly<GradeSourceArchive>> {
  const budget = limits(options);
  utf8Size(input, budget.maxArchiveBytes);
  const parsed = parse(input as string);
  checkDecimalRoundTrips(input as string);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('archive_shape');
  const obj = parsed as Record<string, unknown>;
  const expectedKeys = ['format', 'contractVersion', 'policy', 'inputContract', 'raw', 'rawUtf8Bytes', 'rawSha256', 'dto', 'dtoSha256', 'archiveSha256'];
  if (Object.keys(obj).sort().join(',') !== expectedKeys.sort().join(',')) fail('archive_shape');
  if (obj.format !== SOURCE_FORMAT || obj.contractVersion !== SOURCE_VERSION) fail('unsupported_version');
  const expected = await createGradeSourceArchive(obj.raw, budget);
  if (canonicalBackupJson(obj) !== canonicalBackupJson(expected)) fail('archive_mismatch');
  return expected;
}
