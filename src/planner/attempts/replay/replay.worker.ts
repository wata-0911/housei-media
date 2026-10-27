import { replayStateJson } from './replayStateJson';
import { checkReplayString, REPLAY_STATE_LIMITS } from './limits';
import { replayFailure, sequence, type Response } from './protocol';

// Dedicated module Worker, one read-only job. No persistence/controller imports.
const port = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: string): void;
  close(): void;
};
let epoch = 0, used = false, closed = false;
function send(response: Response): void { if (!closed) port.postMessage(JSON.stringify(response)); }
function invalid(): void { closed = true; port.postMessage('invalid_replay_request'); port.close(); }
port.onmessage = event => {
  const wire = event.data;
  if (typeof wire !== 'string' || wire.length > REPLAY_STATE_LIMITS.rawBytes + 100) { invalid(); return; }
  if (!epoch) {
    const match = /^hello:([1-9][0-9]{0,15})$/.exec(wire);
    if (!match || !sequence(Number(match[1]))) { invalid(); return; }
    epoch = Number(match[1]); send({ version: 1, type: 'ready', epoch }); return;
  }
  const newline = wire.indexOf('\n');
  if (used || newline < 0 || newline > 60) { invalid(); return; }
  const match = /^replay:([1-9][0-9]{0,15}):([1-9][0-9]{0,15})$/.exec(wire.slice(0, newline));
  if (!match || Number(match[1]) !== epoch || !sequence(Number(match[2]))) { invalid(); return; }
  used = true;
  const job = Number(match[2]), raw = wire.slice(newline + 1), start = performance.now();
  void (async () => {
    try {
      checkReplayString(raw);
      const summary = await replayStateJson(raw);
      send({ version: 1, type: 'success', epoch, job, summary, replayMs: performance.now() - start });
    } catch (error) {
      send({ version: 1, type: 'failure', epoch, job, failure: replayFailure(error) });
    } finally { port.close(); }
  })();
};
