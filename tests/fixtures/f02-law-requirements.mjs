import assert from 'node:assert/strict';
// Fixed first-year law requirements for selected thesis. Count/IDs are checked
// before value checks, including rows whose quantity is explicitly unknown.
export function assertLawDenseRequirements(progress,total,elective) {
 const rows=progress.requirements.filter(r=>['専門教育','専門教育：選択'].includes(r.label)&&r.ruleType==='min_credits');
 assert.equal(rows.length,2,'both applicable law requirements must exist');
 assert.deepEqual(rows.map(r=>r.requirementId).sort(),['5755e04d-5c56-4a34-a2b4-afca335676e2','8e08d5c3-a3ab-47e9-81c8-c9a3f8426a67']);
 for(const row of rows){assert.equal(row.earned,row.label==='専門教育'?total:elective);if(row.status==='unknown'){assert.ok(row.reason.length>0);assert.ok(row.unknownReasonCategory);}}
}
