import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeInstitutionalCanonicalName } from '../src/planner/institutional/canonicalName.ts';
import { yi02IssuanceBaseline } from '../src/planner/institutional/registryBaseline.ts';
import { loadInstitutionalCatalog } from '../src/planner/institutional/loader.ts';
import { loadYi01InstitutionalCatalog, yi01InstitutionalInput, yi02InstitutionalRegistry } from '../src/planner/institutional/yi01.ts';
import { searchInstitutionalPlacements, placementsForContext, resolveInstitutionalLegacyRef } from '../src/planner/institutional/query.ts';
import { validateInstitutionalLegacyArchive, resolveInstitutionalArchiveRef } from '../src/planner/institutional/legacyArchive.ts';
import { institutionalFixture } from './fixtures/institutional-fixture.mjs';
import { catalog } from '../src/planner/catalog/catalog.ts';
import { applyManualMappingOverrides } from '../src/planner/catalog/manualMappingOverrides.ts';
import { attachCurriculumCatalog } from '../src/planner/catalog/curriculumCatalog.ts';
import { deriveCurriculumCourseView } from '../src/planner/progress/curriculumCourseView.ts';
import { calculateGraduationProgress } from '../src/planner/graduation/graduationProgress.ts';
import { LEGACY_BACKUP_CATALOGS } from '../src/planner/backup/plannerBackupCompatibility.ts';
import { initialState } from '../src/planner/backup/storage.ts';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const archive = read('../docs/planner-yi-01/legacy-relations.json');
const summary = read('../docs/planner-yi-01/summary.json');
const cloneInput = () => structuredClone(yi01InstitutionalInput);
const real = loadYi01InstitutionalCatalog();
const counts = rows => Object.fromEntries(['safe', 'ambiguous', 'conflict', 'unmatched'].map(status => [status, rows.filter(r => r.status === status).length]));

test('institutional: synthetic Offering 0 loads and exposes official evidence/credits without name fallback', () => {
  const { input, registry, baseline } = institutionalFixture();
  assert.equal(input.offerings.length, 0);
  const model = loadInstitutionalCatalog(input, registry, baseline);
  const found = searchInstitutionalPlacements(model, '同名科目');
  assert.equal(found.length, 3);
  assert.equal(found[0].officialName, '同名科目');
  assert.equal(found[0].compositionCredits, 4);
  assert.equal(found[0].category, '専門教育');
  assert.equal(found[0].requirementType, '必修');
  assert.equal(found[0].identityDecision.status, 'safe');
  assert.ok(found[0].identityDecision.reason.length);
  assert.equal(found[0].officialRow.sourceDigest, model.sourceRevision.sha256);
  assert.deepEqual(found[0].identityDecision.scopeIds, [registry.scopes[0].id]);
  assert.ok(model.institutionalCourses.every(course => !('credits' in course) && !('category' in course)));
});

test('institutional: IC/placement IDs and issuance requests unique, no annual minting', () => {
  for (const records of [real.institutionalCourses, real.placements]) assert.equal(new Set(records.map(r => r.id)).size, records.length);
  const requests = [...yi02InstitutionalRegistry.institutionalCourses, ...yi02InstitutionalRegistry.curriculumVersions, ...yi02InstitutionalRegistry.placements].map(r => r.issuanceRequestId);
  assert.equal(new Set(requests).size, requests.length);
  const registry = structuredClone(yi02InstitutionalRegistry);
  registry.placements.push(registry.placements[0]);
  assert.throws(() => loadInstitutionalCatalog(cloneInput(), registry), /duplicate/);
});

test('institutional: source PDF and all six raw digests reject mismatch, missing, extra and semantic backup digest', () => {
  const input = cloneInput(); input.sourceDigest = '0'.repeat(64);
  assert.throws(() => loadInstitutionalCatalog(input, yi02InstitutionalRegistry), /source digest/);
  for (const key of Object.keys(summary.legacyDigests)) {
    const bad = cloneInput(); bad.legacyDigests[key] = '0'.repeat(64);
    assert.throws(() => loadInstitutionalCatalog(bad, yi02InstitutionalRegistry), /raw digest/);
    delete bad.legacyDigests[key];
    assert.throws(() => loadInstitutionalCatalog(bad, yi02InstitutionalRegistry), /raw digest/);
  }
  for (const digest of [LEGACY_BACKUP_CATALOGS[0].sha256, LEGACY_BACKUP_CATALOGS[0].semanticSha256]) {
    const bad = cloneInput(); bad.legacyDigests['src/data/planner_catalog_2026.json'] = digest;
    assert.throws(() => loadInstitutionalCatalog(bad, yi02InstitutionalRegistry), /raw digest/);
  }
  const bad = cloneInput(); bad.legacyDigests.extra = '0'.repeat(64);
  assert.throws(() => loadInstitutionalCatalog(bad, yi02InstitutionalRegistry), /raw digest/);
});

