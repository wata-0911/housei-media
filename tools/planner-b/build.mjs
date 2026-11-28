import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync,
  renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, dirname, join, resolve, sep } from 'node:path';
import { gitEnvironment, pins, readPinnedAssets, sha256, verifySource } from './materialize.mjs';

const args = process.argv.slice(2);
const edition = ['b76', 'b78', 'b-native'].includes(args.at(-1)) ? args.pop() : null;
const [mode, rootArg, output, evidencePath] = args;
const buildModes = ['split', 'cold', 'history', 'history-cold'];
assert(['install', 'normal', 'quality', 'browser', 'verify-browser', ...buildModes].includes(mode), 'unknown B build/test mode');
const pinnedBrowser = edition === 'b78' || edition === 'b-native';
const nativeBrowser = edition === 'b-native';
const expectedArgs = mode === 'install' ? (edition ? [2] : [2, 3])
  : mode === 'browser' ? [nativeBrowser ? 9 : pinnedBrowser ? 8 : 4]
  : mode === 'verify-browser' ? [nativeBrowser ? 7 : 6]
  : buildModes.includes(mode) ? [3] : [2];
assert(expectedArgs.includes(args.length), 'unexpected variant or build arguments');
assert(mode !== 'verify-browser' || pinnedBrowser, 'explicit pinned browser variant required');
assert(mode !== 'install' || !output || output === 'b59' || output === 'b70', 'unknown install variant');
const historical = mode.startsWith('history') || (mode === 'install' && output === 'b59');
assert(!edition || !historical, 'unexpected variant for historical build');
const variant = edition ?? (historical ? 'b59' : 'b70');
const aRoot = realpathSync(resolve(import.meta.dirname, '../..'));
const inside = (child, parent) => child === parent || child.startsWith(parent + sep);

function checkedSource(root, version) {
  assert(root && isAbsolute(root) && realpathSync(root) === root, 'absolute physical B root required');
  assert(!inside(root, aRoot) && !inside(aRoot, root), 'B root must be disjoint from A root');
  verifySource(root, version);
}

const root = rootArg;
checkedSource(root, variant);
const nodeDirectory = dirname(realpathSync(process.execPath));
const modules = join(root, 'node_modules');
const receiptPath = join(root, '.git/planner-b-install.json');

function installedModulesInventory(source = root, version = variant) {
  const modules = join(source, 'node_modules');
  const top = lstatSync(modules);
  assert(top.isDirectory() && realpathSync(modules) === modules && top.uid === process.getuid(),
    'independent B node_modules required');
  const digest = createHash('sha256');
  function walk(rel) {
    for (const name of readdirSync(join(modules, rel)).sort()) {
      const path = join(rel, name), full = join(modules, path), stat = lstatSync(full);
      if (stat.isDirectory()) {
        digest.update(JSON.stringify([path, 'directory', stat.mode]) + '\n');
        walk(path);
      } else if (stat.isSymbolicLink()) {
        assert(inside(realpathSync(full), modules), 'unexpected package symlink destination: ' + path);
        digest.update(JSON.stringify([path, 'symlink', readlinkSync(full)]) + '\n');
      } else {
        assert(stat.isFile(), 'unexpected package entry: ' + path);
        digest.update(JSON.stringify([path, 'file', stat.mode, stat.size, sha256(readFileSync(full))]) + '\n');
      }
    }
  }
  walk('');
  return {
    root: source, variant: version, node: process.version, lock: pins.lockSha256,
    rootDevice: top.dev, modulesInode: top.ino, contents: digest.digest('hex'),
  };
}

function newLocation(path) {
  assert(path && isAbsolute(path) && resolve(path) === path && !existsSync(path), 'new absolute output required');
  assert(realpathSync(dirname(path)) === dirname(path), 'physical output parent required');
  assert([root, aRoot].every(source => !inside(path, source)), 'output must be outside both source roots');
  return path;
}

function verifyInstall(source, version) {
  const receipt = join(source, '.git/planner-b-install.json');
  assert(lstatSync(receipt).isFile(), 'B installation receipt required');
  assert.deepEqual(installedModulesInventory(source, version), JSON.parse(readFileSync(receipt, 'utf8')),
    'B installation mismatch');
}

