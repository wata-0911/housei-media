/** Research-only differential: replay the audit corpus against the exact H21
 * base and this checkout, comparing complete facts/progress with deep equality.
 * Usage: node scripts/audit-h21-differential.mjs /absolute/scratch/directory
 * All generated files stay in that new scratch directory; no checkout changes.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const base = 'b747e47efdbcd9a499787a05de3a44557c263b82';
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = process.argv[2];
assert.ok(scratch && resolve(scratch) === scratch, 'Pass a new absolute scratch directory');
assert.equal(execFileSync('git', ['rev-parse', `${base}^{commit}`], { cwd: root, encoding: 'utf8' }).trim(), base);
mkdirSync(scratch); // Refuse to overwrite an existing run.
const baseDir = join(scratch, 'base'); mkdirSync(baseDir);
const archive = execFileSync('git', ['archive', base], { cwd: root, maxBuffer: 100 * 1024 * 1024 });
execFileSync('tar', ['-xf', '-', '-C', baseDir], { input: archive });
symlinkSync(join(root, 'node_modules'), join(baseDir, 'node_modules'), 'dir');
let source = readFileSync(join(root, 'tests/graduation-audit.test.mjs'), 'utf8');
source = source.replaceAll("'../", `'${root}`);
for (const name of ['calculateGraduationProgress', 'deriveOfficialGraduationFacts']) {
  source = source.replace(`import { ${name} }`, `import { ${name} as current_${name} }`);
}
const baseImport = name => pathToFileURL(join(baseDir, 'src/planner', `${name}.ts`)).href;
const wrappers = `
import { after } from 'node:test';
import { calculateGraduationProgress as baseProgress } from '${baseImport('graduationProgress')}';
import { deriveOfficialGraduationFacts as baseFacts } from '${baseImport('officialGraduationFacts')}';
const differentialCounts = { progress: 0, facts: 0 };
function compareH21(kind, current, baseline, args) {
  const copy = structuredClone(args), before = structuredClone(copy);
  deepFreeze(copy);
  const expected = baseline(...copy);
  assert.deepEqual(copy, before, kind + ': frozen base inputs changed');
  const currentArgs = structuredClone(args); deepFreeze(currentArgs);
  const actual = current(...currentArgs);
  assert.deepEqual(currentArgs, before, kind + ': frozen current inputs changed');
  assert.deepEqual(actual, expected, kind + ': unexplained output differential');
  differentialCounts[kind]++;
  return actual;
}
const calculateGraduationProgress = (...args) => compareH21('progress', current_calculateGraduationProgress, baseProgress, args);
const deriveOfficialGraduationFacts = (...args) => compareH21('facts', current_deriveOfficialGraduationFacts, baseFacts, args);
after(() => console.log('H21_DIFFERENTIAL ' + JSON.stringify({ base: '${base}', ...differentialCounts })));
`;
// Imports may appear after declarations, but wrappers must initialize before tests.
const harness = join(baseDir, 'tests/h21-differential.test.mjs');
writeFileSync(harness, wrappers + source);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', harness], { cwd: root, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
writeFileSync(join(scratch, 'results.log'), (result.stdout ?? '') + (result.stderr ?? ''));
console.log((result.stdout ?? '').split('\n').filter(line => /^(H21_DIFFERENTIAL|ℹ (tests|pass|fail|skipped|duration_ms))/.test(line)).join('\n'));
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
