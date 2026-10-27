import type { ReplaySummary } from './replayStateJson';
import { StateJsonInputError, REPLAY_STATE_LIMITS } from './limits';

export const RESPONSE_UNITS = 4096;
export type FailureKind = 'invalid_input' | 'resource_limit' | 'internal';
export type SafeError = { name: 'Error'; message: 'Replay failed; details redacted'; cause?: SafeError };
export type ReplayFailure = { kind: FailureKind; code: string; error: SafeError };
export type Response = { version: 1; type: 'ready'; epoch: number }
  | { version: 1; type: 'success'; epoch: number; job: number; summary: ReplaySummary; replayMs: number }
  | { version: 1; type: 'failure'; epoch: number; job: number; failure: ReplayFailure };
const inputCodes = new Set(['json_input_type', 'json_syntax', 'duplicate_json_key', 'unrepresentable_json_number', 'resource_limit', 'state_shape']);
const keys = (v: object, names: string[]) => Object.keys(v).sort().join(',') === names.sort().join(',');
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const sequence = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
export function safeError(value: unknown, depth = 0): SafeError {
  const result: SafeError = { name: 'Error', message: 'Replay failed; details redacted' };
  // Inspect no message/stack/getter. Even cause presence is optional and redacted.
  try {
    if (depth < 2 && value && typeof value === 'object') {
      const cause = Object.getOwnPropertyDescriptor(value, 'cause');
      if (cause) result.cause = safeError('value' in cause ? cause.value : undefined, depth + 1);
    }
  // Legacy generic exceptions are deliberately unclassified. Never infer an
    // input refusal from message text; engine faults can share the same message.
  } catch { /* A hostile thrown Proxy must not break the failure channel. */ }
  return result;
}
export function replayFailure(error: unknown): ReplayFailure {
  let kind: FailureKind = 'internal', code = 'unexpected_error';
  try {
    if (error instanceof StateJsonInputError) {
      kind = error.code === 'resource_limit' ? 'resource_limit' : 'invalid_input'; code = error.code;
    }
    // Legacy generic exceptions are deliberately unclassified. Never infer an
    // input refusal from message text; engine faults can share the same message.
  } catch { kind = 'internal'; code = 'unexpected_error'; }
  return { kind, code, error: safeError(error) };
}
function validSafeError(v: unknown, depth = 0): boolean {
  return record(v) && keys(v, 'cause' in v ? ['name','message','cause'] : ['name','message'])
    && v.name === 'Error' && v.message === 'Replay failed; details redacted'
    && (!('cause' in v) || depth < 2 && validSafeError(v.cause, depth + 1));
}
/** Parse a bounded primitive response, then exact-check every scalar and key. */
export function parseResponse(raw: unknown): Response {
  const fail = (): never => { throw new Error('invalid_replay_protocol'); };
  if (typeof raw !== 'string' || raw.length > RESPONSE_UNITS) return fail();
  let v: unknown; try { v = JSON.parse(raw); } catch { return fail(); }
  if (!record(v) || v.version !== 1 || !sequence(v.epoch)) return fail();
  if (v.type === 'ready' && keys(v, ['version','type','epoch'])) return v as Response;
  if (!sequence(v.job)) return fail();
  if (v.type === 'failure' && keys(v, ['version','type','epoch','job','failure'])) {
    const f = v.failure;
    if (record(f) && keys(f, ['kind','code','error']) && validSafeError(f.error)
      && (f.kind === 'internal' && f.code === 'unexpected_error'
        || f.kind === 'invalid_input' && (inputCodes.has(f.code as string) && f.code !== 'resource_limit')
        || f.kind === 'resource_limit' && f.code === 'resource_limit')) return v as Response;
  }
  if (v.type === 'success' && keys(v, ['version','type','epoch','job','summary','replayMs'])) {
    const s = v.summary;
    if (record(s) && keys(s, ['kind','schemaVersion','commands','attempts','ownedRecords','removals','reservations','graphSha256','retainedSha256'])
      && s.kind === 'read-only-replay' && (s.schemaVersion === 23 || s.schemaVersion === 24)
      && ['commands','attempts','ownedRecords','removals','reservations'].every(k => Number.isSafeInteger(s[k]) && (s[k] as number) >= 0 && (s[k] as number) <= REPLAY_STATE_LIMITS.values)
      && (s.commands as number) <= REPLAY_STATE_LIMITS.commands
      && typeof s.graphSha256 === 'string' && /^[0-9a-f]{64}$/.test(s.graphSha256)
      && typeof s.retainedSha256 === 'string' && /^[0-9a-f]{64}$/.test(s.retainedSha256)
      && typeof v.replayMs === 'number' && Number.isFinite(v.replayMs) && v.replayMs >= 0) return v as Response;
  }
  return fail();
}
