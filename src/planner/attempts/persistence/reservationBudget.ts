// Restrictions are never truncated, sorted or renamed to meet a budget.
export const RESERVATION_IDS = 1_000_000;
export const RESERVATION_BYTES = 32 * 1024 * 1024;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const reservation = new RegExp(`^(?:hosei:(?:attempt|attempt-op|owned):)?${uuid}$`);
/** Finite budget for a dense UUID list. Complete replay and required IDs remain
 * mandatory. Every formerly writable 32MiB authority fits this list byte cap. */
export class ReservationBudget {
  private readonly tails = new Set<string>();
  private bytes = 2;
  constructor(private readonly kind: string) {}
  add(id: string): void {
    if (typeof id !== 'string' || !reservation.test(id)) throw new Error('reservation_uuid_collision_or_shape');
    const tail = id.slice(-36);
    if (this.tails.has(tail)) throw new Error('reservation_uuid_collision_or_shape');
    this.bytes += id.length + 2 + (this.tails.size ? 1 : 0);
    if (this.tails.size >= RESERVATION_IDS || this.bytes > RESERVATION_BYTES)
      throw new Error(`${this.kind}_reservation_limit`);
    this.tails.add(tail);
  }
}
export function requireReservationBudget(ids: readonly string[], kind: string): void {
  const budget = new ReservationBudget(kind);
  for (const id of ids) budget.add(id);
}
/** Same string membership and required-order result as filter/includes, with
 * O(current + required) work. Does not authenticate or reorder either list. */
export function missingHistory(required: readonly string[], current: readonly string[]): string[] {
  const present = new Set(current);
  return required.filter(id => !present.has(id));
}
