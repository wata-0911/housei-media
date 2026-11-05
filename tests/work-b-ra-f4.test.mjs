import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {calculateState,calculateCompletion} from './fixtures/yi07-graduation.mjs';
const cases=JSON.parse(readFileSync(new URL('./fixtures/work-b-ra-f4.json',import.meta.url)));
for(const c of cases)test(c.id+' fixed independent input/expectation',()=>{
 const r=calculateState(c.state,c.scope),q=r.requirements.find(x=>x.requirementId==='b588eb9e-e08f-4059-8e37-d1df90165988');
 assert.equal(q.earned,c.expected.earned);if(c.expected.status)assert.equal(q.status,c.expected.status);
 const completion=calculateCompletion(c.state,c.scope);
 assert.equal(completion.courses.filter(x=>x.completion==='complete').length,c.expected.earned);
 const card=r.cards.find(x=>x.requirementId==='professional-history-elective');
 assert.equal(card.earned,c.id==='RA-F4-01'?0:4);
 assert.equal(card.details.find(x=>x.label.startsWith('東洋史')).earned,c.expected.earned);
});
