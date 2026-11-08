import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { files, initialState } from './fixtures/migration-fixture.mjs';

const { chromium } = await import(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
const primary = JSON.stringify(initialState());
let browser;
const servers = [];
const origins = [];

before(async () => {
  const output = await build({ stdin: { resolveDir: new URL('../', import.meta.url).pathname, contents: `
    import { createPlannerAttemptSession } from './src/planner/attempts/production/session';
    import { createAuthorityIndexedDbStore } from './src/planner/attempts/persistence/authorityIndexedDb';
    import { readLegacySnapshot } from './src/planner/attempts/production/authorityAdmission';
    import { prepareMigrationEnvironment } from './src/planner/attempts/migration/source';
    export const store = createAuthorityIndexedDbStore(indexedDB);
    export const make = (legacy = false) => createPlannerAttemptSession(store, navigator.locks,
      legacy ? { readLegacy: () => readLegacySnapshot(localStorage),
        migrationEnvironment: () => prepareMigrationEnvironment(${JSON.stringify(files)}),
        protectAuthority: () => store.protectOriginal() } : undefined);
  ` }, bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
  for (let i = 0; i < 2; i++) {
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', request.url === '/bundle.mjs' ? 'text/javascript' : 'text/html');
      response.end(request.url === '/bundle.mjs' ? output.outputFiles[0].text : '<title>F01 R8 reservation order</title>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    origins.push(`http://127.0.0.1:${server.address().port}`);
  }
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

for (const schema of [23, 24]) for (const commandCount of [0, 1, 16]) {
  test(`R8 schema${schema} ${commandCount} commands retain ordered reservations across origins`, { timeout: 300000 }, async t => {
    const sourceContext = await browser.newContext();
    const destinationContext = await browser.newContext();
    t.after(async () => { await sourceContext.close(); await destinationContext.close(); });
    const sourcePage = await sourceContext.newPage();
    await sourcePage.goto(origins[0]);
    const source = await sourcePage.evaluate(async ({ schema, commandCount, primary }) => {
      const { store, make } = await import('/bundle.mjs');
      if (schema === 23) localStorage.setItem('hosei-planner:v1', primary);
      const api = make(schema === 23);
      await api.load();
      await api.save(schema === 23 ? await api.prepareMigration(primary) : await api.prepareSave(), true);
      if (commandCount) {
        api.add('hosei:cp:b99c65d5-5917-422d-bda4-75a4f99ad8b7', JSON.stringify({ plannedYear: 2038, method: 'correspondence', status: 'planned' }));
        const id = api.graph().attempts.at(-1).id;
        for (let i = 1; i < commandCount; i++) api.recordContribution(id, JSON.stringify({ value: i % 4 }));
        await api.save(await api.prepareSave(), true);
      }
      const backup = await api.createBackup();
      return { backup, authority: await store.read(), primary: localStorage.getItem('hosei-planner:v1') };
    }, { schema, commandCount, primary });
    assert.equal(source.primary, schema === 23 ? primary : null);
    const body = JSON.parse(source.backup);
    assert.equal(body.state.history.commands.length, commandCount);
    assert.deepEqual(body.reservedIds, source.authority.issuedIds);

    const destinationPage = await destinationContext.newPage();
    await destinationPage.goto(origins[1]);
    const destination = await destinationPage.evaluate(async ({ schema, backup }) => {
      const { store, make } = await import('/bundle.mjs');
      const api = make(schema === 23);
      await api.load();
      const dbBefore = (await indexedDB.databases()).length;
      let puts = 0;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { puts++; return put.apply(this, args); };
      const preview = await api.prepareRestore(backup);
      const previewPuts = puts;
      await api.save(preview, true, preview.adoptionSha256);
      const authority = await store.read();
      const fresh = make(schema === 23);
      await fresh.load();
      const repeated = await fresh.createBackup();
      return { dbBefore, previewPuts, puts, authority, repeated: JSON.parse(repeated),
        primary: localStorage.getItem('hosei-planner:v1') };
    }, { schema, backup: source.backup });
    assert.equal(destination.dbBefore, 0);
    assert.equal(destination.previewPuts, 0);
    assert.equal(destination.puts, 1);
    assert.equal(destination.primary, null);
    assert.equal(destination.authority.raw, source.authority.raw);
    assert.deepEqual(destination.repeated.state, body.state);
    if (schema === 23) assert.equal(destination.repeated.state.source.raw, primary);
    assert.deepEqual(destination.authority.issuedIds, source.authority.issuedIds);
    assert.deepEqual(destination.repeated.reservedIds, body.reservedIds);
  });
}
