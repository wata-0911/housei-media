import { SessionIdentityAllocator } from '../persistence/sessionIds';
import { fail } from './contracts';
import { roles, allocationFor } from './codecV2';
import type { FrozenRecord } from './contractsV2';
import type { Candidate } from '../gradeImport/preview';
import type { DeepReadonly } from '../gradeImport/sourceArchive';
export class V2IdentityOwner {
 #core=new SessionIdentityAllocator();#tickets=new WeakMap<object,string[]>();
 restrict(r:{readonly authority:{readonly reservedIds:readonly string[]}}){this.#core.restrict(r.authority.reservedIds.map(x=>x.split(':').at(-1)!));}
 mint(r:FrozenRecord,active:boolean,candidate:DeepReadonly<Candidate>|null){this.restrict(r);const occupied=this.#core.snapshot(r),ids=roles(active,!!candidate).map(role=>`hosei:g01b-${role}:${this.#core.mint(occupied)}`),ticket=Object.freeze({});this.#tickets.set(ticket,ids);return {ticket,ids,...allocationFor(ids,active,candidate,r)};}
 verify(ticket:object,ids:readonly string[]){const value=this.#tickets.get(ticket);if(!value||value.length!==ids.length||value.some((x,i)=>x!==ids[i]))fail('id_ticket');}
 published(ticket:object,ids:readonly string[]){this.verify(ticket,ids);return Object.freeze([...ids]);}
}
