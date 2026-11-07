import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorityJsonTree } from '../src/planner/attempts/persistence/authorityData.ts';
import { requireAttemptAuthority } from '../src/planner/attempts/persistence/authorityFormat.ts';
import { inspectAuthorityInput, inspectJsonLexemes, AUTHORITY_RAW_BYTES } from '../src/planner/attempts/persistence/jsonLexemes.ts';
import { inspectMigrationInput, inspectAttemptBackupInput } from '../src/planner/attempts/production/migrationInput.ts';
import { createPlannerAttemptSession } from '../src/planner/attempts/production/session.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { initialState, originalRow, env } from './fixtures/migration-fixture.mjs';
import { createHash } from 'node:crypto';
const envelope=raw=>({raw,revision:1,committed:['a'.repeat(64)],issuedIds:[]});
for(const token of ['4.0000000000000001','4.00000000000000000000009'])test(`R4 stored raw ${token} rejected before whole JSON.parse`,()=>{
 const raw='{"format":"hosei-attempt-state","schemaVersion":24,"quantity":'+token+'}';let parses=0,error;const parse=JSON.parse;JSON.parse=function(s,...args){if(s===raw)parses++;return parse.call(this,s,...args);};try{requireAttemptAuthority(envelope(raw));}catch(e){error=e;}finally{JSON.parse=parse;}
 console.log(JSON.stringify({token,wholeParses:parses,error:String(error)}));assert.ok(error);assert.match(String(error),/precision/);assert.equal(parses,0);
});
for(const Type of [Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array,DataView,ArrayBuffer,Map,Set,Date])test(`R4 early prototype rejects root/nested ${Type.name}`,()=>{
 const make=()=>Type===DataView?new DataView(new ArrayBuffer(8)):new Type(1);
 // Map/Set constructors require an iterable, not a numeric length.
 const a=Type===Map?new Map():Type===Set?new Set():make();
 let keys=0,descs=0;const own=Reflect.ownKeys,desc=Object.getOwnPropertyDescriptor;
 Reflect.ownKeys=function(o){if(o===a)keys++;return own(o);};Object.getOwnPropertyDescriptor=function(o,k){if(o===a)descs++;return desc(o,k);};
 try{assert.equal(isAuthorityJsonTree(a),false);assert.equal(isAuthorityJsonTree({nested:a}),false);}finally{Reflect.ownKeys=own;Object.getOwnPropertyDescriptor=desc;}
 assert.equal(keys,0);assert.equal(descs,0);
});
for(const token of ['4','4.0','4e0','40e-1','0','0.0','null','-4','0.1','5e-324','9007199254740991'])test(`R4 lexical exact ${token} and quoted numeric text`,()=>{
 const raw='{"n":'+token+',"source":{"raw":"4.0000000000000001 1e999999999999999999"},"categoryRaw":"4.00000000000000000000009"}';inspectAuthorityInput(raw);assert.deepEqual(inspectMigrationInput(raw),JSON.parse(raw));assert.deepEqual(inspectAttemptBackupInput(raw),JSON.parse(raw));
});
for(const token of ['-0','-0.0','1e309','1e-400','4e-324','9007199254740993','1'.repeat(257),'4e'+'0'.repeat(17),'0e9999999999999999'])test(`R4 number limits/precision ${token.slice(0,24)}`,()=>{assert.throws(()=>inspectAuthorityInput('{"n":'+token+'}'),/number/);});
test('R4 number token and exponent resource boundaries are explicit',()=>{inspectAuthorityInput('{"n":4.'+'0'.repeat(254)+'}');inspectAuthorityInput('{"n":4e'+'0'.repeat(16)+'}');assert.throws(()=>inspectAuthorityInput('{"n":4.'+'0'.repeat(255)+'}'),/number_limit/);});
for(const raw of ['', '[,]', '[1,]', '{"a":1,}', '{"a" 1}', '{"a":}', '00', '+4', '1.', '.1', '1e', 'truefalse', '"\\x00"', '"\t"', '[1', '{'])test(`R4 malformed lexical input ${JSON.stringify(raw)}`,()=>{assert.throws(()=>JSON.parse(raw));assert.throws(()=>inspectAuthorityInput(raw),SyntaxError);});
for(const raw of ['{"a":1,"a":2}',String.raw`{"a":1,"\u0061":2}`])test('R4 duplicate decoded keys refuse before adoption '+raw,()=>{assert.throws(()=>inspectAuthorityInput(raw),/duplicate_json_key/);});
test('R4 iterative quoted strings, UTF8 budget and independent 16/32/64MiB policies',()=>{
 const unicode=JSON.stringify({n:'あ😀�\uFEFF',quoted:'" \\ \n 4.0000000000000001'}),bytes=Buffer.byteLength(unicode);inspectJsonLexemes(unicode,bytes,'probe');assert.throws(()=>inspectJsonLexemes(unicode,bytes-1,'probe'),/input_limit/);
 const raw='{"format":"hosei-attempt-state","schemaVersion":24,"n":"'+'x'.repeat(17*1024*1024)+'"}';
 // This is lexical/envelope validation, NOT checkpoint or state authentication.
 inspectAuthorityInput(raw);requireAttemptAuthority(envelope(raw));assert.throws(()=>inspectMigrationInput(raw),/input_limit/);inspectAttemptBackupInput(raw);
 assert.throws(()=>inspectAuthorityInput(' '.repeat(AUTHORITY_RAW_BYTES)+'0'),/input_limit/);
});
test('R4 iterative structural budgets keep depth64 and container100000',()=>{
 inspectAuthorityInput('['.repeat(64)+'0'+']'.repeat(64));assert.throws(()=>inspectAuthorityInput('['.repeat(65)+'0'+']'.repeat(65)),/resource_limit/);
 inspectAuthorityInput('['+'0,'.repeat(99999)+'0]');assert.throws(()=>inspectAuthorityInput('['+'0,'.repeat(100000)+'0]'),/resource_limit/);
});
test('R4 global value budget 1000000/1000001',()=>{const build=n=>JSON.stringify(Array.from({length:10},(_,i)=>Array(i===9?n-900011:100000).fill(0)));inspectAuthorityInput(build(1000000));assert.throws(()=>inspectAuthorityInput(build(1000001)),/resource_limit/);});
test('R4 grammar agrees with JSON.parse for deterministic ordinary JSON',()=>{
 let seed=31;const next=()=>seed=(seed*48271)%2147483647;
 const value=d=>d===0?[null,true,false,next()%100,(next()%100)/10,'あ😀"\\\n4.0000000000000001'][next()%6]:next()%2?Array.from({length:next()%4},()=>value(d-1)):Object.fromEntries(Array.from({length:next()%4},(_,i)=>['key\\"'+i,value(d-1)]));
 for(let n=0;n<100;n++){const v=value(4),raw=JSON.stringify(v,null,n%2?2:0);assert.deepEqual(inspectMigrationInput(raw),JSON.parse(raw));}
});

