import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadCurrentCurriculumSearchAdapter } from '../src/planner/institutional/currentSearch.ts';
import { filterPlacementNames, compositionLabel } from '../dev/institutional/searchView.ts';
import { InstitutionalSearch } from '../dev/institutional/InstitutionalSearch.tsx';

const rows = loadCurrentCurriculumSearchAdapter().search({ scope: { kind: 'all' } }).rows;
test('read-only: #104 normalization, AND, whole name, internal whitespace, blanks and duplicates', () => {
  const fixture = ['ＡＢ 簿記', 'ab 簿記', '簿記', '簿記Ⅰ', '簿記Ⅳ'].map((officialName, i) => ({ ...rows[0], placement: { ...rows[0].placement, officialName, id: String(i) } }));
  assert.equal(filterPlacementNames(fixture, ' 簿記　ab ', 'partial').length, 2);
  assert.equal(filterPlacementNames(fixture, ' AB 簿記 ', 'exact').length, 2);
  assert.equal(filterPlacementNames(fixture, 'AB  簿記', 'exact').length, 0);
  assert.equal(filterPlacementNames(fixture, '簿記', 'exact').length, 1);
  assert.equal(filterPlacementNames(fixture, '簿記I', 'exact')[0].placement.officialName, '簿記Ⅰ');
  assert.equal(filterPlacementNames(fixture, '簿記IV', 'exact')[0].placement.officialName, '簿記Ⅳ');
  for (const mode of ['partial', 'exact']) for (const query of ['', '　 ']) assert.deepEqual(filterPlacementNames(fixture, query, mode), fixture);
  assert.equal(filterPlacementNames(fixture, rows[0].placement.id, 'partial').length, 0);
});
test('read-only: all 502 placements retained; scope and common inclusion use adapter', () => {
  assert.equal(rows.length, 502);
  const adapter = loadCurrentCurriculumSearchAdapter();
  for (const row of rows) {
    const matching = filterPlacementNames(rows, row.placement.officialName, 'exact');
    assert.ok(matching.some(r => r.placement.id === row.placement.id));
  }
  const scope = rows.find(r => r.scope.officialScopeLabel === '法律').scope.id;
  const solo = adapter.search({ scope: { kind: 'scope', scopeId: scope, includeCommon: false } }).rows;
  const common = adapter.search({ scope: { kind: 'scope', scopeId: scope, includeCommon: true } }).rows;
  assert.ok(solo.length > 0 && common.length > solo.length);
  assert.ok(solo.every(r => r.scope.id === scope));
  assert.ok(common.every(r => r.scope.id === scope || r.scope.officialScopeLabel === 'common'));
});
test('read-only: render evidence, null/zero, bucket and unresolved states without promotion', () => {
  assert.equal(compositionLabel(null), '不明（null）');
  assert.equal(compositionLabel(0), '0単位');
  const samples = ['safe', 'ambiguous', 'conflict', 'unmatched'].map(status => rows.find(r => r.placement.identityDecision.status === status));
  samples.push(rows.find(r => r.placement.kind === 'non_course_bucket'));
  const fixture = structuredClone(samples);
  fixture[0].placement.compositionCredits = null;
  fixture[1].placement.compositionCredits = 0;
  const before = JSON.stringify(fixture);
  const html = renderToStaticMarkup(createElement(InstitutionalSearch, { adapter: { search: () => ({ status: 'documented_slice_only', rows: fixture }) } }));
  for (const r of fixture) {
    assert.ok(html.includes(r.placement.officialName));
    assert.ok(html.includes(r.placement.officialRow.evidenceId));
    assert.ok(html.includes(`冊子p.${r.placement.officialRow.printedPage}`));
    assert.ok(html.includes(r.sourceRevision.sha256));
  }
  for (const text of ['不明（null）', '0単位', '非科目枠', 'ambiguous', 'conflict', 'unmatched', 'IC未確定', 'unknown', '履修条件', '未判定']) assert.ok(html.includes(text), text);
  assert.equal(JSON.stringify(fixture), before);
  assert.doesNotMatch(html, /<button/);
});
test('read-only: runtime graph excludes Offering, Attempt, storage and calculations; production unchanged', () => {
  function graph(entry) {
    const seen = new Set();
    function visit(path) {
      if (seen.has(path)) return;
      seen.add(path);
      if (!/\.[jt]sx?$/.test(path)) return;
      const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
      for (const { fileName } of ts.preProcessFile(compiled).importedFiles) {
        if (!fileName.startsWith('.')) continue;
        const base = resolve(dirname(path), fileName);
        const found = [base, ...['.ts', '.tsx', '.json', '.js'].map(ext => base + ext)].find(existsSync);
        assert.ok(found); visit(found);
      }
    }
    visit(resolve(entry)); return [...seen];
  }
  for (const path of graph('dev/institutional/main.tsx')) assert.doesNotMatch(path, /planner_catalog_|\/attempts\/|\/persistence\/|\/calculations|\/storage|\/catalog\//);
  assert.ok(graph('src/main.tsx').every(path => !path.includes('/dev/institutional/')));
});
