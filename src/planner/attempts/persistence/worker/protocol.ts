import {ControllerWorkerError as Fault,type Control,type Operation,type Response} from './contracts';
export const VERSION=1,CONTROL_LIMIT=32768,ERROR_LIMIT=4096,RAW_LIMIT=64*1024*1024;
export const errorCodes=['startup_failure','protocol','busy','cancelled','stale_view','stale_authority','readonly_mode','resource_limit','invalid_input','internal','closed'] as const;
export function dataRecord(x:unknown):Record<string,unknown>{
 try{if(!x||typeof x!=='object'||Array.isArray(x)||![Object.prototype,null].includes(Object.getPrototypeOf(x)))throw new Fault('protocol');
 const ds=Object.getOwnPropertyDescriptors(x),out:Record<string,unknown>={};for(const key of Reflect.ownKeys(ds)){if(typeof key!=='string')throw new Fault('protocol');const d=ds[key];if(!('value'in d)||!d.enumerable)throw new Fault('protocol');Object.defineProperty(out,key,{value:d.value,enumerable:true,configurable:true,writable:true});}return out;
 }catch{throw new Fault('protocol');}
}
export function keys(x:Record<string,unknown>,required:readonly string[],optional:readonly string[]=[]){if(required.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>![...required,...optional].includes(k)))throw new Fault('protocol');}
export const token=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{48}$/.test(x);
export const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
export function parseFrame(raw:unknown,limit=CONTROL_LIMIT):Record<string,unknown>{if(typeof raw!=='string'||raw.length>limit)throw new Fault('protocol');try{return dataRecord(JSON.parse(raw));}catch{throw new Fault('protocol');}}
const extra:Record<Operation,readonly string[]>={startSession:[],openCommitted:[],inspectLegacyRaw:[],inspectBackupRaw:[],prepareMigration:['migration'],prepareSave:['draft','restorePreview'],readPage:['kind','cursor'],release:['token']};
export function validateControl(x:unknown):Control {
 const r=dataRecord(x),op=r.op as Operation;
 if(!Object.hasOwn(extra,op)||r.version!==1||!integer(r.boot)||r.boot===0||!integer(r.requestId)||r.requestId===0)throw new Fault('protocol');
 keys(r,['version','boot','requestId','op',...(op==='startSession'?[]:['session','expectedView'])],extra[op]);
 if(op!=='startSession'&&(!token(r.session)||!token(r.expectedView)))throw new Fault('protocol');
 for(const k of ['migration','draft','restorePreview','cursor','token'])if(Object.hasOwn(r,k)&&!token(r[k]))throw new Fault('protocol');
 if(op==='prepareMigration'&&!r.migration)throw new Fault('protocol');
 if(op==='prepareSave'&&(Number(!!r.draft)+Number(!!r.restorePreview)!==1))throw new Fault('protocol');
 if(op==='readPage'&&(!['attempts','records','removals','official','diagnostics'].includes(r.kind as string)))throw new Fault('protocol');
 if(op==='release'&&!r.token)throw new Fault('protocol');return r as Control;
}
function summary(v:unknown){const r=dataRecord(v);keys(r,['schemaVersion','sourceKind','active','detached','ownedRecords','receipts','reservationCount','officialAchievementCount','applicability','graduationCheckComplete','sourceLinksReverified']);if(![23,24].includes(r.schemaVersion as number)||!['new-plan','local-v22','backup-v1','backup-v2'].includes(r.sourceKind as string)||r.applicability!=='unknown'||r.graduationCheckComplete!==false||r.sourceLinksReverified!==false)throw new Fault('protocol');for(const k of ['active','detached','ownedRecords','receipts','reservationCount','officialAchievementCount'])if(!integer(r[k]))throw new Fault('protocol');}
function preview(v:unknown){const r=dataRecord(v);keys(r,['view','preview','summary','candidateBytes','previousPresent','previousBytes','portableAdoptionRequired','canCommit','action'],['draft']);if(!token(r.view)||!token(r.preview)||r.canCommit!==false||!integer(r.candidateBytes)||!integer(r.previousBytes)||typeof r.previousPresent!=='boolean'||typeof r.portableAdoptionRequired!=='boolean'||!['migration','edit','restore'].includes(r.action as string)||(r.action==='restore'?Object.hasOwn(r,'draft'):!token(r.draft)))throw new Fault('protocol');summary(r.summary);}
export function validateResult(v:unknown,op:Operation):void{
 if(v===null){if(!['openCommitted','release'].includes(op))throw new Fault('protocol');return;}
 const r=dataRecord(v);
 if(op==='startSession'){keys(r,['session','view','mode']);if(!token(r.session)||!token(r.view)||r.mode!=='preview-only')throw new Fault('protocol');}
 else if(op==='openCommitted'){keys(r,['view','handle','draft','summary','evidence']);if(!token(r.view)||!token(r.handle)||!token(r.draft)||r.evidence!=='local-witness')throw new Fault('protocol');summary(r.summary);}
 else if(op==='prepareMigration')preview(v);
 else if(op==='prepareSave'){keys(r,['preview','recoveryHint']);preview(r.preview);const h=dataRecord(r.recoveryHint);keys(h,['kind','version','submissionKey','baseAuthoritySha256','candidateStateSha256','candidateRawSha256']);if(h.kind!=='untrusted-recovery-hint'||h.version!==1||!token(h.submissionKey)||!['baseAuthoritySha256','candidateStateSha256','candidateRawSha256'].every(k=>typeof h[k]==='string'&&/^[a-f0-9]{64}$/.test(h[k] as string)))throw new Fault('protocol');}
 else if(op==='readPage'){keys(r,['view','rows','total'],['cursor']);if(!token(r.view)||!integer(r.total)||!Array.isArray(r.rows)||r.rows.length>50||(r.cursor!==undefined&&!token(r.cursor)))throw new Fault('protocol');for(const row of r.rows){const a=dataRecord(row);keys(a,['row','kind','excerpt','fullLength','quantity']);if(!token(a.row)||typeof a.kind!=='string'||a.kind.length>40||typeof a.excerpt!=='string'||a.excerpt.length>64||!integer(a.fullLength)||!(a.quantity===null||typeof a.quantity==='number'&&Number.isFinite(a.quantity)))throw new Fault('protocol');}}
 else if(['inspectLegacyRaw','inspectBackupRaw'].includes(op)){keys(r,['view','status','diagnosticCount'],['migration','restorePreview','diagnosticsCursor','backupVersion','evidence']);if(!token(r.view)||!['ready','held','rejected'].includes(r.status as string)||!integer(r.diagnosticCount))throw new Fault('protocol');for(const k of ['migration','restorePreview','diagnosticsCursor'])if(r[k]!==undefined&&!token(r[k]))throw new Fault('protocol');if(r.status!=='ready'&&(r.migration||r.restorePreview)||r.migration&&r.restorePreview)throw new Fault('protocol');if(r.backupVersion!==undefined&&![1,2,3].includes(r.backupVersion as number)||r.evidence!==undefined&&!['local-witness','portable-unadopted'].includes(r.evidence as string))throw new Fault('protocol');}
 else throw new Fault('protocol');
}
export function parseResponse(raw:unknown,op:Operation):Response{const r=parseFrame(raw);keys(r,['version','boot','requestId','type'],r.type==='error'?['code']:['value']);if(r.version!==1||!integer(r.boot)||!integer(r.requestId))throw new Fault('protocol');if(r.type==='error'){if((raw as string).length>ERROR_LIMIT||!errorCodes.includes(r.code as typeof errorCodes[number]))throw new Fault('protocol');}else if(r.type==='result'){if(!Object.hasOwn(r,'value'))throw new Fault('protocol');validateResult(r.value,op);}else throw new Fault('protocol');return r as Response;}
