import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {diagnosticsFor,finalizeExtraction,boundary} from '../../shared/grade-import/extractor.js';
import {harness} from './fixtures/extraction-dom.mjs';
const secret='SECRET_PERSONAL_GRADE_VALUE';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/extraction-741e780.json',import.meta.url),'utf8')).outcomes.normal32;
const extension=readFileSync(new URL('../../extension/hosei-planner-import/parser/extractor.js',import.meta.url),'utf8');
const bookmarklet=decodeURIComponent(JSON.parse(readFileSync(new URL('../../src/generated/gradeImportBookmarklet.json',import.meta.url),'utf8')).bookmarklet.slice(11));
const capture=action=>{try{action();}catch(error){return error;}assert.fail('expected safe failure');};
test('diagnostics fixed allowlist copies ignore extra own/prototype data and retain no source references',()=>{
 const tables=structuredClone(baseline.diagnostics.tableCandidates),ties=[2,3];
 let privateReads=0;
 const addPrivate=value=>{Object.defineProperty(value,'private',{enumerable:true,get(){privateReads++;throw new Error(secret);}});};
 addPrivate(tables);addPrivate(ties);
 for(const table of tables){addPrivate(table);Object.setPrototypeOf(table,{privatePrototype:secret});}
 tables.map=()=>{throw new Error(secret);};
 const generated=diagnosticsFor(tables,2,ties);
 const outcome=finalizeExtraction({__proto__:null,tableIndex:2},()=>({...baseline,diagnostics:generated}));
 assert.deepEqual(structuredClone(outcome),baseline);
 assert.equal(privateReads,0);
 assert.notEqual(generated.tableCandidates,tables);assert.notEqual(generated.tieCandidateIndexes,ties);
 assert.notEqual(outcome.diagnostics,generated);assert.notEqual(outcome.diagnostics.tableCandidates,generated.tableCandidates);
 assert.notEqual(outcome.diagnostics.tableCandidates[0],tables[0]);assert.notEqual(outcome.diagnostics.tieCandidateIndexes,ties);
 assert.equal(Object.getPrototypeOf(outcome.diagnostics),Object.prototype);
 assert.equal(Object.getPrototypeOf(outcome.diagnostics.tableCandidates[0]),Object.prototype);
 tables[0].rowCount=999;ties[0]=999;generated.tableCandidates[0].rowCount=999;
 assert.deepEqual(structuredClone(outcome),baseline);assert.doesNotMatch(JSON.stringify(outcome),new RegExp(secret));
});
test('finalizer strips additional own properties from supplied diagnostics without mutating it',()=>{
 const source=structuredClone(baseline.diagnostics);source.privateValue=secret;source.tableCandidates.privateValue=secret;
 source.tieCandidateIndexes.privateValue=secret;source.tableCandidates[0].privateValue=secret;
 const result=finalizeExtraction({__proto__:null},()=>({...baseline,diagnostics:source}));
 assert.deepEqual(structuredClone(result.diagnostics),baseline.diagnostics);
 assert.equal(source.privateValue,secret);assert.doesNotMatch(JSON.stringify(result),new RegExp(secret));
});
test('inherited required diagnostic fields are rejected instead of copied',()=>{
 const source=structuredClone(baseline.diagnostics);delete source.tableCandidates[1].rowCount;
 Object.setPrototypeOf(source.tableCandidates[1],{rowCount:0,privateValue:secret});
 const error=capture(()=>finalizeExtraction({__proto__:null},()=>({...baseline,diagnostics:source})));
 assert.deepEqual({...error},{code:'GI_EXTRACT_FINAL_DIAGNOSTICS',tableIndex:1,field:'diagnostics.tableCandidates[].rowCount'});
 assert.doesNotMatch(JSON.stringify(error),new RegExp(secret));
});
test('inherited candidate fields cannot enter diagnosticsFor',()=>{
 const candidate=Object.create({index:0,rowCount:0,valid24RowCount:0,categoryRowCount:0,courseRowCount:0,privateValue:secret});
 const error=capture(()=>boundary('GI_EXTRACT_DIAGNOSTICS',{__proto__:null},()=>diagnosticsFor([candidate])));
 assert.deepEqual({...error},{code:'GI_EXTRACT_DIAGNOSTICS'});assert.doesNotMatch(JSON.stringify(error),new RegExp(secret));
});
test('candidate/source/tie private properties never reach generated artifact sinks or copied JSON',async()=>{
 const patch=`const original=Array.prototype.filter;Array.prototype.filter=function(...args){const result=Reflect.apply(original,this,args);if(this[0]?.courseRowCount!==undefined){this.privateValue='${secret}';result.privateValue='${secret}';for(let i=0;i<this.length;i++){this[i].privateValue='${secret}';Object.setPrototypeOf(this[i],{privatePrototype:'${secret}'});}}return result;};`;
 for(const source of [extension,bookmarklet]){
   const h=harness();vm.runInContext(patch,h.context);vm.runInContext(source,h.context);
   if(source===extension){const result=h.context.HoseiPlannerGradeExtractor.extractCurrentDocument();assert.deepEqual(structuredClone(result),baseline);assert.doesNotMatch(JSON.stringify(result),new RegExp(secret));}
   else{await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(JSON.parse(h.copied[0]),baseline.value);assert.deepEqual(structuredClone(h.logs),[['Hosei grade import diagnostics',baseline.diagnostics]]);assert.doesNotMatch(h.alerts[0],/GI_/);assert.doesNotMatch(JSON.stringify([h.logs,h.alerts,h.copied]),new RegExp(secret));}
 }
});
