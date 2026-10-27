import {readIndexedDbAuthority} from '../indexedDbRead';
import {loadWorkerEnvironment} from './environment';
import {createPreviewSession} from './session';
import {ControllerWorkerError,type Control,type ErrorCode,type Result} from './contracts';
import {WorkerInputError} from './workerInput';
import {parseFrame,keys,integer,validateControl,validateResult,CONTROL_LIMIT,RAW_LIMIT} from './protocol';

type Scope={postMessage(data:string):void;close():void;onmessage:((event:MessageEvent<unknown>)=>void)|null};
const scope=globalThis as unknown as Scope;
let boot=0,closed=false,upload:Control|undefined,session:ReturnType<typeof createPreviewSession>|undefined;
const send=(data:unknown)=>{if(!closed)scope.postMessage(JSON.stringify(data));};
function stop(){closed=true;upload=undefined;session?.close();session=undefined;scope.onmessage=null;scope.close();}
function failure(id:number,code:ErrorCode){send({version:1,boot,requestId:id,type:'error',code});}
function errorCode(error:unknown):ErrorCode{if(error instanceof ControllerWorkerError)return error.code;if(error instanceof WorkerInputError)return error.code==='resource_limit'?'resource_limit':'invalid_input';return 'internal';}
async function dispatch(c:Control,raw?:string){
 try{const task=session!.request(c,raw);raw=undefined;const value:Result=await task;if(closed)return;validateResult(value,c.op);const response=JSON.stringify({version:1,boot,requestId:c.requestId,type:'result',value});if(response.length>CONTROL_LIMIT)throw new ControllerWorkerError('resource_limit');scope.postMessage(response);}
 catch(e){if(!closed)failure(c.requestId,errorCode(e));}
}
scope.onmessage=(event)=>{
 if(closed)return;
 try{
  const raw=event.data;
  if(typeof raw!=='string')throw new ControllerWorkerError('protocol');
  if(upload){const c=upload;upload=undefined;if(raw.length>RAW_LIMIT)throw new ControllerWorkerError('resource_limit');void dispatch(c,raw);return;}
  const r=parseFrame(raw);
  if(!boot){keys(r,['version','boot','type']);if(r.version!==1||r.type!=='hello'||!integer(r.boot)||r.boot===0)throw new ControllerWorkerError('protocol');boot=r.boot;session=createPreviewSession(()=>readIndexedDbAuthority(indexedDB),loadWorkerEnvironment,boot);send({version:1,boot,type:'ready',mode:'preview-only'});return;}
  if(r.type==='cancel'){keys(r,['version','boot','type','requestId']);if(r.version!==1||r.boot!==boot||!integer(r.requestId)||r.requestId===0)throw new ControllerWorkerError('protocol');session!.cancel(r.requestId);return;}
  if(r.type==='close'){keys(r,['version','boot','type']);if(r.version!==1||r.boot!==boot)throw new ControllerWorkerError('protocol');stop();return;}
  const c=validateControl(r);if(c.boot!==boot)throw new ControllerWorkerError('protocol');
  if(c.op==='inspectLegacyRaw'||c.op==='inspectBackupRaw')upload=c;else void dispatch(c);
 }catch(e){failure(0,errorCode(e));stop();}
};
