import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { compileFixedValidators, rewriteBrowserValidators, virtualPrefix } from './scripts/planner-2026-validators.mjs';

const root = process.cwd();

export default defineConfig(async () => {
  const validators = await compileFixedValidators(root);
  const transformed = new Set();
  return {
    publicDir: false,
    plugins: [{
      name: 'planner-2026-standalone-ajv',
      enforce: 'pre',
      resolveId(id) {
        if (id.startsWith(virtualPrefix)) return '\0' + id;
      },
      load(id) {
        if (id.startsWith('\0' + virtualPrefix)) return validators[id.slice(virtualPrefix.length + 1)].code;
      },
      transform(source, id) {
        const code = rewriteBrowserValidators(root, id, source);
        if (code === undefined) return;
        transformed.add(id);
        return { code, map: null };
      },
      generateBundle(_, chunks) {
        if (transformed.size !== 2) throw new Error('Both pinned Ajv startup points are required');
        for (const chunk of Object.values(chunks)) {
          if (chunk.type !== 'chunk') continue;
          const compiler = Object.keys(chunk.modules).find(id => /\/ajv\/dist\/(?:compile\/|2020\.js|core\.js)/.test(id));
          if (compiler) throw new Error(`Unexpected Ajv runtime compiler in preview: ${compiler}`);
        }
      },
    }],
    build: { rollupOptions: { input: resolve(root, 'planner-2026.html') } },
  };
});
