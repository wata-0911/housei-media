import assert from 'node:assert/strict';
import {test} from 'node:test';
import {catalog,initialState,calculateState,officialRow,programs} from './fixtures/yi07-graduation.mjs';
import {importRepeated,repeatedPayload,repeatProfile} from './fixtures/official-repeatable.mjs';
const scope='118c5183-6aec-4fa1-905a-265f25d86db1';
const specs=[['日本史の分野','1b783c86-e99e-4407-906b-4fed610c3dce'],['東洋史の分野','b588eb9e-e08f-4059-8e37-d1df90165988'],['西洋史の分野','d9010be2-cce5-4db6-8e7c-c8f279a3c430']];
const item=(o,n,status='earned')=>({offeringId:o.id,courseCreditContribution:n,status,plannedYear:2026,plannedTerm:null,studyYear:null,earnedOrder:null});
const run=(items,rows=[],cat=catalog,s=scope)=>{const state={...initialState(),items,importedCourseAchievements:rows};return calculateState(state,s,cat);};
for(const [field,rid]of specs){
 const os=catalog.offerings.filter(o=>o.method==='correspondence'&&o.resolutionStatus==='matched'&&o.curriculumCourseId&&o.mappingIds.some(id=>catalog.mappings.some(m=>m.mappingId===id&&m.scopeId===scope&&m.field===field&&m.requirementType==='選択'&&m.curriculumCredits===4)));
 const t=os[0],other=os.find(o=>o.curriculumCourseId!==t.curriculumCourseId),c=catalog.curriculum.courses.find(c=>c.id===t.curriculumCourseId);assert.ok(other);
 const row=p=>p.requirements.find(r=>r.requirementId===rid);
 const card=p=>p.cards.find(c=>c.requirementId==='professional-history-elective');
 for(const [label,items,n,credits]of [['T2',[item(t,2)],0,0],['T4',[item(t,4)],1,4],['different-T2',[item(t,2),item(other,2)],0,0],['different-T4',[item(t,4),item(other,4)],2,8]])test(field+'/'+label,()=>{
  const p=run(items);assert.equal(row(p).earned,n);assert.equal(row(p).status,n?'satisfied':'unsatisfied');assert.equal(card(p).earned,credits);
  assert.equal(card(p).details.find(d=>d.label.startsWith(field.replace('の分野',''))).earned,n);
 });
 for(const status of ['planned','in_progress'])test(field+'/'+status+' separate from earned',()=>{
  const p=run([item(t,4,status)]),r=row(p);assert.equal(r.earned,0);assert.equal(r.status,'unsatisfied');assert.equal(r[status==='planned'?'planned':'inProgress'],1);assert.equal(card(p).earned,0);
 });
 for(const amount of [0,4,null])test(field+'/official owns '+amount,()=>{
  const official=officialRow(c,amount),only=run([], [official]),mixed=run([item(t,4)],[official]);assert.deepEqual(mixed,only);
  if(amount===null){assert.equal(row(mixed).status,'unknown');assert.equal(row(mixed).earned,null);}else assert.equal(row(mixed).earned,amount===4?1:0);
 });
 test(field+'/official plus different Course',()=>{assert.equal(row(run([item(other,4)],[officialRow(c,4)])).earned,2);});
 for(const mode of ['identity-missing','identity-mismatch','relation-conflict','mapping-unknown','composition-unknown','unit-unknown'])test(field+'/'+mode+' cannot prove completion',()=>{
  const cat=structuredClone(catalog),o=cat.offerings.find(o=>o.id===t.id),course=cat.curriculum.courses.find(c=>c.id===t.curriculumCourseId);
  if(mode==='identity-missing')o.curriculumCourseId=null;
  if(mode==='identity-mismatch')o.curriculumCourseId=other.curriculumCourseId;
  if(mode==='relation-conflict')cat.curriculum.offeringRelations.find(r=>r.offeringId===o.id).candidateCurriculumCourseIds.push(other.curriculumCourseId);
  if(mode==='mapping-unknown')course.mappingIds=[];
  if(mode==='composition-unknown')course.curriculumCredits=null;
  if(mode==='unit-unknown')o.credits=null;
  const input=mode==='unit-unknown'?{...item(o,4),courseCreditContribution:undefined}:item(o,4),q=row(run([input],[],cat));assert.equal(q.status,'unknown');assert.equal(q.earned,null);
 });
 test(field+'/competing field mapping cannot be selected silently',()=>{
  const cat=structuredClone(catalog),o=cat.offerings.find(o=>o.id===t.id);
  const competing=cat.mappings.find(m=>m.scopeId===scope&&m.category==='専門教育'&&m.requirementType==='選択'&&m.field&&m.field!==field);
  o.mappingIds.push(competing.mappingId);const q=row(run([item(o,4)],[],cat));assert.equal(q.status,'unknown');assert.equal(q.earned,null);
 });
 test(field+'/same annual opening duplicate is not independent evidence',()=>{assert.equal(row(run([item(t,2),item(t,2)])).status,'unknown');});
 test(field+'/same name cannot merge different institutional identities',()=>{const cat=structuredClone(catalog);cat.offerings.find(o=>o.id===other.id).name=t.name;assert.equal(row(run([item(t,2),item(other,2)],[],cat)).earned,0);});
}
for(const ids of [['a41b5c04-4723-4dfd-805d-29b271e99afa','386b3eb5-ff6e-434d-a720-d32505b90bb0'],['386b3eb5-ff6e-434d-a720-d32505b90bb0','82cbc5a6-4868-4bc9-bb68-ed457bc3ab08']])test('same institutional Course '+ids+' completes once, no S2+S2 ban',()=>{
 const os=ids.map(id=>catalog.offerings.find(o=>o.id===id));assert.equal(os[0].curriculumCourseId,os[1].curriculumCourseId);
 const p=run(os.map(o=>item(o,2))),r=p.requirements.find(r=>r.requirementId===specs[1][1]);assert.equal(r.earned,1);assert.equal(r.status,'satisfied');assert.equal(p.cards.find(c=>c.requirementId==='professional-history-elective').earned,4);
 const incomplete=run([item(os[0],2,'earned'),item(os[1],2,'planned')]);assert.equal(incomplete.requirements.find(r=>r.requirementId===specs[1][1]).earned,0);
});
test('field scopes and similar names do not import another department',()=>{
 const foreign=catalog.offerings.find(o=>o.department==='法律学科'&&o.credits===4&&o.method==='correspondence');const cat=structuredClone(catalog);cat.offerings.find(o=>o.id===foreign.id).name='東洋史特講（中国思想史）';
 const p=run([item(foreign,4)],[],cat);for(const [,rid]of specs)assert.equal(p.requirements.find(r=>r.requirementId===rid).earned,0);
 const otherScope=programs.find(p=>p.department==='経済学科').scopeId;assert.ok(!run([],[],catalog,otherScope).requirements.some(r=>specs.some(([,id])=>id===r.requirementId)));
});
for(const n of [0,1,3,5,6])test('proven official repeat stays distinct and capped '+n,()=>{
 const st=importRepeated(repeatedPayload('法律学演習',n));st.graduationProfile=structuredClone(repeatProfile);const law=programs.find(p=>p.department==='法律学科'),cat=structuredClone(catalog);
 cat.requirements.push({id:'ra-repeat-count',ruleId:'ra_repeat_count',status:'structured',scopeId:law.scopeId,ruleType:'min_courses',target:{curriculum_category:'専門教育',requirement_type:'選択',course_name:'法律学演習'},conditions:null,value:1,unit:'courses',sourcePage:46});
 const p=calculateState(st,law.scopeId,cat),q=p.requirements.find(r=>r.requirementId==='ra-repeat-count');if(n===0){assert.equal(q.earned,null);assert.equal(q.status,'unknown');}else assert.equal(q.earned,Math.min(n,4));
 assert.equal(p.cards.find(c=>c.requirementId==='professional-law-total').earned,Math.min(n*2,8));
});
