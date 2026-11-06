import {readFileSync} from 'node:fs';
import {scenarios,calculateScenario} from './fixtures/unresolved-condition-scenarios.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {calculateRecordedCredits as calc} from '../src/planner/attempts/graduation/recordedCalculation.ts';
import {createNewPlanSource} from '../src/planner/attempts/persistence/newPlan.ts';
import {newAttempt,programs,catalog,initialState,officialRow} from './fixtures/yi07-graduation.mjs';
import {decode,env} from './fixtures/migration-fixture.mjs';
import {importRepeated,repeatedPayload,repeatProfile} from './fixtures/official-repeatable.mjs';
import {createAttemptPersistence} from '../src/planner/attempts/persistence/controller.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import rules from '../src/data/graduation_rules.json' with{type:'json'};
const s=await createNewPlanSource(),m=s.context.catalog;const g=as=>JSON.stringify({attempts:as,ownedRecords:[],removals:[]});
const find=(scope,name)=>{const p=m.placements.filter(p=>p.scopeId===scope&&p.officialName===name);assert.equal(p.length,1,name);return p[0];};
const a=(p,n=p.compositionCredits,method='correspondence')=>newAttempt(m,p,n,'earned',method);
const cases=[];async function check(name,f){await test(name,f);}
const law=programs.find(p=>p.department==='法律学科'),lp=find(law.scopeId,'法律学演習');
for(const n of [1,4,5])await check(`official-repeat-${n}-plus-personal`,async()=>{const state=importRepeated(repeatedPayload('法律学演習',n));const d=await decode(state);assert.equal(d.status,'decoded');const as=Array.from({length:6},()=>a(lp,2,'schooling'));const r=await calc(g(as),d.source,law.scopeId);cases.push({name:`official-repeat-${n}`,sourceState:state,raw:g(as),actual:r});assert.equal(r.courses[0].increment,0);assert.equal(r.courses[0].authority,'official');assert.equal(r.progress.cards.find(x=>x.requirementId==='professional-law-total').earned,Math.min(n*2,8));});
for(const prog of programs)await check(`total-lecture-held/${prog.displayName}`,async()=>{const ps=m.placements.filter(p=>p.scopeId===prog.scopeId&&p.auditRecord.canonicalName==='総合特講');assert.equal(ps.length,1);const r=await calc(g([a(ps[0],2,'schooling')]),s,prog.scopeId);cases.push({name:`total-lecture/${prog.displayName}`,actual:r});assert.ok(r.courses.every(c=>c.completedCredits===0));assert.ok(r.holds.length);});
for(const [dept,name,credits]of [['史学科','歴史資料学1〜6',2],['史学科','史学演習1',2],['地理学科','現地研究',1],['地理学科','人文地理学演習',2],['日本文学科','書道実技',2]]){
 const prog=programs.find(p=>p.department===dept),ps=m.placements.filter(p=>p.scopeId===prog.scopeId&&(p.officialName===name||p.auditRecord.canonicalName===name));
 for(const p of ps){const r=await calc(g([a(p,credits,'schooling')]),s,prog.scopeId);cases.push({name:`special/${dept}/${name}`,placement:p,actual:r});await check(`special-held/${dept}/${name}`,()=>{assert.ok(r.courses.every(c=>c.completedCredits===0));assert.ok(r.holds.length);});}
}
const geo=programs.find(p=>p.department==='地理学科');
const geoNames=['歴史地理学','人文地理学（農業）','人文地理学（都市）','自然地理学（地形）','自然地理学（生物・土壌）','自然地理学（気候・気象）','地誌学概論','日本地誌（1）（自然編）','日本地誌（2）（人文編）','世界地誌（1）（アジア）'];
for(const count of [8,9,10]){const as=geoNames.slice(0,count).map(n=>a(find(geo.scopeId,n)));const r=await calc(g(as),s,geo.scopeId),get=id=>r.progress.cards.find(x=>x.requirementId===id);cases.push({name:`geo-overflow-${count*4}`,raw:g(as),actual:r});await check(`geography-overflow-${count*4}`,()=>{assert.deepEqual(r.holds,[]);assert.equal(get('professional-geography-required-elective').earned,Math.min(count*4,36));assert.equal(get('professional-geography-elective').earned,Math.max(0,count*4-36));assert.equal(get('professional-geography-total').earned,count*4);assert.deepEqual(get('professional-geography-required-elective').details.map(x=>x.earned),[12,12,(count-6)*4]);});
 if(count===10){for(const [ruleId,n]of [['geography_human_required_elective_min_credits',12],['geography_physical_required_elective_min_credits',12],['geography_regional_required_elective_min_credits',16]])await check('F4/'+ruleId,()=>{const rule=rules.requirements.find(r=>r.ruleId===ruleId),actual=r.progress.requirements.find(x=>x.requirementId===rule.id);assert.equal(actual.earned,n);assert.equal(actual.status,'satisfied');});}
}
const lawNames=['民法総則','物権法','刑法総論','債権総論','債権各論','刑法各論','国際法総論','民事訴訟法','刑事訴訟法'];
for(const count of [7,8,9]){const as=lawNames.slice(0,count).map(n=>a(find(law.scopeId,n)));as.push(a(find(law.scopeId,'刑事政策')));const r=await calc(g(as),s,law.scopeId);cases.push({name:`law-overflow-${count}`,raw:g(as),actual:r});const get=id=>r.progress.cards.find(x=>x.requirementId===id);await check(`law-eight-course-overflow-${count}`,()=>{assert.deepEqual(r.holds,[]);assert.equal(get('professional-law-required-elective').earned,Math.min(count*4,32));assert.equal(get('professional-law-required-elective').status,count>=8?'satisfied':'unsatisfied');assert.equal(get('professional-law-elective').earned,4+Math.max(0,count*4-32));assert.equal(get('professional-law-total').earned,count*4+4);});}
const commonScope=catalog.programs.find(p=>p.isCommon).scopeId;const p=m.placements.find(p=>p.scopeId===commonScope&&p.compositionCredits===4&&p.category==='一般教育'&&p.identityDecision.status==='safe'&&p.auditRecord.placementStatus==='safe'&&!p.methodConstraint.requiredMethod);
for(const value of [0,4,null])await check(`multiple-official-rows-${value}`,async()=>{const st=initialState();const c=catalog.curriculum.courses.find(c=>c.id===p.auditRecord.oldCurriculumCourseId);st.importedCourseAchievements=[officialRow(c,4),{...officialRow(c,value),id:'second-official-id',fingerprint:'second-fingerprint'}];const d=await decode(st);assert.equal(d.status,'decoded');const r=await calc(g([a(p)]),d.source,law.scopeId);cases.push({name:`multiple-official-${value}`,sourceState:st,actual:r});assert.equal(r.courses[0].increment,0);});
for(const prog of programs)await check(`schema23-reference-schooling/${prog.displayName}`,async()=>{const st=initialState();st.graduationProfile={...st.graduationProfile,admissionType:'first_year',admissionYear:2026,curriculumApplicability:'current_2026'};const d=await decode(st);assert.equal(d.status,'decoded');const r=await calc(g([a(p,2),a(p,2,'schooling')]),d.source,prog.scopeId);cases.push({name:`schema23-reference/${prog.displayName}`,actual:r});assert.equal(r.progress.referenceProgress.find(x=>x.id==='schooling-reference-progress').earned,2);assert.equal(r.progress.referenceProgress.find(x=>x.id==='overall-reference-progress').earned,0);assert.equal(r.personalApplicability.status,'unverified');});
function memory(){let data=emptyAuthority();return {writes:0,async read(){return structuredClone(data);},async commit(expected,next){assert.deepEqual(data,expected);data=structuredClone(next);this.writes++;}};}
const locks={request:async(_n,_o,f)=>f()};
for(const kind of ['schema24','schema23'])await check(`persistence-positive-roundtrip-${kind}`,async()=>{const store=memory(),api=createAttemptPersistence(store,locks,async()=>env);let proposal;if(kind==='schema24')proposal=await api.prepareNewPlan();else{const d=await decode(initialState());proposal=await api.prepareMigration(await api.inspectLegacy(d.source.raw));}
 let h=await api.commit(proposal,true,proposal.previousRaw,proposal.sourceRaw);const at=a(p);const edit=await api.prepareEdits(h,[{kind:'add',operationId:at.creationOperationId,attempt:at}]);h=await api.commit(edit,true,edit.previousRaw,edit.sourceRaw);const after=await createAttemptPersistence(store,locks,async()=>env).load();assert.ok(after);const r=await calc(JSON.stringify(after.state.graph),after.source,law.scopeId);assert.equal(r.courses[0].completedCredits,4);cases.push({name:`roundtrip/${kind}`,writes:store.writes,sourceIdentitySame:after.source===h.source,result:r});});

