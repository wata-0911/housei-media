import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createGradeSourceArchive as create, decodeGradeSourceArchive as decode, SOURCE_LIMITS, SOURCE_FORMAT, SourceContractError } from '../../src/planner/attempts/gradeImport/sourceArchive.ts';

const numeric = value => ({ raw: value === null ? '' : String(value), value });
const slot = (year = '', credits = null) => ({ rawYear: year, rawTerm: '', rawDate: '', rawCredits: credits === null ? '' : String(credits), rawGrade: '', year: year || null, term: null, date: null, credits, grade: null });
const row = (name = '過年度科目', earned = 4, composition = 4) => ({
  rawName: name, categoryRaw: null, compositionCredits: numeric(composition), additionalEnrollment: numeric(null),
  recognizedExemption: numeric(0), earnedCredits: numeric(earned), schoolingCredits: numeric(2),
  reports: [0, 1, 2, 3].map(i => ({ raw: `原${i}`, status: 'unknown', date: null })),
  creditExam: { rawDate: '2012-03-01', rawCredits: '2', rawGrade: 'A', date: '2012-03-01', credits: 2, grade: 'A', pendingMarker: false },
  schoolings: [slot('2011', 2), slot('2025', 0)],
});
const input = (courses = [row()]) => ({ schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-11-03T00:00:00.000Z', courses });
const raw = courses => JSON.stringify(input(courses));
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
// Independent oracle: transform each object's sorted keys using the JSON replacer walk.
const canonical = value => JSON.stringify(value, (_key, v) => v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const code = expected => error => error instanceof SourceContractError && error.code === expected && error.message === expected;
const rejects = (promise, expected) => assert.rejects(promise, code(expected));
function frozen(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
async function roundtrip(archive) { assert.deepEqual(await decode(JSON.stringify(archive)), archive); }
async function rehash(body) { const { archiveSha256, ...rest } = body; return { ...rest, archiveSha256: hash(canonical(rest)) }; }

test('過年度の原文・全DTO・複数年度・capturedAt・内訳順を全値保持する', async () => {
  const source = ' \r\n' + JSON.stringify(input(), null, 2) + '\t\n';
  const a = await create(source);
  assert.equal(a.raw, source); assert.deepEqual(a.dto, input());
  assert.equal(a.rawUtf8Bytes, Buffer.byteLength(source)); assert.equal(a.rawSha256, hash(source));
  assert.equal(a.dtoSha256, hash(canonical(input())));
  const { archiveSha256, ...body } = a; assert.equal(archiveSha256, hash(canonical(body)));
  assert.equal(a.dto.courses[0].schoolings[0].year, '2011');
  frozen(a); await roundtrip(a);
});
test('Offering未照合・未知名称でも受付し、科目identity/年度/算入を発明しない', async () => {
  const a = await create(raw([row('旧カタログにも存在しない名称')]));
  assert.equal(a.dto.courses[0].rawName, '旧カタログにも存在しない名称');
  for (const key of ['identity', 'offeringId', 'academicYear', 'yearSource', 'canCommit', 'saveAuthority']) assert.equal(Object.hasOwn(a, key), false);
  await roundtrip(a);
});
test('同一内容の別行を二行のまま保持し、同じ参照にaliasしない', async () => {
  const r = row(); const a = await create(raw([r, r]));
  assert.equal(a.dto.courses.length, 2); assert.deepEqual(a.dto.courses[0], a.dto.courses[1]);
  assert.notEqual(a.dto.courses[0], a.dto.courses[1]); await roundtrip(a);
});
test('旧4単位と現2単位は別観測の数量のまま、単位を丸めない', async () => {
  const courses = [row('旧数学', 4, 4), row('数学３', 2, 2), row('旧数学', 2, 4)];
  const a = await create(raw(courses)); assert.deepEqual(a.dto.courses, courses);
  assert.deepEqual(a.dto.courses.map(x => x.earnedCredits.value), [4, 2, 2]); await roundtrip(a);
});
for (const value of [null, 0, 2, 4, 0.5]) test(`公式数量${value}を保持しfallbackしない`, async () => {
  const a = await create(raw([row('同名', value)]));
  assert.equal(a.dto.courses[0].earnedCredits.value, value);
  assert.equal(a.dto.courses[0].compositionCredits.value, 4); await roundtrip(a);
});
test('未知fieldは全階層でraw保持・DTO除外、__proto__も展開しない', async () => {
  const x = input(); x.privateMarker = 'PRIVATE_氏名学籍'; x.courses[0].offeringId = 'wrong';
  x.courses[0].earnedCredits.extra = 999; x.courses[0].reports[0].secret = 0;
  x.courses[0].schoolings[0].secret = null; x.courses[0].creditExam.secret = 'hidden';
  const source = JSON.stringify(x).replace('{', '{"__proto__":{"polluted":true},');
  const a = await create(source); assert.equal(a.raw, source); assert.deepEqual(a.dto, input());
  assert.equal({}.polluted, undefined); assert.equal(JSON.stringify(a.dto).includes('PRIVATE_'), false); await roundtrip(a);
});
test('未知の省略/null/0をrawとdigestで区別する。DTOへ勝手にfieldを追加しない', async () => {
  const cases = [input(), { ...input(), memo: null }, { ...input(), memo: 0 }];
  const a = await Promise.all(cases.map(x => create(JSON.stringify(x))));
  assert.equal(new Set(a.map(x => x.rawSha256)).size, 3);
  assert.equal(new Set(a.map(x => x.dtoSha256)).size, 1);
  assert.equal(Object.hasOwn(JSON.parse(a[0].raw), 'memo'), false);
  assert.equal(JSON.parse(a[1].raw).memo, null); assert.equal(JSON.parse(a[2].raw).memo, 0);
});
for (const key of ['earnedCredits', 'compositionCredits', 'schoolingCredits']) test(`必須${key}.value省略をnull/0へ補完しない`, async () => {
  const x = input(); delete x.courses[0][key].value;
  await rejects(create(JSON.stringify(x)), 'invalid_contract');
});
test('行順・report順・schooling slot順を保持、配列順が変わればDTO digestも変わる', async () => {
  const r = row('first'); const s = row('second', 2, 2);
  const a = await create(raw([r, s]));
  const changed = structuredClone([r, s]); changed.reverse(); changed[1].reports.reverse(); changed[1].schoolings.reverse();
  const b = await create(raw(changed)); assert.deepEqual(b.dto.courses, changed);
  assert.notEqual(a.dtoSha256, b.dtoSha256); await roundtrip(b);
});
test('JSON key順・空白はraw digestで区別し、同じDTOのcanonical digestは安定', async () => {
  const x = input(); const a = await create(JSON.stringify(x));
  const b = await create(JSON.stringify({ courses: x.courses, capturedAt: x.capturedAt, source: x.source, schemaVersion: x.schemaVersion }, null, 2));
  assert.notEqual(a.rawSha256, b.rawSha256); assert.equal(a.dtoSha256, b.dtoSha256);
});
test('raw/DTO/metadata改変を再計算済みarchive hashでも拒否', async () => {
  const a = await create(raw());
  for (const change of [
    b => { b.dto.courses[0].earnedCredits.value = 99; b.dtoSha256 = hash(canonical(b.dto)); },
    b => { b.rawUtf8Bytes++; }, b => { b.rawSha256 = 'a'.repeat(64); },
    b => { b.policy.normalization = 'guess'; }, b => { b.inputContract.schemaVersion = 2; },
    b => { b.raw = raw([row('changed')]); },
  ]) {
    const b = structuredClone(a); change(b); await rejects(decode(JSON.stringify(await rehash(b))), 'archive_mismatch');
  }
});
for (const field of ['canCommit', 'saveAuthority', 'unknown']) test(`archiveの余分な${field}を拒否`, async () => {
  const a = await create(raw()); await rejects(decode(JSON.stringify({ ...a, [field]: true })), 'archive_shape');
});
test('未来版と別formatを拒否し、正式N/B/A/Uを発行しない', async () => {
  const a = await create(raw());
  for (const changes of [{ format: 'hosei-attempt-backup' }, { contractVersion: '1' }]) await rejects(decode(JSON.stringify({ ...a, ...changes })), 'unsupported_version');
  assert.equal(a.format, SOURCE_FORMAT); assert.match(a.contractVersion, /prototype/);
  for (const k of ['schemaVersion', 'backupVersion', 'authorityVersion', 'rule']) assert.equal(k in a, false);
});
test('rawのUTF8容量は日本語・emojiもbyteで数え境界丁度は受理', async () => {
  const text = raw([row('日本語😀')]); const n = Buffer.byteLength(text);
  const a = await create(text, { maxRawBytes: n }); assert.equal(a.rawUtf8Bytes, n);
  await rejects(create(text, { maxRawBytes: n - 1 }), 'capacity_exceeded');
});
test('raw容量超過・巨大未知field・行数超過を拒否し入力は不変', async () => {
  const x = { ...input(), unknown: 'x'.repeat(SOURCE_LIMITS.maxRawBytes) }; const text = JSON.stringify(x);
  await rejects(create(text), 'capacity_exceeded'); assert.equal(x.unknown.length, SOURCE_LIMITS.maxRawBytes);
  await rejects(create(raw([row(), row()]), { maxCourses: 1 }), 'capacity_exceeded');
});
test('rawではなくescape増分とDTO二重保持を含むarchive全体に容量を適用', async () => {
  const text = raw([row('引用"\\\n'.repeat(20))]); const a = await create(text);
  const size = Buffer.byteLength(JSON.stringify(a)); assert.ok(size > Buffer.byteLength(text));
  assert.deepEqual(await create(text, { maxArchiveBytes: size }), a);
  await rejects(create(text, { maxArchiveBytes: size - 1 }), 'capacity_exceeded');
  await rejects(decode(JSON.stringify(a), { maxArchiveBytes: size - 1 }), 'capacity_exceeded');
});
for (const options of [{ maxRawBytes: 0 }, { maxRawBytes: Infinity }, { maxRawBytes: SOURCE_LIMITS.maxRawBytes + 1 }, { maxCourses: 1.5 }, { unknown: 1 }]) test(`容量policyを不正・緩和できない ${JSON.stringify(options)}`, async () => {
  await rejects(create(raw(), options), 'invalid_limits');
});
test('深すぎる未知fieldも容量境界で拒否し、原文をエラーに出さない', async () => {
  const text = JSON.stringify(input()).replace('{', '{"deep":' + '['.repeat(70) + '"PRIVATE_MARKER"' + ']'.repeat(70) + ',');
  await rejects(create(text), 'capacity_exceeded');
});
for (const [text, expected] of [
  ['{"schemaVersion":1,"schemaVersion":1}', 'duplicate_json_key'],
  ['{"a":1,"\\u0061":2}', 'duplicate_json_key'],
  ['{"n":-0}', 'numeric_precision'], ['{"n":1e999}', 'numeric_precision'],
  ['{"n":9007199254740993}', 'numeric_precision'], ['{"n":1e-999}', 'numeric_precision'],
  ['{"n":0.10000000000000001}', 'numeric_precision'], ['{"n":4.0000000000000001}', 'numeric_precision'],
  ['{"PRIVATE_MARKER":', 'invalid_json'], ['[]', 'invalid_contract'], ['null', 'invalid_contract'],
]) test(`不正・数値情報損失を固定codeで拒否 ${expected}/${text.slice(0, 24)}`, async () => {
  await rejects(create(text), expected);
});
test('負の単位と無効日付をv1 parserが拒否する', async () => {
  const a = input(); a.courses[0].earnedCredits.value = -1;
  await rejects(create(JSON.stringify(a)), 'invalid_contract');
  a.courses[0].earnedCredits.value = 4; a.courses[0].creditExam.date = '2025-02-30';
  await rejects(create(JSON.stringify(a)), 'invalid_contract');
});
test('literal孤立surrogateは拒否、escaped surrogateは原文とDTOに保存可能', async () => {
  await rejects(create(raw().replace('過年度科目', '\ud800')), 'invalid_unicode');
  const text = raw([row('\ud800')]); const a = await create(text);
  assert.equal(a.raw, text); assert.equal(a.dto.courses[0].rawName, '\ud800'); await roundtrip(a);
});
test('rawに含まれる数値風文字列はlexical numeric policyの対象にしない', async () => {
  const r = row('1e-999 " 4.0000000000000001'); r.earnedCredits.raw = 'unknown';
  const a = await create(raw([r])); assert.equal(a.dto.courses[0].earnedCredits.raw, 'unknown');
});
test('object入力はgetter等を読む前に拒否、非文字列を文字列化しない', async () => {
  let reads = 0; const x = { get schemaVersion() { reads++; throw Error('PRIVATE_MARKER'); } };
  await rejects(create(x), 'input_type'); await rejects(decode(x), 'input_type'); assert.equal(reads, 0);
});
test('同時作成・decodeは入力のsnapshotと独立、storage/clock/UUID資格を使わない', async () => {
  const text = raw(); const before = Date.now, uuid = globalThis.crypto.randomUUID;
  Date.now = () => { throw Error('clock'); }; globalThis.crypto.randomUUID = () => { throw Error('UUID'); };
  try {
    const [a, b] = await Promise.all([create(text), create(text)]); assert.deepEqual(a, b); assert.notEqual(a, b);
    await roundtrip(a); assert.equal(text, raw());
  } finally { Date.now = before; globalThis.crypto.randomUUID = uuid; }
});
test('新moduleに保存・Worker・catalog・authority依存がない', () => {
  const code = readFileSync(new URL('../../src/planner/attempts/gradeImport/sourceArchive.ts', import.meta.url), 'utf8');
  const imports = [...code.matchAll(/from ['"]([^'"]+)['"]/g)].map(x => x[1]);
  assert.deepEqual(imports, ['../../gradeImport/gradeImportContract', '../jsonInput', '../../digest']);
});

test('archive JSON自身のnumeric精度損失も、raw検証とは別に拒否する', async () => {
  const a = await create(raw([row('numeric', 0)]));
  // Change the serialized DTO only. Native JSON.parse would silently read the new value as zero.
  const b = JSON.stringify(a).replace('"earnedCredits":{"raw":"0","value":0}', '"earnedCredits":{"raw":"0","value":1e-999}');
  assert.notEqual(b, JSON.stringify(a)); await rejects(decode(b), 'numeric_precision');
});
test('storage・network・Worker・Lock getterはcreate/decodeでアクセス0', async () => {
  const keys = ['localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'fetch', 'Worker'];
  const old = keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]); let reads = 0;
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, get() { reads++; throw Error('forbidden IO'); } });
  try { await roundtrip(await create(raw())); assert.equal(reads, 0); }
  finally { for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
});
