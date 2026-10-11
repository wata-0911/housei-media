import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadInstitutionalCatalog } from '../src/planner/institutional/loader.ts';
import { loadYi01InstitutionalCatalog, yi01InstitutionalInput, yi02InstitutionalRegistry } from '../src/planner/institutional/yi01.ts';
import { searchInstitutionalPlacements, placementsForContext, resolveInstitutionalLegacyRef } from '../src/planner/institutional/query.ts';
import { validateInstitutionalLegacyArchive, resolveInstitutionalArchiveRef } from '../src/planner/institutional/legacyArchive.ts';
import { institutionalFixture } from './fixtures/institutional-fixture.mjs';
import { catalog } from '../src/planner/catalog.ts';
import { applyManualMappingOverrides } from '../src/planner/manualMappingOverrides.ts';
import { attachCurriculumCatalog } from '../src/planner/curriculumCatalog.ts';
import { deriveCurriculumCourseView } from '../src/planner/curriculumCourseView.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { LEGACY_BACKUP_CATALOGS } from '../src/planner/plannerBackupCompatibility.ts';
import { initialState } from '../src/planner/storage.ts';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const archive = read('../docs/planner-yi-01/legacy-relations.json');
const summary = read('../docs/planner-yi-01/summary.json');
const cloneInput = () => structuredClone(yi01InstitutionalInput);
const real = loadYi01InstitutionalCatalog();
const counts = rows => Object.fromEntries(['safe', 'ambiguous', 'conflict', 'unmatched'].map(status => [status, rows.filter(r => r.status === status).length]));

test('institutional: synthetic Offering 0 loads and exposes official evidence/credits without name fallback', () => {
  const { input, registry } = institutionalFixture();
  assert.equal(input.offerings.length, 0);
  const model = loadInstitutionalCatalog(input, registry);
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
  assert.throws(() => loadInstitutionalCatalog(f.input, f.registry), /duplicate placement role/);
});

test('institutional: same name/credits never merge identities and same scope permits 4/2 roles', () => {
  const f = institutionalFixture(); const model = loadInstitutionalCatalog(f.input, f.registry);
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
  const f = institutionalFixture(); const model = loadInstitutionalCatalog(f.input, f.registry);
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
  const model = loadInstitutionalCatalog(f.input, f.registry);
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
