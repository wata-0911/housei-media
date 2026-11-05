import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateRecordedCredits as calc} from '../src/planner/attempts/graduation/recordedCalculation.ts';
import {createNewPlanSource} from '../src/planner/attempts/persistence/newPlan.ts';
import {newAttempt,programs,snapshotValue} from './fixtures/yi07-graduation.mjs';
import rules from '../src/data/graduation_rules.json' with{type:'json'};
const s=await createNewPlanSource(),m=s.context.catalog;
// Expected allocation categories and credits transcribed independently from official PDF pp46,49-52,54,56,58.
const specs=[
 ['118c5183-6aec-4fa1-905a-265f25d86db1','東洋史特講（中国思想史）',4,'選択','日本古代史',4,'選択'],
 ['3641eb3c-91bd-4094-a56e-6e0f0da660f5','金融論B',2,'選択必修','金融論A',2,'選択必修'],
 ['4d450b06-fb99-4bf2-a769-fe5f68dd337a','自然地理学概論（1）',2,'必修','人文地理学概論（1）',2,'必修'],
 ['6609ce7c-3d7a-423e-9f19-7841dd841ca9','監査論Ⅱ',2,'選択','金融論Ⅰ',2,'選択必修'],
 ['74e81655-5390-4980-984d-e4580f28594d','中国文芸史',4,'選択','日本文芸学概論',4,'必修'],
 ['aafa0eb9-e158-461c-9b15-83e41da1830d','日本文芸学概論',4,'必修','中国文芸史',4,'選択'],
 ['d242111d-f0c1-420b-a41f-a33a14d15909','日本文芸研究特講・上代☆',4,'選択必修','日本文芸学概論',4,'必修'],
 ['e31201f3-4f1d-432a-906e-6af94af294c9','民事訴訟法',4,'選択必修','刑事政策',4,'選択'],
];
const resolve=(scope,name)=>{const ps=m.placements.filter(p=>p.scopeId===scope&&p.officialName===name);assert.equal(ps.length,1,'must resolve exactly one named Placement');return ps[0];};
const pins=specs.map(([scope,n1,c1,t1,n2,c2,t2])=>({scope,program:programs.find(p=>p.scopeId===scope).displayName,courses:[[n1,c1,t1],[n2,c2,t2]].map(([name,credits,type])=>{const p=resolve(scope,name);return {name,credits,type,placementId:p.id,institutionalCourseId:p.institutionalCourseId,oldCourseId:p.auditRecord.oldCurriculumCourseId};})}));
const expectedCardIds={
 '史学科':[['professional-history-required','必修',16],['professional-history-schooling-required-elective','スクーリング選択必修',8],['professional-history-elective','選択',50]],
 '地理学科':[['professional-geography-required','必修',12],['professional-geography-schooling-required','スクーリング必修',6],['professional-geography-required-elective','選択必修',36],['professional-geography-elective','選択',12],['professional-geography-total','TOTAL',82]],
 '経済学科':[['professional-economics-required-elective','選択必修',24],['professional-economics-total','TOTAL',82]],
 '商業学科':[['professional-commerce-required-elective','選択必修',20],['professional-commerce-total','TOTAL',82]],
 '日本文学科':[['professional-required','必修',20],['professional-required-elective','選択必修',20],['professional-elective','選択',24],['professional-japanese-total','TOTAL',82]],
 '法律学科':[['professional-law-required-elective','選択必修',32],['professional-law-elective','選択',null],['professional-law-total','TOTAL',null],['professional-law-schooling','S',8]],
};
const cases=[];function check(name,f){return test(name,f);}
const project=p=>snapshotValue({requirements:p.requirements,cards:p.cards,referenceProgress:p.referenceProgress});
for(const pin of pins){const prog=programs.find(p=>p.scopeId===pin.scope);for(const mode of ['single','mixed'])for(const method of ['T','S']){
 const inputCourses=pin.courses.slice(0,mode==='single'?1:2);const as=inputCourses.flatMap(x=>{const p=m.placements.find(p=>p.id===x.placementId);assert.equal(p.institutionalCourseId,x.institutionalCourseId);assert.equal(p.officialName,x.name);return method==='T'?[newAttempt(m,p,x.credits,'earned','correspondence')]:x.credits===4?[newAttempt(m,p,2,'earned','correspondence'),newAttempt(m,p,2,'earned','schooling')]:[newAttempt(m,p,2,'earned','schooling')];});
 const raw=JSON.stringify({attempts:as,ownedRecords:[],removals:[]});const r=await calc(raw,s,pin.scope),name=`${pin.program}/${mode}/${method}`;const amounts={TOTAL:0,S:0};for(const x of inputCourses){amounts[x.type]=(amounts[x.type]??0)+x.credits;amounts.TOTAL+=x.credits;if(method==='S')amounts.S+=2;}
 const expectation=expectedCardIds[prog.department].map(([id,key,target])=>({id,earned:amounts[key]??0,target,status:target===null?'unknown':'unsatisfied'}));
 check(name+'/professional-all-cards',()=>{assert.deepEqual(r.holds,[]);assert.deepEqual(r.progress.cards.filter(x=>x.requirementId.startsWith('professional-')).map(x=>({id:x.requirementId,earned:x.earned,target:x.target,status:x.status})),expectation);});
 check(name+'/common-unaffected',()=>{for(const id of ['group-general','group-foreign','group-physical'])assert.equal(r.progress.cards.find(x=>x.requirementId===id).earned,0);});
 check(name+'/applicability-null-reference',()=>{for(const x of r.progress.referenceProgress){assert.equal(x.earned,null);assert.equal(x.target,null);assert.equal(x.status,'unknown');assert.equal(x.unknownReasonCategory,'curriculum_applicability');}assert.equal(r.personalApplicability.status,'unverified');assert.equal(r.releaseReady,false);});
 const reverse=await calc(JSON.stringify({attempts:as.toReversed(),ownedRecords:[],removals:[]}),s,pin.scope);check(name+'/order-independent-full-vector',()=>assert.deepEqual(project(r.progress),project(reverse.progress)));
 if(prog.department==='史学科')for(const [label,expected]of [['東洋史',1],['日本史',mode==='mixed'?1:0]]){const rule=rules.requirements.find(x=>x.scopeId===pin.scope&&x.ruleType==='min_courses'&&x.target?.curriculum_field===label);const actual=r.progress.requirements.find(x=>x.requirementId===rule.id);check(name+'/independent-field-'+label,()=>{assert.equal(actual.earned,expected);assert.equal(actual.status,expected?'satisfied':'unsatisfied');});}
 cases.push({name,pin,raw,expectedCards:expectation,actual:r,});
}}
// Explicit three-way overflow boundary: six distinct required electives, 24 credits => 20 + 4; add elective4 => total28.
for(const pin of pins.filter(p=>programs.find(x=>x.scopeId===p.scope).department==='日本文学科')){
 const names=['日本文芸研究特講・上代','日本文芸研究特講・中古','日本文芸研究特講・中世','日本文芸研究特講・近世','日本文芸研究特講・近代','日本文芸研究特講・言語'];
 const pp=names.map(n=>{const ps=m.placements.filter(p=>p.scopeId===pin.scope&&p.officialName.replace(/[☆◉◎]/g,'')===n);assert.equal(ps.length,1);return ps[0];});
 const elective=resolve(pin.scope,'中国文芸史'+(pin.scope==='d242111d-f0c1-420b-a41f-a33a14d15909'?'☆':''));
 for(const count of [4,5,6]){const as=pp.slice(0,count).map(p=>newAttempt(m,p,4,'earned','correspondence'));as.push(newAttempt(m,elective,4,'earned','correspondence'));const r=await calc(JSON.stringify({attempts:as,ownedRecords:[],removals:[]}),s,pin.scope);const get=id=>r.progress.cards.find(x=>x.requirementId===id).earned;check(`${pin.program}/overflow-${count*4}`,()=>{assert.deepEqual(r.holds,[]);assert.equal(get('professional-required-elective'),Math.min(20,count*4));assert.equal(get('professional-elective'),4+Math.max(0,count*4-20));assert.equal(get('professional-japanese-total'),count*4+4);});cases.push({name:`overflow-${pin.scope}-${count}`,raw:JSON.stringify({attempts:as,ownedRecords:[],removals:[]}),actual:r});}
}
