import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {finalizeExtraction, boundary, isSafeExtractionFailure} from '../../shared/grade-import/extractor.js';
import {harness} from './fixtures/extraction-dom.mjs';
const secret='SECRET_PERSONAL_GRADE_VALUE';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/extraction-741e780.json',import.meta.url),'utf8')).outcomes.normal32;
const extension=readFileSync(new URL('../../extension/hosei-planner-import/parser/extractor.js',import.meta.url),'utf8');
const bookmarklet=decodeURIComponent(JSON.parse(readFileSync(new URL('../../src/generated/gradeImportBookmarklet.json',import.meta.url),'utf8')).bookmarklet.slice(11));
const fresh=()=>structuredClone(baseline);
const capture=action=>{try{action();}catch(error){return error;}assert.fail('expected failure');};
const ctx=()=>({__proto__:null,tableIndex:2});
const cases=[
 ['assemble throws',null,'GI_EXTRACT_FINAL_ASSEMBLE','result'],
 ['non-record result',()=>null,'GI_EXTRACT_FINAL_RESULT','result'],
 ['invalid ok',r=>{r.ok=secret;},'GI_EXTRACT_FINAL_RESULT','result.ok'],
 ['null diagnostics',r=>{r.diagnostics=null;},'GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics'],
 ['non-record value',r=>{r.value=[];},'GI_EXTRACT_FINAL_VALUE','result.value'],
 ['non-array courses',r=>{r.value.courses=secret;},'GI_EXTRACT_FINAL_COURSES','value.courses'],
 ['invalid schemaVersion',r=>{r.value.schemaVersion=secret;},'GI_EXTRACT_FINAL_METADATA','value.schemaVersion'],
 ['invalid source',r=>{r.value.source=secret;},'GI_EXTRACT_FINAL_METADATA','value.source'],
 ['invalid capturedAt',r=>{r.value.capturedAt={secret};},'GI_EXTRACT_FINAL_METADATA','value.capturedAt'],
 ['invalid failure reason',r=>{r.ok=false;r.reason=secret;},'GI_EXTRACT_FINAL_FAILURE_RESULT','result.reason'],
];
for(const [name,mutate,code,field] of cases)test(`finalize stage: ${name}`,()=>{
 const r=fresh();let returned=mutate?.(r);const value=returned===null?null:r;
 const error=capture(()=>boundary('GI_EXTRACT_EXCEPTION',ctx(),()=>finalizeExtraction(ctx(),()=>{if(!mutate)throw new Error(secret);return value;})));
 assert.deepEqual({...error},{code,tableIndex:2,field});assert.ok(isSafeExtractionFailure(error));
 assert.doesNotMatch(JSON.stringify(error),new RegExp(secret));
});
const getters=[
 ['ok','GI_EXTRACT_FINAL_RESULT','result.ok'],
 ['diagnostics','GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics'],
 ['diagnostics.tableCandidates','GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.tableCandidates'],
 ['diagnostics.tieCandidateIndexes','GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.tieCandidateIndexes'],
 ['diagnostics.selectedCandidateIndex','GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.selectedCandidateIndex'],
 ['value','GI_EXTRACT_FINAL_VALUE','result.value'],
 ['value.courses','GI_EXTRACT_FINAL_COURSES','value.courses'],
 ['value.schemaVersion','GI_EXTRACT_FINAL_METADATA','value.schemaVersion'],
 ['value.source','GI_EXTRACT_FINAL_METADATA','value.source'],
 ['value.capturedAt','GI_EXTRACT_FINAL_METADATA','value.capturedAt'],
 ['reason','GI_EXTRACT_FINAL_FAILURE_RESULT','result.reason'],
];
for(const [path,code,field] of getters)test(`finalize getter: ${path}, raw throwable never inspected`,()=>{
 const r=fresh();if(path==='reason')r.ok=false;
 const parts=path.split('.');const key=parts.pop();let owner=r;for(const part of parts)owner=owner[part];
 let reads=0;const raw=new Proxy({message:secret,cause:{secret},privateValue:secret},{get(){reads++;throw new Error(secret);},getPrototypeOf(){reads++;throw new Error(secret);}});
 Object.defineProperty(owner,key,{enumerable:true,get(){throw raw;}});
 const error=capture(()=>boundary('GI_EXTRACT_EXCEPTION',ctx(),()=>finalizeExtraction(ctx(),()=>r)));
 assert.deepEqual({...error},{code,tableIndex:2,field});assert.equal(Object.getPrototypeOf(error),null);
 assert.ok(isSafeExtractionFailure(error));assert.equal(reads,0);assert.doesNotMatch(JSON.stringify(error),new RegExp(secret));
});
for(const field of ['index','rowCount','valid24RowCount','categoryRowCount','courseRowCount'])test(`candidate diagnostic getter: ${field}`,()=>{
 const r=fresh();Object.defineProperty(r.diagnostics.tableCandidates[1],field,{enumerable:true,get(){throw new Error(secret);}});
 const error=capture(()=>finalizeExtraction(ctx(),()=>r));
 assert.deepEqual({...error},{code:'GI_EXTRACT_FINAL_DIAGNOSTICS',tableIndex:1,field:`diagnostics.tableCandidates[].${field}`});
 assert.doesNotMatch(JSON.stringify(error),new RegExp(secret));
});
const mapPatch=body=>`const originalMap=Array.prototype.map;Array.prototype.map=function(...args){if(this[0]?.courseRowCount!==undefined && args[0].length===1 && (''+args[0]).includes('valid24RowCount')){${body}}return Reflect.apply(originalMap,this,args);};`;
const hostile=[
 ['Object.keys throws',`Object.keys=()=>{throw new Error('${secret}');};`,'GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.keys',2],
 ['Object.keys returns null','Object.keys=()=>null;','GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.keys',2],
 ['Object.keys returns array-like object','Object.keys=()=>({length:3});','GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.keys',2],
 ['Object.keys omits keys','Object.keys=()=>[];','GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.keys',2],
 ['Object.keys includes inherited key',`const original=Object.keys;Object.keys=value=>[...original(value),'${secret}'];`,'GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.keys',2],
 ['table array Object.keys throws',`const original=Object.keys;Object.keys=value=>{if(Array.isArray(value)&&value.length===4)throw new Error('${secret}');return original(value);};`,'GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.tableCandidates.keys',2],
 ['tie array Object.keys throws',`const original=Object.keys;Object.keys=value=>{if(Array.isArray(value)&&value.length===2)throw new Error('${secret}');return original(value);};`,'GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.tieCandidateIndexes.keys',2],
 ['candidate Object.keys throws',`const original=Object.keys;Object.keys=value=>{if(value?.index===0)throw new Error('${secret}');return original(value);};`,'GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.tableCandidates[].keys',0],
 ['diagnostics map throws',mapPatch(`throw new Error('${secret}');`),'GI_EXTRACT_DIAGNOSTICS',undefined,2],
 ['diagnostics map returns null',mapPatch('return null;'),'GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.tableCandidates',2],
 ['diagnostics map ignores callback',mapPatch('return this;'),'GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.tableCandidates[].keys',0],
 ['diagnostics map returns source elements',mapPatch('return this.slice();'),'GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.tableCandidates[].keys',0],
 ['diagnostics map returns private string',mapPatch(`return ['${secret}'];`),'GI_EXTRACT_FINAL_DIAGNOSTICS','diagnostics.tableCandidates[]',0],
];
for(const [name,script,code,field,tableIndex] of hostile)test(`finalize hostile builtin: ${name}, both generated artifacts`,async()=>{
 const direct=harness();vm.runInContext(script,direct.context);vm.runInContext(extension,direct.context);
 const error=capture(()=>direct.context.HoseiPlannerGradeExtractor.extractCurrentDocument());
 assert.deepEqual({...error},{code,tableIndex,...(field?{field}:{})});
 const h=harness();vm.runInContext(script,h.context);vm.runInContext(bookmarklet,h.context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.alerts.length,1);assert.ok(h.alerts[0].startsWith(`[${code}]`));
 if(field)assert.ok(h.alerts[0].includes(`field: ${field}\n`));
 assert.deepEqual(h.copied,[]);assert.deepEqual(h.logs,[]);
 assert.doesNotMatch(JSON.stringify({alerts:h.alerts,logs:h.logs,error}),new RegExp(secret));
});
// The existing policy checks key count, not key names. Document that limitation
// instead of silently broadening the schema or substituting Object.keys.
test('same-length replacement key names do not change the existing key-count rule',()=>{
 const h=harness();vm.runInContext("const original=Object.keys;Object.keys=value=>original(value).map(()=> 'ignored-key-name');",h.context);
 vm.runInContext(extension,h.context);assert.deepEqual(structuredClone(h.context.HoseiPlannerGradeExtractor.extractCurrentDocument()),baseline);
});
