// Private iterative scanner mechanically based on replay/stateJson.ts at PR #200.
// Graph and stage2 profiles remain unchanged. Parsed trees are never capabilities.
export type InputProfile = Readonly<{ rawBytes:number; depth:number; containers:number; values:number; fields:number; stringBytes:number; totalStringBytes:number; commands:number; corrections:number; reservedIds:number; work:number }>;
const base = {rawBytes:64*1024*1024,depth:72,containers:500_000,values:2_000_000,fields:1_500_000,stringBytes:24*1024*1024,totalStringBytes:64*1024*1024,commands:10_000,corrections:128,reservedIds:500_000,work:250_000_000};
export const INPUT_PROFILES = Object.freeze({state:Object.freeze({...base}),backup:Object.freeze({...base,depth:74}),legacy:Object.freeze({...base})});
export type ProfileName = keyof typeof INPUT_PROFILES;
export class WorkerInputError extends Error {
 constructor(readonly code:'json_input_type'|'json_syntax'|'duplicate_json_key'|'unrepresentable_json_number'|'resource_limit'|'state_shape', message='Rejected input'){super(message);}
}
export function checkBudget(p:InputProfile,key:keyof InputProfile,value:number){if(!Number.isSafeInteger(value)||value<0||value>p[key])throw new WorkerInputError('resource_limit');}
export function checkRawString(raw:unknown,p:InputProfile=INPUT_PROFILES.state):asserts raw is string {if(typeof raw!=='string')throw new WorkerInputError('json_input_type');checkBudget(p,'rawBytes',raw.length);}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new WorkerInputError('state_shape');return value as Record<string,unknown>;}
// Separate state scanner: the independently audited Graph profile is unchanged.
function syntax(): never { throw new WorkerInputError('json_syntax', 'Invalid JSON syntax'); }
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
export function checkRawBytes(raw: string, profile: InputProfile): void {
  const checkStateBudget = (key: keyof InputProfile, n: number) => checkBudget(profile, key, n);
  checkStateBudget('rawBytes', raw.length); // UTF-16 units are a lower bound, not byte size.
  let bytes = 0;
  for (let i = 0; i < raw.length; i++) {
    const unit = raw.charCodeAt(i);
    if (unit <= 0x7f) bytes++;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && raw.charCodeAt(i + 1) >= 0xdc00 && raw.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4; i++;
    } else bytes += 3;
    checkStateBudget('rawBytes', bytes);
  }
}

type Frame =
  | { kind: 'object'; state: 'keyOrEnd' | 'key' | 'colon' | 'value' | 'commaOrEnd'; keys: Set<string> }
  | { kind: 'array'; state: 'valueOrEnd' | 'value' | 'commaOrEnd' };

/** Bounded, iterative preflight followed by native parsing without a reviver.
 * It returns an ordinary private tree, never a snapshot/source certificate.
 * No caller objects, callbacks, token array or recursively parsed containers.
 * The validation module alone freezes/registers its own result before use. */
export function scanWorkerJson(raw: string, profile: InputProfile) {
  const checkStateBudget = (key: keyof InputProfile, n: number) => checkBudget(profile, key, n);
  checkRawString(raw, profile);
  checkRawBytes(raw, profile);
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
      checkStateBudget('stringBytes', bytes); checkStateBudget('totalStringBytes', totalStringBytes);
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
      throw new WorkerInputError('unrepresentable_json_number', 'JSON number cannot be preserved by the Number contract');
    }
  };
  const value = () => {
    checkStateBudget('values', ++values);
    const token = raw[cursor];
    if (token === '{' || token === '[') {
      checkStateBudget('depth', stack.length); checkStateBudget('containers', ++containers);
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
          checkStateBudget('fields', ++fields);
          const key = string(true);
          if (frame.keys.has(key)) throw new WorkerInputError('duplicate_json_key', 'Duplicate decoded JSON object key');
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
  return { value: nativeParse(raw), values, containers, fields, totalStringBytes };
}

export function preflight(raw:unknown,kind:ProfileName,profile:InputProfile=INPUT_PROFILES[kind]) {
 checkRawString(raw,profile);
 const outer=scanWorkerJson(raw,profile), root=object(outer.value);
 let values=outer.values,fields=outer.fields,containers=outer.containers,strings=outer.totalStringBytes;
 const embedded=(text:unknown)=>{checkRawString(text,profile);const x=scanWorkerJson(text,profile);values+=x.values;fields+=x.fields;containers+=x.containers;strings+=x.totalStringBytes;checkBudget(profile,'values',values);checkBudget(profile,'fields',fields);checkBudget(profile,'containers',containers);checkBudget(profile,'totalStringBytes',strings);};
 let commands=0,corrections=0,owners=0;
 if(kind==='legacy') {
  const state=object(Object.hasOwn(root,'format')?root.state:root);
  // Unsupported versions remain the controller decoder's held/rejected result.
  if(state.schemaVersion===22){
   if(!Array.isArray(state.todos))throw new WorkerInputError('state_shape');
   owners=state.todos.length;
   for(const key of ['mediaSchoolingProgress','correspondenceProgress','courseEvaluations'])owners+=Object.keys(object(state[key])).length;
  }
 } else {
  if(kind==='backup'&&Object.hasOwn(root,'reservedIds')){if(!Array.isArray(root.reservedIds))throw new WorkerInputError('state_shape');checkBudget(profile,'reservedIds',root.reservedIds.length);if(root.reservedIds.some(x=>typeof x!=='string'))throw new WorkerInputError('state_shape');}
  const state=kind==='backup'?object(root.state):root, history=object(state.history),graph=object(state.graph);
  if(![23,24].includes(state.schemaVersion as number)||!Array.isArray(history.commands)||!['attempts','ownedRecords','removals'].every(k=>Array.isArray(graph[k])))throw new WorkerInputError('state_shape');
  commands=history.commands.length;checkBudget(profile,'commands',commands);
  owners=(graph.ownedRecords as unknown[]).length+history.commands.filter(c=>object(c).kind==='add_record').length;
  if(state.schemaVersion===23){if(!Array.isArray(state.corrections))throw new WorkerInputError('state_shape');corrections=state.corrections.length;checkBudget(profile,'corrections',corrections);embedded(object(state.source).raw);for(const c of state.corrections){const x=object(c);embedded(x.originalRaw);embedded(x.proposedRaw);}}
 }
 const work=(values+Math.ceil(strings/16)+100_000+owners**2)*(commands+1)*(corrections+1);checkBudget(profile,'work',work);
 return {value:outer.value,values,fields,containers,totalStringBytes:strings,work};
}
