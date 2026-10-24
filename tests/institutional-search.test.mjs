import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { createInstitutionalSearchAdapter } from '../src/planner/institutional/search.ts';
import { CURRENT_CURRICULUM_SEARCH_TARGET, loadCurrentCurriculumSearchAdapter } from '../src/planner/institutional/currentSearch.ts';
import { loadYi01InstitutionalCatalog } from '../src/planner/institutional/yi01.ts';
import { loadInstitutionalCatalog } from '../src/planner/institutional/loader.ts';
import { institutionalFixture } from './fixtures/institutional-fixture.mjs';

const master = loadYi01InstitutionalCatalog();
const adapter = loadCurrentCurriculumSearchAdapter();
const all = { kind: 'all' };
const search = (request = {}) => adapter.search({ scope: all, ...request });
const ids = result => result.rows.map(row => row.placement.id);
const scope = label => master.scopes.find(s => s.officialScopeLabel === label).id;

// Synthetic post-loader variants below exercise read-model branches only. They
// are not alternate official registry data, nor tests of the issuance validator.
const synthetic = () => {
  const f = institutionalFixture();
  assert.deepEqual(f.input.offerings, []);
  return loadInstitutionalCatalog(f.input, f.registry, f.baseline);
};
const fromSynthetic = model => createInstitutionalSearchAdapter(model, CURRENT_CURRICULUM_SEARCH_TARGET);

test('search: Offering 0 loader fixture is searchable without annual input', () => {
  const model = synthetic();
  assert.equal(fromSynthetic(model).search({ scope: all }).rows.length, model.placements.length);
  assert.equal(fromSynthetic(model).search({ scope: all, text: '同名科目' }).rows.length, 3);
});

test('search: explicit audited target returns all 502 placements including all unresolved rows', () => {
  const result = search();
  assert.equal(result.status, 'documented_slice_only');
  assert.deepEqual(result.target, CURRENT_CURRICULUM_SEARCH_TARGET);
  assert.deepEqual(new Set(ids(result)), new Set(master.placements.map(p => p.id)));
  assert.deepEqual(Object.fromEntries(['safe', 'ambiguous', 'conflict', 'unmatched'].map(status =>
    [status, result.rows.filter(r => r.placement.identityDecision.status === status).length])),
  { safe: 273, ambiguous: 214, conflict: 6, unmatched: 9 });
});

test('search: formal names, whitespace/width variations and numeral/letter variants', () => {
  for (const [query, name] of [['簿記Ⅰ', '簿記Ⅰ'], [' 簿 記 Ⅳ ', '簿記Ⅳ']]) {
    const found = search({ text: query }).rows;
    assert.ok(found.length);
    assert.ok(found.every(r => r.placement.officialRow.canonicalName === name));
  }
  const model = synthetic();
  const a = fromSynthetic(model);
  for (const [query, expected] of [['科目Ⅰ', '科目Ⅰ'], ['科目Ⅱ', '科目Ⅱ'], ['科目Ａ', '科目A'],
    ['科目B', '科目B'], ['科目（１）', '科目(1)'], ['科目(2)', '科目(2)']]) {
    const found = a.search({ scope: all, text: query }).rows;
    assert.equal(found.length, 1);
    assert.equal(found[0].placement.officialRow.canonicalName, expected);
  }
  assert.equal(a.search({ scope: all, text: '科目I' }).rows.length, 0);
});

test('search: each department/course scope includes common once, with explicit exclusion', () => {
  for (const s of master.scopes) {
    const exact = search({ scope: { kind: 'scope', scopeId: s.id, includeCommon: false } });
    assert.deepEqual(new Set(ids(exact)), new Set(master.placements.filter(p => p.scopeId === s.id).map(p => p.id)));
    const included = search({ scope: { kind: 'scope', scopeId: s.id } });
    assert.deepEqual(new Set(ids(included)), new Set(master.placements.filter(p =>
      p.scopeId === s.id || p.scopeId === scope('common')).map(p => p.id)));
    assert.equal(ids(included).length, new Set(ids(included)).size);
  }
});

