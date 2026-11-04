import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost,environment,decodeHost,parse,sourceContext,appendHost,ledgerContext,json,digest,receiptFor } from '../../src/planner/attempts/gradeImportHost/codec.ts';
import { LIMITS } from '../../src/planner/attempts/gradeImportHost/contracts.ts';
import { raw,reserved,adopted,hostId,origin,course,input,oracle } from './fixture.mjs';
const reject=(promise,code)=>assert.rejects(promise,e=>!code||e.code===code);
const clone=structuredClone;
test('V03/V09: T1 adds H only, ledger floor and accepted data remain empty',async()=>{
 const v=await reserved();const before=await ledgerContext(v.r),after=await ledgerContext(v.t1);
 assert.equal(v.t1.authority.reservedIds.length,27);assert.equal(v.grant.ids.length,26);
 assert.deepEqual(after,before);assert.deepEqual(v.t1.receipts,[]);assert.deepEqual(v.t1.outcomes,[]);
 assert.equal(after.ledger.issuedIds.length,0);assert.deepEqual(JSON.parse(after.floorRaw),{issuedIds:[],reservedIds:[hostId]});
 const {verifyLedgerState}=await import('../../src/planner/attempts/gradeImport/ledger.ts');
 await reject(verifyLedgerState(v.t1.ledgerRaw,json({issuedIds:[],reservedIds:v.t1.authority.reservedIds})),'reservation_shrink');
});
for(const q of [null,0,4])for(const activate of [false,true])test(`V03/V04/V10/V11: full oracle, quantity=${q}, active=${activate}`,async()=>{
 const source=raw(q); const v=await adopted(activate,source);const round=await decodeHost(json(v.t2));
 assert.equal(json(round),json(v.t2));assert.deepEqual(JSON.parse(round.ledgerRaw),oracle(v.plan.operations,[hostId]));
 const l=JSON.parse(round.ledgerRaw);assert.equal(l.view.snapshots[0].archive.raw,source);
 assert.deepEqual(l.view.revisions[0].record,v.c.archive.dto.courses[0]);
 assert.equal(l.view.revisions[0].record.earnedCredits.value,q);assert.equal(l.view.revisions[0].record.schoolingCredits.value,2);
 assert.equal(l.view.details.length,7);assert.equal(l.journal.entries.length,activate?2:1);
 assert.equal(l.view.achievements[0].activeRevisionId,activate?v.grant.allocation.rows[0].revisionId:null);
 assert.deepEqual(round.receipts,[v.receipt]);assert.equal(round.authority.opReceipts.length,activate?2:1);
 assert.equal(v.plan.authorization.canCommit,false);assert.equal(v.plan.authorization.burn,'not-performed');assert.deepEqual(l.view.associations,[]);
});
test('V04: same names in different years remain independent source records',async()=>{
 const a=await adopted(false,raw(4,'2024')),b=await adopted(false,raw(4,'2023'));
 assert.notEqual(a.grant.ids[2],b.grant.ids[2]);assert.notEqual(a.receipt.archiveSha256,b.receipt.archiveSha256);
 assert.equal(JSON.parse(a.t2.ledgerRaw).view.revisions[0].record.schoolings[0].year,'2024');
});
test('V05: two identical rows rejected as whole; source bytes unchanged',async()=>{
 const r=await createHost(hostId,environment(origin)),s=json(input([course(),course()]));
 await reject(sourceContext(s,r),'unsupported_policy');assert.equal(s,json(input([course(),course()])));
});
test('V13: same bare operation with different decision reason is different receipt',async()=>{
 const v=await adopted(),d=clone(v.decision);d.confirmation.rows[0].reason='別の確認理由';
 const next=await receiptFor(v.c,v.grant,d);assert.deepEqual(next.plan.operations,v.plan.operations);assert.notDeepEqual(next.receipt,v.receipt);
});
test('V08/V15: grant roles, unknown fields, ledger and materializations cannot be rewritten',async()=>{
 const v=await adopted();
 const mutations=[r=>r.extra=1,r=>r.authority.reservedIds.pop(),r=>r.outcomes[0].ledgerEntries=0,r=>r.receipts[0].decision.confirmation.rows[0].reason='tamper',
 r=>r.events[0].body.grant.ids[2]=r.events[0].body.grant.ids[3],r=>r.events[0].body.grant.selection.rows[0].action='correction',
 r=>r.ledgerRaw=r.ledgerRaw.replace('旧4単位','new'),r=>r.events.reverse(),r=>r.authority.opReceipts=[]];
 for(const mutate of mutations){const r=clone(v.t2);mutate(r);await assert.rejects(decodeHost(json(r)));}
 // Even recomputing the public event hashes cannot repair a role substitution.
 const r=clone(v.t1);r.events[0].body.grant.ids[2]=r.events[0].body.grant.ids[3];
 r.events[0].eventSha256=await digest({sequence:1,previousSha256:null,body:r.events[0].body});
 await reject(decodeHost(json(r)),'id_ticket');
});
test('V15/V20: strict JSON, objects never normalized, bytes/depth bounded',async()=>{
 let gets=0;const object=Object.defineProperty({},'x',{get(){gets++;throw Error('getter');}});
 for(const value of [object,new String('{}'),null,0,undefined,[],Symbol('x')])assert.throws(()=>parse(value),{code:'input_type'});
 assert.equal(gets,0);
 for(const s of ['{"x":1,"x":2}','{"x":-0}','{"x":1e-999}','{"x":9007199254740993}'])assert.throws(()=>parse(s));
 assert.equal(parse(' '.repeat(LIMITS.bytes-1)+'0'),0);
 assert.throws(()=>parse(' '.repeat(LIMITS.bytes+1)),{code:'resource_limit'});
 assert.throws(()=>parse('['.repeat(66)+'0'+']'.repeat(66)),{code:'resource_limit'});
 assert.deepEqual(parse('['.repeat(65)+'0'+']'.repeat(65)),JSON.parse('['.repeat(65)+'0'+']'.repeat(65)));
 await reject(decodeHost('{}'),'shape');
});
test('V20: 128 reservations preserve every burn; 129th fails without changing input',async()=>{
 const v=await reserved();let r=v.r; const {HostIdentityOwner}=await import('../../src/planner/attempts/gradeImportHost/identity.ts');const owner=new HostIdentityOwner();
 for(let n=0;n<128;n++){const m=owner.mint(r,false),g={...v.grant,ids:m.ids,intentId:m.ids[0],selection:m.selection,allocation:m.allocation};r=await appendHost(r,{kind:'reserve',grant:g});}
 const before=json(r),m=owner.mint(r,false);await reject(appendHost(r,{kind:'reserve',grant:{...v.grant,ids:m.ids,intentId:m.ids[0],selection:m.selection,allocation:m.allocation}}),'resource_limit');
 assert.equal(json(r),before);assert.equal(r.authority.reservedIds.length,1+128*26);
});
