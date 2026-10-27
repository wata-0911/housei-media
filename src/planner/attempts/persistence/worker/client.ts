import {ControllerWorkerError as Fault,type Guard,type Started,type StateView,type InspectionDTO,type PreviewDTO,type PreparedSave,type PageDTO,type PageKind,type MigrationToken,type DraftToken,type PreviewToken,type CursorToken,type Operation,type Result} from './contracts';
import {dataRecord,keys,parseFrame,parseResponse,validateControl,CONTROL_LIMIT,RAW_LIMIT} from './protocol';
export type WorkerPort={postMessage(data:string):void;terminate():void;onmessage:((event:MessageEvent<unknown>)=>void)|null;onerror:((event:ErrorEvent)=>void)|null;onmessageerror:((event:MessageEvent<unknown>)=>void)|null};
type Options={signal?:AbortSignal};
let nextBoot=0;
/** One facade owns one Worker and one session. A new source/context needs a new
 * facade. Cancel is hard cancellation and invalidates the entire session. */
export function createControllerWorkerClient(factory:()=>WorkerPort=()=>new Worker(new URL('./preview.worker.ts',import.meta.url),{type:'module'}),timeouts={startup:30_000,job:300_000}) {
 const boot=++nextBoot;if(!Number.isSafeInteger(boot))throw new Fault('resource_limit');
 let worker:WorkerPort|undefined,closed=false,ready=false,sequence=0,generation=1,started=false;
 type Pending={op:Operation;generation:number;resolve:(x:Result)=>void;reject:(e:unknown)=>void;timer:ReturnType<typeof setTimeout>;cleanup:()=>void};
 const pending=new Map<number,Pending>();let readyResolve:()=>void,readyReject:(e:unknown)=>void;
 const readiness=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});void readiness.catch(()=>{});
 const startup=setTimeout(()=>shutdown(new Fault('startup_failure')),timeouts.startup);
 function shutdown(error:Fault){if(closed)return;closed=true;generation++;clearTimeout(startup);if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();worker=undefined;}for(const p of pending.values()){clearTimeout(p.timer);p.cleanup();p.reject(error);}pending.clear();readyReject(error);}
 try{
  worker=factory();worker.onerror=()=>shutdown(new Fault(ready?'internal':'startup_failure'));worker.onmessageerror=()=>shutdown(new Fault('protocol'));
  worker.onmessage=event=>{
   if(closed)return; // Do not even read late event.data/getters after close.
   try{
    if(!ready){const r=parseFrame(event.data);keys(r,['version','boot','type','mode']);if(r.version!==1||r.boot!==boot||r.type!=='ready'||r.mode!=='preview-only')throw new Fault('protocol');ready=true;clearTimeout(startup);readyResolve();return;}
    const header=parseFrame(event.data),id=header.requestId;
    if(typeof id!=='number'||!pending.has(id))throw new Fault('protocol');
    const p=pending.get(id)!;const r=parseResponse(event.data,p.op);if(r.boot!==boot||r.requestId!==id||p.generation!==generation)throw new Fault('protocol');
    pending.delete(id);clearTimeout(p.timer);p.cleanup();if(r.type==='error')p.reject(new Fault(r.code));else p.resolve(r.value);
   }catch{shutdown(new Fault('protocol'));}
  };
  worker.postMessage(JSON.stringify({version:1,boot,type:'hello'}));
 }catch{shutdown(new Fault('startup_failure'));}
 async function transport(raw:string){if(raw.length<=Math.floor(RAW_LIMIT/3))return;let bytes=0;for(let i=0;i<raw.length;){if(closed)throw new Fault('closed');const end=Math.min(raw.length,i+65536);for(;i<end;i++){const u=raw.charCodeAt(i);if(u<=127)bytes++;else if(u<=2047)bytes+=2;else if(u>=0xd800&&u<=0xdbff&&raw.charCodeAt(i+1)>=0xdc00&&raw.charCodeAt(i+1)<=0xdfff){bytes+=4;i++;}else bytes+=3;}if(bytes>RAW_LIMIT)throw new Fault('resource_limit');if(i<raw.length)await new Promise<void>(resolve=>setTimeout(resolve,0));}}
 let uploading=false;
 async function call<T extends Result>(op:Operation,input:unknown={},options:Options={}):Promise<T>{
  if(closed)throw new Fault('closed');const r=dataRecord(input),hasRaw=op==='inspectLegacyRaw'||op==='inspectBackupRaw';
  const fields:Record<Operation,string[]>={startSession:[],openCommitted:[],inspectLegacyRaw:['raw'],inspectBackupRaw:['raw'],prepareMigration:['migration'],prepareSave:['draft','restorePreview'],readPage:['kind','cursor'],release:['token']};
  keys(r,op==='startSession'?[]:['session','expectedView'],fields[op]);
  let raw:string|undefined;if(hasRaw){if(typeof r.raw!=='string')throw new Fault('invalid_input');raw=r.raw;if(raw.length>RAW_LIMIT)throw new Fault('resource_limit');delete r.raw;}
  const requestId=++sequence,c=validateControl({...r,version:1,boot,requestId,op});const header=JSON.stringify(c);if(header.length>CONTROL_LIMIT)throw new Fault('resource_limit');
  if(pending.size>=8||hasRaw&&uploading)throw new Fault('busy');if(hasRaw)uploading=true;
  try{if(raw!==undefined)await transport(raw);await readiness;if(closed)throw new Fault('closed');if(options.signal?.aborted){shutdown(new Fault('cancelled'));throw new Fault('cancelled');}
   return await new Promise<T>((resolve,reject)=>{
    const abort=()=>shutdown(new Fault('cancelled'));const cleanup=()=>options.signal?.removeEventListener('abort',abort);
    const timer=setTimeout(()=>shutdown(new Fault('cancelled')),timeouts.job);
    pending.set(requestId,{op,generation,resolve:x=>resolve(x as T),reject,timer,cleanup});options.signal?.addEventListener('abort',abort,{once:true});
    try{worker!.postMessage(header);if(raw!==undefined)worker!.postMessage(raw);}catch{shutdown(new Fault('internal'));}
   });
  }finally{if(hasRaw)uploading=false;}
 }
 return {
  startSession(o?:Options):Promise<Started>{if(started)return Promise.reject(new Fault('protocol'));started=true;return call('startSession',{},o);},
  openCommitted:(g:Guard,o?:Options)=>call<StateView|null>('openCommitted',g,o),
  inspectLegacyRaw:(g:Guard&{raw:string},o?:Options)=>call<InspectionDTO>('inspectLegacyRaw',g,o),
  inspectBackupRaw:(g:Guard&{raw:string},o?:Options)=>call<InspectionDTO>('inspectBackupRaw',g,o),
  prepareMigration:(g:Guard&{migration:MigrationToken},o?:Options)=>call<PreviewDTO>('prepareMigration',g,o),
  prepareSave:(g:Guard&({draft:DraftToken;restorePreview?:never}|{restorePreview:PreviewToken;draft?:never}),o?:Options)=>call<PreparedSave>('prepareSave',g,o),
  readPage:(g:Guard&{kind:PageKind;cursor?:CursorToken},o?:Options)=>call<PageDTO>('readPage',g,o),
  release:(g:Guard&{token:string},o?:Options)=>call<null>('release',g,o),
  cancel(){shutdown(new Fault('cancelled'));},close(){shutdown(new Fault('closed'));},
 };
}
