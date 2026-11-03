/** Graph-only limits. These are not profiles for state, backup or migration. */
export const ATTEMPT_GRAPH_JSON_LIMITS = Object.freeze({
  rawBytes: 32 * 1024 * 1024,
  depth: 64,
  containers: 100_000,
  values: 1_000_000,
  fields: 500_000,
  stringBytes: 8 * 1024 * 1024,
  totalStringBytes: 32 * 1024 * 1024,
});

type JsonInputCode = 'json_input_type' | 'json_syntax' | 'duplicate_json_key'
  | 'unrepresentable_json_number' | 'resource_limit';
export class AttemptJsonInputError extends Error {
  constructor(readonly code: JsonInputCode, message: string) { super(message); }
}
type Budget = keyof typeof ATTEMPT_GRAPH_JSON_LIMITS;
function check(budget: Budget, value: number): void {
  const maximum = ATTEMPT_GRAPH_JSON_LIMITS[budget];
  if (value > maximum) throw new AttemptJsonInputError('resource_limit', `${budget} exceeds limit ${maximum}`);
}
function syntax(): never { throw new AttemptJsonInputError('json_syntax', 'Invalid JSON syntax'); }
function nativeParse(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch (error) {
    // Only this native call's SyntaxError is an input diagnosis. Other failures
    // (including freeze/schema/context failures at the caller) keep identity.
    if (error instanceof SyntaxError) syntax();
    throw error;
  }
}

/** UTF-8 length without an input-sized TextEncoder allocation. Lone surrogates
 * use the encoder's three replacement bytes; valid pairs use four bytes. */
function checkRawBytes(raw: string): void {
  check('rawBytes', raw.length); // UTF-16 units are a lower bound, not byte size.
  let bytes = 0;
  for (let i = 0; i < raw.length; i++) {
    const unit = raw.charCodeAt(i);
    if (unit <= 0x7f) bytes++;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && raw.charCodeAt(i + 1) >= 0xdc00 && raw.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4; i++;
    } else bytes += 3;
    check('rawBytes', bytes);
  }
}

type Frame =
  | { kind: 'object'; state: 'keyOrEnd' | 'key' | 'colon' | 'value' | 'commaOrEnd'; keys: Set<string> }
  | { kind: 'array'; state: 'valueOrEnd' | 'value' | 'commaOrEnd' };

/** Bounded, iterative preflight followed by native parsing without a reviver.
 * It returns an ordinary private tree, never a snapshot/source certificate.
 * No caller objects, callbacks, token array or recursively parsed containers.
 * The validation module alone freezes/registers its own result before use. */
