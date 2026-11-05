import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateRecordedCredits } from '../src/planner/attempts/graduation/recordedCalculation.ts';
import { createNewPlanSource } from '../src/planner/attempts/persistence/newPlan.ts';
import { newAttempt, programs, catalog, officialRow, initialState } from './fixtures/yi07-graduation.mjs';
import { specialOfficialCourse } from '../src/planner/graduation/officialGraduationFacts.ts';
import { decode } from './fixtures/migration-fixture.mjs';
import ruleData from '../src/data/graduation_rules.json' with { type: 'json' };
const source = await createNewPlanSource(), master = source.context.catalog;
const common = catalog.programs.find(p => p.isCommon).scopeId;
const placement = master.placements.find(p => p.scopeId === common && p.compositionCredits === 4
  && p.category === '一般教育' && p.institutionalCourseId && p.identityDecision.status === 'safe' && p.auditRecord.placementStatus === 'safe');
const graph = attempts => JSON.stringify({ attempts, ownedRecords: [], removals: [] });
const attempt = (method, credits, status = 'earned', p = placement) => newAttempt(master, p, credits, status, method);
for (const program of programs) {
  for (const [name, parts, expected] of [['T2',[['correspondence',2]],0],['T2+S2',[['correspondence',2],['schooling',2]],4],['T4',[['correspondence',4]],4]]) {
    test(`positive ${program.displayName} ${name}`, async () => {
      const r = await calculateRecordedCredits(graph(parts.map(([m,c])=>attempt(m,c))),source,program.scopeId);
      assert.equal(r.status,'calculated'); assert.deepEqual(r.holds,[]);
      assert.equal(r.courses[0].completedCredits,expected);
      assert.equal(r.progress.cards.find(c=>c.requirementId==='group-general').earned,expected);
      assert.equal(r.courses[0].schoolingCredits,name==='T2+S2'?2:0);
      assert.equal(r.personalApplicability.status,'unverified');
      assert.equal(source.context.catalog.curriculumVersions[0].applicabilityStatus,'unknown');
    });
  }
  test(`positive ${program.displayName} duplicate ordinary cannot yield8`, async () => {
    const r=await calculateRecordedCredits(graph([attempt('correspondence',4),attempt('correspondence',4)]),source,program.scopeId);
    assert.deepEqual(r.holds,[]); assert.equal(r.courses[0].completedCredits,4);
    assert.equal(r.progress.cards.find(c=>c.requirementId==='group-general').earned,4);
  });
  test(`positive ${program.displayName} plans never become earned`, async () => {
    const r=await calculateRecordedCredits(graph([attempt('correspondence',4,'planned'),attempt('schooling',2,'in_progress')]),source,program.scopeId);
    assert.equal(r.progress.cards.find(c=>c.requirementId==='group-general').earned,0);
    assert.deepEqual(r.informational.map(x=>x.status),['planned','in_progress']);
  });
}
test('new plan calculation has no annual offerings or relations',()=>{
  assert.deepEqual(ruleData.offerings,[]); assert.deepEqual(ruleData.curriculum.offeringRelations,[]);
});
test('official aggregate priority survives schema23 and has no manual increment',async()=>{
  const state=initialState();state.importedCourseAchievements=[officialRow(catalog.curriculum.courses.find(c=>c.id===placement.auditRecord.oldCurriculumCourseId))];
  const d=await decode(state);assert.equal(d.status,'decoded');
  const r=await calculateRecordedCredits(graph([attempt('correspondence',4)]),d.source,programs[0].scopeId);
  assert.equal(r.courses[0].authority,'official');assert.equal(r.courses[0].increment,0);
});
test('untrusted new source cannot be substituted',async()=>{
  await assert.rejects(calculateRecordedCredits(graph([]),structuredClone(source),programs[0].scopeId),/unvalidated_new_plan_source/);
});

test('documented Law repeat cap uses existing department allocator',async()=>{
 const program=programs.find(p=>p.department==='法律学科');
 const p=master.placements.find(p=>p.scopeId===program.scopeId&&p.officialName==='法律学演習'&&p.institutionalCourseId&&p.identityDecision.status==='safe');
 assert.ok(p);
 const r=await calculateRecordedCredits(graph(Array.from({length:6},()=>attempt('schooling',2,'earned',p))),source,program.scopeId);
 assert.equal(r.courses.length,0);assert.equal(r.holds.length,6);assert.ok(r.holds.every(h=>h.reason==='repeatable_independence_unverified'));
});
for (const program of programs) test(`ambiguous repeat family held ${program.displayName}`,async()=>{
 const p=master.placements.find(p=>p.scopeId===program.scopeId&&p.auditRecord.canonicalName==='総合特講');assert.ok(p);
 const r=await calculateRecordedCredits(graph([attempt('schooling',2,'earned',p)]),source,program.scopeId);
 assert.equal(r.courses.length,0);assert.ok(r.holds.length);
});

for (const program of programs) test(`department positive ${program.displayName}`,async()=>{
 const p=master.placements.find(p=>{
  const mapping=ruleData.mappings.find(m=>m.mappingId===p.auditRecord.oldMappingId);
  return p.scopeId===program.scopeId&&p.compositionCredits>0&&p.institutionalCourseId&&p.identityDecision.status==='safe'
   &&p.auditRecord.placementStatus==='safe'&&!p.methodConstraint.requiredMethod&&mapping
   &&!specialOfficialCourse(ruleData.curriculum.courses.find(c=>c.id===p.auditRecord.oldCurriculumCourseId)?.canonicalName??'',program.department,mapping);
 }); assert.ok(p,program.displayName);
 const r=await calculateRecordedCredits(graph([attempt('correspondence',p.compositionCredits,'earned',p)]),source,program.scopeId);
 assert.deepEqual(r.holds,[]);assert.equal(r.courses[0].completedCredits,p.compositionCredits);
 assert.ok(r.progress.cards.some(c=>c.requirementId.startsWith('professional-')&&c.earned>0));
});
test('schema23 learner T4 uses the same positive calculation without an official row',async()=>{
 const d=await decode(initialState());assert.equal(d.status,'decoded');
 const r=await calculateRecordedCredits(graph([attempt('correspondence',4)]),d.source,programs[0].scopeId);
 assert.equal(r.courses[0].completedCredits,4);
 assert.equal(r.progress.cards.find(c=>c.requirementId==='group-general').earned,4);
});
test('official unknown aggregate is not repaired by learner T4',async()=>{
 const state=initialState();const row=officialRow(catalog.curriculum.courses.find(c=>c.id===placement.auditRecord.oldCurriculumCourseId));
 row.earnedCreditsTotal=null;state.importedCourseAchievements=[row];
 const d=await decode(state);assert.equal(d.status,'decoded');
 const r=await calculateRecordedCredits(graph([attempt('correspondence',4)]),d.source,programs[0].scopeId);
 assert.equal(r.courses[0].authority,'official');assert.equal(r.courses[0].increment,0);
 assert.ok(r.progress.cards.find(c=>c.requirementId==='group-general').status==='unknown');
});
