import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectAttemptBackupInput } from '../src/planner/attempts/production/migrationInput.ts';
const uuid=n=>n.toString(16).padStart(8,'0')+'-aaab-4aaa-8aab-000000000000';
for(const count of [100001,100002])test(`R5 reservation-only budget accepts ${count}`,()=>{
 const raw=JSON.stringify({format:'hosei-attempt-backup',backupVersion:3,reservedIds:Array.from({length:count},(_,i)=>uuid(i+1))});
 assert.doesNotThrow(()=>inspectAttemptBackupInput(raw));
});
import { inspectMigrationInput } from '../src/planner/attempts/production/migrationInput.ts';
import { inspectAuthorityInput } from '../src/planner/attempts/persistence/jsonLexemes.ts';
import { ReservationBudget, RESERVATION_BYTES, RESERVATION_IDS, missingHistory } from '../src/planner/attempts/persistence/reservationBudget.ts';
import { createPlannerAttemptSession } from '../src/planner/attempts/production/session.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { backupDigest } from '../src/planner/digest.ts';
const ids=Array.from({length:100002},(_,i)=>uuid(i+1));
const file=(reservedIds,extra={})=>JSON.stringify({format:'hosei-attempt-backup',backupVersion:3,reservedIds,...extra});
for(const backupVersion of [2,3])for(const count of [99998,99999,100000,100001,100002])test(`R5 lexical v${backupVersion} ${count} keeps order`,()=>{const list=ids.slice(0,count);assert.deepEqual(inspectAttemptBackupInput(file(list,{backupVersion})).reservedIds,list);});
for(const extra of [{format:'foreign'},{backupVersion:1},{backupVersion:4},{format:null}])test('R5 reservation exception requires envelope '+JSON.stringify(extra),()=>{assert.throws(()=>inspectAttemptBackupInput(file(ids.slice(0,100001),extra)),/reservation_envelope/);});
test('R5 root reservations may precede header but never relax nested/unknown containers',()=>{
 inspectAttemptBackupInput(JSON.stringify({reservedIds:ids,backupVersion:3,format:'hosei-attempt-backup'}));
 for(const v of [{nested:{reservedIds:ids}},{other:ids}])assert.throws(()=>inspectAttemptBackupInput(file([] ,v)),/resource_limit/);
 assert.throws(()=>inspectMigrationInput(file(ids)),/resource_limit/);assert.throws(()=>inspectAuthorityInput(file(ids)),/resource_limit/);
 const huge=Object.fromEntries(Array.from({length:100001},(_,i)=>['k'+i,0]));assert.throws(()=>inspectAttemptBackupInput(file([],{unknown:huge})),/resource_limit/);
});
for(const list of [[uuid(1),uuid(1)],[uuid(1),'hosei:attempt:'+uuid(1)],['bad'],[null],[4],[{}],[[]]])test('R5 invalid reservation tokens '+JSON.stringify(list),()=>{assert.throws(()=>inspectAttemptBackupInput(file(list)),/reservation/);});
test('R5 malformed array and missing/nonarray reservation list refuse',()=>{const malformed='{"reservedIds":[,],"format":"hosei-attempt-backup","backupVersion":3}';assert.throws(()=>JSON.parse(malformed),SyntaxError);assert.throws(()=>inspectAttemptBackupInput(malformed),/attempt_backup_reservation_shape/);assert.throws(()=>inspectAttemptBackupInput(file(null)),/reservation_shape/);});
test('R5 exception retains total value budget',()=>{const padding=Array.from({length:9},()=>Array(100000).fill(0));assert.throws(()=>inspectAttemptBackupInput(file(ids.slice(0,100001),{padding})),/resource_limit/);});
test('R5 finite UUID-list byte budget exactly32MiB and next ID',()=>{
 assert.equal(RESERVATION_IDS,1000000);const n=860369,b=new ReservationBudget('probe');
 for(let i=1;i<=n;i++)b.add((i===1?'hosei:owned:':i<=3?'hosei:attempt:':'')+uuid(i));
 assert.equal(1+n*39+12+14+14,RESERVATION_BYTES);assert.throws(()=>b.add(uuid(n+1)),/reservation_limit/);
 console.log(JSON.stringify({kind:'reservation-byte-budget',ids:n,bytes:RESERVATION_BYTES,next:'rejected'}));
});
for(const n of [1000,2000,4000])test(`R5 exact membership is linear ${n}`,()=>{
 const current=ids.slice(0,n),required=[...current,'missing'],has=Set.prototype.has;let calls=0;
 Set.prototype.has=function(...a){calls++;return has.apply(this,a);};let result;try{result=missingHistory(required,current);}finally{Set.prototype.has=has;}
 assert.deepEqual(result,['missing']);assert.equal(calls,n+1);
 let comparisons=0;for(const target of current){for(const id of current){comparisons++;if(id===target)break;}}
 assert.equal(comparisons,n*(n+1)/2);console.log(JSON.stringify({kind:'membership-operations',n,oldPositions:comparisons,setHas:calls}));
 assert.deepEqual(missingHistory(['a','b','a'],['b']),['a','a']);assert.deepEqual(missingHistory([uuid(1)],['hosei:attempt:'+uuid(1)]),[uuid(1)]);
});
const locks={request:async(_n,_o,fn)=>fn()};
function host(){let value=emptyAuthority(),puts=0;const store={read:async()=>structuredClone(value),commit:async(e,n,g)=>{assert.deepEqual(e,value);g?.();value=structuredClone(n);puts++;}};return{api:createPlannerAttemptSession(store,locks),get:()=>structuredClone(value),puts:()=>puts};}
let normal;
const backup=()=>normal??=(async()=>{const x=host();await x.api.load();await x.api.save(await x.api.prepareSave(),true);return x.api.createBackup();})();
for(const flaw of ['required-id-missing','state-replay'])test(`R5 output preflight refuses forged ${flaw} before emitting success`,async()=>{
 const x=host();await x.api.load();await x.api.save(await x.api.prepareSave(),true);const before=x.get(),body=JSON.parse(await backup());delete body.sha256;
 if(flaw==='required-id-missing')body.reservedIds.shift();else body.state.graph.attempts.push({});
 const forged=JSON.stringify({...body,sha256:await backupDigest(body)}),stringify=JSON.stringify;let hits=0;
 JSON.stringify=function(v,...args){if(v&&v.format==='hosei-attempt-backup'&&'sha256'in v){hits++;return forged;}return stringify.call(this,v,...args);};
 try{await assert.rejects(x.api.createBackup());}finally{JSON.stringify=stringify;}
 assert.ok(hits);assert.deepEqual(x.get(),before);assert.equal(x.puts(),1);assert.equal(x.api.admission().canEdit,false);await x.api.load();assert.ok(await x.api.createBackup());
});
test('R5 candidate refuses an unrestorable backup before actual commit',async()=>{
 const x=host();await x.api.load();const p=await x.api.prepareSave(),body=JSON.parse(await backup());delete body.sha256;body.reservedIds.shift();const forged=JSON.stringify({...body,sha256:await backupDigest(body)}),stringify=JSON.stringify;
 JSON.stringify=function(v,...args){return v&&v.format==='hosei-attempt-backup'&&'sha256'in v?forged:stringify.call(this,v,...args);};
 try{await assert.rejects(x.api.save(p,true),/authority_unreadable_before_put/);}finally{JSON.stringify=stringify;}
 assert.equal(x.puts(),0);assert.deepEqual(x.get(),emptyAuthority());assert.equal(x.api.admission().canEdit,false);await x.api.load();await x.api.save(await x.api.prepareSave(),true);
});