// R2: retained official evidence, shared/misassociated detail and unrelated healthy record.
const audit=id=>JSON.parse(readFileSync(new URL(`./fixtures/work-b-audit/${id}.json`,import.meta.url)));
const auditedSource=x=>decode({...initialState(),...x.sourceOverrides});
const newCalc=(as,scope=law.scopeId)=>calc(g(as),s,scope);
for(const mode of ['shared','misassociated'])await check('F1 detail '+mode+' retains official row and unaffected record',async()=>{
 const x=audit('F1');if(mode==='misassociated')x.graph.attempts=x.graph.attempts.slice(0,1);
 const d=await auditedSource(x),before=JSON.stringify(d.source.state);
 const unaffected=a(find(law.scopeId,'民事訴訟法'));x.graph.attempts.push(unaffected);
 const r=await calc(JSON.stringify(x.graph),d.source,law.scopeId);
 for(const at of x.graph.attempts.filter(at=>at.id!==unaffected.id))assert.ok(r.holds.some(h=>h.attemptId===at.id&&h.reason===(mode==='shared'?'official_detail_shared':'official_association_unverified')));
 assert.equal(r.courses.filter(c=>c.authority==='learner_record').length,1);
 assert.equal(r.courses.find(c=>c.id===unaffected.identity.ref.institutionalCourseId).increment,4);
 assert.equal(r.progress.cards.find(c=>c.requirementId==='group-general').earned,4);
 assert.equal(JSON.stringify(d.source.state),before);
});
for(const amount of [4,0,null])await check('F2 explicit foreign official link with owner '+amount,async()=>{
 const x=audit('F2');x.sourceOverrides.importedCourseAchievements[0].earnedCreditsTotal=amount;
 const d=await auditedSource(x),at=x.graph.attempts[0],r=await calc(JSON.stringify(x.graph),d.source,x.scope);
 assert.ok(r.holds.some(h=>h.attemptId===at.id&&h.reason==='explicit_official_link_unresolved'));
 assert.equal(r.courses.find(c=>c.id===at.identity.ref.institutionalCourseId).increment,0);
 assert.equal(r.courses.find(c=>c.id===at.identity.ref.institutionalCourseId).authority,'official');
 assert.equal(at.plan.importedSourceCourseId,x.sourceOverrides.importedCourseAchievements[1].id);
});
for(const n of [0,1,2,3,4,5,6])for(const year of [2035,2036])await check('F3 learner same/different-year repeat '+n+'/'+year,async()=>{
 const as=Array.from({length:n},(_,i)=>{const at=a(lp,2,'schooling');at.plan.plannedYear=i%2?year:2035;return at;});const r=await newCalc(as);
 if(n>1){assert.equal(r.courses.length,0);assert.equal(new Set(r.holds.filter(h=>h.reason==='repeatable_independence_unverified').map(h=>h.attemptId)).size,n);}
 else assert.equal(r.courses[0]?.increment??0,n*2);
});
// Geography's raw partial S2 field progress is not Course completion/graduation credit.
await check('R5 geography S2 raw field progress2, incomplete Course, professional graduation0',async()=>{
 const scenario=structuredClone(scenarios().find(c=>c.name==='文学部 / 地理学科/C'));
 // Fixed S2 of the four-credit 経済地理学; C itself is a complete T2 course.
 const s2=scenario.catalog.offerings.find(o=>o.id==='0432dfc2-8a48-498d-b754-f030b480f571');
 scenario.items=[{offeringId:s2.id,status:'earned',plannedYear:2026,plannedTerm:null,studyYear:null,earnedOrder:null}];
 assert.equal(s2.method,'schooling');const legacy=calculateScenario(scenario);
 const row=legacy.requirements.find(r=>r.requirementId==='7f6c6015-9f88-4743-8993-c9f522abce04');
 assert.deepEqual([row.earned,row.target,row.status],[0,8,'unsatisfied']);
 const rule=rules.requirements.find(r=>r.id===row.requirementId);assert.equal(rule.conditions.min_courses,2);
 assert.equal(scenario.items.length,1);const opening=scenario.catalog.offerings.find(o=>o.id===scenario.items[0].offeringId);
 assert.equal(opening.credits,2);assert.equal(scenario.catalog.curriculum.courses.find(c=>c.id===opening.curriculumCourseId).curriculumCredits,4);
 for(const id of ['professional-geography-required-elective','professional-geography-total'])assert.equal(legacy.cards.find(c=>c.requirementId===id).earned,0);
 const placement=m.placements.find(p=>p.scopeId===scenario.scopeId&&p.auditRecord.oldCurriculumCourseId===opening.curriculumCourseId);
 const r=await newCalc([a(placement,2,'schooling')],scenario.scopeId);assert.ok(r.courses.every(c=>c.completedCredits===0));assert.ok(r.holds.length);
 assert.equal(r.progress.cards.find(c=>c.requirementId==='professional-geography-total').earned,0);
});
for(const program of programs)for(const parts of [['schooling'],['correspondence','schooling','schooling']])await check('F6 S-only/excess '+program.displayName+'/'+parts,async()=>{
 const r=await newCalc(parts.map(method=>a(p,2,method)),program.scopeId);assert.ok(r.courses.every(c=>c.completedCredits===0));assert.ok(r.holds.length);
});
await check('planned/in_progress are unknown columns and never earned',async()=>{
 const as=[a(p),a(p,2,'schooling')];as[0].plan.status='planned';as[1].plan.status='in_progress';const r=await newCalc(as);
 assert.equal(r.courses.length,0);for(const row of [...r.progress.cards,...r.progress.requirements]){assert.equal(row.planned,null);assert.equal(row.inProgress,null);}
 assert.equal(r.personalApplicability.status,'unverified');assert.equal(r.releaseReady,false);
});
await check('JSON duplicate decoded key, depth and primitive size limits',async()=>{
 for(const raw of ['{"attempts":[],"attempts":[],"ownedRecords":[],"removals":[]}','{"x":'+'['.repeat(65)+'0'+']'.repeat(65)+'}'])await assert.rejects(calc(raw,s,law.scopeId));
 await assert.rejects(calc(' '.repeat(1048577),s,law.scopeId),/primitive_graph_json_required/);
});
await check('F5 input / finite operands overflow / final output guard are distinct',async()=>{
 const {finiteNonnegativeSum,assertFiniteNumbers}=await import('../src/planner/graduation/finiteNumbers.ts');
 for(const values of [[NaN],[Infinity],[-1],[1e308,1e308]])assert.equal(finiteNonnegativeSum(values),null);
 assert.equal(finiteNonnegativeSum([2,2]),4);assert.equal(finiteNonnegativeSum([1e308]),1e308);
 for(const n of [NaN,Infinity,-Infinity])assert.throws(()=>assertFiniteNumbers({nested:[{earned:n}]}),/non_finite_graduation_result/);
 assert.doesNotThrow(()=>assertFiniteNumbers({earned:null,planned:null,finite:4}));
 await assert.rejects(calc(audit('F5').raw,s,law.scopeId),e=>e.code==='unrepresentable_json_number');
});
await check('low allocation guard binds full Mapping and Course; no evidence certificate',async()=>{
 const {calculateGraduationProgress}=await import('../src/planner/graduation/graduationProgress.ts');
 const mapping=catalog.mappings.find(x=>x.category==='一般教育'&&x.curriculumCredits===4);
 const course=catalog.curriculum.courses.find(c=>c.mappingIds.includes(mapping.mappingId));
 const allocation={mapping,credits:4,completedCredits:4,schoolingCredits:0,fact:{curriculumCourseId:course.id,canonicalName:course.canonicalName}};
 const run=x=>calculateGraduationProgress([],catalog,law.scopeId,[],undefined,[],[],initialState().graduationProfile,null,{},[x]);
 for(const key of ['category','department','course','faculty','scopeId','field'])assert.throws(()=>run({...allocation,mapping:{...mapping,[key]:'forged'}}),/invalid_recorded_allocation_mapping/);
 const different=catalog.curriculum.courses.find(c=>!c.mappingIds.includes(mapping.mappingId));
 assert.throws(()=>run({...allocation,fact:{curriculumCourseId:different.id,canonicalName:different.canonicalName}}),/invalid_recorded_allocation_mapping/);
 for(const x of [{completedCredits:5},{schoolingCredits:5},{credits:Infinity},{credits:NaN}])assert.throws(()=>run({...allocation,...x}),/invalid_recorded_allocation_quantity/);
 assert.doesNotThrow(()=>run(allocation));
});