test('search: unknown scope/CV and mismatched revision fail closed without default fallback', () => {
  assert.equal(search({ scope: { kind: 'scope', scopeId: 'missing' } }).status, 'unknown_scope');
  for (const [change, status] of [
    [{ curriculumVersionId: 'missing' }, 'unknown_curriculum'],
    [{ sourceRevisionId: 'missing' }, 'revision_mismatch'],
    [{ sourceDigest: 'missing' }, 'revision_mismatch'],
  ]) {
    const result = createInstitutionalSearchAdapter(master, { ...CURRENT_CURRICULUM_SEARCH_TARGET, ...change }).search({ scope: all });
    assert.equal(result.status, status); assert.deepEqual(result.rows, []);
  }
});

test('search: category, nullable field, requirement, eligible year combine with scope and text', () => {
  const p = master.placements.find(p => p.field !== null);
  const request = { scope: { kind: 'scope', scopeId: p.scopeId }, text: p.officialRow.canonicalName,
    category: p.category, field: p.field, requirementType: p.requirementType, eligibleYear: p.officialRow.eligibleYears[0] };
  assert.ok(ids(search(request)).includes(p.id));
  for (const change of [{ category: 'missing' }, { field: 'missing' }, { requirementType: 'missing' }, { eligibleYear: 99 }]) {
    assert.equal(search({ ...request, ...change }).rows.length, 0);
  }
  assert.ok(search({ field: null }).rows.length);
  assert.ok(search({ field: null }).rows.every(r => r.placement.field === null));
});

test('search: synthetic unknown eligible years remain unknown and do not match a year filter', () => {
  const model = synthetic();
  const p = model.placements[0];
  p.officialRow.eligibleYears = null;
  const a = fromSynthetic(model);
  const row = a.search({ scope: all }).rows.find(r => r.placement.id === p.id);
  assert.equal(row.placement.officialRow.eligibleYears, null);
  assert.ok(!ids(a.search({ scope: all, eligibleYear: 1 })).includes(p.id));
});

test('search: safe IC retained; ambiguous candidates never promoted, including single candidate', () => {
  for (const row of search().rows) {
    const original = master.placements.find(p => p.id === row.placement.id);
    assert.deepEqual(row.placement, original);
    if (original.identityDecision.status === 'safe') {
      assert.equal(row.institutionalCourse.id, original.institutionalCourseId);
    } else {
      assert.equal(row.institutionalCourse, null);
      assert.equal(row.placement.institutionalCourseId, null);
      assert.deepEqual(row.placement.candidateAuditIds, original.candidateAuditIds);
    }
  }
  assert.ok(search().rows.some(r => r.placement.identityDecision.status === 'ambiguous' && r.placement.candidateAuditIds.length === 1));
});

test('search: conflict preserves both method values, status, rule and evidence', () => {
  const conflicts = search().rows.filter(r => r.placement.identityDecision.status === 'conflict');
  assert.equal(conflicts.length, 6);
  for (const { placement: p } of conflicts) {
    assert.equal(p.methodConstraint.status, 'conflict');
    assert.equal(p.methodConstraint.requiredMethod, 'schooling');
    assert.equal(p.legacySnapshot.schoolingOnly, false);
    assert.ok(Object.keys(p.differences).length);
    assert.ok(p.identityDecision.evidenceIds.length);
    assert.ok(p.ruleRef.id);
  }
});

test('search: non-course buckets stay non-course and nullable composition credits are not zero', () => {
  const buckets = search().rows.filter(r => r.placement.kind === 'non_course_bucket');
  assert.equal(buckets.length, 9);
  assert.ok(buckets.every(r => r.institutionalCourse === null && r.placement.identityDecision.status === 'unmatched'));
  assert.ok(buckets.some(r => r.placement.compositionCredits === null));
  const model = synthetic();
  model.placements[0].compositionCredits = null;
  model.placements[1].compositionCredits = 0;
  const result = fromSynthetic(model).search({ scope: all });
  assert.equal(result.rows.find(r => r.placement.id === model.placements[0].id).placement.compositionCredits, null);
  assert.equal(result.rows.find(r => r.placement.id === model.placements[1].id).placement.compositionCredits, 0);
});

