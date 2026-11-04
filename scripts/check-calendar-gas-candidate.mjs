// Regeneration is local-only. Ensure audited assembled GAS matches source modules.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const paths = ['GAS1.current-candidate.gs', 'GAS2.current-candidate.gs'].map(name => `dev/calendar-approval-gas/candidate/${name}`);
const before = await Promise.all(paths.map(path => readFile(path)));
execFileSync(process.execPath, ['dev/calendar-approval-gas/tools/build-candidate.cjs'], { stdio: 'inherit' });
for (const [index, path] of paths.entries()) assert.deepEqual(await readFile(path), before[index], `${path} is stale; rebuild and review`);
