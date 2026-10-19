import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { adaptAttemptGraduation } from '../src/planner/attempts/graduation/adapter.ts';
import { sameAttemptData, validateAttemptGraph } from '../src/planner/attempts/validation.ts';
import { attemptImpact, candidatePlacements } from '../src/planner/attempts/graduation/impact.ts';
import { freeze } from '../src/planner/attempts/migration/contracts.ts';
import { projectLegacyState } from '../src/planner/attempts/migration/preview.ts';
import { createWorkspace, applyCommand, newOperationId } from '../src/planner/attempts/workbench/operations.ts';
import { createAttemptPersistence } from '../src/planner/attempts/persistence/controller.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { master, env, preview, decode, mixed, detail, originalRow, item } from './fixtures/migration-fixture.mjs';
import { catalog, initialState, programs, legacyCases, calculateState, calculateCompletion, snapshotValue, retained, newAttempt, confirmPlacement, officialRow } from './fixtures/yi07-graduation.mjs';
import { importRepeated, repeatedPayload, repeatProfile } from './fixtures/official-repeatable.mjs';
import { official as calligraphyOfficial, programs as japanesePrograms } from './fixtures/calligraphy-progress.mjs';

const scope = programs.find(p => p.department === '法律学科').scopeId;
const emptyGraph = () => ({ attempts: [], ownedRecords: [], removals: [] });
const placement = master.placements.find(p => p.institutionalCourseId && p.scopeId === scope && p.compositionCredits === 4
  && p.identityDecision.status === 'safe' && p.auditRecord.placementStatus === 'safe');
const course = catalog.curriculum.courses.find(c => c.id === placement.auditRecord.oldCurriculumCourseId);
const profile = () => ({ ...initialState().graduationProfile, admissionType: 'first_year', curriculumApplicability: 'current_2026', admissionYear: 2026 });
async function sourceFor(rows = [], records = [], extra = {}) {
  const state = { ...initialState(), graduationProfile: profile(), importedCourseAchievements: rows, importedStudyRecords: records, ...extra };
  const d = await decode(state); assert.equal(d.status, 'decoded', JSON.stringify(d.diagnostics)); return d.source;
}
const blankSource = await sourceFor();
function adapt(graph, source = blankSource, scopeId = scope) {
  const before = structuredClone(graph);
  const result = adaptAttemptGraduation({ graph, retained: retained(source.state) }, source, scopeId);
  assert.equal(result.status, 'adapted', JSON.stringify(result.diagnostics));
  assert.deepEqual(graph, before);
  assert.equal(result.graduationCheckComplete, false); assert.equal(result.sourceLinksReverified, false);
  assert.ok(Object.isFrozen(result.graph));
  return result;
}
function withAttempts(...attempts) { return { ...emptyGraph(), attempts }; }
const codes = a => a.diagnostics.map(d => d.code);
const scopeLabelFor = {
  '法律学科': 'law', '史学科': 'history', '地理学科': 'geography', '経済学科': 'economics', '商業学科': 'commerce',
  '言語コース': 'japanese_language', '文学コース': 'japanese_literature', '芸能文化コース': 'japanese_performance',
};

for (const program of programs) for (const category of ['一般教育', '外国語', '保健体育']) {
  test(`R1 candidate addition is monotone and order independent ${program.displayName}/${category}`, () => {
    const commonIds = catalog.programs.filter(p => p.isCommon).map(p => p.scopeId);
    const outside = master.placements.find(p => p.scopeId !== program.scopeId && !commonIds.includes(p.scopeId));
    const common = master.placements.find(p => commonIds.includes(p.scopeId) && p.category === category);
    for (const applicability of ['unknown', 'unverified']) {
    const a = newAttempt(master);
    if (applicability === 'unverified') a.applicability = { status: 'unverified', curriculumVersionId: outside.curriculumVersionId,
      scopeId: outside.scopeId, legacyApplicability: 'current_2026', originalValue: '未確認', evidence: null };
    a.placement.candidatePlacementIds = [outside.id];
    const before = adapt(withAttempts(a), blankSource, program.scopeId).attempts[0].impact;
    const baselineProgress = adapt(emptyGraph(), blankSource, program.scopeId).retainedProgress;
    assert.equal(before.extent, 'selected_scope_unknown');
    assert.deepEqual(before.cardIds, baselineProgress.cards.map(card => card.requirementId));
    const impacts = [];
    for (const ids of [[outside.id, common.id], [common.id, outside.id]]) {
      const candidate = structuredClone(a); candidate.placement.candidatePlacementIds = ids;
      const result = adapt(withAttempts(candidate), blankSource, program.scopeId), after = result.attempts[0].impact;
      impacts.push(after);
      const lost = Object.fromEntries(['requirementIds', 'cardIds'].map(axis => [axis, before[axis].filter(id => !after[axis].includes(id))]));
      assert.deepEqual(lost, { requirementIds: [], cardIds: [] }, 'candidate addition must not erase either impact set');
      for (const axis of ['requirementIds', 'cardIds']) {
        assert.ok(before[axis].length > 0);
        for (const id of before[axis]) assert.ok(after[axis].includes(id), `${axis} lost ${id}`);
        assert.deepEqual(after[axis], before[axis]);
      }
      assert.equal(after.extent, 'selected_scope_unknown');
      assert.deepEqual(result.retainedProgress, baselineProgress);
      for (const id of after.requirementIds) {
        const r = catalog.requirements.find(r => r.id === id);
        const label = scopeLabelFor[program.course ?? program.department];
        assert.ok(r.status === 'structured' ? r.scopeId === program.scopeId || commonIds.includes(r.scopeId)
          : ['common', label].includes(r.scopeLabel), `out-of-scope requirement ${id}`);
      }
    }
    assert.deepEqual(impacts[0], impacts[1]);
    assert.deepEqual(attemptImpact(a, [outside, common], catalog, program.scopeId, baselineProgress),
      attemptImpact(a, [common, outside], catalog, program.scopeId, baselineProgress));
    }
  });
}
for (const category of ['一般教育', '外国語', '保健体育']) test(`R1 pure impact confirmed-applicability branch stays local ${category}`, () => {
  // Control the pure helper's precondition only. No forged applicability is
  // accepted by the adapter/validator or installed in the official catalog.
  const commonIds = catalog.programs.filter(p => p.isCommon).map(p => p.scopeId);
  const outside = master.placements.find(p => p.scopeId !== scope && !commonIds.includes(p.scopeId));
  const common = master.placements.find(p => commonIds.includes(p.scopeId) && p.category === category);
  const a = newAttempt(master); a.applicability.status = 'confirmed';
  const progress = adapt(emptyGraph()).retainedProgress;
  assert.equal(attemptImpact(a, [outside], catalog, scope, progress).extent, 'none');
  const local = attemptImpact(a, [common], catalog, scope, progress);
  assert.equal(local.extent, 'placements');
  assert.deepEqual(attemptImpact(a, [outside, common], catalog, scope, progress), local);
  assert.deepEqual(attemptImpact(a, [common, outside], catalog, scope, progress), local);
  assert.equal(validateAttemptGraph(withAttempts(a), blankSource.context).valid, false);
});
test('R1 confirmed Course identity does not erase unresolved applicability of cross-course placements', () => {
  const program = programs.find(p => p.course === '言語コース');
  const p = master.placements.find(p => p.scopeId === program.scopeId && p.category === '専門教育');
  const a = newAttempt(master, p), candidates = candidatePlacements(a, master);
  assert.equal(a.identity.status, 'confirmed'); assert.equal(a.applicability.status, 'unknown');
  assert.ok(candidates.some(p => p.scopeId !== program.scopeId));
  const result = adapt(withAttempts(a, newAttempt(master)), blankSource, program.scopeId);
  assert.equal(result.attempts[0].impact.extent, 'selected_scope_unknown');
  assert.deepEqual(result.attempts[0].impact.requirementIds, result.attempts[1].impact.requirementIds);
  assert.deepEqual(result.attempts[0].impact.cardIds, result.attempts[1].impact.cardIds);
});

