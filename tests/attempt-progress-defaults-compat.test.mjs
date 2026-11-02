import test from 'node:test';
import assert from 'node:assert/strict';
import { replayFixture } from './fixtures/replay-state-fixture.mjs';
import { replayState } from '../src/planner/attempts/persistence/codec.ts';

// Exercise the remaining legacy helper caller, including all three progress
// constructors, without regenerating or changing any frozen fixture bytes.
for (const schema of [23, 24]) {
  test(`schema${schema}: heavy replay fixture supplies identities for every progress kind`, async () => {
    const fixture = await replayFixture(schema, 'heavy', 5);
    const replay = await replayState(JSON.parse(fixture.raw));
    assert.deepEqual(replay.state, fixture.state);
    assert.deepEqual(replay.workspace, fixture.workspace);
    const added = fixture.workspace.receipts.filter(c => c.kind === 'add_record').map(c => c.record);
    assert.deepEqual(added.map(r => r.kind), ['media', 'correspondence', 'evaluation']);
    assert.equal(new Set(added.map(r => r.id)).size, 3);
    for (const record of added) {
      assert.match(record.id, /^hosei:owned:[0-9a-f-]{36}$/);
      assert.deepEqual(record.owner, { kind: 'attempt', attemptId: fixture.workspace.graph.attempts.at(-1).id });
    }
  });
}
