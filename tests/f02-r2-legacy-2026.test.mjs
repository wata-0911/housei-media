import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,programs,initialState,calculateState,calculateCompletion,officialRow} from './fixtures/yi07-graduation-legacy.mjs';
import {validateState} from '../src/planner/validation.ts';
import {loadState,STORAGE_KEY} from '../src/planner/backup/storage.ts';
import {setThesisProgressForScope} from '../src/planner/graduation/thesisSelection.ts';
const law=programs.find(p=>p.department==='法律学科').scopeId;
const full=['行政法','刑事訴訟法','債権総論','刑法各論','国際法各論','物権法','国際法総論','刑法総論'];
const item=(id,n,status='earned')=>({offeringId:typeof id==='string'?id:id.id,status,plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null,...(n===undefined?{}:{courseCreditContribution:n})});
const offering=(name,method)=>catalog.offerings.find(o=>o.method===method&&catalog.curriculum.courses.some(c=>c.id===o.curriculumCourseId&&c.canonicalName===name));
function state(items=[],selection='not_selected'){let s=initialState();Object.assign(s.graduationProfile,{admissionYear:2026,admissionType:'first_year',curriculumApplicability:'current_2026'});s.items=items;s.selectedScopeId=law;return setThesisProgressForScope(s,catalog,law,{selection});}
function saved22(s){assert.equal(validateState(s,catalog),true);const r=loadState({getItem:k=>k===STORAGE_KEY?JSON.stringify(s):null},catalog);assert.equal(r.error,null);return r.state;}
const card=(r,id)=>{const c=r.cards.find(c=>c.requirementId===id);assert.ok(c,id);return c;};
function lawAmounts(r,total,elective,selection='not_selected'){
 const ids=selection==='selected'?['5755e04d-5c56-4a34-a2b4-afca335676e2','8e08d5c3-a3ab-47e9-81c8-c9a3f8426a67']:['5e64c026-b4b7-4546-a1fc-5e9340e3b976','ef19cce0-2441-42dc-aedd-9c8e91c2bd9e'];
 const rows=r.requirements.filter(r=>r.ruleType==='min_credits'&&['専門教育','専門教育：選択'].includes(r.label));assert.deepEqual(rows.map(r=>r.requirementId).sort(),ids.sort());assert.equal(rows.length,2);
 for(const row of rows)assert.equal(row.earned,row.label==='専門教育'?total:elective);
 assert.equal(card(r,'professional-law-total').earned,total);assert.equal(card(r,'professional-law-elective').earned,elective);
}
for(const selection of ['selected','not_selected'])for(const extra of [null,'b6a158b9-465e-48fd-91b3-3c281cf17ea4','54d68d8f-0fa1-4ebf-b701-0e671443d4fb'])test(`F02-R2 legacy law S2 plus zero ${selection} ${extra}`,()=>{
 const s=saved22(state([...full.map(n=>item(offering(n,'correspondence'),4)),item('3c96e34f-9433-446f-a909-5389ca6fce08',2),...(extra?[item(extra,0)]:[])],selection)),raw=JSON.stringify(s);lawAmounts(calculateState(s,law),34,2,selection);assert.equal(JSON.stringify(s),raw);
});
for(const amount of [4,0,null])for(const planned of [false,true])test(`F02-R2 P2 official ${amount} planned0${planned}`,()=>{
 const s=state([item('b6a158b9-465e-48fd-91b3-3c281cf17ea4',2),item('3c96e34f-9433-446f-a909-5389ca6fce08',2),...(planned?[item('54d68d8f-0fa1-4ebf-b701-0e671443d4fb',0,'planned')]:[])]);s.importedCourseAchievements=[officialRow(catalog.curriculum.courses.find(c=>c.id===offering('保険法・海商法','correspondence').curriculumCourseId),amount)];const raw=JSON.stringify(saved22(s)),c=calculateCompletion(s,law).courses[0];assert.equal(c.completion,amount===4?'complete':amount===null?'unknown':'incomplete');assert.equal(c.projectedCompletion,c.completion);assert.equal(c.earnedCredits,c.projectedCredits);assert.equal(JSON.stringify(s),raw);
});
test('F02-R2 law assertion rejects missing, relabeled and duplicated requirements before comparing values',async()=>{
 const {assertLawDenseRequirements}=await import('./fixtures/f02-law-requirements.mjs'),r=calculateState(state([],'selected'),law);assertLawDenseRequirements(r,0,0);
 const ids=new Set(['5755e04d-5c56-4a34-a2b4-afca335676e2','8e08d5c3-a3ab-47e9-81c8-c9a3f8426a67']);
 for(const mutate of [rows=>rows.filter(r=>!ids.has(r.requirementId)),rows=>rows.filter(r=>r.requirementId!=='5755e04d-5c56-4a34-a2b4-afca335676e2'),rows=>rows.map(r=>ids.has(r.requirementId)?{...r,label:'removed law label'}:r),rows=>[...rows,rows.find(r=>ids.has(r.requirementId))]])assert.throws(()=>assertLawDenseRequirements({...r,requirements:mutate(r.requirements)},0,0));
});
test('F02-R2 projected official2 uses regular positive future2, never the unlinked earned subtotal',()=>{
 const s=state([item('b6a158b9-465e-48fd-91b3-3c281cf17ea4',2,'planned')]);s.importedCourseAchievements=[officialRow(catalog.curriculum.courses.find(c=>c.id===catalog.offerings.find(o=>o.id===s.items[0].offeringId).curriculumCourseId),2)];const c=calculateCompletion(saved22(s),law).courses[0];assert.equal(c.completion,'incomplete');assert.equal(c.projectedCompletion,'complete');
});
