import assert from 'node:assert/strict';
import { test } from 'node:test';
import { master, decode, detail, preview, mixed } from './fixtures/migration-fixture.mjs';
import { catalog, initialState, programs, retained, newAttempt, confirmPlacement, officialRow } from './fixtures/yi07-graduation.mjs';
import { deletedFixture } from './fixtures/attempt-fixture.mjs';
import { adaptAttemptGraduation } from '../src/planner/attempts/graduation/adapter.ts';
// This fallback permits each pre-written safety case to report RED before the API exists.
const api = await import('../src/planner/attempts/graduation/evidence.ts').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND' && e.message.includes('/graduation/evidence.ts')) return {};
  throw e;
});
const scope = programs.find(p => p.department === '法律学科').scopeId;
const p = master.placements.find(p => p.scopeId === scope && p.institutionalCourseId && p.compositionCredits === 4
  && p.identityDecision.status === 'safe' && p.auditRecord.placementStatus === 'safe');
const other = master.placements.find(q => q.scopeId === scope && q.institutionalCourseId && q.institutionalCourseId !== p.institutionalCourseId
  && q.identityDecision.status === 'safe' && q.auditRecord.placementStatus === 'safe');
const course = p => catalog.curriculum.courses.find(c => c.id === p.auditRecord.oldCurriculumCourseId);
const rowFor = (placement=p, amount=4) => ({ ...officialRow(course(placement)), earnedCreditsTotal: amount, schoolingCreditsTotal: amount });
async function sourceFor(rows=[], records=[]) {
  const d = await decode({ ...initialState(), importedCourseAchievements: rows, importedStudyRecords: records });
  assert.equal(d.status, 'decoded', JSON.stringify(d.diagnostics)); return d.source;
}
const blank = await sourceFor();
const graphFor = attempts => ({ attempts, ownedRecords: [], removals: [] });
function run(attempts, source=blank, selected=scope, submissions) {
  assert.equal(typeof api.assessAttemptEvidence, 'function', 'common evidence API must exist');
  const input = { graph: graphFor(attempts), retained: retained(source.state), ...(submissions ? { submittedEvidence: submissions } : {}) };
  const before = structuredClone(input), result = api.assessAttemptEvidence(input, source, selected);
  assert.deepEqual(input, before); return result;
}
function assessed(attempts, source=blank, selected=scope, submissions) {
  const r = run(attempts,source,selected,submissions); assert.equal(r.status,'assessed',JSON.stringify(r.diagnostics));
  assert.equal(r.graduationCheckComplete,false); assert.equal(r.sourceLinksReverified,false); return r;
}
const held = d => { assert.equal(d.status,'held'); assert.equal(d.value,null); assert.ok(d.reasons.length); assert.ok(d.missingEvidence.length); };
const one = (a=newAttempt(master,p),source=blank) => assessed([a],source).attempts[0];
const refDetail = (a,id,method='schooling') => { a.method={value:method,source:'official_detail',evidence:{kind:'official_detail',studyRecordId:id}}; return a; };

