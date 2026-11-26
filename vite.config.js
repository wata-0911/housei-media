import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { compileFixedValidators, rewriteBrowserValidators, virtualPrefix } from './scripts/planner-2026-validators.mjs';

function plannerDocument(root) {
  const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
  const plannerRewrites = config.rewrites.filter(rule => rule.destination === '/planner.html');
  return {
    name: 'same-origin-planner-document',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method === 'GET' || request.method === 'HEAD') {
          const path = (request.url ?? '/').split('?')[0];
          for (const rule of config.headers ?? []) {
            if (rule.source === path) for (const header of rule.headers) response.setHeader(header.key, header.value);
          }
          const rewrite = plannerRewrites.find(rule => rule.source === path);
          if (rewrite) request.url = rewrite.destination + (request.url ?? '/').slice(path.length);
        }
        next();
      });
    },
  };
}

async function plannerValidators(root) {
  const validators = await compileFixedValidators(root);
  const transformed = new Set();
  return {
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
    generateBundle(_, outputs) {
      if (transformed.size !== 2) throw new Error('Both pinned Ajv startup points are required');
      for (const output of Object.values(outputs)) {
        if (output.type !== 'chunk') continue;
        const compiler = Object.keys(output.modules).find(id => /\/ajv\/dist\/(?:compile\/|2020\.js|core\.js)/.test(id));
        if (compiler) throw new Error(`Unexpected Ajv runtime compiler: ${compiler}`);
      }
    },
  };
}

function embeddedPreview(parentOrigin) {
  const allowedParent = /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(parentOrigin ?? '')
    && Number(parentOrigin.split(':').pop()) <= 65535;
  return {
    name: 'embedded-planner-child-preview',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (/^\/planner\.html(?:\?|$)/.test(request.url ?? '')) {
          response.setHeader('Content-Security-Policy', `frame-ancestors ${allowedParent ? parentOrigin : "'none'"}`);
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
        }
        next();
      });
    },
  };
}

export default defineConfig(async ({ command, mode }) => {
  const root = process.cwd();
  const stage69 = mode === 'stage69-parent' || mode === 'stage69-child';
  const parentOnly = mode === 'stage65-parent' || mode === 'stage69-parent' || mode === 'main-planner-parent';
  const childOnly = mode === 'stage65-child' || mode === 'stage69-child' || mode === 'main-planner-child';
  const plugins = [react()];
  if (mode === 'stage65-child') plugins.push(embeddedPreview(loadEnv(mode, root).VITE_PLANNER_2026_PARENT_ORIGIN));
  else if (!parentOnly && !childOnly) plugins.push(plannerDocument(root));
  if (command === 'build' && !parentOnly) plugins.push(await plannerValidators(root));
  const inputs = parentOnly ? ['index.html'] : childOnly ? ['planner.html'] : ['index.html', 'planner.html'];
  return {
    plugins,
    ...(stage69 ? { base: parentOnly ? '/_stage69-parent/' : '/_stage69-child/' } : {}),
    ...(mode === 'main-planner-child' ? { base: '/_planner-child/' } : {}),
    ...(childOnly ? { publicDir: false, appType: 'mpa' } : {}),
    build: { rollupOptions: { input: inputs.map(input => resolve(root, input)) } },
  };
});