const r2Source = await sourceFor([], [], { publicCourses: [{ id: '00000000-0000-4000-8000-000000099702', title: 'R2合成公開科目',
  status: 'earned', credits: 2, plannedYear: 2026, plannedTerm: null, studyYear: null, finalGrade: null }] });
const r2Input = () => ({ graph: emptyGraph(), retained: retained(r2Source.state) });
const r2Run = input => adaptAttemptGraduation(input, r2Source, scope);
for (const [name, mutate] of [
  ['sparse deletion', r => { delete r.publicCourses[0]; }],
  ['ordinary deletion', r => { r.publicCourses.splice(0, 1); }],
  ['credit rewrite', r => { r.publicCourses[0].credits = 0; }],
  ['omitted credit', r => { delete r.publicCourses[0].credits; }],
  ['null credit', r => { r.publicCourses[0].credits = null; }],
  ['null element', r => { r.publicCourses[0] = null; }],
  ['undefined credit', r => { r.publicCourses[0].credits = undefined; }],
  ['NaN credit', r => { r.publicCourses[0].credits = NaN; }],
  ['Infinity credit', r => { r.publicCourses[0].credits = Infinity; }],
  ['bigint credit', r => { r.publicCourses[0].credits = 2n; }],
  ['function credit', r => { r.publicCourses[0].credits = () => 2; }],
  ['symbol property', r => { r[Symbol('hidden')] = 2; }],
  ['hidden property', r => { Object.defineProperty(r, 'hidden', { value: 2 }); }],
  ['extra array property', r => { r.publicCourses.extra = 2; }],
  ['Date in object slot', r => { r.importedCourseUserMeta = new Date(0); }],
  ['Map in object slot', r => { r.importedCourseUserMeta = new Map(); }],
  ['Set in object slot', r => { r.importedCourseUserMeta = new Set(); }],
  ['custom prototype', r => { Object.setPrototypeOf(r.importedCourseUserMeta, { inherited: 2 }); }],
  ['cycle', r => { r.publicCourses[0].self = r.publicCourses[0]; }],
]) test(`R2 retained rejects ${name} without losing source credits`, () => {
  const input = r2Input(); mutate(input.retained);
  const result = r2Run(input);
  assert.equal(result.status, 'rejected');
  assert.equal(result.diagnostics[0].code, 'retained_source_mismatch');
  const canonical = r2Run(r2Input()); assert.equal(canonical.status, 'adapted');
  assert.equal(canonical.retained.publicCourses[0].credits, 2);
  assert.deepEqual(canonical.retainedProgress, adapt(emptyGraph(), r2Source).retainedProgress);
});
for (const target of ['envelope-retained', 'envelope-graph', 'collection', 'array-index', 'credit', 'setter-only', 'array-extra']) {
  test(`R2 accessor ${target} is rejected without invocation`, () => {
    const input = r2Input(); let reads = 0, writes = 0;
    const value = input.retained.publicCourses;
    const descriptor = { enumerable: true, configurable: true, get() { reads++; return value; }, set() { writes++; } };
    if (target === 'envelope-retained') Object.defineProperty(input, 'retained', descriptor);
    if (target === 'envelope-graph') Object.defineProperty(input, 'graph', descriptor);
    if (target === 'collection') Object.defineProperty(input.retained, 'publicCourses', descriptor);
    if (target === 'array-index') Object.defineProperty(value, '0', { ...descriptor, get() { reads++; return r2Source.state.publicCourses[0]; } });
    if (target === 'credit') Object.defineProperty(value[0], 'credits', { ...descriptor, get() { reads++; return 2; } });
    if (target === 'setter-only') Object.defineProperty(value[0], 'credits', { enumerable: true, set() { writes++; } });
    if (target === 'array-extra') Object.defineProperty(value, 'extra', descriptor);
    assert.equal(r2Run(input).status, 'rejected');
    assert.equal(reads, 0); assert.equal(writes, 0);
  });
}
test('R2 retained reflection failure rejects; calculation never reads caller access traps', () => {
  const input = r2Input();
  const throwing = new Proxy(input.retained, { ownKeys() { throw new Error('invalid object'); } });
  assert.equal(r2Run({ ...input, retained: throwing }).status, 'rejected');
  let reads = 0;
  const indirect = new Proxy(input.retained, { get(target, key) { reads++; if (key === 'publicCourses') return []; return Reflect.get(target, key); } });
  const result = r2Run({ ...input, retained: indirect });
  assert.equal(reads, 0);
  assert.equal(result.status, 'adapted');
  assert.equal(result.retained.publicCourses[0].credits, 2);
  assert.deepEqual(result.retained, retained(r2Source.state));
  assert.deepEqual(result.retainedProgress, calculateState(r2Source.state, scope));
  assert.equal(result.retainedProgress.cards.find(c => c.publicCourse)?.publicCourse.countedCredits, 2);
});
test('R2 equality preserves omissions, null, zero, positive, order and plain frozen data', () => {
  const variants = [{}, { v: null }, { v: 0 }, { v: 2 }];
  for (const [i, a] of variants.entries()) for (const [j, b] of variants.entries()) assert.equal(sameAttemptData(a, b), i === j);
  assert.equal(sameAttemptData(undefined, undefined), true, 'omitted source-path values remain comparable');
  assert.equal(sameAttemptData({ a: 2, b: 0 }, Object.freeze({ b: 0, a: 2 })), true);
  assert.equal(sameAttemptData([0, 2], [2, 0]), false);
  assert.equal(sameAttemptData(Object.assign(Object.create(null), { v: 2 }), { v: 2 }), true);
});
for (const value of [undefined, NaN, Infinity, 2n, Symbol('x'), () => 2, new Date(0), new Map(), new Set(), Array(1)]) {
  test(`R2 equality rejects non-data or sparse self-comparison ${String(value)}`, () => {
    assert.equal(sameAttemptData({ v: value }, { v: value }), false);
  });
}
test('R2 equality rejects accessors on either side, cycles and hidden data without reading values', () => {
  let reads = 0; const accessor = { get v() { reads++; return 2; } };
  assert.equal(sameAttemptData(accessor, { v: 2 }), false);
  assert.equal(sameAttemptData({ v: 2 }, accessor), false);
  assert.equal(sameAttemptData(accessor, accessor), false);
  assert.equal(reads, 0);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(sameAttemptData(cyclic, cyclic), false);
  const hidden = Object.defineProperty({}, 'v', { value: 2 });
  assert.equal(sameAttemptData(hidden, hidden), false);
  const shared = { v: 2 };
  assert.equal(sameAttemptData([shared, shared], [{ v: 2 }, { v: 2 }]), true);
});
test('R2 graph sparse arrays reject before inherited index accessors can execute', () => {
  const graph = emptyGraph(); graph.attempts = Array(1); let reads = 0;
  Object.setPrototypeOf(graph.attempts, Object.create(Array.prototype, { 0: { get() { reads++; return newAttempt(master); } } }));
  const result = validateAttemptGraph(graph, blankSource.context);
  assert.equal(result.valid, false); assert.equal(reads, 0);
  assert.ok(result.issues.some(i => i.code === 'non_json_value'));
});
test('R2 graph custom array prototype and reflection failure reject without inherited accessor execution', () => {
  const graph = withAttempts(newAttempt(master)); let reads = 0;
  Object.setPrototypeOf(graph.attempts, Object.create(Array.prototype, { [Symbol.iterator]: { get() { reads++; throw new Error('must not execute'); } } }));
  assert.ok(validateAttemptGraph(graph, blankSource.context).issues.some(i => i.code === 'non_json_value'));
  assert.equal(reads, 0);
  const indirect = new Proxy(emptyGraph(), { ownKeys() { throw new Error('invalid reflection'); } });
  assert.ok(validateAttemptGraph(indirect, blankSource.context).issues.some(i => i.code === 'non_json_value'));
  assert.equal(r2Run({ ...r2Input(), graph: indirect }).status, 'rejected');
});
test('R2 graph snapshots reject clone loss and uncloneable inputs instead of throwing', () => {
  for (const branded of [new Date(0), new Map(), new Set(), /graph/]) {
    // Changing a native object's prototype does not make structuredClone retain
    // its own graph fields. Inspect the snapshot before any calculation uses it.
    Object.setPrototypeOf(branded, Object.prototype); Object.assign(branded, emptyGraph());
    assert.equal(r2Run({ ...r2Input(), graph: branded }).status, 'rejected');
  }
  assert.equal(r2Run({ ...r2Input(), graph: new Proxy(emptyGraph(), {}) }).status, 'rejected');
});
test('R2 out-of-range numeric properties cannot disguise missing array indices', () => {
  const sparse = Array(1); sparse[4294967295] = 2;
  assert.equal(sameAttemptData(sparse, sparse), false);
  assert.equal(sameAttemptData(sparse, [2]), false);
  const graph = emptyGraph(); graph.attempts = sparse;
  assert.ok(validateAttemptGraph(graph, blankSource.context).issues.some(i => i.code === 'non_json_value'));
});
function noPositive(a) {
  for (const decision of Object.values(a.decisions)) {
    if (decision.status === 'supported') assert.equal(decision.value, 0);
    else assert.equal(decision.value, null);
  }
  assert.equal(a.evidence.ruleSupport.status, 'unsupported');
}