for (const status of ['unknown','unverified']) test(`applicability ${status}: identity and placement do not prove learner application`,()=>{
  const a=confirmPlacement(newAttempt(master,p),p);
  if(status==='unknown') a.applicability=newAttempt(master).applicability;
  const result=one(a); assert.equal(result.identity.status,'supported'); assert.equal(result.placement.status,'supported');
  assert.equal(result.applicability.recordedStatus,status); held(result.applicability.decision);
  for(const key of ['official_learner_program','official_admission_context','official_curriculum_transition_history','reviewed_applicability_rules']) assert.ok(result.applicability.decision.missingEvidence.includes(key));
});
test('confirmed applicability cannot be forged with current YI-02 row evidence',()=>{
  const a=confirmPlacement(newAttempt(master,p),p); a.applicability.status='confirmed';
  a.applicability.evidence={sourceRevisionId:master.sourceRevision.id,evidenceIds:[p.officialRow.evidenceId]};
  const r=run([a]); assert.equal(r.status,'rejected'); assert.ok(r.diagnostics.some(d=>d.code==='unreviewed_applicability'));
});
for(const method of ['correspondence','schooling','media','unknown']) test(`learner method ${method} is not official performance`,()=>{
  const a=newAttempt(master,p,2,'earned',method),r=one(a); held(r.method.decision); assert.deepEqual(r.method.record,a.method);
  held(r.actualYear.decision); assert.equal(r.record.plan.plannedYear,2035); assert.equal(r.record.actualYear.value,null);
  assert.equal(r.graduation.ordinary.value,null); assert.equal(r.graduation.schooling.value,null); assert.equal(r.graduation.completion.value,null);
});
test('migrated Offering method remains a reference, not an official Attempt fact',async()=>{
  const {source,result}=await preview(mixed()); assert.equal(result.status,'ready');
  const r=assessed(result.target.graph.attempts,source); for(const a of r.attempts){assert.equal(a.method.record.source,'legacy_reference');held(a.method.decision);}
});
for(const amount of [null,0,2,4]) test(`official aggregate ${amount} preserved; Course ownership is not detail exclusivity`,async()=>{
  const row=rowFor(p,amount),d=detail({sourceCourseId:row.id,rawName:row.rawName,method:'schooling',credits:2});
  const source=await sourceFor([row],[d]),a=refDetail(newAttempt(master,p),d.id),r=one(a,source);
  const aggregate=r.official.aggregates.find(x=>x.record.id===row.id),record=r.official.details[0];
  assert.equal(aggregate.referenceExists.status,'supported'); assert.equal(aggregate.courseIdentity.value,p.institutionalCourseId);
  assert.equal(aggregate.incrementOwnership.status,'supported'); assert.equal(aggregate.quantities.ordinary.value,amount);
  assert.deepEqual(aggregate.record,row); assert.deepEqual(record.record,d); assert.equal(record.parentCourseIdentity.status,'supported');
  held(record.attemptAssociation); held(record.exclusivity); held(r.method.decision);
  assert.equal(r.graduation.ordinary.value,0); assert.equal(r.graduation.schooling.value,0); assert.equal(r.graduation.completion.value,null);
  const full=assessed([a,newAttempt(master)],source),base=adaptAttemptGraduation({graph:graphFor([a]),retained:retained(source.state)},source,scope);
  assert.deepEqual(full.retainedProgress,base.retainedProgress); assert.deepEqual(full.officialEvidence,base.officialEvidence);
});
for(const parent of ['other','unmatched','ambiguous','unsafe','missing']) test(`detail with ${parent} parent cannot own this Course increment`,async()=>{
  const row=rowFor(parent==='unsafe'?master.placements.find(q=>q.identityDecision.status==='ambiguous'):other);
  if(parent==='unmatched'){row.curriculumMatch='unmatched';row.curriculumCourseId=null;row.candidateCurriculumCourseIds=[];}
  if(parent==='ambiguous'){row.curriculumMatch='ambiguous';row.curriculumCourseId=null;row.candidateCurriculumCourseIds=[course(other).id,course(p).id];}
  const d=detail({rawName:row.rawName,...(parent==='missing'?{}:{sourceCourseId:row.id})});
  const source=await sourceFor([row],[d]),a=refDetail(newAttempt(master,p),d.id,'correspondence');
  a.plan.importedSourceCourseId=row.id;
  const r=one(a,source); held(r.official.details[0].parentCourseIdentity); held(r.official.details[0].attemptAssociation);
  held(r.official.aggregates[0].incrementOwnership); held(r.graduation.ordinary); held(r.graduation.schooling);
});
test('legitimate ownership survives an unrelated detail reference',async()=>{
  const own=rowFor(),foreign={...rowFor(other),id:'other-row'},d=detail({sourceCourseId:foreign.id,rawName:foreign.rawName});
  const source=await sourceFor([own,foreign],[d]),a=refDetail(newAttempt(master,p),d.id);
  const r=one(a,source); assert.equal(r.official.aggregates.find(x=>x.record.id===own.id).incrementOwnership.status,'supported');
  held(r.official.aggregates.find(x=>x.record.id===foreign.id).incrementOwnership); assert.equal(r.graduation.ordinary.value,0);
});
test('shared detail counts all distinct Attempt claims, including detached; unique reference is still held',async()=>{
  const row=rowFor(),d=detail({sourceCourseId:row.id,rawName:row.rawName}),source=await sourceFor([row],[d]);
  const a=refDetail(newAttempt(master,p),d.id),b=refDetail(newAttempt(master,p),d.id);
  b.actualYear={value:2025,source:'source',reason:null,evidence:{kind:'official_detail',studyRecordId:d.id}};
  const r=assessed([a,b],source); for(const x of r.attempts){assert.deepEqual(x.official.details[0].referencingAttemptIds,[a.id,b.id].sort());held(x.official.details[0].exclusivity);}
  held(one(a,source).official.details[0].exclusivity);
  const {deleted}=deletedFixture(graphFor([a,b]),1);
  const detached=api.assessAttemptEvidence({graph:deleted,retained:retained(source.state)},source,scope);
  assert.equal(detached.status,'assessed');assert.deepEqual(detached.attempts[0].official.details[0].referencingAttemptIds,[a.id,b.id].sort());
});
for(const value of ['omitted',null,0,2]) test(`quantity state ${value} remains distinct across authorities`,async()=>{
  const d=detail({credits:2,...(value==='omitted'?{}:{schoolingCreditsTotal:value})}),source=await sourceFor([],[d]);
  const a=refDetail(newAttempt(master,p,value==='omitted'?2:value),d.id); if(value==='omitted')delete a.plan.contribution;
  confirmPlacement(a,p);
  const r=one(a,source),expected=value==='omitted'?{kind:'omitted'}:value===null?{kind:'unknown',value:null}:value===0?{kind:'zero',value:0}:{kind:'positive',value:2};
  assert.deepEqual(r.quantities.learnerContribution.quantity,expected);assert.deepEqual(r.official.details[0].quantities.schooling,expected);
  assert.equal(r.quantities.composition.quantity.value,4); assert.equal(r.graduation.completion.value,null);assert.equal(r.graduation.schooling.value,null);
});
test('composition4 / correspondence2 / S2 never generates completion4 or S4',async()=>{
  const d=detail({method:'schooling',credits:2,schoolingCreditsTotal:2}),source=await sourceFor([],[d]);
  const a=newAttempt(master,p,2,'earned','correspondence'),b=refDetail(newAttempt(master,p,2),d.id);
  for(const r of assessed([a,b],source).attempts){held(r.graduation.completion); held(r.graduation.ordinary);held(r.graduation.schooling);}
});
test('method/year disagreement is reported without changing source or treating capture time as academic year',async()=>{
  const d=detail({method:'correspondence',academicYear:2025,yearSource:'manual',capturedAt:'2035-01-01',credits:2});
  const source=await sourceFor([],[d]),a=refDetail(newAttempt(master,p),d.id,'schooling');
  a.actualYear={value:2035,source:'source',reason:null,evidence:{kind:'official_detail',studyRecordId:d.id}};
  const r=one(a,source); held(r.method.decision);held(r.actualYear.decision);
  assert.ok(r.method.decision.reasons.includes('method_claim_conflict')); assert.ok(r.actualYear.decision.reasons.includes('actual_year_claim_conflict'));
  assert.equal(r.official.details[0].record.academicYear,2025);assert.equal(r.record.plan.plannedYear,2035);
});
for(const status of ['unknown','ambiguous','conflict','unmatched']) test(`identity ${status}: no first candidate selection`,()=>{
  const a=newAttempt(master);a.identity={status,ref:null,candidateAuditIds:[p.auditRecord.oldCurriculumCourseId,other.auditRecord.oldCurriculumCourseId],reason:'test unresolved'};
  a.placement.candidatePlacementIds=[p.id,other.id]; const r=one(a);held(r.identity);held(r.placement);
  assert.deepEqual(r.placementCandidates.map(q=>q.id).sort(),[p.id,other.id].sort());
  a.placement.candidatePlacementIds.reverse();assert.deepEqual(one(a).placementCandidates,r.placementCandidates);
});
for(const program of programs)test(`all8 ${program.displayName}: unknown outside candidate does not narrow impact or import outside requirements`,()=>{
  const outside=master.placements.find(q=>q.scopeId!==program.scopeId&&q.scopeId!==catalog.programs.find(x=>x.isCommon).scopeId);
  const common=master.placements.find(q=>q.category==='一般教育'&&q.scopeId===catalog.programs.find(x=>x.isCommon).scopeId);
  const a=newAttempt(master);a.placement.candidatePlacementIds=[outside.id];
  const before=assessed([a],blank,program.scopeId).attempts[0];a.placement.candidatePlacementIds.push(common.id);
  const after=assessed([a],blank,program.scopeId).attempts[0];held(after.applicability.decision);
  assert.deepEqual(after.impact.requirementIds,before.impact.requirementIds);assert.deepEqual(after.impact.cardIds,before.impact.cardIds);
  const old=adaptAttemptGraduation({graph:graphFor([a]),retained:retained(blank.state)},blank,program.scopeId);
  assert.deepEqual(after.impact,old.attempts[0].impact);assert.equal(after.impact.extent,'selected_scope_unknown');
  const labels={'法律学科':'law','史学科':'history','地理学科':'geography','経済学科':'economics','商業学科':'commerce','言語コース':'japanese_language','文学コース':'japanese_literature','芸能文化コース':'japanese_performance'};
  for(const id of after.impact.requirementIds){const req=catalog.requirements.find(r=>r.id===id);assert.ok(req.status==='structured'?[program.scopeId,common.scopeId].includes(req.scopeId):['common',labels[program.course??program.department]].includes(req.scopeLabel));}
});
test('addition/removal of identity and detail evidence changes only justified propositions',async()=>{
  const row=rowFor(),d=detail({sourceCourseId:row.id,rawName:row.rawName}),source=await sourceFor([row],[d]),a=newAttempt(master);
  held(one(a,source).identity); const exact=newAttempt(master,p);assert.equal(one(exact,source).identity.status,'supported');
  const before=one(exact,source);refDetail(exact,d.id);const after=one(exact,source);
  assert.equal(before.official.details.length,0);assert.equal(after.official.details.length,1);held(after.method.decision);held(after.official.details[0].exclusivity);
  exact.method=a.method;assert.equal(one(exact,source).official.details.length,0);
});
test('unreviewed submitted evidence is retained with revision/refs and never authorizes confirmation',()=>{
  const a=newAttempt(master,p),submissions=[{attemptId:a.id,kind:'official_learner_attestation',sourceRevisionId:'unknown-revision',sourceRefs:['document://not-reviewed']}];
  const r=assessed([a],blank,scope,submissions);assert.deepEqual(r.submittedEvidence[0].record,submissions[0]);held(r.submittedEvidence[0].decision);
  held(r.attempts[0].applicability.decision); assert.equal(r.submittedEvidence[0].decision.references[0].sourceRevisionId,'unknown-revision');
});
test('all judgements retain evidence paths, revision and source digest; results deterministic and frozen',()=>{
  const a=newAttempt(master,p),r=assessed([a]),again=assessed([a]);assert.deepEqual(r,again);assert.ok(Object.isFrozen(r.attempts[0]));
  const identity=r.attempts[0].identity;assert.ok(identity.references.some(ref=>ref.sourceRevisionId===master.sourceRevision.id));
  assert.ok(identity.references.some(ref=>ref.sourceRef.includes(p.institutionalCourseId)));assert.equal(r.source.rawSha256,blank.rawSha256);
  assert.equal(r.attempts[0].ruleSupport.status,'unsupported');assert.equal(r.attempts[0].ruleSupport.value,null);
});
for(const corruption of ['sparse','getter','undefined','NaN','cycle','envelope'])test(`retained ${corruption} is rejected through the existing boundary`,async()=>{
  assert.equal(typeof api.assessAttemptEvidence,'function');
  const row=rowFor(),source=await sourceFor([row]),input={graph:graphFor([]),retained:retained(source.state)};let reads=0;
  if(corruption==='sparse')delete input.retained.importedCourseAchievements[0];
  if(corruption==='getter')Object.defineProperty(input.retained.importedCourseAchievements[0],'earnedCreditsTotal',{enumerable:true,get(){reads++;return 4;}});
  if(corruption==='undefined')input.retained.importedCourseAchievements[0].earnedCreditsTotal=undefined;
  if(corruption==='NaN')input.retained.importedCourseAchievements[0].earnedCreditsTotal=NaN;
  if(corruption==='cycle')input.retained.self=input.retained;
  if(corruption==='envelope')Object.defineProperty(input,'retained',{get(){reads++;return retained(source.state);}});
  assert.equal(api.assessAttemptEvidence(input,source,scope).status,'rejected');assert.equal(reads,0);
});
for(const corruption of ['sparse','accessor','envelope','undefined','unknown-attempt','extra-field','not-array'])test(`submitted evidence ${corruption} cannot bypass the data boundary`,()=>{
  assert.equal(typeof api.assessAttemptEvidence,'function');const a=newAttempt(master,p);let reads=0;
  const entry={attemptId:a.id,kind:'future-proof',sourceRevisionId:master.sourceRevision.id,sourceRefs:['document://unreviewed']};
  const input={graph:graphFor([a]),retained:retained(blank.state),submittedEvidence:[entry]};
  if(corruption==='sparse')delete input.submittedEvidence[0];
  if(corruption==='accessor')Object.defineProperty(entry,'kind',{enumerable:true,get(){reads++;return 'proof';}});
  if(corruption==='envelope')Object.defineProperty(input,'submittedEvidence',{enumerable:true,get(){reads++;return [entry];}});
  if(corruption==='undefined')input.submittedEvidence=undefined;
  if(corruption==='unknown-attempt')entry.attemptId='not-in-graph';
  if(corruption==='extra-field')entry.confirmed=true;
  if(corruption==='not-array')input.submittedEvidence=entry;
  assert.equal(api.assessAttemptEvidence(input,blank,scope).status,'rejected');assert.equal(reads,0);
});
test('a submission using the known document revision still cannot prove applicability or method',()=>{
  const a=newAttempt(master,p),record={attemptId:a.id,kind:'official',sourceRevisionId:master.sourceRevision.id,sourceRefs:[p.officialRow.evidenceId]};
  const r=assessed([a],blank,scope,[record]);held(r.submittedEvidence[0].decision);held(r.attempts[0].method.decision);held(r.attempts[0].applicability.decision);
});
test('official schooling label alone neither proves nor contradicts the narrower learner media claim',async()=>{
  const d=detail({method:'schooling',credits:2}),source=await sourceFor([],[d]);
  const a=refDetail(newAttempt(master,p),d.id,'media'),r=one(a,source);
  held(r.method.decision);assert.equal(r.method.decision.reasons.includes('method_claim_conflict'),false);
  assert.ok(r.method.decision.reasons.includes('media_method_unverified'));
});