test('search: audited undergraduate codes are exact, scope-bound, with original evidence and unknown identity', () => {
  const p = master.placements.find(p => p.identityDecision.status === 'ambiguous' && p.auditRecord.mainCodes.length);
  const code = p.auditRecord.mainCodes[0];
  const result = search({ officialCode: { value: code, usage: 'undergraduate' } });
  assert.ok(ids(result).includes(p.id));
  const row = result.rows.find(r => r.placement.id === p.id);
  assert.equal(row.institutionalCourse, null);
  assert.ok(row.codeEvidence.undergraduate.some(c => c.codes.includes(code)));
  assert.equal(search({ officialCode: { value: code.slice(0, -1), usage: 'undergraduate' } }).rows.length, 0);
  const constrained = search({ officialCode: { value: code, usage: 'undergraduate' },
    scope: { kind: 'scope', scopeId: p.scopeId, includeCommon: false } });
  assert.ok(constrained.rows.every(r => r.placement.scopeId === p.scopeId));
});

test('search: teacher-only and name-only synthetic codes do not become undergraduate code or identity', () => {
  const model = synthetic();
  const p = model.placements[0];
  const base = master.codes[0];
  model.codes = [
    { ...base, evidenceId: 'synthetic-teacher', scope: 'teacher_only', codes: ['T-ONLY'] },
    { ...base, evidenceId: 'synthetic-name-only', codes: ['N-ONLY'] },
  ];
  p.auditRecord.teacherCodeEvidenceIds = ['synthetic-teacher'];
  p.auditRecord.sameNameCodeCandidateEvidenceIds = ['synthetic-name-only'];
  p.auditRecord.mainCodeEvidenceIds = [];
  p.auditRecord.mainCodes = [];
  const a = fromSynthetic(model);
  for (const code of ['T-ONLY', 'N-ONLY']) {
    assert.equal(a.search({ scope: all, officialCode: { value: code, usage: 'undergraduate' } }).rows.length, 0);
  }
  const found = a.search({ scope: all, officialCode: { value: 'T-ONLY', usage: 'teacher' } });
  assert.deepEqual(ids(found), [p.id]);
  assert.deepEqual(found.rows[0].placement.identityDecision, p.identityDecision);
  assert.equal(found.rows[0].codeEvidence.nameOnlyCandidates[0].evidenceId, 'synthetic-name-only');
  assert.equal(a.search({ scope: all, officialCode: { value: 'N-ONLY', usage: 'teacher' } }).rows.length, 0);
});

/** Synthetic counterexamples rebuilt from the audit report. All pass the
 * existing YI-02 loader; no official registry or issuance policy is changed. */
function linkedCodeFixture(evidenceScope, usage = 'undergraduate', placementScope = 'fixture_scope') {
  const f = institutionalFixture();
  f.registry.scopes[0].officialScopeLabel = placementScope;
  for (const row of f.input.officialRows) row.scope = placementScope;
  const mapping = f.input.mappingRows[0];
  const code = { ...structuredClone(master.codes[0]), evidenceId: 'synthetic-scope-code',
    scope: evidenceScope, codes: ['SYNTHETIC-CODE'], codeText: 'SYNTHETIC-CODE',
    conditions: '合成条件：本人の履修資格は未確認' };
  f.input.codes = [code];
  mapping.mainCodeEvidenceIds = usage === 'undergraduate' ? [code.evidenceId] : [];
  mapping.mainCodes = usage === 'undergraduate' ? [...code.codes] : [];
  mapping.teacherCodeEvidenceIds = usage === 'teacher' ? [code.evidenceId] : [];
  mapping.sameNameCodeCandidateEvidenceIds = [code.evidenceId];
  const model = loadInstitutionalCatalog(f.input, f.registry, f.baseline);
  const placement = model.placements.find(p => p.auditRecord.oldMappingId === mapping.oldMappingId);
  return { model, placement, code, adapter: fromSynthetic(model) };
}

