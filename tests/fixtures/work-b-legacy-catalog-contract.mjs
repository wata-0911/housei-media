import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {outputDeltas} from './work-b-field-baseline.mjs';
export const legacyCatalogContract=JSON.parse(readFileSync(new URL('./work-b-legacy-catalog-contract.json',import.meta.url)));
export const legacyCatalogCaseKey=(scope,status,admissionType,thesis)=>JSON.stringify([scope,status,admissionType,thesis]);

/** No output normalization. Assert both complete fixed projections first, then
 * compare the entire output delta set to the two independently authored inputs.
 * The shared delta walker preserves every value, absence and array order. */
export function compareLegacyCatalogEvidence(current,legacy,key){
 const fixed=legacyCatalogContract.cases.find(c=>c.key===key);
 assert.ok(fixed,'unapproved legacy Catalog case: '+key);
 const ids=fixed.current.requirements.map(r=>r.requirementId);
 for(const [actual,expected,side]of [[current,fixed.current,'current'],[legacy,fixed.legacy,'legacy']]){
  assert.deepEqual(actual.requirements.filter(r=>ids.includes(r.requirementId)),expected.requirements,key+'/'+side+' complete requirement rows');
  for(const field of ['evaluableCount','unknownCount','unknownReasons'])assert.deepEqual(actual[field],expected[field],key+'/'+side+'/'+field);
 }
 const approved=outputDeltas(fixed.current,fixed.legacy,key);
 const actual=outputDeltas(current,legacy,key);
 assert.deepEqual(actual,approved,key+' exact evidence delta set; all other outputs equal');
 return actual;
}
