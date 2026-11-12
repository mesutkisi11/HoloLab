import { defineConfig } from 'vite';

// base './' : GitHub Pages'te alt klasörden de çalışsın diye
export default defineConfig({
  base: './',
  server: { host: true },
  build: { chunkSizeWarningLimit: 1000 },
});
