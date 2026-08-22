import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/rss-feed': {
        target: 'https://rss.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/rss-feed/, 'https://rss.app/feeds/DjTTnJM54Xd7QeFI.xml'),
      },
    },
  },
});