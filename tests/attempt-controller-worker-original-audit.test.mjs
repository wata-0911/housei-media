import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createPreviewSession} from '../src/planner/attempts/persistence/worker/session.ts';
import {createControllerWorkerClient} from '../src/planner/attempts/persistence/worker/client.ts';
import {env,mixed} from '../tests/fixtures/migration-fixture.mjs';
test('R1: observed authority change permanently invalidates prior save eligibility until explicit refresh',async()=>{
 const records=JSON.parse(await readFile('../../pr183-controller-worker-3b1-20261027/performance-fixtures.json','utf8')),original=records[24];let rec=structuredClone(original);
 const s=createPreviewSession(async()=>structuredClone(rec),async()=>env,1),c=(id,op,extra={})=>({version:1,boot:1,requestId:id,op,...extra});
 try{const start=await s.request(c(1,'startSession')),i=await s.request(c(2,'inspectLegacyRaw',{session:start.session,expectedView:start.view}),JSON.stringify(mixed())),p=await s.request(c(3,'prepareMigration',{session:start.session,expectedView:i.view,migration:i.migration})),g={session:start.session,expectedView:p.view,draft:p.draft};
 rec.committed.push('f'.repeat(64));await assert.rejects(s.request(c(4,'prepareSave',g)),{code:'stale_authority'});rec=structuredClone(original);
 await assert.rejects(s.request(c(5,'prepareSave',g)),/stale/);
 }finally{s.close();}
});
test('R2: main client reserves at most eight outstanding requests before awaiting readiness',async()=>{
 const sent=[],w={postMessage:x=>sent.push(JSON.parse(x)),terminate(){}};const client=createControllerWorkerClient(()=>w);
 try{w.onmessage({data:JSON.stringify({...sent[0],type:'ready',mode:'preview-only'})});const start=client.startSession();await new Promise(r=>setImmediate(r));const c=sent.at(-1),g={session:'a'.repeat(48),expectedView:'b'.repeat(48)};w.onmessage({data:JSON.stringify({version:1,boot:c.boot,requestId:c.requestId,type:'result',value:{session:g.session,view:g.expectedView,mode:'preview-only'}})});await start;
 const before=sent.length,jobs=Array.from({length:20},()=>client.readPage({...g,kind:'attempts'}).catch(e=>e.code));await new Promise(r=>setImmediate(r));const count=sent.length-before;client.close();await Promise.all(jobs);assert.ok(count<=8,`actual pending IPC requests: ${count}`);
 }finally{client.close();}
});
