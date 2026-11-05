import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importRepeated,repeatedPayload,repeatProfile} from './fixtures/official-repeatable.mjs';
import {decode} from './fixtures/migration-fixture.mjs';
import {calculateRecordedCredits} from '../src/planner/attempts/graduation/recordedCalculation.ts';
import {programs} from './fixtures/yi07-graduation.mjs';
const scope=programs.find(p=>p.department==='法律学科').scopeId;
for(const n of [0,1,3,4,5,6])test(`official proven repeat quantity/cap ${n}`,async()=>{
 const state=importRepeated(repeatedPayload('法律学演習',n));state.graduationProfile=structuredClone(repeatProfile);
 const d=await decode(state);assert.equal(d.status,'decoded');
 const r=await calculateRecordedCredits('{"attempts":[],"ownedRecords":[],"removals":[]}',d.source,scope);
 assert.equal(r.status,'calculated');assert.equal(r.progress.cards.find(x=>x.requirementId==='professional-law-total').earned,Math.min(n*2,8));
});
test('internal recorded allocation rejects duplicates and non-finite quantities; official ownership wins',async()=>{
 const {calculateGraduationProgress}=await import('../src/planner/graduation/graduationProgress.ts');
 const {catalog,officialRow,initialState}=await import('./fixtures/yi07-graduation.mjs');
 const m=catalog.mappings.find(m=>m.category==='一般教育'&&m.curriculumCredits===4);
 const c=catalog.curriculum.courses.find(c=>c.mappingIds.includes(m.mappingId));
 const a={mapping:m,credits:4,completedCredits:4,schoolingCredits:0,fact:{curriculumCourseId:c.id,canonicalName:c.canonicalName}};
 const run=(allocs,rows=[])=>calculateGraduationProgress([],catalog,scope,[],undefined,[],rows,initialState().graduationProfile,null,{},allocs);
 assert.throws(()=>run([a,a]),/duplicate_recorded_course_allocation/);
 assert.throws(()=>run([{...a,credits:Infinity}]),/invalid_recorded_allocation_quantity/);
 const official=run([], [officialRow(c,4)]),mixed=run([a],[officialRow(c,4)]);
 assert.deepEqual(mixed,official);
});