test('institutional: dangling refs, namespace, revision, malformed evidence and duplicate role reject', () => {
  const mutations = [
    (i, r) => { r.curriculumVersions[0].sourceRevisionId = 'missing'; },
    (i, r) => { r.placements[0].curriculumVersionId = 'missing'; },
    (i, r) => { r.placements[0].id = 'unknown:cp:00000000-0000-4000-8000-000000000001'; },
    (i, r) => { r.institutionalCourses[0].id = 'unknown:ic:00000000-0000-4000-8000-000000000001'; },
    i => { i.mappingRows[0].scopeId = 'missing'; },
    i => { i.mappingRows[0].candidateStableIds = ['missing']; },
    i => { i.mappingRows[0].officialEvidenceIds = ['missing']; },
    i => { i.curriculumRows[0].peerCurriculumCourseIds = ['missing']; },
    i => { i.officialRows[0].pdfPage = -1; },
    i => { i.curriculumRows[0].ruleVersion = 2; },
    i => { i.mappingRows[0].legacyDigest = '0'.repeat(64); },
    i => { i.mappingRows[0].mainCodeEvidenceIds = ['missing']; },
    (i, r) => { r.curriculumVersions[0].applicabilityStatus = 'current_2026'; },
  ];
  for (const mutate of mutations) {
    const i = cloneInput(), r = structuredClone(yi02InstitutionalRegistry); mutate(i, r);
    assert.throws(() => loadInstitutionalCatalog(i, r), /Institutional catalog/);
  }
  const f = institutionalFixture(); f.registry.placements[1].placementRoleKey = f.registry.placements[0].placementRoleKey;
  assert.throws(() => loadInstitutionalCatalog(f.input, f.registry, f.baseline), /placement role mismatch/);
});

test('institutional: same name/credits never merge identities and same scope permits 4/2 roles', () => {
  const f = institutionalFixture(); const model = loadInstitutionalCatalog(f.input, f.registry, f.baseline);
  const courses = model.institutionalCourses.filter(c => c.officialName === '同名科目');
  assert.equal(courses.length, 2); assert.notEqual(courses[0].id, courses[1].id);
  const placements = model.placements.filter(p => p.institutionalCourseId === courses[0].id);
  assert.deepEqual(placements.map(p => p.compositionCredits), [4, 2]);
  assert.equal(new Set(placements.map(p => p.scopeId)).size, 1);
  assert.equal(new Set(placements.map(p => p.placementRoleKey)).size, 2);
  assert.deepEqual(placements.map(p => p.requirementType), ['必修', 'スクーリング選択必修']);
  assert.equal(placements[1].methodConstraint.requiredMethod, 'schooling');
});

test('institutional: Ⅰ/Ⅱ/A/B/(1)/(2) remain distinct searchable labels', () => {
  const f = institutionalFixture(); const model = loadInstitutionalCatalog(f.input, f.registry, f.baseline);
  for (const name of ['科目Ⅰ', '科目Ⅱ', '科目A', '科目B', '科目(1)', '科目(2)']) {
    assert.equal(searchInstitutionalPlacements(model, name).length, 1);
    assert.equal(searchInstitutionalPlacements(model, name)[0].officialName, name);
  }
});

test('institutional: null/0 composition credits remain different', () => {
  const f = institutionalFixture(['不明単位', '明示ゼロ']);
  for (const [n, value] of [[0, null], [2, 0]]) {
    f.input.officialRows[n].curriculumCredits = value;
    f.input.mappingRows[n].legacySnapshot.curriculumCredits = value;
  }
  const model = loadInstitutionalCatalog(f.input, f.registry, f.baseline);
  assert.equal(searchInstitutionalPlacements(model, '不明単位')[0].compositionCredits, null);
  assert.equal(searchInstitutionalPlacements(model, '明示ゼロ')[0].compositionCredits, 0);
});

