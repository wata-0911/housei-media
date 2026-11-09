import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlannerAttemptSession} from '../src/planner/attempts/production/session.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import {readSavedProgress} from '../src/planner/attempts/progress/savedProjection.ts';
import {env,mixed,catalog} from './fixtures/migration-fixture.mjs';

const placement='hosei:cp:13f6e301-6356-4670-a2cc-e285d49d343e';
const locks={request:async(_name,_options,run)=>run()};
const input=(year,status='in_progress')=>JSON.stringify({plannedYear:year,method:'media',status});
const save=async api=>api.save(await api.prepareSave(),true);
function host(primaryRaw=null){
 let record=emptyAuthority(),writes=0;
 const legacy={primaryRaw,recoveryRaw:primaryRaw===null?null:'broken recovery\t'};
 const store={read:async()=>structuredClone(record),commit:async(expected,next,beforePut)=>{
  assert.deepEqual(record,expected,'stale_commit');beforePut?.();record=structuredClone(next);writes++;
 }};
 return {store,legacy,snapshot:()=>structuredClone(record),writes:()=>writes,
  session:()=>createPlannerAttemptSession(store,locks,{readLegacy:()=>({...legacy}),migrationEnvironment:async()=>env})};
}
async function fresh(){const h=host(),api=h.session();await api.load();await save(api);return {...h,api};}
async function portable(api){
 const raw=await api.createBackup(),h=host(),restored=h.session();await restored.load();
 const preview=await restored.prepareRestore(raw);
 await restored.save(preview,true,preview.adoptionSha256);
 const reload=h.session();await reload.load();return {h,api:reload,raw};
}

test('S2-01 schema24: Offering-free same-title 2027/28 owners save/reload/portable restore all learner payloads',async()=>{
 const h=await fresh(),{api}=h;
 assert.equal(catalog.offerings.some(o=>o.name.normalize('NFKC')==='ビジネス英語A'),false);
 const a=api.add(placement,input(2027)).attempts[0];
 const b=api.add(placement,input(2028)).attempts[1];
 assert.equal(a.originalTitle,b.originalTitle);assert.notEqual(a.id,b.id);assert.notEqual(a.creationOperationId,b.creationOperationId);
 api.recordContribution(a.id,'{"value":1}');
 api.progress(a.id,'media',JSON.stringify({totalLessons:null,lessons:[{lesson:1,videoCompleted:true,testCompleted:false}],assessments:[]}));
 api.progress(a.id,'correspondence',JSON.stringify({requiredReports:null,reports:[{reportNumber:1,status:'passed',grade:'A'}],examGrade:'D'}));
 api.progress(a.id,'evaluation',JSON.stringify({finalGrade:'S',reportGrade:'A',schoolingGrade:null}));
 api.progress(b.id,'media',JSON.stringify({totalLessons:2,lessons:[{lesson:1,videoCompleted:false,testCompleted:true}],assessments:[]}));
 await save(api);
 const committed=api.graph(),saved=h.snapshot();assert.equal(JSON.parse(saved.raw).schemaVersion,24);
 const reopened=h.session();assert.deepEqual(await reopened.load(),committed);
 const beforeRead=h.writes(),p=await readSavedProgress(reopened);
 assert.equal(h.writes(),beforeRead);assert.equal(p.snapshot.schemaVersion,24);assert.equal(Object.isFrozen(p.projection.owners),true);
 assert.deepEqual(p.projection.owners.map(o=>[o.attemptId,o.learnerOriginal.plan.plannedYear]),[[a.id,2027],[b.id,2028]]);
 assert.deepEqual(p.projection.owners.map(o=>o.ownedRecords.length),[3,1]);
 assert.equal(p.projection.owners[0].learnerOriginal.plan.contribution.value,1);
 assert.equal(p.projection.creditEvidence.knownOfficialCredits,null);assert.equal(p.projection.creditEvidence.additionalCredits,0);
 for(const owner of p.projection.owners){assert.equal(owner.resultOrigin,'learner');assert.equal(owner.effectiveResult,null);assert.equal(owner.creditEvidence.attemptAllocatedQuantity,null);}
 assert.equal(p.projection.createdOfferingCount,0);
 const restored=await portable(reopened);assert.deepEqual(restored.api.graph(),committed);
 assert.deepEqual(JSON.parse(restored.h.snapshot().raw),JSON.parse(saved.raw));
 for(const id of saved.issuedIds)assert.ok(restored.h.snapshot().issuedIds.includes(id));
 assert.equal(restored.h.legacy.primaryRaw,null);assert.equal(restored.h.legacy.recoveryRaw,null);
});

test('S2-02 edit replaces only same owner payload, remove/Undo preserves latest progress through saved replay',async()=>{
 const h=await fresh(),{api}=h;const a=api.add(placement,input(2027)).attempts[0];
 const payload={totalLessons:null,lessons:[{lesson:1,videoCompleted:false,testCompleted:false}],assessments:[]};
 api.progress(a.id,'media',JSON.stringify(payload));await save(api);
 const id=api.graph().ownedRecords[0].id;
 payload.lessons[0].videoCompleted=true;api.progress(a.id,'media',JSON.stringify(payload));await save(api);
 const before=api.graph();assert.equal(before.ownedRecords[0].id,id);
 api.remove(a.id);await save(api);const deleted=h.session();await deleted.load();
 assert.deepEqual(deleted.graph().ownedRecords,before.ownedRecords);
 deleted.undo(a.id);await save(deleted);assert.deepEqual(await h.session().load(),before);
});

