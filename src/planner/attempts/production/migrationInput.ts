/** Migration files include a complete legacy catalog. This resource policy is
 * separate from the 1 Mi code-unit primitive-edit policy. Never rewrite raw. */
export const MIGRATION_INPUT_BYTES = 16 * 1024 * 1024;
// An Attempt backup contains a full state plus the host reservation envelope.
// Keep this policy independent of the legacy migration-file cap.
export const ATTEMPT_BACKUP_INPUT_BYTES = 64 * 1024 * 1024;
function decimal(token: string, kind: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
  const fraction = match[3] ?? '';
  let digits = (match[2] + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const stripped = (match[4] ?? '0').replace(/^([+-]?)0+/, '$1');
  const exponent = /^[+-]?$/.test(stripped) ? '0' : stripped;
  if (exponent.replace(/^[+-]/, '').length > 6) throw new Error(`${kind}_number_precision`);
  let power = Number(exponent) - fraction.length;
  const trimmed = digits.replace(/0+$/, ''); power += digits.length - trimmed.length; digits = trimmed;
  return `${match[1]}${digits}e${power}`;
}
function inspectArchiveInput(raw: string, maxBytes: number, kind: string): unknown {
  if (typeof raw !== 'string' || raw.length > maxBytes
    || new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error(`${kind}_input_limit`);
  const value: unknown = JSON.parse(raw);
  // Iterative structural budget before the historical decoder's recursive
  // duplicate-key inspection; no catalog/state is normalized by this pass.
  const stack: {value: unknown; depth: number}[] = [{value, depth: 0}];
  let count = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++count > 1_000_000 || item.depth > 64) throw new Error(`${kind}_resource_limit`);
    if (item.value && typeof item.value === 'object') {
      const values = Object.values(item.value);
      if (values.length > 100_000) throw new Error(`${kind}_resource_limit`);
      for (const v of values) stack.push({value: v, depth: item.depth + 1});
    }
  }
  // Quoted strings are skipped as whole tokens. Compare decimal values after
  // normalization, permitting 4/4.0/4e0 but rejecting rounded source quantities.
  for (const match of raw.matchAll(/"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    const token = match[0]; if (token[0] === '"') continue;
    const number = Number(token);
    if (!Number.isFinite(number) || Object.is(number, -0) || decimal(token, kind) !== decimal(String(number), kind))
      throw new Error(`${kind}_number_precision`);
  }
  return value;
}

export const inspectMigrationInput = (raw: string) => inspectArchiveInput(raw, MIGRATION_INPUT_BYTES, 'migration');
export const inspectAttemptBackupInput = (raw: string) => inspectArchiveInput(raw, ATTEMPT_BACKUP_INPUT_BYTES, 'attempt_backup');
