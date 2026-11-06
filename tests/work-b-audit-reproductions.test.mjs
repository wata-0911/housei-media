import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {calculateRecordedCredits as calc} from '../src/planner/attempts/graduation/recordedCalculation.ts';
import {createNewPlanSource} from '../src/planner/attempts/persistence/newPlan.ts';
import {decode} from './fixtures/migration-fixture.mjs';
import {programs,newAttempt,initialState} from './fixtures/yi07-graduation.mjs';
const source=await createNewPlanSource();
const samples=Object.fromEntries(['F1','F2','F3','F4','F5','F6'].map(id=>[id,JSON.parse(readFileSync(new URL(`./fixtures/work-b-audit/${id}.json`,import.meta.url)))]));
const run=async(x,scope=x.scope)=>calc(x.raw??JSON.stringify(x.graph),x.sourceOverrides?(await decode({...initialState(),...x.sourceOverrides})).source:source,scope);
for(const id of Object.keys(samples))test(`audit ${id}`,async()=>{
 if(id==='F5') { await assert.rejects(run(samples[id]),e=>e.code==='unrepresentable_json_number'); return; }
 const r=await run(samples[id]);assert.equal(r.status,'calculated');
 if(id==='F1') {assert.equal(r.courses.filter(c=>c.authority==='learner_record').length,0);assert.ok(r.holds.some(h=>h.reason==='official_detail_shared'));}
 if(id==='F2') {assert.ok(r.holds.some(h=>h.reason==='explicit_official_link_unresolved'));assert.equal(r.courses[0].increment,0);}
 if(id==='F3') assert.ok(r.holds.some(h=>h.reason==='repeatable_independence_unverified'));
 if(id==='F4') {const row=r.progress.requirements.find(x=>x.requirementId===samples[id].expected.requirementId);assert.equal(row.earned,1);assert.equal(row.status,'satisfied');}
 if(id==='F5') {assert.ok(r.holds.length);assert.ok(r.courses.every(c=>Number.isFinite(c.recordedEarned??0)));}
 if(id==='F6') {assert.ok(r.holds.some(h=>h.reason==='unsupported_course_component_structure'));assert.ok(r.courses.every(c=>c.completedCredits===0));}
});
