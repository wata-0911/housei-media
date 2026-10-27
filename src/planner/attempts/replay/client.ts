import { checkReplayString, checkReplayTransport, REPLAY_STATE_LIMITS, StateJsonInputError } from './limits';
import { parseResponse, type ReplayFailure } from './protocol';
import type { ReplaySummary } from './replayStateJson';

export type ClientFailureKind = ReplayFailure['kind'] | 'cancelled' | 'startup_failure' | 'worker_failure' | 'protocol' | 'busy';
export class ReplayClientError extends Error {
  constructor(readonly kind: ClientFailureKind, readonly code: string, readonly remote?: ReplayFailure) {
    super(`Read-only replay failed (${kind}/${code})`);
  }
}
export interface ReplayWorker {
  postMessage(message: string): void; terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}
let nextEpoch = 0, nextJob = 0;
export const createReplayWorker = (): ReplayWorker => new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module', name: 'read-only-attempt-replay' });
export type ReplayResult = Readonly<{ summary: ReplaySummary; timing: Readonly<{ readyMs: number; replayMs: number; wallMs: number }> }>;
/** No queue or replay cache: each job owns a fresh Worker, epoch and termination.
 * Only scalar summaries escape. Abort never publishes a partial result. */
export function createReplayClient(factory: () => ReplayWorker = createReplayWorker) {
  let cancelActive: (() => void) | undefined;
  return Object.freeze({
    cancel(): void { cancelActive?.(); },
    replay(raw: string, signal?: AbortSignal): Promise<ReplayResult> {
      try { checkReplayString(raw); } catch (error) {
        if (error instanceof StateJsonInputError) return Promise.reject(new ReplayClientError(error.code === 'resource_limit' ? 'resource_limit' : 'invalid_input', error.code));
        return Promise.reject(error);
      }
      if (cancelActive) return Promise.reject(new ReplayClientError('busy', 'job_in_progress'));
      if (signal?.aborted) return Promise.reject(new ReplayClientError('cancelled', 'aborted'));
      if (!Number.isSafeInteger(nextEpoch + 1) || !Number.isSafeInteger(nextJob + 1)) return Promise.reject(new ReplayClientError('internal','sequence_exhausted'));
      const epoch = ++nextEpoch, job = ++nextJob, start = performance.now();
      return new Promise((resolve, reject) => {
        let worker: ReplayWorker | undefined, settled = false, ready = false, readyMs = 0;
        const finish = (error?: ReplayClientError, result?: ReplayResult) => {
          if (settled) return;
          settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
          cancelActive = undefined;
          if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
          if (error) reject(error); else resolve(result!);
        };
        const abort = () => finish(new ReplayClientError('cancelled','aborted'));
        // Startup/hung-job bounds; timeout is a failure, never successful cancellation.
        let timer = setTimeout(() => finish(new ReplayClientError('startup_failure','ready_timeout')), 30_000);
        cancelActive = abort; signal?.addEventListener('abort', abort, { once:true });
        const startWorker = () => {
          try {
            worker = factory();
            worker.onmessage = event => {
              if (settled) return; // Covers queued events captured before terminate.
              try {
                const response = parseResponse(event.data);
                if (response.epoch !== epoch || (response.type !== 'ready' && response.job !== job)) throw new Error('stale_response');
                if (response.type === 'ready') {
                  if (ready) throw new Error('duplicate_ready');
                  ready = true; readyMs = performance.now() - start; clearTimeout(timer);
                  timer = setTimeout(() => finish(new ReplayClientError('worker_failure','job_timeout')), 5 * 60_000);
                  worker!.postMessage(`replay:${epoch}:${job}\n${raw}`);
                } else if (!ready) throw new Error('response_before_ready');
                else if (response.type === 'failure') finish(new ReplayClientError(response.failure.kind, response.failure.code, response.failure));
                else finish(undefined, Object.freeze({ summary:Object.freeze(response.summary), timing:Object.freeze({ readyMs, replayMs:response.replayMs, wallMs:performance.now() - start }) }));
              } catch { finish(new ReplayClientError('protocol','invalid_response')); }
            };
            worker.onerror = event => { event.preventDefault(); finish(new ReplayClientError(ready ? 'worker_failure' : 'startup_failure','worker_error')); };
            worker.onmessageerror = () => finish(new ReplayClientError('protocol','message_error'));
            worker.postMessage(`hello:${epoch}`);
          } catch { finish(new ReplayClientError('startup_failure','worker_start_failed')); }
        };
        if (raw.length <= Math.floor(REPLAY_STATE_LIMITS.rawBytes / 3)) startWorker();
        else void checkReplayTransport(raw, () => settled).then(() => { if (!settled) startWorker(); }, error => {
          finish(new ReplayClientError(error instanceof StateJsonInputError && error.code === 'resource_limit' ? 'resource_limit' : 'internal', error instanceof StateJsonInputError ? error.code : 'unexpected_error'));
        });
      });
    },
  });
}
