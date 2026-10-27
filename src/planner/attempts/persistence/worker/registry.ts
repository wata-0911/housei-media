import {ControllerWorkerError as Fault,type Token} from './contracts';
export type Vector=Readonly<{boot:number;sourceEpoch:number;contextRevision:number;draftRevision:number;authorityRevision:number}>;
type Entry={kind:string;mode:'preview-only';sessionIdentity:object;vector:Vector;targetObject:unknown;allowedOperations:readonly string[]};
export function opaqueIdentifier(){return Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,'0')).join('');}
export class Registry {
 private entries=new Map<string,Entry>();private identity={};private cursorCount=0;
 constructor(private vector:Vector){}
 mint<K extends string>(kind:K,targetObject:unknown,allowedOperations:readonly string[]):Token<K>{
  if(this.entries.size>=512||(kind==='cursor'&&this.cursorCount>=4))throw new Fault('resource_limit');
  let token:string;do{token=opaqueIdentifier();}while(this.entries.has(token));
  this.entries.set(token,{kind,mode:'preview-only',sessionIdentity:this.identity,vector:{...this.vector},targetObject,allowedOperations});if(kind==='cursor')this.cursorCount++;
  return token as Token<K>;
 }
 get<T>(token:string,kind:string,op:string):T {
  const e=this.entries.get(token);
  if(!e||e.kind!==kind||e.mode!=='preview-only'||e.sessionIdentity!==this.identity||!e.allowedOperations.includes(op)||JSON.stringify(e.vector)!==JSON.stringify(this.vector))throw new Fault('stale_view');
  return e.targetObject as T;
 }
 reserve(count:number,cursors=0){if(this.entries.size+count>512||this.cursorCount+cursors>4)throw new Fault('resource_limit');}
 revokeKinds(kinds:readonly string[]){for(const [token,e]of this.entries)if(kinds.includes(e.kind)){if(e.kind==='cursor')this.cursorCount--;this.entries.delete(token);}}
 release(token:string){const e=this.entries.get(token);if(!e)throw new Fault('stale_view');if(!['row','cursor'].includes(e.kind))throw new Fault('protocol');if(e.kind==='cursor')this.cursorCount--;this.entries.delete(token);}
 advance(vector:Vector){this.clear();this.vector=vector;}
 clear(){this.entries.clear();this.cursorCount=0;}
}
