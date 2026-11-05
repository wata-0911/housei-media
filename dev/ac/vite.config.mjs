import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
// Explicit verification build only. Never included by npm run build.
export default defineConfig({plugins:[react()],build:{outDir:'../dist-ac',emptyOutDir:true,rollupOptions:{input:'dev/ac/index.html'}}});
