import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const project = dirname(dirname(import.meta.dirname));
const materializer = fileURLToPath(new URL('./materialize.mjs', import.meta.url));
const wrapper = fileURLToPath(new URL('./build.mjs', import.meta.url));

test('fixed source inputs are checked before installation or build', { timeout: 60000 }, t => {
  const scratch = mkdtempSync(join(dirname(project), '.b74-boundary-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const root = join(scratch, 'b70'), old = join(scratch, 'b59');
  const exec = (file, ...args) => spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' });
  const materialize = (...args) => {
    const result = exec(materializer, ...args);
    assert.equal(result.status, 0, result.stderr);
  };
  const reject = (label, expected, mode, input, output) => {
    const result = exec(wrapper, mode, input, output);
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, expected, label);
    console.log(label + ' exit=' + result.status);
  };

  materialize('b70', root);
  materialize('b59', old, root);
  reject('wrong-root', /B root must be disjoint/, 'install', project, 'b70');
  reject('wrong-tree', /source tree mismatch/, 'install', old, 'b70');
  const hidden = join(root, '.env.local');
  writeFileSync(hidden, '# synthetic extra input\n');
  reject('extra-ignored-file', /unexpected source input: \.env\.local/, 'install', root, 'b70');
  unlinkSync(hidden);
  const readme = join(root, 'README.md'), content = readFileSync(readme);
  appendFileSync(readme, '\nSynthetic test note\n');
  reject('changed-tracked-file', /source blob mismatch/, 'install', root, 'b70');
  writeFileSync(readme, content);
  chmodSync(readme, 0o700);
  reject('wrong-file-mode', /unexpected source file mode/, 'install', root, 'b70');
  chmodSync(readme, 0o600);
  unlinkSync(readme);
  reject('missing-tracked-file', /tracked source missing/, 'install', root, 'b70');
  writeFileSync(readme, content);
  mkdirSync(join(root, 'node_modules'));
  reject('pre-existing-dependencies', /install requires a new B root/, 'install', root, 'b70');
  const missing = join(scratch, 'unexpected-dist');
  reject('unsealed-dependencies', /planner-b-install.json/, 'split', root, missing);
  assert.equal(existsSync(missing), false);
  assert.equal(existsSync(join(root, '.git/planner-b-install.json')), false);
});
