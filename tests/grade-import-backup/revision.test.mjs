import test from 'node:test';
import assert from 'node:assert/strict';
import {reserved,json} from '../grade-import-host/fixture.mjs';
import {bundledCodec,TEST_REVISION,testRevisionDefine} from './revision-fixture.mjs';
const now='2026-11-04T00:00:00.000Z';
test('F01: explicit TEST ONLY revision reaches the unchanged B1 field',async()=>{
 const m=await bundledCodec(),A=json((await reserved()).t1),file=await m.packBackup(A,now),p=JSON.parse(new TextDecoder().decode(file));
 assert.equal(p.producer.revision,TEST_REVISION);assert.equal((await m.inspectBackupBytes(file)).raw,A);
});
for(const [name,define] of [
 ['missing',{}],
 ['invalid SHA',{...testRevisionDefine,'import.meta.__G03_EXPORTER_STAMP__':JSON.stringify({source:'test-only',revision:'invalid'})}],
 ['test value in distribution',{...testRevisionDefine,'import.meta.__G03_EXPORTER_TEST__':'false'}],
 ['unclassified SHA',{...testRevisionDefine,'import.meta.__G03_EXPORTER_STAMP__':JSON.stringify({revision:TEST_REVISION})}],
 ['unexpected stamp key',{...testRevisionDefine,'import.meta.__G03_EXPORTER_STAMP__':JSON.stringify({source:'test-only',revision:TEST_REVISION,dirty:true})}],
])test('F01: '+name+' cannot issue B1',async()=>{
 const m=await bundledCodec(define),A=json((await reserved()).t1);
 await assert.rejects(m.packBackup(A,now),e=>e.code==='revision_unavailable');
});
test('F01: unstamped direct module cannot use caller globals as revision authority',async()=>{
 globalThis.__G03_EXPORTER_STAMP__={source:'clean-git',revision:TEST_REVISION};globalThis.__G03_EXPORTER_TEST__=false;
 try {const m=await import('../../src/planner/attempts/gradeImportHost/portable/codec.ts');await assert.rejects(m.packBackup(json((await reserved()).t1),now),e=>e.code==='revision_unavailable');}
 finally {delete globalThis.__G03_EXPORTER_STAMP__;delete globalThis.__G03_EXPORTER_TEST__;}
});
test('F01: valid build literal is preserved; inspect remains integrity-only and accepts old B1 producer',async()=>{
 const {createHash}=await import('node:crypto');
 const m=await bundledCodec({...testRevisionDefine,'import.meta.__G03_EXPORTER_TEST__':'false','import.meta.__G03_EXPORTER_STAMP__':JSON.stringify({source:'clean-git',revision:'a'.repeat(40)})});
 const A='\r\n'+json((await reserved()).t1)+'\r\n',file=await m.packBackup(A,now),p=JSON.parse(new TextDecoder().decode(file));assert.equal(p.producer.revision,'a'.repeat(40));
 // Historical producer value is data, not a certificate for that commit.
 p.producer.revision='10a956d82afedad91b5709998b1ae9079416e851';
 const {integrity,...body}=p;void integrity;
 const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
 p.integrity.sha256=createHash('sha256').update(canonical(body)).digest('hex');
 const unstamped=await bundledCodec({});assert.equal((await unstamped.inspectBackupBytes(new TextEncoder().encode(JSON.stringify(p)))).raw,A);
 assert.equal(p.record.payload,Buffer.from(A,'utf16le').toString('base64'));
});
for(const revision of ['',null,123,'A'.repeat(40),'a'.repeat(39),'a'.repeat(41),' '+'a'.repeat(40)])test('F01: malformed revision '+JSON.stringify(revision)+' fails closed',async()=>{
 const m=await bundledCodec({...testRevisionDefine,'import.meta.__G03_EXPORTER_STAMP__':JSON.stringify({source:'test-only',revision})});
 await assert.rejects(m.packBackup(json((await reserved()).t1),now),e=>e.code==='revision_unavailable');
});
