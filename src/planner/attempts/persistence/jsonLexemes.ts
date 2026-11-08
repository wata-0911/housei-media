// Resource and decimal policy only. This never grants authority or replaces
// the historical schema/checkpoint/replay validators. Never rewrite raw.
import { ReservationBudget } from './reservationBudget';
export const AUTHORITY_RAW_BYTES = 32 * 1024 * 1024;
export const NUMBER_TOKEN_CHARS = 256;
const digit = (c: string) => c >= '0' && c <= '9';

function decimal(token: string): string {
  // Tokens are grammar-checked and bounded BEFORE this small expression runs.
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
  const fraction = m[3] ?? '', exponent = (m[4] ?? '0').replace(/^[+-]?0*/, '');
  if (exponent.length > 6) throw new Error('number_exponent_precision');
  let digits = (m[2] + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  let power = Number(m[4] ?? '0') - fraction.length;
  const trimmed = digits.replace(/0+$/, ''); power += digits.length - trimmed.length; digits = trimmed;
  return `${m[1]}${digits}e${power}`;
}

/** Iterative lexical/structural inspection BEFORE parsing numeric values.
 * Quoted values (including source.raw) are skipped, never rescanned as JSON.
 * Native JSON.parse decodes isolated strings only (keys, format and eligible
 * UUIDs); that cannot convert a numeric value. All string data is raw-bounded.
 */
export function inspectJsonLexemes(raw: string, maxBytes: number, kind: string,
  reservationEnvelope?: { format: string; versions: readonly number[] }): void {
  const fail = (suffix: string): never => { throw new Error(`${kind}_${suffix}`); };
  const syntax = (): never => { throw new SyntaxError(`${kind}_json_syntax`); };
  if (typeof raw !== 'string' || raw.length > maxBytes) fail('input_limit');
  // Exact UTF-8 byte budget without allocating a second full input buffer.
  let bytes = 0;
  for (let j = 0; j < raw.length; j++) {
    const c = raw.charCodeAt(j);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && raw.charCodeAt(j + 1) >= 0xdc00 && raw.charCodeAt(j + 1) <= 0xdfff) { bytes += 4; j++; }
    else bytes += 3;
    if (bytes > maxBytes) fail('input_limit');
  }
  type Frame = { object: boolean; root: boolean; key?: string; reservations?: ReservationBudget;
    phase: 'keyOrEnd' | 'key' | 'colon' | 'valueOrEnd' | 'value' | 'comma'; keys: Set<string>; children: number };
  const stack: Frame[] = [];
  let envelopeFormat: unknown, envelopeVersion: unknown, reservationList = false;
  let i = 0, values = 0;
  function white() { while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t' || raw[i] === '\r' || raw[i] === '\n')) i++; }
  function stringToken(): string {
    const start = i++;
    while (i < raw.length) {
      const c = raw[i++];
      if (c === '"') return raw.slice(start, i);
      if (c.charCodeAt(0) < 0x20) syntax();
      if (c === '\\') {
        const escape = raw[i++];
        if (escape === 'u') {
          for (let n = 0; n < 4; n++) { const hex = raw[i++]; if (!hex || !/[0-9a-fA-F]/.test(hex)) syntax(); }
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) syntax();
      }
    }
    return syntax();
  }
  function numberToken(): number {
    const start = i;
    const consume = () => { i++; if (i - start > NUMBER_TOKEN_CHARS) fail('number_limit'); };
    if (raw[i] === '-') consume();
    if (raw[i] === '0') { consume(); if (digit(raw[i])) syntax(); }
    else { if (!(raw[i] >= '1' && raw[i] <= '9')) syntax(); while (digit(raw[i])) consume(); }
    if (raw[i] === '.') { consume(); if (!digit(raw[i])) syntax(); while (digit(raw[i])) consume(); }
    if (raw[i] === 'e' || raw[i] === 'E') {
      consume(); if (raw[i] === '+' || raw[i] === '-') consume();
      const exponentStart = i;
      if (!digit(raw[i])) syntax();
      while (digit(raw[i])) { consume(); if (i - exponentStart > 16) fail('number_limit'); }
    }
    const token = raw.slice(start, i);
    // Number conversion is bounded; no arbitrary-size integer/exponent work.
    const number = Number(token);
    try {
      if (!Number.isFinite(number) || Object.is(number, -0)
        || (Number.isInteger(number) && !Number.isSafeInteger(number))
        || decimal(token) !== decimal(String(number))) fail('number_precision');
    } catch { fail('number_precision'); }
    return number;
  }
  function value() {
    white(); if (++values > 1_000_000 || stack.length > 64) fail('resource_limit');
    const c = raw[i], parent = stack[stack.length - 1];
    const rootKey = parent?.root && parent.object ? parent.key : undefined;
    if (reservationEnvelope && rootKey === 'reservedIds') {
      if (c !== '[') fail('reservation_shape');
      i++; reservationList = true;
      stack.push({ object: false, root: false, phase: 'valueOrEnd', keys: new Set(), children: 0, reservations: new ReservationBudget(kind) });
    }
    else if (parent?.reservations) {
      if (c !== '"') fail('reservation_shape');
      parent.reservations.add(JSON.parse(stringToken()) as string);
    }
    else if (c === '{' || c === '[') { i++; stack.push({ object: c === '{', root: !parent, phase: c === '{' ? 'keyOrEnd' : 'valueOrEnd', keys: new Set(), children: 0 }); }
    else if (c === '"') { const token = stringToken(); if (rootKey === 'format') envelopeFormat = JSON.parse(token); }
    else if (c === '-' || digit(c)) { const number = numberToken(); if (rootKey === 'backupVersion') envelopeVersion = number; }
    else if (raw.startsWith('true', i)) i += 4;
    else if (raw.startsWith('false', i)) i += 5;
    else if (raw.startsWith('null', i)) i += 4;
    else syntax();
  }
  value();
  while (stack.length) {
    white(); const f = stack[stack.length - 1], close = f.object ? '}' : ']';
    if ((f.phase === 'keyOrEnd' || f.phase === 'valueOrEnd') && raw[i] === close) { i++; stack.pop(); continue; }
    if (f.phase === 'keyOrEnd' || f.phase === 'key') {
      if (raw[i] !== '"') syntax();
      const key = JSON.parse(stringToken()) as string;
      if (f.keys.has(key)) throw new Error('duplicate_json_key');
      f.keys.add(key); f.key = key; if (f.keys.size > 100_000) fail('resource_limit');
      f.phase = 'colon';
    } else if (f.phase === 'colon') {
      if (raw[i++] !== ':') syntax(); f.phase = 'value';
    } else if (f.phase === 'value' || f.phase === 'valueOrEnd') {
      if (++f.children > 100_000 && !f.reservations) fail('resource_limit'); f.phase = 'comma'; value();
    } else {
      if (raw[i] === close) { i++; stack.pop(); }
      else if (raw[i++] === ',') f.phase = f.object ? 'key' : 'value';
      else syntax();
    }
  }
  white(); if (i !== raw.length) syntax();
  if (reservationList && (envelopeFormat !== reservationEnvelope!.format
    || !reservationEnvelope!.versions.includes(envelopeVersion as number))) fail('reservation_envelope');
}

export const inspectAuthorityInput = (raw: string) => inspectJsonLexemes(raw, AUTHORITY_RAW_BYTES, 'authority');
