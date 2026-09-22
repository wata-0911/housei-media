import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { catalog, offeringsById } from '../src/planner/catalog.ts';
import { manualMappingOverrideLedger } from '../src/planner/manualMappingOverrides.ts';
import { validateCatalog, validateState } from '../src/planner/validation.ts';
import { summarizeCredits, searchOfferings } from '../src/planner/calculations.ts';
import { STORAGE_KEY, BACKUP_KEY, initialState, loadState, saveState, recoverState } from '../src/planner/storage.ts';

function memoryStore(raw = null) {
  const values = new Map(raw === null ? [] : [[STORAGE_KEY, raw]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const item = (offeringId, status = 'planned') => ({ offeringId, status, plannedYear: 2026, plannedTerm: null });
const first = catalog.offerings[0];
const rawCatalog = JSON.parse(readFileSync(new URL('../src/data/planner_catalog_2026.json', import.meta.url), 'utf8'));
const rawOfferingsById = new Map(rawCatalog.offerings.map(offering => [offering.id, offering]));

test('catalog preserves all 686 offerings, 348 null course IDs and incomplete graduation coverage', () => {
  assert.equal(catalog.offerings.length, 686);
  assert.equal(catalog.offerings.filter(o => o.courseId === null).length, 348);
  assert.equal(catalog.metadata.graduationCheckComplete, false);
  assert.equal(validateCatalog({ ...catalog, metadata: { ...catalog.metadata, graduationCheckComplete: true } }), false);
});

test('search spans every offering and each specified field, normalizes full-width input', () => {
  assert.equal(searchOfferings(catalog.offerings, '').length, 686);
  for (const offering of catalog.offerings) {
    for (const field of ['name', 'subjectCode', 'classCode', 'deliveryCategory', 'period']) {
      if (offering[field]) assert.ok(searchOfferings(catalog.offerings, offering[field]).some(o => o.id === offering.id));
    }
  }
  assert.equal(searchOfferings([{ ...first, subjectCode: 'ABC123' }], 'ａｂｃ１２３').length, 1);
});

test('all six statuses round-trip, including null course identity', () => {
  const offering = catalog.offerings.find(o => o.courseId === null);
  const store = memoryStore();
  let expected = null;
  for (const status of ['planned', 'in_progress', 'waiting', 'earned', 'failed', 'dropped']) {
    const state = { ...initialState(), items: [item(offering.id, status)] };
    expected = saveState(store, state, expected, catalog);
    assert.deepEqual(loadState(store, catalog).state, state);
  }
});

test('invalid JSON, schema version, references, duplicate items and invalid fields remain intact', () => {
  const valid = { ...initialState(), items: [item(first.id)] };
  const invalid = [
    '{broken', JSON.stringify({ ...valid, schemaVersion: 2 }),
    JSON.stringify({ ...valid, items: [item('missing')] }),
    JSON.stringify({ ...valid, items: [item(first.id), item(first.id)] }),
    JSON.stringify({ ...valid, selectedScopeId: 'missing' }),
    JSON.stringify({ ...valid, items: [{ ...item(first.id), status: 'invalid' }] }),
    JSON.stringify({ ...valid, items: [{ ...item(first.id), plannedYear: '2026' }] }),
    JSON.stringify({ ...valid, todos: null }),
  ];
  for (const raw of invalid) {
    const store = memoryStore(raw);
    const result = loadState(store, catalog);
    assert.ok(result.error);
    assert.equal(result.raw, raw);
    assert.equal(store.getItem(STORAGE_KEY), raw);
    assert.deepEqual(result.state, initialState());
  }
});

test('credit totals exclude waiting/failed/dropped, unknown count covers all statuses', () => {
  const statuses = ['earned', 'in_progress', 'planned', 'waiting', 'failed', 'dropped'];
  const offerings = new Map();
  const items = [];
  for (const [index, status] of statuses.entries()) {
    offerings.set(`known-${index}`, { ...first, credits: 4 });
    offerings.set(`unknown-${index}`, { ...first, credits: null });
    items.push(item(`known-${index}`, status), item(`unknown-${index}`, status));
  }
  assert.deepEqual(summarizeCredits(items, offerings), { earned: 4, in_progress: 4, planned: 4, unknownCreditItems: 6 });
  assert.throws(() => summarizeCredits([item('missing')], offeringsById));
});

test('read denial and write quota errors cannot erase prior data', () => {
  assert.ok(loadState({ getItem() { throw new Error('denied'); } }, catalog).error);
  const raw = JSON.stringify(initialState());
  const store = { getItem: () => raw, setItem() { throw new Error('quota'); } };
  assert.throws(() => saveState(store, initialState(), raw, catalog), /quota/);
  assert.throws(() => recoverState(store, raw, catalog), /quota/);
  assert.equal(store.getItem(STORAGE_KEY), raw);
});

test('recovery backs up exact original bytes; stale writes and recovery are rejected', () => {
  const raw = '  {invalid';
  const store = memoryStore(raw);
  recoverState(store, raw, catalog);
  assert.equal(store.getItem(BACKUP_KEY), raw);
  assert.deepEqual(loadState(store, catalog).state, initialState());
  assert.throws(() => saveState(store, initialState(), raw, catalog));
  assert.throws(() => recoverState(store, raw, catalog));
  assert.equal(store.getItem(BACKUP_KEY), raw);
});

test('existing scope and todos survive state changes without adding todo UI', () => {
  const state = { ...initialState(), selectedScopeId: catalog.programs[0].scopeId,
    todos: [{ id: first.id, offeringId: first.id, text: '保持する', done: false }], items: [item(first.id)] };
  assert.equal(validateState(state, catalog), true);
  const store = memoryStore();
  saveState(store, state, null, catalog);
  assert.deepEqual(loadState(store, catalog).state, state);
  assert.equal(validateState({ ...state, todos: [state.todos[0], state.todos[0]] }, catalog), false);
});

const { selectablePrograms, termOptions, groupAnnualPlan, createCreditClassifier, summarizeCategories } = await import('../src/planner/annualPlan.ts');

test('all eight affiliations round-trip with year, catalog term, legacy term and todos', () => {
  assert.equal(selectablePrograms(catalog).length, 8);
  assert.ok(selectablePrograms(catalog).every(p => !p.isCommon));
  for (const program of selectablePrograms(catalog)) {
    for (const plannedTerm of [null, '', '以前の自由入力', ...termOptions(catalog.offerings)]) {
      const state = { ...initialState(), selectedScopeId: program.scopeId, items: [{ ...item(first.id), plannedYear: 2027, plannedTerm }], todos: [{ id: first.id, offeringId: null, text: '既存todo', done: true }] };
      const raw = JSON.stringify(state);
      const store = memoryStore(raw);
      const loaded = loadState(store, catalog);
      assert.equal(loaded.error, null);
      const changed = { ...loaded.state, items: [{ ...loaded.state.items[0], status: 'earned' }] };
      saveState(store, changed, loaded.raw, catalog);
      assert.deepEqual(loadState(store, catalog).state, changed);
    }
  }
});

test('annual grouping respects years and exact delivery data without interpreting legacy terms', () => {
  const offerings = new Map([
    ['a', { ...first, id: 'a', courseId: null, method: 'correspondence', deliveryCategory: null }],
    ['b', { ...first, id: 'b', method: 'schooling', deliveryCategory: '前期メディア' }],
    ['c', { ...first, id: 'c', method: 'schooling', deliveryCategory: null, period: null }],
  ]);
  const items = [{ ...item('c'), plannedYear: null, plannedTerm: '夏期にしたい' }, { ...item('b'), plannedYear: 2027 }, item('a')];
  const groups = groupAnnualPlan(items, offerings);
  assert.deepEqual(groups.map(g => g.year), [2026, 2027, null]);
  assert.deepEqual(groups.map(g => g.groups[0].label), ['通信学習', '前期メディア', '未分類']);
  assert.equal(groups.flatMap(g => g.groups.flatMap(x => x.items)).length, 3);
  assert.throws(() => groupAnnualPlan([item('missing')], offerings));
});

test('classification uses exact common/selected mappings; unresolved, conflicting and other-scope mappings remain unknown', () => {
  const scope = selectablePrograms(catalog)[0].scopeId;
  const common = catalog.programs.find(p => p.isCommon).scopeId;
  const base = catalog.mappings[0];
  const mappings = [
    { ...base, mappingId: 'human', scopeId: common, category: '一般教育', field: '人文' },
    { ...base, mappingId: 'human2', scopeId: common, category: '一般教育', field: '人文' },
    { ...base, mappingId: 'special', scopeId: scope, category: '専門教育' },
    { ...base, mappingId: 'other', scopeId: 'other', category: '専門教育' },
    { ...base, mappingId: 'unknown', scopeId: common, category: '一般教育', field: 'その他' },
  ];
  const fixture = { ...catalog, mappings };
  const classify = createCreditClassifier(fixture, scope);
  const offering = { ...first, courseId: null, resolutionStatus: 'matched', mappingIds: ['human', 'human2'] };
  assert.equal(classify(offering), '一般教育：人文');
  assert.equal(classify({ ...offering, mappingIds: ['special', 'other'] }), '専門教育');
  for (const mappingIds of [[], ['human', 'special'], ['human', 'unknown']]) {
    assert.equal(classify({ ...offering, mappingIds }), '対応情報を確認中');
  }
  assert.equal(classify({ ...offering, resolutionStatus: 'manual_review' }), '対応情報を確認中');
  assert.equal(classify({ ...offering, resolutionStatus: 'outside_mapping_scope' }), '教職等・通常カリキュラム対象外');
  assert.equal(classify({ ...offering, mappingIds: ['other'] }), '選択した所属のカリキュラム対象外');
  assert.equal(classify({ ...offering, mappingIds: ['unknown'] }), '一般教育：その他');
  assert.equal(createCreditClassifier(fixture, null)(offering), '所属を選択すると区分を表示');
  assert.equal(createCreditClassifier(fixture, common)(offering), '所属を選択すると区分を表示');
});

test('category totals conserve overall credits and unknown counts across every offering/status and scope', () => {
  const statuses = ['earned', 'in_progress', 'planned', 'waiting', 'failed', 'dropped'];
  const items = catalog.offerings.map((o, index) => item(o.id, statuses[index % statuses.length]));
  const total = summarizeCredits(items, offeringsById);
  for (const program of selectablePrograms(catalog)) {
    const rows = summarizeCategories(items, catalog, program.scopeId);
    for (const key of ['earned', 'in_progress', 'planned', 'unknownCreditItems']) {
      assert.equal(rows.reduce((sum, row) => sum + row[key], 0), total[key]);
    }
    assert.equal(rows.reduce((sum, row) => sum + row.count, 0), 686);
    assert.equal(rows.find(r => r.category === '教職等・通常カリキュラム対象外').count, 30);
    assert.ok(rows.find(r => r.category === '対応情報を確認中').count >= 29);
  }
});

test('catalog and manual-curated foreign-language mappings count for all eight affiliations', () => {
  const foreignMappings = catalog.mappings.filter(m => m.category === '外国語');
  assert.equal(foreignMappings.length, 7);
  assert.deepEqual([...new Set(foreignMappings.map(m => m.field))].sort(), ['仏語', '独語', '英語']);
  const commonScopes = new Set(catalog.programs.filter(p => p.isCommon).map(p => p.scopeId));
  assert.ok(foreignMappings.every(m => commonScopes.has(m.scopeId)));
  const ids = new Set(foreignMappings.map(m => m.mappingId));
  const offerings = catalog.offerings.filter(o => o.mappingIds.some(id => ids.has(id)));
  assert.equal(offerings.length, 41);
  assert.ok(offerings.some(o => o.name === '英語２'));
  assert.ok(offerings.some(o => o.name === '仏語S(後期メディア)'));
  for (const { scopeId } of selectablePrograms(catalog)) {
    const classify = createCreditClassifier(catalog, scopeId);
    for (const offering of offerings) {
      assert.equal(classify(offering), '外国語', `${scopeId}: ${offering.name}`);
    }
    const items = offerings.map(o => item(o.id));
    const rows = summarizeCategories(items, catalog, scopeId);
    assert.deepEqual(rows.find(r => r.category === '外国語'), {
      category: '外国語', count: 41, ...summarizeCredits(items, offeringsById),
    });
    assert.equal(rows.find(r => r.category === '対応情報を確認中').count, 0);
  }
});

test('matching common and selected scope mappings count each offering once for all common categories', () => {
  const scope = selectablePrograms(catalog)[0].scopeId;
  const commonScopes = new Set(catalog.programs.filter(p => p.isCommon).map(p => p.scopeId));
  for (const category of ['一般教育：人文', '一般教育：社会', '一般教育：自然', '外国語', '保健体育']) {
    const classify = createCreditClassifier(catalog, scope);
    const offering = catalog.offerings.find(o => classify(o) === category && o.credits !== null);
    assert.ok(offering, category);
    const commonMapping = catalog.mappings.find(m => offering.mappingIds.includes(m.mappingId) && commonScopes.has(m.scopeId));
    assert.ok(commonMapping);
    const selectedMapping = { ...commonMapping, mappingId: 'selected-copy', scopeId: scope };
    const fixture = {
      ...catalog,
      mappings: [...catalog.mappings, selectedMapping],
      offerings: [{ ...offering, mappingIds: [...offering.mappingIds, selectedMapping.mappingId] }],
    };
    for (const status of ['planned', 'in_progress', 'earned']) {
      const rows = summarizeCategories([item(offering.id, status)], fixture, scope);
      assert.equal(rows.find(r => r.category === category)[status], offering.credits);
      assert.equal(rows.find(r => r.category === category).count, 1);
      assert.equal(rows.reduce((sum, r) => sum + r[status], 0), offering.credits);
      assert.equal(rows.reduce((sum, r) => sum + r.count, 0), 1);
    }
  }
});

test('manual curated ledger resolves only the 34 approved offerings and preserves source identity', () => {
  assert.equal(manualMappingOverrideLedger.provenance, 'manual_curated');
  assert.equal(manualMappingOverrideLedger.officialVerified, false);
  const curatedIds = manualMappingOverrideLedger.overrides.flatMap(entry => entry.offeringIds);
  assert.equal(curatedIds.length, 34);
  assert.equal(new Set(curatedIds).size, 34);
  assert.equal(rawCatalog.offerings.filter(o => o.resolutionStatus !== 'matched').length, 93);
  assert.equal(catalog.offerings.filter(o => o.resolutionStatus !== 'matched').length, 59);
  assert.equal(catalog.metadata.unresolvedOfferingCount, 59);
  assert.equal(catalog.metadata.catalogCoverage.matchedOfferingCount, 627);
  assert.equal(catalog.metadata.catalogCoverage.manualReviewOfferingCount, 29);
  assert.equal(catalog.metadata.catalogCoverage.outsideMappingScopeOfferingCount, 30);
  assert.equal(catalog.metadata.catalogCoverage.mappingEdgeCount, 1161);
  for (const entry of manualMappingOverrideLedger.overrides) {
    for (const offeringId of entry.offeringIds) {
      const raw = rawOfferingsById.get(offeringId);
      const patched = offeringsById.get(offeringId);
      assert.equal(raw.resolutionStatus, 'manual_review');
      assert.deepEqual(raw.mappingIds, []);
      assert.equal(patched.name, raw.name);
      assert.equal(patched.courseId, raw.courseId);
      assert.equal(patched.classCode, raw.classCode);
      assert.equal(patched.subjectCode, raw.subjectCode);
      assert.equal(patched.resolutionStatus, 'matched');
      assert.deepEqual(patched.mappingIds, entry.mappingIds);
    }
  }
  for (const raw of rawCatalog.offerings.filter(o => o.resolutionStatus === 'matched')) {
    assert.deepEqual(offeringsById.get(raw.id), raw, raw.id);
  }
});

test('all 26 numbered English S offerings classify as foreign language, including class 21005', () => {
  const entry = manualMappingOverrideLedger.overrides.find(item => item.ruleId === 'english_s_numbered_classes');
  assert.equal(entry.offeringIds.length, 26);
  for (const { scopeId } of selectablePrograms(catalog)) {
    const classify = createCreditClassifier(catalog, scopeId);
    for (const offeringId of entry.offeringIds) {
      assert.equal(classify(offeringsById.get(offeringId)), '外国語');
    }
  }
  const offering = offeringsById.get('066427dc-1df4-47bd-a6b1-538ab161e869');
  assert.equal(offering.name, '英語Ｓ［５］（秋期スクーリング）');
  assert.equal(offering.classCode, '21005');
  assert.equal(createCreditClassifier(catalog, selectablePrograms(catalog)[0].scopeId)(offering), '外国語');
});

test('history [S] overrides retain every candidate mapping and classify only in their proper scopes', () => {
  const historyScope = catalog.programs.find(p => p.displayName === '文学部 / 史学科').scopeId;
  const geographyScope = catalog.programs.find(p => p.displayName === '文学部 / 地理学科').scopeId;
  const overviewRules = manualMappingOverrideLedger.overrides.filter(entry => entry.ruleId.includes('history_overview'));
  assert.equal(overviewRules.length, 3);
  for (const entry of overviewRules) {
    assert.equal(entry.offeringIds.length, 2);
    assert.equal(entry.mappingIds.length, 3);
    for (const offeringId of entry.offeringIds) {
      const offering = offeringsById.get(offeringId);
      assert.equal(createCreditClassifier(catalog, historyScope)(offering), '専門教育');
      assert.equal(createCreditClassifier(catalog, geographyScope)(offering), '専門教育');
      for (const program of selectablePrograms(catalog).filter(p => ![historyScope, geographyScope].includes(p.scopeId))) {
        assert.equal(createCreditClassifier(catalog, program.scopeId)(offering), '選択した所属のカリキュラム対象外');
      }
    }
  }
  const geographyRule = manualMappingOverrideLedger.overrides.find(entry => entry.ruleId === 'regional_geography_special_schooling_marker');
  for (const offeringId of geographyRule.offeringIds) {
    const offering = offeringsById.get(offeringId);
    assert.equal(createCreditClassifier(catalog, geographyScope)(offering), '専門教育');
    for (const program of selectablePrograms(catalog).filter(p => p.scopeId !== geographyScope)) {
      assert.equal(createCreditClassifier(catalog, program.scopeId)(offering), '選択した所属のカリキュラム対象外');
    }
  }
});

test('information, computer and held history offerings remain unresolved with distinct names', () => {
  const information = catalog.offerings.filter(o => /^(情報学入門|コンピュータ入門)［[1-6]］［(表計算|データ演習|データベース)］/.test(o.name));
  assert.equal(information.length, 16);
  assert.ok(information.every(o => o.resolutionStatus === 'manual_review' && o.mappingIds.length === 0));
  assert.ok(information.every(o => rawOfferingsById.get(o.id).name === o.name));

  const held = catalog.offerings.filter(o =>
    /^史学演習（(日本|西洋|東洋)）/.test(o.name)
    || /^歴史資料学（日本(近代|近世)）/.test(o.name)
    || o.name.startsWith('日本史特講（日本仏教史）（地理）'));
  assert.equal(held.length, 11);
  assert.ok(held.every(o => o.resolutionStatus === 'manual_review' && o.mappingIds.length === 0));
});


test('outside selected scope is a reference row and never contributes to normal curriculum categories', async () => {
  const { isCreditCategory } = await import('../src/planner/annualPlan.ts');
  const scope = selectablePrograms(catalog)[0].scopeId;
  const classify = createCreditClassifier(catalog, scope);
  const offering = catalog.offerings.find(o => classify(o) === '選択した所属のカリキュラム対象外' && o.credits > 0);
  assert.ok(offering);
  const rows = summarizeCategories([item(offering.id, 'earned')], catalog, scope);
  assert.equal(rows.filter(row => isCreditCategory(row.category)).reduce((sum, row) => sum + row.earned, 0), 0);
  assert.equal(rows.find(row => row.category === classify(offering)).earned, offering.credits);
});

test('general education other is a normal category even with a null course identity', () => {
  const scope = selectablePrograms(catalog)[0].scopeId;
  const classify = createCreditClassifier(catalog, scope);
  const offering = catalog.offerings.find(o => classify(o) === '一般教育：その他');
  assert.ok(offering);
  assert.equal(classify({ ...offering, courseId: null }), '一般教育：その他');
  const rows = summarizeCategories([item(offering.id)], catalog, scope);
  assert.equal(rows.find(row => row.category === '一般教育：その他').count, 1);
  assert.equal(rows.find(row => row.category === '対応情報を確認中').count, 0);
});

test('outside mapping and manual review keep distinct labels and remain saveable', () => {
  for (const [status, label, count] of [
    ['outside_mapping_scope', '教職等・通常カリキュラム対象外', 30],
    ['manual_review', '対応情報を確認中', 29],
  ]) {
    const offerings = catalog.offerings.filter(o => o.resolutionStatus === status);
    assert.equal(offerings.length, count);
    for (const scope of [null, ...selectablePrograms(catalog).map(p => p.scopeId)]) {
      const classify = createCreditClassifier(catalog, scope);
      assert.ok(offerings.every(o => classify(o) === label));
      const state = { ...initialState(), selectedScopeId: scope, items: offerings.map(o => item(o.id)) };
      const store = memoryStore();
      saveState(store, state, null, catalog);
      assert.deepEqual(loadState(store, catalog).state, state);
    }
  }
});