function verifyBrowser(primary, cold, oldRoot, oldDist, baseline) {
  checkedSource(oldRoot, 'b59');
  const roots = [aRoot, root, oldRoot, primary, cold, oldDist];
  if (nativeBrowser) roots.push(baseline);
  assert(roots.every(path => isAbsolute(path) && realpathSync(path) === path)
    && roots.every((path, i) => roots.every((other, j) => i === j || !inside(path, other))),
  'browser source and dist roots must all be separate');
  verifyInstall(root, variant);
  verifyInstall(oldRoot, 'b59');
  const builds = nativeBrowser ? pins.bNativeBuilds : pins.b78Builds;
  const counts = [
    readPinnedAssets(primary, builds.split).size,
    readPinnedAssets(cold, builds.cold).size,
    readPinnedAssets(oldDist, pins.otherBuilds.history).size,
  ];
  if (nativeBrowser) counts.push(readPinnedAssets(baseline, pins.b78Builds.split).size);
  console.log('Pinned browser source / dependency seals and primary/cold/history assets: ' + counts.join('/'));
}

const runtime = mkdtempSync(join(dirname(root), '.planner-b-runtime-'));
try {
  const environment = {
    ...gitEnvironment, PATH: nodeDirectory + ':' + gitEnvironment.PATH,
    TMPDIR: runtime, NPM_CONFIG_USERCONFIG: join(runtime, 'npm-user.conf'), NPM_CONFIG_GLOBALCONFIG: join(runtime, 'npm-global.conf'),
    NPM_CONFIG_CACHE: join(runtime, 'npm-cache'),
  };
  function run(executable, args, extra = {}) {
    const result = spawnSync(executable, args, { cwd: root, env: { ...environment, ...extra }, stdio: 'inherit' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, executable + ' exited ' + result.status);
  }
  if (mode === 'install') {
    assert(!existsSync(modules) && !existsSync(receiptPath), 'install requires a new B root');
    const network = Object.fromEntries([
      'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
      'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE',
    ].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    run('npm', ['ci', '--no-audit', '--no-fund'], network);
    verifySource(root, variant);
    writeFileSync(receiptPath, JSON.stringify(installedModulesInventory()), { flag: 'wx', mode: 0o600 });
    console.log('Recorded fixed-lock installation for ' + variant);
  } else {
    if (mode !== 'verify-browser') verifyInstall(root, variant);
    if (mode === 'verify-browser') {
      verifyBrowser(...args.slice(2));
    } else if (mode === 'quality') {
      run('npm', ['run', 'typecheck']);
      verifySource(root, variant);
      run('npm', ['run', 'lint']);
    } else if (mode === 'normal') {
      run('npm', ['run', 'test:planner']);
    } else if (mode === 'browser') {
      assert(output && isAbsolute(output) && realpathSync(output) === output && !inside(output, aRoot), 'separate physical Playwright package required');
      newLocation(evidencePath);
      const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
      assert(browsers && isAbsolute(browsers) && realpathSync(browsers) === browsers && !inside(browsers, aRoot), 'explicit separate browser installation required');
      const lockedInputs = args.slice(4);
      if (pinnedBrowser) verifyBrowser(...lockedInputs);
      const runnerArgs = pinnedBrowser ? [import.meta.filename, ...lockedInputs] : [];
      run('bash', ['scripts/test-split-planner-browser.sh', output, evidencePath, ...runnerArgs], { PLAYWRIGHT_BROWSERS_PATH: browsers });
    } else {
      newLocation(output);
      const temporary = mkdtempSync(join(dirname(output), '.planner-b-dist-'));
      try {
        const dist = join(temporary, 'dist');
        const port = mode === 'history-cold' ? '4180' : mode === 'cold' ? '4179' : '4178';
        run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'dev/ac/split/vite.config.mjs', '--configLoader', 'runner', '--outDir', dist],
          { PLANNER_LEGACY_LOOPBACK_PORT: '4177', PLANNER_B_LOOPBACK_PORT: port });
        const expected = nativeBrowser ? pins.bNativeBuilds[mode]
          : edition === 'b78' ? pins.b78Builds[mode]
          : edition === 'b76' ? pins.b76Builds[mode] : mode === 'split' ? pins.assets : pins.otherBuilds[mode];
        const fileCount = readPinnedAssets(dist, expected).size;
        newLocation(output);
        renameSync(dist, output);
        console.log(mode + ' assets byte-equal: ' + fileCount);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
} finally {
  rmSync(runtime, { recursive: true, force: true });
}
