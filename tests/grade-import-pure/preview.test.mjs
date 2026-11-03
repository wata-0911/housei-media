import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewImport,verifyImportPreview,PreviewError,LIMITS} from '../../src/planner/attempts/gradeImport/preview.ts';
import {createLedger,verifyLedgerState,LedgerError} from '../../src/planner/attempts/gradeImport/ledger.ts';
import {SourceContractError,createGradeSourceArchive} from '../../src/planner/attempts/gradeImport/sourceArchive.ts';
import {archive,course,assignment,importOp,activateOp,associateOp,append,clone,floor,digest,rehash,mint} from './ledgerFixture.mjs';
const json=JSON.stringify;
const preview=(a,s,f=floor(s))=>previewImport(json(a),json(s),json(f));
const verify=(p,a,s,f=floor(s))=>verifyImportPreview(json(p),json(a),json(s),json(f));
const rejects=(task,c)=>assert.rejects(task,e=>e instanceof PreviewError&&e.code===c&&e.message===c);
async function fixture(rows=[course('旧数学',4,'2024')]){const empty=await createLedger(),op=importOp(empty,await archive(rows));return {empty,op,state:await append(empty,op)};}
function freeze(v){if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));Object.values(v).forEach(freeze);}}
const binding=(a,s,f=floor(s))=>({archiveSha256:a.archiveSha256,rawSha256:a.rawSha256,ledgerSha256:digest(s),ledgerTipSha256:s.tipSha256,minimumIdsRawSha256:rawHash(json(f))});
// Independent raw SHA (not the production helper).
import {createHash} from 'node:crypto';
function rawHash(text){return createHash('sha256').update(text,'utf8').digest('hex');}
const authorization={kind:'preview-only',journalDeclaration:'not-created',saveAuthority:'not-issued',canCommit:false};
const fields=(path,before,after)=>({path,before:{present:true,value:before},after:{present:true,value:after}});
function withHash(body){return {...body,previewSha256:digest(body)};}
function rehashPreview(p){const {previewSha256,...body}=p;return withHash(body);}

