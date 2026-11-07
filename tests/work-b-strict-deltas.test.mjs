import {fieldLedger} from './fixtures/work-b-f4-oracle.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {approvedDeltas,f02Deltas,compareCompletion,compareFieldCorrected,compare168,outputDeltas} from './fixtures/work-b-field-baseline.mjs';
import {legacyCases,catalog,calculateState,calculateCompletion,snapshotValue} from './fixtures/yi07-graduation.mjs';
import {scenarios,calculateScenario} from './fixtures/unresolved-condition-scenarios.mjs';
const fixture=name=>JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/'+name,import.meta.url))));
const b192=fixture('yi07-legacy-baseline.json.gz'),b168=fixture('work-b-field-168-full.json.gz');
const c192=legacyCases(),c168=scenarios();
const expected=(base,name)=>base.cases.find(c=>c.name===name).output;
const snapshots192=new Map(),snapshots168=new Map();
for(const c of c192)snapshots192.set(c.name,snapshotValue(calculateState(c.state,c.scopeId)));
for(const c of c168)snapshots168.set(c.name,snapshotValue(calculateScenario(c)));
test('strict 192/168 exact F02 deltas with immutable historical F4/P2 manifests',()=>{
 assert.deepEqual(c192.map(c=>c.name),b192.cases.map(c=>c.name));assert.equal(c192.length,192);
 assert.deepEqual(c168.map(c=>c.name),b168.cases.map(c=>c.name));assert.equal(c168.length,168);
 assert.deepEqual(Object.fromEntries(Object.entries(approvedDeltas).map(([k,v])=>[k,v.length])),{'192-f4':50,'168-f4':16,'168-p2':6});
 for(const [cases,base,current,compare]of [[c192,b192,snapshots192,compareFieldCorrected],[c168,b168,snapshots168,compare168]]){
  let count=0;for(const c of cases){compare(current.get(c.name),expected(base,c.name),c.name);count+=outputDeltas(current.get(c.name),expected(base,c.name),c.name).length;}
  assert.equal(count,cases.length===192?892:24);
 }
 for(const c of c192)compareCompletion(snapshotValue(calculateCompletion(c.state,c.scopeId)),b192.cases.find(b=>b.name===c.name).completionOutput,c.name);
});
test('168 full baseline reconstructs every unchanged historical hash',()=>{
 const hashes=JSON.parse(readFileSync(new URL('./fixtures/unresolved-engine-baseline.json',import.meta.url)));
 const restore=x=>x&&typeof x==='object'?(x.$yi07Type==='undefined'?undefined:Array.isArray(x)?x.map(restore):Object.fromEntries(Object.entries(x).map(([k,v])=>[k,restore(v)]))):x;
 for(const c of b168.cases)assert.equal(createHash('sha256').update(JSON.stringify(restore(c.output))).digest('hex'),hashes.scenarios[c.name],c.name);
});
// Independent input ledger counts completed institutional subjects, not openings.
function independentlyExpected(cell){
 const c=c192.find(c=>c.name===cell.case);
 return fieldLedger(catalog,c,cell.requirementId).values[cell.field];
}
for(const cell of approvedDeltas['192-f4'])test('independent approved new value '+cell.case+'/'+cell.requirementId+'/'+cell.field,()=>{
 const corrected=f02Deltas['192'].find(r=>r.case===cell.case&&r.path===cell.path);
 assert.equal(corrected?.new??cell.old,independentlyExpected(cell));
 const actual=snapshots192.get(cell.case).requirements.find(r=>r.requirementId===cell.requirementId);
 assert.equal(actual[cell.field],independentlyExpected(cell));
});
// Every allowed cell must reject a wrong value and a missing required delta.
for(const [set,base,current,compare]of [['192-f4',b192,snapshots192,compareFieldCorrected],['168-f4',b168,snapshots168,compare168],['168-p2',b168,snapshots168,compare168]]){
 function mutate(root,path,value,present=true){const keys=path.slice(1).split('/');let p=root;
  for(const key of keys.slice(0,-1))p=Array.isArray(p)&&p[0]?.requirementId?p.find(r=>r.requirementId===key):p[key];
  if(present)p[keys.at(-1)]=value;else delete p[keys.at(-1)];
 }
 for(const cell of approvedDeltas[set])for(const mode of ['999','missing'])test(`mutation ${set} ${cell.case}${cell.path} ${mode}`,()=>{
  const actual=structuredClone(current.get(cell.case));const corrected=f02Deltas[base===b192?'192':'168'].find(r=>r.case===cell.case&&r.path===cell.path);
  mutate(actual,cell.path,mode==='999'?999:corrected?corrected.old:undefined,mode==='999'||(corrected?corrected.oldPresent:false));
  assert.throws(()=>compare(actual,expected(base,cell.case),cell.case),assert.AssertionError);
 });
 for(const mode of ['extra-case','extra-field','card','reference','unknown','order','undefined-vs-absent','completion'])test(`mutation ${set} protected ${mode}`,()=>{
  const c=base.cases.find(c=>!approvedDeltas[set].some(r=>r.case===c.name)),actual=structuredClone(current.get(c.name)),old=expected(base,c.name);
  if(mode==='extra-case')actual.requirements[0].earned=999;
  if(mode==='extra-field')actual.requirements[0].unapproved=999;
  if(mode==='card')actual.cards[0].earned=999;
  if(mode==='reference')actual.referenceProgress[0].earned=999;
  if(mode==='unknown')actual.unknownCount=999;
  if(mode==='order')actual.requirements.reverse();
  if(mode==='undefined-vs-absent')actual.extraUndefined=undefined;
  if(mode==='completion')actual.graduationCheckComplete=true;
  assert.throws(()=>compare(actual,old,c.name),assert.AssertionError);
 });
}

test('mutation actual Course completion output is protected separately',()=>{
 const old=b192.cases[0].completionOutput,actual=structuredClone(old);
 const wrapped={completionOutput:actual},baseline={completionOutput:old};
 wrapped.completionOutput={...actual,unapproved:999};
 assert.throws(()=>compareFieldCorrected(wrapped,baseline,'completion-only'),assert.AssertionError);
});
