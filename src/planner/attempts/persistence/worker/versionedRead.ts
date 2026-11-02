import {freeze} from '../../migration/contracts';
import {sameAuthoritySnapshot} from '../authoritySnapshot';
import {decodeAuthorityJson} from '../contractDecoders';
import {exactKeys,type AuthorityRecord} from '../contracts';
import {replayState,replayStateRule2} from '../codec';
import {checkBudget,preflight,INPUT_PROFILES} from './workerInput';
import type {ContentDTO} from './contracts';
import type {ReservationCoverage} from '../versionedContracts';

/** Untrusted native records: descriptors and all values BEFORE cloning/JSON.
 * The audited comparator walks even identical references, without getters. */
export async function readAuthoritySnapshot(original:unknown):Promise<AuthorityRecord> {
 if(!sameAuthoritySnapshot(original,original))throw new Error('authority_record_invalid');
 const versioned=original!==null&&typeof original==='object'&&['format','authorityVersion','reservationCoverage'].some(k=>Object.hasOwn(original,k));
 exactKeys(original,['raw','revision','committed','issuedIds',...(versioned?['format','authorityVersion','reservationCoverage']:[])],'authority');
 if(versioned)exactKeys(original.reservationCoverage,['policyVersion','kind','baselineStateSha256'],'reservation_coverage');
 for(const key of ['issuedIds','committed']){if(!Array.isArray(original[key]))throw new Error('authority_record_invalid');checkBudget(INPUT_PROFILES.state,'reservedIds',original[key].length);}
 if(original.raw!==null)preflight(original.raw,'state');
 const snapshot=structuredClone(original),checked=await decodeAuthorityJson(JSON.stringify(snapshot));
 if(!sameAuthoritySnapshot(snapshot,checked.value))throw new Error('authority_record_invalid');
 return freeze(snapshot) as AuthorityRecord;
}
export const isVersioned=(r:AuthorityRecord)=>Object.hasOwn(r,'authorityVersion');
/** Caller has first passed the common strict versioned decoder. No alternative
 * H2/R2 model, qualification, controller registration, or writer lives here. */
export const replayReadonlyState=(state:{rule:{version:number}})=>state.rule.version===2?replayStateRule2(state):replayState(state);
export type ReadHandle=Awaited<ReturnType<typeof replayReadonlyState>>;
export function content(state:{rule:{version:number}},origin:ContentDTO['origin'],coverage?:ReservationCoverage,migration:ContentDTO['migration']='none'):ContentDTO {
 return {ruleVersion:state.rule.version as 1|2,origin,coverage:coverage?.kind??(state.rule.version===1?'explicit-migration-required':'coverage-unestablished'),baselineStateSha256:coverage?.baselineStateSha256??null,migration,editPreviewAllowed:false,saveAuthority:'not-issued',canCommit:false};
}