const sixFields=[
 ['史学科','日本史','日本史の分野','1b783c86-e99e-4407-906b-4fed610c3dce',1],
 ['史学科','東洋史','東洋史の分野','b588eb9e-e08f-4059-8e37-d1df90165988',1],
 ['史学科','西洋史','西洋史の分野','d9010be2-cce5-4db6-8e7c-c8f279a3c430',1],
 ['地理学科','人文','人文地理の分野','7f6c6015-9f88-4743-8993-c9f522abce04',4],
 ['地理学科','自然','自然地理の分野','e7c03938-4546-46da-af20-0743b7cc71e3',4],
 ['地理学科','地誌・その他','地誌・その他の分野','7194208b-295c-4c85-89f6-9ed8a4bffae6',4],
];
for(const [dept,target,field,rid,earned]of sixFields)await check('F4 exact scoped correspondence and counterexamples '+target,async()=>{
 const {calculateGraduationProgress}=await import('../src/planner/graduation/graduationProgress.ts');
 const prog=programs.find(p=>p.department===dept),type=dept==='史学科'?'選択':'選択必修';
 const mapping=rules.mappings.find(x=>x.scopeId===prog.scopeId&&x.field===field&&x.requirementType===type&&x.curriculumCredits===4);
 assert.ok(mapping);const course=rules.curriculum.courses.find(c=>c.mappingIds.includes(mapping.mappingId));
 const run=(mappingChanges={},requirementChanges={})=>{
  const cat=structuredClone(rules),mp=cat.mappings.find(x=>x.mappingId===mapping.mappingId);Object.assign(mp,mappingChanges);
  Object.assign(cat.requirements.find(r=>r.id===rid).target,requirementChanges);
  const fact={mapping:mp,credits:4,completedCredits:4,schoolingCredits:0,fact:{curriculumCourseId:course.id,canonicalName:course.canonicalName}};
  return calculateGraduationProgress([],cat,prog.scopeId,[],undefined,[],[],initialState().graduationProfile,null,{},[fact]).requirements.find(x=>x.requirementId===rid);
 };
 assert.equal(run().earned,earned);
 for(const field of ['前置'+mapping.field,mapping.field+'の分野',mapping.field+'別',mapping.field.replace('の分野','')+'分野'])assert.equal(run({field}).earned,0);
 for(const changes of [{department:'無関係学科'},{category:'一般教育'},{requirementType:'必修'}])assert.equal(run(changes).earned,0);
 assert.equal(run({}, {curriculum_field:'前置'+target}).earned,0);
});

await check('schema23 decoder qualification cannot be cloned or forged',async()=>{
 const d=await decode(initialState());assert.equal(d.status,'decoded');
 await assert.rejects(calc(g([]),structuredClone(d.source),law.scopeId),/unvalidated_source/);
 await assert.rejects(calc(g([]),{...d.source},law.scopeId),/unvalidated_source/);
});
await check('multiple Placement candidates never gain positive credit',async()=>{
 const at=a(p);const other=m.placements.find(x=>x.id!==p.id);
 at.placement={status:'ambiguous',ref:null,candidateAuditIds:[],candidatePlacementIds:[p.id,other.id],reason:'synthetic ambiguity counterexample'};
 const r=await newCalc([at]);assert.equal(r.status,'calculated');assert.equal(r.courses.length,0);
 assert.ok(r.holds.some(h=>h.attemptId===at.id&&h.reason==='unique_safe_placement_required'));
});