test('空ledger＋2024公式4・Offeringなし：全fieldの独立期待値と一致',async()=>{
 const s=await createLedger(),a=await archive([course('2026Offeringにない過年度科目',4,'2024')]),p=await preview(a,s);
 const expected=withHash({format:'hosei-g02a-preview-prototype',contractVersion:'0.1.0-prototype',policy:'literal-name-candidates/all-revisions/no-identity-confirmation/v1-prototype',
 binding:binding(a,s),sourceArchive:clone(a),snapshotStatus:'new_snapshot',matchingSnapshotIds:[],rows:[{rowIndex:0,record:clone(a.dto.courses[0]),kind:'new_row',suggestion:'new_row',resolution:'unmatched',identicalIncomingRowIndexes:[],conflicts:[],candidates:[],selectedAchievementId:null,requiresExplicitDecision:true}],existingCoverage:[],authorization});
 assert.deepEqual(p,expected);freeze(p);assert.deepEqual(await verify(p,a,s),p);
});
test('公式4→2は訂正候補のみ：全差分・元量・head不変と独立full oracle',async()=>{
 const f=await fixture(),activate=activateOp(f.state,f.op.rows[0]),s=await append(f.state,activate),a=await archive([course('旧数学',2,'2024')]),before=json(s),p=await preview(a,s);
 const r=f.op.rows[0],changes=[fields('/earnedCredits/raw','4','2'),fields('/earnedCredits/value',4,2)];
 const candidate={achievementId:r.achievementId,revisionId:r.revisionId,observationId:r.observationId,
 sourceRef:{snapshotId:f.op.snapshotId,rowIndex:0,archiveSha256:f.op.archive.archiveSha256,rawSha256:f.op.archive.rawSha256},
 currentLatestRevisionId:r.revisionId,currentActiveRevisionId:r.revisionId,isLatest:true,isActive:true,sameRecord:false,evidence:'literal_name_only',identity:'unverified',before:clone(f.op.archive.dto.courses[0]),recordChanges:changes,sourceRowChanges:changes,sourceMetadataChanges:[],manualAssociations:[]};
 assert.deepEqual(p,withHash({format:'hosei-g02a-preview-prototype',contractVersion:'0.1.0-prototype',policy:'literal-name-candidates/all-revisions/no-identity-confirmation/v1-prototype',binding:binding(a,s),sourceArchive:clone(a),snapshotStatus:'new_snapshot',matchingSnapshotIds:[],
 rows:[{rowIndex:0,record:clone(a.dto.courses[0]),kind:'correction_candidate',suggestion:'correction_candidate',resolution:'unverified',identicalIncomingRowIndexes:[],conflicts:[],candidates:[candidate],selectedAchievementId:null,requiresExplicitDecision:true}],
 existingCoverage:[{achievementId:r.achievementId,latestRevisionId:r.revisionId,activeRevisionId:r.revisionId,status:'candidate_only',deleteRecommended:false}],authorization}));
 assert.equal(json(s),before);assert.equal(s.view.achievements[0].activeRevisionId,r.revisionId);assert.equal(s.view.revisions[0].record.earnedCredits.value,4);await verify(p,a,s);
});
test('同一原文snapshot再取込は位置根拠を示し、journal/予約を変えない',async()=>{
 const f=await fixture(),before=json(f.state),p=await preview(f.op.archive,f.state);
 assert.equal(p.snapshotStatus,'same_snapshot');assert.deepEqual(p.matchingSnapshotIds,[f.op.snapshotId]);assert.equal(p.rows[0].kind,'same_snapshot');
 assert.equal(p.rows[0].candidates[0].evidence,'same_snapshot_position');assert.equal(p.rows[0].resolution,'snapshot_observation_only');assert.equal(json(f.state),before);
 assert.equal(p.authorization.canCommit,false);await verify(p,f.op.archive,f.state);
});
test('旧snapshot4を再表示しても訂正済みactive2を4へ戻さない',async()=>{
 const f=await fixture(),oldAct=activateOp(f.state,f.op.rows[0]),s1=await append(f.state,oldAct),next=importOp(s1,await archive([course('旧数学',2,'2024')]),[assignment(f.op.rows[0])]),s2=await append(s1,next),s3=await append(s2,activateOp(s2,next.rows[0]));
 const p=await preview(f.op.archive,s3);assert.equal(p.rows[0].kind,'same_snapshot');assert.ok(p.rows[0].conflicts.includes('historical_match'));assert.ok(p.rows[0].conflicts.includes('active_differs_from_observation'));assert.equal(s3.view.achievements[0].activeRevisionId,next.rows[0].revisionId);
 assert.equal(p.rows[0].selectedAchievementId,null);await verify(p,f.op.archive,s3);
});
test('DTO同一・取得時刻だけ別のsnapshotは再取込候補でidentity未確認',async()=>{
 const f=await fixture(),a=await archive([course('旧数学',4,'2024')],{capturedAt:'2026-11-03T01:00:00Z'}),p=await preview(a,f.state);
 assert.equal(p.snapshotStatus,'new_snapshot');assert.equal(p.rows[0].kind,'reimport_candidate');assert.equal(p.rows[0].candidates[0].evidence,'same_full_dto_only');assert.equal(p.rows[0].candidates[0].identity,'unverified');
 assert.ok(p.rows[0].candidates[0].sourceMetadataChanges.some(x=>x.path==='/capturedAt'));assert.equal(p.rows[0].selectedAchievementId,null);
});
test('同名・同単位でも別履修行の2候補は曖昧、先頭候補を確定しない',async()=>{
 const f=await fixture([course('同名',4,'2024'),course('同名',4,'2023')]),a=await archive([course('同名',4,'2025')]),p=await preview(a,f.state);
 assert.equal(p.rows[0].kind,'ambiguous');assert.equal(p.rows[0].candidates.length,2);assert.ok(p.rows[0].conflicts.includes('multiple_achievements'));assert.ok(p.rows[0].conflicts.includes('year_context_differs'));assert.equal(p.rows[0].selectedAchievementId,null);
});
test('空ledgerに同じ行が2回あるsnapshotも二行のまま保持',async()=>{
 const s=await createLedger(),r=course(),a=await archive([r,r]),p=await preview(a,s);
 assert.equal(p.rows.length,2);assert.deepEqual(p.rows.map(r=>r.identicalIncomingRowIndexes),[[1],[0]]);assert.deepEqual(p.rows.map(r=>r.kind),['new_row','new_row']);assert.deepEqual(p.rows[0].record,p.rows[1].record);assert.deepEqual(s.issuedIds,[]);
});
test('2 incoming行が同じ既存原行を候補にする場合は多対一競合を出す',async()=>{
 const r=course(),f=await fixture([r]),a=await archive([r,r]),p=await preview(a,f.state);
 assert.deepEqual(p.rows.map(x=>x.kind),['ambiguous','ambiguous']);assert.ok(p.rows.every(x=>x.conflicts.includes('shared_candidate')));assert.equal(f.state.view.achievements.length,1);
});
test('重複2行の同一snapshotは位置ごとの別観測を参照し統合しない',async()=>{
 const r=course(),f=await fixture([r,r]),p=await preview(f.op.archive,f.state);
 assert.ok(p.rows.every(r=>r.kind==='same_snapshot'));assert.deepEqual(p.rows.map(r=>r.candidates[0].achievementId),f.op.rows.map(r=>r.achievementId));
});
for(const q of [null,0,4])test(`公式${q}＋未確認manual参照／原文のmanual2を加算しない`,async()=>{
 const f=await fixture([course('mixed',q)]),link=associateOp(f.state,f.op.rows[0]),s=await append(f.state,link),a=await archive([course('mixed',q)],{manualContribution:2}),p=await preview(a,s),c=p.rows[0].candidates[0];
 assert.equal(p.rows[0].record.earnedCredits.value,q);assert.equal(c.before.earnedCredits.value,q);assert.equal(c.manualAssociations[0].status,'unverified');assert.equal(JSON.parse(p.sourceArchive.raw).manualContribution,2);assert.equal('manualContribution' in p.rows[0].record,false);
 assert.equal('totalCredits' in p,false);assert.equal(p.rows[0].selectedAchievementId,null);assert.equal(json(s.view.revisions),json(f.state.view.revisions));
});
test('新snapshotから消えた既存原行も「未観測」で削除推奨しない',async()=>{
 const f=await fixture([course('残る'),course('消えた')]),a=await archive([course('残る',2)]),before=json(f.state),p=await preview(a,f.state),missing=p.existingCoverage.find(x=>x.achievementId===f.op.rows[1].achievementId);
 assert.equal(missing.status,'not_seen_by_policy');assert.equal(missing.deleteRecommended,false);assert.equal(json(f.state),before);assert.equal(p.authorization.journalDeclaration,'not-created');
});
test('公式4を持つ状態へ未照合行を追加しても元量・headは不変',async()=>{
 const f=await fixture(),s=await append(f.state,activateOp(f.state,f.op.rows[0])),before=json(s),a=await archive([course('未照合科目',2,'2020')]),p=await preview(a,s);
 assert.equal(p.rows[0].kind,'new_row');assert.equal(p.rows[0].resolution,'unmatched');assert.equal(s.view.revisions[0].record.earnedCredits.value,4);assert.equal(json(s),before);
});
test('unknownの省略/null/0差分はpresenceで区別、原文・内訳順も保持',async()=>{
 const r=course();r.reports[0].unknown=0;const f=await fixture([r]),incoming=course();incoming.memo=null;incoming.reports[0].unknown=null;incoming.schoolings.reverse();const a=await archive([incoming]),p=await preview(a,f.state),c=p.rows[0].candidates[0];
 assert.deepEqual(c.sourceRowChanges.find(x=>x.path==='/memo'),{path:'/memo',before:{present:false},after:{present:true,value:null}});
 assert.deepEqual(c.sourceRowChanges.find(x=>x.path==='/reports/0/unknown'),fields('/reports/0/unknown',0,null));assert.equal(p.sourceArchive.raw,a.raw);assert.deepEqual(p.rows[0].record.schoolings,a.dto.courses[0].schoolings);
 assert.equal('memo' in p.rows[0].record,false);assert.ok(c.recordChanges.some(x=>x.path.startsWith('/schoolings/0/')));
});
test('候補順は明示IDで安定：ledgerの元行順を候補優先順位へ転用しない',async()=>{
 const s=await createLedger(),a=await archive([course('same'),course('same')]),rows=[assignment(),assignment()].reverse(),op=importOp(s,a,rows),ledger=await append(s,op),fresh=await archive([course('same')],{capturedAt:'2026-11-04T00:00:00Z'}),p=await preview(fresh,ledger);
 assert.deepEqual(p.rows[0].candidates.map(c=>c.achievementId),rows.map(r=>r.achievementId).sort());assert.equal(p.rows[0].kind,'ambiguous');assert.equal(p.rows[0].selectedAchievementId,null);
});
test('候補順・集合の改ざんはpreview hash再計算後も拒否',async()=>{
 const f=await fixture([course(),course()]),a=await archive([course()],{capturedAt:'2026-11-04T00:00:00Z'}),p=await preview(a,f.state);
 const reordered=clone(p);reordered.rows[0].candidates.reverse();await rejects(verify(rehashPreview(reordered),a,f.state),'stale_or_modified_preview');
 const missing=clone(p);missing.rows[0].candidates.pop();await rejects(verify(rehashPreview(missing),a,f.state),'stale_or_modified_preview');
});
test('候補集合を増やしたledgerには旧previewを流用できない',async()=>{
 const f=await fixture(),a=await archive([course('旧数学',2,'2024')]),p=await preview(a,f.state),op=importOp(f.state,await archive([course('旧数学',4,'2020')])),s=await append(f.state,op);
 const next=await preview(a,s);assert.equal(next.rows[0].kind,'ambiguous');assert.notEqual(next.binding.ledgerSha256,p.binding.ledgerSha256);await rejects(verify(p,a,s),'stale_or_modified_preview');
});
test('反復・取消（結果破棄）・source変更はledger/journal/全IDを変更しない',async()=>{
 const f=await fixture(),a=await archive([course('旧数学',2,'2024')]),before=json(f.state),p=await preview(a,f.state);assert.deepEqual(await preview(a,f.state),p);
 await preview(await archive([course('別原行')]),f.state);assert.equal(json(f.state),before);assert.deepEqual(await verifyLedgerState(before),f.state);
 const changed=await archive([course('旧数学',0,'2024')]);await rejects(verify(p,changed,f.state),'stale_or_modified_preview');assert.equal(json(f.state),before);
});
test('ledger materialization改ざんを拒否',async()=>{
 const f=await fixture(),a=await archive();for(const mutate of [s=>{s.view.revisions[0].record.earnedCredits.value=99;},s=>{s.view.revisions[0].observationId=mint('observation');},s=>{s.reservedIds.pop();}]){
 const b=clone(f.state);mutate(b);await assert.rejects(preview(a,b,floor(f.state)),e=>e instanceof LedgerError&&e.code==='state_mismatch');}
});
test('既知floorがある時、validな旧prefix/seedへの差替えでも予約・発行縮小を拒否',async()=>{
 const f=await fixture(),a=await archive();await assert.rejects(preview(a,f.empty,floor(f.state)),e=>e instanceof LedgerError&&e.code==='reservation_shrink');
 const seed=await createLedger(json(f.state.reservedIds));await assert.rejects(preview(a,seed,floor(f.state)),e=>e instanceof LedgerError&&e.code==='issuance_shrink');
 await rejects(previewImport(json(a),json(f.state),undefined),'input_type');
});
test('旧revisionの前参照を改ざんしたjournalは再hashしても拒否',async()=>{
 const f=await fixture(),op=importOp(f.state,await archive([course('旧数学',2,'2024')]),[assignment(f.op.rows[0])]),s=await append(f.state,op),bad=clone(s);
 bad.journal.entries[1].operation.rows[0].previousRevisionId=null;rehash(bad.journal);
 await assert.rejects(preview(await archive(),bad,floor(s)),e=>e instanceof LedgerError&&e.code==='revision_predecessor');
});
test('G01a raw/DTO不一致・不正数値のarchiveを拒否',async()=>{
 const s=await createLedger(),a=await archive([course('zero',0)]),b=clone(a);b.dto.courses[0].earnedCredits.value=4;
 await assert.rejects(preview(b,s),e=>e instanceof SourceContractError&&e.code==='archive_mismatch');
 const text=json(a).replace('"earnedCredits":{"raw":"0","value":0}','"earnedCredits":{"raw":"0","value":1e-999}');await assert.rejects(previewImport(text,json(s),json(floor(s))),e=>e instanceof SourceContractError&&e.code==='numeric_precision');
});
test('previewに保存資格・operation宣言を偽装しても検証成功しない',async()=>{
 const f=await fixture(),a=await archive(),p=await preview(a,f.state),b=clone(p);b.authorization.canCommit=true;
 await rejects(verify(rehashPreview(b),a,f.state),'stale_or_modified_preview');
 const c=clone(p);c.operationId=mint('operation');await rejects(verify(rehashPreview(c),a,f.state),'stale_or_modified_preview');
});
test('preview JSON duplicate key/数値underflow・上限超過を拒否',async()=>{
 const f=await fixture([course('zero',0)]),a=await archive([course('zero',0)],{capturedAt:'2026-11-04T00:00:00Z'}),p=await preview(a,f.state);
 const text=json(p).replace('"earnedCredits":{"raw":"0","value":0}','"earnedCredits":{"raw":"0","value":1e-999}');await rejects(verifyImportPreview(text,json(a),json(f.state),json(floor(f.state))),'invalid_preview_json');
 await rejects(verifyImportPreview('{"format":1,"format":1}',json(a),json(f.state),json(floor(f.state))),'invalid_preview_json');
 await rejects(verifyImportPreview(' '.repeat(LIMITS.jsonBytes+1),json(a),json(f.state),json(floor(f.state))),'resource_limit');
});
test('候補edge超過は明示拒否、勝手に先頭候補だけを返さない',async()=>{
 const r=course('many'),f=await fixture(Array.from({length:33},()=>r)),a=await archive(Array.from({length:33},()=>r),{capturedAt:'2026-11-04T00:00:00Z'}),before=json(f.state);
 await rejects(preview(a,f.state),'resource_limit');assert.equal(json(f.state),before);
});
test('objectのgetter等は読まずprimitive textだけ受ける',async()=>{
 let hits=0;const x={get raw(){hits++;throw Error('PRIVATE');}};await rejects(previewImport(x,'{}','{}'),'input_type');assert.equal(hits,0);
});
test('storage/network/Worker/clock/UUIDにアクセス0、入力・ID予約不変',async()=>{
 const f=await fixture(),a=await archive([course('旧数学',2,'2024')]),before=json(f.state),saved=['localStorage','sessionStorage','indexedDB','navigator','fetch','Worker'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]),now=Date.now,uuid=crypto.randomUUID;let hits=0;
 for(const[k]of saved)Object.defineProperty(globalThis,k,{configurable:true,get(){hits++;throw Error('IO');}});Date.now=()=>{throw Error('clock');};crypto.randomUUID=()=>{throw Error('UUID');};
 try{const p=await preview(a,f.state);await verify(p,a,f.state);assert.equal(hits,0);assert.equal(json(f.state),before);}
 finally{Date.now=now;crypto.randomUUID=uuid;for(const[k,d]of saved){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
});
test('G01b公開APIの読取検証だけに依存し、append/host/Workerをimportしない',()=>{
 const text=readFileSync(new URL('../../src/planner/attempts/gradeImport/preview.ts',import.meta.url),'utf8');assert.ok(!/import[^;]*\bappendOperation\b/.test(text));assert.ok(!/from ['"][^'"]*(?:persistence|worker|indexedDb)/.test(text));
});

test('DTOが同じでもrawの未知fieldが違う2原行を同一内容と表示しない',async()=>{
 const first=course(),second=course();first.sourceRowMarker='A';second.sourceRowMarker='B';
 const s=await createLedger(),a=await archive([first,second]),p=await preview(a,s);
 assert.deepEqual(p.rows.map(r=>r.identicalIncomingRowIndexes),[[],[]]);
 assert.deepEqual(p.rows.map(r=>r.kind),['new_row','new_row']);assert.equal(p.rows.length,2);
});