test('institutional: non-safe adoption and unique legacy relation promotion rejected', () => {
  for (const status of ['ambiguous', 'conflict', 'unmatched']) {
    const i = cloneInput(); const row = i.curriculumRows.find(r => r.status === status);
    row.adoptedStableId = row.candidateStableIds[0];
    assert.throws(() => loadInstitutionalCatalog(i, yi02InstitutionalRegistry), /non-safe/);
    const j = cloneInput(); const mapping = j.mappingRows.find(r => r.status === status);
    mapping.adoptedStableId = mapping.candidateStableIds[0];
    assert.throws(() => loadInstitutionalCatalog(j, yi02InstitutionalRegistry), /non-safe/);
  }
  const i = cloneInput(); const row = i.curriculumRows.find(r => r.status === 'ambiguous');
  row.status = 'safe'; row.ruleId = 'S-ROW'; row.adoptedStableId = row.candidateStableIds[0];
  assert.throws(() => loadInstitutionalCatalog(i, yi02InstitutionalRegistry), /unsafe stable adoption/);
  const relation = archive.legacyCourseRelations.find(r => r.curriculumCourseId && real.curriculumAudit.find(c => c.oldCurriculumCourseId === r.curriculumCourseId)?.status !== 'safe');
  assert.ok(relation);
  const result = resolveInstitutionalArchiveRef(real, archive, { oldEntityKind: 'legacyCourse', oldId: relation.legacyCourseId,
    sourceDigest: real.sourceRevision.sha256, legacyDigest: summary.legacyDigests['src/data/planner_catalog_2026.json'] });
  assert.equal(result.decisions.length, 1); assert.equal(result.decisions[0].adoptedStableId, null);
});

test('institutional: six S-required conflicts preserve BOTH evidence definitions without repair', () => {
  const conflicts = real.placements.filter(p => p.identityDecision.status === 'conflict');
  assert.equal(conflicts.length, 6);
  for (const placement of conflicts) {
    assert.equal(placement.institutionalCourseId, null);
    assert.equal(placement.methodConstraint.status, 'conflict');
    assert.equal(placement.methodConstraint.requiredMethod, 'schooling');
    assert.equal(placement.legacySnapshot.schoolingOnly, false);
    assert.equal(placement.differences.schoolingConstraint.officialRequiredMethod, 'schooling');
    assert.ok(placement.identityDecision.reason.length);
  }
});

test('institutional: nine public/recognized buckets do not become ICs; null recognition credits preserved', () => {
  const buckets = real.placements.filter(p => p.kind === 'non_course_bucket');
  assert.equal(buckets.length, 9);
  assert.ok(buckets.every(p => p.institutionalCourseId === null));
  assert.ok(buckets.every(p => !real.institutionalCourses.some(c => c.id === p.auditRecord.oldCurriculumCourseId)));
  assert.equal(buckets.find(p => p.officialName.includes('放送大学')).compositionCredits, null);
});

test('institutional: historical continuity unverified, unknown and legacy applicability not inferred', () => {
  assert.ok(real.institutionalCourses.every(c => c.historicalContinuityStatus === 'unverified'));
  assert.ok(real.crosswalk.every(d => d.historicalContinuityStatus === 'unverified'));
  const version = real.curriculumVersions[0];
  assert.equal(version.applicabilityStatus, 'unknown'); assert.equal(version.applicableTo, null);
  assert.ok(version.unverifiedAreas.length); assert.ok(version.amendmentEvidence.length);
  for (const applicability of ['unknown', 'legacy_or_transition', 'current_2026']) {
    const context = { scopeId: real.scopes[0].id, curriculumVersionId: null, applicability, admissionYear: 2026, plannedYear: 2027 };
    assert.equal(placementsForContext(real, context).status, 'unknown_curriculum');
    assert.deepEqual(placementsForContext(real, context).placements, []);
    const result = placementsForContext(real, { ...context, curriculumVersionId: version.id });
    assert.equal(result.status, 'documented_slice_only'); assert.equal(result.applicability, applicability);
    assert.ok(result.placements.length);
  }
  assert.equal(placementsForContext(real, { curriculumVersionId: version.id, scopeId: 'missing', applicability: 'unknown' }).status, 'unknown_scope');
});

