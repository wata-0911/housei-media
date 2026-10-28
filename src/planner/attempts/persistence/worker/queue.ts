import {ControllerWorkerError as Fault} from './contracts';
/** Ingress reserves its place synchronously, before controller awaits. */
export class SessionQueue {
 private tail:Promise<unknown>=Promise.resolve();
 private ledger=new Map<number,{key:readonly string[];result:Promise<unknown>}>();
 private cancelled=new Set<number>();private high=0;private pending=0;private inputBytes=0;private ledgerBytes=0;private rawPending=false;private closed=false;
 has(id:number){return this.ledger.has(id);}
 check(id:number){if(this.closed)throw new Fault('closed');if(this.cancelled.has(id))throw new Fault('cancelled');}
 run<T>(id:number,key:readonly string[],raw:boolean,execute:()=>Promise<T>,bytes=0):Promise<T>{
  if(this.closed)return Promise.reject(new Fault('closed'));
  const previous=this.ledger.get(id);
  if(previous){if(previous.key.length!==key.length||previous.key.some((part,i)=>part!==key[i]))return Promise.reject(new Fault('protocol'));return previous.result as Promise<T>;}
  if(!Number.isSafeInteger(id)||id<=this.high)return Promise.reject(new Fault('protocol'));
  if(this.ledgerBytes+key[0].length>4*1024*1024)return Promise.reject(new Fault('resource_limit'));
  if(this.ledger.size>=1024)return Promise.reject(new Fault('resource_limit'));
  if(this.inputBytes+bytes>1024*1024)return Promise.reject(new Fault('busy'));
  if(this.pending>=8||(raw&&this.rawPending))return Promise.reject(new Fault('busy'));
  this.high=id;this.ledgerBytes+=key[0].length;this.pending++;this.inputBytes+=bytes;if(raw)this.rawPending=true;
  const operation=this.tail.then(()=>{this.check(id);return execute();});
  // Release admission before exposing settlement to awaiting callers.
  const result=operation.finally(()=>{this.pending--;this.inputBytes-=bytes;if(raw)this.rawPending=false;});
  this.ledger.set(id,{key,result});
  this.tail=result.catch(()=>{});
  return result;
 }
 cancel(id:number){if(this.ledger.has(id))this.cancelled.add(id);}
 close(){this.closed=true;this.cancelled.clear();this.ledger.clear();}
}
