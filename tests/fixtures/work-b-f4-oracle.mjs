// Test-only independent arithmetic ledger. Never calls production match/completion helpers.
export const fieldSpec={
 '1b783c86-e99e-4407-906b-4fed610c3dce':['史学科','日本史の分野',1,'courses'],
 'b588eb9e-e08f-4059-8e37-d1df90165988':['史学科','東洋史の分野',1,'courses'],
 'd9010be2-cce5-4db6-8e7c-c8f279a3c430':['史学科','西洋史の分野',1,'courses'],
 '7194208b-295c-4c85-89f6-9ed8a4bffae6':['地理学科','地誌・その他の分野',16,'credits'],
 '7f6c6015-9f88-4743-8993-c9f522abce04':['地理学科','人文地理の分野',8,'credits'],
 'e7c03938-4546-46da-af20-0743b7cc71e3':['地理学科','自然地理の分野',8,'credits'],
};
export function fieldLedger(catalog,c,rid){
 const [dept,field,target,unit]=fieldSpec[rid],groups=new Map(),rows=[];
 const accepted=catalog.mappings.filter(m=>m.scopeId===c.scopeId&&m.department===dept&&m.category==='専門教育'&&m.field===field&&m.requirementType===(dept==='史学科'?'選択':'選択必修'));
 for(const item of c.state.items){
  const status={earned:'earned',in_progress:'inProgress',planned:'planned'}[item.status];if(!status)continue;
  const o=catalog.offerings.find(o=>o.id===item.offeringId),ms=accepted.filter(m=>o.mappingIds.includes(m.mappingId));
  if(o.resolutionStatus!=='matched'||!ms.length)continue;
  const course=catalog.curriculum.courses.find(x=>x.id===o.curriculumCourseId),relation=catalog.curriculum.offeringRelations.find(r=>r.offeringId===o.id);
  const proven=course&&relation?.curriculumCourseId===course.id&&relation.candidateCurriculumCourseIds.length===1&&ms.every(m=>course.mappingIds.includes(m.mappingId)&&course.scopeIds.includes(m.scopeId)&&m.curriculumCredits===course.curriculumCredits);
  if(unit==='courses'&&!proven)throw Error('oracle evidence missing '+o.id);
  const credits=item.courseCreditContribution??o.credits;
  const id=proven?course.id:'unresolved:'+o.id;
  const group=groups.get(id)??{id,composition:proven?course.curriculumCredits:unit==='credits'?ms[0].curriculumCredits:null,earned:0,inProgress:0,planned:0};group[status]+=credits;groups.set(id,group);
  rows.push({courseId:course?.id??null,offeringId:o.id,method:o.method,status,credits,composition:course?.curriculumCredits??null,mappingIds:ms.map(m=>m.mappingId)});
 }
 const values={earned:0,inProgress:0,planned:0};
 const completed=g=>{const rr=rows.filter(r=>(r.courseId??'unresolved:'+r.offeringId)===g.id&&r.status==='earned');
  if(unit==='credits'&&rr.some(r=>['地誌学特講','人文地理学演習','自然地理学演習'].includes(catalog.curriculum.courses.find(c=>c.id===r.courseId)?.canonicalName??catalog.offerings.find(o=>o.id===r.offeringId)?.name))) return true;
  return g.composition===4?rr.some(r=>r.method==='correspondence'&&r.credits===4):g.composition===2&&rr.length>0&&rr.every(r=>r.credits===2);};
 for(const status of Object.keys(values))values[status]=unit==='courses'?[...groups.values()].filter(g=>g.composition>0&&(status==='earned'?completed(g):g[status]>=g.composition)).length:status==='earned'?[...groups.values()].reduce((s,g)=>s+(completed(g)?(catalog.curriculum.courses.find(c=>c.id===g.id)?.canonicalName==='地誌学特講'?g.earned:g.composition):0),0):rows.filter(r=>r.status===status).reduce((s,r)=>s+r.credits,0);
 return {values:{...values,status:values.earned>=target?'satisfied':'unsatisfied'},rows,groups:[...groups.values()],target,unit};
}
