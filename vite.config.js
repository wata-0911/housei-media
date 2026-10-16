import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { attemptWorkbenchEnabled } from './dev/attempts/gate.ts';

export default defineConfig(({ command, mode }) => {
  const enabled = attemptWorkbenchEnabled(command, mode, process.env.YI05_WORKBENCH, process.env.NODE_ENV);
  return {
    plugins: [react(), {
      name: 'isolated-attempt-workbench',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const path = req.url?.split('?')[0] ?? '';
          if (path === '/__dev/attempts' || path === '/__dev/attempts/') {
            if (!enabled) { res.statusCode = 404; res.end('Not found'); return; }
            const html = await server.transformIndexHtml('/__dev/attempts', '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>YI-05 開発用 Attempt</title></head><body><div id="root"></div><script type="module" src="/dev/attempts/main.tsx"></script></body></html>');
            res.setHeader('Content-Type', 'text/html'); res.end(html); return;
          }
          // Also block direct entry/module requests when disabled.
          if (!enabled && /^(?:\/dev\/attempts\/|\/src\/planner\/attempts\/workbench\/)/.test(path)) {
            res.statusCode = 404; res.end('Not found'); return;
          }
          next();
        });
      },
    }],
  };
});
