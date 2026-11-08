import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {snapshotValue} from './yi07-graduation.mjs';
export const f02Deltas=JSON.parse(readFileSync(new URL('./f02-baseline-deltas.json',import.meta.url)));
export const approvedDeltas=JSON.parse(readFileSync(new URL('./work-b-approved-deltas.json',import.meta.url)));
const present=(parent,key)=>Object.hasOwn(parent,key)?{present:true,value:parent[key]}:{present:false};
const esc=key=>String(key).replaceAll('~','~0').replaceAll('/','~1');
const ordered=rows=>rows.toSorted((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
/** Compare every property. IDs address rows, but ordering is separately protected.
 * Absence, explicit undefined, null, array order and duplicate IDs remain distinct.
 * No output value is replaced or normalized to a historical value. */
export function outputDeltas(actual,old,caseName){
 const deltas=[];
 function visit(a,b,path){
  if(a.present===b.present&&(!a.present||Object.is(a.value,b.value)))return;
  if(a.present&&b.present&&a.value!==null&&b.value!==null&&typeof a.value==='object'&&typeof b.value==='object'&&Array.isArray(a.value)===Array.isArray(b.value)){
   const av=a.value,bv=b.value;
   if(Array.isArray(av)&&['/requirements','/cards'].includes(path)){
    const ai=av.map(r=>r.requirementId),bi=bv.map(r=>r.requirementId);
    if(new Set(ai).size!==ai.length||new Set(bi).size!==bi.length)throw Error('duplicate_requirement_id');
    if(JSON.stringify(ai)!==JSON.stringify(bi))visit({present:true,value:ai},{present:true,value:bi},path+'/@order');
    const am=Object.fromEntries(av.map(r=>[r.requirementId,r])),bm=Object.fromEntries(bv.map(r=>[r.requirementId,r]));
    for(const key of new Set([...Object.keys(bm),...Object.keys(am)]))visit(present(am,key),present(bm,key),path+'/'+esc(key));
   }else{
    // Dense array append/removal is represented by the absent/present index.
    // Preserve sparse length as well (JSON snapshots themselves are dense).
    if(Array.isArray(av)&&((Object.keys(av).length!==av.length)||(Object.keys(bv).length!==bv.length))&&av.length!==bv.length)visit({present:true,value:av.length},{present:true,value:bv.length},path+'/@length');
    for(const key of new Set([...Object.keys(bv),...Object.keys(av)]))visit(present(av,key),present(bv,key),path+'/'+esc(key));
   }
   return;
  }
  const row={case:caseName,path,oldPresent:b.present,newPresent:a.present};
  if(b.present)row.old=b.value;if(a.present)row.new=a.value;deltas.push(row);
 }
 visit({present:true,value:snapshotValue(actual)},{present:true,value:snapshotValue(old)},'');
 return ordered(deltas);
}
function cells(rows){return ordered(rows.map(r=>({case:r.case,path:r.path,oldPresent:r.oldPresent,newPresent:r.newPresent,...(r.oldPresent?{old:r.old}:{}),...(r.newPresent?{new:r.new}:{})})));}
export function assertExactDeltas(actual,old,caseName,sets){
 assert.equal(typeof caseName,'string','explicit fixed case required');
 const approved=sets.flatMap(name=>name.startsWith('f02-')?f02Deltas[name.slice(4)]:approvedDeltas[name]).filter(r=>r.case===caseName);
 assert.deepEqual(outputDeltas(actual,old,caseName),cells(approved),caseName+' exact approved delta set');
}
export const compareFieldCorrected=(actual,old,caseName)=>assertExactDeltas(actual,old,caseName,['f02-192']);
export const compare168=(actual,old,caseName)=>assertExactDeltas(actual,old,caseName,['f02-168']);

export const compareCompletion=(actual,old,caseName)=>assertExactDeltas(actual,old,caseName,['f02-completion']);
