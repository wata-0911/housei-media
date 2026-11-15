import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)), plugins: [react()],
  server: { host: '127.0.0.1' },
  build: {
    outDir: process.env.YI_SIDECAR_BUILD || '/tmp/yi-readonly-search-build',
    rollupOptions: { input: fileURLToPath(new URL('./yi-readonly-search.html', import.meta.url)) },
  },
});
