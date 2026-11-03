import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLedger,appendOperation,replayJournal,verifyLedgerState,LedgerError,LIMITS} from '../../src/planner/attempts/gradeImport/ledger.ts';
import {SourceContractError,decodeGradeSourceArchive} from '../../src/planner/attempts/gradeImport/sourceArchive.ts';
import {mint,course,archive,assignment,importOp,activateOp,associateOp,append,floor,clone,rehash,oracle} from './ledgerFixture.mjs';
const rejects=(p,c)=>assert.rejects(p,e=>e instanceof LedgerError&&e.code===c&&e.message===c);
async function fixture(rows=[course()]){const empty=await createLedger(),op=importOp(empty,await archive(rows));return {empty,op,state:await append(empty,op)};}
async function roundtrip(s){assert.deepEqual(await verifyLedgerState(JSON.stringify(s)),s);assert.deepEqual(await replayJournal(JSON.stringify(s.journal)),s);}
function frozen(v){if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));Object.values(v).forEach(frozen);}}

test('empty seed/全field oracle/readonly、IDの自動発行なし',async()=>{
 const seed=[mint('revision')],s=await createLedger(JSON.stringify(seed));assert.deepEqual(s,oracle([],seed));frozen(s);await roundtrip(s);
});
test('G01a結合：原行と7内訳の論理ID/観測/revision区別、完全oracle',async()=>{
 const f=await fixture();assert.deepEqual(f.state,oracle([f.op]));assert.equal(f.state.view.detailRevisions.length,7);assert.equal(f.state.view.achievements[0].activeRevisionId,null);frozen(f.state);await roundtrip(f.state);
});
test('4→2は追加と明示切替を分離し旧revisionの全field/量不変',async()=>{
 const f=await fixture(),a1=activateOp(f.state,f.op.rows[0]),s1=await append(f.state,a1);
 const op=importOp(s1,await archive([course('旧数学',2)]),[assignment(f.op.rows[0])]),s2=await append(s1,op);
 assert.equal(s2.view.achievements[0].activeRevisionId,f.op.rows[0].revisionId);
 const a2=activateOp(s2,op.rows[0]),s3=await append(s2,a2);assert.deepEqual(s3,oracle([f.op,a1,op,a2]));
 assert.deepEqual(s3.view.revisions[0],s1.view.revisions[0]);assert.deepEqual(s3.view.revisions.map(r=>r.record.earnedCredits.value),[4,2]);
 assert.equal(s3.view.details.length,7);assert.equal(s3.view.detailRevisions.length,14);assert.equal(s3.view.achievements[0].activeRevisionId,op.rows[0].revisionId);await roundtrip(s3);
});
test('公式4＋未解決別原行で既知4のheadを失わない',async()=>{
 const f=await fixture(),a=activateOp(f.state,f.op.rows[0]),s=await append(f.state,a);
 const op=importOp(s,await archive([course('Offeringにも存在しない名称',null,'2010')])),next=await append(s,op);
 assert.deepEqual(next,oracle([f.op,a,op]));assert.equal(next.view.achievements[0].activeRevisionId,f.op.rows[0].revisionId);assert.equal(next.view.achievements[1].activeRevisionId,null);await roundtrip(next);
});
test('同内容の2原行は別論理ID/観測/内訳、統合しない',async()=>{
 const r=course(),f=await fixture([r,r]);assert.deepEqual(f.state,oracle([f.op]));assert.equal(f.state.view.achievements.length,2);
 assert.notEqual(f.op.rows[0].achievementId,f.op.rows[1].achievementId);assert.deepEqual(f.state.view.revisions[0].record,f.state.view.revisions[1].record);await roundtrip(f.state);
});
test('2原行を同一achievementへ強制統合する指定を拒否',async()=>{
 const s=await createLedger(),op=importOp(s,await archive([course(),course()]));op.rows[1].achievementId=op.rows[0].achievementId;await rejects(append(s,op),'id_collision');
});
test('同operationId同payloadの再送は後続操作後もjournalとIDがno-op',async()=>{
 const f=await fixture();assert.deepEqual(await append(f.state,f.op),f.state);const s=await append(f.state,activateOp(f.state,f.op.rows[0]));assert.deepEqual(await append(s,f.op),s);
});
test('同operationId別payloadは競合拒否、入力state不変',async()=>{
 const f=await fixture(),b=clone(f.op),original=JSON.stringify(f.state);b.rows[0].observationId=mint('observation');await rejects(append(f.state,b),'operation_conflict');assert.equal(JSON.stringify(f.state),original);
});
test('同snapshotの別operation再送はreceiptだけ増え観測/revision不変',async()=>{
 const f=await fixture(),retry={...clone(f.op),operationId:mint('operation'),expectedTipSha256:f.state.tipSha256},s=await append(f.state,retry);
 assert.deepEqual(s,oracle([f.op,retry]));assert.equal(s.view.revisions.length,1);assert.equal(s.issuedIds.length,f.state.issuedIds.length+1);await roundtrip(s);
});
test('同snapshot IDの改変と同rawを別snapshotで二重取込する指定を拒否',async()=>{
 const f=await fixture(),b={...clone(f.op),operationId:mint('operation'),expectedTipSha256:f.state.tipSha256,archive:await archive([course('other')])};
 await rejects(append(f.state,b),'snapshot_conflict');await rejects(append(f.state,importOp(f.state,f.op.archive)),'snapshot_already_observed');
});
for(const q of [null,0,2,4])test(`公式${q}は補完せず原行/内訳全field保持`,async()=>{
 const f=await fixture([course('同名',q)]),a=activateOp(f.state,f.op.rows[0]),s=await append(f.state,a);assert.deepEqual(s,oracle([f.op,a]));assert.equal(s.view.revisions[0].record.earnedCredits.value,q);await roundtrip(s);
});
test('異年度同名は別観測、名前/年度/単位から恒久identityを生成しない',async()=>{
 const f=await fixture([course('同名',4,'2010'),course('同名',4,'2025')]);assert.deepEqual(f.state,oracle([f.op]));assert.equal(f.state.view.achievements.length,2);assert.deepEqual(f.state.view.revisions.map(r=>r.record.schoolings[0].year),['2010','2025']);
});
test('手動Attempt associationは未確認参照のみ、量/headに影響しない',async()=>{
 const f=await fixture(),op=associateOp(f.state,f.op.rows[0]),s=await append(f.state,op);assert.deepEqual(s.view.revisions,f.state.view.revisions);assert.deepEqual(s.view.achievements,f.state.view.achievements);
 assert.deepEqual(s.view.associations,[{id:op.associationId,achievementId:op.achievementId,revisionId:op.revisionId,attemptId:op.attemptId,status:'unverified'}]);
 assert.ok(s.reservedIds.includes(op.attemptId));assert.ok(!s.issuedIds.includes(op.attemptId));await roundtrip(s);
 const b=associateOp(s,f.op.rows[0]);b.status='confirmed';await rejects(append(s,b),'shape');
});
test('異原行revisionと実在しないassociation先を拒否',async()=>{
 const f=await fixture([course(),course('other')]),a=activateOp(f.state,f.op.rows[0]);a.revisionId=f.op.rows[1].revisionId;await rejects(append(f.state,a),'reference');
 const b=associateOp(f.state,f.op.rows[0]);b.revisionId=mint('revision');await rejects(append(f.state,b),'reference');
});
test('revisionは直前predecessor必須、null/誤参照・detail前revision欠落は拒否',async()=>{
 const f=await fixture(),op=importOp(f.state,await archive([course('旧数学',2)]),[assignment(f.op.rows[0])]);
 for(const previous of [null,mint('revision')]){const b=clone(op);b.rows[0].previousRevisionId=previous;await rejects(append(f.state,b),'revision_predecessor');}
 const b=clone(op);b.rows[0].details[0].previousRevisionId=null;await rejects(append(f.state,b),'revision_predecessor');
});
test('detail logical IDを別原行/別slotから横取りできない',async()=>{
 const f=await fixture([course(),course('other')]),op=importOp(f.state,await archive([course('旧数学',2)]),[assignment(f.op.rows[0])]);
 op.rows[0].details[0].detailId=f.op.rows[1].details[0].detailId;op.rows[0].details[0].previousRevisionId=f.op.rows[1].details[0].revisionId;await rejects(append(f.state,op),'detail_owner');
 const b=importOp(f.state,op.archive,[assignment(f.op.rows[0])]);[b.rows[0].details[0],b.rows[0].details[1]]=[b.rows[0].details[1],b.rows[0].details[0]];await rejects(append(f.state,b),'detail_owner');
});
test('active headのexpectedがstaleなら明示切替も拒否',async()=>{
 const f=await fixture(),s=await append(f.state,activateOp(f.state,f.op.rows[0])),b=activateOp(s,f.op.rows[0]);b.expectedActiveRevisionId=null;await rejects(append(s,b),'stale_active');
});
test('journal順序/重複/hash改ざんを検出',async()=>{
 const f=await fixture(),s=await append(f.state,activateOp(f.state,f.op.rows[0]));let j=clone(s.journal);j.entries.reverse();await rejects(replayJournal(JSON.stringify(j)),'stale_tip');
 j=clone(s.journal);j.entries.push(clone(j.entries[0]));await rejects(replayJournal(JSON.stringify(j)),'duplicate_event');
 j=clone(s.journal);j.entries[0].payloadSha256='0'.repeat(64);await rejects(replayJournal(JSON.stringify(j)),'payload_digest');
 j=clone(s.journal);j.entries[0].eventSha256='0'.repeat(64);await rejects(replayJournal(JSON.stringify(j)),'event_digest');
});
test('再hash済み逆順activation・revision前参照改ざんもreplayで拒否',async()=>{
 const f=await fixture(),s=await append(f.state,activateOp(f.state,f.op.rows[0])),j=clone(s.journal);j.entries.reverse();rehash(j);await rejects(replayJournal(JSON.stringify(j)),'reference');
 const op=importOp(s,await archive([course('旧数学',2)]),[assignment(f.op.rows[0])]),s2=await append(s,op),j2=clone(s2.journal);j2.entries[2].operation.rows[0].previousRevisionId=null;rehash(j2);await rejects(replayJournal(JSON.stringify(j2)),'revision_predecessor');
});
test('全field oracleが数量/内訳/順序/省略/予約/発行の改ざんを拒否',async()=>{
 const f=await fixture([course(),course('other')]);const changes=[
 s=>{s.view.revisions[0].record.earnedCredits.value=999;},s=>{s.view.detailRevisions[0].record.raw='changed';},
 s=>{s.view.revisions.reverse();},s=>{delete s.view.revisions[0].record.categoryRaw;},s=>{s.view.unknown=1;},
 s=>{s.reservedIds.pop();},s=>{s.issuedIds.pop();},s=>{s.tipSha256=null;},s=>{s.view.observations[0].rowIndex=1;}];
 for(const change of changes){const b=clone(f.state);change(b);await rejects(verifyLedgerState(JSON.stringify(b)),'state_mismatch');}
});
test('予約/発行floor付き検証はvalidな旧prefix差替でも縮小を拒否',async()=>{
 const f=await fixture(),s=await append(f.state,associateOp(f.state,f.op.rows[0]));await rejects(verifyLedgerState(JSON.stringify(f.empty),JSON.stringify(floor(s))),'reservation_shrink');
 const fake=await createLedger(JSON.stringify(s.reservedIds));await rejects(verifyLedgerState(JSON.stringify(fake),JSON.stringify(floor(s))),'issuance_shrink');
 assert.deepEqual(await verifyLedgerState(JSON.stringify(s),JSON.stringify(floor(f.state))),s);
});
test('UUID尾部の全namespace衝突・seed予約再発行・二重宣言を拒否',async()=>{
 const reserved=mint('revision'),seed=await createLedger(JSON.stringify([reserved])),op=importOp(seed,await archive());op.operationId=reserved.replace('g01b-revision','g01b-operation');await rejects(append(seed,op),'id_collision');
 const f=await fixture(),b=importOp(f.state,await archive([course('new')]));b.rows[0].revisionId=f.op.rows[0].revisionId;await rejects(append(f.state,b),'id_collision');
 const c=importOp(f.empty,f.op.archive);c.rows[0].details[1].observationId=c.rows[0].details[0].observationId;await rejects(append(f.empty,c),'id_collision');
});
test('原行削除を指定する再取込・不足mapping・raw不一致の行削除を拒否',async()=>{
 const f=await fixture([course(),course('missing')]),op=importOp(f.state,await archive([course('旧数学',2)]));op.deleteAchievementIds=[f.op.rows[1].achievementId];await rejects(append(f.state,op),'shape');
 const b=importOp(f.empty,f.op.archive,[assignment()]);await rejects(append(f.empty,b),'incomplete_snapshot');
 const c=clone(f.op);c.archive.dto.courses.pop();await assert.rejects(append(f.empty,c),e=>e instanceof SourceContractError&&e.code==='archive_mismatch');
});
test('再取込snapshotにない旧行を削除しない',async()=>{
 const f=await fixture([course(),course('missing')]),op=importOp(f.state,await archive([course('旧数学',2)]),[assignment(f.op.rows[0])]),s=await append(f.state,op);
 assert.deepEqual(s,oracle([f.op,op]));assert.equal(s.view.achievements.length,2);assert.equal(s.view.revisions.length,3);await roundtrip(s);
});
test('G01a結合：未知field/省略/null/0/内訳順をrawとDTOに保持',async()=>{
 const c=course();c.memo=null;c.schoolings[0].unknown=0;const a=await archive([c,course('other',0)],{privateUnknown:'synthetic'}),decoded=await decodeGradeSourceArchive(JSON.stringify(a)),s0=await createLedger(),op=importOp(s0,decoded),s=await append(s0,op);
 assert.deepEqual(s,oracle([op]));assert.equal(s.view.snapshots[0].archive.raw,a.raw);assert.equal(Object.hasOwn(s.view.revisions[0].record,'memo'),false);await roundtrip(s);
});
test('不正operation/JSON/未来版/objectを拒否、エラーはfixed code',async()=>{
 const f=await fixture(),op={...clone(f.op),operationId:mint('operation'),expectedTipSha256:f.state.tipSha256,kind:'delete_row',reason:'PRIVATE_MARKER'};await rejects(append(f.state,op),'shape');
 await rejects(appendOperation(JSON.stringify(f.state),'{"kind":'),'invalid_json');await rejects(createLedger({get raw(){throw Error('PRIVATE_MARKER');}}),'input_type');
 await rejects(verifyLedgerState(JSON.stringify({...f.state,contractVersion:'future'})),'version');
});
test('容量・event上限超過を拒否、partial成功を返さない',async()=>{
 await rejects(replayJournal(' '.repeat(LIMITS.jsonBytes+1)),'resource_limit');const s=await createLedger(),j=clone(s.journal);j.entries=Array(LIMITS.events+1).fill({});await rejects(replayJournal(JSON.stringify(j)),'resource_limit');
});
test('storage/network/clock/UUID/Workerアクセス0で決定的・入力不変',async()=>{
 const f=await fixture(),sraw=JSON.stringify(f.state),op=activateOp(f.state,f.op.rows[0]),oraw=JSON.stringify(op),saved=['localStorage','indexedDB','navigator','fetch','Worker'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
 const now=Date.now,uuid=crypto.randomUUID;let hits=0;for(const [k]of saved)Object.defineProperty(globalThis,k,{configurable:true,get(){hits++;throw Error('IO');}});Date.now=()=>{throw Error('clock');};crypto.randomUUID=()=>{throw Error('UUID');};
 try{const s=await appendOperation(sraw,oraw);assert.deepEqual(await appendOperation(sraw,oraw),s);assert.equal(sraw,JSON.stringify(f.state));assert.equal(oraw,JSON.stringify(op));assert.equal(hits,0);}
 finally{Date.now=now;crypto.randomUUID=uuid;for(const [k,d]of saved){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
});
test('G01a以外のauthority/Worker/保存依存なし',()=>{
 const text=readFileSync(new URL('../../src/planner/attempts/gradeImport/ledger.ts',import.meta.url),'utf8'),imports=[...text.matchAll(/from ['"]([^'"]+)['"]/g)].map(x=>x[1]);assert.deepEqual(imports,['./decimalPolicy','./sourceArchive','../../gradeImport/gradeImportContract','../jsonInput','../../digest']);
});

test('outer JSONの数値underflowをG01a再検証前に拒否する',async()=>{
 const s=await createLedger(),op=importOp(s,await archive([course('zero',0)]));
 const text=JSON.stringify(op).replace('"earnedCredits":{"raw":"0","value":0}','"earnedCredits":{"raw":"0","value":1e-999}');
 assert.notEqual(text,JSON.stringify(op));await rejects(appendOperation(JSON.stringify(s),text),'numeric_precision');
});

test('明示切替・別snapshot追加でも過去reserved/issued集合は順序付き延長',async()=>{
 const f=await fixture(),s=await append(f.state,activateOp(f.state,f.op.rows[0]));
 assert.deepEqual(s.issuedIds.slice(0,f.state.issuedIds.length),f.state.issuedIds);
 assert.deepEqual(s.reservedIds.slice(0,f.state.reservedIds.length),f.state.reservedIds);
 const op=importOp(s,await archive([course('new')])),next=await append(s,op);
 assert.deepEqual(next.reservedIds.slice(0,s.reservedIds.length),s.reservedIds);await roundtrip(next);
});
test('同一snapshotを再送しても原行の対応付替・省略を許さない',async()=>{
 const f=await fixture([course(),course('other')]),b={...clone(f.op),operationId:mint('operation'),expectedTipSha256:f.state.tipSha256};
 b.rows.reverse();await rejects(append(f.state,b),'snapshot_conflict');
 b.rows.pop();await rejects(append(f.state,b),'incomplete_snapshot');
});
test('未確認手動参照は同じ参照を複数保持できるが別役割UUIDと衝突しない',async()=>{
 const f=await fixture([course(),course('other')]),a=associateOp(f.state,f.op.rows[0]),s=await append(f.state,a),b=associateOp(s,f.op.rows[1],a.attemptId),next=await append(s,b);
 assert.equal(next.reservedIds.filter(x=>x===a.attemptId).length,1);assert.equal(next.view.associations.length,2);await roundtrip(next);
 const wrong=associateOp(f.state,f.op.rows[0],f.op.rows[0].revisionId.replace('g01b-revision','attempt'));await rejects(append(f.state,wrong),'id_collision');
});
test('必須内訳mapping欠損・不正ID・未知policyは拒否',async()=>{
 const f=await fixture();let b=clone(f.op);b.rows[0].details.pop();await rejects(append(f.empty,b),'incomplete_snapshot');
 b=clone(f.op);b.rows[0].revisionId='name-derived-id';await rejects(append(f.empty,b),'id_shape');
 b=clone(f.op);b.archive.policy.normalization='guessed';await assert.rejects(append(f.empty,b),e=>e instanceof SourceContractError&&e.code==='archive_mismatch');
});

test('旧namespaceの予約を制限として保持し、対応するUUIDの新規発行を拒否',async()=>{
 const modern=mint('revision'),legacy=modern.replace('hosei:g01b-revision:','hosei:owned:'),s=await createLedger(JSON.stringify([legacy]));
 assert.deepEqual(s,oracle([],[legacy]));assert.equal(s.issuedIds.length,0);
 const op=importOp(s,await archive());op.rows[0].revisionId=modern;await rejects(append(s,op),'id_collision');
 await rejects(createLedger(JSON.stringify([legacy,modern])),'id_collision');
});
