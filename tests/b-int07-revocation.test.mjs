import assert from 'node:assert/strict';
import test from 'node:test';
import { createAcController } from '../src/planner/attempts/production/acController.ts';
import { createPlannerAttemptSession } from '../src/planner/attempts/production/session.ts';
import { emptyAuthority } from '../src/planner/attempts/persistence/contracts.ts';
import { env } from './fixtures/migration-fixture.mjs';

function barrier() {
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  return { entered: entered.promise, release: resume.resolve, async wait() {
    entered.resolve();
    await resume.promise;
  } };
}

function device() {
  let authority = emptyAuthority();
  let writes = 0;
  let failReads = false;
  const pauses = new Map();
  async function pauseAt(point) {
    const gate = pauses.get(point);
    if (gate) {
      pauses.delete(point);
      await gate.wait();
    }
  }
  const store = {
    async read() {
      if (failReads) throw new Error('synthetic saved-inventory read failure');
      return structuredClone(authority);
    },
    async commit(expected, next, beforePut) {
      await pauseAt('beforePut');
      assert.deepEqual(authority, expected);
      beforePut();
      authority = structuredClone(next);
      writes++;
      await pauseAt('afterCommit');
    },
  };
  const locks = { async request(_name, _options, run) { await pauseAt('lock'); return run(); } };
  const session = createPlannerAttemptSession(store, locks, {
    readLegacy: () => ({ primaryRaw: null, recoveryRaw: null }),
    migrationEnvironment: async () => env,
  });
  return { session, controller: createAcController(session),
    pause(point) { const gate = barrier(); pauses.set(point, gate); return gate; },
    failReads(value) { failReads = value; },
    snapshot: () => structuredClone(authority), writes: () => writes };
}

async function setup() {
  const host = device(), { controller } = host;
  assert.equal(await controller.load(), true);
  assert.equal(await controller.prepare(), true);
  assert.equal(await controller.save(controller.getSnapshot().proposal, true), true);
  assert.equal(host.writes(), 1);
  assert.equal(controller.getSnapshot().saved.status, 'pinned');
  return host;
}

const placement = 'hosei:cp:13f6e301-6356-4670-a2cc-e285d49d343e';
async function stage(controller, year) {
  assert.equal(controller.add(placement, JSON.stringify({ plannedYear: year, method: 'media', status: 'planned' })), true);
  assert.equal(await controller.prepare(), true);
  return controller.getSnapshot().proposal;
}

for (const point of ['lock', 'beforePut']) {
  test('revocation at ' + point + ' stops the accepted save without a put or draft loss', async () => {
    const host = await setup();
    const { controller, session } = host;
    const before = host.snapshot();
    const past = controller.getSnapshot().saved.past;
    const proposal = await stage(controller, 2039);
    const draft = controller.getSnapshot().graph;
    const gate = host.pause(point);
    const saving = controller.save(proposal, true);
    await gate.entered;
    try {
      controller.invalidateSaved();
      assert.equal(controller.getSnapshot().ready, false);
      assert.equal(await controller.load(), false);
    } finally {
      gate.release();
    }
    assert.equal(await saving, false);
    assert.equal(host.writes(), 1);
    assert.deepEqual(host.snapshot(), before);
    const held = controller.getSnapshot();
    assert.equal(held.graph, draft);
    assert.equal(held.dirty, true);
    assert.equal(session.view().unsavedCommandCount, 1);
    assert.equal(held.ready, false);
    assert.equal(held.saved.status, 'hold');
    assert.equal(held.saved.past, past);
    assert.match(held.error, /stale_save_revoked/);
    assert.equal(await controller.save(proposal, true), false);
    assert.equal(await controller.load(), true);
    assert.equal(controller.getSnapshot().graph.attempts.length, 0);
    const next = await stage(controller, 2040);
    assert.notEqual(next.graph.attempts[0].id, draft.attempts[0].id);
    assert.equal(await controller.save(next, true), true);
    assert.ok(host.snapshot().issuedIds.includes(draft.attempts[0].id));
    assert.equal(host.writes(), 2);
    console.log('prewrite', JSON.stringify({ point, additionalWrites: 0, returned: false, draftRetained: true }));
  });
}

