import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AdoptionError,prepareConfirmation,planAdoption,verifyAdoptionPlan,LIMITS} from '../../src/planner/attempts/gradeImport/adoption.ts';
import {LedgerError,verifyLedgerState,replayJournal,appendOperation} from '../../src/planner/attempts/gradeImport/ledger.ts';
import {PreviewError} from '../../src/planner/attempts/gradeImport/preview.ts';
import {archive,course,assignment,mint,importOp,activateOp,associateOp,append,floor,clone,digest,createLedger,json,context,baseline,choose,decide,plan,verify} from './adoptionFixture.mjs';
const reject=(p,code)=>assert.rejects(p,e=>e instanceof AdoptionError&&e.code===code&&e.message===code);
const rejectedPreview=p=>assert.rejects(p,e=>e instanceof PreviewError&&e.code==='stale_or_modified_preview');
const rejectedLedger=(p,code)=>assert.rejects(p,e=>e instanceof LedgerError&&e.code===code);
async function full(p,c,d) {
 assert.deepEqual(await verifyLedgerState(json(p.resultLedger),json(floor(c.s))),p.resultLedger);
 assert.deepEqual(await replayJournal(json(p.resultLedger.journal),json(floor(c.s))),p.resultLedger);
 assert.deepEqual(await verify(p,c,d),p);
 const{planSha256,...body}=p;assert.equal(planSha256,digest(body));
 assert.deepEqual(p.resultLedger.journal.entries.slice(0,c.s.journal.entries.length),c.s.journal.entries);
 assert.deepEqual(p.resultLedger.issuedIds.slice(0,c.s.issuedIds.length),c.s.issuedIds);
 assert.deepEqual(p.resultLedger.reservedIds.slice(0,c.s.reservedIds.length),c.s.reservedIds);
}
function frozen(v){if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));Object.values(v).forEach(frozen);}}

