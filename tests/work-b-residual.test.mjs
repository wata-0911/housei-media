import assert from 'node:assert/strict';
import {test} from 'node:test';
import {catalog,initialState,calculateState,officialRow} from './fixtures/yi07-graduation.mjs';

// Real institutional Course identities, not names or annual Offering counts.
const scope='118c5183-6aec-4fa1-905a-265f25d86db1';
const specs=[['日本史の分野','1b783c86-e99e-4407-906b-4fed610c3dce'],['東洋史の分野','b588eb9e-e08f-4059-8e37-d1df90165988'],['西洋史の分野','d9010be2-cce5-4db6-8e7c-c8f279a3c430']];
function setup(field,rid,named=false,value=1){
 const cat=structuredClone(catalog);
 const courses=cat.curriculum.courses.filter(c=>c.curriculumCredits===4&&c.mappingIds.some(id=>cat.mappings.some(m=>m.mappingId===id&&m.scopeId===scope&&m.field===field&&m.requirementType==='選択'))).slice(0,3);
 assert.equal(courses.length,3);
 const rule=cat.requirements.find(r=>r.id===rid);rule.value=value;
 if(named)rule.target={course_names:courses.map(c=>c.canonicalName)};
 const state=initialState();state.graduationProfile={...state.graduationProfile,admissionYear:2026,admissionType:'first_year',curriculumApplicability:'current_2026'};
 state.thesisSelection='not_selected';
 const progress=()=>calculateState(state,scope,cat);
 const row=()=>progress().requirements.find(r=>r.requirementId===rid);
 return {cat,courses,rule,state,progress,row};
}
for(const [field,rid] of specs)for(const named of [false,true]){
 const label=`residual H41 ${field}/${named?'named-general-min_courses':'F4-field-min_courses'}`;
 test(label+' known2 + independent unknown preserves proven success',()=>{
  const x=setup(field,rid,named);x.state.importedCourseAchievements=x.courses.slice(0,2).map(c=>officialRow(c,4));
  const before=x.row();assert.equal(before.earned,2);assert.equal(before.status,'satisfied');
  x.state.importedCourseAchievements.push(officialRow(x.courses[2],null));
  const p=x.progress(),after=p.requirements.find(r=>r.requirementId===rid);assert.deepEqual(after,before);
  assert.equal(p.referenceProgress[0].status,'unknown');
  assert.equal(p.referenceProgress[0].earned,8,'unknown is excluded from the proven lower bound, not certified as zero');
 });
 test(label+' unmet + unknown is held, never a definitive zero or failure',()=>{
  const x=setup(field,rid,named,3);x.state.importedCourseAchievements=[officialRow(x.courses[0],4),officialRow(x.courses[1],null)];
  const row=x.row();assert.equal(row.status,'unknown');assert.equal(row.earned,null);
 });
 test(label+' explicit official0 is zero and adds no uncertainty',()=>{
  const x=setup(field,rid,named);x.state.importedCourseAchievements=x.courses.slice(0,2).map(c=>officialRow(c,4));
  const before=x.row();x.state.importedCourseAchievements.push(officialRow(x.courses[2],0));assert.deepEqual(x.row(),before);
  x.state.importedCourseAchievements=[officialRow(x.courses[0],0)];assert.equal(x.row().earned,0);assert.equal(x.row().status,'unsatisfied');
 });
 test(label+' conflicting duplicate cannot preserve an unproven second completion',()=>{
  const x=setup(field,rid,named,2);x.state.importedCourseAchievements=x.courses.slice(0,2).map(c=>officialRow(c,4));
  assert.equal(x.row().status,'satisfied');
  x.state.importedCourseAchievements.push({...officialRow(x.courses[0],null),id:'residual-conflict',fingerprint:'residual-conflict'});
  assert.equal(x.row().status,'unknown');assert.equal(x.row().earned,null);
 });
 test(label+' unknown identity is a global hold even with known2',()=>{
  const x=setup(field,rid,named);x.state.importedCourseAchievements=x.courses.slice(0,2).map(c=>officialRow(c,4));
  const row={...officialRow(x.courses[2],null),curriculumCourseId:null,curriculumMatch:'unmatched',candidateCurriculumCourseIds:[]};
  x.state.importedCourseAchievements.push(row);const after=x.row();assert.equal(after.status,'unknown');assert.equal(after.earned,2);
 });
 test(label+' competing Mapping ownership remains held',()=>{
  const x=setup(field,rid,named,2);x.state.importedCourseAchievements=x.courses.slice(0,2).map(c=>officialRow(c,4));
  assert.equal(x.row().status,'satisfied');
  x.courses[2].mappingIds.push(x.courses[0].mappingIds[0]);x.state.importedCourseAchievements.push(officialRow(x.courses[2],null));
  assert.equal(x.row().status,'unknown');
 });
 test(label+' official null owns the Course despite a positive learner item',()=>{
  const x=setup(field,rid,named,2),o=x.cat.offerings.find(o=>o.curriculumCourseId===x.courses[1].id&&o.resolutionStatus==='matched');assert.ok(o);
  x.state.items=[{offeringId:o.id,status:'earned',courseCreditContribution:4,plannedYear:2026,plannedTerm:null,studyYear:null,earnedOrder:null}];
  x.state.importedCourseAchievements=[officialRow(x.courses[0],4),officialRow(x.courses[1],null)];
  assert.equal(x.row().status,'unknown');assert.equal(x.row().earned,null);
 });
}

