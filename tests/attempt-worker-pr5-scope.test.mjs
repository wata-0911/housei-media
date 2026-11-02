import test from 'node:test';import assert from 'node:assert/strict';
import {checkRows,checkModes,allowed} from '../scripts/verify-readonly-worker-pr5-scope.mjs';
test('PR5 scope rejects forbidden additions/deletions/renames/type changes and each layer',()=>{
 for(const local of [false,true])for(const row of [['M','src/main.tsx'],['A','src/planner/attempts/persistence/worker/writer.ts'],['D','src/planner/attempts/persistence/worker/session.ts'],['T','src/planner/attempts/persistence/worker/session.ts'],['R100','src/planner/attempts/persistence/worker/session.ts','other.ts']])assert.throws(()=>checkRows([row],local),/scope_change/);
 for(const summary of [' mode change 100644 => 100755 src/planner/attempts/persistence/worker/session.ts\n',' create mode 120000 tests/attempt-worker-versioned.test.mjs\n',' create mode 100755 scripts/verify-readonly-worker-pr5-scope.mjs\n',' create mode 100644 other.txt\n'])assert.throws(()=>checkModes(summary),/scope_mode/);checkModes(' create mode 100644 tests/attempt-worker-versioned.test.mjs\n');
 for(const [path,status]of allowed){checkRows([[status,path]]);checkRows([['M',path]],true);}
});
