import { performance } from 'node:perf_hooks';
import { attemptFixture, operationId } from './fixtures/attempt-fixture.mjs';
import { createWorkspace, applyCommand } from '../src/planner/attempts/workbench/operations.ts';
import { validateAttemptGraph } from '../src/planner/attempts/validation.ts';
const f=attemptFixture();
for(const n of [10,100,500]) {
 const graph={attempts:Array.from({length:n},(_,i)=>f.makeAttempt(2000+i)),ownedRecords:[],removals:[]};
 const start=performance.now(),w=createWorkspace(graph,f.context),createMs=performance.now()-start;
 const command={kind:'edit',attemptId:graph.attempts[0].id,operationId:operationId(99999),changes:{originalTitle:'edited'}};
 const times=[];for(let i=0;i<3;i++){const t=performance.now();applyCommand(w,command,f.context);times.push(performance.now()-t);}
 const native=globalThis.structuredClone;let calls=0;
 try {globalThis.structuredClone=(...args)=>{calls++;return native(...args)};applyCommand(w,command,f.context);}finally{globalThis.structuredClone=native;}
 console.log(JSON.stringify({n,createMs,times,medianMs:[...times].sort((a,b)=>a-b)[1],instrumentedCloneCalls:calls}));
}
const bad={attempts:[f.makeAttempt(2000),f.makeAttempt(2001)],ownedRecords:[],removals:[]};
bad.attempts[0].plan.contribution.value=undefined;bad.attempts[1].plan.contribution.value=NaN;
console.log(JSON.stringify({diagnostics:validateAttemptGraph(bad,f.context)}));
