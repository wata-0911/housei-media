import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,programs,initialState,calculateState,legacyCases} from './fixtures/yi07-graduation-legacy.mjs';
import {assertLawDenseRequirements} from './fixtures/f02-law-requirements.mjs';
const law=programs.find(p=>p.department==='法律学科').scopeId;
const dense=legacyCases().filter(c=>c.scopeId===law&&c.name.includes('/dense-'));
const mixed=dense.find(c=>c.name.endsWith('/dense-mixed'));const isolated=structuredClone(mixed);isolated.name='law/dense-mixed-no-politics';for(const i of isolated.state.items)if(catalog.offerings.find(o=>o.id===i.offeringId)?.curriculumCourseId==='curriculum:f49de1e6-82ae-4b86-8c0a-453ef41995ce')i.status='planned';dense.push(isolated);
const expected={'dense-earned':[128,96],'dense-in_progress':[2,2],'dense-planned':[2,2],'dense-mixed':[42,30],'dense-mixed-no-politics':[40,28]};
const ids=['5755e04d-5c56-4a34-a2b4-afca335676e2','8e08d5c3-a3ab-47e9-81c8-c9a3f8426a67'];
for(const c of dense){const mode=c.name.split('/').at(-1),[total,elective]=expected[mode];test(`F02-R3 E actual ${mode} fixed baseline`,()=>assertLawDenseRequirements(calculateState(c.state,c.scopeId),total,elective,mode));
 const mutants={empty:rs=>rs.filter(r=>!ids.includes(r.requirementId)),missing:rs=>rs.filter(r=>r.requirementId!==ids[0]),duplicate:rs=>[...rs,rs.find(r=>r.requirementId===ids[0])],label:rs=>rs.map(r=>r.requirementId===ids[0]?{...r,label:'専門教育：選択'}:r),swapped:rs=>rs.map(r=>ids.includes(r.requirementId)?{...r,label:r.requirementId===ids[0]?'専門教育：選択':'専門教育'}:r),status:rs=>rs.map(r=>ids.includes(r.requirementId)?{...r,status:r.status==='satisfied'?'unsatisfied':'satisfied',reason:null,unknownReasonCategory:null}:r),reason:rs=>rs.map(r=>ids.includes(r.requirementId)?{...r,reason:'別の理由'}:r),classification:rs=>rs.map(r=>ids.includes(r.requirementId)?{...r,unknownReasonCategory:'identity_unresolved'}:r),quantity999:rs=>rs.map(r=>ids.includes(r.requirementId)?{...r,earned:999}:r)};
 for(const [name,mutate]of Object.entries(mutants))test(`F02-R3 E actual ${mode} rejects ${name}`,()=>{const actual=calculateState(c.state,c.scopeId),changed=structuredClone(actual);changed.requirements=mutate(changed.requirements);assert.throws(()=>assertLawDenseRequirements(changed,total,elective,mode));});
}
