import { idTail, referencedUuids } from './identity';
export type IdentityPrefix = '' | 'hosei:attempt:' | 'hosei:attempt-op:' | 'hosei:owned:';
const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** Trusted, session-local allocator contract. No storage/qualification is implied.
 * snapshot BEFORE mint is the fresh-check boundary; this operation's introduced
 * occurrences are then checked against that snapshot in order. Never subtract
 * arbitrary UUIDs from the burn set to make a command fresh. */
export class SessionIdentityAllocator {
  private burned = new Map<string, string>();
  constructor(private readonly onIssued?: (id: string) => void) {}
  restrict(ids: readonly string[]): void {
    for (const id of ids) {
      const tail = idTail(id);
      if (!uuidV4.test(tail)) throw new Error('allocator_reservation_shape');
      if (!this.burned.has(tail)) this.burned.set(tail, id);
    }
  }
  reservations(): string[] { return [...this.burned.keys()]; }
  canonicalReservations(): string[] { return [...this.burned.values()]; }
  snapshot(values: unknown): Set<string> { return new Set([...this.burned.keys(), ...referencedUuids(values)]); }
  mint(occupied: Set<string>, prefix: IdentityPrefix = ''): string {
    if (!['', 'hosei:attempt:', 'hosei:attempt-op:', 'hosei:owned:'].includes(prefix)) throw new Error('allocator_role');
    for (let n = 0; n < 128; n++) {
      const uuid = crypto.randomUUID();
      if (!uuidV4.test(uuid)) throw new Error('allocator_uuid_shape');
      if (occupied.has(uuid) || this.burned.has(uuid)) continue;
      const id = prefix + uuid;
      this.burned.set(uuid, id); occupied.add(uuid);
      this.onIssued?.(id); // synchronous, after burn, before return/next mint
      return id;
    }
    throw new Error('allocator_exhausted');
  }
}