test('an accepted save keeps its ordering over a reload attempted during the lock wait', async () => {
  const host = await setup(), { controller, session } = host;
  const proposal = await stage(controller, 2041);
  const gate = host.pause('lock');
  const saving = controller.save(proposal, true);
  await gate.entered;
  try {
    assert.equal(await controller.load(), false);
    await assert.rejects(session.load(), /operation_pending/);
    assert.equal(host.writes(), 1);
  } finally {
    gate.release();
  }
  assert.equal(await saving, true);
  assert.equal(host.writes(), 2);
  assert.equal(await controller.load(), true);
  assert.equal(controller.getSnapshot().graph.attempts[0].plan.plannedYear, 2041);
  assert.equal(controller.getSnapshot().saved.status, 'pinned');
});

test('a notification after the durable write leaves the successful commit and withholds current display', async () => {
  const host = await setup(), { controller } = host;
  const past = controller.getSnapshot().saved.past;
  const proposal = await stage(controller, 2042);
  const gate = host.pause('afterCommit');
  const saving = controller.save(proposal, true);
  await gate.entered;
  const committed = host.snapshot();
  try {
    assert.equal(host.writes(), 2);
    controller.invalidateSaved();
  } finally {
    gate.release();
  }
  assert.equal(await saving, true);
  assert.deepEqual(host.snapshot(), committed);
  const held = controller.getSnapshot();
  assert.equal(held.ready, false);
  assert.equal(held.saved.status, 'hold');
  assert.equal(held.saved.past, past);
  assert.equal(held.dirty, false);
  assert.match(held.notice, /保存済み.*再照合/);
  assert.equal(await controller.load(), true);
  assert.equal(controller.getSnapshot().graph.attempts[0].plan.plannedYear, 2042);
  console.log('postcommit', JSON.stringify({ additionalWrites: 1, returned: true, display: 'hold' }));
});

test('verification only succeeds with a current pin, including I/O failure and a late notification', async () => {
  const host = await setup(), { controller, session } = host;
  const original = session.readSavedInventory;
  const before = host.snapshot();
  assert.equal(await controller.verifySaved(), true);
  const past = controller.getSnapshot().saved.past;
  host.failReads(true);
  assert.equal(await controller.verifySaved(), false);
  assert.equal(controller.getSnapshot().saved.status, 'hold');
  assert.equal(controller.getSnapshot().saved.past, past);
  assert.equal(controller.getSnapshot().ready, false);
  host.failReads(false);
  assert.equal(await controller.load(), true);
  const recovered = controller.getSnapshot().saved.past;
  const gate = barrier();
  session.readSavedInventory = async () => {
    const next = await original();
    await gate.wait();
    return next;
  };
  const verifying = controller.verifySaved();
  await gate.entered;
  controller.invalidateSaved();
  gate.release();
  assert.equal(await verifying, false);
  assert.equal(controller.getSnapshot().saved.past, recovered);
  assert.equal(controller.getSnapshot().saved.status, 'hold');
  assert.deepEqual(host.snapshot(), before);
});

test('a successful F01 save remains successful when the later display read has an I/O failure', async () => {
  const host = await setup(), { controller, session } = host;
  const past = controller.getSnapshot().saved.past;
  const proposal = await stage(controller, 2043);
  const original = session.readSavedInventory;
  session.readSavedInventory = async () => {
    host.failReads(true);
    try { return await original(); } finally { host.failReads(false); }
  };
  assert.equal(await controller.save(proposal, true), true);
  assert.equal(host.writes(), 2);
  const state = controller.getSnapshot();
  assert.equal(state.dirty, false);
  assert.equal(state.ready, false);
  assert.equal(state.saved.status, 'hold');
  assert.equal(state.saved.past, past);
  assert.match(state.notice, /保存済み.*再照合/);
  assert.equal(JSON.parse(host.snapshot().raw).graph.attempts[0].plan.plannedYear, 2043);
  session.readSavedInventory = original;
  assert.equal(await controller.load(), true);
  assert.equal(await controller.verifySaved(), true);
  assert.equal(host.writes(), 2);
});