for (const [label, evidenceScope, usage, placementScope] of [
  ['unrelated undergraduate scope', '法律', 'undergraduate', 'fixture_scope'],
  ['unknown undergraduate evidence scope', 'unknown_scope', 'undergraduate', 'fixture_scope'],
  ['undergraduate evidence in teacher link', '法律', 'teacher', 'fixture_scope'],
  ['unknown scope even when labels coincide', 'future_scope', 'undergraduate', 'future_scope'],
  ['common evidence is not an arbitrary department code', 'common', 'undergraduate', '法律'],
  ['unknown evidence in teacher link', 'unknown_scope', 'teacher', '法律'],
]) {
  test(`P2: loader-backed synthetic ${label} must not match; raw evidence remains`, () => {
    const f = linkedCodeFixture(evidenceScope, usage, placementScope);
    const request = { scope: all, officialCode: { value: f.code.codes[0], usage } };
    assert.deepEqual(ids(f.adapter.search(request)), []);
    const row = f.adapter.search({ scope: all }).rows.find(r => r.placement.id === f.placement.id);
    assert.deepEqual(row.placement, f.placement);
    assert.deepEqual(row.codeEvidence[usage], [f.code]);
    assert.deepEqual(row.codeEvidence.nameOnlyCandidates, [f.code]);
    assert.equal(row.codeEvidence[usage][0].conditions, f.code.conditions);
    assert.deepEqual(f.model.codes, [f.code]);
  });
}

test('P2: loader-backed same known scope, common, Japanese parent and teacher evidence match', () => {
  for (const [placementScope, evidenceScope, usage] of [
    ['法律', '法律', 'undergraduate'], ['common', 'common', 'undergraduate'],
    ['日文文学', '日文', 'undergraduate'], ['日文言語', '日文', 'undergraduate'],
    ['日文芸能', '日文', 'undergraduate'], ['法律', 'teacher_only', 'teacher'],
  ]) {
    const f = linkedCodeFixture(evidenceScope, usage, placementScope);
    const result = f.adapter.search({ scope: all, officialCode: { value: f.code.codes[0], usage } });
    assert.deepEqual(ids(result), [f.placement.id], `${placementScope} / ${evidenceScope} / ${usage}`);
    assert.deepEqual(result.rows[0].codeEvidence[usage], [f.code]);
    assert.deepEqual(result.rows[0].placement.identityDecision, f.placement.identityDecision);
    assert.equal(result.rows[0].curriculumVersion.applicabilityStatus, 'unknown');
  }
});

test('P2: loader-backed name-only evidence never becomes an official code link', () => {
  const f = linkedCodeFixture('法律', 'candidate', '法律');
  for (const usage of ['undergraduate', 'teacher']) {
    assert.deepEqual(ids(f.adapter.search({ scope: all,
      officialCode: { value: f.code.codes[0], usage } })), []);
  }
  const row = f.adapter.search({ scope: all }).rows.find(r => r.placement.id === f.placement.id);
  assert.deepEqual(row.codeEvidence.nameOnlyCandidates, [f.code]);
  assert.deepEqual(row.codeEvidence.undergraduate, []);
  assert.deepEqual(row.codeEvidence.teacher, []);
});

test('P2: explicit scope pairs exclude prefix guesses, unrelated departments and sibling course evidence', () => {
  for (const [placementScope, evidenceScope] of [
    ['法律', '経済'], ['日文言語', '日文文学'], ['日文新コース', '日文'],
    ['日文文学', '日文unknown'], ['common', '法律'],
  ]) {
    const f = linkedCodeFixture(evidenceScope, 'undergraduate', placementScope);
    assert.deepEqual(ids(f.adapter.search({ scope: all,
      officialCode: { value: f.code.codes[0], usage: 'undergraduate' } })), []);
  }
});

test('P2: all official undergraduate/teacher code searches retain pre-fix placement matches and conditions', () => {
  // Pin the pre-fix relation from the official audit, independently of the new
  // scope predicate. Exhaustively check every linked official code and placement.
  const expected = new Map();
  const pairs = new Map();
  const evidenceById = new Map(master.codes.map(c => [c.evidenceId, c]));
  for (const p of master.placements) {
    const label = master.scopes.find(s => s.id === p.scopeId).officialScopeLabel;
    for (const [usage, field] of [['undergraduate', 'mainCodeEvidenceIds'], ['teacher', 'teacherCodeEvidenceIds']]) {
      for (const id of p.auditRecord[field]) {
        const evidence = evidenceById.get(id);
        pairs.set(`${usage}:${label}:${evidence.scope}`, true);
        for (const code of evidence.codes) {
          if (usage === 'undergraduate' && !p.auditRecord.mainCodes.includes(code)) continue;
          const key = `${usage}:${code}`;
          if (!expected.has(key)) expected.set(key, new Set());
          expected.get(key).add(p.id);
        }
      }
    }
  }
  for (const label of ['common', '法律', '史学', '地理', '経済', '商業']) {
    assert.ok(pairs.has(`undergraduate:${label}:${label}`));
  }
  for (const label of ['日文文学', '日文言語', '日文芸能']) {
    assert.ok(pairs.has(`undergraduate:${label}:日文`));
  }
  assert.ok(expected.size > 100);
  for (const [key, expectedIds] of expected) {
    const [usage, value] = key.split(':');
    const result = search({ officialCode: { value, usage } });
    assert.deepEqual(new Set(ids(result)), expectedIds, key);
  }
  const conditional = search().rows.flatMap(r => [...r.codeEvidence.undergraduate, ...r.codeEvidence.teacher])
    .filter(c => c.conditions !== null);
  assert.ok(conditional.length);
  for (const c of conditional) assert.deepEqual(c, evidenceById.get(c.evidenceId));
});

