import {parse,decodeHost} from './codec';
import {decodeHostV2} from './codecV2';
import {fail} from './contracts';
export async function decodeNativeRecord(raw:unknown){const p=parse(raw);if(!p||typeof p!=='object'||Array.isArray(p))fail('shape');const v=(p as {hostVersion?:unknown}).hostVersion;if(v===1)return decodeHost(raw);if(v===2)return decodeHostV2(raw);fail('unsupported_policy');}
