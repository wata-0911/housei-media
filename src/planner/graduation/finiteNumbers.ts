/** Quantity arithmetic: validate inputs AND each sum (finite operands can overflow). */
export function finiteNonnegativeSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) return null;
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}
/** Final output invariant. Null remains unknown, never coerced to zero. */
export function assertFiniteNumbers(result: unknown): void {
  const pending: unknown[] = [result];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non_finite_graduation_result');
    if (value && typeof value === 'object') pending.push(...Object.values(value));
  }
}