test('institutional: all 321/502 audits preserve exact candidates, peers, provenance and classifications', () => {
  assert.equal(real.curriculumAudit.length, 321); assert.equal(real.placements.length, 502); assert.equal(real.institutionalCourses.length, 221);
  assert.deepEqual(counts(real.curriculumAudit), summary.classification.CurriculumCourse);
  assert.deepEqual(counts(real.placements.map(p => p.identityDecision)), summary.classification.Mapping);
  assert.deepEqual(real.curriculumAudit, yi01InstitutionalInput.curriculumRows);
  for (const placement of real.placements) {
    const input = yi01InstitutionalInput.mappingRows.find(r => r.oldMappingId === placement.identityDecision.oldId);
    assert.deepEqual(placement.auditRecord, input);
    assert.deepEqual(placement.candidateAuditIds, input.candidateStableIds);
    assert.equal(placement.institutionalCourseId, input.adoptedStableId);
    for (const id of placement.noteIds) assert.ok(real.notes.some(note => note.evidenceId === id));
    assert.equal(placement.officialRow.quality, 'image_verified');
    resolveInstitutionalLegacyRef(real, { oldEntityKind: 'Mapping', oldId: input.oldMappingId, legacyDigest: input.legacyDigest, sourceDigest: input.sourceDigest });
  }
  for (const row of real.curriculumAudit) assert.equal(resolveInstitutionalLegacyRef(real, { oldEntityKind: 'CurriculumCourse', oldId: row.oldCurriculumCourseId, legacyDigest: row.legacyDigest, sourceDigest: row.sourceDigest }).adoptedStableId, row.adoptedStableId);
  const row = real.crosswalk[0];
  assert.throws(() => resolveInstitutionalLegacyRef(real, { ...row, oldEntityKind: 'Offering' }), /unknown legacy/);
  assert.throws(() => resolveInstitutionalLegacyRef(real, { ...row, legacyDigest: '0'.repeat(64) }), /revision/);
});

test('institutional: master independent of optional archive; 686/209 exact coverage stays compatible', () => {
  assert.equal(archive.offeringEdges.length, 686); assert.equal(archive.legacyCourseRelations.length, 209);
  validateInstitutionalLegacyArchive(real, archive);
  validateInstitutionalLegacyArchive(real, { sourceDigests: archive.sourceDigests, offeringEdges: [], legacyCourseRelations: [] });
  assert.deepEqual(new Set(archive.offeringEdges.map(e => e.offeringId)), new Set(catalog.offerings.map(o => o.id)));
  assert.deepEqual(new Set(archive.legacyCourseRelations.map(e => e.legacyCourseId)), new Set(catalog.courses.map(c => c.id)));
  const broken = structuredClone(archive); broken.offeringEdges[0].mappingIds = ['missing'];
  assert.throws(() => validateInstitutionalLegacyArchive(real, broken), /dangling/);
  assert.deepEqual(loadYi01InstitutionalCatalog(), real);
  const noOffering = real.placements.filter(p => !archive.offeringEdges.some(e => e.mappingIds.includes(p.identityDecision.oldId)));
  assert.ok(noOffering.length > 0);
  assert.ok(noOffering.every(p => p.officialName && p.officialRow.evidenceId));
});

test('institutional: loader deterministic, reorder stable and input immutable, result detached', () => {
  const input = cloneInput(), registry = structuredClone(yi02InstitutionalRegistry);
  const before = structuredClone({ input, registry });
  const first = loadInstitutionalCatalog(input, registry);
  assert.deepEqual(loadInstitutionalCatalog(input, registry), first);
  input.curriculumRows.reverse(); input.mappingRows.reverse(); input.officialRows.reverse();
  const reordered = loadInstitutionalCatalog(input, registry);
  assert.deepEqual(reordered.institutionalCourses, first.institutionalCourses);
  assert.deepEqual(reordered.placements, first.placements);
  input.curriculumRows.reverse(); input.mappingRows.reverse(); input.officialRows.reverse();
  assert.deepEqual({ input, registry }, before);
  first.placements[0].legacySnapshot.curriculumCredits = 999;
  assert.deepEqual({ input, registry }, before);
});

