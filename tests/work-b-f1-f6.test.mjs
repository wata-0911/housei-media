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
for(const p of programs){
 test(`F1 shared ${p.displayName}`,async()=>{const r=await run(samples.F1,p.scopeId);assert.equal(r.courses.filter(c=>c.authority==='learner_record').length,0);assert.equal(new Set(r.holds.map(h=>h.attemptId)).size,2);});
 for(const amounts of [[2,2],[1,1,1,1]])test(`F6 split ${p.displayName}/${amounts}`,async()=>{
  const x=structuredClone(samples.F6);const original=x.graph.attempts;
  x.graph.attempts=amounts.map((n,i)=>{const a=structuredClone(original[i%original.length]);
    // Generate valid independent IDs via existing constructor; preserve the audited identity/placement.
    const placement=source.context.catalog.placements.find(p=>p.id===a.placement.candidatePlacementIds[0]||p.id===a.placement.ref?.placementId);
    return newAttempt(source.context.catalog,placement,n,'earned','correspondence');});delete x.raw;
  const r=await run(x,p.scopeId);assert.ok(r.courses.every(c=>c.completedCredits===0));assert.ok(r.holds.length);
 });
}
for(const n of [0,1,3,4,5,6])test(`F3 independence boundary ${n}`,async()=>{
 const x=structuredClone(samples.F3);const a=x.graph.attempts[0];const ids=a.placement.ref?[a.placement.ref.placementId]:a.placement.candidatePlacementIds;
 const p=source.context.catalog.placements.find(p=>p.id===ids[0]);
 x.graph.attempts=Array.from({length:n},()=>newAttempt(source.context.catalog,p,2,'earned','schooling'));delete x.raw;
 const r=await run(x);assert.equal(r.status,'calculated');
 if(n>1){assert.equal(r.courses.length,0);assert.equal(r.holds.length,n);}else assert.equal(r.courses[0]?.increment??0,n*2);
});
for(const raw of ['{"attempts":[],"attempts":[],"ownedRecords":[],"removals":[]}', '{"x":'+ '['.repeat(65)+'0'+']'.repeat(65)+'}'])test('bounded JSON rejects duplicate/depth '+raw.length,async()=>{
 await assert.rejects(calc(raw,source,programs[0].scopeId));
});
