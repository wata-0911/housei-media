import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { adopted, reserved, json, origin } from '../grade-import-host/fixture.mjs';
import { createHost, environment } from '../../src/planner/attempts/gradeImportHost/codecV2.ts';
import { bundledCodec } from './revision-fixture.mjs';
const { packBackup, inspectBackupBytes, utf16Bytes, base64, decodeRecord } = await bundledCodec();
import { parseBackupJson } from '../../src/planner/attempts/gradeImportHost/portable/json.ts';
import { LIMITS } from '../../src/planner/attempts/gradeImportHost/portable/contracts.ts';
import { createGradeImportBackupController } from '../../src/planner/attempts/gradeImportHost/portable/controller.ts';
const now='2026-11-04T00:00:00.000Z';
const bytes=s=>new TextEncoder().encode(s);
// Independent wire/hash oracle: Node's UTF16LE encoding and crypto, never the
// product UTF16/base64/digest functions under test.
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function resign(v){const {integrity,...body}=v;void integrity;v.integrity={algorithm:'sha256-canonical-json/v1',sha256:hash(canonical(body))};return bytes(JSON.stringify(v));}
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);

test('A02/A03: v1 exact noncanonical record, UTF16LE/base64 and independent file oracle',async()=>{
 const r=(await adopted(true)).t2,A='\r\n'+JSON.stringify(r,null,2)+'\r\n',b=await packBackup(A,now),p=JSON.parse(new TextDecoder().decode(b));
 assert.equal(p.format,'hosei-grade-import-host-backup');assert.equal(p.backupVersion,1);
 assert.equal(p.record.payload,Buffer.from(A,'utf16le').toString('base64'));
 assert.equal(p.record.sha256,hash(Buffer.from(A,'utf16le')));assert.equal(p.record.codeUnits,A.length);assert.equal(p.record.byteLength,A.length*2);
 const checked=await inspectBackupBytes(b);assert.equal(checked.raw,A);assert.deepEqual(checked.record,r);assert.equal(checked.fileSha256,hash(b));
 const l=JSON.parse(r.ledgerRaw);assert.equal(p.summary.reservationsSha256,hash(canonical(r.authority.reservedIds)));
 assert.equal(p.summary.floorSha256,hash(JSON.stringify({issuedIds:l.issuedIds,reservedIds:l.reservedIds})));
 assert.equal(p.summary.grantCount,1);assert.equal(p.summary.receiptCount,1);assert.equal(p.summary.operationCount,2);
});
test('A02/A05: native-v2-empty and T1-only preserve every reservation without a receipt',async()=>{
 const v=await createHost('12345678-0000-4000-8000-000000000099',environment(origin));
 const a=await inspectBackupBytes(await packBackup(json(v),now));assert.equal(a.backup.summary.baseProvenance,'native-v2-empty');
 const t1=(await reserved(true)).t1,b=await inspectBackupBytes(await packBackup(json(t1),now));
 assert.deepEqual(b.record,t1);assert.equal(b.record.authority.reservedIds.length,28);assert.equal(b.backup.summary.receiptCount,0);assert.equal(b.backup.summary.operationCount,0);
});
test('A03: code-unit transport includes CRLF, escape, astral/paired/unpaired UTF16 boundaries',()=>{
 for(const A of ['','\r\n \\u3042','あ𠮷😀\0','\ud800','\udfff','\ud800x\udfff','x'.repeat(8191)+'😀'+'y'.repeat(8192)]){
  const expected=Buffer.from(A,'utf16le');assert.deepEqual(Buffer.from(utf16Bytes(A)),expected);assert.equal(base64(utf16Bytes(A)),expected.toString('base64'));
  const r={encoding:'js-utf16le-base64/v1',codeUnits:A.length,byteLength:expected.length,sha256:hash(expected),payload:expected.toString('base64')};
  assert.equal(decodeRecord(r).raw,A);
 }
});
for(const mode of ['bit','summary','version','policy','producer','key','recordHash','length','encoding'])test('A10/A11: rejects '+mode,async()=>{
 const p=JSON.parse(new TextDecoder().decode(await packBackup(json((await reserved()).t1),now)));
 if(mode==='bit')p.record.payload='B'+p.record.payload.slice(1);
 if(mode==='summary')p.summary.grantCount++;
 if(mode==='version')p.backupVersion=2;
 if(mode==='policy')p.policy='future';
 if(mode==='producer')p.producer.extra=true;
 if(mode==='key')p.extra=true;
 if(mode==='recordHash')p.record.sha256='0'.repeat(64);
 if(mode==='length')p.record.codeUnits++;
 if(mode==='encoding')p.record.encoding='utf8';
 await assert.rejects(inspectBackupBytes(resign(p)));
});
test('A10: noncanonical base64 padding bits, whitespace, odd byte lengths and truncate fail before replay',()=>{
 const r={encoding:'js-utf16le-base64/v1',codeUnits:1,byteLength:2,sha256:'0'.repeat(64),payload:'QQA='};
 for(const patch of [{payload:'QQB='},{payload:' QQA='},{payload:'QQ'},{byteLength:1},{payload:'QQ=='},{payload:'????'}])assert.throws(()=>decodeRecord({...r,...patch}));
});
test('A11/A20: outer strict syntax, duplicate decoded keys, integer precision and all preflight budgets',async()=>{
 for(const s of ['{"a":1,"\\u0061":2}','{"a":-0}','{"a":1e999}','{"a":1e-999}','{"a":9007199254740993}','{"a":0.1}','{"a":1,}','[1,]','{"a":NaN}'])assert.throws(()=>parseBackupJson(s));
 assert.doesNotThrow(()=>parseBackupJson('['.repeat(9)+'0'+']'.repeat(9)));
 assert.throws(()=>parseBackupJson('['.repeat(10)+'0'+']'.repeat(10)),e=>e.code==='resource_limit');
 for(const s of [JSON.stringify({x:'x'.repeat(LIMITS.metadataBytes+1)}),' '.repeat(LIMITS.fileBytes+1),' '.repeat(LIMITS.metadataBytes)+'{}','['+Array(129).fill('{}').join(',')+']','['+Array(4097).fill('0').join(',')+']',JSON.stringify(Object.fromEntries(Array.from({length:1025},(_,i)=>['k'+i,0])))])assert.throws(()=>parseBackupJson(s),e=>e.code==='resource_limit');
 await rejects(inspectBackupBytes(new Uint8Array(LIMITS.fileBytes+1)),'resource_limit');
 await rejects(inspectBackupBytes(new Uint8Array([0xc0,0xaf])),'invalid_utf8');
 await rejects(inspectBackupBytes(new Uint8Array([0xef,0xbb,0xbf,123,125])),'invalid_utf8');
 for(const p of [{format:'hosei-planner-backup',backupVersion:2},{format:'hosei-attempt-backup',backupVersion:4},{format:'hosei-planner-protection'},{}])await assert.rejects(inspectBackupBytes(bytes(JSON.stringify(p))));
});
test('A10: rewriting historical receipt and recalculating package hashes cannot replace full replay',async()=>{
 const p=JSON.parse(new TextDecoder().decode(await packBackup(json((await adopted(true)).t2),now)));
 const r=JSON.parse(Buffer.from(p.record.payload,'base64').toString('utf16le'));r.receipts[0].decision.confirmation.rows[0].reason='forged';
 const A=JSON.stringify(r),b=Buffer.from(A,'utf16le');p.record={...p.record,payload:b.toString('base64'),codeUnits:A.length,byteLength:b.length,sha256:hash(b)};
 await assert.rejects(inspectBackupBytes(resign(p)));
});
test('A23: public shapes/copies are never native proposals',async()=>{
 const c=createGradeImportBackupController({},undefined,origin,{getItem:()=>null});
 await rejects(c.confirmRestore({targetsJson:'{}',targetSha256:'0'.repeat(64)},'{}'),'unqualified');
 await rejects(c.commitRestore({confirmationJson:'{}'}),'unqualified');assert.equal(c.isStopped(),false);
});
test('A20/A23: intrinsic File size rejects oversize before reading; caller getters do not qualify',async()=>{
 const {readSelectedFile}=await import('../../src/planner/attempts/gradeImportHost/portable/codec.ts');
 const file=new File([new Uint8Array(LIMITS.fileBytes+1)],'oversized.json');let touched=0;
 Object.defineProperty(file,'size',{get(){touched++;return 0;}});Object.defineProperty(file,'arrayBuffer',{value(){touched++;throw Error('caller method');}});
 await rejects(readSelectedFile(file),'resource_limit');assert.equal(touched,0);
 const fake={get size(){touched++;return 1;},get name(){touched++;return 'fake';}};await assert.rejects(readSelectedFile(fake));assert.equal(touched,0);
});
test('A10/A23: caller byte mutation after inspect starts cannot alter its captured snapshot',async()=>{
 const A=json((await reserved()).t1),file=await packBackup(A,now),pending=inspectBackupBytes(file);file.fill(0);const checked=await pending;assert.equal(checked.raw,A);assert.ok(Object.isFrozen(checked.record.authority.reservedIds));
});
test('A21: pinned pure journal/ID upper bounds remain strict, without inventing a native history',async()=>{
 const {createLedger,verifyLedgerState}=await import('../../src/planner/attempts/gradeImport/ledger.ts');
 const ids=Array.from({length:20000},(_,i)=>`${i.toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`);
 const max=await createLedger(JSON.stringify(ids));assert.equal(max.reservedIds.length,20000);assert.deepEqual(max.issuedIds,[]);
 await assert.rejects(createLedger(JSON.stringify([...ids,'ffffffff-0000-4000-8000-000000000000'])),e=>e.code==='resource_limit');
 const empty=await createLedger(),over={...empty,journal:{...empty.journal,entries:Array(129).fill({})}};
 await assert.rejects(verifyLedgerState(JSON.stringify(over)),e=>e.code==='resource_limit');
});