const hash=s=>createHash('sha256').update(s).digest('hex'),locks={request:async(_n,_o,fn)=>fn()};
function host(initial=emptyAuthority(),primary=null){let record=structuredClone(initial),puts=0;const legacy={primaryRaw:primary,recoveryRaw:primary===null?null:'audit'};const store={read:async()=>structuredClone(record),commit:async(e,n,before)=>{assert.deepEqual(e,record,'stale_commit');before?.();record=structuredClone(n);puts++;}};return{session:()=>createPlannerAttemptSession(store,locks,{readLegacy:()=>({...legacy}),migrationEnvironment:async()=>env}),get:()=>structuredClone(record),seed:v=>record=structuredClone(v),legacy,puts:()=>puts};}
let archive;
const original=()=>archive??=(async()=>{const state=initialState();state.importedCourseAchievements=[originalRow({earnedCreditsTotal:4,categoryRaw:'literal 4.0000000000000001'})];const primary=JSON.stringify(state),x=host(emptyAuthority(),primary),s=x.session();await s.load();await s.save(await s.prepareMigration(primary),true);return{record:x.get(),primary,backup:await s.createBackup()};})();
function replaceRetained(record,token){const v=JSON.parse(record.raw),block='"retained":'+JSON.stringify(v.retained);assert.ok(block.includes('"earnedCreditsTotal":4,'));const changed=record.raw.replace(block,block.replace('"earnedCreditsTotal":4,','"earnedCreditsTotal":'+token+','));assert.notEqual(changed,record.raw);return{...record,raw:changed,revision:record.revision+1};}
for(const token of ['4.0000000000000001','4.00000000000000000000009'])test(`R4 real memory authority rejects retained ${token}, preserves raw/IDs/legacy and permission revocation`,async()=>{
 const a=await original(),x=host(a.record,a.primary),same=x.session();await same.load();const bad=replaceRetained(a.record,token);x.seed(bad);const before=x.get(),legacy=structuredClone(x.legacy),fresh=x.session(),error=async fn=>{try{await fn();return 'OK';}catch(e){return String(e);}};
 const sameLoad=await error(()=>same.load()),freshLoad=await error(()=>fresh.load()),backup=await error(()=>fresh.createBackup()),restore=await error(()=>fresh.prepareRestore(a.backup)),repeat=await error(()=>fresh.load()),unopenedRestore=await error(()=>x.session().prepareRestore(a.backup));const protection=JSON.parse(await fresh.protectCurrent());
 console.log(JSON.stringify({token,sameLoad,freshLoad,backup,restore,repeat,puts:x.puts(),revision:x.get().revision,count:before.issuedIds.length,rawSha:hash(before.raw),exact:JSON.stringify(x.get())===JSON.stringify(before)}));
 for(const outcome of [sameLoad,freshLoad,repeat,unopenedRestore])assert.match(outcome,/precision/);assert.match(restore,/session_requires_reload/);assert.notEqual(backup,'OK');assert.equal(same.admission().canEdit,false);assert.equal(fresh.admission().canEdit,false);assert.throws(()=>fresh.add('anything','{}'));assert.equal(protection.currentRaw,bad.raw);assert.equal(x.puts(),0);assert.deepEqual(x.get(),before);assert.deepEqual(x.legacy,legacy);
});
for(const token of ['4.0','4e0','40e-1'])test(`R4 real existing authority exact ${token} reload/backup/save preserve source and IDs`,async()=>{
 const a=await original(),x=host(replaceRetained(a.record,token),a.primary),s=x.session();await s.load();const backup=JSON.parse(await s.createBackup());assert.equal(backup.state.retained.importedCourseAchievements[0].earnedCreditsTotal,4);await s.save(await s.prepareSave(),true);const fresh=x.session();await fresh.load();assert.equal(JSON.parse(await fresh.createBackup()).state.source.raw,a.primary);assert.deepEqual(x.get().issuedIds,a.record.issuedIds);
});
test('R4 valid candidate cannot overwrite lossy destination after preview',async()=>{const a=await original(),x=host(a.record,a.primary),s=x.session();await s.load();const p=await s.prepareSave(),bad=replaceRetained(a.record,'4.0000000000000001');x.seed(bad);await assert.rejects(s.save(p,true));assert.equal(x.puts(),0);assert.deepEqual(x.get(),bad);});
test('R4 deep shared graphs still stop at first revisit with linear ownKeys',()=>{for(const objects of [33,81,161]){let v={n:1};for(let i=1;i<objects;i++)v={l:v,r:v};let count=0;const own=Reflect.ownKeys;Reflect.ownKeys=function(...a){count++;return own(...a);};let result;try{result=isAuthorityJsonTree(v);}finally{Reflect.ownKeys=own;}console.log(JSON.stringify({objects,ownKeys:count,result}));assert.equal(result,false);assert.equal(count,objects);assert.equal(v.l,v.r);}});
test('R4 lexical 32MiB quoted value is iterative, +1 fails without applying legacy16MiB',()=>{const raw='"'+'x'.repeat(AUTHORITY_RAW_BYTES-2)+'"';assert.doesNotThrow(()=>inspectAuthorityInput(raw));assert.throws(()=>inspectAuthorityInput(raw+' '),/input_limit/);});
for(const nested of [false,true])test(`R4 ${nested?'nested':'root'} TypedArray rejected before ownKeys/descriptors`,()=>{
 const a=new Uint8Array([17]),v=nested?{a}:a;let keys=0,descriptors=0;const own=Reflect.ownKeys,desc=Object.getOwnPropertyDescriptor;
 Reflect.ownKeys=function(o){const result=own(o);if(ArrayBuffer.isView(o))keys+=result.length;return result;};Object.getOwnPropertyDescriptor=function(o,k){if(ArrayBuffer.isView(o))descriptors++;return desc(o,k);};let result;
 try{result=isAuthorityJsonTree(v);}finally{Reflect.ownKeys=own;Object.getOwnPropertyDescriptor=desc;}
 console.log(JSON.stringify({nested,typedKeys:keys,typedDescriptors:descriptors,result}));assert.equal(result,false);assert.equal(keys,0);assert.equal(descriptors,0);assert.equal(a[0],17);
});
