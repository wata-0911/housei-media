import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstitutionalSearchView } from '../src/components/planner/institutional/InstitutionalSearchView.tsx';
import { filterPlacementNames } from '../src/components/planner/institutional/searchView.ts';
import { loadCurrentCurriculumSearchAdapter } from '../src/planner/institutional/currentSearch.ts';

const adapter = loadCurrentCurriculumSearchAdapter();
const all = adapter.search({ scope: { kind: 'all' } });
// Frozen actual pre-refactor helper; works in shallow and source-only checkouts.
import * as baseline from './fixtures/institutional-search-pr229.mjs';
const ids = rows => rows.map(r => r.placement.id);
test('shared UI migration preserves baseline result IDs and ordering for every name, scope, common flag and match mode', () => {
  assert.equal(all.rows.length, 502);
  const scopes = [...new Set(all.rows.map(r => r.scope.id))];
  const slices = [all, ...scopes.flatMap(scopeId => [false, true].map(includeCommon => adapter.search({ scope: { kind: 'scope', scopeId, includeCommon } })))];
  const queries = [...new Set(all.rows.map(r => r.placement.officialName)), '', '　 ', '簿記 Ⅰ', 'ＡＢ 簿記', '存在しない科目'];
  for (const slice of slices) for (const query of queries) for (const mode of ['partial', 'exact']) {
    assert.deepEqual(ids(filterPlacementNames(slice.rows, query, mode)), ids(baseline.filterPlacementNames(slice.rows, query, mode)));
  }
});
test('shared UI has no dev/current-master loader dependency and separates user information from audit details', () => {
  const source = readFileSync(new URL('../src/components/planner/institutional/InstitutionalSearchView.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /import\.meta\.env|process\.env|__dev|currentSearch|makeSearchAttempt|localStorage|indexedDB/);
  const html = renderToStaticMarkup(createElement(InstitutionalSearchView, { adapter }));
  assert.doesNotMatch(html, /開発用|<main|<h1/);
  assert.match(html, /<section[^>]*aria-labelledby/);
  const first = html.slice(html.indexOf('<li>'), html.indexOf('</li>'));
  assert.ok(first.indexOf('identity:') > first.indexOf('<details>'));
  assert.match(first, /本人への課程適用: 未確認（unknown）/);
  assert.match(first, /auditRecord/);
});
test('shared instances use distinct radio groups and errors remain explanatory', () => {
  const html = renderToStaticMarkup(createElement('div', null, createElement(InstitutionalSearchView, { adapter }), createElement(InstitutionalSearchView, { adapter })));
  const names = [...html.matchAll(/type="radio" name="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(names).size, 2);
  for (const status of ['unknown_curriculum', 'unknown_scope', 'revision_mismatch']) {
    const error = renderToStaticMarkup(createElement(InstitutionalSearchView, { adapter: { search: () => ({ ...all, status, rows: [] }) } }));
    assert.match(error, /role="alert"/);
    assert.match(error, /検索資料版・対象を確認できません/);
  }
});