const rawBaseline = gunzipSync(readFileSync(new URL('./fixtures/yi07-legacy-baseline.json.gz', import.meta.url)));
const baseline = JSON.parse(rawBaseline);
test('baseline is pinned to pristine dev; all output fields, not total-only hashes', () => {
  assert.equal(baseline.sourceCommit, 'a4c9a088680b376daf7a66a22b62d755036a2107');
  assert.equal(createHash('sha256').update(rawBaseline).digest('hex'), 'a0aed205de6ad027d81351ef354e677b505785de66442f137fdfc21a8af34a7c');
  assert.equal(baseline.cases.length, 192); assert.equal(new Set(baseline.cases.map(c => c.scopeId)).size, 8);
  for (const c of baseline.cases) {
    for (const k of ['requirements','cards','referenceProgress','unknownReasons','coverageSummary','importedContributionCount','historySchoolingDiagnostic']) assert.ok(Object.hasOwn(c.output,k));
    assert.ok(Object.hasOwn(c,'completionOutput')); assert.equal(c.output.graduationCheckComplete,false);
  }
});
for (const c of legacyCases()) test(`pinned v22 full output + unedited projection + adapter boundary: ${c.name}`, async () => {
  const expected = baseline.cases.find(b => b.name === c.name); assert.ok(expected);
  assert.deepEqual(snapshotValue(calculateState(c.state,c.scopeId)),expected.output);
  assert.deepEqual(snapshotValue(calculateCompletion(c.state,c.scopeId)),expected.completionOutput);
  const x = await preview(c.state); assert.equal(x.result.status,'ready',JSON.stringify(x.result.diagnostics));
  const p = projectLegacyState(x.source,x.table,x.result.target);
  assert.deepEqual(snapshotValue(calculateState(p.state,c.scopeId,p.catalog)),expected.output);
  assert.deepEqual(snapshotValue(calculateCompletion(p.state,c.scopeId,p.catalog)),expected.completionOutput);
  const result = adapt(x.result.target.graph,x.source,c.scopeId);
  assert.deepEqual(result.retained, x.result.target.retained);
  assert.deepEqual(result.retainedProgress, calculateState({ ...p.state, items: [], correspondenceProgress: {} },c.scopeId,p.catalog));
  result.attempts.forEach(noPositive);
});

