import test from 'node:test';
import assert from 'node:assert/strict';
import {readMigrationFile} from '../src/planner/attempts/production/migrationFile.ts';
import {MIGRATION_INPUT_BYTES,ATTEMPT_BACKUP_INPUT_BYTES,inspectAttemptBackupInput} from '../src/planner/attempts/production/migrationInput.ts';
const file=bytes=>({size:bytes.byteLength,async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}});
for(const bytes of [[255],[0xe3,0x28,0xa1],[0xc0,0xaf],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xe3,0x81]])test(`strict UTF8 rejects ${bytes}`,async()=>{await assert.rejects(readMigrationFile(file(Uint8Array.from(bytes))),/utf8/);});
test('leading BOM is rejected; interior BOM and Japanese roundtrip exactly',async()=>{
 await assert.rejects(readMigrationFile(file(Uint8Array.from([239,187,191,123,125]))),/bom/);
 const raw=' \r\n{"原文":"あ😀é�\ufeff 4.0000000000000001"}\r\n',bytes=new TextEncoder().encode(raw);assert.equal(await readMigrationFile(file(bytes)),raw);
});
for(const delta of [-1,0,1])test(`file limit ${delta}`,async()=>{
 const size=MIGRATION_INPUT_BYTES+delta,bytes=new Uint8Array(size).fill(32);let reads=0;const f={size,async arrayBuffer(){reads++;return bytes.buffer;}};
 if(delta===1){await assert.rejects(readMigrationFile(f),/input_limit/);assert.equal(reads,0);}else{assert.equal((await readMigrationFile(f)).length,size);assert.equal(reads,1);}
});
test('huge declared size is rejected without reading; mismatched response rejected',async()=>{
 let reads=0;await assert.rejects(readMigrationFile({size:1024**4,async arrayBuffer(){reads++;throw Error('must not read');}}),/input_limit/);assert.equal(reads,0);await assert.rejects(readMigrationFile({size:2,async arrayBuffer(){return new Uint8Array(1).buffer;}}),/size_mismatch/);
});
for(const token of ['4','4.0','4e0','40e-1','0.004e3','4E+0000'])test(`Attempt number ${token}`,()=>assert.equal(inspectAttemptBackupInput('{"n":'+token+',"source.raw":"4.0000000000000001"}').n,4));
for(const token of ['4.0000000000000001','-0','1e99999','4e-99999'])test(`Attempt rejects ${token}`,()=>assert.throws(()=>inspectAttemptBackupInput('{"n":'+token+'}'),/attempt_backup_number_precision/));
test('Attempt policy is independent of migration input and bounded',()=>{
 assert.equal(ATTEMPT_BACKUP_INPUT_BYTES,64*1024*1024);const raw=' '.repeat(MIGRATION_INPUT_BYTES)+'{}';assert.deepEqual(inspectAttemptBackupInput(raw),{});assert.throws(()=>inspectAttemptBackupInput(' '.repeat(ATTEMPT_BACKUP_INPUT_BYTES+1)),/attempt_backup_input_limit/);
});
