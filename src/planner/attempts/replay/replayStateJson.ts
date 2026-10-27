import { replayState } from '../persistence/codec';
import { StateJsonInputError, checkStateBudget } from './limits';
import { scanStateJson } from './stateJson';

export type ReplaySummary = Readonly<{
  kind: 'read-only-replay'; schemaVersion: 23 | 24; commands: number;
  attempts: number; ownedRecords: number; removals: number; reservations: number;
  graphSha256: string; retainedSha256: string;
}>;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StateJsonInputError('state_shape', 'Expected state object');
  return value as Record<string, unknown>;
}
/** Only privately parsed JSON enters full replay. Never issues a persistence handle,
 * ID, source certificate, preview token, adoption or local checkpoint. */
export async function replayStateJson(raw: string): Promise<ReplaySummary> {
  const parsed = scanStateJson(raw), state = record(parsed.value);
  const history = record(state.history), graph = record(state.graph);
  if (![23, 24].includes(state.schemaVersion as number) || !Array.isArray(history.commands)
    || !['attempts', 'ownedRecords', 'removals'].every(k => Array.isArray(graph[k]))) {
    throw new StateJsonInputError('state_shape', 'Expected schema23/24 state');
  }
  checkStateBudget('commands', history.commands.length);
  // Aggregate source JSON too: a quoted source must not bypass depth/duplicate/
  // allocation limits before the existing migration decoder tokenizes it.
  let nodes = parsed.values, strings = parsed.totalStringBytes, fields = parsed.fields, containers = parsed.containers;
  if (state.schemaVersion === 23) {
    const source = record(state.source);
    if (!Array.isArray(state.corrections)) throw new StateJsonInputError('state_shape', 'Expected corrections');
    checkStateBudget('corrections', state.corrections.length);
    for (const text of [source.raw, ...state.corrections.flatMap(c => {
      const correction = record(c); return [correction.originalRaw, correction.proposedRaw];
    })]) {
      const nested = scanStateJson(text as string);
      nodes += nested.values; strings += nested.totalStringBytes; fields += nested.fields; containers += nested.containers;
      checkStateBudget('fields', fields); checkStateBudget('containers', containers);
      checkStateBudget('values', nodes); checkStateBudget('totalStringBytes', strings);
    }
  }
  // Every retained/command/source value is charged each round, including payloads
  // deleted before the final graph. +100k charges the bundled context each round;
  // corrections amplify source decoding/builds. No replay iteration is skipped.
  const owners = (graph.ownedRecords as unknown[]).length + history.commands.filter(c => record(c).kind === 'add_record').length;
  const work = (nodes + Math.ceil(strings / 16) + 100_000 + owners ** 2) * (history.commands.length + 1)
    * (state.schemaVersion === 23 ? 1 + (state.corrections as unknown[]).length : 1);
  checkStateBudget('work', work);
  const replay = await replayState(parsed.value);
  return Object.freeze({ kind: 'read-only-replay', schemaVersion: replay.state.schemaVersion,
    commands: replay.workspace.receipts.length, attempts: replay.workspace.graph.attempts.length,
    ownedRecords: replay.workspace.graph.ownedRecords.length, removals: replay.workspace.graph.removals.length,
    reservations: replay.requiredReservations.length,
    graphSha256: replay.state.verification.graphSha256, retainedSha256: replay.state.verification.retainedSha256 });
}
