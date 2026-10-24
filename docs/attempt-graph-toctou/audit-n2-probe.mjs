import assert from 'node:assert/strict';
const tree=process.argv[2]??'head';
const {master,decode}=await import(`./${tree}/tests/fixtures/migration-fixture.mjs`);
const {initialState,programs,retained,newAttempt}=await import(`./${tree}/tests/fixtures/yi07-graduation.mjs`);
const {adaptAttemptGraduation:adapt}=await import(`./${tree}/src/planner/attempts/graduation/adapter.ts`);
const {validateAttemptGraph:validate}=await import(`./${tree}/src/planner/attempts/validation.ts`);
const {source}=await decode(initialState()),scope=programs[0].scopeId;
for(const mode of ['getter','id','quantity']){
 const a=newAttempt(master),input={graph:{attempts:[a],ownedRecords:[],removals:[]},retained:retained(source.state)};let reads=0,traps=0;
 const key=mode==='quantity'?'actualYear':'originalTitle',original=a[key];
 input.graph.ownedRecords=new Proxy([],{ownKeys(target){traps++;Object.defineProperty(a,key,{enumerable:true,configurable:true,get(){reads++;if(mode==='getter'||reads===2){if(mode==='id')a.id='invalid-graph-id';if(mode==='quantity')a.plan.contribution.value=-100;Object.defineProperty(a,key,{value:original,writable:true,enumerable:true,configurable:true});}return original;}});input.graph.ownedRecords=target;return Reflect.ownKeys(target);}});
 const r=adapt(input,source,scope),fresh=validate(input.graph,source.context);
 console.log(JSON.stringify({tree,mode,status:r.status,getterCalls:reads,proxyOwnKeysCalls:traps,id:r.attempts?.[0]?.record.id,quantity:r.attempts?.[0]?.quantities.learnerContribution,diagnostics:r.diagnostics,freshValidation:fresh}));
}