export function parseAttemptGraphJson(raw: string): unknown {
  if (typeof raw !== 'string') throw new AttemptJsonInputError('json_input_type', 'Expected a primitive JSON string');
  checkRawBytes(raw);
  let cursor = 0, containers = 0, values = 0, fields = 0, totalStringBytes = 0;
  const stack: Frame[] = [];
  const whitespace = () => {
    while (raw[cursor] === ' ' || raw[cursor] === '\t' || raw[cursor] === '\n' || raw[cursor] === '\r') cursor++;
  };
  const string = (key: boolean): string => {
    const start = cursor++;
    let bytes = 0, high = false, escaped = false;
    while (cursor < raw.length) {
      let unit = raw.charCodeAt(cursor++);
      if (unit === 0x22) {
        // Key decoding happens only after its byte budget passed. Values need
        // no intermediate allocation: the final native parse decodes them.
        return key ? (escaped ? nativeParse(raw.slice(start, cursor)) as string : raw.slice(start + 1, cursor - 1)) : '';
      }
      if (unit < 0x20) syntax();
      if (unit === 0x5c) {
        escaped = true;
        const escape = raw[cursor++];
        if (escape === 'u') {
          unit = 0;
          for (let j = 0; j < 4; j++) {
            const hex = raw.charCodeAt(cursor++);
            const digit = hex >= 48 && hex <= 57 ? hex - 48 : hex >= 65 && hex <= 70 ? hex - 55 : hex >= 97 && hex <= 102 ? hex - 87 : -1;
            if (digit < 0) syntax();
            unit = unit * 16 + digit;
          }
        } else {
          switch (escape) {
            case '"': unit = 0x22; break;
            case '\\': unit = 0x5c; break;
            case '/': unit = 0x2f; break;
            case 'b': unit = 8; break;
            case 'f': unit = 12; break;
            case 'n': unit = 10; break;
            case 'r': unit = 13; break;
            case 't': unit = 9; break;
            default: syntax();
          }
        }
      }
      // Count the first high surrogate as three bytes, then one more for its
      // paired low surrogate. This also handles raw/escaped mixed pairs.
      const added = high && unit >= 0xdc00 && unit <= 0xdfff ? 1 : unit <= 0x7f ? 1 : unit <= 0x7ff ? 2 : 3;
      high = unit >= 0xd800 && unit <= 0xdbff;
      bytes += added; totalStringBytes += added;
      check('stringBytes', bytes); check('totalStringBytes', totalStringBytes);
    }
    return syntax();
  };
  const digit = () => raw[cursor] >= '0' && raw[cursor] <= '9';
  const number = () => {
    const start = cursor;
    if (raw[cursor] === '-') cursor++;
    if (raw[cursor] === '0') cursor++;
    else {
      if (!(raw[cursor] >= '1' && raw[cursor] <= '9')) syntax();
      while (digit()) cursor++;
    }
    if (raw[cursor] === '.') {
      cursor++; if (!digit()) syntax();
      while (digit()) cursor++;
    }
    if (raw[cursor] === 'e' || raw[cursor] === 'E') {
      cursor++; if (raw[cursor] === '+' || raw[cursor] === '-') cursor++;
      if (!digit()) syntax();
      while (digit()) cursor++;
    }
    const value = Number(raw.slice(start, cursor));
    if (!Number.isFinite(value) || Object.is(value, -0) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new AttemptJsonInputError('unrepresentable_json_number', 'JSON number cannot be preserved by the Number contract');
    }
  };
  const value = () => {
    check('values', ++values);
    const token = raw[cursor];
    if (token === '{' || token === '[') {
      check('depth', stack.length); check('containers', ++containers);
      stack.push(token === '{' ? { kind: 'object', state: 'keyOrEnd', keys: new Set() } : { kind: 'array', state: 'valueOrEnd' });
      cursor++;
    } else if (token === '"') string(false);
    else if (token === '-' || digit()) number();
    else {
      const literal = token === 't' ? 'true' : token === 'f' ? 'false' : token === 'n' ? 'null' : undefined;
      if (!literal || !raw.startsWith(literal, cursor)) syntax();
      cursor += literal.length;
    }
  };
  whitespace(); value();
  while (stack.length) {
    whitespace();
    const frame = stack[stack.length - 1], token = raw[cursor];
    if (frame.kind === 'object') {
      switch (frame.state) {
        case 'keyOrEnd':
          if (token === '}') { cursor++; stack.pop(); break; }
          // A key after a comma cannot be replaced by a closing brace.
          frame.state = 'key';
          // falls through
        case 'key': {
          if (token !== '"') syntax();
          check('fields', ++fields);
          const key = string(true);
          if (frame.keys.has(key)) throw new AttemptJsonInputError('duplicate_json_key', 'Duplicate decoded JSON object key');
          frame.keys.add(key); frame.state = 'colon'; break;
        }
        case 'colon':
          if (token !== ':') syntax();
          cursor++; frame.state = 'value'; break;
        case 'value': frame.state = 'commaOrEnd'; value(); break;
        case 'commaOrEnd':
          if (token === '}') { cursor++; stack.pop(); }
          else if (token === ',') { cursor++; frame.state = 'key'; }
          else syntax();
      }
    } else {
      switch (frame.state) {
        case 'valueOrEnd':
          if (token === ']') { cursor++; stack.pop(); break; }
          // falls through
        case 'value': frame.state = 'commaOrEnd'; value(); break;
        case 'commaOrEnd':
          if (token === ']') { cursor++; stack.pop(); }
          else if (token === ',') { cursor++; frame.state = 'value'; }
          else syntax();
      }
    }
  }
  whitespace(); if (cursor !== raw.length) syntax();
  return nativeParse(raw);
}