test('2024未照合原行を明示新規採用し、別操作でactivationする。全原文/DTO/slot順を保持',async()=>{
 const r=course('未照合過年度科目',4,'2024');r.unknown={raw:'keep'};const s=await createLedger(),a=await archive([r]),c=await context(a,s),d=await decide(c,choose(c,'new',true)),before=json(s),p=await plan(c,d);
 assert.equal(c.p.rows[0].resolution,'unmatched');assert.deepEqual(p.operations.map(o=>o.kind),['import_snapshot','activate_revision']);
 assert.equal(p.resultLedger.view.achievements.length,1);const ids=p.operations[0].rows[0];assert.equal(p.resultLedger.view.achievements[0].activeRevisionId,ids.revisionId);
 assert.equal(p.resultLedger.view.snapshots[0].archive.raw,a.raw);assert.deepEqual(p.resultLedger.view.revisions[0].record,a.dto.courses[0]);
 assert.deepEqual(p.resultLedger.view.detailRevisions.map(x=>x.record),[...a.dto.courses[0].reports,a.dto.courses[0].creditExam,...a.dto.courses[0].schoolings]);
 assert.equal(json(s),before);assert.equal(p.authorization.canCommit,false);assert.equal(p.authorization.idIssuance,'not-certified');frozen(p);await full(p,c,d);
});
test('確認対象はsnapshot/row/候補/全preview/digestへ束縛され、helperはconfirmedを発行しない',async()=>{
 const f=await baseline(),c=await context(await archive([course('旧数学',2,'2024')]),f.s),s=choose(c,'correction'),t=await prepareConfirmation(...c.args,json(s));
 assert.equal('confirmed' in t,false);assert.equal(t.saveAuthority,'not-issued');assert.equal(t.binding.archiveSha256,c.a.archiveSha256);
 const d=await decide(c,s);d.confirmation.rows[0].targetDigest='0'.repeat(64);await reject(plan(c,d),'confirmation_mismatch');
 const changed=await decide(c,s);changed.selection.rows[0].activate=true;changed.allocation.activations=[{rowIndex:0,operationId:mint('operation')}];await reject(plan(c,changed),'confirmation_mismatch');
});
test('確認なし/一部未確認/理由なしを拒否',async()=>{
 const c=await context(await archive(),await createLedger()),d=await decide(c);
 let b=clone(d);b.confirmation.confirmed=false;await reject(plan(c,b),'confirmation_required');
 b=clone(d);b.confirmation.rows[0].confirmed=false;await reject(plan(c,b),'confirmation_required');
 b=clone(d);b.confirmation.rows[0].reason=' ';await reject(plan(c,b),'shape');
});
test('同名同数量の2原行を別IDとして採用し、自動統合/数量再集計をしない',async()=>{
 const r=course(),a=await archive([r,r]),c=await context(a,await createLedger()),d=await decide(c),p=await plan(c,d);
 assert.equal(p.resultLedger.view.achievements.length,2);assert.notEqual(p.operations[0].rows[0].achievementId,p.operations[0].rows[1].achievementId);
 assert.deepEqual(p.resultLedger.view.revisions.map(x=>x.record),a.dto.courses);assert.deepEqual(p.resultLedger.view.achievements.map(x=>x.activeRevisionId),[null,null]);await full(p,c,d);
});
test('複数候補から明示選択。候補外achievement/revision/observationを拒否',async()=>{
 const f=await baseline([course('同名',4,'2024'),course('同名',4,'2023')]),c=await context(await archive([course('同名',2,'2025')]),f.s);assert.equal(c.p.rows[0].kind,'ambiguous');
 const selected=choose(c,'correction',false,1),d=await decide(c,selected),p=await plan(c,d);assert.equal(p.operations[0].rows[0].achievementId,selected.rows[0].candidate.achievementId);await full(p,c,d);
 for(const key of['achievementId','revisionId','observationId']){const bad=clone(selected);bad.rows[0].candidate[key]=mint(key==='achievementId'?'achievement':key==='revisionId'?'revision':'observation');await reject(prepareConfirmation(...c.args,json(bad)),'candidate_outside_preview');}
});
test('同一snapshotに2行を同じ既存achievementへ採用する多対一を拒否',async()=>{
 const f=await baseline([course()]),c=await context(await archive([course(),course()]),f.s),s=choose(c,'reimport');await reject(prepareConfirmation(...c.args,json(s)),'many_to_one');
});
test('4→2追加だけならhead4維持。同一snapshot再参照＋明示切替後だけhead2へ',async()=>{
 const f=await baseline(),a=await archive([course('旧数学',2,'2024')]),c=await context(a,f.s),d=await decide(c,choose(c,'correction',false)),p=await plan(c,d),s=p.resultLedger;
 assert.equal(p.operations.length,1);assert.equal(s.view.achievements[0].activeRevisionId,f.op.rows[0].revisionId);assert.deepEqual(s.view.revisions.map(r=>r.record.earnedCredits.value),[4,2]);assert.deepEqual(s.view.revisions[0],f.s.view.revisions[0]);
 await full(p,c,d);
 const next=await context(a,s),switchDecision=await decide(next,choose(next,'reuse_snapshot',true)),p2=await plan(next,switchDecision);
 assert.deepEqual(p2.operations.map(o=>o.kind),['import_snapshot','activate_revision']);assert.equal(p2.resultLedger.view.revisions.length,2);assert.equal(p2.resultLedger.view.achievements[0].activeRevisionId,p.operations[0].rows[0].revisionId);assert.equal(p2.resultLedger.view.revisions[0].record.earnedCredits.value,4);await full(p2,next,switchDecision);
});
test('訂正追加と切替を両方明示したbatchはimport→activateの順序で検証する',async()=>{
 const f=await baseline(),c=await context(await archive([course('旧数学',2,'2024')]),f.s),d=await decide(c,choose(c,'correction',true)),p=await plan(c,d);
 assert.deepEqual(p.operations.map(o=>o.kind),['import_snapshot','activate_revision']);assert.equal(p.resultLedger.view.achievements[0].activeRevisionId,p.operations[0].rows[0].revisionId);assert.deepEqual(p.resultLedger.view.revisions.map(x=>x.record.earnedCredits.value),[4,2]);await full(p,c,d);
});
test('旧revisionの切戻しを拒否。歴史的snapshotの参照のみはheadを変更しない',async()=>{
 const f=await baseline(),c=await context(await archive([course('旧数学',2,'2024')]),f.s),d=await decide(c,choose(c,'correction',true)),p=await plan(c,d);
 const old=await context(f.op.archive,p.resultLedger),bad=choose(old,'reuse_snapshot',true);await reject(prepareConfirmation(...old.args,json(bad)),'historical_candidate');
 const okay=await decide(old,choose(old,'reuse_snapshot',false)),q=await plan(old,okay);assert.equal(q.resultLedger.view.achievements[0].activeRevisionId,p.resultLedger.view.achievements[0].activeRevisionId);assert.equal(q.resultLedger.view.revisions.length,2);await full(q,old,okay);
 const fresh=await context(await archive([course('旧数学',4,'2024')],{capturedAt:'2026-11-04T00:00:00Z'}),p.resultLedger),select=choose(fresh,'reimport');select.rows[0].candidate={achievementId:f.op.rows[0].achievementId,revisionId:f.op.rows[0].revisionId,observationId:f.op.rows[0].observationId};await reject(prepareConfirmation(...fresh.args,json(select)),'historical_candidate');
});
test('同一snapshot再取込はreceiptだけで原行/内訳/数量/論理IDを増やさない',async()=>{
 const f=await baseline(),c=await context(f.op.archive,f.s),d=await decide(c,choose(c,'reuse_snapshot')),p=await plan(c,d);
 assert.equal(d.allocation.rows.length,0);assert.deepEqual(p.resultLedger.view,f.s.view);assert.equal(p.resultLedger.journal.entries.length,f.s.journal.entries.length+1);assert.equal(p.resultLedger.issuedIds.length,f.s.issuedIds.length+1);await full(p,c,d);
});
test('同じbatchを元contextで計画し直すと全値一致。既生成operationの同payload再送はG01b no-op',async()=>{
 const c=await context(await archive(),await createLedger()),d=await decide(c,choose(c,'new',true)),p=await plan(c,d);assert.deepEqual(await plan(c,d),p);
 let s=p.resultLedger;for(const op of p.operations)s=await appendOperation(json(s),json(op),json(floor(p.resultLedger)));assert.deepEqual(s,p.resultLedger);
 const changed=clone(p.operations[0]);changed.rows[0].observationId=mint('observation');await rejectedLedger(appendOperation(json(s),json(changed)),'operation_conflict');
});
test('同じ操作IDをfresh replanで別payloadに使い直せない',async()=>{
 const f=await baseline(),c=await context(f.op.archive,f.s),d=await decide(c,choose(c,'reuse_snapshot')),p=await plan(c,d),next=await context(f.op.archive,p.resultLedger),other=await decide(next,choose(next,'reuse_snapshot'));other.allocation.importOperationId=d.allocation.importOperationId;
 await rejectedLedger(plan(next,other),'operation_conflict');
});
test('異なるsnapshotの同DTO再取込は同じlogicalへ新観測revision、別logicalや自動activationではない',async()=>{
 const f=await baseline(),a=await archive([course('旧数学',4,'2024')],{capturedAt:'2026-11-04T00:00:00Z'}),c=await context(a,f.s),d=await decide(c,choose(c,'reimport')),p=await plan(c,d);
 assert.equal(p.resultLedger.view.achievements.length,1);assert.equal(p.resultLedger.view.revisions.length,2);assert.deepEqual(p.resultLedger.view.revisions.map(x=>x.record.earnedCredits.value),[4,4]);assert.equal(p.resultLedger.view.achievements[0].activeRevisionId,f.op.rows[0].revisionId);await full(p,c,d);
});
for(const q of[null,0,4])test(`公式${q}とmanual2 marker/未確認associationが混在しても元量を補完しない`,async()=>{
 const f=await baseline([course('mixed',q)]),s=await append(f.s,associateOp(f.s,f.op.rows[0])),a=await archive([course('mixed',q)],{manualContribution:2}),c=await context(a,s),d=await decide(c,choose(c,'reimport',true)),p=await plan(c,d);
 assert.deepEqual(p.resultLedger.view.associations,s.view.associations);assert.equal(p.resultLedger.view.associations[0].status,'unverified');assert.deepEqual(p.resultLedger.view.revisions.map(r=>r.record.earnedCredits.value),[q,q]);assert.equal(JSON.parse(p.resultLedger.view.snapshots.at(-1).archive.raw).manualContribution,2);await full(p,c,d);
});
test('preview後ledger更新・候補集合追加・floor更新は旧preview/確認対象を拒否',async()=>{
 const f=await baseline(),c=await context(await archive([course('旧数学',2,'2024')]),f.s),d=await decide(c,choose(c,'correction'));
 const op=importOp(f.s,await archive([course('旧数学',4,'2020')])),s=await append(f.s,op);await rejectedPreview(planAdoption(c.args[0],c.args[1],json(s),json(floor(s)),json(d)));
 const prettyFloor=JSON.stringify(c.f,null,2);await rejectedPreview(planAdoption(c.args[0],c.args[1],c.args[2],prettyFloor,json(d)));
 const seed=mint('revision'),s2=await createLedger(json([seed]));await assert.rejects(planAdoption(c.args[0],c.args[1],json(s2),json(floor(f.s)),json(d)),e=>e instanceof LedgerError&&e.code==='reservation_shrink');
});
test('fresh previewを用意しても旧confirmationはsnapshot/候補/activateへ付替えできない',async()=>{
 const f=await baseline([course('same'),course('same')]),c=await context(await archive([course('same',2)]),f.s),s=choose(c,'correction',false,0),d=await decide(c,s);
 let b=clone(d);b.selection.rows[0].candidate=choose(c,'correction',false,1).rows[0].candidate;await reject(plan(c,b),'confirmation_mismatch');
 b=clone(d);b.selection.targetSnapshotId=mint('snapshot');await reject(plan(c,b),'confirmation_mismatch');
 b=clone(d);b.selection.rows[0].activate=true;b.allocation.activations=[{rowIndex:0,operationId:mint('operation')}];await reject(plan(c,b),'confirmation_mismatch');
});
test('同一snapshot IDを新規snapshotや新規原行扱いへ付替えできない',async()=>{
 const f=await baseline(),c=await context(f.op.archive,f.s),s=choose(c,'reuse_snapshot');s.targetSnapshotId=mint('snapshot');await reject(prepareConfirmation(...c.args,json(s)),'snapshot_target_conflict');
 const n=choose(c,'new');await reject(prepareConfirmation(...c.args,json(n)),'decision_kind_mismatch');
});
test('reimport/correction種別をDTO変化の有無と食い違わせない',async()=>{
 const f=await baseline(),a=await archive([course('旧数学',2,'2024')]),c=await context(a,f.s);await reject(prepareConfirmation(...c.args,json(choose(c,'reimport'))),'decision_kind_mismatch');
 const same=await context(await archive([course('旧数学',4,'2024')],{extra:true}),f.s);await reject(prepareConfirmation(...same.args,json(choose(same,'correction'))),'decision_kind_mismatch');
});
test('全行明示判断が必須。省略/順序変更/部分採用を拒否',async()=>{
 const c=await context(await archive([course(),course('other')]),await createLedger()),d=await decide(c);
 let b=clone(d);b.selection.rows.pop();await reject(plan(c,b),'shape');
 b=clone(d);b.selection.rows.reverse();await reject(plan(c,b),'shape');
 b=clone(d);b.selection.rows[0].action='defer';await reject(plan(c,b),'shape');
});
test('同一snapshot内の新ID衝突は成功結果を返さず元ledger/全入力不変',async()=>{
 const c=await context(await archive([course(),course()]),await createLedger()),d=await decide(c),bad=clone(d),saved=json(c.s),args=c.args.slice();bad.allocation.rows[1].achievementId=bad.allocation.rows[0].achievementId;
 let returned;await rejectedLedger((async()=>{returned=await plan(c,bad);})(),'id_collision');assert.equal(returned,undefined);assert.equal(json(c.s),saved);assert.deepEqual(c.args,args);assert.deepEqual(await verifyLedgerState(saved),c.s);
});
test('import後のactivation ID衝突でも部分適用を外部へ返さない',async()=>{
 const c=await context(await archive(),await createLedger()),d=await decide(c,choose(c,'new',true)),saved=json(c.s);d.allocation.activations[0].operationId=d.allocation.importOperationId;
 let returned;await rejectedLedger((async()=>{returned=await plan(c,d);})(),'operation_conflict');assert.equal(returned,undefined);assert.equal(json(c.s),saved);assert.deepEqual(c.s.view.revisions,[]);assert.deepEqual(c.s.issuedIds,[]);
});
test('既存候補のlogical/detail IDをallocationで上書きできない',async()=>{
 const f=await baseline(),c=await context(await archive([course('旧数学',2,'2024')]),f.s),d=await decide(c,choose(c,'correction'));
 let b=clone(d);b.allocation.rows[0].achievementId=mint('achievement');await reject(plan(c,b),'allocation_shape');
 b=clone(d);b.allocation.rows[0].details[0].detailId=mint('detail');await reject(plan(c,b),'allocation_shape');
});
test('任意指定IDは構造検証されるが発行済み/保存資格へ昇格しない',async()=>{
 const c=await context(await archive(),await createLedger()),d=await decide(c);let b=clone(d);b.allocation.mode='native-issued';await reject(plan(c,b),'allocation_shape');
 b=clone(d);b.allocation.rows[0].revisionId='name-derived';await rejectedLedger(plan(c,b),'id_shape');
 const p=await plan(c,d);assert.equal(p.authorization.idIssuance,'not-certified');assert.equal(p.authorization.burn,'not-performed');assert.equal(p.authorization.floorAuthenticity,'not-certified');assert.equal(p.authorization.saveAuthority,'not-issued');
});
test('結果planの操作/全view/予約/確認対象改ざんはhash再計算後も拒否',async()=>{
 const c=await context(await archive(),await createLedger()),d=await decide(c,choose(c,'new',true)),p=await plan(c,d);
 for(const mutate of[b=>{b.operations.reverse();},b=>{b.resultLedger.view.revisions[0].record.earnedCredits.value=999;},b=>{b.resultLedger.reservedIds.pop();},b=>{b.decision.confirmation.rows[0].targetDigest='0'.repeat(64);}]){
 const b=clone(p);mutate(b);const{planSha256,...body}=b;b.planSha256=digest(body);await reject(verify(b,c,d),'plan_mismatch');}
});
test('原文unknown・null/0/省略・内訳/原行順と、snapshotにない旧行をすべて保持',async()=>{
 const old=await baseline([course('remain'),course('missing')]),r=course('remain',2);r.extra=null;r.schoolings[1].extra=0;r.reports.reverse();const a=await archive([r],{unknown:['keep',null,0]}),c=await context(a,old.s),d=await decide(c,choose(c,'correction')),p=await plan(c,d);
 assert.equal(p.resultLedger.view.achievements.length,2);assert.deepEqual(p.resultLedger.view.revisions.slice(0,old.s.view.revisions.length),old.s.view.revisions);assert.deepEqual(p.resultLedger.view.revisions.at(-1).record,a.dto.courses[0]);assert.equal(p.resultLedger.view.snapshots.at(-1).archive.raw,a.raw);assert.equal(Object.hasOwn(p.resultLedger.view.revisions.at(-1).record,'extra'),false);await full(p,c,d);
});
test('R-01拒否を迂回しない：不正preview/candidate/資格fieldを付け足しても採用不可',async()=>{
 const c=await context(await archive(),await createLedger()),d=await decide(c),bad=clone(c.p);bad.authorization.canCommit=true;await rejectedPreview(planAdoption(json(bad),...c.args.slice(1),json(d)));
 const b=clone(d);b.saveAuthority='issued';await reject(plan(c,b),'shape');
});
test('object入力getterは読まず、数値情報損失/重複key/容量超過を拒否',async()=>{
 const c=await context(await archive(),await createLedger()),d=await decide(c);let reads=0;const obj={get selection(){reads++;throw Error('PRIVATE');}};await reject(planAdoption(...c.args,obj),'input_type');assert.equal(reads,0);
 const text=json(d).replace('"rowIndex":0','"rowIndex":1e-999');await reject(planAdoption(...c.args,text),'invalid_json');
 await reject(planAdoption(...c.args,'{"selection":1,"selection":2}'),'invalid_json');await reject(planAdoption(...c.args,' '.repeat(LIMITS.jsonBytes+1)),'resource_limit');
});
test('計画・確認対象生成はstorage/network/UUID/clockにアクセス0',async()=>{
 const c=await context(await archive(),await createLedger()),s=choose(c,'new',true),d=await decide(c,s),before=c.args.slice(),keys=['localStorage','sessionStorage','indexedDB','navigator','fetch','Worker','WebSocket','BroadcastChannel'],saved=keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]),now=Date.now,uuid=crypto.randomUUID;let hits=0;
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,get(){hits++;throw Error('IO');}});Date.now=()=>{throw Error('clock');};crypto.randomUUID=()=>{throw Error('UUID');};
 try{await prepareConfirmation(...c.args,json(s));const p=await plan(c,d);await verify(p,c,d);assert.equal(hits,0);assert.deepEqual(c.args,before);assert.deepEqual(c.s.issuedIds,[]);}
 finally{Date.now=now;crypto.randomUUID=uuid;for(const[k,x]of saved){if(x)Object.defineProperty(globalThis,k,x);else delete globalThis[k];}}
});
test('本実装は固定済みpure契約だけをimportし、host/Workerを書き換えない',()=>{
 const source=readFileSync(new URL('../../src/planner/attempts/gradeImport/adoption.ts',import.meta.url),'utf8'),imports=[...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(x=>x[1]);assert.deepEqual(imports,['./preview','./ledger','./decimalPolicy','../jsonInput','../../digest','./sourceArchive']);assert.ok(!imports.some(x=>/persistence|indexedDb|worker/.test(x)));
});

test('同内容2行でも確認digestはrowIndexごとに異なり、別行へコピーできない',async()=>{
 const r=course(),c=await context(await archive([r,r]),await createLedger()),d=await decide(c);
 assert.notEqual(d.confirmation.rows[0].targetDigest,d.confirmation.rows[1].targetDigest);
 d.confirmation.rows[1].targetDigest=d.confirmation.rows[0].targetDigest;await reject(plan(c,d),'confirmation_mismatch');
});
test('source更新と実値のfloor更新は、fresh previewでも旧confirmationを無効にする',async()=>{
 const f=await baseline(),a=await archive([course('旧数学',2,'2024')]),c=await context(a,f.s,{issuedIds:[],reservedIds:[]}),d=await decide(c,choose(c,'correction'));
 await rejectedPreview(planAdoption(c.args[0],c.args[1],c.args[2],json(floor(f.s)),json(d)));
 const updatedFloor=await context(a,f.s,floor(f.s));await reject(plan(updatedFloor,d),'confirmation_mismatch');
 const changed=await archive([course('旧数学',2,'2024')],{rawUnknown:'changed'}),updatedSource=await context(changed,f.s,{issuedIds:[],reservedIds:[]});await reject(plan(updatedSource,d),'confirmation_mismatch');
});
test('複数activationの後段失敗も中間headや部分ledgerを返さない',async()=>{
 const c=await context(await archive([course(),course('second')]),await createLedger()),d=await decide(c,choose(c,'new',true)),before=json(c.s);
 d.allocation.activations[1].operationId=d.allocation.activations[0].operationId;
 let result;await assert.rejects((async()=>{result=await plan(c,d);})(),e=>e instanceof LedgerError&&e.code==='operation_conflict'&&!('resultLedger'in e));
 assert.equal(result,undefined);assert.equal(json(c.s),before);assert.deepEqual(c.s.view.achievements,[]);
});
test('独立R-01の旧生成previewはG02b経由でも深さ検証を迂回できない',async()=>{
 const input=JSON.parse(readFileSync(new URL('./fixtures/r01-depth-inputs.json',import.meta.url),'utf8'));
 assert.equal(Buffer.byteLength(input.archive.raw),1504);assert.equal(Buffer.byteLength(json(input.preview)),7955);
 const args=[input.preview,input.archive,input.ledger,input.floor].map(json),before=args.slice();
 await assert.rejects(prepareConfirmation(...args,'{}'),e=>e instanceof PreviewError&&e.code==='invalid_preview_json');assert.deepEqual(args,before);
});
