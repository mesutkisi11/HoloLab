import { defineConfig } from 'vite';

// base './' : GitHub Pages'te alt klasörden de çalışsın diye
// worker.format 'es': el takibi işçisi modül olarak kalsın (MediaPipe WASM'ı import() ile yükler)
export default defineConfig({
  base: './',
  server: { host: true },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1200, target: 'es2022' },
});