test('institutional: six catalog raw files and complete 2026 adapter outputs unchanged', () => {
  for (const [path, digest] of Object.entries(summary.legacyDigests)) {
    const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, path);
  }
  const raw = read('../src/data/planner_catalog_2026.json');
  const expected = attachCurriculumCatalog(applyManualMappingOverrides(raw));
  const before = structuredClone(catalog);
  const state = initialState();
  const viewBefore = deriveCurriculumCourseView(state, catalog);
  const progressBefore = calculateGraduationProgress([], catalog, null, [], 'undecided');
  loadYi01InstitutionalCatalog();
  assert.deepEqual(catalog, before); assert.deepEqual(catalog, expected);
  assert.deepEqual(deriveCurriculumCourseView(state, catalog), viewBefore);
  assert.deepEqual(calculateGraduationProgress([], catalog, null, [], 'undecided'), progressBefore);
  assert.equal(state.schemaVersion, 22);
  assert.equal(catalog.metadata.graduationCheckComplete, false); assert.equal(catalog.metadata.sourceLinksReverified, false);
});

// Follow-up: exact diagnostics distinguish the targeted invariant from an
// unrelated early rejection (e.g. duplicate issuance request or malformed ID).
const auditIIMapping = input => input.mappingRows.find(row => row.status === 'safe' && row.canonicalName === '監査論Ⅱ');
const auditIIRecords = input => {
  const mapping = auditIIMapping(input);
  return { mapping, official: input.officialRows.find(row => row.evidenceId === mapping.officialEvidenceIds[0]),
    course: input.curriculumRows.find(row => row.oldCurriculumCourseId === mapping.oldCurriculumCourseId) };
};

test('P2-1: all 502 official/mapping names and every CurriculumCourse member match YI-01 normalization', () => {
  assert.equal(yi01InstitutionalInput.mappingRows.length, 502);
  for (const mapping of yi01InstitutionalInput.mappingRows) {
    const row = yi01InstitutionalInput.officialRows.find(r => r.evidenceId === mapping.officialEvidenceIds[0]);
    const course = yi01InstitutionalInput.curriculumRows.find(r => r.oldCurriculumCourseId === mapping.oldCurriculumCourseId);
    assert.equal(normalizeInstitutionalCanonicalName(row.canonicalName), normalizeInstitutionalCanonicalName(mapping.canonicalName));
    assert.equal(normalizeInstitutionalCanonicalName(course.canonicalName), normalizeInstitutionalCanonicalName(mapping.canonicalName));
  }
  assert.equal(loadYi01InstitutionalCatalog().placements.length, 502);
});

for (const [target, error] of [
  ['official', /^Institutional catalog: official\/mapping canonical name mismatch:/],
  ['mapping', /^Institutional catalog: curriculum\/mapping canonical name mismatch:/],
  ['course', /^Institutional catalog: curriculum\/mapping canonical name mismatch:/],
  ['official_and_mapping', /^Institutional catalog: curriculum\/mapping canonical name mismatch:/],
  ['all_three', /^Institutional catalog: fixed canonical name mismatch:/],
]) {
  test(`P2-1: 監査論Ⅱ→Ⅰ in ${target} rejected by the corresponding name gate`, () => {
    const input = cloneInput(), records = auditIIRecords(input);
    assert.ok(records.mapping); assert.equal(records.course.mappingIds.length, 1);
    for (const key of target === 'official_and_mapping' ? ['official', 'mapping']
      : target === 'all_three' ? ['official', 'mapping', 'course'] : [target]) records[key].canonicalName = '監査論Ⅰ';
    assert.throws(() => loadInstitutionalCatalog(input, yi02InstitutionalRegistry), { message: error });
  });
}

test('P2-1: comparison protects Ⅰ/Ⅱ/Ⅲ from each other and ASCII I, and retains A/B/(1)/(2)', () => {
  const norm = normalizeInstitutionalCanonicalName;
  for (const [left, right] of [['科目Ⅰ', '科目Ⅱ'], ['科目Ⅱ', '科目Ⅲ'], ['科目Ⅰ', '科目I'], ['科目A', '科目B'], ['科目(1)', '科目(2)']]) {
    assert.notEqual(norm(left), norm(right));
    const f = institutionalFixture([left, right]);
    f.input.mappingRows[0].canonicalName = right;
    assert.throws(() => loadInstitutionalCatalog(f.input, f.registry, f.baseline), { message: /^Institutional catalog: curriculum\/mapping canonical name mismatch:/ });
  }
  assert.equal(norm(' \t科 目Ａ（１）　'), '科目A(1)');
  assert.equal(norm('科目Ⅰ'), '科目\uE000');
  assert.equal(norm('科目\u0085\u001cA'), '科目A');
  assert.equal(norm('科目\uFEFFA'), '科目\uFEFFA'); // Matches Python \s, not JavaScript \s.
});

