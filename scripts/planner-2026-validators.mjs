import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { compileFunction } from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const standaloneCode = require('ajv/dist/standalone').default;
export const ajvVersion = require('ajv/package.json').version;
const sha = value => createHash('sha256').update(value).digest('hex');

const catalogPath = 'src/planner/planner_catalog_2026.schema.json';
const catalogDigest = 'bc8ddd9bb66adfb2c6f921e060967ee072b3c3899ef1c74003f205846ab9f2a7';

const inputs = [
  {
    path: 'src/planner/validation.ts',
    sha256: '56d85e9e9aaf6f88bc2a67f64df1fbdd8458212842d52a969e643af26078fc28',
    start: 'const ajv = ',
    end: 'export function validateState(',
    bindings: ['validateCatalog', 'validateStateSchema'],
  },
  {
    path: 'src/planner/backup/plannerBackup.ts',
    sha256: 'a693b0afb03ff996c5bf1bf07bad86c0cebb40024afed579e2869bdb25886be2',
    start: '// Tighten only the backup boundary.',
    end: 'const unique = ',
    bindings: ['strictState'],
  },
];

const fixedAjvImport = "import Ajv2020 from 'ajv/dist/2020';";
export const virtualPrefix = 'virtual:stage36-ajv/';
const virtualName = binding => virtualPrefix + binding;

function pinned(root, path, sha256) {
  const content = readFileSync(resolve(root, path), 'utf8');
  assert.equal(sha(content), sha256, `Unexpected fixed input: ${path}`);
  return content;
}

function blockBounds(source, input) {
  const start = source.indexOf(input.start);
  const end = source.indexOf(input.end, start);
  assert.ok(start >= 0 && end > start, `Missing fixed Ajv block: ${input.path}`);
  return [start, end];
}

export function rewriteBrowserValidators(root, id, source) {
  const input = inputs.find(item => resolve(root, item.path) === id);
  if (!input) return;
  assert.equal(sha(source), input.sha256, `Unexpected transform input: ${input.path}`);
  const [start, end] = blockBounds(source, input);
  assert.ok(source.includes(fixedAjvImport));
  const inject = input.bindings.map(binding => `import ${binding} from '${virtualName(binding)}';`);
  if (input.bindings.includes('validateCatalog')) inject.push('export { validateCatalog };');
  return (source.slice(0, start) + inject.join('\n') + '\n\n' + source.slice(end)).replace(fixedAjvImport + '\n', '');
}

export async function compileFixedValidators(root) {
  assert.equal(ajvVersion, '8.20.0');
  const schema = JSON.parse(pinned(root, catalogPath, catalogDigest));
  const validators = {};
  for (const input of inputs) {
    const source = pinned(root, input.path, input.sha256);
    const [start, end] = blockBounds(source, input);
    const block = source.slice(start, end).replace('export const validateCatalog', 'const validateCatalog');
    const setup = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    class BuildAjv extends Ajv2020 {
      constructor(options) {
        super({ ...options, code: { source: true } });
      }
    }
    // Only SHA-pinned repository code runs here, in the build process.
    // Uploaded JSON never reaches this generator.
    const assemble = compileFunction(`${setup}\nreturn { ajv, ${input.bindings.join(', ')} };`,
      ['Ajv2020', 'schema'], { filename: input.path });
    const assembled = assemble(BuildAjv, schema);
    for (const name of input.bindings) {
      const standalone = standaloneCode(assembled.ajv, assembled[name]);
      // Bundle Ajv's small runtime helpers into static ESM. No compiler modules are inputs.
      const result = await build({
        absWorkingDir: root,
        stdin: { contents: standalone, resolveDir: root, sourcefile: `stage36-${name}.cjs` },
        platform: 'browser', format: 'esm', target: 'es2022', bundle: true, write: false, metafile: true,
      });
      const dependencies = Object.keys(result.metafile.inputs);
      assert.ok(dependencies.every(file => file === `stage36-${name}.cjs` || /^node_modules\/ajv\/dist\/runtime\//.test(file)),
        `Unexpected validator bundle inputs: ${dependencies.join(', ')}`);
      const code = result.outputFiles[0].text;
      assert.doesNotMatch(code, /\beval\s*\(|\bnew\s+Function\s*\(/);
      validators[name] = { code, dependencies, sha256: sha(code), original: assembled[name] };
    }
  }
  return validators;
}
