// Test-only independent ledger over input evidence; no graduation engine calls.
import assert from 'node:assert/strict';
import {fieldLedger,fieldSpec} from './work-b-f4-oracle.mjs';
export const historyScope='118c5183-6aec-4fa1-905a-265f25d86db1';
const unsafe=new Set(['2d6c807e-e205-4fac-99e0-d12e71a83e1b','5654bd34-c642-4ffd-b8c7-7b647cde9569','566e8d96-4f4e-47f9-afd0-f4df8514ce8c','66544e51-780c-498d-a4d1-9f1ece599207','7d8e08ff-185c-486d-aa28-3c67dc9e9af9','8aaa4ddb-ea21-440c-ba2f-86740a9a1fd3','9423de04-3112-4b95-95d3-c40aa12417af','ca77f2ef-0e59-4ab1-8ecd-ea55c1d7ec7b','fed1ebe8-fa65-4acc-824c-9211982ddfa6']);
const missingNames=new Set(['08fc8f63-7eed-4092-8511-ad4446b7c20a','437596fb-daec-4a4f-8ba2-162dc71b92bc','de1ba568-532d-4a76-8ae1-331b194abdf9','f102810a-ec25-43ae-abcb-6d0d2426bb9d']);
const seminars=new Set(['37c71286-0a93-4880-b2ee-e7893567808c','d2188d54-9294-4ae9-ae9c-349c9fa7344b']);
const excluded=new Set(['39dc3686-b3dd-460e-b56d-dccc6151f44e','62f9fc30-1dae-45d0-b290-7a65b218c179','bc42b76d-e4e7-4629-ab17-7fe6900aee26']);
const fieldIds=['1b783c86-e99e-4407-906b-4fed610c3dce','b588eb9e-e08f-4059-8e37-d1df90165988','d9010be2-cce5-4db6-8e7c-c8f279a3c430'];
function unknownLedger(catalog,legacy){
 const scopes=new Set(catalog.programs.filter(p=>p.isCommon).map(p=>p.scopeId));scopes.add(historyScope);
 const relevant=catalog.requirements.filter(r=>(r.status==='unsupported'||scopes.has(r.scopeId))&&!excluded.has(r.id));
 assert.equal(relevant.length,74);
 const rows=[];
 for(const r of relevant){
  let reason=null;
  if(r.status==='unsupported')reason=r.reason;
  else if(unsafe.has(r.id)){assert.ok(r.conditions&&Object.keys(r.conditions).length);reason='条件または例外を安全に自動評価できません';}
  else if(missingNames.has(r.id)){
   assert.equal(typeof r.target.course_name,'string');
   assert.ok(!catalog.offerings.some(o=>o.name===r.target.course_name&&o.resolutionStatus==='matched'),'named target has no annual exact match');
   reason='対象科目のmappingを一意に特定できません';
  }else if(seminars.has(r.id)){assert.equal(r.target.course_name,'史学演習');reason='修得順により割当が変わるため自動評価できません';}
  else if(legacy&&fieldIds.includes(r.id))reason='制度科目identityまたは履修の所有関係が不明のため、完成科目数を保留しています';
  if(reason){
   const label=r.status==='unsupported'?r.scopeLabel:r.target.course_name??r.target.course_names?.join('・')??[r.target.curriculum_category,r.target.curriculum_field,r.target.requirement_type].filter(Boolean).join('：');
   rows.push({requirementId:r.id,label,reason});
  }
 }
 const grouped=new Map();
 for(const row of rows){const g=grouped.get(row.reason)??{reason:row.reason,count:0,labels:[]};g.count++;if(g.labels.length<3&&!g.labels.includes(row.label))g.labels.push(row.label);grouped.set(row.reason,g);}
 return {evaluableCount:relevant.length-rows.length,unknownCount:rows.length,unknownReasons:[...grouped.values()].toSorted((a,b)=>b.count-a.count),rows};
}
export function legacyInputLedger(catalog,legacy,itemsByStatus){
 assert.equal(legacy.curriculum,undefined);assert.equal(legacy.offerings.filter(o=>o.curriculumCourseId).length,0);assert.deepEqual([...new Set(legacy.courses.map(c=>c.identityStatus))],['provisional']);
 assert.equal(catalog.curriculum.courses.length,321);assert.equal(catalog.curriculum.offeringRelations.length,686);
 const fields=[];
 for(const [status,items]of Object.entries(itemsByStatus))for(const rid of fieldIds){
  const ledger=fieldLedger(catalog,{scopeId:historyScope,state:{items}},rid);
  const fixed={'日本史の分野':11,'東洋史の分野':7,'西洋史の分野':8}[fieldSpec[rid][1]];
  assert.equal(ledger.values[status==='in_progress'?'inProgress':status],fixed);
  fields.push({status,requirementId:rid,...ledger});
 }
 return {current:unknownLedger(catalog,false),legacy:unknownLedger(catalog,true),fields};
}
