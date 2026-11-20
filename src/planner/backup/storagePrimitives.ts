export const STORAGE_KEY = 'hosei-planner:v1';
export const BACKUP_KEY = `${STORAGE_KEY}:recovery`;

/** All current browser writes join the same origin-wide Web Lock. The synchronous
 * primitives above remain usable by migrations/tests; browser callers use these
 * coordinated entry points. Old deployed tabs do not participate: close them
 * before restore. No compare-twice or localStorage lease is claimed atomic. */
export type PlannerWriteLocks = Pick<LockManager, 'request'>;
export const PLANNER_WRITE_LOCK = `${STORAGE_KEY}:write`;
export async function withPlannerWriteLock<T>(action: () => T, locks: PlannerWriteLocks | undefined, required = false): Promise<T> {
  if (!locks) {
    if (required) throw new Error('このブラウザでは安全な復元に必要なWeb Locksを利用できません。対応ブラウザで復元してください。');
    // Preserve existing ordinary-save support on older browsers. Restore refuses.
    return action();
  }
  return locks.request(PLANNER_WRITE_LOCK, { mode: 'exclusive' }, action);
}

