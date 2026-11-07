// Test-only arithmetic from shiori2026 pp.31,45,47. No production allocation,
// matcher, completion or repeat helper is imported. Annual input rows are listed
// against their exact curriculum identity before summing any consumer values.
export function foreignLedger(state,catalog) {
 const groups=new Map(),languages=Object.fromEntries(['英語','独語','仏語'].map(n=>[n,{earned:0,schooling:0,rows:[]} ]));
 for(const i of state.items.filter(i=>i.status==='earned')) {
  const o=catalog.offerings.find(o=>o.id===i.offeringId);if(o?.resolutionStatus!=='matched')continue;
  const ms=catalog.mappings.filter(m=>o.mappingIds.includes(m.mappingId)&&m.category==='外国語');
  for(const m of new Map(ms.map(m=>[m.field,m])).values()) {
   const key=o.curriculumCourseId??m.mappingId,g=groups.get(key)??{language:m.field,target:m.curriculumCredits,rows:[]};
   g.rows.push({offeringId:o.id,method:o.method,n:i.courseCreditContribution===undefined?o.credits:i.courseCreditContribution});groups.set(key,g);
  }
 }
 for(const g of groups.values()) {
  const l=languages[g.language];if(!l)continue;
  if(g.target===1){const proper=g.rows.filter(r=>r.method==='schooling'&&r.n===1);l.earned+=proper.length;l.schooling+=proper.length;}
  else if(g.target===2&&g.rows.some(r=>r.n===2)){l.earned+=2;if(g.rows.some(r=>r.method==='schooling'&&r.n===2))l.schooling+=2;}
  else throw Error('foreign ledger requires a separately reviewed composition');
  l.rows.push(g);
 }
 return languages;
}

export function lawLedger(state,catalog,scope) {
 const politicsSessions=new Map([['e0c4749c-d0ac-40af-8bd0-2952f7da9a88','summer'],['81911901-205b-49ff-8efc-a0440bf15309','summer'],['f0ec8fff-cf06-4a95-a0b4-266670a07b8f','winter'],['4bf76def-db1f-46c8-a3bc-df3f8cac1164','winter'],['5c3198fc-10c5-4806-bb2f-bd477670fbf3','media-first-term']]);
 const repeats={'政治学':4,'法律学演習':8,'法律学特講':8,'総合特講':16},groups=new Map();
 for(const i of state.items.filter(i=>i.status==='earned')) {
  const o=catalog.offerings.find(o=>o.id===i.offeringId);if(o?.resolutionStatus!=='matched')continue;
  const maps=catalog.mappings.filter(m=>o.mappingIds.includes(m.mappingId)&&m.scopeId===scope&&m.category==='専門教育');if(!maps.length)continue;
  const c=catalog.curriculum.courses.find(c=>c.id===o.curriculumCourseId);if(!c)throw Error('exact law identity required');if(c.canonicalName==='卒業論文')continue;
  const types=new Set(maps.map(m=>m.requirementType));if(types.size!==1)throw Error('review ambiguous law allocation separately');
  const m=maps[0],g=groups.get(c.id)??{id:c.id,name:c.canonicalName,type:m.requirementType,target:m.curriculumCredits,rows:[]};
  g.rows.push({id:o.id,method:o.method,n:i.courseCreditContribution===undefined?o.credits:i.courseCreditContribution});groups.set(c.id,g);
 }
 let required=0,pure=0,partial=0,count=0;
 for(const g of groups.values()) {
  let credits=0;
  if(g.name==='政治学'){const eligible=g.rows.filter(r=>r.n===2);if(eligible.some(r=>!politicsSessions.has(r.id)))throw Error('review the original politics opening separately');credits=Math.min(4,new Set(eligible.map(r=>politicsSessions.get(r.id))).size*2);}
  else if(repeats[g.name])credits=Math.min(repeats[g.name],g.rows.filter(r=>r.n===2).length*2);
  else if(g.target===4)credits=g.rows.some(r=>r.method==='correspondence'&&r.n===4)?4:0;
  else if(g.target===2)credits=g.rows.some(r=>r.n===2)?2:0;
  else throw Error('separately review law composition');
  g.counted=credits;
  if(g.type==='選択必修'){required+=credits;if(credits===4)count++;}else if(g.type==='選択')pure+=credits;
 }
 if(count>=8&&required>=32)for(const g of groups.values())if(!g.counted&&g.target===4&&['選択','選択必修'].includes(g.type)&&g.rows.length===1&&g.rows[0].method==='schooling'&&g.rows[0].n===2)partial+=2;
 const thesis=state.thesisProgressByScope?.[scope];const thesisCredits=thesis?.selection==='selected'&&thesis.status==='earned'?4:0;
 const publicCredits=Math.min(16,(state.publicCourses??[]).filter(p=>p.status==='earned').reduce((n,p)=>n+p.credits,0));
 return {required,count,pure,partial,publicCredits,thesisCredits,elective:pure+Math.max(0,required-32)+partial+publicCredits+thesisCredits,total:required+pure+partial+publicCredits+thesisCredits,groups:[...groups.values()]};
}
