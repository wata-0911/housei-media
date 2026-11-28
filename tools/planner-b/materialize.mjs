import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const pins = JSON.parse(readFileSync(new URL('./pins.json', import.meta.url)));
const source = realpathSync(resolve(import.meta.dirname, '../..'));

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const blobId = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
export const gitEnvironment = Object.freeze({
  PATH: '/usr/bin:/bin', LANG: 'C.UTF-8',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
});
function git(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    maxBuffer: 16 * 1024 * 1024, ...options, env: gitEnvironment,
  });
}
const gitText = (root, ...args) => git(root, args, { encoding: 'utf8' }).trim();

export function verifySource(root, variant) {
  const expected = pins[variant];
  assert(expected && ['b70', 'b76', 'b78', 'b-native', 'b59'].includes(variant), 'unknown B root');
  assert.equal(realpathSync(root), root, 'physical B root required');
  const dir = lstatSync(root);
  assert(dir.isDirectory() && dir.uid === process.getuid() && (dir.mode & 0o077) === 0, 'private B root required');
  const dotGit = join(root, '.git');
  assert(lstatSync(dotGit).isDirectory() && realpathSync(dotGit) === dotGit, 'dedicated Git directory required');
  for (const file of ['commondir', 'objects/info/alternates', 'info/attributes', 'info/grafts']) {
    assert(!readdirSync(dirname(join(dotGit, file))).includes(basename(file)), 'unexpected Git local input: ' + file);
  }
  const local = git(root, ['config', '--local', '--no-includes', '--null', '--list'], { encoding: 'utf8' })
    .split('\0').filter(Boolean).sort();
  assert.deepEqual(local, [
    'core.bare\nfalse', 'core.filemode\ntrue', 'core.logallrefupdates\ntrue', 'core.repositoryformatversion\n0',
  ], 'unexpected B Git configuration');
  assert.equal(gitText(root, 'rev-parse', '--show-toplevel'), root, 'unexpected B root');
  assert.equal(gitText(root, 'rev-parse', 'HEAD'), pins.base.commit, 'B base commit mismatch');
  assert.equal(gitText(root, 'write-tree'), expected.tree, 'B source tree mismatch');
  assert.equal(sha256(readFileSync(join(root, 'package-lock.json'))), pins.lockSha256, 'B lock mismatch');

  const files = new Map(), dirs = new Set(['']);
  const records = git(root, ['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.equal(records.length, expected.entries);
  for (const record of records) {
    const [meta, file] = record.split('\t');
    const [mode, blob, stage] = meta.split(' ');
    assert(mode === '100644' && stage === '0' && !isAbsolute(file)
      && !file.split('/').some(part => !part || part === '..' || part === '.'), 'unexpected source path or mode');
    files.set(file, blob);
    for (let path = dirname(file); path !== '.'; path = dirname(path)) dirs.add(path);
  }
  function walk(relative) {
    for (const name of readdirSync(join(root, relative))) {
      if (!relative && (name === '.git' || name === 'node_modules')) continue;
      const path = join(relative, name), absolute = join(root, path);
      const info = lstatSync(absolute);
      if (dirs.has(path)) {
        assert(info.isDirectory(), 'unexpected source directory: ' + path);
        walk(path);
      } else {
        assert(files.has(path), 'unexpected source input: ' + path);
        assert(info.isFile() && !(info.mode & 0o111), 'unexpected source file mode: ' + path);
        assert.equal(blobId(readFileSync(absolute)), files.get(path), 'source blob mismatch: ' + path);
        files.delete(path);
      }
    }
  }
  walk('');
  assert.equal(files.size, 0, 'tracked source missing');
}

// The gate uses the verified byte buffers themselves. The runner verifies the
// same full distribution before each suite, with its source and dependency seal.
export function readPinnedAssets(root, expected) {
  assert(expected && isAbsolute(root) && realpathSync(root) === root && lstatSync(root).isDirectory(),
    'physical pinned distribution required');
  const files = new Map();
  const parents = new Set(['']);
  for (const file of Object.keys(expected)) {
    for (let path = dirname(file); path !== '.'; path = dirname(path)) parents.add(path);
  }
  function walk(relative) {
    for (const name of readdirSync(join(root, relative))) {
      const path = join(relative, name), absolute = join(root, path);
      const info = lstatSync(absolute);
      if (parents.has(path)) {
        assert(info.isDirectory(), 'unexpected build directory: ' + path);
        walk(path);
        continue;
      }
      assert(Object.hasOwn(expected, path), 'build asset path mismatch: ' + path);
      assert(info.isFile() && realpathSync(absolute) === absolute, 'nonregular build asset: ' + path);
      const bytes = readFileSync(absolute);
      assert.deepEqual({ bytes: bytes.length, sha256: sha256(bytes) }, expected[path],
        'build asset mismatch: ' + path);
      files.set(path, bytes);
    }
  }
  walk('');
  assert.equal(files.size, Object.keys(expected).length, 'build asset path mismatch');
  return files;
}

function run(variant, destination, historyInput) {
  assert(['b70', 'b76', 'b78', 'b-native', 'b59'].includes(variant), 'usage: materialize.mjs b70|b76|b78|b-native|b59 ABSOLUTE_NEW_ROOT [B70_ROOT]');
  assert(destination && isAbsolute(destination) && resolve(destination) === destination, 'absolute canonical output required');
  assert.equal(gitText(source, 'rev-parse', '--show-toplevel'), source, 'unexpected source checkout');
  assert.equal(gitText(source, 'rev-parse', pins.main.commit + '^{tree}'), pins.main.tree, 'main pin mismatch');
  git(source, ['merge-base', '--is-ancestor', pins.main.commit, 'HEAD']);
  assert.equal(gitText(source, 'rev-parse', pins.base.commit + '^{tree}'), pins.base.tree, 'dev pin unavailable');
  const parent = realpathSync(dirname(destination));
  assert.equal(parent, dirname(destination), 'output parent must be physical');
  assert(parent !== source && !parent.startsWith(source + sep) && !existsSync(destination), 'output must be new and outside A root');

  let compressed;
  if (variant !== 'b59') {
    compressed = readFileSync(new URL('./' + variant + '.patch.gz', import.meta.url));
    assert.equal(compressed.length, pins[variant].gzipBytes, 'B gzip length mismatch');
    assert.equal(sha256(compressed), pins[variant].gzipSha256, 'B gzip digest mismatch');
  } else {
    assert(historyInput && isAbsolute(historyInput), 'verified B70 root required for B59');
    verifySource(historyInput, 'b70');
    compressed = git(historyInput, ['show', ':tests/fixtures/b59-recorded-history/CANDIDATE.patch.gz']);
  }
  const expected = pins[variant];
  const patch = gunzipSync(compressed, { maxOutputLength: expected.patchBytes });
  assert.equal(patch.length, expected.patchBytes, 'patch length mismatch');
  assert.equal(sha256(patch), expected.patchSha256, 'patch digest mismatch');

  const temporary = mkdtempSync(join(parent, '.planner-b-materialize-'));
  try {
    git(temporary, ['init', '--quiet']);
    git(temporary, ['fetch', '--quiet', '--no-tags', source, pins.base.commit]);
    git(temporary, ['-c', 'core.autocrlf=false', 'checkout', '--quiet', '--detach', pins.base.commit]);
    git(temporary, ['-c', 'core.autocrlf=false', 'apply', '--index', '-'], { input: patch });
    verifySource(temporary, variant);
    assert(!existsSync(destination), 'destination already exists');
    renameSync(temporary, join(parent, basename(destination)));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ variant, tree: expected.tree, entries: expected.entries, root: destination }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(...process.argv.slice(2));
}
