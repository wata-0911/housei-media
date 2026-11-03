import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { build } from 'esbuild';
import * as leaf from '../../src/planner/digest.ts';
import * as backup from '../../src/planner/backup/plannerBackupCompatibility.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');

test('digest leafは3つの関数定義のみでimport・top-level初期化を持たない', () => {
  const text = readFileSync(new URL('../../src/planner/digest.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('digest.ts', text, ts.ScriptTarget.Latest, true);
  assert.ok(ast.statements.every(ts.isFunctionDeclaration));
  assert.deepEqual(ast.statements.map(s => s.name.text), ['canonicalBackupJson', 'backupDigest', 'backupRawDigest']);
  assert.deepEqual(Object.keys(leaf).sort(), ['backupDigest', 'backupRawDigest', 'canonicalBackupJson']);
});
test('旧backupの3公開APIは同じleaf関数をre-exportし、identityも維持する', () => {
  for (const name of Object.keys(leaf)) assert.equal(backup[name], leaf[name]);
});
test('canonicalのkey順・Unicode・配列順・null/0/省略および旧非JSON値の挙動を維持', () => {
  const input = JSON.parse('{"z":[null,0,"é"],"10":"ten","2":"two","__proto__":{"z":2,"a":1}}');
  assert.equal(leaf.canonicalBackupJson(input), '{"10":"ten","2":"two","__proto__":{"a":1,"z":2},"z":[null,0,"é"]}');
  assert.equal(leaf.canonicalBackupJson({ omitted: undefined, zero: -0, nan: NaN }), '{"nan":null,"omitted":undefined,"zero":0}');
  assert.equal(leaf.canonicalBackupJson([, undefined, null]), '[,,null]');
  assert.equal(leaf.canonicalBackupJson(undefined), undefined);
  assert.equal(leaf.canonicalBackupJson(new Date('2026-11-03')), '{}');
  assert.equal({}.polluted, undefined);
});
test('canonical SHAとraw SHAは旧byte境界のまま（Unicode/CRLF/空白を正規化しない）', async () => {
  assert.equal(await leaf.backupDigest({ b: [null, 0], a: 4 }), hash('{"a":4,"b":[null,0]}'));
  for (const raw of ['', 'é\r\n原文 ', '\ud800', '\\ud800', ' {"x":0} ']) assert.equal(await leaf.backupRawDigest(raw), hash(raw));
  assert.notEqual(await leaf.backupRawDigest('é'), await leaf.backupRawDigest('e\u0301'));
});
test('旧TypeError/RangeErrorとgetter例外を拒否理由の再分類なしで伝播する', async () => {
  assert.throws(() => leaf.canonicalBackupJson(1n), TypeError);
  await assert.rejects(leaf.backupDigest(1n), TypeError);
  await assert.rejects(leaf.backupRawDigest(Symbol('raw')), TypeError);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => leaf.canonicalBackupJson(cycle), RangeError);
  const sentinel = new Error('getter sentinel');
  const value = { get x() { throw sentinel; } };
  assert.throws(() => leaf.canonicalBackupJson(value), e => e === sentinel);
  await assert.rejects(backup.backupDigest(value), e => e === sentinel);
});
test('crypto providerの例外を旧API/leaf双方でそのまま返す', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'crypto'), sentinel = new Error('crypto sentinel');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { digest: async () => { throw sentinel; } } } });
  try {
    for (const api of [leaf, backup]) {
      assert.equal(api.canonicalBackupJson(null), 'null');
      await assert.rejects(api.backupDigest({ a: 1 }), e => e === sentinel);
      await assert.rejects(api.backupRawDigest('raw'), e => e === sentinel);
    }
  } finally { if (old) Object.defineProperty(globalThis, 'crypto', old); else delete globalThis.crypto; }
});
test('browser/node ESMのleafは依存なし・コード生成禁止下でcold importとdigestの全値が一致', async () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'planner-digest-leaf-'));
  try {
    const values = [];
    for (const platform of ['browser', 'node']) {
      const b = await build({ absWorkingDir: root, entryPoints: ['src/planner/digest.ts'], platform, format: 'esm', bundle: true, metafile: true, write: false });
      assert.deepEqual(Object.keys(b.metafile.inputs), ['src/planner/digest.ts']);
      const entry = resolve(temp, platform + '.mjs'); writeFileSync(entry, b.outputFiles[0].contents);
      const code = `const m=await import(${JSON.stringify(pathToFileURL(entry).href)});console.log(JSON.stringify([m.canonicalBackupJson({b:[null,0],a:4}),await m.backupDigest({b:[null,0],a:4}),await m.backupRawDigest('é\\r\\n')]));`;
      values.push(execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', code], { encoding: 'utf8' }));
    }
    assert.equal(values[0], values[1]);
    assert.deepEqual(JSON.parse(values[0]), ['{"a":4,"b":[null,0]}', hash('{"a":4,"b":[null,0]}'), hash('é\r\n')]);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
