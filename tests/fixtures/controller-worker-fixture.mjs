import {replayFixture} from './replay-state-fixture.mjs';
import {replayState,encodeState} from '../../src/planner/attempts/persistence/codec.ts';
import {encodeNewPlan} from '../../src/planner/attempts/persistence/newPlan.ts';
import {applyCommand,newOperationId,newRecordId} from '../../src/planner/attempts/workbench/operations.ts';
export async function controllerFixture(version=24){
 const f=await replayFixture(version,'normal',0),r=await replayState(f.state),source=r.source;let w=r.workspace;
 const submit=c=>{w=applyCommand(w,c,source.context);};
 const attempt=w.graph.attempts[0],todo={id:newRecordId(),kind:'todo',owner:null,payload:{id:crypto.randomUUID(),text:'private original TODO',done:false}};
 submit({kind:'add_record',operationId:newOperationId(),record:todo});
 submit({kind:'assign_todo',operationId:newOperationId(),recordId:todo.id,expectedOwner:null,owner:{kind:'attempt',attemptId:attempt.id}});
 submit({kind:'edit_payload',operationId:newOperationId(),recordId:todo.id,payload:{...todo.payload,text:'edited TODO',done:true}});
 const remove={kind:'remove',operationId:newOperationId(),attemptId:attempt.id};submit(remove);
 submit({kind:'undo',operationId:newOperationId(),attemptId:attempt.id,removalOperationId:remove.operationId});
 submit({kind:'delete_todo',operationId:newOperationId(),recordId:todo.id});
 while(w.receipts.length<100)submit({kind:'edit',operationId:newOperationId(),attemptId:attempt.id,changes:{originalTitle:'synthetic mixed history '+w.receipts.length}});
 const state=version===24?await encodeNewPlan(source,w):await encodeState(source,r.state.assignments,r.base,w,r.environment.target,r.state.corrections);
 return {state,workspace:w,raw:JSON.stringify(state),deletedTodo:todo,removeOperation:remove.operationId};
}
// Existing synchronous API creates this fixture; no date-correction RPC is added.
export async function correctedControllerFixture(){
 const {mixed,media,env}=await import('./migration-fixture.mjs');const {createAttemptPersistence}=await import('../../src/planner/attempts/persistence/controller.ts');const {emptyAuthority}=await import('../../src/planner/attempts/persistence/contracts.ts');
 const state=mixed();state.mediaSchoolingProgress[media.id].assessments[0].scheduledDate='2027-02-30';const raw=JSON.stringify(state,null,2),api=createAttemptPersistence({read:async()=>emptyAuthority(),commit:async()=>{throw Error('fixture writes forbidden');}},undefined,env);
 const m=await api.inspectLegacy(raw),proposal=await api.proposeDate(m,media.id,'assessment/raw~id','2028-02-29'),corrected=await api.confirmDate(m,proposal,true),p=await api.prepareMigration(corrected);return {state:p.handle.state,workspace:p.handle.workspace,raw:JSON.stringify(p.handle.state),originalSourceRaw:raw,originalAssignments:m.table};
}