for(const [field,rid] of specs){
 const pool=catalog.curriculum.courses.filter(c=>c.curriculumCredits===4&&c.mappingIds.some(id=>catalog.mappings.some(m=>m.mappingId===id&&m.scopeId===scope&&m.field===field&&m.requirementType==='選択')));
 const os=c=>catalog.offerings.filter(o=>o.curriculumCourseId===c.id&&o.resolutionStatus==='matched');
 const course=pool.find(c=>os(c).some(o=>o.method==='correspondence')&&os(c).some(o=>o.method==='schooling'));
 assert.ok(course);
 const t=os(course).find(o=>o.method==='correspondence'),s=os(course).find(o=>o.method==='schooling');
 for(const status of ['earned','in_progress','planned'])test(`residual ${field}/T2+S2 ${status} keeps lifecycle independent`,()=>{
  const x=setup(field,rid);x.state.items=[t,s].map(o=>({offeringId:o.id,status,courseCreditContribution:2,plannedYear:2026,plannedTerm:null,studyYear:null,earnedOrder:null}));
  const q=x.row(),column=status==='in_progress'?'inProgress':status;
  assert.equal(q[column],status==='earned'?0:1);assert.equal(q.earned,0);assert.equal(q.status,status==='earned'?'unknown':'unsatisfied');
  assert.equal(x.progress().cards.find(c=>c.requirementId==='professional-history-elective').earned,0);
 });
 test(`residual ${field}/S2+S2 ownership alone cannot prove independent content`,()=>{
  const x=setup(field,rid),pairCourse=pool.find(c=>os(c).filter(o=>o.method==='schooling').length>=2);
  const openings=pairCourse?os(pairCourse).filter(o=>o.method==='schooling').slice(0,2):[s,s];
  x.state.items=openings.map(o=>({offeringId:o.id,status:'earned',courseCreditContribution:2,plannedYear:2026,plannedTerm:null,studyYear:null,earnedOrder:null}));
  const q=x.row();
  if(pairCourse){assert.equal(q.earned,0);assert.equal(q.status,'unknown');assert.equal(x.progress().cards.find(c=>c.requirementId==='professional-history-elective').earned,0);}
  else{assert.equal(q.earned,null);assert.equal(q.status,'unknown');assert.match(q.reason,/所有関係/);}
 });
}
