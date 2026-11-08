import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptFixture, operationId } from './fixtures/attempt-fixture.mjs';
import { applyCommand, createWorkspace } from '../src/planner/attempts/workbench/operations.ts';

function countSearch(method, pattern, run) {
  const original = Array.prototype[method];
  let comparisons = 0;
  Array.prototype[method] = function (predicate, ...args) {
    if (pattern.test(predicate.toString())) return original.call(this, (...values) => {
      comparisons++;
      return predicate(...values);
    }, ...args);
    return original.call(this, predicate, ...args);
  };
  try { return { value: run(), comparisons }; }
  finally { Array.prototype[method] = original; }
}

test('R7 canonical receipt lookup extends linearly and keeps old branches independent', () => {
  const { graph, context } = attemptFixture();
  let workspace = createWorkspace(graph, context);
  const first = workspace, commands = [];
  const measured = countSearch('find', /r\.operationId\s*===\s*command\.operationId/, () => {
    for (let i = 0; i < 32; i++) {
      const command = { kind: 'edit', operationId: operationId(10000 + i), attemptId: graph.attempts[0].id,
        changes: { plan: { ...workspace.graph.attempts[0].plan, plannedYear: 2040 + i } } };
      commands.push(command);
      workspace = applyCommand(workspace, command, context);
    }
    return workspace;
  });
  assert.equal(measured.comparisons, 0);
  assert.equal(workspace.receipts.length, 32);
  assert.strictEqual(applyCommand(workspace, commands[0], context), workspace);
  assert.throws(() => applyCommand(workspace, { ...commands[0], changes: {} }, context), /operation_replay_conflict/);

  const oldBranch = applyCommand(first, commands[31], context);
  assert.equal(oldBranch.receipts.length, 1);
  assert.equal(oldBranch.graph.attempts[0].plan.plannedYear, 2071);
  assert.strictEqual(applyCommand(oldBranch, commands[31], context), oldBranch);
  assert.equal(workspace.receipts.length, 32);
  assert.equal(workspace.graph.attempts[0].plan.plannedYear, 2071);
  const generic = { ...workspace, receipts: new Proxy(workspace.receipts, {}) };
  assert.ok(countSearch('find', /r\.operationId\s*===\s*command\.operationId/,
    () => applyCommand(generic, commands[0], context)).comparisons > 0);
});

test('R7 canonical progress preserves reordered rows and rejects a missing row', () => {
  const { graph, context } = attemptFixture();
  const record = graph.ownedRecords[2];
  record.payload.requiredReports = 256;
  record.payload.reports = Array.from({ length: 256 }, (_, i) => ({ reportNumber: i + 1, status: 'passed', grade: 'A' }));
  const workspace = createWorkspace(graph, context);
  const payload = { ...record.payload, reports: [...record.payload.reports].reverse() };
  const command = { kind: 'edit_payload', operationId: operationId(12000), recordId: record.id, payload };
  const measured = countSearch('some', /n\.reportNumber\s*===\s*\w+\.reportNumber/,
    () => applyCommand(workspace, command, context));
  assert.equal(measured.comparisons, 0);
  assert.deepEqual(measured.value.graph.ownedRecords[2].payload.reports, payload.reports);
  assert.equal(measured.value.graph.ownedRecords[2].payload.examGrade, 'D');
  const missing = structuredClone(payload);
  missing.reports[0].reportNumber = 257;
  assert.throws(() => applyCommand(workspace, { ...command, operationId: operationId(12001), payload: missing }, context), /progress_row_lost/);
  const duplicate = structuredClone(payload);
  duplicate.reports[0].reportNumber = duplicate.reports[1].reportNumber;
  assert.throws(() => applyCommand(workspace, { ...command, operationId: operationId(12003), payload: duplicate }, context));
  const extra = structuredClone(payload);
  extra.reports.note = 'not a JSON array';
  assert.throws(() => applyCommand(workspace, { ...command, operationId: operationId(12004), payload: extra }, context));
  const sparse = structuredClone(payload);
  delete sparse.reports[0];
  assert.throws(() => applyCommand(workspace, { ...command, operationId: operationId(12005), payload: sparse }, context));
  assert.deepEqual(workspace.graph.ownedRecords[2].payload.reports, record.payload.reports);
  const generic = { ...workspace, receipts: new Proxy(workspace.receipts, {}) };
  assert.ok(countSearch('some', /n\.reportNumber\s*===\s*\w+\.reportNumber/,
    () => applyCommand(generic, { ...command, operationId: operationId(12002) }, context)).comparisons > 0);
});

test('R7 media lesson and assessment identifiers remain mandatory', () => {
  const { graph, context } = attemptFixture();
  const record = graph.ownedRecords[0];
  const workspace = createWorkspace(graph, context);
  const payload = structuredClone(record.payload);
  payload.lessons[0].testCompleted = true;
  const edited = applyCommand(workspace, { kind: 'edit_payload', operationId: operationId(13000), recordId: record.id, payload }, context);
  assert.deepEqual(edited.graph.ownedRecords[0].payload, payload);
  for (const [operation, patch] of [
    [13001, { lessons: [] }],
    [13002, { assessments: [] }],
  ]) assert.throws(() => applyCommand(workspace, { kind: 'edit_payload', operationId: operationId(operation), recordId: record.id,
    payload: { ...payload, ...patch } }, context), /progress_row_lost/);
  assert.deepEqual(workspace.graph.ownedRecords[0].payload, record.payload);
});