test('legal YI-05 editing is independently accepted and the original projection still rejects it', async () => {
  const x = await preview(); const id = x.result.target.graph.attempts[0].id;
  const command = { kind:'edit', operationId:newOperationId(), attemptId:id, changes:{plan:{...x.result.target.graph.attempts[0].plan, plannedYear:2035, contribution:{value:null,source:'learner',note:null}}} };
  const workspace = applyCommand(createWorkspace(x.result.target.graph,x.source.context),command,x.source.context);
  assert.throws(()=>projectLegacyState(x.source,x.table,{...x.result.target,graph:workspace.graph}),/legacy_projection_requires_ready/);
  const result=adapt(workspace.graph,x.source); assert.equal(result.attempts[0].record.plan.plannedYear,2035);
  assert.deepEqual(result.attempts[0].quantities.learnerContribution.quantity,{kind:'unknown',value:null});
});
for (const value of [undefined,null,0,2,4]) test(`Offering-free 2035 same-name/year/method attempts preserve contribution ${value}`,()=>{
  const a=newAttempt(master,placement,value), b=newAttempt(master,placement,value);
  if(value===undefined){delete a.plan.contribution;delete b.plan.contribution;}
  const result=adapt(withAttempts(a,b));
  assert.notEqual(a.id,b.id); assert.equal(result.attempts.length,2);
  for(const row of result.attempts){
    assert.equal(row.record.plan.plannedYear,2035);assert.equal(row.record.actualYear.value,null);assert.deepEqual(row.record.legacyRefs,[]);
    assert.deepEqual(row.quantities.legacyRegistration,[]); assert.equal(Object.hasOwn(row.record.plan,'contribution'),value!==undefined);
    assert.deepEqual(row.quantities.learnerContribution.quantity,value===undefined?{kind:'omitted'}:value===null?{kind:'unknown',value:null}:value===0?{kind:'zero',value:0}:{kind:'positive',value});
    assert.equal(row.decisions.ordinary.value,value===0?0:null);assert.equal(row.decisions.schooling.value,null);noPositive(row);
  }
});
test('C4 / legacy Offering2 / learner omitted, null, 0, 2 remain three quantities',async()=>{
  const o=catalog.offerings.find(o=>o.credits===2 && master.placements.some(p=>p.compositionCredits===4 && p.institutionalCourseId===o.curriculumCourseId && p.identityDecision.status==='safe'));
  assert.ok(o); const s=initialState();s.items=[{...item(o),status:'earned'}];const x=await preview(s);assert.equal(x.result.status,'ready');
  for(const v of [undefined,null,0,2]){
    const graph=structuredClone(x.result.target.graph),a=graph.attempts[0];
    const p=master.placements.find(p=>p.institutionalCourseId===a.identity.ref.institutionalCourseId && o.mappingIds.includes(p.identityDecision.oldId) && p.compositionCredits===4);
    confirmPlacement(a,p);if(v===undefined)delete a.plan.contribution;else a.plan.contribution={value:v,source:'learner',note:null};
    const row=adapt(graph,x.source).attempts[0];
    assert.deepEqual(row.quantities.composition.quantity,{kind:'positive',value:4});
    assert.equal(row.quantities.legacyRegistration[0].quantity.value,2); assert.equal(row.decisions.ordinary.value,v===0?0:null);noPositive(row);
  }
});
test('correspondence2 and schooling2 never become one completed C4 or S4',()=>{
  const a=confirmPlacement(newAttempt(master,placement,2,'earned','correspondence'),placement),b=confirmPlacement(newAttempt(master,placement,2,'earned','schooling'),placement);
  const result=adapt(withAttempts(a,b));assert.deepEqual(result.attempts.map(r=>r.record.method.value),['correspondence','schooling']);
  for(const r of result.attempts){assert.equal(r.decisions.completion.value,null);assert.equal(r.decisions.schooling.value,null);assert.ok(codes(r).includes('multiple_attempt_rule_unimplemented'));}
});
for(const earned of [null,0,2,4]) test(`official aggregate ${earned} with manual2: exact priority, details never summed`,async()=>{
  const row=officialRow(course,earned);const source=await sourceFor([row],[detail({id:'B',fingerprint:'B',rawName:row.rawName,sourceCourseId:row.id,credits:99}),detail({id:'A',fingerprint:'A',rawName:row.rawName,sourceCourseId:row.id,credits:2})]);
  const a=confirmPlacement(newAttempt(master,placement),placement), result=adapt(withAttempts(a),source);
  const out=result.attempts[0];assert.deepEqual(out.official.exclusiveAchievementIds,[row.id]);
  assert.equal(out.decisions.ordinary.value,0);assert.equal(out.decisions.schooling.value,0);
  assert.equal(result.retained.importedCourseAchievements[0].earnedCreditsTotal,earned);
  assert.deepEqual(result.retained.importedStudyRecords,source.state.importedStudyRecords);
  assert.deepEqual(result.retainedProgress,adapt(emptyGraph(),source).retainedProgress);
  assert.ok(result.officialEvidence.allocations.every(x=>x.credits!==101));
  if(earned===null)assert.ok(codes(out).includes('official_matching_held'));
  if(earned===4){assert.equal(result.officialEvidence.allocations[0].credits,4);assert.equal(result.officialEvidence.allocations[0].completedCredits,4);}
});
test('official completed4 vs incomplete2 is course evidence, never assigned to an Attempt',async()=>{
  const complete=adapt(withAttempts(newAttempt(master,placement,4)),await sourceFor([officialRow(course,4)]));
  const partial=adapt(withAttempts(newAttempt(master,placement,2)),await sourceFor([officialRow(course,2)]));
  assert.equal(complete.officialEvidence.allocations[0].completedCredits,4);
  assert.equal(partial.officialEvidence.allocations.length,0);
  assert.equal(complete.attempts[0].decisions.completion.value,null);assert.equal(partial.attempts[0].decisions.completion.value,null);
});
test('held official matching is not completed by a manual source link',async()=>{
  const row=originalRow({earnedCreditsTotal:null});const source=await sourceFor([row]);const a=newAttempt(master,placement,4);a.plan.importedSourceCourseId=row.id;
  const result=adapt(withAttempts(a),source);assert.equal(result.attempts[0].decisions.ordinary.value,null);
  assert.ok(codes(result.attempts[0]).includes('official_overlap_possible'));assert.equal(result.officialEvidence.allocations.length,0);
  assert.equal(result.retained.importedCourseAchievements[0].earnedCreditsTotal,null);
});
test('shared detail and conflicting method/year pointers never assign aggregate or detail budgets',async()=>{
  const row=officialRow(course),d=detail({rawName:row.rawName,sourceCourseId:row.id,credits:2,academicYear:2024,yearSource:'source'}),source=await sourceFor([row],[d]);
  const attempts=[newAttempt(master,placement),newAttempt(master,placement)];
  for(const a of attempts){a.method={value:'media',source:'official_detail',evidence:{kind:'official_detail',studyRecordId:d.id}};a.actualYear={value:2035,source:'source',evidence:{kind:'official_detail',studyRecordId:d.id},reason:null};}
  const result=adapt(withAttempts(...attempts),source);
  for(const a of result.attempts){assert.deepEqual(a.official.sharedStudyRecordIds,[d.id]);assert.ok(codes(a).includes('official_association_unverified'));assert.ok(codes(a).includes('official_detail_shared'));assert.equal(a.decisions.ordinary.value,0);}
  assert.equal(result.retained.importedStudyRecords[0].academicYear,2024);assert.deepEqual(result.retainedProgress,adapt(emptyGraph(),source).retainedProgress);
});

