import { performance } from 'node:perf_hooks';
import { attemptFixture, operationId } from './fixtures/attempt-fixture.mjs';
import * as after from '../src/planner/attempts/workbench/operations.ts';
import * as before from '../../attempt-graph-revision-before/src/planner/attempts/workbench/operations.ts';
import * as dev from '../../attempt-graph-toctou-baseline/src/planner/attempts/workbench/operations.ts';
const f=attemptFixture();
for(const n of [10,100,500]) {
 const graph={attempts:Array.from({length:n},(_,i)=>f.makeAttempt(2000+i)),ownedRecords:[],removals:[]};
 const command={kind:'edit',attemptId:graph.attempts[0].id,operationId:operationId(99999),changes:{originalTitle:'edited'}};
 const versions={before,after,dev},workspaces={},times={before:[],after:[],dev:[]},createMs={};
 for(const [label,api] of Object.entries(versions)){const t=performance.now();workspaces[label]=api.createWorkspace(graph,f.context);createMs[label]=performance.now()-t;api.applyCommand(workspaces[label],command,f.context);}
 for(let i=0;i<3;i++)for(const label of i%2?['dev','after','before']:['before','after','dev']){const t=performance.now();versions[label].applyCommand(workspaces[label],command,f.context);times[label].push(performance.now()-t);}
 const calls={};for(const [label,api] of Object.entries(versions)){const native=globalThis.structuredClone;calls[label]=0;try{globalThis.structuredClone=(...args)=>{calls[label]++;return native(...args)};api.applyCommand(workspaces[label],command,f.context);}finally{globalThis.structuredClone=native;}}
 console.log(JSON.stringify({n,createMs,times,medianMs:Object.fromEntries(Object.entries(times).map(([k,v])=>[k,[...v].sort((a,b)=>a-b)[1]])),instrumentedCloneCalls:calls}));
}
