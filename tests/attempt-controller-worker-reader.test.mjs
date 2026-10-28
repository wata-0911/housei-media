import test from 'node:test';import assert from 'node:assert/strict';
import {readIndexedDbAuthority} from '../src/planner/attempts/persistence/indexedDbRead.ts';
import {createIndexedDbAttemptStore} from '../src/planner/attempts/persistence/indexedDb.ts';
const tick=()=>new Promise(r=>setTimeout(r,0));
test('inventory nonexistent returns empty without open; adapter delegates',async()=>{let opens=0;const factory={databases:async()=>[],open(){opens++;throw Error('must not create');}};const a=await readIndexedDbAuthority(factory),b=await createIndexedDbAttemptStore(factory).read();assert.deepEqual(a,b);assert.equal(a.raw,null);assert.equal(opens,0);});
test('unsupported/missing inventory fail closed before open',async()=>{let opens=0;for(const factory of [{open(){opens++;}},{databases:async()=>[{name:'hosei-yi06-isolated-v1',version:2}],open(){opens++;}}])await assert.rejects(readIndexedDbAuthority(factory));assert.equal(opens,0);});
test('reader waits readonly tx completion and returns identical record',async()=>{
 const req={},tx={},get={},record={raw:'exact raw',revision:4,committed:[],issuedIds:[]};let closed=0,mode;const db={close(){closed++;},transaction(name,m){assert.equal(name,'authority');mode=m;return tx;}};tx.objectStore=name=>{assert.equal(name,'authority');return {get:key=>{assert.equal(key,'current');return get;}};};
 const p=readIndexedDbAuthority({databases:async()=>[{name:'hosei-yi06-isolated-v1',version:1}],open:()=>req});await tick();req.result=db;req.onsuccess();get.result=record;get.onsuccess();let settled=false;p.then(()=>settled=true);await tick();assert.equal(settled,false);assert.equal(mode,'readonly');tx.oncomplete();assert.equal(await p,record);assert.equal(closed,1);
});
test('unexpected upgrade aborts; blocked late success closes without tx',async()=>{
 const req={};let aborted=0,closed=0,transactions=0;const factory={databases:async()=>[{name:'hosei-yi06-isolated-v1',version:1}],open:()=>req};const p=readIndexedDbAuthority(factory);await tick();req.transaction={abort:()=>aborted++};req.onupgradeneeded();assert.equal(aborted,1);req.onblocked();await assert.rejects(p);req.result={close:()=>closed++,transaction:()=>transactions++};req.onsuccess();assert.equal(closed,1);assert.equal(transactions,0);
});
