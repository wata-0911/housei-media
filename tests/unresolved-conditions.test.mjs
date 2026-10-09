import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { catalog } from '../src/planner/catalog.ts';
import { initialState, loadState, saveState, STORAGE_KEY } from '../src/planner/storage.ts';
import { projectUnresolvedConditions } from '../src/planner/unresolvedConditions.ts';
import GraduationProgress from '../src/components/planner/GraduationProgress.tsx';
import { scenarios, calculateScenario, plannerItem } from './fixtures/unresolved-condition-scenarios.mjs';

const cases = scenarios();
const context = s => ({ catalog: s.catalog, scopeId: s.scopeId, profile: s.profile, importedRows: s.rows });
const project = (s, p = calculateScenario(s)) => projectUnresolvedConditions(p, context(s));
const base = cases.find(s => s.program.department === '法律学科' && s.name.endsWith('/B'));
const unknown = (id, reason) => ({ requirementId: id, label: id, ruleType: 'unsupported', status: 'unknown', reason, earned: null, target: null, planned: null, inProgress: null, unit: null });
const empty = () => ({ graduationCheckComplete: false, requirements: [], cards: [], referenceProgress: [], importedWarnings: [], unknownReasons: [], unknownCount: 0, evaluableCount: 0, coverageSummary: { supported: 0, partial: 0, unknown: 0 }, importedContributionCount: 0, historySchoolingDiagnostic: null });
const html = (s, p = calculateScenario(s)) => renderToStaticMarkup(createElement(GraduationProgress, { progress: p, context: context(s), onOpenProfile() {} }));

for (const s of cases) test(`projection preserves engine and accounts for every unknown: ${s.name}`, () => {
  const p = calculateScenario(s), before = structuredClone(p);
  const q = project(s, p);
  assert.deepEqual(p, before);
  assert.equal(p.graduationCheckComplete, false);
  const represented = new Set([...q.learner, ...q.automatic].flatMap(x => x.targets.map(t => t.id)));
  for (const row of p.requirements.filter(r => r.status === 'unknown')) assert.ok(represented.has(`requirement:${row.requirementId}`)
    || q.delegated.some(r => r.requirementId === row.requirementId) || q.excluded.some(r => r.requirementId === row.requirementId));
  for (const row of p.cards.filter(r => r.status === 'unknown')) assert.ok(represented.has(`card:${row.requirementId}`));
  for (const row of p.referenceProgress.filter(r => r.status === 'unknown')) assert.ok(represented.has(`reference:${row.id}`));
  assert.equal(new Set([...q.learner, ...q.automatic].map(x => x.id)).size, q.learner.length + q.automatic.length);
  for (const row of q.delegated) assert.ok(p.cards.some(c => c.requirementId === row.cardId));
  const rendered = html(s, p);
  assert.equal(rendered.includes('aria-label="確認が必要な条件"'), q.learner.length > 0);
  assert.equal(rendered.includes('aria-label="自動判定できない条件"'), q.automatic.length > 0);
  assert.match(rendered, new RegExp(`判定保留 ${p.unknownCount}件`));
});

test('first-year and confirmed recognition do not resurrect #115 input requirements', () => {
  for (const s of cases.filter(s => /\/(B|C|E|F|open-university)$/.test(s.name))) assert.equal(project(s).learner.length, 0, s.name);
  for (const s of cases.filter(s => s.name.endsWith('/D'))) assert.deepEqual(project(s).learner.map(x => x.id).sort(),
    ['input:general-recognition', 'input:group-foreign-recognition', 'input:group-physical-recognition', 'input:recognition-total']);
});

test('same reason never collapses unrelated requirements, and wording cannot imply an input fix', () => {
  const p = empty(); p.requirements = [unknown('one', '認定単位を扱うエンジンが未実装'), unknown('two', '認定単位を扱うエンジンが未実装')];
  const q = projectUnresolvedConditions(p);
  assert.equal(q.learner.length, 0); assert.equal(q.automatic.length, 2);
  assert.ok(q.automatic.every(x => x.owner === 'developer'));
});

test('empty UI and internal unknown with zero learner actions do not claim completion', () => {
  const rendered = html(base, empty()); assert.doesNotMatch(rendered, /<details|確認が必要な条件：|卒業可能|完全に判定/);
  const s = html(base); assert.doesNotMatch(s, /aria-label="確認が必要な条件"/); assert.match(s, /自動判定できない条件：/);
  assert.match(s, /卒業可否を保証しません/);
});

test('scope audit excludes proven other courses only; unknown scope is conservative', () => {
  const q = project(base); const other = catalog.requirements.find(r => r.ruleId === 'history_overview_exam');
  assert.ok(q.excluded.some(r => r.requirementId === other.id));
  const c = structuredClone(catalog); c.requirements.find(r => r.id === other.id).scopeLabel = 'future_scope';
  assert.ok(project({ ...base, catalog: c }).automatic.some(x => x.id === `requirement:${other.id}`));
});

