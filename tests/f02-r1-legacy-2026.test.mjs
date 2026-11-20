// Original F02 R1 legacy callbacks copied unchanged by source-line slices; see F02_PORT_MAPPING.json.
import {assertLawDenseRequirements} from './fixtures/f02-law-requirements.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,programs,initialState,calculateState,calculateCompletion,officialRow,legacyCases} from './fixtures/yi07-graduation-legacy.mjs';
import {validateState} from '../src/planner/validation.ts';
import {loadState,STORAGE_KEY} from '../src/planner/backup/storage.ts';
import {setThesisProgressForScope} from '../src/planner/graduation/thesisSelection.ts';
import {foreignLedger,lawLedger} from './fixtures/f02-r1-independent-ledger.mjs';
// Expectations below are fixed from shiori2026 pp.31,45,47(b,d), not engine snapshots.
const law=programs.find(p=>p.department==='法律学科').scopeId;
const item=(o,n)=>({offeringId:typeof o==='string'?o:o.id,status:'earned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null,...(n===undefined?{}:{courseCreditContribution:n})});
function stateFor(items=[],scope=law,selection='not_selected') {
 let s=initialState();Object.assign(s.graduationProfile,{admissionYear:2026,admissionType:'first_year',curriculumApplicability:'current_2026'});
 s.selectedScopeId=scope;s.items=items;s=setThesisProgressForScope(s,catalog,scope,{selection});return s;
}
function saved22(s) {
 assert.equal(validateState(s,catalog),true,'counterexample must be saveable schema22');
 const raw=JSON.stringify(s),r=loadState({getItem:k=>k===STORAGE_KEY?raw:null},catalog);
 assert.equal(r.error,null);assert.deepEqual(r.state.items,s.items);return r.state;
}
const card=(r,id)=>{const c=r.cards.find(c=>c.requirementId===id);assert.ok(c,id);return c;};
const req=(r,label)=>{const a=r.requirements.filter(c=>c.label===label&&c.ruleType==='min_credits');assert.equal(a.length,1,label);return a[0];};
const scopeOffering=(name,method,scope=law)=>catalog.offerings.find(o=>catalog.curriculum.courses.some(c=>c.id===o.curriculumCourseId&&c.canonicalName===name)&&o.method===method&&o.mappingIds.some(id=>catalog.mappings.some(m=>m.mappingId===id&&(m.scopeId===scope||catalog.programs.some(p=>p.isCommon&&p.scopeId===m.scopeId)))));
const professionalNames={'法律学科':'行政救済法','日本文学科':'中国文芸史','史学科':'経済地理学','地理学科':'自然地理学（地形）','経済学科':'経済地理','商業学科':'経済地理'};
for(const p of programs)for(const name of ['文学',professionalNames[p.department]])test(`F02-R1 A schema22 ${p.displayName} ${name} T4+S0 retains one Course`,()=>{
 const t=scopeOffering(name,'correspondence',p.scopeId),s=scopeOffering(name,'schooling',p.scopeId);assert.ok(t&&s,name);
 const base=saved22(stateFor([item(t,4)],p.scopeId)),extra=saved22(stateFor([item(t,4),item(s,0)],p.scopeId));const before=JSON.stringify(extra);
 const r=calculateState(extra,p.scopeId),b=calculateState(base,p.scopeId),c=calculateCompletion(extra,p.scopeId);
 assert.equal(c.courses.length,1);assert.equal(c.courses[0].earnedCredits,4);assert.equal(c.courses[0].completion,'complete');assert.equal(c.courses[0].attempts.length,2);
 assert.equal(r.referenceProgress[0].earned,b.referenceProgress[0].earned);assert.equal(r.referenceProgress[0].earned,4);assert.equal(JSON.stringify(extra),before);
});
const foreignIds=['056ffe8f-4c4b-4cc8-825d-7919f470b7b6','066427dc-1df4-47bd-a6b1-538ab161e869','0c8b780c-2748-4c5c-96c0-43caa9102892','0f434746-a27e-4dfe-9707-95044945ef04'];
test('F02-R1 schema22 explicit null contribution is rejected, not a saveable A counterexample',()=>{
 const s=stateFor([item('35fb5bad-ec27-4c60-a16e-2271168170bb',4),item('a2caa2ab-135f-4ad8-8998-75e8fd88ca59',null)]),raw=JSON.stringify(s);
 assert.equal(validateState(s,catalog),false);const loaded=loadState({getItem:k=>k===STORAGE_KEY?raw:null},catalog);assert.notEqual(loaded.error,null);assert.equal(JSON.stringify(s),raw);
});
test('F02-R1 B schema22 persisted fractional English is raw2, completion0, graduation0',()=>{
 const s=saved22(stateFor(foreignIds.map(id=>item(id,.5)))),before=JSON.stringify(s),r=calculateState(s,law),c=calculateCompletion(s,law);
 assert.equal(s.items.length,4);assert.equal(c.courses.length,1);assert.equal(c.courses[0].earnedCredits,2);assert.notEqual(c.courses[0].completion,'complete');
 assert.equal(card(r,'group-foreign').earned,0);assert.notEqual(card(r,'group-foreign').status,'satisfied');assert.equal(r.referenceProgress[0].earned,0);assert.equal(JSON.stringify(s),before);
});
for(const parts of [[.5,.5],[0,0],[1,1],[1,1,1,1]])test(`F02-R1 B schema22 geography field-study S1 per record ${parts}`,()=>{
 const scope=programs.find(p=>p.department==='地理学科').scopeId,offerings=catalog.offerings.filter(o=>o.curriculumCourseId==='curriculum:d6e410fe-0e26-45dd-9c5a-af44b85d9f98'&&o.method==='schooling');assert.equal(offerings.length,4);
 const s=saved22(stateFor(parts.map((n,i)=>item(offerings[i],n)),scope)),before=JSON.stringify(s),r=calculateState(s,scope),proper=parts.filter(n=>n===1).length;
 assert.equal(card(r,'professional-geography-schooling-required').earned,Math.min(2,proper));assert.equal(card(r,'professional-geography-elective').earned,Math.max(0,proper-2));assert.equal(card(r,'professional-geography-total').earned,proper);assert.equal(JSON.stringify(s),before);
});
const fullNames=['行政法','刑事訴訟法','債権総論','刑法各論','国際法各論','物権法','国際法総論','刑法総論','民事訴訟法'];
const partialIds=['3c96e34f-9433-446f-a909-5389ca6fce08','54d68d8f-0fa1-4ebf-b701-0e671443d4fb'];
for(const selection of ['selected','not_selected'])for(const omitted of [true,false])for(const [count,parts,expected] of [[7,[2],0],[8,[2],2],[9,[2],2],[8,[1,1],0],[8,[.5,1.5],0]])test(`F02-R1 C schema22 ${selection} omitted${omitted} ${count}+S${parts}`,()=>{
 const items=fullNames.slice(0,count).map(n=>item(scopeOffering(n,'correspondence'),omitted?undefined:4));items.push(...parts.map((n,i)=>item(partialIds[i],omitted&&parts.length===1?undefined:n)));
 const s=saved22(stateFor(items,law,selection)),before=JSON.stringify(s),r=calculateState(s,law),overflow=Math.max(0,count*4-32),total=count*4+expected;
 assert.equal(card(r,'professional-law-elective').earned,overflow+expected);assert.equal(card(r,'professional-law-total').earned,total);
 assert.equal(req(r,'専門教育：選択').earned,overflow+expected);assert.equal(req(r,'専門教育').earned,total);assert.equal(r.referenceProgress[0].earned,total);assert.equal(JSON.stringify(s),before);
});
const politicsId='curriculum:f49de1e6-82ae-4b86-8c0a-453ef41995ce';
const politics=catalog.offerings.filter(o=>o.curriculumCourseId===politicsId&&o.method==='schooling');
for(const count of [1,2,3,5])for(const omitted of [true,false])test(`F02-R1 D schema22 politics ${count} omitted${omitted} exact identity cap4`,()=>{
 const normal=politics.filter(o=>!o.name.startsWith('【教職】')),teacher=politics.filter(o=>o.name.startsWith('【教職】'));assert.equal(normal.length,3);assert.equal(teacher.length,2);
 const s=saved22(stateFor([...normal,...teacher].slice(0,count).map(o=>item(o,omitted?undefined:2)))),before=JSON.stringify(s),r=calculateState(s,law),expected=Math.min(count*2,4);
 assert.equal(card(r,'professional-law-elective').earned,expected);assert.equal(card(r,'professional-law-total').earned,expected);assert.equal(req(r,'専門教育：選択').earned,expected);assert.equal(req(r,'専門教育').earned,expected);assert.equal(r.referenceProgress[0].earned,expected);assert.equal(JSON.stringify(s),before);
});
for(const amount of [4,0,null])test(`F02-R1 P2 official ${amount} + unverified manual mixed does not invent completion`,()=>{
 const t=scopeOffering('文学','correspondence'),s=scopeOffering('文学','schooling'),state=stateFor([item(t,2),item(s,2)]);state.importedCourseAchievements=[officialRow(catalog.curriculum.courses.find(c=>c.id===t.curriculumCourseId),amount)];
 const loaded=saved22(state),before=JSON.stringify(loaded),c=calculateCompletion(loaded,law).courses[0],r=calculateState(loaded,law);
 assert.equal(c.officialAchievements[0].earnedCreditsTotal,amount);assert.equal(c.attempts.length,2);assert.equal(c.completion,amount===4?'complete':amount===null?'unknown':'incomplete');assert.equal(card(r,'group-general').earned,amount??0);assert.equal(JSON.stringify(loaded),before);
});
for(const c of legacyCases().filter(c=>c.name.includes('/dense-')))test(`F02-R1 absolute independent foreign/law input ledger ${c.name}`,()=>{
 const r=calculateState(c.state,c.scopeId),l=foreignLedger(c.state,catalog),english=card(r,'group-foreign').details.find(d=>d.label==='英語');
 assert.deepEqual([english.earned,english.schooling],[l.英語.earned,l.英語.schooling]);
 if(c.scopeId===law) {
  const a=lawLedger(c.state,catalog,law);assert.equal(card(r,'professional-law-total').normalEarned??card(r,'professional-law-total').earned,a.total);
  assert.equal(card(r,'professional-law-elective').normalEarned??card(r,'professional-law-elective').earned,a.elective);
  assertLawDenseRequirements(r,a.total,a.elective,c.name.split('/').at(-1));
 }
});