// Audit counterexamples: referential integrity is not exclusive Course ownership.
const civil = master.placements.find(p => p.scopeId === scope && p.officialName === '民事訴訟法' && p.institutionalCourseId);
const administrative = master.placements.find(p => p.scopeId === scope && p.officialName === '行政法' && p.institutionalCourseId);
const courseFor = p => catalog.curriculum.courses.find(c => c.id === p.auditRecord.oldCurriculumCourseId);
for (const link of ['aggregate', 'method-detail', 'year-detail', 'both-details']) {
  for (const identity of ['same', 'different', 'unknown', 'ambiguous', 'conflict', 'unmatched']) {
    test(`P2-1 ownership ${link}/${identity}: only exact Course identity excludes earned ordinary and S`, async () => {
      const row = officialRow(courseFor(administrative), null);
      const d = detail({ rawName: row.rawName, sourceCourseId: row.id });
      const source = await sourceFor([row], [d]);
      const a = newAttempt(master, identity === 'same' ? administrative : civil, 4);
      if (!['same', 'different'].includes(identity)) {
        a.identity = { status: identity, ref: null, candidateAuditIds: [administrative.auditRecord.oldCurriculumCourseId], reason: '未確定' };
      }
      if (link === 'aggregate') a.plan.importedSourceCourseId = row.id;
      if (['method-detail', 'both-details'].includes(link)) a.method = { value: 'schooling', source: 'official_detail', evidence: { kind: 'official_detail', studyRecordId: d.id } };
      if (['year-detail', 'both-details'].includes(link)) a.actualYear = { value: d.academicYear, source: 'source', evidence: { kind: 'official_detail', studyRecordId: d.id }, reason: null };
      assert.equal(validateAttemptGraph(withAttempts(a), source.context).valid, true);
      const before = adapt(withAttempts(newAttempt(master, identity === 'same' ? administrative : civil, 4)), source);
      const result = adapt(withAttempts(a), source), out = result.attempts[0];
      assert.deepEqual(out.official.exclusiveAchievementIds, identity === 'same' ? [row.id] : []);
      for (const axis of ['ordinary', 'schooling']) {
        assert.equal(out.decisions[axis].status, identity === 'same' ? 'supported' : 'held');
        assert.equal(out.decisions[axis].value, identity === 'same' ? 0 : null);
      }
      if (identity !== 'same') assert.ok(codes(out).includes('official_association_unverified'));
      assert.deepEqual(result.retainedProgress, before.retainedProgress);
      assert.deepEqual(result.officialEvidence, before.officialEvidence);
      assert.equal(result.retained.importedCourseAchievements[0].earnedCreditsTotal, null);
      noPositive(out);
    });
  }
}
for (const parent of ['unmatched', 'ambiguous', 'absent']) for (const link of ['aggregate', 'detail']) {
  test(`P2-1 unresolved parent ${parent}/${link} cannot own a confirmed Attempt`, async () => {
    const row = parent === 'unmatched' ? originalRow({ rawName: civil.officialName }) : {
      ...officialRow(courseFor(civil)), curriculumCourseId: null, curriculumMatch: 'ambiguous',
      candidateCurriculumCourseIds: [courseFor(civil).id, courseFor(administrative).id],
    };
    const d = detail({ rawName: row.rawName, ...(parent === 'absent' ? {} : { sourceCourseId: row.id }) });
    const source = await sourceFor(parent === 'absent' ? [] : [row], [d]);
    const a = newAttempt(master, civil, 4);
    if (link === 'aggregate') {
      if (parent === 'absent') { // dangling links are rejected, not converted into ownership
        a.plan.importedSourceCourseId = row.id;
        assert.equal(validateAttemptGraph(withAttempts(a), source.context).valid, false);
        return;
      }
      a.plan.importedSourceCourseId = row.id;
    } else a.method = { value: 'schooling', source: 'official_detail', evidence: { kind: 'official_detail', studyRecordId: d.id } };
    const out = adapt(withAttempts(a), source).attempts[0];
    assert.deepEqual(out.official.exclusiveAchievementIds, []);
    for (const axis of ['ordinary', 'schooling']) assert.equal(out.decisions[axis].status, 'held');
    assert.ok(codes(out).includes('official_association_unverified'));
    noPositive(out);
  });
}


