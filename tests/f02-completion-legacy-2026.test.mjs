import test from 'node:test';
import assert from 'node:assert/strict';
import {programs,catalog,initialState,calculateState,calculateCompletion} from './fixtures/yi07-graduation-legacy.mjs';
const scope = d => programs.find(p => p.department === d).scopeId;
for(const [label,name,parts] of [['K2','文学',[['correspondence',2]]],['K1','民事訴訟法',[['correspondence',2],['schooling',2]]]]) test(`F02 schema22 ${label} raw records survive without completed allocation`,()=>{
 const state=initialState(); state.graduationProfile.admissionType='first_year';state.graduationProfile.curriculumApplicability='current_2026';
 state.items=parts.map(([method,n],i)=>{const o=catalog.offerings.find(o=>o.id === (method === 'schooling' ? 'a2caa2ab-135f-4ad8-8998-75e8fd88ca59' : '') || (o.name===name&&o.method===method));assert.ok(o);return {offeringId:o.id,status:'earned',plannedYear:2026,plannedTerm:null,studyYear:null,earnedOrder:i+1,courseCreditContribution:n};});
 const before=structuredClone(state),p=calculateState(state,scope('法律学科')),c=calculateCompletion(state,scope('法律学科')).courses[0];
 console.log(JSON.stringify({kind:'schema22',name,parts,completion:c,cards:p.cards}));
 assert.notEqual(c.completion,'complete'); assert.equal(c.earnedCredits,parts.reduce((n,a)=>n+a[1],0));
 assert.equal(p.cards.find(c=>c.requirementId===(label==='K2'?'group-general':'professional-law-required-elective')).earned,0);
 assert.deepEqual(state,before);
});
