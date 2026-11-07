import assert from 'node:assert/strict';
import {catalog,programs,initialState,calculateState,officialRow,newAttempt,legacyCases} from './yi07-graduation.mjs';
import {env} from './migration-fixture.mjs';
import {validateState} from '../../src/planner/validation.ts';
import {setThesisProgressForScope} from '../../src/planner/graduation/thesisSelection.ts';
import {createAttemptPersistence} from '../../src/planner/attempts/persistence/controller.ts';
import {emptyAuthority} from '../../src/planner/attempts/persistence/contracts.ts';
import {calculateRecordedCredits} from '../../src/planner/attempts/graduation/recordedCalculation.ts';
export {catalog,calculateState,officialRow,newAttempt,legacyCases};
export const law=programs.find(p=>p.department==='法律学科').scopeId;
export const starred=['faf1e759-5542-478e-9f34-ea258fdb52c0','f51542a3-d90c-42f0-8c05-d368c19916f4','17931cc6-1840-4c99-b8ec-124f1ee3b875','0d6169d2-df66-4624-8e5e-7779a683cc60'];
export const french='2936dd7b-7c39-4553-ab51-7fe360d230cf',summer='e0c4749c-d0ac-40af-8bd0-2952f7da9a88',teacher='81911901-205b-49ff-8efc-a0440bf15309',winter='f0ec8fff-cf06-4a95-a0b4-266670a07b8f',media='5c3198fc-10c5-4806-bb2f-bd477670fbf3';
export const english=['0fdb1cbc-7379-4acb-adb0-94b84bc4dba3','0c8b780c-2748-4c5c-96c0-43caa9102892','056ffe8f-4c4b-4cc8-825d-7919f470b7b6'];
export const item=(offeringId,n)=>({offeringId,status:'earned',plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null,...(n===undefined?{}:{courseCreditContribution:n})});
export function state(items=[]){let s=initialState();s.selectedScopeId=law;s.items=items;Object.assign(s.graduationProfile,{admissionYear:2026,admissionType:'first_year',curriculumApplicability:'current_2026'});return setThesisProgressForScope(s,catalog,law,{selection:'not_selected'});}
export function englishState(schooling,official=false,complete=true,language='french'){
 const s=state(official?[]:english.slice(0,complete?3:2).map((id,i)=>item(id,i===0?2:1)));
 Object.assign(s.graduationProfile,{admissionType:'transfer_third_year'});Object.assign(s.graduationProfile.recognizedCredits,{totalCredits:40,schoolingEquivalentCredits:15});
 if(official)s.importedCourseAchievements=['英語2','英語3'].map((name,i)=>({...officialRow(catalog.curriculum.courses.find(c=>c.canonicalName===name),2),academicYear:2021,schoolingCreditsTotal:i===0?(complete?2:1):0}));
 if(schooling!==undefined)s.graduationProfile.recognizedCredits.foreignLanguage={mode:'recognized',language,credits:4,schoolingEquivalentCredits:schooling};
 return s;
}
export const card=(p,id)=>{const c=p.cards.find(c=>c.requirementId===id);assert.ok(c,id);return c;};
export async function migrate(s){assert.equal(validateState(s,catalog),true);const raw=JSON.stringify(s);let record=emptyAuthority();const store={read:async()=>structuredClone(record),commit:async(e,n)=>{assert.deepEqual(e,record);record=structuredClone(n);}},locks={request:async(_n,_o,f)=>f()};let api=createAttemptPersistence(store,locks,env);const p=await api.prepareMigration(await api.inspectLegacy(raw));await api.commit(p,true,p.previousRaw,p.sourceRaw);api=createAttemptPersistence(store,locks,env);const loaded=await api.load();assert.equal(loaded.source.raw,raw);assert.deepEqual(loaded.source.state,s);return {api,loaded,record:()=>structuredClone(record),raw};}
export async function calc(source,attempts){const graph={attempts,ownedRecords:[],removals:[]},raw=JSON.stringify(graph),sourceRaw=JSON.stringify(source);const r=await calculateRecordedCredits(raw,source,law);assert.equal(r.status,'calculated');assert.equal(JSON.stringify(graph),raw);assert.equal(JSON.stringify(source),sourceRaw);assert.deepEqual(r.informational.map(a=>[a.attemptId,a.contribution,a.method]),attempts.map(a=>[a.id,a.plan.contribution?.value,a.method.value]));return r;}
export function legalOffering(name){const o=catalog.offerings.find(o=>o.method==='schooling'&&o.deliveryCategory!=='media'&&catalog.curriculum.courses.some(c=>c.id===o.curriculumCourseId&&c.canonicalName===name));assert.ok(o,name);return o.id;}
// Independent transcription of the thirteen starred table rows (booklet46),
// joined to exact institution IDs and the law mapping's page46, never a title.
const stars=new Set(['社会経済学A','社会経済学B','経済政策論A','経済政策論B','総合特講','情報学入門','総合外国語特講','スポーツ特講','データサイエンス入門A','データサイエンス入門B','データサイエンス応用基礎A','データサイエンス応用基礎B','データサイエンス応用基礎C']);
const politics=new Map([[summer,'summer'],[teacher,'summer'],[winter,'winter'],['4bf76def-db1f-46c8-a3bc-df3f8cac1164','winter'],[media,'media']]);
// The audited catalog already excluded these six exact old-course names.
// Record that boundary separately from all official stars, without importing
// either production exclusion or allocation helpers.
const alreadyExcluded=new Set(['3d3c3738-e6aa-404b-aeaf-e8cb46223792','7b72a7f3-0ae4-4390-86fa-de6e6f752603','7bc2bf1f-54b5-45f0-af0d-1e42a3e0cb4e','b5819917-104a-4410-8055-f95bc1be4a46','bcd49015-0807-4741-b977-706a70aa633c','d070f845-1de4-44b8-a018-cf978c3b4236']);
export function independentLawS(s){
 const rows=[];
 for(const i of s.items){
  const o=catalog.offerings.find(o=>o.id===i.offeringId);
  if(i.status!=='earned'||o?.method!=='schooling'||o.resolutionStatus!=='matched')continue;
  const c=catalog.curriculum.courses.find(c=>c.id===o.curriculumCourseId),m=catalog.mappings.find(m=>o.mappingIds.includes(m.mappingId)&&c?.mappingIds.includes(m.mappingId)&&m.scopeId===law&&m.category==='専門教育');
  if(!m)continue;assert.equal(m.source.page,46);
  const oldCanonical=o.courseId?catalog.courses.find(c=>c.id===o.courseId)?.canonicalName:null;
  if(alreadyExcluded.has(o.id))assert.equal(oldCanonical,c.canonicalName);
  rows.push({offeringId:o.id,courseId:c.id,name:c.canonicalName,mappingId:m.mappingId,sourcePage:m.source.page,sourceSchooling:o.credits,excluded:stars.has(c.canonicalName),alreadyExcluded:alreadyExcluded.has(o.id),legacyCourseId:o.courseId,legacyCanonical:oldCanonical,public:m.requirementType==='公開科目',politics:politics.get(o.id)??null});
 }
 const excluded=rows.filter(r=>r.excluded),previous=excluded.filter(r=>r.alreadyExcluded),missed=excluded.filter(r=>!r.alreadyExcluded),publicRows=rows.filter(r=>r.public),ordinary=rows.filter(r=>!r.excluded&&!r.public&&!r.politics),repeat=rows.filter(r=>!r.excluded&&!r.public&&r.politics),sum=rs=>rs.reduce((n,r)=>n+r.sourceSchooling,0),politicsCredits=Math.min(4,new Set(repeat.map(r=>r.politics)).size*2);
 return {rows,excludedRows:excluded.length,excludedCredits:sum(excluded),alreadyExcludedRows:previous.length,alreadyExcludedCredits:sum(previous),newlyExcludedRows:missed.length,newlyExcludedCredits:sum(missed),publicRows:publicRows.length,publicCredits:sum(publicRows),otherCredits:sum(ordinary),politicsCredits,credits:sum(ordinary)+politicsCredits};
}
