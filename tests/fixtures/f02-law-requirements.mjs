import assert from 'node:assert/strict';
const mixedReason='S2の成績が受験票発送予定日までに確定したことと、T2の受験資格を確認できないため完成を保留しています。';
// Input-side, independently fixed expectations. Never choose expected status,
// quantity or reason from the output's label/status (including equal 2/2 rows).
const cases={
 empty:{values:[0,0],status:'unsatisfied',reason:null,category:null},
 'dense-earned':{values:[128,96],status:'satisfied',reason:null,category:null},
 'dense-in_progress':{values:[2,2],status:'unsatisfied',reason:null,category:null},
 'dense-planned':{values:[2,2],status:'unsatisfied',reason:null,category:null},
 'dense-mixed-no-politics':{values:[40,28],status:'unknown',reason:mixedReason,category:'rule_unimplemented'},
 'dense-mixed':{values:[42,30],status:'unknown',reason:mixedReason,category:'rule_unimplemented'},
};
const identities=[['5755e04d-5c56-4a34-a2b4-afca335676e2','専門教育'],['8e08d5c3-a3ab-47e9-81c8-c9a3f8426a67','専門教育：選択']];
export function assertLawDenseRequirements(progress,total,elective,mode='empty') {
 const expected=cases[mode];assert.ok(expected,'a fixed input case is required');
 assert.deepEqual([total,elective],expected.values,'independent arithmetic must agree with the fixed case');
 const ids=new Set(identities.map(([id])=>id)),labels=new Set(identities.map(([,label])=>label));
 const rows=progress.requirements.filter(r=>ids.has(r.requirementId)||(r.ruleType==='min_credits'&&labels.has(r.label)));
 assert.equal(rows.length,2,'both applicable law requirements must exist exactly once');
 assert.deepEqual(rows.map(r=>r.requirementId).sort(),[...ids].sort());
 for(const [i,[id,label]]of identities.entries()){
  const row=rows.find(r=>r.requirementId===id);assert.ok(row,id);
  assert.deepEqual([row.label,row.ruleType,row.earned,row.status,row.reason,row.unknownReasonCategory],
   [label,'min_credits',expected.values[i],expected.status,expected.reason,expected.category],id);
 }
}
