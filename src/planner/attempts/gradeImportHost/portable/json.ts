import { LIMITS, fail } from './contracts';

/** B1-only bounded preflight. Historical graph parser and its budgets are
 * untouched. Only root.record.payload gets the base64-sized string budget.
 * Parse private UTF-8 text, never caller objects/revivers. Root depth is zero. */
export function parseBackupJson(raw: string): unknown {
  if (typeof raw !== 'string') fail('input_type');
  if (raw.length > LIMITS.fileBytes) fail('resource_limit');
  const rawBytes = new TextEncoder().encode(raw).length;
  if (rawBytes > LIMITS.fileBytes) fail('resource_limit');
  let cursor = 0, containers = 0, fields = 0, values = 0, strings = 0, metadata = 0, payloadWireBytes = 0;
  const ws = () => { while (' \t\r\n'.includes(raw[cursor] ?? '\0')) cursor++; };
  const syntax = (): never => fail('invalid_json');
  const string = (key: boolean, payload: boolean): string => {
    if (raw[cursor++] !== '"') syntax();
    const start = cursor - 1; let bytes = 0, high = false;
    for (;;) {
      if (cursor >= raw.length) syntax();
      let unit = raw.charCodeAt(cursor++);
      if (unit === 34) {
        if (payload) payloadWireBytes += cursor - start - 2; // payload wire is ASCII, including escapes
        if (!key) return '';
        return JSON.parse(raw.slice(start, cursor)) as string;
      }
      if (payload && unit > 127) fail('invalid_encoding');
      if (unit < 32) syntax();
      if (unit === 92) {
        const e = raw[cursor++];
        if (e === 'u') {
          const h = raw.slice(cursor, cursor + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) syntax();
          unit = parseInt(h, 16); cursor += 4;
        } else {
          const escapes: Record<string, number> = { '"': 34, '\\': 92, '/': 47, b: 8, f: 12, n: 10, r: 13, t: 9 };
          if (!Object.hasOwn(escapes, e)) syntax();
          unit = escapes[e];
        }
      }
      const added = high && unit >= 0xdc00 && unit <= 0xdfff ? 1 : unit <= 127 ? 1 : unit <= 2047 ? 2 : 3;
      high = unit >= 0xd800 && unit <= 0xdbff;
      bytes += added; strings += added; if (!payload) metadata += added;
      if (bytes > (payload ? LIMITS.payloadChars : LIMITS.metadataBytes)
        || strings > LIMITS.totalStringBytes || metadata > LIMITS.metadataBytes) fail('resource_limit');
    }
  };
  const value = (depth: number, path: string[]): void => {
    if (++values > LIMITS.values) fail('resource_limit');
    ws(); const c = raw[cursor];
    if (c === '{' || c === '[') {
      if (depth > LIMITS.depth || ++containers > LIMITS.containers) fail('resource_limit');
      cursor++; ws(); const object = c === '{', end = object ? '}' : ']';
      if (raw[cursor] === end) { cursor++; return; }
      const keys = new Set<string>(); let index = 0;
      for (;;) {
        ws(); let name = String(index++);
        if (object) {
          if (++fields > LIMITS.fields) fail('resource_limit');
          name = string(true, false);
          if (keys.has(name)) syntax(); keys.add(name);
          ws(); if (raw[cursor++] !== ':') syntax();
        }
        value(depth + 1, [...path, name]); ws();
        if (raw[cursor] === end) { cursor++; return; }
        if (raw[cursor++] !== ',') syntax();
      }
    }
    if (c === '"') { string(false, path.length === 2 && path[0] === 'record' && path[1] === 'payload'); return; }
    if (c >= '0' && c <= '9') {
      const start = cursor++;
      if (c !== '0') while (raw[cursor] >= '0' && raw[cursor] <= '9') cursor++;
      // B1 and confirmation have only nonnegative integer numeric fields.
      // Fractions/exponents/-0 are refused rather than silently rounded.
      if (!Number.isSafeInteger(Number(raw.slice(start, cursor)))) fail('invalid_json');
      return;
    }
    for (const literal of ['true', 'false', 'null']) if (raw.startsWith(literal, cursor)) { cursor += literal.length; return; }
    syntax();
  };
  value(0, []); ws(); if (cursor !== raw.length) syntax();
  // Includes punctuation, numeric tokens, whitespace and escaped spellings,
  // rather than counting only decoded metadata string values.
  if (rawBytes - payloadWireBytes > LIMITS.metadataBytes) fail('resource_limit');
  return JSON.parse(raw);
}

export function keys(v: unknown, expected: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)
    || Object.keys(v).sort().join(',') !== [...expected].sort().join(',')) fail('shape');
}
