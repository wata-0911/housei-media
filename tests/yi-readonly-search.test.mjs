import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { loadCurrentCurriculumSearchAdapter, CURRENT_CURRICULUM_SEARCH_TARGET } from '../src/planner/institutional/currentSearch.ts';
import { createInstitutionalSearchAdapter } from '../src/planner/institutional/search.ts';
import { loadYi01InstitutionalCatalog } from '../src/planner/institutional/yi01.ts';
import { readonlySelectionHold } from '../src/planner/institutional/readonlySelection.ts';
import { filterPlacementNames } from '../src/components/planner/institutional/searchView.ts';
import { fixture as f } from './yi-readonly-search.fixtures.mjs';
const adapter = loadCurrentCurriculumSearchAdapter();
const all = adapter.search({ scope: { kind: 'all' } });

test('pinned real source: 502 placements, safe identity only, unchanged source digest', () => {
  assert.equal(all.status, 'documented_slice_only');
  assert.equal(all.rows.length, f.placements);
  assert.equal(all.rows.filter(r => r.institutionalCourse).length, f.safePlacements);
  assert.equal(all.rows.filter(r => r.placement.kind === 'non_course_bucket').length, f.nonCourseBuckets);
  for (const r of all.rows) {
    assert.equal(r.sourceRevision.sha256, f.sourceDigest);
    assert.equal(r.curriculumVersion.applicabilityStatus, 'unknown');
    assert.equal(r.curriculumVersion.applicableTo, null);
    assert.equal(readonlySelectionHold(r) === null, Boolean(r.institutionalCourse));
  }
});

test('plannedYear 2027/2028/null never enters search; detached results preserve the evidence', () => {
  for (const plannedYear of [2027, 2028, null]) {
    const localDraft = { plannedYear, method: 'unknown' };
    assert.ok(Object.hasOwn(localDraft, 'plannedYear'));
    assert.deepEqual(adapter.search({ scope: { kind: 'all' } }), all);
  }
  const row = all.rows.find(r => r.placement.id === f.safePlacement);
  assert.equal(readonlySelectionHold(row), null);
  const changed = structuredClone(row); changed.placement.institutionalCourseId = 'wrong-id';
  assert.match(readonlySelectionHold(changed), /同一性/);
  assert.equal(adapter.search({ scope: { kind: 'all' } }).rows.find(r => r.placement.id === f.safePlacement).placement.officialName, f.safeTitle);
});

test('name partial/AND/exact/normalization/blank/zero keep placements separate', () => {
  const exact = filterPlacementNames(all.rows, f.holdTitle, 'exact');
  assert.equal(exact.length, 2);
  assert.deepEqual(new Set(exact.map(r => r.scope.officialScopeLabel)), new Set(f.holdScopes));
  assert.equal(new Set(exact.map(r => r.placement.id)).size, 2);
  assert.ok(exact.every(r => readonlySelectionHold(r)?.includes('同一性')));
  assert.ok(filterPlacementNames(all.rows, '簿記 Ⅰ', 'partial').length >= 2);
  assert.equal(filterPlacementNames(all.rows, ' 簿記Ⅰ ', 'exact').length, 2);
  assert.deepEqual(filterPlacementNames(all.rows, '　 ', 'exact'), all.rows);
  assert.equal(filterPlacementNames(all.rows, f.absentTitle, 'partial').length, 0);
});

test('all scopes, common inclusion/exclusion and same-title different credit compositions survive', () => {
  const scopes = new Set(all.rows.map(r => r.scope.id));
  for (const scopeId of scopes) {
    for (const includeCommon of [true, false]) {
      const rows = adapter.search({ scope: { kind: 'scope', scopeId, includeCommon } }).rows;
      assert.deepEqual(rows.map(r => r.placement.id), all.rows.filter(r => r.scope.id === scopeId || (includeCommon && r.scope.id === f.commonScope)).map(r => r.placement.id));
    }
  }
  const thesis = filterPlacementNames(all.rows, f.differentCreditsTitle, 'exact');
  assert.equal(thesis.length, 8);
  assert.deepEqual([...new Set(thesis.map(r => r.placement.compositionCredits))].sort((a,b) => a-b), f.differentCredits);
});

test('code evidence stays exact; notes, non-course buckets and conflicts stay held', () => {
  const rows = adapter.search({ scope: { kind: 'all' }, officialCode: { value: f.exactCode, usage: 'undergraduate' } }).rows;
  assert.ok(rows.some(r => r.placement.officialName === f.exactCodeTitle));
  assert.equal(adapter.search({ scope: { kind: 'all' }, officialCode: { value: '4452', usage: 'undergraduate' } }).rows.length, 0);
  for (const r of all.rows.filter(r => r.placement.kind === 'non_course_bucket')) assert.match(readonlySelectionHold(r), /非科目枠/);
  const conflicts = all.rows.filter(r => r.placement.identityDecision.status === 'conflict');
  assert.equal(conflicts.length, 6);
  assert.ok(conflicts.every(r => readonlySelectionHold(r)));
  assert.ok(all.rows.some(r => r.notes.some(n => n.evidenceId === 'p57-m' && n.text.includes('2028'))));
});

test('bad revision/scope fails closed, no fallback to annual source', () => {
  const wrong = createInstitutionalSearchAdapter(loadYi01InstitutionalCatalog(), { ...CURRENT_CURRICULUM_SEARCH_TARGET, sourceDigest: 'wrong' }).search({ scope: { kind: 'all' } });
  assert.equal(wrong.status, 'revision_mismatch'); assert.deepEqual(wrong.rows, []);
  const missing = adapter.search({ scope: { kind: 'scope', scopeId: 'missing' } });
  assert.equal(missing.status, 'unknown_scope'); assert.deepEqual(missing.rows, []);
});

test('real sidecar runtime import graph has no Offering/storage/session/ID or production-route dependency', async () => {
  const built = await build({ entryPoints: ['src/components/planner/institutional/YearIndependentSearchSidecar.tsx'], bundle: true, write: false, outdir: '/tmp/yi-readonly-search-unused', packages: 'external', metafile: true, format: 'esm' });
  const paths = Object.keys(built.metafile.inputs);
  assert.ok(paths.some(p => p.endsWith('/currentSearch.ts')));
  assert.ok(paths.some(p => p.endsWith('/loader.ts')));
  for (const p of paths) assert.doesNotMatch(p, /planner_catalog_|legacyArchive|\/attempts\/|\/backup\/|\/catalog\/|PlannerPage|AttemptPlanForm|\/storage|plannerCatalog/);
  const js = built.outputFiles.find(x => x.path.endsWith('.js')).text;
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|randomUUID|navigator\.locks|\.confirm\(/);
  const production = await build({ entryPoints: ['src/main.tsx'], bundle: true, write: false, outdir: '/tmp/yi-readonly-search-production-unused', packages: 'external', metafile: true, format: 'esm' });
  assert.ok(Object.keys(production.metafile.inputs).every(p => !p.includes('YearIndependentSearchSidecar')));
});
