import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { files, initialState } from './fixtures/migration-fixture.mjs';

const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
const primary = JSON.stringify(initialState());
let browser, servers = [], origins = [];
before(async () => {
  const output = await build({ stdin: { resolveDir: new URL('../', import.meta.url).pathname, contents: `
    import { createPlannerAttemptSession } from './src/planner/attempts/production/session';
    import { createAuthorityIndexedDbStore } from './src/planner/attempts/persistence/authorityIndexedDb';
    import { readLegacySnapshot } from './src/planner/attempts/production/authorityAdmission';
    import { prepareMigrationEnvironment } from './src/planner/attempts/migration/source';
    export { backupDigest } from './src/planner/digest';
    export const store = createAuthorityIndexedDbStore(indexedDB);
    export const make = (legacy = false) => createPlannerAttemptSession(store, navigator.locks,
      legacy ? { readLegacy: () => readLegacySnapshot(localStorage),
        migrationEnvironment: () => prepareMigrationEnvironment(${JSON.stringify(files)}),
        protectAuthority: () => store.protectOriginal() } : undefined);
  ` }, bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
  for (let i = 0; i < 2; i++) {
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', request.url === '/bundle.mjs' ? 'text/javascript' : 'text/html');
      response.end(request.url === '/bundle.mjs' ? output.outputFiles[0].text : '<title>F01 R7 synthetic history</title>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    origins.push(`http://127.0.0.1:${server.address().port}`);
  }
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

for (const [kind, count] of [...[16, 32, 64].map(count => ['receipts', count]), ...[256, 1024, 4096].map(count => ['rows', count])]) {
  test(`R7 native schema24 ${kind} ${count}: accepted history and rejected tail preserve authority`, { timeout: 120000 }, async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await page.goto(origins[0]);
    const result = await page.evaluate(async ({ kind, count }) => {
      const { store, make, backupDigest } = await import('/bundle.mjs');
      const api = make();
      await api.load();
      await api.save(await api.prepareSave(), true);
      api.add('hosei:cp:b99c65d5-5917-422d-bda4-75a4f99ad8b7', JSON.stringify({ plannedYear: 2038, method: 'correspondence', status: 'planned' }));
      const id = api.graph().attempts[0].id;
      if (kind === 'rows') {
        const payload = { requiredReports: count, reports: Array.from({ length: count }, (_, i) => ({ reportNumber: i + 1, status: 'passed', grade: 'A' })), examGrade: null };
        api.progress(id, 'correspondence', JSON.stringify(payload));
        payload.reports.reverse();
        api.progress(id, 'correspondence', JSON.stringify(payload));
      } else for (let i = 1; i < count; i++) api.recordContribution(id, JSON.stringify({ value: i % 4 }));
      await api.save(await api.prepareSave(), true);
      const raw = await api.createBackup();
      const before = JSON.stringify(await store.read());
      const body = JSON.parse(raw);
      delete body.sha256;
      if (kind === 'rows') body.state.history.commands.at(-1).payload.reports[0].reportNumber = count + 1;
      else body.state.history.commands.at(-1).attemptId = 'hosei:attempt:bbbbbbbb-aaaa-4444-8aaa-000000000000';
      const invalid = JSON.stringify({ ...body, sha256: await backupDigest(body) });
      let puts = 0;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { puts++; return put.apply(this, args); };
      const outcomes = [];
      for (const [valid, input] of [[true, raw], [false, invalid]]) {
        let comparisons = 0;
        const method = kind === 'rows' ? 'some' : 'find';
        const original = Array.prototype[method];
        Array.prototype[method] = function (predicate, ...args) {
          const pattern = kind === 'rows' ? /=>\s*\w+\.reportNumber\s*===\s*\w+\.reportNumber\s*$/ : /=>\s*\w+\.operationId\s*===\s*command\.operationId\s*$/;
          if (pattern.test(predicate.toString())) return original.call(this, (...values) => {
            comparisons++;
            return predicate(...values);
          }, ...args);
          return original.call(this, predicate, ...args);
        };
        let preview = false, error = null;
        try { await api.prepareRestore(input); preview = true; }
        catch (cause) { error = String(cause); }
        finally { Array.prototype[method] = original; }
        outcomes.push({ valid, preview, error, comparisons, puts, unchanged: before === JSON.stringify(await store.read()) });
      }
      return { kind, count, bytes: new Blob([raw]).size, outcomes };
    }, { kind, count });
    console.log(JSON.stringify(result));
    assert.equal(result.outcomes[0].preview, true);
    assert.equal(result.outcomes[0].error, null);
    assert.equal(result.outcomes[1].preview, false);
    assert.match(result.outcomes[1].error, kind === 'rows' ? /progress_row_lost/ : /unknown_attempt/);
    for (const outcome of result.outcomes) {
      assert.equal(outcome.comparisons, 0);
      assert.equal(outcome.puts, 0);
      assert.equal(outcome.unchanged, true);
    }
  });
}

for (const schema of [23, 24]) test(`R7 schema${schema} real backup survives same and separate origins`, { timeout: 120000 }, async t => {
  const sourceContext = await browser.newContext();
  const destinationContext = await browser.newContext();
  t.after(async () => { await sourceContext.close(); await destinationContext.close(); });
  const sourcePage = await sourceContext.newPage();
  await sourcePage.goto(origins[0]);
  const source = await sourcePage.evaluate(async ({ schema, primary }) => {
    const m = await import('/bundle.mjs');
    if (schema === 23) localStorage.setItem('hosei-planner:v1', primary);
    const api = m.make(schema === 23);
    await api.load();
    await api.save(schema === 23 ? await api.prepareMigration(primary) : await api.prepareSave(), true);
    api.add('hosei:cp:b99c65d5-5917-422d-bda4-75a4f99ad8b7', JSON.stringify({ plannedYear: 2038, method: 'correspondence', status: 'planned' }));
    const id = api.graph().attempts.at(-1).id;
    for (let i = 0; i < 15; i++) api.recordContribution(id, JSON.stringify({ value: i % 4 }));
    await api.save(await api.prepareSave(), true);
    const raw = await api.createBackup();
    const before = await m.store.read();
    let puts = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { puts++; return put.apply(this, args); };
    const preview = await api.prepareRestore(raw);
    const previewPuts = puts;
    await api.save(preview, true, preview.adoptionSha256);
    const saved = await m.store.read();
    const fresh = m.make(schema === 23);
    await fresh.load();
    const output = await fresh.createBackup();
    return { raw, before, saved, previewPuts, puts, outputState: JSON.parse(output).state,
      outputIds: JSON.parse(output).reservedIds,
      localPrimary: localStorage.getItem('hosei-planner:v1') };
  }, { schema, primary });
  assert.equal(source.previewPuts, 0);
  assert.equal(source.puts, 1);
  assert.equal(source.before.raw, source.saved.raw);
  assert.deepEqual(source.before.issuedIds, source.saved.issuedIds);
  assert.equal(source.outputState.history.commands.length, 16);
  assert.equal(source.localPrimary, schema === 23 ? primary : null);

  const destinationPage = await destinationContext.newPage();
  await destinationPage.goto(origins[1]);
  const destination = await destinationPage.evaluate(async ({ raw, schema }) => {
    const m = await import('/bundle.mjs');
    const api = m.make(schema === 23);
    await api.load();
    let puts = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { puts++; return put.apply(this, args); };
    const dbBefore = (await indexedDB.databases()).length;
    const preview = await api.prepareRestore(raw);
    const previewPuts = puts;
    await api.save(preview, true, preview.adoptionSha256);
    const saved = await m.store.read();
    const fresh = m.make(schema === 23);
    await fresh.load();
    const output = await fresh.createBackup();
    return { dbBefore, previewPuts, puts, saved, outputState: JSON.parse(output).state,
      outputIds: JSON.parse(output).reservedIds,
      localPrimary: localStorage.getItem('hosei-planner:v1') };
  }, { raw: source.raw, schema });
  assert.equal(destination.dbBefore, 0);
  assert.equal(destination.previewPuts, 0);
  assert.equal(destination.puts, 1);
  assert.equal(destination.localPrimary, null);
  assert.equal(destination.saved.raw, source.before.raw);
  assert.deepEqual(new Set(destination.saved.issuedIds), new Set(source.before.issuedIds));
  assert.deepEqual(new Set(destination.outputIds), new Set(source.outputIds));
  assert.deepEqual(destination.outputState, source.outputState);
  if (schema === 23) assert.equal(destination.outputState.source.raw, primary);
  console.log(JSON.stringify({ kind: 'r7-cross-origin', schema, sourceRevision: source.saved.revision,
    destinationRevision: destination.saved.revision, commands: source.outputState.history.commands.length,
    ids: source.before.issuedIds.length, rawEqual: true, previewPuts: 0, sourcePuts: source.puts, destinationPuts: destination.puts }));
});
