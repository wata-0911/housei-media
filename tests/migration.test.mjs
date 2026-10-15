import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { catalog, initialState, env, files, master, snapshot, media, correspondence, schooling, item, originalRow, detail, mixed, decode, preview } from './fixtures/migration-fixture.mjs';
import { prepareMigrationEnvironment, decodeMigrationSource, parseMigrationJson } from '../src/planner/attempts/migration/source.ts';
import { prepareMigrationIds, validateMigrationAssignments } from '../src/planner/attempts/migration/assignments.ts';
import { previewMigration, projectLegacyState, verifyMigrationPreservation } from '../src/planner/attempts/migration/preview.ts';
import { createBackupCatalogSnapshot } from '../src/planner/backup/plannerBackupCompatibility.ts';
import { validateState } from '../src/planner/validation.ts';
import { validateAttemptGraph } from '../src/planner/attempts/validation.ts';
import { scenarios, calculateScenario } from './fixtures/unresolved-condition-scenarios.mjs';
import { setThesisProgressForScope } from '../src/planner/graduation/thesisSelection.ts';

const ready = x => assert.equal(x.result.status, 'ready', JSON.stringify(x.result.diagnostics));
const roundtrip = x => { ready(x); const p = projectLegacyState(x.source, x.table, x.result.target); assert.deepEqual(p.state, x.source.state); assert.deepEqual(p.catalog, x.source.sourceCatalog); return p; };
for (const kind of ['local', 'v1', 'v2']) for (const scenario of ['empty', 'items', 'official', 'mixed']) test(`${kind} ${scenario}: full roundtrip and original raw`, async () => {
  const state = scenario === 'mixed' ? mixed() : initialState();
  if (scenario === 'items') state.items = [item(correspondence)];
  if (scenario === 'official') { state.importedCourseAchievements = [originalRow()]; state.importedStudyRecords = [detail()]; }
  const before = structuredClone(state), x = await preview(state, kind); roundtrip(x);
  assert.deepEqual(state, before); assert.deepEqual(JSON.parse(x.source.raw).state ?? JSON.parse(x.source.raw), state);
  assert.equal(x.source.rawSha256, createHash('sha256').update(x.source.raw).digest('hex'));
  assert.deepEqual(x.source.rawFiles, files);
  if (scenario === 'official') assert.equal(x.result.target.graph.attempts.length, 0);
});
for (const status of ['planned', 'in_progress', 'waiting', 'earned', 'failed', 'dropped']) test(`all status ${status}`, async () => {
  const state = initialState(); state.items = [{ ...item(correspondence), status }];
  const x = await preview(state); roundtrip(x); assert.equal(x.result.target.graph.attempts[0].plan.status, status);
});
for (const value of [undefined, 0, 2]) test(`contribution ${value}: no fallback, original C4/learner2 separate`, async () => {
  const s = initialState(); s.items = [{ ...item(correspondence), ...(value === undefined ? {} : { courseCreditContribution: value }) }];
  const x = await preview(s); roundtrip(x); const a = x.result.target.graph.attempts[0];
  assert.equal(Object.hasOwn(a.plan, 'contribution'), value !== undefined); assert.equal(a.plan.contribution?.value, value);
  assert.equal(x.source.sourceCatalog.offerings.find(o => o.id === correspondence.id).credits, 4);
});
test('null contribution remains invalid v22 even though Attempt supports it', async () => {
  const s = initialState(); s.items = [{ ...item(correspondence), courseCreditContribution: null }];
  assert.equal(validateState(s, catalog), false); assert.notEqual((await decode(s)).status, 'decoded');
});
test('method references, applicability and actual year are not promoted to official evidence', async () => {
  const x = await preview(); roundtrip(x);
  assert.deepEqual(x.result.target.graph.attempts.map(a => a.method.value), ['media', 'correspondence', 'schooling']);
  for (const a of x.result.target.graph.attempts) { assert.equal(a.method.source, 'legacy_reference'); assert.equal(a.actualYear.value, null); assert.equal(a.applicability.status, 'unknown'); }
});
test('detached shared owner, TODO-only owner and unowned TODO', async () => {
  const s = mixed(); s.items = []; s.todos.push({ id: '00000000-0000-4000-8000-000000000103', offeringId: schooling.id, text: 'TODO only', done: false });
  const x = await preview(s); roundtrip(x);
  assert.equal(x.result.target.graph.attempts.length, 3);
  assert.ok(x.result.target.graph.attempts.every(a => a.plan === null && a.membership.reason === 'legacy_orphan'));
  const mediaRecords = x.result.target.graph.ownedRecords.filter(r => r.kind === 'media' || r.kind === 'evaluation' || r.payload.id === '00000000-0000-4000-8000-000000000101');
  assert.equal(new Set(mediaRecords.map(r => r.owner.attemptId)).size, 1);
});
test('same source and table re-preview is identical, no re-issuance; explicit separate allocation differs', async () => {
  const x = await preview(); ready(x);
  const before = JSON.stringify(x.source), tableBefore = JSON.stringify(x.table);
  const old = crypto.randomUUID; crypto.randomUUID = () => { throw new Error('unexpected reissue'); };
  try { assert.deepEqual(prepareMigrationIds(x.source, [], x.table), x.table); for (let i = 0; i < 3; i++) assert.deepEqual(previewMigration(x.source, x.table), x.result); }
  finally { crypto.randomUUID = old; }
  assert.equal(JSON.stringify(x.source), before); assert.equal(JSON.stringify(x.table), tableBefore);
  assert.notDeepEqual(prepareMigrationIds(x.source), x.table);
});
for (const status of ['safe', 'ambiguous', 'conflict', 'unmatched']) test(`audited identity ${status}, never promote unique relation alone`, async () => {
  const decision = master.crosswalk.find(d => d.oldEntityKind === 'CurriculumCourse' && d.status === status
    && catalog.curriculum.offeringRelations.some(r => r.curriculumCourseId === d.oldId));
  if (status !== 'unmatched') assert.ok(decision, status);
  const offering = decision ? catalog.offerings.find(o => o.curriculumCourseId === decision.oldId)
    : catalog.offerings.find(o => catalog.curriculum.offeringRelations.find(r => r.offeringId === o.id).candidateCurriculumCourseIds.length === 0);
  const s = initialState(); s.items = [item(offering)]; const x = await preview(s); roundtrip(x);
  const a = x.result.target.graph.attempts[0]; assert.equal(a.identity.status, status === 'safe' ? 'confirmed' : status);
  assert.deepEqual(a.identity.candidateAuditIds, decision ? [decision.oldId] : []);
  if (status !== 'safe') { assert.equal(a.identity.ref, null); assert.ok(a.identity.reason); }
});
test('different old Offerings of same safe identity retain independent IDs and order', async () => {
  const decision = master.crosswalk.find(d => d.status === 'safe' && d.oldEntityKind === 'CurriculumCourse' && catalog.offerings.filter(o => o.curriculumCourseId === d.oldId).length > 1);
  const offerings = catalog.offerings.filter(o => o.curriculumCourseId === decision.oldId).slice(0, 2).reverse();
  const s = initialState(); s.items = offerings.map(item); const x = await preview(s); roundtrip(x);
  const a = x.result.target.graph.attempts; assert.notEqual(a[0].id, a[1].id); assert.equal(a[0].identity.ref.institutionalCourseId, a[1].identity.ref.institutionalCourseId);
  assert.deepEqual(a.map(row => row.legacyRefs[0].oldId), offerings.map(o => o.id));
});
for (const kind of ['local', 'v1', 'v2']) for (const date of ['2027-02-30', '2027-99-99', '2027-02-28', '2028-02-29', null]) test(`${kind} assessment calendar ${date}`, async () => {
  const s = mixed(); s.mediaSchoolingProgress[media.id].assessments[0].scheduledDate = date; assert.equal(validateState(s, catalog), true);
  const x = await preview(s, kind), invalid = ['2027-02-30', '2027-99-99'].includes(date);
  assert.equal(x.result.status, invalid ? 'held' : 'ready');
  if (invalid) {
    assert.equal(Object.hasOwn(x.result, 'target'), false);
    const diagnostic = x.result.diagnostics.find(d => d.code === 'assessment_date'); assert.ok(diagnostic);
    assert.deepEqual(diagnostic.original.payload, s.mediaSchoolingProgress[media.id]);
    assert.equal(diagnostic.original.assessment.scheduledDate, date);
    assert.equal(diagnostic.original.owner.attemptId, x.table.attempts[0].attemptId);
    assert.throws(() => projectLegacyState(x.source, x.table, x.result.candidate));
    assert.deepEqual(previewMigration(x.source, x.table), x.result);
  } else roundtrip(x);
  assert.deepEqual(x.source.state, s);
});
for (const [label, mutate] of [
  ['unknown root', s => { s.future = 1; }], ['unknown item', s => { s.items[0].future = 1; }],
  ['missing item field', s => { delete s.items[0].plannedTerm; }], ['unknown nested report', s => { s.importedStudyRecords[0].reports[0].future = 1; }],
  ['unknown recognition field', s => { s.graduationProfile.recognizedCredits.future = 1; }], ['recognition shadow', s => { s.graduationProfile.recognizedCredits.totalCredits = 9924; }],
  ['unknown offering', s => { s.items[0].offeringId = randomUUID(); }], ['duplicate old owner', s => { s.items.push(structuredClone(s.items[0])); }],
  ['map key payload conflict', s => { s.courseEvaluations[media.id].offeringId = schooling.id; }],
  ['dangling official parent', s => { s.importedStudyRecords[0].sourceCourseId = 'absent'; }], ['duplicate official id', s => { s.importedCourseAchievements.push(structuredClone(s.importedCourseAchievements[0])); }],
  ['duplicate assessment id', s => { s.mediaSchoolingProgress[media.id].assessments.push(structuredClone(s.mediaSchoolingProgress[media.id].assessments[0])); }],
  ['dangling official candidate', s => { s.importedCourseAchievements[0].candidateOfferingIds = [randomUUID()]; }],
  ['dangling recognition', s => { s.graduationProfile.recognizedCredits.professionalCourses.push({ id: 'rec', offeringId: randomUUID(), courseId: null, mappingId: null, name: 'raw', credits: 2 }); }],
]) test(`source refuses ${label}`, async () => {
  const s = mixed(); mutate(s); const raw = JSON.stringify(s); const d = await decode(s);
  assert.notEqual(d.status, 'decoded', label); assert.deepEqual(JSON.parse(d.raw), JSON.parse(raw));
});
test('required thesis normalization is held without applying it', async () => {
  const s = initialState(); s.selectedScopeId = catalog.programs.find(p => p.department === '史学科').scopeId;
  const d = await decode(s); assert.equal(d.status, 'held'); assert.equal(d.diagnostics[0].code, 'source_normalization');
  assert.deepEqual(JSON.parse(d.raw).thesisProgressByScope, {});
});
for (const version of [1, 7, 21, 23, 999]) test(`unsupported state schema ${version}`, async () => {
  const s = initialState(); s.schemaVersion = version; const d = await decode(s); assert.equal(d.status, 'rejected'); assert.equal(d.diagnostics[0].code, 'unsupported_state_version');
});
for (const version of [0, 3, 999]) test(`unsupported backup version ${version}`, async () => {
  const raw = JSON.stringify({ format: 'hosei-planner-backup', backupVersion: version, catalog: snapshot, state: initialState(), createdAt: '2026-10-15T00:00:00.000Z' });
  const d = await decodeMigrationSource(raw, env); assert.equal(d.status, 'rejected'); assert.equal(d.raw, raw);
});
for (const raw of ['{', '{"schemaVersion":22,"schemaVersion":22}', '{"value":9007199254740993}', '{"value":1e400}', '{"value":-0}', '{"format":"hosei-planner-protection","protectionVersion":1}']) test(`lossy/protection JSON refused: ${raw}`, async () => {
  const d = await decodeMigrationSource(raw, env, catalog); assert.equal(d.status, 'rejected'); assert.equal(d.raw, raw);
});
test('JSON duplicate escaped keys and nested duplicate keys are refused', () => {
  assert.throws(() => parseMigrationJson('{"a":{"x":1,"\\u0078":2}}'), /duplicate_json_key/);
  assert.deepEqual(parseMigrationJson('{"a":[{},[],{"x":"quoted,\\\"key"}]}'), { a: [{}, [], { x: 'quoted,"key' }] });
});
test('local original required, raw6 mismatch/extra/missing refused', async () => {
  assert.equal((await decodeMigrationSource(JSON.stringify(initialState()), env)).status, 'rejected');
  const path = Object.keys(files)[0];
  await assert.rejects(prepareMigrationEnvironment({ ...files, [path]: files[path] + ' ' }), /raw_archive_digest/);
  await assert.rejects(prepareMigrationEnvironment({ ...files, future: '{}' }), /raw_archive_coverage/);
  const missing = { ...files }; delete missing[path]; await assert.rejects(prepareMigrationEnvironment(missing), /raw_archive_coverage/);
});
for (const kind of ['v1', 'v2']) test(`${kind} unknown/damaged original rejected`, async () => {
  const d = await decode(initialState(), kind); assert.equal(d.status, 'decoded');
  const raw = JSON.parse(d.source.raw); raw.catalog.sha256 = '0'.repeat(64);
  assert.equal((await decodeMigrationSource(JSON.stringify(raw), env)).status, 'rejected');
});
test('v2 compatible source citation/display changes preserved against original and target', async () => {
  const source = structuredClone(catalog); source.offerings[0].source = { url: 'https://example.test/original', page: 99 }; source.programs[0].displayName = '原表示';
  const target = structuredClone(catalog); target.programs[0].displayName = 'target表示';
  const environment = await prepareMigrationEnvironment(files, target), raw = JSON.stringify({ format: 'hosei-planner-backup', backupVersion: 2,
    catalog: await createBackupCatalogSnapshot(source), createdAt: '2026-10-15T00:00:00.000Z', state: initialState() });
  const d = await decodeMigrationSource(raw, environment); assert.equal(d.status, 'decoded', JSON.stringify(d.diagnostics));
  const ids = prepareMigrationIds(d.source), p = previewMigration(d.source, ids); assert.equal(p.status, 'ready');
  assert.deepEqual(projectLegacyState(d.source, ids, p.target).catalog, source); assert.notDeepEqual(d.source.sourceCatalog, target);
});
for (const change of ['quantity', 'order', 'unknown', 'rule']) test(`semantic catalog change ${change} refuses migration`, async () => {
  const c = structuredClone(catalog);
  if (change === 'quantity') c.offerings[0].credits = 99;
  if (change === 'order') c.offerings.reverse();
  if (change === 'unknown') c.metadata.futureSemantics = true;
  if (change === 'rule') c.requirements[0].value = 99;
  await assert.rejects(prepareMigrationEnvironment(files, c));
  // Source snapshots that pass existing catalog validation still cannot bypass the audited rule.
  try {
    const metadata = await createBackupCatalogSnapshot(c);
    const raw = JSON.stringify({ format: 'hosei-planner-backup', backupVersion: 2, catalog: metadata, createdAt: '2026-10-15T00:00:00.000Z', state: initialState() });
    assert.equal((await decodeMigrationSource(raw, env)).status, 'rejected');
  } catch (e) { assert.match(e.message, /カタログ/); }
});
for (const [label, mutate] of [
  ['binding raw', t => { t.binding.rawSha256 = '0'.repeat(64); }], ['rule version', t => { t.binding.rule.version++; }],
  ['missing', t => { t.attempts.pop(); }], ['extra', t => { t.records.push(structuredClone(t.records[0])); }],
  ['unknown', t => { t.future = true; }], ['wrong slot', t => { t.attempts[0].offeringId = schooling.id; }],
  ['order', t => { t.attempts.reverse(); }], ['duplicate UUID', t => { t.attempts[1].attemptId = t.attempts[0].attemptId; }],
  ['cross namespace', t => { t.attempts[0].operationId = t.attempts[0].attemptId.replace('hosei:attempt:', 'hosei:attempt-op:'); }],
  ['master collision', t => { t.attempts[0].attemptId = `hosei:attempt:${master.institutionalCourses[0].id.split(':').at(-1)}`; }],
  ['legacy collision', t => { t.attempts[0].attemptId = `hosei:attempt:${media.id}`; }],
]) test(`fixed assignments reject ${label}`, async () => {
  const x = await preview(), t = structuredClone(x.table); mutate(t);
  assert.throws(() => validateMigrationAssignments(x.source, t)); assert.equal(previewMigration(x.source, t).status, 'rejected');
});
test('external occupied namespace collision and foreign source cannot reuse table', async () => {
  const x = await preview(), reserved = [`hosei:attempt:${randomUUID()}`], table = prepareMigrationIds(x.source, reserved);
  assert.equal(previewMigration(x.source, table, reserved).status, 'ready');
  assert.equal(previewMigration(x.source, table).status, 'rejected');
  const bad = structuredClone(table); bad.attempts[0].attemptId = reserved[0];
  assert.equal(previewMigration(x.source, bad, reserved).status, 'rejected');
  const other = await decode({ ...mixed(), todos: [] }); assert.equal(previewMigration(other.source, x.table).status, 'rejected');
});
for (const [label, mutate] of [
  ['official aggregate', t => { t.retained.importedCourseAchievements[0].earnedCreditsTotal = 17; }],
  ['official source', t => { t.retained.importedCourseAchievements[0].fingerprint = 'regenerated'; }],
  ['omitted to null', t => { t.retained.importedCourseAchievements[0].curriculumCourseId = null; }],
  ['null to zero', t => { t.retained.importedCourseAchievements[0].schoolingCreditsTotal = 0; }],
  ['details', t => { t.retained.importedStudyRecords[0].rawYear = '2026'; }], ['meta', t => { t.retained.importedCourseUserMeta['official-A'].plannedYear++; }],
  ['recognition', t => { t.retained.graduationProfile.recognizedCredits.totalCredits = 2; }],
  ['public', t => { t.retained.publicCourses[0].title = 'changed'; }], ['thesis', t => { t.retained.thesisSelection = 'selected'; }],
  ['extra field', t => { t.future = true; }], ['attempt order', t => { t.graph.attempts.reverse(); }],
  ['assessment ID', t => { t.graph.ownedRecords[0].payload.assessments[0].id = 'new'; }],
  ['progress array order', t => { t.graph.ownedRecords[0].payload.lessons.reverse(); }],
  ['report number', t => { t.graph.ownedRecords.find(r => r.kind === 'correspondence').payload.reports[0].reportNumber = 7; }],
  ['owner reassignment', t => { t.graph.ownedRecords[0].owner.attemptId = t.graph.attempts[1].id; }],
  ['map source key', t => { t.ledger.records[0].sourceKey = schooling.id; }],
  ['missing record', t => { t.graph.ownedRecords.pop(); }], ['field ledger', t => { t.ledger.fields.pop(); }],
  ['placement conflict', t => { t.graph.attempts[0].placement = structuredClone(t.graph.attempts[1].placement); }],
]) test(`independent preservation rejects ${label}`, async () => {
  const x = await preview(), t = structuredClone(x.result.target); mutate(t);
  const before = structuredClone(t), checked = verifyMigrationPreservation(x.source, x.table, t);
  assert.notEqual(checked.status, 'ready'); assert.deepEqual(t, before); assert.throws(() => projectLegacyState(x.source, x.table, t));
});
test('graph PASS alone cannot approve moved owner or altered official quantities', async () => {
  const x = await preview(), t = structuredClone(x.result.target);
  t.graph.ownedRecords[0].owner.attemptId = t.graph.attempts[1].id; t.retained.importedCourseAchievements[0].earnedCreditsTotal = 99;
  assert.equal(validateAttemptGraph(t.graph, x.source.context).valid, true);
  assert.equal(verifyMigrationPreservation(x.source, x.table, t).status, 'held');
});
test('source/target immutable handles, forged source refuses, corrected raw requires new binding', async () => {
  const x = await preview(); assert.throws(() => { x.source.state.items.reverse(); }); assert.throws(() => { x.table.attempts.reverse(); });
  assert.equal(previewMigration(structuredClone(x.source), x.table).status, 'rejected');
  const changed = mixed(); changed.mediaSchoolingProgress[media.id].assessments[0].scheduledDate = '2028-02-29';
  const d = await decode(changed); assert.equal(previewMigration(d.source, x.table).status, 'rejected');
  const ids = prepareMigrationIds(d.source); assert.equal(previewMigration(d.source, ids).status, 'ready');
});
for (const value of [null, 0, 2]) test(`official quantity ${value} and component17 remain independent`, async () => {
  const s = mixed(); s.importedCourseAchievements[0].earnedCreditsTotal = value;
  const x = await preview(s); roundtrip(x); assert.equal(x.result.target.retained.importedCourseAchievements[0].earnedCreditsTotal, value);
  assert.equal(x.result.target.retained.importedStudyRecords[0].credits, 17);
});
for (const program of catalog.programs.filter(p => !p.isCommon)) test(`scope ${program.displayName}: thesis/profile/reference preservation and calculation`, async () => {
  let s = mixed(); s.selectedScopeId = program.scopeId;
  s = setThesisProgressForScope(s, catalog, program.scopeId, { selection: 'selected', status: 'planned' });
  const x = await preview(s), p = roundtrip(x);
  const context = { catalog, scopeId: program.scopeId, items: s.items, rows: s.importedCourseAchievements, records: s.importedStudyRecords, selection: s.thesisSelection, profile: s.graduationProfile };
  assert.deepEqual(calculateScenario({ ...context, catalog: p.catalog, items: p.state.items, rows: p.state.importedCourseAchievements, records: p.state.importedStudyRecords, profile: p.state.graduationProfile, selection: p.state.thesisSelection }), calculateScenario(context));
});
test('all 168 baseline inputs: 160 original-catalog projections agree, eight edited catalogs refused', async () => {
  let projected = 0, refused = 0;
  for (const scenario of scenarios()) {
    const s = initialState(); Object.assign(s, { items: scenario.items, importedCourseAchievements: scenario.rows, importedStudyRecords: scenario.records, graduationProfile: scenario.profile, thesisSelection: scenario.selection });
    const d = await decode(s, 'local', env, scenario.catalog);
    if (scenario.name.endsWith('/I-credits')) { assert.equal(d.status, 'rejected'); refused++; continue; }
    assert.equal(d.status, 'decoded', `${scenario.name}: ${JSON.stringify(d.diagnostics)}`);
    const ids = prepareMigrationIds(d.source), result = previewMigration(d.source, ids); assert.equal(result.status, 'ready', `${scenario.name}: ${JSON.stringify(result.diagnostics)}`);
    const p = projectLegacyState(d.source, ids, result.target);
    assert.deepEqual(calculateScenario({ ...scenario, catalog: p.catalog, items: p.state.items, rows: p.state.importedCourseAchievements, records: p.state.importedStudyRecords, profile: p.state.graduationProfile, selection: p.state.thesisSelection }), calculateScenario(scenario), scenario.name);
    projected++;
  }
  assert.deepEqual([projected, refused], [160, 8]);
});
test('read-only pipeline never accesses browser primary/recovery or writes through global storage', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); let access = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { access++; throw new Error('Browser storage accessed'); } });
  try { const x = await preview(); roundtrip(x); const invalid = mixed(); invalid.mediaSchoolingProgress[media.id].assessments[0].scheduledDate = '2027-99-99'; assert.equal((await preview(invalid)).result.status, 'held'); await decode({ schemaVersion: 23 }); }
  finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
  assert.equal(access, 0);
  for (const name of ['source', 'assignments', 'transform', 'preview', 'contracts']) {
    const code = readFileSync(new URL(`../src/planner/attempts/migration/${name}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /localStorage|sessionStorage|\.setItem\(|navigator\.locks|Date\.now\(/);
  }
});
test('valid UUID swaps and newly fabricated assignment tables cannot forge issuance history', async () => {
  const x = await preview(), copy = structuredClone(x.table);
  assert.throws(() => validateMigrationAssignments(x.source, copy), /unverified_assignment_history/);
  [copy.attempts[0].attemptId, copy.attempts[1].attemptId] = [copy.attempts[1].attemptId, copy.attempts[0].attemptId];
  assert.throws(() => validateMigrationAssignments(x.source, copy), /unverified_assignment_history/);
  const again = await decode(x.source.state);
  assert.equal(previewMigration(again.source, x.table).status, 'ready');
});
test('allocator refuses random generator collision without retrying into a new identity', async () => {
  const d = await decode(initialState());
  const s = mixed(), decoded = await decode(s), old = crypto.randomUUID;
  crypto.randomUUID = () => media.id;
  try { assert.throws(() => prepareMigrationIds(decoded.source), /assignment_uuid_collision/); assert.ok(prepareMigrationIds(d.source)); }
  finally { crypto.randomUUID = old; }
});
test('scope guidance, complete recognition and ordered official sources preserve every field', async () => {
  const { guidanceForScope, thesisGuidanceViews } = await import('../src/planner/graduation/thesisGuidance.ts');
  const s = mixed();
  for (const program of catalog.programs.filter(p => !p.isCommon)) {
    const steps = thesisGuidanceViews(catalog, program.scopeId, s.graduationProfile, guidanceForScope(s, program.scopeId), null, new Date('2026-01-01'));
    s.thesisGuidanceByScope[program.scopeId] = { steps: Object.fromEntries(steps.map((step, i) => [step.id, { status: i % 2 ? 'planned' : 'passed', passedOn: i % 2 ? null : '2026-09-01' }])), geographyReportSubmitted: false };
  }
  s.graduationProfile.admissionType = 'transfer_second_year';
  const recognizedOffering = catalog.offerings.find(o => o.mappingIds.length && o.courseId);
  Object.assign(s.graduationProfile.recognizedCredits, { totalCredits: 10, schoolingEquivalentCredits: 0, openUniversityCredits: 2,
    professionalCourses: [{ id: 'recognition-A', offeringId: recognizedOffering.id, courseId: recognizedOffering.courseId, mappingId: recognizedOffering.mappingIds[0], name: '原認定名', credits: 2 }] });
  s.importedCourseAchievements.unshift(originalRow({ id: 'official-B', fingerprint: 'original-B', academicYear: 2023, yearSource: 'manual' }));
  s.importedStudyRecords.unshift(detail({ id: 'detail-B', fingerprint: 'detail-B', academicYear: 2023, yearSource: 'inferred' }));
  const x = await preview(s); roundtrip(x);
  const t = structuredClone(x.result.target); t.retained.importedCourseAchievements.reverse(); assert.notEqual(verifyMigrationPreservation(x.source, x.table, t).status, 'ready');
  const guidance = structuredClone(x.result.target), scope = Object.keys(guidance.retained.thesisGuidanceByScope)[0];
  guidance.retained.thesisGuidanceByScope[scope].steps.general.passedOn = null;
  assert.notEqual(verifyMigrationPreservation(x.source, x.table, guidance).status, 'ready');
});
test('optional calligraphy batch status retained without inferred completion', async () => {
  const { isCalligraphyCorrespondence } = await import('../src/planner/progress/calligraphyProgress.ts');
  const offering = catalog.offerings.find(isCalligraphyCorrespondence), s = initialState();
  s.correspondenceProgress[offering.id] = { offeringId: offering.id, requiredReports: null, reports: [], examGrade: null, calligraphyBatchStatus: 'grading' };
  const x = await preview(s); roundtrip(x); assert.equal(x.result.target.graph.ownedRecords[0].payload.calligraphyBatchStatus, 'grading');
});