test('P2-1: whitespace/width differences pass across every safe multi-scope member without rewriting labels', () => {
  const input = cloneInput();
  const course = input.curriculumRows.find(r => r.status === 'safe' && r.scopeIds.length > 1);
  assert.ok(course);
  for (const [index, id] of course.mappingIds.entries()) {
    const mapping = input.mappingRows.find(r => r.oldMappingId === id);
    const row = input.officialRows.find(r => r.evidenceId === mapping.officialEvidenceIds[0]);
    row.canonicalName = `${'　'.repeat(index + 1)}${row.canonicalName} \t`;
  }
  const result = loadInstitutionalCatalog(input, yi02InstitutionalRegistry);
  assert.equal(result.institutionalCourses.length, 221);
  for (const placement of result.placements.filter(p => p.institutionalCourseId === course.adoptedStableId)) {
    assert.equal(placement.officialRow.canonicalName, input.officialRows.find(r => r.evidenceId === placement.officialRow.evidenceId).canonicalName);
  }
  const f = institutionalFixture(['科目A(1)']);
  f.input.officialRows[0].canonicalName = '　科 目Ａ（１）　';
  assert.equal(loadInstitutionalCatalog(f.input, f.registry, f.baseline).placements[0].officialRow.canonicalName, '　科 目Ａ（１）　');
});

test('P2-1: changing only one multi-scope Mapping member is rejected by curriculum/member name validation', () => {
  const input = cloneInput();
  const course = input.curriculumRows.find(r => r.status === 'safe' && r.scopeIds.length > 1);
  input.mappingRows.find(r => r.oldMappingId === course.mappingIds.at(-1)).canonicalName = '異なる制度科目';
  assert.throws(() => loadInstitutionalCatalog(input, yi02InstitutionalRegistry), { message: /^Institutional catalog: curriculum\/mapping canonical name mismatch:/ });
});

test('P2-1: officialLabel remains a distinct display field rather than an exact canonicalName constraint', () => {
  assert.ok(yi01InstitutionalInput.officialRows.some(r => r.officialLabel !== r.canonicalName));
  const input = cloneInput(); auditIIRecords(input).official.officialLabel = '監査論Ⅱ（原表の表示注記）';
  const model = loadInstitutionalCatalog(input, yi02InstitutionalRegistry);
  assert.ok(model.placements.some(p => p.officialName === '監査論Ⅱ（原表の表示注記）'));
});

test('P2-2: fixed baseline provenance and registry bytes remain those of audited HEAD; all 1/221/502 bindings pass', () => {
  const baselineBytes = readFileSync(new URL('../src/data/institutional_issuance_baseline.json', import.meta.url));
  const baseline = JSON.parse(baselineBytes);
  assert.equal(baseline.auditedCommit, '81a2dc0a835a02134b3c69138e8c90c4ada7d7ea');
  assert.equal(createHash('sha256').update(baselineBytes).digest('hex'), '852b21d115dc1982a9f1a3dc549127fc6ee006e4d1bc1b7bf3307abd7c7f0e2a');
  const registryBytes = readFileSync(new URL('../src/data/institutional_registry.json', import.meta.url));
  assert.equal(createHash('sha256').update(registryBytes).digest('hex'), '0dbf6cf080fd5a148fbb8f747ce065382c079786616d500d52133f63f1406580');
  assert.equal(baseline.registrySha256, '0dbf6cf080fd5a148fbb8f747ce065382c079786616d500d52133f63f1406580');
  assert.equal(createHash('sha256').update(readFileSync(new URL('../docs/planner-yi-01/curriculum-crosswalk.json', import.meta.url))).digest('hex'), baseline.curriculumCrosswalkSha256);
  assert.deepEqual([baseline.curriculumVersions.length, baseline.institutionalCourses.length, baseline.placements.length], [1, 221, 502]);
  assert.ok(Object.isFrozen(yi02IssuanceBaseline.placements[0]));
  assert.throws(() => { yi02IssuanceBaseline.placements[0].id = 'rewrite'; }, TypeError);
  const model = loadYi01InstitutionalCatalog();
  assert.deepEqual([model.curriculumVersions.length, model.institutionalCourses.length, model.placements.length], [1, 221, 502]);
});