test('explicit duplicate ownership preserves dynamic holds and legacy uncertainty', () => {
  const p = calculateScenario(base), rule = catalog.requirements.find(r => r.ruleId === 'common_foreign_exact_credits');
  assert.ok(project(base, p).delegated.some(r => r.requirementId === rule.id));
  p.requirements.find(r => r.requirementId === rule.id).reason += '。公式実績の算入を保留しています: metadata_unknown';
  assert.ok(project(base, p).automatic.some(r => r.id === `requirement:${rule.id}`));
  assert.equal(project({ ...base, profile: { ...base.profile, curriculumApplicability: 'legacy_or_transition' } }).delegated.length, 0);
});

test('optional thesis is one actual selection action and inactive branches stay absent', () => {
  for (const s of cases.filter(s => s.name.includes('/J-'))) {
    const q = project(s), optional = ['法律学科', '経済学科', '商業学科'].includes(s.program.department);
    assert.equal(q.learner.filter(x => x.id === 'input:thesis-selection').length, optional && s.name.endsWith('/J-undecided') ? 1 : 0);
    if (optional && s.name.endsWith('/J-not-selected')) {
      const p = calculateScenario(s); assert.ok(p.requirements.every(r => !catalog.requirements.find(c => c.id === r.requirementId)?.ruleId.includes('thesis_guidance')));
    }
  }
});

test('history generic unsupported rule is not an input action until a real earned order is missing', () => {
  const s = cases.find(s => s.program.department === '史学科' && s.name.endsWith('/B'));
  assert.equal(project(s).learner.length, 0);
  const seminar = catalog.offerings.find(o => o.name.startsWith('史学演習'));
  const q = project({ ...s, items: [plannerItem(seminar)] });
  const action = q.learner.find(x => x.id === 'input:history-order');
  assert.ok(action); assert.equal(action.targets.length, 4);
});

test('input plus independent official hold keeps both; unknown text never vanishes', () => {
  const p = empty(); p.referenceProgress = [{ id: 'overall-reference-progress', label: '全体', status: 'unknown', reason: '入学区分が未入力のため、個別の認定単位を扱えません。。公式実績の算入を保留しています: metadata_unknown', sourceRefs: [] }];
  const q = projectUnresolvedConditions(p); assert.equal(q.learner.length, 1); assert.equal(q.automatic.length, 1);
  assert.match(q.automatic[0].targets[0].reason, /metadata_unknown/);
});

test('manual import identity is actionable only with a selectable matched candidate; original warnings survive', () => {
  const s = cases.find(s => s.program.department === '法律学科' && s.name.endsWith('/H'));
  assert.equal(project(s).learner.filter(x => x.destination === 'imports').length, 1);
  const p = calculateScenario(s), snap = structuredClone(p.importedWarnings); project(s, p); assert.deepEqual(p.importedWarnings, snap);
  assert.equal(project({ ...s, rows: s.rows.map(r => ({ ...r, candidateOfferingIds: [] })) }).learner.length, 0);
});

test('schooling recognition is actionable but engine schooling evidence is not a profile toggle', () => {
  const s = cases.find(s => s.program.department === '法律学科' && s.name.endsWith('/E'));
  const profile = structuredClone(s.profile); profile.recognizedCredits.foreignLanguage = { mode: 'recognized', credits: 4, language: 'english', schoolingEquivalentCredits: null };
  assert.ok(project({ ...s, profile }).learner.some(x => x.id === 'input:foreign-schooling'));
  const q = project(cases.find(s => s.program.department === '法律学科' && s.name.endsWith('/official-schooling-unknown')));
  assert.equal(q.learner.length, 0);
});

test('persisted and fresh valid profiles project identically', () => {
  for (const s of cases.filter(s => /\/(B|D|E|F|G|curriculum-unknown|open-university)$/.test(s.name))) {
    const values = new Map(), store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
    saveState(store, { ...initialState(), selectedScopeId: s.scopeId, graduationProfile: s.profile }, null, catalog);
    assert.ok(values.has(STORAGE_KEY));
    const loaded = loadState(store, catalog); assert.equal(loaded.error, null);
    assert.deepEqual(project({ ...s, profile: loaded.state.graduationProfile }), project(s));
  }
});

test('long reasons retain readable wrapping and separate accessible disclosure labels', () => {
  const p = empty(); p.requirements = [unknown('long', '確認できない根拠'.repeat(150)), unknown('input', '卒業論文を履修するか未定です。')];
  const s = html(base, p); assert.match(s, /break-words/); assert.match(s, /leading-relaxed/);
  assert.match(s, /aria-label="確認が必要な条件"/); assert.match(s, /aria-label="自動判定できない条件"/); assert.match(s, /プロフィールを開く/);
});

test('schema and incomplete metadata remain unchanged', () => {
  assert.equal(initialState().schemaVersion, 22); assert.equal(catalog.metadata.graduationCheckComplete, false); assert.equal(catalog.metadata.sourceLinksReverified, false);
  const p = calculateScenario(base); const original = structuredClone(p);
  project(base, p); assert.deepEqual(p, original);
});

test('168 full engine outputs match the pre-change dev baseline (quantities, statuses, coverage, notices)', async () => {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const baseline = JSON.parse(readFileSync(new URL('./fixtures/unresolved-engine-baseline.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(baseline.scenarios).length, cases.length);
  for (const s of cases) assert.equal(createHash('sha256').update(JSON.stringify(calculateScenario(s))).digest('hex'), baseline.scenarios[s.name], s.name);
});
