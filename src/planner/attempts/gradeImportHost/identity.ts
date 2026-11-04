import { SessionIdentityAllocator } from '../persistence/sessionIds';
import { fail, type FrozenRecord } from './contracts';
import { allocation, roleSlots, freeze } from './codec';
/** Owned by one live controller. Bare kernel mint is not a public issuance API. */
export class HostIdentityOwner {
  #core = new SessionIdentityAllocator();
  #tickets = new WeakMap<object, string[]>();
  restrict(record: FrozenRecord) { this.#core.restrict(record.authority.reservedIds.map(s => s.split(':').at(-1)!)); }
  mint(record: FrozenRecord, activate: boolean) {
    this.restrict(record);
    const occupied = this.#core.snapshot(record);
    const ids = roleSlots(activate).map(role => `hosei:g01b-${role}:${this.#core.mint(occupied)}`);
    const ticket = Object.freeze({}); this.#tickets.set(ticket, ids);
    return { ticket, ids, ...allocation(ids, activate) };
  }
  verify(ticket: object, ids: readonly string[]) {
    const owned = this.#tickets.get(ticket);
    if (!owned || owned.length !== ids.length || owned.some((id, i) => id !== ids[i])) fail('id_ticket');
  }
  // Called only after durable T1 + strict read; never revives tickets from disk.
  published(ticket: object, ids: readonly string[]) { this.verify(ticket, ids); return freeze([...ids]); }
}
