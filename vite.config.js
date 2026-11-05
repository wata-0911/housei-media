import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { posix, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exporterBuildSettings } from './scripts/grade-import-backup-revision.mjs';
import { attemptWorkbenchEnabled } from './dev/attempts/gate.ts';

export default defineConfig(({ command, mode }) => {
  const institutional = attemptWorkbenchEnabled(command, mode, process.env.YI_INSTITUTIONAL_READONLY, process.env.NODE_ENV);
  const persistence = attemptWorkbenchEnabled(command, mode, process.env.YI06_PERSISTENCE, process.env.NODE_ENV);
  const enabled = attemptWorkbenchEnabled(command, mode, process.env.YI05_WORKBENCH, process.env.NODE_ENV);
  const exporter = exporterBuildSettings(fileURLToPath(new URL('./', import.meta.url)), { command });
  if (command === 'build' && !exporter.result.stamp) console.warn(`G03 B1 export disabled: ${exporter.result.reason}`);
  return {
    define: exporter.define,
    plugins: [react(), exporter.plugin, {
      name: 'isolated-attempt-workbench',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const deny = () => { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.end('Not found'); };
          let path = req.url?.split('?')[0] ?? '';
          try {
            // Vite decodes module URLs and resolves files on the host filesystem.
            // Reject ambiguous separators/remaining escapes rather than guessing
            // how a later middleware or OS would interpret them.
            for (let i = 0; i < 3; i++) {
              const decoded = decodeURIComponent(path);
              if (decoded === path) break;
              path = decoded;
            }
            if (path.includes('%') || path.includes('\\') || /[\u0000-\u001f\u007f?#]/.test(path) || !path.startsWith('/')) { deny(); return; }
          } catch { deny(); return; }
          path = posix.normalize(path);
          const paths = [path.toLowerCase()];
          try {
            // Also classify the actual file: /@fs and filesystem aliases must
            // not bypass the same gate as a root-relative module request.
            const requested = path.startsWith('/@fs/') ? path.slice(4) : resolve(server.config.root, '.' + path);
            paths.push(realpathSync(requested).replaceAll('\\', '/').toLowerCase());
          } catch { /* Missing files still pass the URL gate before Vite resolves them. */ }
          if (paths.some(p =>
            (!institutional && /(?:^|\/)(?:dev\/institutional|__dev\/institutional)(?:\/|$)/.test(p)) ||
            (!persistence && /(?:^|\/)(?:dev\/persistence|src\/planner\/attempts\/persistence|__dev\/persistence)(?:\/|$)/.test(p)) ||
            (!enabled && /(?:^|\/)__dev\/attempts(?:\/|$)/.test(p)) ||
            // The YI05 bootstrap is private to YI05; YI06 only shares its components.
            (!enabled && /(?:^|\/)dev\/attempts\/main\.tsx(?:\/|$)/.test(p)) ||
            (!enabled && !persistence && /(?:^|\/)(?:dev\/attempts|src\/planner\/attempts\/workbench)(?:\/|$)/.test(p))
          )) { deny(); return; }
          if (path === '/__dev/institutional' || path === '/__dev/institutional/') {
            if (!institutional) { res.statusCode = 404; res.end('Not found'); return; }
            const html = await server.transformIndexHtml('/__dev/institutional', '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>制度科目 read-only 検索</title></head><body><div id="root"></div><script type="module" src="/dev/institutional/main.tsx"></script></body></html>');
            res.setHeader('Content-Type', 'text/html'); res.end(html); return;
          }
          if (path === '/__dev/persistence' || path === '/__dev/persistence/') {
            if (!persistence) { res.statusCode = 404; res.end('Not found'); return; }
            const html = await server.transformIndexHtml('/__dev/persistence', '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>YI-06 隔離保存</title></head><body><div id="root"></div><script type="module" src="/dev/persistence/main.tsx"></script></body></html>');
            res.setHeader('Content-Type', 'text/html'); res.end(html); return;
          }
          if (path === '/__dev/attempts' || path === '/__dev/attempts/') {
            if (!enabled) { res.statusCode = 404; res.end('Not found'); return; }
            const html = await server.transformIndexHtml('/__dev/attempts', '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>YI-05 開発用 Attempt</title></head><body><div id="root"></div><script type="module" src="/dev/attempts/main.tsx"></script></body></html>');
            res.setHeader('Content-Type', 'text/html'); res.end(html); return;
          }
          next();
        });
      },
    }],
  };
});