test('P2-1 an exact old parent with an unsafe crosswalk remains possible, never exclusive', async () => {
  const crosswalk = master.crosswalk.find(d => d.oldEntityKind === 'CurriculumCourse' && d.status !== 'safe');
  const c = catalog.curriculum.courses.find(c => c.id === crosswalk.oldId); assert.ok(c);
  const row = officialRow(c), d = detail({ rawName: row.rawName, sourceCourseId: row.id });
  const source = await sourceFor([row], [d]), a = newAttempt(master, civil, 4);
  a.plan.importedSourceCourseId = row.id;
  a.method = { value: 'schooling', source: 'official_detail', evidence: { kind: 'official_detail', studyRecordId: d.id } };
  const out = adapt(withAttempts(a), source).attempts[0];
  assert.deepEqual(out.official.exclusiveAchievementIds, []);
  assert.deepEqual(out.official.possibleAchievementIds, [row.id]);
  assert.equal(out.decisions.ordinary.status, 'held'); assert.equal(out.decisions.schooling.status, 'held');
});
test('P2-1 a wrong detail does not suppress legitimate exact aggregate ownership or alter its null/zero', async () => {
  for (const value of [null, 0, 4]) {
    const own = officialRow(courseFor(civil), value), other = officialRow(courseFor(administrative), 4);
    const d = detail({ rawName: other.rawName, sourceCourseId: other.id });
    const source = await sourceFor([other, own], [d]), a = newAttempt(master, civil, 4);
    a.method = { value: 'schooling', source: 'official_detail', evidence: { kind: 'official_detail', studyRecordId: d.id } };
    const result = adapt(withAttempts(a), source), out = result.attempts[0];
    assert.deepEqual(out.official.exclusiveAchievementIds, [own.id]);
    assert.deepEqual(out.official.possibleAchievementIds, [other.id]);
    assert.equal(out.decisions.ordinary.value, 0); assert.equal(out.decisions.schooling.value, 0);
    assert.ok(codes(out).includes('official_association_unverified'));
    assert.equal(result.retained.importedCourseAchievements[1].earnedCreditsTotal, value);
    assert.deepEqual(result.retainedProgress, adapt(emptyGraph(), source).retainedProgress);
  }
});
const commonRules = {
  '一般教育': ['common_general_exact_credits', 'common_general_max_credits', 'common_general_humanities_min_credits',
    'common_general_social_min_credits', 'common_general_natural_min_credits', 'common_natural_per_subject_kind_max_credits',
    'common_natural_legacy_reenrollment', 'common_already_fulfilled', 'common_legacy_rules_external', 'common_course_credit_completion'],
  '外国語': ['common_foreign_choose_one', 'common_foreign_exact_credits', 'common_foreign_max_credits', 'common_foreign_min_schooling_credits',
    'common_foreign_reenrollment', 'common_already_fulfilled', 'common_legacy_rules_external', 'common_course_credit_completion'],
  '保健体育': ['common_physical_exact_credits', 'common_physical_max_credits', 'common_physical_choose_one',
    'common_already_fulfilled', 'common_legacy_rules_external', 'common_course_credit_completion'],
};
const ruleIds = out => out.impact.requirementIds.map(id => {
  const r = catalog.requirements.find(r => r.id === id); assert.ok(r, `missing descriptor ${id}`); return r.ruleId;
}).sort();
for (const program of programs) {
  for (const category of Object.keys(commonRules)) test(`P2-2 exact common requirement IDs ${program.displayName}/${category}`, () => {
    const p = master.placements.find(p => p.category === category && (category !== '一般教育' || p.officialName === '物理学1'));
    assert.ok(p);
    const result = adapt(withAttempts(newAttempt(master, p)), blankSource, program.scopeId), out = result.attempts[0];
    assert.deepEqual(ruleIds(out), [...commonRules[category]].sort());
    assert.deepEqual(out.impact.categories, [category]);
    // The legacy warnings remain byte-for-byte in retainedProgress, including other departments.
    assert.deepEqual(result.retainedProgress, adapt(emptyGraph(), blankSource, program.scopeId).retainedProgress);
    assert.ok(result.retainedProgress.requirements.some(r => catalog.requirements.find(d => d.id === r.requirementId)?.status === 'unsupported'));
    assert.equal(out.decisions.ordinary.status, 'held'); noPositive(out);
  });
  test(`P2-2 selected professional and unknown requirement IDs ${program.displayName}`, () => {
    const label = scopeLabelFor[program.course ?? program.department]; assert.ok(label);
    // A local-only control must not silently include another course's placement
    // through the IC union. Mixed-scope candidates are covered by R1 above.
    const p = master.placements.find(p => p.scopeId === program.scopeId && p.category === '専門教育'
      && (!p.institutionalCourseId || master.placements.every(other => other.institutionalCourseId !== p.institutionalCourseId || other.scopeId === program.scopeId))); assert.ok(p);
    assert.ok(candidatePlacements(newAttempt(master, p), master).every(candidate => candidate.scopeId === program.scopeId));
    const result = adapt(withAttempts(newAttempt(master, p), newAttempt(master)), blankSource, program.scopeId);
    const expectedProfessional = result.retainedProgress.requirements.filter(row => {
      const r = catalog.requirements.find(r => r.id === row.requirementId);
      return r.status === 'structured' ? r.scopeId === program.scopeId : r.scopeLabel === label;
    }).map(r => r.requirementId).sort();
    assert.deepEqual([...result.attempts[0].impact.requirementIds].sort(), expectedProfessional);
    const expectedUnknown = result.retainedProgress.requirements.filter(row => {
      const r = catalog.requirements.find(r => r.id === row.requirementId);
      return r.status === 'structured' ? r.scopeId === program.scopeId || catalog.programs.some(p => p.isCommon && p.scopeId === r.scopeId)
        : ['common', label].includes(r.scopeLabel);
    }).map(r => r.requirementId).sort();
    assert.deepEqual([...result.attempts[1].impact.requirementIds].sort(), expectedUnknown);
    assert.equal(result.attempts[1].impact.extent, 'selected_scope_unknown');
    const outside = master.placements.find(p => ![program.scopeId, ...catalog.programs.filter(p => p.isCommon).map(p => p.scopeId)].includes(p.scopeId));
    const unverifiedOutside = adapt(withAttempts(newAttempt(master, outside)), blankSource, program.scopeId).attempts[0];
    assert.equal(unverifiedOutside.impact.extent, 'selected_scope_unknown');
    assert.deepEqual([...unverifiedOutside.impact.requirementIds].sort(), expectedUnknown);
    result.attempts.forEach(noPositive);
  });
}
for(const status of ['unknown','ambiguous','conflict','unmatched'])test(`identity ${status} remains unresolved even with same title`,()=>{
  const a=newAttempt(master,placement);a.identity={status,ref:null,candidateAuditIds:[placement.auditRecord.oldCurriculumCourseId],reason:'未確定'};
  const out=adapt(withAttempts(a)).attempts[0];assert.equal(out.record.identity.status,status);assert.equal(out.record.identity.ref,null);assert.ok(codes(out).includes('identity_unresolved'));noPositive(out);
});
test('multiple Placement candidates keep their order and never select the first',()=>{
  const a=newAttempt(master);const ps=master.placements.filter(p=>p.scopeId===scope).slice(0,2);
  a.placement={status:'ambiguous',ref:null,candidateAuditIds:[],candidatePlacementIds:ps.map(p=>p.id).reverse(),reason:'複数候補'};
  const out=adapt(withAttempts(a)).attempts[0];assert.equal(out.quantities.composition.quantity.kind,'omitted');
  assert.deepEqual(out.record.placement.candidatePlacementIds,a.placement.candidatePlacementIds);assert.ok(codes(out).includes('placement_ambiguous'));
});
for(const status of ['planned','in_progress','waiting','earned','failed','dropped'])test(`lifecycle ${status} is not completion; only its own increment can be held`,()=>{
  const a=confirmPlacement(newAttempt(master,placement,4,status),placement);const out=adapt(withAttempts(a)).attempts[0];
  assert.equal(out.record.plan.status,status);assert.equal(out.decisions.completion.value,null);noPositive(out);
  if(status!=='earned'){assert.equal(out.decisions.ordinary.value,0);assert.equal(out.decisions.schooling.value,0);}
  if(status==='planned')assert.equal(out.decisions.planned.value,null);
  if(status==='in_progress')assert.equal(out.decisions.inProgress.value,null);
});
for(const orders of [[null,null],[1,1],[1,2]])test(`multiple attempts / repeat order ${orders}: no inferred order or cap`,()=>{
  const attempts=orders.map(order=>{const a=confirmPlacement(newAttempt(master,placement),placement);a.plan.earnedOrder=order;return a;});
  for(const out of adapt(withAttempts(...attempts)).attempts){assert.ok(codes(out).includes('multiple_attempt_rule_unimplemented'));assert.equal(codes(out).includes('earned_order_unconfirmed'),orders[0]===null||orders[0]===orders[1]);noPositive(out);}
});
test('professional hold is local; unrelated unknown Attempt cannot erase known official quantity',async()=>{
  const source=await sourceFor([officialRow(course)]),a=confirmPlacement(newAttempt(master,placement),placement);
  const r=adapt(withAttempts(a,newAttempt(master)),source),old=adapt(emptyGraph(),source);
  assert.deepEqual(r.retainedProgress,old.retainedProgress);assert.deepEqual(r.officialEvidence,old.officialEvidence);
  assert.equal(r.officialEvidence.allocations[0].credits,4);assert.equal(r.attempts[0].impact.extent,'placements');
  assert.ok(!r.attempts[0].impact.cardIds.includes('group-general'));assert.ok(!r.attempts[0].impact.cardIds.includes('group-foreign'));
  assert.equal(r.attempts[1].impact.extent,'selected_scope_unknown');assert.ok(r.attempts[1].impact.scopeIds.every(id=>id===scope||catalog.programs.some(p=>p.isCommon&&p.scopeId===id)));
});
for(const program of programs)test(`scope matrix ${program.displayName}: classification local, rules explicitly unsupported`,()=>{
  const p=master.placements.find(p=>p.scopeId===program.scopeId && p.institutionalCourseId && p.auditRecord.placementStatus==='safe');assert.ok(p);
  const a=confirmPlacement(newAttempt(master,p),p);const result=adapt(withAttempts(a),blankSource,program.scopeId),out=result.attempts[0];
  assert.equal(out.record.applicability.status,'unverified');assert.ok(codes(out).includes('applicability_unverified'));assert.equal(out.evidence.ruleSupport.status,'unsupported');
  assert.ok(out.impact.scopeIds.includes(program.scopeId));assert.ok(!out.impact.cardIds.includes('group-physical'));noPositive(out);
});
// Every documented placement, including unresolved special-rule identities, gets
// an independent future Attempt. A selected candidate never confirms a Course.
for (const program of programs) test(`special-rule candidate matrix ${program.displayName}: all placements stay held`, () => {
  const placements = master.placements.filter(p => p.scopeId === program.scopeId);
  assert.ok(placements.length > 0);
  assert.ok(placements.some(p => p.officialName === '卒業論文'));
  const attempts = placements.map(p => newAttempt(master, p));
  const result = adapt(withAttempts(...attempts), blankSource, program.scopeId);
  for (const [index, out] of result.attempts.entries()) {
    assert.deepEqual(out.record.placement.candidatePlacementIds, [placements[index].id]);
    assert.equal(out.record.placement.ref, null);
    assert.ok(out.placementCandidates.some(p => p.id === placements[index].id));
    assert.equal(out.decisions.ordinary.status, 'held');
    assert.equal(out.decisions.completion.status, 'held');
    assert.ok(codes(out).includes('attempt_rule_unimplemented'));
    noPositive(out);
  }
});
for (const category of ['一般教育', '外国語', '保健体育']) test(`common-rule candidate matrix ${category}: future attempts cannot claim completion or S credits`, () => {
  const commonIds = catalog.programs.filter(p => p.isCommon).map(p => p.scopeId);
  const placements = master.placements.filter(p => commonIds.includes(p.scopeId) && p.category === category);
  assert.ok(placements.length > 0);
  const result = adapt(withAttempts(...placements.map(p => newAttempt(master, p))));
  for (const out of result.attempts) {
    assert.deepEqual(out.impact.categories, [category]);
    assert.equal(out.decisions.schooling.status, 'held');
    noPositive(out);
  }
});
test('official ownership excludes earned increments only; planned manual quantities stay held', async () => {
  const source = await sourceFor([officialRow(course)]);
  for (const status of ['planned', 'in_progress']) {
    const out = adapt(withAttempts(newAttempt(master, placement, 2, status)), source).attempts[0];
    assert.equal(out.official.exclusiveAchievementIds.length, 1);
    assert.equal(out.decisions[status === 'planned' ? 'planned' : 'inProgress'].status, 'held');
    noPositive(out);
  }
});
test('delete/detached/progress edit/Undo preserves owners, records and read-only calculation',async()=>{
  const x=await preview();let ws=createWorkspace(x.result.target.graph,x.source.context),before=adapt(ws.graph,x.source);const a=ws.graph.attempts[0];
  const remove={kind:'remove',operationId:newOperationId(),attemptId:a.id};ws=applyCommand(ws,remove,x.source.context);
  const out=adapt(ws.graph,x.source).attempts.find(r=>r.attemptId===a.id);assert.equal(out.impact.extent,'none');assert.equal(out.decisions.ordinary.value,0);
  assert.deepEqual(ws.graph.ownedRecords,before.graph.ownedRecords);
  ws=applyCommand(ws,{kind:'undo',operationId:newOperationId(),attemptId:a.id,removalOperationId:remove.operationId},x.source.context);
  assert.deepEqual(adapt(ws.graph,x.source),before);
});
test('unresolved legacy owner and detached orphan retained, neither creates an earned Attempt',async()=>{
  const s=mixed();s.items=[];const x=await preview(s);const graph=structuredClone(x.result.target.graph);
  const r=graph.ownedRecords.find(r=>r.kind==='media'),a=graph.attempts.find(a=>a.id===r.owner.attemptId);
  r.owner={kind:'unresolved_legacy',ref:a.legacyRefs[0],reason:'旧owner対応未解決'};
  const result=adapt(graph,x.source);assert.equal(result.unresolvedOwners[0].recordId,r.id);assert.deepEqual(result.graph.ownedRecords,graph.ownedRecords);
  result.attempts.forEach(a=>{assert.equal(a.record.plan,null);assert.equal(a.decisions.ordinary.value,0);});
});
for(const [label,mutate] of [
  ['aggregate',r=>{r.importedCourseAchievements[0].earnedCreditsTotal=99;}],
  ['fingerprint',r=>{r.importedCourseAchievements[0].fingerprint='new';}],
  ['omission',r=>{r.importedCourseAchievements[0].curriculumCourseId=null;}],
  ['null',r=>{r.importedCourseAchievements[0].schoolingCreditsTotal=0;}],
  ['meta',r=>{r.importedCourseUserMeta['official-A'].plannedYear++;}],
  ['parent',r=>{delete r.importedStudyRecords[0].sourceCourseId;}],
  ['public',r=>{r.publicCourses[0].credits=4;}],
  ['recognition',r=>{r.graduationProfile.recognizedCredits.totalCredits=4;}],
])test(`retained authority change rejected: ${label}`,async()=>{
  const x=await preview();const input=structuredClone(x.result.target);mutate(input.retained);
  assert.equal(adaptAttemptGraduation(input,x.source,scope).diagnostics[0].code,'retained_source_mismatch');
});
test('official array order, full metadata, optional values, recognition/thesis/public all survive',async()=>{
  const state=mixed();state.importedStudyRecords.push(detail({id:'other',fingerprint:'other',sourceCourseId:'official-A',credits:null,examDate:null}));
  const x=await preview(state),result=adapt(x.result.target.graph,x.source);
  assert.deepEqual(result.retained,x.result.target.retained);
  const input=structuredClone(x.result.target);input.retained.importedStudyRecords.reverse();
  assert.equal(adaptAttemptGraduation(input,x.source,scope).diagnostics[0].code,'retained_source_mismatch');
});
test('nonempty recognition, public and all eight scoped thesis/guidance records retain independent ownership', async () => {
  const { guidanceForScope, thesisGuidanceViews } = await import('../src/planner/graduation/thesisGuidance.ts');
  const state = mixed();
  for (const program of programs) {
    const steps = thesisGuidanceViews(catalog, program.scopeId, state.graduationProfile,
      guidanceForScope(state, program.scopeId), null, new Date('2026-01-01'));
    state.thesisGuidanceByScope[program.scopeId] = {
      steps: Object.fromEntries(steps.map((s, i) => [s.id, { status: i % 2 ? 'planned' : 'passed', passedOn: i % 2 ? null : '2026-09-01' }])),
      geographyReportSubmitted: false,
    };
    state.thesisProgressByScope[program.scopeId] = { selection: 'selected', status: 'in_progress' };
  }
  const offering = catalog.offerings.find(o => o.mappingIds.length && o.courseId);
  state.graduationProfile.admissionType = 'transfer_second_year';
  Object.assign(state.graduationProfile.recognizedCredits, {
    totalCredits: 10, schoolingEquivalentCredits: 0, openUniversityCredits: 2,
    professionalCourses: [{ id: 'recognition-A', offeringId: offering.id, courseId: offering.courseId,
      mappingId: offering.mappingIds[0], name: '原認定名', credits: 2 }],
  });
  const x = await preview(state);
  for (const program of programs) {
    const result = adapt(x.result.target.graph, x.source, program.scopeId);
    assert.deepEqual(result.retained, retained(state));
    assert.deepEqual(result.retainedProgress, calculateState({ ...state, items: [], correspondenceProgress: {} }, program.scopeId));
    assert.equal(result.attempts.length, x.result.target.graph.attempts.length);
  }
});
test('graph validation rejects forged confirmed applicability and malformed IDs, never repairs',()=>{
  const a=confirmPlacement(newAttempt(master,placement),placement);a.applicability.status='confirmed';
  const result=adaptAttemptGraduation({graph:withAttempts(a),retained:retained(blankSource.state)},blankSource,scope);
  assert.equal(result.status,'rejected');assert.ok(result.diagnostics.some(d=>d.code==='unreviewed_applicability'));
  assert.equal(adaptAttemptGraduation({graph:emptyGraph(),retained:retained(blankSource.state)},structuredClone(blankSource),scope).status,'rejected');
});
test('frozen input and storage/clock/random traps: no mutation, IO or ID issuance',()=>{
  const graph=freeze(withAttempts(newAttempt(master,placement)));const input=freeze({graph,retained:retained(blankSource.state)});
  const before=JSON.stringify(input),oldRandom=crypto.randomUUID,oldNow=Date.now,oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldDB=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  const fail=()=>{throw new Error('read-only adapter used an external capability');};
  crypto.randomUUID=fail;Date.now=fail;Object.defineProperty(globalThis,'localStorage',{configurable:true,get:fail});Object.defineProperty(globalThis,'indexedDB',{configurable:true,get:fail});
  try{const result=adaptAttemptGraduation(input,blankSource,scope);assert.equal(result.status,'adapted');assert.equal(JSON.stringify(input),before);assert.throws(()=>{result.retained.importedCourseAchievements.push({});});}
  finally{crypto.randomUUID=oldRandom;Date.now=oldNow;for(const [key,d]of [['localStorage',oldStorage],['indexedDB',oldDB]]){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}}
});
test('YI-06 commit/edit/reload then adapter leaves state/receipt/authority/backup bytes unchanged',async()=>{
  let data=emptyAuthority(),writes=0,reads=0;const store={async read(){reads++;return structuredClone(data);},async commit(expected,next){assert.deepEqual(data,expected);data=structuredClone(next);writes++;}};
  const locks={request:async(_name,_options,fn)=>fn()},api=createAttemptPersistence(store,locks,env);
  let p=await api.prepareMigration(await api.inspectLegacy(JSON.stringify(mixed())));let loaded=await api.commit(p,true,p.previousRaw,p.sourceRaw);
  const a=newAttempt(master,placement,null,'planned');p=await api.prepareEdits(loaded,[{kind:'add',operationId:a.creationOperationId,attempt:a}]);loaded=await api.commit(p,true,p.previousRaw,p.sourceRaw);
  const reloadedApi=createAttemptPersistence(store,locks,env),reloaded=await reloadedApi.load();
  assert.deepEqual(reloaded.state,loaded.state);const backup=await reloadedApi.createBackup(reloaded,'2026-10-18T00:00:00.000Z');
  const before=JSON.stringify({data,state:reloaded.state,ws:reloaded.workspace,source:reloaded.source}),counts=[reads,writes];
  const result=adaptAttemptGraduation(reloaded.state,reloaded.source,scope);assert.equal(result.status,'adapted');assert.equal(result.attempts.at(-1).record.plan.plannedYear,2035);
  assert.deepEqual([reads,writes],counts);assert.equal(JSON.stringify({data,state:reloaded.state,ws:reloaded.workspace,source:reloaded.source}),before);
  assert.equal(await reloadedApi.createBackup(reloaded,'2026-10-18T00:00:00.000Z'),backup);
});
for(const program of programs)test(`existing native official repeatable rule survives adapter: ${program.displayName}`,async()=>{
  const s=importRepeated(repeatedPayload('総合特講',2));s.graduationProfile=repeatProfile;
  const d=await decode(s);assert.equal(d.status,'decoded',JSON.stringify(d.diagnostics));
  const result=adapt(withAttempts(newAttempt(master)),d.source,program.scopeId);
  assert.deepEqual(result.retainedProgress,calculateState({...s,items:[]},program.scopeId));
  assert.deepEqual(result.retained.importedStudyRecords,s.importedStudyRecords);
});
for(const p of japanesePrograms)for(const value of [null,0,1,2])test(`official calligraphy ${p.displayName}/${value} keeps H57 boundary`,async()=>{
  const source=await sourceFor([calligraphyOfficial({earnedCreditsTotal:value})]);
  const result=adapt(withAttempts(newAttempt(master)),source,p.scopeId);
  assert.deepEqual(result.retainedProgress,calculateState({...source.state,items:[]},p.scopeId));
  assert.equal(result.retained.importedCourseAchievements[0].earnedCreditsTotal,value);
});
test('production imports and persistence/projection are not extended with the adapter',()=>{
  function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${path}/${e.name}`):[`${path}/${e.name}`]);}
  for(const path of files(new URL('../src',import.meta.url).pathname).filter(p=>/\.[tj]sx?$/.test(p) && !p.includes('/attempts/graduation/'))){
    assert.doesNotMatch(readFileSync(path,'utf8'),/from\s+['"][^'"]*attempts\/graduation|adaptAttemptGraduation/,path);
  }
  const adapter=readFileSync(new URL('../src/planner/attempts/graduation/adapter.ts',import.meta.url),'utf8');
  assert.doesNotMatch(adapter,/projectLegacyState|plannerItemFromCourseSearch|offeringId:\s*a\.id/);
  assert.equal(validateAttemptGraph(emptyGraph(),blankSource.context).valid,true);
});