function swappedField(records, field) {
  [records[0][field], records[1][field]] = [records[1][field], records[0][field]];
}
for (const [target, error] of [
  ['role', /^Institutional catalog: placement role mismatch$/],
  ['cp_request', /^Institutional catalog: placement issuance request mismatch$/],
  ['ic_request', /^Institutional catalog: course issuance request mismatch$/],
  ['cv_request', /^Institutional catalog: fixed issuance mismatch: CurriculumVersion:/],
  ['cp_ids', /^Institutional catalog: fixed issuance mismatch: CurriculumPlacement:/],
  ['cp_origins_with_requests', /^Institutional catalog: fixed issuance mismatch: CurriculumPlacement:/],
  ['cp_evidence', /^Institutional catalog: placement evidence mismatch$/],
  ['cv_id_with_all_refs', /^Institutional catalog: fixed issuance mismatch: CurriculumVersion:/],
]) {
  test(`P2-2: valid unique ${target} alteration rejected by the intended issuance/role gate`, () => {
    const registry = structuredClone(yi02InstitutionalRegistry);
    if (target === 'role') registry.placements[0].placementRoleKey = registry.placements.find(p => p.scopeId !== registry.placements[0].scopeId).placementRoleKey;
    if (target === 'cp_request') swappedField(registry.placements, 'issuanceRequestId');
    if (target === 'ic_request') swappedField(registry.institutionalCourses, 'issuanceRequestId');
    if (target === 'cv_request') registry.curriculumVersions[0].issuanceRequestId = 'yi-02:another-documented-curriculum';
    if (target === 'cp_ids') swappedField(registry.placements, 'id');
    if (target === 'cp_origins_with_requests') {
      for (const field of ['issuanceRequestId', 'oldMappingId', 'evidenceId', 'placementRoleKey', 'scopeId', 'curriculumVersionId']) swappedField(registry.placements, field);
    }
    if (target === 'cp_evidence') swappedField(registry.placements, 'evidenceId');
    if (target === 'cv_id_with_all_refs') {
      registry.curriculumVersions[0].id = 'hosei:cv:00000000-0000-4000-8000-000000009999';
      registry.placements.forEach(p => { p.curriculumVersionId = registry.curriculumVersions[0].id; });
    }
    const issued = [...registry.curriculumVersions, ...registry.institutionalCourses, ...registry.placements];
    // No duplicate-ID/request check can account for this rejection.
    assert.equal(new Set(issued.map(r => r.id)).size, issued.length);
    assert.equal(new Set(issued.map(r => r.issuanceRequestId)).size, issued.length);
    assert.throws(() => loadInstitutionalCatalog(cloneInput(), registry), { message: error });
  });
}

test('P2-2: synthetic issuance expectation is independent; 4/2 roles pass, ID swap fails its own baseline', () => {
  const f = institutionalFixture(['合成制度科目']);
  const expected = structuredClone(f.baseline);
  const model = loadInstitutionalCatalog(f.input, f.registry, f.baseline);
  assert.deepEqual(model.placements.map(p => p.compositionCredits), [4, 2]);
  assert.equal(new Set(model.placements.map(p => p.scopeId)).size, 1);
  assert.equal(new Set(model.placements.map(p => p.placementRoleKey)).size, 2);
  swappedField(f.registry.placements, 'id');
  assert.deepEqual(f.baseline, expected);
  assert.throws(() => loadInstitutionalCatalog(f.input, f.registry, f.baseline), { message: /^Institutional catalog: fixed issuance mismatch: CurriculumPlacement:/ });
});

test('P2-2: issuance baseline comparisons are independent of registry/expected-record array order', () => {
  const registry = structuredClone(yi02InstitutionalRegistry);
  registry.institutionalCourses.reverse(); registry.placements.reverse();
  const baseline = structuredClone(yi02IssuanceBaseline);
  baseline.institutionalCourses.reverse(); baseline.placements.reverse();
  const result = loadInstitutionalCatalog(cloneInput(), registry, baseline);
  assert.deepEqual(new Set(result.placements.map(p => p.id)), new Set(real.placements.map(p => p.id)));
});
