import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { posix } from 'node:path';
import { attemptWorkbenchEnabled } from './dev/attempts/gate.ts';

export default defineConfig(({ command, mode }) => {
  const persistence = attemptWorkbenchEnabled(command, mode, process.env.YI06_PERSISTENCE, process.env.NODE_ENV);
  const enabled = attemptWorkbenchEnabled(command, mode, process.env.YI05_WORKBENCH, process.env.NODE_ENV);
  return {
    plugins: [react(), {
      name: 'isolated-attempt-workbench',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          let path = req.url?.split('?')[0] ?? '';
          try { for (let i = 0; i < 3; i++) { const decoded = decodeURIComponent(path); if (decoded === path) break; path = decoded; } }
          catch { res.statusCode = 404; res.end('Not found'); return; }
          path = posix.normalize(path);
          if (path === '/__dev/persistence' || path === '/__dev/persistence/') {
            if (!persistence) { res.statusCode = 404; res.end('Not found'); return; }
            const html = await server.transformIndexHtml('/__dev/persistence', '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>YI-06 隔離保存</title></head><body><div id="root"></div><script type="module" src="/dev/persistence/main.tsx"></script></body></html>');
            res.setHeader('Content-Type', 'text/html'); res.end(html); return;
          }
          if (!persistence && /(?:^|\/)(?:dev\/persistence\/|src\/planner\/attempts\/persistence\/)/.test(path)) {
            res.statusCode = 404; res.end('Not found'); return;
          }
          if (path === '/__dev/attempts' || path === '/__dev/attempts/') {
            if (!enabled) { res.statusCode = 404; res.end('Not found'); return; }
            const html = await server.transformIndexHtml('/__dev/attempts', '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>YI-05 開発用 Attempt</title></head><body><div id="root"></div><script type="module" src="/dev/attempts/main.tsx"></script></body></html>');
            res.setHeader('Content-Type', 'text/html'); res.end(html); return;
          }
          // Also block direct entry/module requests when disabled.
          if (!enabled && !persistence && /(?:^|\/)(?:dev\/attempts\/|src\/planner\/attempts\/workbench\/)/.test(path)) {
            res.statusCode = 404; res.end('Not found'); return;
          }
          next();
        });
      },
    }],
  };
});