test('search: applicability, source revision, notes, locators and multiple roles remain intact', () => {
  const result = search();
  assert.ok(result.rows.every(r => r.curriculumVersion.applicabilityStatus === 'unknown' && r.curriculumVersion.applicableTo === null));
  assert.ok(result.rows.every(r => r.sourceRevision.sha256 === CURRENT_CURRICULUM_SEARCH_TARGET.sourceDigest));
  const repeated = master.placements.find(p => p.institutionalCourseId !== null
    && master.placements.filter(other => other.institutionalCourseId === p.institutionalCourseId).length > 1);
  const originals = master.placements.filter(p => p.institutionalCourseId === repeated.institutionalCourseId);
  const rows = result.rows.filter(r => r.placement.institutionalCourseId === repeated.institutionalCourseId);
  assert.equal(rows.length, originals.length);
  for (const row of result.rows) {
    assert.deepEqual(row.notes, master.notes.filter(n => row.placement.noteIds.includes(n.evidenceId)));
    assert.deepEqual(row.scope, master.scopes.find(s => s.id === row.placement.scopeId));
    assert.ok(row.placement.officialRow.bbox.length);
    assert.ok(row.placement.placementRoleKey);
  }
});

test('search: deterministic order independent of input order; results and target are detached', () => {
  assert.deepEqual(search(), search());
  const model = structuredClone(master);
  model.placements.reverse();
  assert.deepEqual(ids(fromSynthetic(model).search({ scope: all })), ids(search()));
  const target = { ...CURRENT_CURRICULUM_SEARCH_TARGET };
  const a = createInstitutionalSearchAdapter(model, target);
  target.sourceDigest = 'changed'; model.placements.length = 0;
  const result = a.search({ scope: all });
  result.rows[0].placement.officialName = 'changed'; result.target.sourceDigest = 'changed';
  assert.deepEqual(a.search({ scope: all }), search());
});

// Follow runtime imports after TS erasure: type-only JSON contracts do not turn
// annual catalogs into dependencies. Production graph is checked in reverse too.
function runtimeGraph(entry) {
  const seen = new Set();
  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    if (!/\.[cm]?[jt]sx?$/.test(path)) return;
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    for (const { fileName } of ts.preProcessFile(compiled).importedFiles) {
      if (!fileName.startsWith('.')) continue;
      const base = resolve(dirname(path), fileName);
      const found = [base, ...['.ts', '.tsx', '.json', '.js'].map(ext => base + ext)].find(existsSync);
      assert.ok(found, `resolve ${fileName} from ${path}`);
      visit(found);
    }
  }
  visit(resolve(entry));
  return seen;
}

test('search: entire runtime dependency graph excludes annual/legacy/storage/PlannerItem modules', () => {
  const graph = runtimeGraph('src/planner/institutional/currentSearch.ts');
  assert.ok([...graph].some(p => p.endsWith('/institutional/loader.ts')));
  for (const path of graph) {
    assert.doesNotMatch(path, /planner_catalog_|legacyArchive|legacy-relations|\/backup\/|\/attempts\/|\/catalog\/|\/storage|\/PlannerItem/);
  }
});

test('search: production application does not import new adapter even transitively', () => {
  const graph = runtimeGraph('src/main.tsx');
  assert.ok(graph.size > 10);
  assert.ok([...graph].every(path => !/institutional\/(currentSearch|search)\.ts$/.test(path)));
});
