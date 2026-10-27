/** State-only acceptance policy; no storage capacity/backup/Graph contract changes. */
export const REPLAY_STATE_LIMITS = Object.freeze({
  rawBytes: 64 * 1024 * 1024, depth: 72, containers: 500_000,
  values: 2_000_000, fields: 1_500_000,
  stringBytes: 24 * 1024 * 1024, totalStringBytes: 64 * 1024 * 1024,
  commands: 10_000, corrections: 128,
  // Conservative structural work units, NOT milliseconds or a heap guarantee.
  work: 250_000_000,
});
export type InputCode = 'json_input_type' | 'json_syntax' | 'duplicate_json_key'
  | 'unrepresentable_json_number' | 'resource_limit' | 'state_shape';
export class StateJsonInputError extends Error {
  constructor(readonly code: InputCode, message: string) { super(message); }
}
export function checkStateBudget(budget: keyof typeof REPLAY_STATE_LIMITS, value: number): void {
  if (value > REPLAY_STATE_LIMITS[budget]) throw new StateJsonInputError('resource_limit', `${budget} exceeds limit ${REPLAY_STATE_LIMITS[budget]}`);
}
/** Constant-time main-thread gate. Exact UTF-8/structure checks run in Worker.
 * UTF-16 length is only a lower bound on UTF-8 bytes. No stringify/coercion. */
export function checkReplayString(raw: string): void {
  if (typeof raw !== 'string') throw new StateJsonInputError('json_input_type', 'Expected a primitive JSON string');
  checkStateBudget('rawBytes', raw.length);
}

/** Exact transport gate for long strings. Short strings are safe by the UTF-8
 * upper bound of 3 bytes per UTF-16 unit. Long scans yield between small chunks,
 * including surrogate pairs at chunk boundaries; no input-sized buffer/parse. */
export async function checkReplayTransport(raw: string, cancelled: () => boolean): Promise<void> {
  checkReplayString(raw);
  if (raw.length <= Math.floor(REPLAY_STATE_LIMITS.rawBytes / 3)) return;
  let bytes = 0;
  for (let i = 0; i < raw.length;) {
    if (cancelled()) return;
    const end = Math.min(raw.length, i + 65_536);
    for (; i < end; i++) {
      const unit = raw.charCodeAt(i);
      if (unit <= 0x7f) bytes++;
      else if (unit <= 0x7ff) bytes += 2;
      else if (unit >= 0xd800 && unit <= 0xdbff && raw.charCodeAt(i + 1) >= 0xdc00 && raw.charCodeAt(i + 1) <= 0xdfff) {
        bytes += 4; i++;
      } else bytes += 3;
    }
    checkStateBudget('rawBytes', bytes);
    if (i < raw.length) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}