for(const officialCredits of [1,4])test(`S2-03 schema22→23 official ${officialCredits}: source bytes/fingerprint, retained rows, manual quantity/status survive all public operations`,async()=>{
 const state=mixed();state.importedCourseAchievements[0].earnedCreditsTotal=officialCredits;
 const raw=' \n'+JSON.stringify(state,null,2)+'\r\n',h=host(raw),api=h.session();await api.load();
 const migration=await api.prepareMigration(raw);await api.save(migration,true);
 const first=JSON.parse(h.snapshot().raw),a=api.graph().attempts.find(a=>a.plan?.importedSourceCourseId==='official-A');assert.ok(a);
 assert.equal(first.schemaVersion,23);assert.equal(first.source.raw,raw);
 api.update(a.id,JSON.stringify({plannedYear:2028,method:a.method.value,status:'in_progress'}));
 api.recordContribution(a.id,'{"value":1}');
 api.progress(a.id,'correspondence',JSON.stringify({requiredReports:null,reports:[{reportNumber:2,status:'passed',grade:'S'},{reportNumber:1,status:'grading',grade:null}],examGrade:'A'}));
 const media=api.graph().ownedRecords.find(r=>r.kind==='media');
 const mp=structuredClone(media.payload);mp.assessments[0].completed=true;mp.lessons[0].videoCompleted=true;
 api.progress(media.owner.attemptId,'media',JSON.stringify(mp));
 await save(api);const saved=JSON.parse(h.snapshot().raw),graph=api.graph();
 assert.deepEqual(saved.source,first.source);assert.deepEqual(saved.retained,first.retained);
 assert.equal(saved.retained.importedCourseAchievements[0].fingerprint,'literal-original-fingerprint');
 assert.equal(saved.retained.importedCourseAchievements[0].earnedCreditsTotal,officialCredits);
 const reopened=h.session();assert.deepEqual(await reopened.load(),graph);
 const writes=h.writes(),p=await readSavedProgress(reopened);assert.equal(h.writes(),writes);
 assert.equal(p.officialSource.raw,raw);assert.deepEqual(p.retained,first.retained);
 assert.equal(p.projection.officialHistory.length,0);assert.equal(p.projection.owners.find(o=>o.attemptId===a.id).effectiveStatus,'in_progress');
 assert.equal(p.projection.owners.find(o=>o.attemptId===a.id).learnerOriginal.plan.contribution.value,1);
 const restored=await portable(reopened);assert.deepEqual(restored.api.graph(),graph);
 assert.deepEqual(JSON.parse(restored.h.snapshot().raw),saved);
 assert.equal(h.legacy.primaryRaw,raw);assert.equal(h.legacy.recoveryRaw,'broken recovery\t');
});

test('S2-04 projection rejects unsaved draft without discarding it or writing authority',async()=>{
 const h=await fresh(),{api}=h;api.add(placement,input(2027));const draft=api.graph(),before=h.snapshot();
 await assert.rejects(readSavedProgress(api),/saved_snapshot_required/);
 assert.deepEqual(api.graph(),draft);assert.deepEqual(h.snapshot(),before);
});

test('S2-05 concurrent save conflicts, projection fails closed until explicit reload; no stale snapshot',async()=>{
 const h=await fresh(),a=h.api.add(placement,input(2027)).attempts[0];await save(h.api);
 const other=h.session();await other.load();h.api.update(a.id,input(2028));const stale=await h.api.prepareSave();
 other.progress(a.id,'evaluation',JSON.stringify({finalGrade:'A',reportGrade:null,schoolingGrade:null}));await save(other);
 const before=h.snapshot();await assert.rejects(h.api.save(stale,true),/stale_commit/);assert.deepEqual(h.snapshot(),before);
 await assert.rejects(readSavedProgress(h.api),/saved_snapshot_required/);
 await h.api.load();const p=await readSavedProgress(h.api);assert.equal(p.projection.owners[0].learnerOriginal.plan.plannedYear,2027);
 assert.equal(p.projection.owners[0].ownedRecords[0].payload.finalGrade,'A');
 other.update(a.id,input(2028));await save(other);
 await assert.rejects(readSavedProgress(h.api),/stale_backup_requires_reload/);
});

test('S2-06 unsupported nested assessment insertion remains held, without schema or authority mutation',async()=>{
 const h=await fresh(),{api}=h,a=api.add(placement,input(2027)).attempts[0];await save(api);
 const before=h.snapshot(),graph=api.graph();
 assert.throws(()=>api.progress(a.id,'media',JSON.stringify({totalLessons:null,lessons:[],assessments:[{id:crypto.randomUUID(),type:'final',label:'new',scheduledDate:null,completed:false}]})),/new_assessment_requires_identity_contract/);
 assert.deepEqual(api.graph(),graph);assert.deepEqual(h.snapshot(),before);
});
